# =============================================================================
# ORYA - Bloc 8 (t87u) : mot de passe oublie / reinitialisation par e-mail (F01).
# Base jetable orya_bloc8 sur orya-test-pg uniquement (garde scripts/test-guard.ps1).
# Boite d'envoi locale (OutboxFileMailer, MAIL_OUTBOX_DIR temporaire) : aucun envoi reel.
# Verifie : reponse identique compte connu / inconnu, jeton hache en base, RLS de la table,
# plafonds par compte et par IP, usage unique, expiration, jeton etranger, politique de mot
# de passe, revocation de toutes les sessions, audit, aucune donnee personnelle ni jeton
# dans les journaux, echec ferme en production sans fournisseur.
# SEED_PASSWORD : genere ici, jamais affiche.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc8"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B8 OK - $Label" } else { $script:ko++; Write-Host "  B8 KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }
function Sha256Hex([string]$s) { $h=[Security.Cryptography.SHA256]::Create(); (-join ($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString("x2") })) }

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3293
$apiProc=$null
$saved=@{}
$keys=@("DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","STORAGE_LOCAL_DIR","ACCOUNT_DELETION_JOB_DISABLED","APPLY_ROLES","DELETION_REGISTER_HMAC_KEY","DELETION_REGISTER_JOURNAL","AUTH_LOGIN_LIMIT","SEED_PASSWORD","MAIL_OUTBOX_DIR","PASSWORD_RESET_IP_LIMIT","PASSWORD_RESET_ACCOUNT_LIMIT","PASSWORD_RESET_CONFIRM_IP_LIMIT","WEB_ORIGIN","API_RATE_LIMIT")
foreach ($k in $keys) { $saved[$k]=[Environment]::GetEnvironmentVariable($k) }
function Psql([string]$DbName,[string]$Sql){ $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 }
$outbox = Join-Path $env:TEMP ("orya-b8-outbox-" + (Rand 6))
$base = "http://127.0.0.1:$port/api/v1"

function Api([string]$Method,[string]$Path,$Body=$null,[string]$Token="",[string]$Ip=""){
    if(-not $Ip){ $Ip = "198.51.100.$(Get-Random -Minimum 1 -Maximum 250)" }
    $h=@{ "X-Forwarded-For" = $Ip }
    if($Token){ $h.Authorization="Bearer $Token" }
    try {
        if($null -eq $Body){ $r=Invoke-WebRequest -Method $Method -Uri "$base$Path" -Headers $h -UseBasicParsing }
        else { $r=Invoke-WebRequest -Method $Method -Uri "$base$Path" -Headers $h -ContentType "application/json" -Body ($Body|ConvertTo-Json) -UseBasicParsing }
        return [pscustomobject]@{ StatusCode=[int]$r.StatusCode; Content=$r.Content }
    } catch {
        $resp=$_.Exception.Response; $code=if($resp){[int]$resp.StatusCode}else{0}
        $text=""; if($_.ErrorDetails -and $_.ErrorDetails.Message){ $text=$_.ErrorDetails.Message } elseif($resp){ try { $text=(New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
        return [pscustomobject]@{ StatusCode=$code; Content=$text }
    }
}
function Mails([string]$To){ ,@(Get-ChildItem $outbox -Filter *.json -EA SilentlyContinue | Sort-Object Name | ForEach-Object { Get-Content $_.FullName -Raw | ConvertFrom-Json } | Where-Object { $_.to -eq $To }) }
function TokenOf($Mail){ $m=[regex]::Match($Mail.text,'#token=(\S+)'); if($m.Success){ [Uri]::UnescapeDataString($m.Groups[1].Value) } else { "" } }
function Login([string]$Email,[string]$Password){ Api POST "/auth/login" @{ email=$Email; password=$Password } }

try {
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db WITH (FORCE); CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db"
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw=Rand; $appPw=Rand
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $env:DIRECT_DATABASE_URL="postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL="postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DELETION_REGISTER_HMAC_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:DELETION_REGISTER_JOURNAL=Join-Path $env:TEMP ("orya-b8-register-" + (Rand 6) + ".jsonl")
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"
    $env:SEED_PASSWORD = "Ot-" + (Rand 20) + "-A9!"
    $env:NODE_ENV="development"
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy (dont 20261115100000_password_reset)"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS (010_rls.sql)"
        & npx tsx prisma/seed.ts *> $null; Check ($LASTEXITCODE -eq 0) "seed (comptes de demonstration)"
    } finally { Pop-Location }
    $rls = Psql $db "SELECT relrowsecurity::text || '/' || relforcerowsecurity::text FROM pg_class WHERE relname='PasswordResetToken';"
    Check ($rls -eq "true/true") "S0: PasswordResetToken en RLS forcee ($rls)"

    $env:API_PORT="$port"; $env:AUTH_LOGIN_LIMIT="200"; $env:API_RATE_LIMIT="5000"
    $env:MAIL_OUTBOX_DIR=$outbox; $env:PASSWORD_RESET_IP_LIMIT="6"; $env:PASSWORD_RESET_ACCOUNT_LIMIT="3"; $env:PASSWORD_RESET_CONFIRM_IP_LIMIT="50"
    $env:WEB_ORIGIN="http://127.0.0.1:3199"
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:STORAGE_LOCAL_DIR=Join-Path $env:TEMP "orya-b8-storage"
    New-Item -ItemType Directory -Force -Path $env:STORAGE_LOCAL_DIR | Out-Null
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b8-api.out" -RedirectStandardError "$env:TEMP\orya-b8-api.err"
    $ready=$false
    for($i=0;$i -lt 40;$i++){ Start-Sleep 1; try { if((Invoke-WebRequest "$base/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ $ready=$true; break } } catch {} }
    Check $ready "API up :$port"
    if(-not $ready){ throw "API down" }

    $userA="parent1@ecole-a.orya.test"; $userB="parent2@ecole-a.orya.test"
    # --- F : demande (anti-enumeration, boite d'envoi, jeton hache) ---------------
    $unknown = Api POST "/auth/password/forgot" @{ email="personne.inconnue@ecole-a.orya.test" }
    $known = Api POST "/auth/password/forgot" @{ email=$userA }
    Check ($unknown.StatusCode -eq 202 -and $known.StatusCode -eq 202 -and $unknown.Content -eq $known.Content) "F0: meme reponse (202, corps identique) compte inconnu / connu"
    $pending = Api POST "/auth/password/forgot" @{ email="direction@ecole-c.orya.test" }
    Check ($pending.StatusCode -eq 202 -and $pending.Content -eq $known.Content) "F1: compte d'une ecole en attente : meme reponse"
    $mA = Mails $userA
    Check ($mA.Count -eq 1 -and (Mails "personne.inconnue@ecole-a.orya.test").Count -eq 0) "F2: un seul e-mail, pour le compte connu uniquement (connu=$($mA.Count), inconnu=$((Mails "personne.inconnue@ecole-a.orya.test").Count))"
    $tokA = TokenOf $mA[0]
    Check ($tokA -match '^r1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$' -and $mA[0].text -match 'http://127\.0\.0\.1:3199/nouveau-mot-de-passe#token=') "F3: lien = WEB_ORIGIN/nouveau-mot-de-passe#token=r1.<id>.<secret 256 bits> (fragment)"
    $hashA = Sha256Hex $tokA
    $rowA = Psql $db "SELECT count(*) FROM `"PasswordResetToken`" WHERE `"tokenHash`"='$hashA' AND `"usedAt`" IS NULL AND `"expiresAt`" BETWEEN now() + interval '29 minutes' AND now() + interval '31 minutes';"
    $plain = Psql $db "SELECT count(*) FROM `"PasswordResetToken`" WHERE `"tokenHash`" LIKE 'r1.%' OR `"tokenHash`" = '$tokA';"
    Check ($rowA -eq "1" -and $plain -eq "0") "F4: SHA-256 seul en base, expiration ~30 min"
    $asApp = Psql $db "SET ROLE orya_app; SELECT count(*) FROM `"PasswordResetToken`";"
    Check (($asApp | Select-Object -Last 1) -eq "0") "F5: orya_app sans contexte d'identite ne voit aucun jeton (RLS)"

    # --- L : plafonds -------------------------------------------------------------
    $r1 = Api POST "/auth/password/forgot" @{ email=$userA }; $r2 = Api POST "/auth/password/forgot" @{ email=$userA }; $r3 = Api POST "/auth/password/forgot" @{ email=$userA }
    $countA = Psql $db "SELECT count(*) FROM `"PasswordResetToken`" t JOIN `"User`" u ON u.id=t.`"userId`" WHERE u.email='$userA';"
    Check ($r3.StatusCode -eq 202 -and $r3.Content -eq $known.Content -and $countA -eq "3" -and (Mails $userA).Count -eq 3) "L0: plafond par compte (3/h) : 4e demande meme reponse, aucun jeton ni e-mail de plus"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.password.reset_throttled';")) -ge 1) "L1: plafond par compte audite (reset_throttled)"
    $ip = "203.0.113.77"; $codes=@()
    for($i=0;$i -lt 7;$i++){ $codes += (Api POST "/auth/password/forgot" @{ email="x$i@exemple.invalid" } "" $ip).StatusCode }
    $other = Api POST "/auth/password/forgot" @{ email="y@exemple.invalid" } "" "203.0.113.78"
    Check (($codes[0..5] | Where-Object { $_ -ne 202 }).Count -eq 0 -and $codes[6] -eq 429 -and $other.StatusCode -eq 202) "L2: plafond par IP (6/min) : 7e demande -> 429, autre IP non bloquee"

    # --- R : confirmation ---------------------------------------------------------
    $tokA = TokenOf ((Mails $userA)[-1])
    $sess = Login $userA $env:SEED_PASSWORD
    $at = ($sess.Content | ConvertFrom-Json).accessToken
    Check ($sess.StatusCode -eq 200 -and $at -and (Api GET "/me" $null $at).StatusCode -eq 200) "R0: session ouverte avant reinitialisation"
    $weak = Api POST "/auth/password/reset" @{ token=$tokA; newPassword="court" }
    $weak2 = Api POST "/auth/password/reset" @{ token=$tokA; newPassword=$env:SEED_PASSWORD }
    Check ($weak.StatusCode -eq 400 -and $weak.Content -match '12' -and $weak2.StatusCode -eq 400 -and $weak2.Content -match 'different') "R1: politique ebe40ca appliquee (trop court ; identique a l'actuel) -> 400 ($($weak.StatusCode) $($weak.Content) | $($weak2.StatusCode) $($weak2.Content))"
    Check ((Psql $db "SELECT count(*) FROM `"PasswordResetToken`" WHERE `"tokenHash`"='$(Sha256Hex $tokA)' AND `"usedAt`" IS NULL;") -eq "1") "R2: un refus de politique ne consomme pas le jeton"
    $newPw = "Nouveau-Mdp-" + (Rand 4) + "-K9!"
    $okR = Api POST "/auth/password/reset" @{ token=$tokA; newPassword=$newPw }
    $okJ = $okR.Content | ConvertFrom-Json
    Check ($okR.StatusCode -eq 200 -and $okJ.ok -and $okJ.revokedSessions -ge 1 -and $null -eq $okJ.accessToken) "R3: reinitialisation 200, sessions revoquees ($($okJ.revokedSessions)), aucun jeton de session emis"
    Check ((Api GET "/me" $null $at).StatusCode -eq 401) "R4: ancienne session refusee (401)"
    Check ((Login $userA $env:SEED_PASSWORD).StatusCode -eq 401 -and (Login $userA $newPw).StatusCode -eq 200) "R5: ancien mot de passe refuse, nouveau accepte"
    $reuse = Api POST "/auth/password/reset" @{ token=$tokA; newPassword=("Autre-Mdp-" + (Rand 4) + "-Z7?") }
    Check ($reuse.StatusCode -eq 400) "R6: jeton reutilise -> 400"
    Check ((Psql $db "SELECT count(*) FROM `"PasswordResetToken`" t JOIN `"User`" u ON u.id=t.`"userId`" WHERE u.email='$userA' AND t.`"usedAt`" IS NULL;") -eq "0") "R7: les autres jetons du compte sont invalides"

    # Jeton expire (compte B).
    $null = Api POST "/auth/password/forgot" @{ email=$userB }
    $tokB = TokenOf ((Mails $userB)[-1])
    $null = Psql $db "UPDATE `"PasswordResetToken`" SET `"expiresAt`" = now() - interval '1 minute' WHERE `"tokenHash`"='$(Sha256Hex $tokB)';"
    $exp = Api POST "/auth/password/reset" @{ token=$tokB; newPassword=("Expire-Mdp-" + (Rand 4) + "-Q2!") }
    Check ($exp.StatusCode -eq 400 -and (Login $userB $env:SEED_PASSWORD).StatusCode -eq 200) "R8: jeton expire -> 400, mot de passe inchange"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.password.reset_failed' AND metadata->>'reason' IN ('expired','used');")) -ge 2) "R9: echecs (expire, reutilise) audites"
    # Jeton etranger : secret valide de B presente avec l'identifiant de A (et inversement).
    $null = Api POST "/auth/password/forgot" @{ email=$userB } "" "198.51.100.251"
    $tokB2 = TokenOf ((Mails $userB)[-1])
    $idA = Psql $db "SELECT id FROM `"User`" WHERE email='$userA';"
    $forged = "r1.$idA." + $tokB2.Split(".")[2]
    $f1 = Api POST "/auth/password/reset" @{ token=$forged; newPassword=("Etranger-Mdp-" + (Rand 4) + "-W3!") }
    $f2 = Api POST "/auth/password/reset" @{ token="r1.not-a-uuid.abc"; newPassword=("Etranger-Mdp-" + (Rand 4) + "-W3!") }
    Check ($f1.StatusCode -eq 400 -and $f2.StatusCode -eq 400 -and (Login $userA $newPw).StatusCode -eq 200) "R10: jeton etranger (identifiant d'un autre compte) ou malforme -> 400, aucun effet"
    $okB = Api POST "/auth/password/reset" @{ token=$tokB2; newPassword=("Valide-Mdp-" + (Rand 4) + "-B8!") }
    Check ($okB.StatusCode -eq 200) "R11: le jeton authentique de B reste utilisable apres la tentative etrangere"

    # --- A / P : audit, journaux, production -----------------------------------
    $meta = Psql $db "SELECT coalesce(string_agg(metadata::text, ' '), '') FROM `"AuditLog`" WHERE action LIKE 'auth.password.%';"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.password.reset' AND severity='critical';")) -eq 2 -and $meta -notmatch '@|r1\.|Mdp') "A0: reinitialisation auditee (critical), audit sans e-mail, jeton ni mot de passe"
    $hit = Select-String -Path "$env:TEMP\orya-b8-api.out","$env:TEMP\orya-b8-api.err" -Pattern $userA,$userB,"r1.",$newPw,$env:SEED_PASSWORD -SimpleMatch -EA SilentlyContinue
    Check (-not $hit) "A1: ni e-mail, ni jeton, ni mot de passe dans les journaux API"
    Push-Location $apiRoot
    try {
        $prod = (& npx tsx -e "import('./src/mail/mailer').then(async (m) => { const x = m.createMailer({ NODE_ENV: 'production', MAIL_OUTBOX_DIR: 'C:/should-not-be-used' } as any); let refused = false; try { await x.send({ to: 'a@b.c', subject: 's', text: 't', kind: 'k' }); } catch (e) { refused = e instanceof m.MailerNotConfiguredError; } console.log(JSON.stringify({ name: x.name, configured: x.configured, refused })); })" 2>&1 | Select-Object -Last 1)
    } finally { Pop-Location }
    Check ($prod -eq '{"name":"none","configured":false,"refused":true}') "P0: production sans fournisseur -> DisabledMailer (boite locale refusee), envoi refuse ($prod)"
    $svc = Get-Content -Raw (Join-Path $apiRoot "src/auth/password-reset.service.ts")
    Check ($svc -match 'if \(!this\.mailer\.configured\)\s*\{\s*throw new ServiceUnavailableException' ) "P1: demande refusee (503) avant toute recherche de compte quand aucun fournisseur n'est configure"
}
catch {
    $script:ko++; Write-Host "  B8 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    if ($env:DELETION_REGISTER_JOURNAL -and $env:DELETION_REGISTER_JOURNAL -like "*orya-b8-register-*") { Remove-Item $env:DELETION_REGISTER_JOURNAL -EA SilentlyContinue }
    if ($outbox -like "*orya-b8-outbox-*") { Remove-Item -LiteralPath $outbox -Recurse -Force -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC8 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0