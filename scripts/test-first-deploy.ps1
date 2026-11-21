# =============================================================================
# ORYA - P0-8b : rejoue docs/premier-deploiement.md sur un conteneur JETABLE VIERGE
#   (orya-test-fd, 127.0.0.1:55434, label created-by=orya-test), puis teste l'outil
#   de creation du premier super-administrateur. Conteneur supprime dans le finally.
#   1. admin : CREATE DATABASE, 000_roles.sql, ALTER DATABASE/SCHEMA OWNER orya_owner
#   2. orya_owner : prisma migrate deploy + apply-sql (APPLY_ROLES=0 -> 010_rls.sql)
#   3. controles : proprietaires (base, tables, fonctions orya_auth), RLS, base vide
#   4. rejeu du job tel que l'image le lance (APPLY_ROLES=1, administrateur) : idempotent
#   5. outil super-admin : refus (argv, non-terminal, faible, confirmation), creation,
#      audit, connexion API -> enrolement MFA impose, second appel refuse
# Mots de passe generes ici, jamais affiches. Ne touche aucune autre ressource.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api = Join-Path $root "apps/api"
$env:ORYA_TEST_CONTAINER = "orya-test-fd"
$env:ORYA_TEST_PORT = "55434"
Remove-Item Env:ORYA_TEST_DB -ErrorAction SilentlyContinue
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  FD OK - $Label" } else { $script:ko++; Write-Host "  FD KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }
$apiProc = $null
$savedEnv = @{}
foreach ($k in "DATABASE_URL", "DIRECT_DATABASE_URL", "APPLY_ROLES", "NODE_ENV", "API_PORT", "JWT_ACCESS_SECRET", "MFA_ENCRYPTION_KEY", "ORYA_BOOTSTRAP_STDIN", "STORAGE_LOCAL_DIR") { $savedEnv[$k] = [Environment]::GetEnvironmentVariable($k) }

try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts/test-pg-up.ps1")
    if ($LASTEXITCODE -ne 0) { throw "conteneur jetable orya-test-fd indisponible." }
    . (Join-Path $root "scripts/test-guard.ps1")
    $T = Get-OryaTestTarget -DefaultDb "orya_fd"
    $c = $T.Container; $db = $T.Db; $adm = $T.DbUser
    function Psql([string]$Db, [string]$Sql) { $Sql | & docker exec -i $c psql -U $adm -d $Db -v ON_ERROR_STOP=1 -q -At 2>&1 }

    Write-Host "=== 1. Base et roles (administrateur) ===" -ForegroundColor Cyan
    $null = Psql "postgres" "CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db creee sur un serveur vierge"
    Check ((Psql $db "SELECT count(*) FROM pg_tables WHERE schemaname='public';") -eq "0") "base vierge (aucune table)"
    $null = Get-Content -Raw (Join-Path $api "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    Check ($LASTEXITCODE -eq 0) "000_roles.sql applique par l'administrateur"
    $ownerPw = Rand 24; $appPw = Rand 24
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    Check ($LASTEXITCODE -eq 0) "base et schema detenus par orya_owner, mots de passe definis (non affiches)"
    Check ((Psql $db "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database();") -eq "orya_owner") "controle avant migration : proprietaire de la base = orya_owner"

    Write-Host "=== 2. Migration en orya_owner ===" -ForegroundColor Cyan
    $env:DIRECT_DATABASE_URL = "postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL = "postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:APPLY_ROLES = "0"
    Push-Location $api
    try {
        & npx prisma migrate deploy *> $null
        Check ($LASTEXITCODE -eq 0) "prisma migrate deploy en orya_owner"
        & npx tsx prisma/apply-sql.ts *> $null
        Check ($LASTEXITCODE -eq 0) "010_rls.sql applique en orya_owner (APPLY_ROLES=0), controle de propriete inclus"
    }
    finally { Pop-Location }

    Write-Host "=== 3. Controles ===" -ForegroundColor Cyan
    Check ((Psql $db "SELECT string_agg(DISTINCT tableowner, ',') FROM pg_tables WHERE schemaname='public';") -eq "orya_owner") "toutes les tables appartiennent a orya_owner"
    $fn = Psql $db "SELECT string_agg(p.proname || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ';'), '|' ORDER BY p.proname) FROM pg_proc p WHERE p.proname IN ('orya_auth_credentials','orya_auth_mfa_state');"
    Check ($fn -eq "orya_auth_credentials:orya_auth:true:search_path=pg_catalog, pg_temp|orya_auth_mfa_state:orya_auth:true:search_path=pg_catalog, pg_temp") "fonctions d'authentification : orya_auth, SECURITY DEFINER, search_path=pg_catalog, pg_temp"
    Check ((Psql $db "SELECT rolbypassrls::text || rolsuper::text FROM pg_roles WHERE rolname='orya_app';") -eq "falsefalse") "orya_app NOBYPASSRLS, non superutilisateur"
    Check ([int](Psql $db "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity;") -ge 20) "RLS active sur les tables metier"
    Check ((Psql $db "SELECT (SELECT count(*) FROM ""User"") + (SELECT count(*) FROM ""School"");") -eq "0") "aucune donnee de demo (ni utilisateur ni ecole)"

    Write-Host "=== 4. Rejeu du job (APPLY_ROLES=1, administrateur) ===" -ForegroundColor Cyan
    $env:DIRECT_DATABASE_URL = "postgresql://${adm}:$($T.DbPassword)@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:APPLY_ROLES = "1"
    Push-Location $api
    try { & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "rejeu 000_roles + 010_rls par l'administrateur : idempotent" }
    finally { Pop-Location }
    $fn2 = Psql $db "SELECT count(*) FROM pg_proc WHERE proname IN ('orya_auth_credentials','orya_auth_mfa_state') AND pg_get_userbyid(proowner)='orya_auth';"
    Check ($fn2 -eq "2") "apres rejeu, orya_auth possede toujours les deux fonctions"
    $env:DIRECT_DATABASE_URL = "postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    Remove-Item Env:APPLY_ROLES

    Write-Host "=== 5. Outil premier super-administrateur ===" -ForegroundColor Cyan
    $cli = "prisma/create-super-admin.ts"
    $email = "fondateur@orya.test"
    $pw = "Fd-" + (Rand 8) + "-Zq9!"
    Push-Location $api
    try {
        $o = & npx tsx $cli "--email=$email" "--password=x" 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 2 -and $o -match "aucun mot de passe en parametre") "mot de passe en parametre refuse (code 2)"
        Remove-Item Env:ORYA_BOOTSTRAP_STDIN -ErrorAction SilentlyContinue
        $o = "$pw`n$pw`n" | & npx tsx $cli "--email=$email" 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 2 -and $o -match "saisie interactive requise") "entree non interactive refusee hors mode test"
        $env:ORYA_BOOTSTRAP_STDIN = "1"
        $o = "court1A!`ncourt1A!`n" | & npx tsx $cli "--email=$email" 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 2 -and $o -match "trop faible") "mot de passe faible refuse"
        $o = "$pw`n${pw}x`n" | & npx tsx $cli "--email=$email" 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 2 -and $o -match "different") "confirmation differente refusee"
        Check ((Psql $db "SELECT count(*) FROM ""User"";") -eq "0") "aucun compte cree par les refus"
        $o = "$pw`n$pw`n" | & npx tsx $cli "--email=$email" "--name=Fondateur test" 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 0) "super-administrateur cree (mode test : mot de passe par tube, jamais dans argv)"
        Check (-not $o.Contains($pw)) "le mot de passe n'apparait pas dans la sortie"
        $o2 = "$pw`n$pw`n" | & npx tsx $cli "--email=autre@orya.test" 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 3 -and $o2 -match "existe deja") "second super-administrateur refuse (code 3)"
    }
    finally { Pop-Location; Remove-Item Env:ORYA_BOOTSTRAP_STDIN -ErrorAction SilentlyContinue }
    $row = Psql $db "SELECT u.status || ':' || (u.""mfaSecret"" IS NULL) || ':' || (u.""mfaEnrolledAt"" IS NULL) || ':' || p.role || ':' || (u.""activeProfileId"" = p.id) || ':' || (u.""passwordHash"" LIKE '`$argon2id`$%') FROM ""User"" u JOIN ""UserProfile"" p ON p.""userId"" = u.id;"
    Check ($row -eq "active:true:true:super_admin:true:true") "compte actif, profil super_admin actif, MFA non enrole, empreinte Argon2id"
    Check ((Psql $db "SELECT count(*) || ':' || min(severity::text) FROM ""AuditLog"" WHERE action='admin.super_admin.bootstrap';") -eq "1:critical") "creation auditee une seule fois (critical)"
    Check ((Psql $db "SELECT count(*) FROM ""UserProfile"" WHERE role='super_admin';") -eq "1") "un seul super-administrateur"

    Write-Host "=== 6. Connexion API (orya_app) ===" -ForegroundColor Cyan
    $port = 3250
    $env:API_PORT = "$port"; $env:NODE_ENV = "development"
    $env:JWT_ACCESS_SECRET = Rand 48
    $env:MFA_ENCRYPTION_KEY = (& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:STORAGE_LOCAL_DIR = Join-Path $env:TEMP "orya-test-fd-storage"
    $apiProc = Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $api -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:TEMP "orya-fd-api.out") -RedirectStandardError (Join-Path $env:TEMP "orya-fd-api.err")
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) { Start-Sleep 1; try { if ((Invoke-WebRequest "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch {} }
    Check $ready "API demarree sur la base fraiche (orya_app)"
    if ($ready) {
        $body = @{ email = $email; password = $pw } | ConvertTo-Json
        $r = $null; try { $r = Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/login" -ContentType "application/json" -Body $body } catch {}
        Check ($null -ne $r -and $r.mfaRequired -eq $true -and $r.method -eq "enroll" -and -not $r.accessToken) "premiere connexion : enrolement MFA impose, aucun jeton de session"
        $bad = 0; try { Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/login" -ContentType "application/json" -Body (@{ email = $email; password = "${pw}x" } | ConvertTo-Json) | Out-Null } catch { $bad = [int]$_.Exception.Response.StatusCode }
        Check ($bad -eq 401) "mauvais mot de passe refuse (401)"
    }
}
catch { $script:ko++; Write-Host "  FD KO - arret : $($_.Exception.Message)" -ForegroundColor Red }
finally {
    if ($apiProc -and -not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts/test-pg-down.ps1")
    foreach ($k in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $savedEnv[$k]) }
    Remove-Item Env:ORYA_TEST_CONTAINER, Env:ORYA_TEST_PORT -ErrorAction SilentlyContinue
}
Write-Host "PREMIER DEPLOIEMENT : $($script:ok) OK, $($script:ko) KO"
if ($script:ko -gt 0) { exit 1 }
exit 0
