# =============================================================================
# ORYA - verification complete sur le conteneur JETABLE orya-test-pg uniquement.
#   1. scripts/test-pg-up.ps1 (127.0.0.1:55433, etiquette created-by=orya-test)
#   2. controles statiques API (T13 isolation, T14 select User, encodage, T16 fichiers, T17 perimetre/Massar) + compositions prod/preprod (B03)
#   3. tsc API + web, lint web, build API + web
#   4. suites DB, API, E2E, sauvegarde-restauration (gardes test-guard.ps1)
#   4a. suite Bloc 3 fichiers : conteneurs jetables orya-test-s3 + orya-test-clamav (scripts/test-files-up.ps1)
#   4c. suite Bloc 5 facturation ecole (base orya_bloc5 sur orya-test-pg)
#   4d. suite Bloc 6 pre-production (t62u : mot de passe, journal WORM, fumee) sur orya-test-pg (+ orya-test-s3)
#   4f. suite Bloc 7 ecran direction Consentements (t74u : role, isolation, PII, brouillons, papier) sur orya-test-pg
#   0b. tests unitaires API (t87u tache 4 : Vitest, logique pure : politique de mot de passe, reinitialisation, facturation, consentements, cloture d'appel, ordre du pipeline fichiers, routes de suspension)
#   4g. suite Bloc 8 mot de passe oublie (t87u F01 : anti-enumeration, jeton hache a usage unique, plafonds, revocation, audit) sur orya-test-pg
#   4h. suite Bloc 9 ecarts CDC (t92 : selecteur de profil 3.3, sessions inactives 3.4, etc.) sur orya-test-pg
#   4e. harnais fournisseur S3 (t62u B2) valide sur orya-test-s3 (scripts/test-s3-provider.ps1 -Disposable)
#   4b. premier deploiement sur un 2e conteneur jetable vierge (orya-test-fd, scripts/test-first-deploy.ps1)
#   5. scripts/test-pg-down.ps1 dans un finally (toujours, meme en cas d'echec)
# Recapitulatif unique ; code de sortie 1 si une etape echoue, 0 sinon.
# Ne touche jamais orya-postgres, orya, orya_v2 ni le port 5432 (refus par les gardes).
# SEED_PASSWORD : genere par chaque suite, jamais affiche.
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\verify-all.ps1 [-WithPreprod] [-KeepContainer]
# =============================================================================
param([switch]$WithPreprod, [switch]$KeepContainer)
$ErrorActionPreference = "Continue"
# Un NODE_ENV herite (ex. "development") casse "next build" (prerendu) : chaque etape fixe le sien.
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logs = Join-Path ([IO.Path]::GetTempPath()) ("orya-verify-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $logs | Out-Null
$results = New-Object System.Collections.Generic.List[object]
$started = Get-Date

function Invoke-Step {
    param([string]$Name, [string]$WorkDir, [string]$Exe, [string[]]$Arguments, [scriptblock]$Count)
    $out = Join-Path $logs ("{0:D2}-{1}.out" -f ($results.Count + 1), ($Name -replace '[^A-Za-z0-9]+', '-'))
    $err = "$out.err"
    Write-Host ("=== {0} ===" -f $Name) -ForegroundColor Cyan
    $t0 = Get-Date
    $p = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $WorkDir -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -Wait -PassThru
    $text = ((Get-Content $out -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content $err -Raw -ErrorAction SilentlyContinue))
    $counts = if ($Count) { & $Count $text } else { "" }
    $results.Add([pscustomobject]@{ Etape = $Name; Code = $p.ExitCode; Compteurs = $counts; Duree = [int]((Get-Date) - $t0).TotalSeconds; Journal = $out })
    if ($p.ExitCode -ne 0) { Write-Host "  ECHEC (code $($p.ExitCode)) - journal : $out" -ForegroundColor Red }
}

$ps = "powershell.exe"; $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File")
$api = Join-Path $root "apps/api"; $web = Join-Path $root "apps/web"
$dbCount = { param($t) $ids = [regex]::Matches($t, 'NOTICE:\s+(\S+) OK') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique; $ko = [regex]::Matches($t, '\bKO -').Count; "tests=$(@($ids).Count) echecs=$ko" }
$apiCount = { param($t) $m = [regex]::Match($t, 'Resultat : (\d+) succes, (\d+) echec'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$e2eCount = { param($t) $p = [regex]::Match($t, '(\d+) passed'); $f = [regex]::Match($t, '(\d+) failed'); "reussis=$(if($p.Success){$p.Groups[1].Value}else{0}) echecs=$(if($f.Success){$f.Groups[1].Value}else{0})" }
$brCount = { param($t) if ($t -match 'SAUVEGARDE / RESTAURATION OK') { "tests=1 reussis=1 echecs=0" } else { "tests=1 reussis=0 echecs=1" } }
$b2Count = { param($t) $m = [regex]::Match($t, 'BLOC2 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$fdCount = { param($t) $m = [regex]::Match($t, 'PREMIER DEPLOIEMENT : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$b3Count = { param($t) $m = [regex]::Match($t, 'BLOC3 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$b4Count = { param($t) $m = [regex]::Match($t, 'BLOC4 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$b5Count = { param($t) $m = [regex]::Match($t, 'BLOC5 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$b6Count = { param($t) $m = [regex]::Match($t, 'BLOC6 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$composeCount = { param($t) $m = [regex]::Match($t, 'COMPOSE PROD : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$b7Count = { param($t) $m = [regex]::Match($t, 'BLOC7 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$unitCount = { param($t) $m = [regex]::Match($t, 'Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)'); if ($m.Success) { $f = if ($m.Groups[1].Success) { [int]$m.Groups[1].Value } else { 0 }; "tests=$($m.Groups[3].Value) reussis=$($m.Groups[2].Value) echecs=$f" } else { $m2 = [regex]::Match($t, 'Tests\s+(\d+) failed \((\d+)\)'); if ($m2.Success) { "tests=$($m2.Groups[2].Value) reussis=0 echecs=$($m2.Groups[1].Value)" } else { "resultat introuvable" } } }
$b8Count = { param($t) $m = [regex]::Match($t, 'BLOC8 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$b9Count = { param($t) $m = [regex]::Match($t, 'BLOC9 : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$s3pCount = { param($t) $m = [regex]::Match($t, 'S3PROVIDER : (\d+) OK, (\d+) KO'); if ($m.Success) { "tests=$([int]$m.Groups[1].Value + [int]$m.Groups[2].Value) reussis=$($m.Groups[1].Value) echecs=$($m.Groups[2].Value)" } else { "resultat introuvable" } }
$staticCount = { param($t) $ok = [regex]::Matches($t, '\b(T1[34567]) OK').Count; "controles OK=$ok" }

try {
    Invoke-Step "orya-test-pg (creation)" $root $ps ($psArgs + @((Join-Path $root "scripts/test-pg-up.ps1")))
    if ($results[-1].Code -ne 0) { throw "orya-test-pg indisponible : arret." }
    # Bloc 3b : ClamAV (et S3) jetables des le debut : pieces jointes, agenda et imports passent par l'antivirus.
    Invoke-Step "orya-test-s3 + orya-test-clamav (creation)" $root $ps ($psArgs + @((Join-Path $root "scripts/test-files-up.ps1")))
    $filesUp = ($results[-1].Code -eq 0)
    if (-not $filesUp) { throw "orya-test-s3 / orya-test-clamav indisponibles : arret." }
    $env:CLAMAV_HOST = "127.0.0.1"; $env:CLAMAV_PORT = "55436"
    Invoke-Step "ClamAV pret (PING + VERSION)" $api "node" @("test/api/wait-clamav.mjs")
    if ($results[-1].Code -ne 0) { throw ("ClamAV non pr{0}t" -f [char]234) }
    Invoke-Step "Controles statiques API" $api "cmd.exe" @("/c", "npm test") $staticCount
    Invoke-Step "Tests unitaires API (Vitest)" $api "cmd.exe" @("/c", "set NO_COLOR=1&& npm run test:unit") $unitCount
    # B03 : compositions production et pre-production valides (docker compose config, variables factices, chaque ":?").
    Invoke-Step "Compose production (statique)" $root $ps ($psArgs + @((Join-Path $root "scripts/check-compose-prod.ps1"))) $composeCount
    Invoke-Step "Compose pre-production (statique)" $root $ps ($psArgs + @((Join-Path $root "scripts/check-compose-prod.ps1"), "-File", (Join-Path $root "deploy/docker-compose.preprod.example.yml"))) $composeCount
    Invoke-Step "tsc API" $api "cmd.exe" @("/c", "npx tsc --noEmit")
    Invoke-Step "tsc web" $web "cmd.exe" @("/c", "npm run typecheck")
    Invoke-Step "Lint web" $web "cmd.exe" @("/c", "npm run lint")
    Invoke-Step "Build API" $api "cmd.exe" @("/c", "npm run build")
    Invoke-Step "Build web" $web "cmd.exe" @("/c", "set NODE_ENV=production&& npm run build")
    Invoke-Step "Suite DB" $root $ps ($psArgs + @((Join-Path $api "test/db/run-db-tests.ps1"))) $dbCount
    # t52u : derive de schema (base de test migree vs prisma/schema.prisma), URL jamais affichee.
    Invoke-Step "Derive schema (prisma migrate diff)" $root $ps ($psArgs + @((Join-Path $root "scripts/check-schema-drift.ps1"))) { param($t) if ($t -match 'DERIVE SCHEMA : aucune') { "derive=0" } else { "derive=OUI" } }
    Invoke-Step "Suite API" $root $ps ($psArgs + @((Join-Path $api "test/api/run-api-tests.ps1"))) $apiCount
    Invoke-Step "Suite E2E" $root $ps ($psArgs + @((Join-Path $root "e2e/run-e2e.ps1"))) $e2eCount
    if ($WithPreprod) { Invoke-Step "Suite pre-production" $root $ps ($psArgs + @((Join-Path $root "e2e/run-preprod.ps1"))) $e2eCount }
    Invoke-Step "Sauvegarde-restauration" $root $ps ($psArgs + @((Join-Path $root "scripts/test-backup-restore.ps1"))) $brCount
    Invoke-Step "Premier deploiement (orya-test-fd)" $root $ps ($psArgs + @((Join-Path $root "scripts/test-first-deploy.ps1"))) $fdCount
    Invoke-Step "Bloc 2 consentement/suppression" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc2-tests.ps1"))) $b2Count
    Invoke-Step "Bloc 3 fichiers" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc3-tests.ps1"))) $b3Count
    # Bloc 4 : eleve, bus, export de donnees, droits (memes conteneurs jetables S3 + ClamAV).
    Invoke-Step "Bloc 4 eleve/bus/export/droits" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc4-tests.ps1"))) $b4Count
    # Bloc 5 (Avenant n 1) : facturation ecole, statuts, suspension en lecture seule et ses exceptions.
    Invoke-Step "Bloc 5 facturation ecole" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc5-tests.ps1"))) $b5Count
    # Bloc 6 (t62u) : changement de mot de passe, journal des suppressions WORM, test de fumee.
    Invoke-Step "Bloc 6 pre-production" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc6-tests.ps1"))) $b6Count
    # t74u : ecran direction Consentements, route GET consents/overview (direction seule, isolation, sans PII).
    Invoke-Step "Bloc 7 ecran consentements" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc7-tests.ps1"))) $b7Count
    Invoke-Step "Bloc 8 mot de passe oublie" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc8-tests.ps1"))) $b8Count
    # t92 : ecarts CDC restants (selecteur de profil, sessions inactives, ...).
    Invoke-Step "Bloc 9 ecarts CDC" $root $ps ($psArgs + @((Join-Path $api "test/api/run-bloc9-tests.ps1"))) $b9Count
    # t62u B2 : harnais fournisseur S3 valide sur le S3 jetable (URL signee, expiration, SSE, refus, suppression).
    Invoke-Step "Harnais fournisseur S3 (jetable)" $root $ps ($psArgs + @((Join-Path $root "scripts/test-s3-provider.ps1"), "-Disposable")) $s3pCount
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $results.Add([pscustomobject]@{ Etape = "Arret anticipe"; Code = 99; Compteurs = $_.Exception.Message; Duree = 0; Journal = "" })
}
finally {
    if (-not $KeepContainer) {
        Invoke-Step "orya-test-s3 + orya-test-clamav (suppression)" $root $ps ($psArgs + @((Join-Path $root "scripts/test-files-down.ps1")))
        Remove-Item Env:CLAMAV_HOST, Env:CLAMAV_PORT -ErrorAction SilentlyContinue
        Invoke-Step "orya-test-pg (suppression)" $root $ps ($psArgs + @((Join-Path $root "scripts/test-pg-down.ps1")))
        # Filet : orya-test-fd est deja supprime par son script ; ignore s'il est absent.
        $env:ORYA_TEST_CONTAINER = "orya-test-fd"; & $ps @($psArgs + @((Join-Path $root "scripts/test-pg-down.ps1"))) *> $null; Remove-Item Env:ORYA_TEST_CONTAINER -ErrorAction SilentlyContinue
    }
}

$failed = @($results | Where-Object { $_.Code -ne 0 })
Write-Host ""
Write-Host "=== RECAPITULATIF verify-all ($(git -C $root rev-parse --short HEAD)) ===" -ForegroundColor Cyan
$results | Format-Table Etape, Code, Compteurs, Duree -AutoSize | Out-String -Width 200 | Write-Host
Write-Host ("Duree totale : {0} s ; journaux : {1}" -f [int]((Get-Date) - $started).TotalSeconds, $logs)
if ($failed.Count -gt 0) {
    Write-Host ("VERIFY-ALL : ECHEC ({0} etape(s))" -f $failed.Count) -ForegroundColor Red
    exit 1
}
Write-Host "VERIFY-ALL : OK" -ForegroundColor Green
exit 0
