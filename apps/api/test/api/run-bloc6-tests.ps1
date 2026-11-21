# =============================================================================
# ORYA - Bloc 6 (t62u) : trous connus et pre-production, sur orya-test-pg UNIQUEMENT (base orya_bloc6).
#   P : changement de mot de passe (A1) : mot de passe actuel, politique, revocation des autres
#       sessions, audit, limitation de debit, exemption de la suspension d'ecole.
#   S : test de fumee de pre-production (B4, scripts/preprod-smoke.ps1) contre cette API locale :
#       sante + migrations, connexion, export (job actif, ClamAV jetable), suppression (compte consomme).
#   W : journal des suppressions WORM (B3) sur le S3 JETABLE orya-test-s3 : bucket Object Lock
#       COMPLIANCE, identifiants d'ecriture seule / lecture seule distincts, echec ferme,
#       rejeu apres restauration d'une sauvegarde sans fichier local, fichier local altere.
# Mot de passe et secrets generes, jamais affiches. Donnees FICTIVES de test.
# Les refus sont testes dans CETTE session (appels &, fonction trap), jamais via powershell -File.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc6"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B6 OK - $Label" } else { $script:ko++; Write-Host "  B6 KO - $Label" -ForegroundColor Red }
}
# Toute erreur non prevue compte comme un echec (et n'interrompt pas la suite).
trap { $script:ko++; Write-Host "  B6 KO - erreur inattendue : $($_.Exception.Message)" -ForegroundColor Red; continue }
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3291
$apiProc=$null
$keys=@("DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","APPLY_ROLES","ACCOUNT_DELETION_JOB_DISABLED","FILE_RETENTION_JOB_DISABLED","DATA_EXPORT_JOB_DISABLED","SCHOOL_BILLING_JOB_DISABLED",
  "STORAGE_LOCAL_DIR","ORYA_B6_PASSWORD","ORYA_T_BASE","AUTH_LOGIN_LIMIT","API_RATE_LIMIT","PASSWORD_CHANGE_LIMIT","ORYA_TOTP_SECRET",
  "DELETION_REGISTER_HMAC_KEY","DELETION_REGISTER_JOURNAL","DELETION_JOURNAL_WORM_BUCKET","DELETION_JOURNAL_WORM_ENDPOINT","DELETION_JOURNAL_WORM_FORCE_PATH_STYLE",
  "DELETION_JOURNAL_WORM_WRITER_ACCESS_KEY_ID","DELETION_JOURNAL_WORM_WRITER_SECRET_ACCESS_KEY","DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID","DELETION_JOURNAL_WORM_READER_SECRET_ACCESS_KEY",
  "ORYA_T_S3_ADMIN_ID","ORYA_T_S3_ADMIN_SECRET","STORAGE_S3_ACCESS_KEY_ID","STORAGE_S3_BUCKET",
  "DATA_EXPORT_JOB_MS","CLAMAV_HOST","CLAMAV_PORT","ORYA_SMOKE_EXPORT_EMAIL","ORYA_SMOKE_EXPORT_PASSWORD","ORYA_SMOKE_DELETE_EMAIL","ORYA_SMOKE_DELETE_PASSWORD")
$saved=@{}; foreach ($k in $keys) { $saved[$k]=[Environment]::GetEnvironmentVariable($k) }
function Psql([string]$DbName,[string]$Sql){ $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 }
function KeyOf([string]$Sql){ return ("" + (Psql $db $Sql)).Trim() }
function J($r){ return ($r.Content | ConvertFrom-Json -EA SilentlyContinue) }

$script:totp=@{}
function Get-Totp([string]$Secret){
    $env:ORYA_TOTP_SECRET=$Secret
    Push-Location $apiRoot; try { return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_TOTP_SECRET))").Trim() } finally { Pop-Location; Remove-Item Env:ORYA_TOTP_SECRET -EA SilentlyContinue }
}
function Api([string]$Method,[string]$Path,[string]$Token,$Body=$null){
    $h=@{}; if($Token){ $h.Authorization="Bearer $Token" }
    try {
        if($null -eq $Body){ $r=Invoke-WebRequest -Method $Method -Uri "$($env:ORYA_T_BASE)$Path" -Headers $h -UseBasicParsing }
        else { $r=Invoke-WebRequest -Method $Method -Uri "$($env:ORYA_T_BASE)$Path" -Headers $h -ContentType "application/json" -Body ($Body|ConvertTo-Json -Depth 5) -UseBasicParsing }
        return [pscustomobject]@{ StatusCode=[int]$r.StatusCode; Content=$r.Content }
    } catch {
        $resp=$_.Exception.Response; $code=if($resp){[int]$resp.StatusCode}else{0}
        $text=""; if($_.ErrorDetails -and $_.ErrorDetails.Message){ $text=$_.ErrorDetails.Message }; if(-not $text -and $resp){ $text=(New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
        return [pscustomobject]@{ StatusCode=$code; Content=$text }
    }
}
# Connexion complete (MFA : enrolement au premier passage, verification ensuite). Renvoie l'objet de session.
function LoginFull([string]$Email,[string]$Password){
    $r = Api POST "/auth/login" "" @{ email=$Email; password=$Password }
    if($r.StatusCode -ne 200){ return [pscustomobject]@{ StatusCode=$r.StatusCode; accessToken=$null; refreshToken=$null } }
    $j = J $r
    if(-not $j.mfaRequired){ return [pscustomobject]@{ StatusCode=200; accessToken=$j.accessToken; refreshToken=$j.refreshToken } }
    if($j.method -eq "enroll"){
        $en = J (Api POST "/auth/mfa/enroll" "" @{ challengeToken=$j.challengeToken })
        $script:totp[$Email] = $en.secret
    } else {
        # Anti-rejeu : un pas TOTP deja consomme est refuse, on attend le suivant.
        Start-Sleep -Seconds (31 - ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % 30))
    }
    $v = J (Api POST "/auth/mfa/verify" "" @{ challengeToken=$j.challengeToken; code=(Get-Totp $script:totp[$Email]) })
    return [pscustomobject]@{ StatusCode=200; accessToken=$v.accessToken; refreshToken=$v.refreshToken }
}

try {
    if(Get-NetTCPConnection -State Listen -LocalPort $port -EA SilentlyContinue){ throw "Port $port occupe" }
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db WITH (FORCE); CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db"
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw=Rand; $appPw=Rand
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $env:DIRECT_DATABASE_URL="postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL="postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"; $env:FILE_RETENTION_JOB_DISABLED="1"; $env:DATA_EXPORT_JOB_DISABLED="1"; $env:SCHOOL_BILLING_JOB_DISABLED="1"
    $env:AUTH_LOGIN_LIMIT="200"; $env:API_RATE_LIMIT="2000"; $env:PASSWORD_CHANGE_LIMIT="12"
    $env:ORYA_B6_PASSWORD = Rand 16
    $env:STORAGE_LOCAL_DIR=Join-Path $env:TEMP "orya-b6-storage"; New-Item -ItemType Directory -Force -Path $env:STORAGE_LOCAL_DIR | Out-Null
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS + declencheurs"
        $seedOut = & npx tsx test/api/seed-bloc6.ts 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 0) "seed bloc 6"
    } finally { Pop-Location }
    $ids = ($seedOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json

    # B3 : journal des suppressions (cle HMAC hors base, fichier local, copie WORM sur orya-test-s3).
    $env:DELETION_REGISTER_HMAC_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:DELETION_REGISTER_JOURNAL=Join-Path $env:TEMP ("orya-b6-register-" + (Rand 6) + ".jsonl")
    $s3Json = (& docker container inspect -f '{{json .Config.Labels}}' orya-test-s3 2>$null) -join ""
    $s3Ok = ($LASTEXITCODE -eq 0 -and $s3Json -and ("" + ($s3Json | ConvertFrom-Json).'created-by') -eq "orya-test")
    Check $s3Ok "W0: S3 jetable orya-test-s3 present (label created-by=orya-test)"
    if(-not $s3Ok){ throw "orya-test-s3 absent : scripts/test-files-up.ps1 -Only s3" }
    $env:ORYA_T_S3_ADMIN_ID=("" + (& docker exec orya-test-s3 printenv AWS_ACCESS_KEY_ID 2>$null)).Trim()
    $env:ORYA_T_S3_ADMIN_SECRET=("" + (& docker exec orya-test-s3 printenv AWS_SECRET_ACCESS_KEY 2>$null)).Trim()
    $env:DELETION_JOURNAL_WORM_BUCKET="orya-test-worm-" + (Rand 4)
    $env:DELETION_JOURNAL_WORM_ENDPOINT="http://127.0.0.1:55435"; $env:DELETION_JOURNAL_WORM_FORCE_PATH_STYLE="1"
    $wId="oryaw" + (Rand 8); $wSec=Rand 24; $rId="oryar" + (Rand 8); $rSec=Rand 24
    # Identites du conteneur jetable : commandes par l'entree standard de "weed shell" (jamais en
    # argument de docker), sortie jetee (elle reprend les cles).
    $shellCmds = "s3.configure -user=orya-journal-writer -access_key=$wId -secret_key=$wSec -buckets=$($env:DELETION_JOURNAL_WORM_BUCKET) -actions=Write -apply`n" +
                 "s3.configure -user=orya-journal-reader -access_key=$rId -secret_key=$rSec -buckets=$($env:DELETION_JOURNAL_WORM_BUCKET) -actions=Read,List -apply`n"
    $null = $shellCmds | & docker exec -i orya-test-s3 weed shell 2>&1
    $shellRc = $LASTEXITCODE; Remove-Variable shellCmds
    Push-Location $apiRoot
    try { $su = & node test/api/b6-worm.mjs setup 1 2>&1 | Out-String } finally { Pop-Location }
    $suj = ($su.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json -EA SilentlyContinue
    Check ($shellRc -eq 0 -and $suj.ok -and $suj.lock -eq "Enabled" -and $suj.mode -eq "COMPLIANCE") "W0: bucket WORM (Object Lock, retention par defaut COMPLIANCE) + identites ecriture seule / lecture seule"
    Start-Sleep -Seconds 3
    # L'API et le job n'ont QUE les identifiants d'ecriture ; la lecture est reservee au rejeu.
    $env:DELETION_JOURNAL_WORM_WRITER_ACCESS_KEY_ID=$wId; $env:DELETION_JOURNAL_WORM_WRITER_SECRET_ACCESS_KEY=$wSec

    # B4 : job d'export actif (1 s) pour le test de fumee ; antivirus = ClamAV JETABLE.
    $clJson = (& docker container inspect -f '{{json .Config.Labels}}' orya-test-clamav 2>$null) -join ""
    $clOk = ($LASTEXITCODE -eq 0 -and $clJson -and ("" + ($clJson | ConvertFrom-Json).'created-by') -eq "orya-test")
    Check $clOk "S0: ClamAV jetable orya-test-clamav present (label created-by=orya-test)"
    if(-not $clOk){ throw "orya-test-clamav absent : scripts/test-files-up.ps1 -Only clamav" }
    $env:CLAMAV_HOST="127.0.0.1"; $env:CLAMAV_PORT="55436"
    $env:DATA_EXPORT_JOB_DISABLED="0"; $env:DATA_EXPORT_JOB_MS="1000"
    $env:API_PORT="$port"; $env:NODE_ENV="development"
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b6-api.out" -RedirectStandardError "$env:TEMP\orya-b6-api.err"
    $ready=$false
    for($i=0;$i -lt 40;$i++){ Start-Sleep 1; try { if((Invoke-WebRequest "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ $ready=$true; break } } catch {} }
    Check $ready "API up :$port"
    if(-not $ready){ throw "API down" }
    $env:ORYA_T_BASE = "http://127.0.0.1:$port/api/v1"
    $pw0 = $env:ORYA_B6_PASSWORD

    # ===== P : changement de mot de passe (A1) =====
    $sA = LoginFull "parent.b6@orya.test" $pw0; $sB = LoginFull "parent.b6@orya.test" $pw0
    Check ($sA.accessToken -and $sB.accessToken -and $sB.refreshToken) "P0: deux sessions du meme responsable (A courante, B autre appareil)"
    $hash0 = KeyOf "SELECT `"passwordHash`" FROM `"User`" WHERE id='$($ids.parent)';"
    Check ((Api POST "/me/password" "" @{ currentPassword=$pw0; newPassword="Xy-" + (Rand 6) + "-Q9!" }).StatusCode -eq 401) "P1: sans authentification -> 401"
    $bad = Api POST "/me/password" $sA.accessToken @{ currentPassword=("faux-" + (Rand 6)); newPassword="Xy-" + (Rand 6) + "-Q9!" }
    Check ($bad.StatusCode -eq 401 -and [int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.password.change_failed' AND `"actorId`"='$($ids.parent)';") -eq 1) "P2: mot de passe actuel faux -> 401, echec audite (warning)"
    $p3a = Api POST "/me/password" $sA.accessToken @{ currentPassword=$pw0; newPassword="Ab1!court" }
    $p3b = Api POST "/me/password" $sA.accessToken @{ currentPassword=$pw0; newPassword="uniquementdesminuscules" }
    $p3c = Api POST "/me/password" $sA.accessToken @{ currentPassword=$pw0; newPassword=$pw0 }
    $p3d = Api POST "/me/password" $sA.accessToken @{ currentPassword=$pw0; newPassword="Parent.B6-2026-Zz!" }
    $p3e = Api POST "/me/password" $sA.accessToken @{ currentPassword=$pw0; newPassword="Azerty2026!!" }
    Check ($p3a.StatusCode -eq 400 -and $p3a.Content -match '12') "P3: moins de 12 caracteres -> 400"
    Check ($p3b.StatusCode -eq 400 -and $p3b.Content -match 'familles') "P3: une seule famille de caracteres -> 400"
    Check ($p3c.StatusCode -eq 400 -and $p3c.Content -match 'different') "P3: identique a l'actuel -> 400"
    Check ($p3d.StatusCode -eq 400 -and $p3d.Content -match 'e-mail') "P3: contient l'adresse e-mail -> 400"
    Check ($p3e.StatusCode -eq 400 -and $p3e.Content -match 'courant') "P3: mot trivial (azerty + chiffres) -> 400"
    Check ((KeyOf "SELECT `"passwordHash`" FROM `"User`" WHERE id='$($ids.parent)';") -eq $hash0) "P3: refus -> mot de passe inchange"
    $sC = LoginFull "parent.b6@orya.test" $pw0
    Check ([bool]$sC.accessToken) "P3: l'ancien mot de passe fonctionne encore apres les refus (session C)"
    $pw1 = "Nv-" + (Rand 8) + "-Zz9!"
    $ch = Api POST "/me/password" $sA.accessToken @{ currentPassword=$pw0; newPassword=$pw1 }
    Check ($ch.StatusCode -eq 200 -and [int](J $ch).revokedSessions -eq 2) "P4: changement accepte (200), 2 autres sessions revoquees (B et C)"
    Check ((Api GET "/me" $sB.accessToken).StatusCode -eq 401 -and (Api GET "/me" $sC.accessToken).StatusCode -eq 401) "P5: jetons d'acces des autres sessions refuses immediatement (401)"
    Check ((Api POST "/auth/refresh" "" @{ refreshToken=$sB.refreshToken }).StatusCode -eq 401) "P5: jeton de rafraichissement d'une autre session refuse (401)"
    Check ((Api GET "/me" $sA.accessToken).StatusCode -eq 200) "P5: la session courante reste ouverte"
    Check ((LoginFull "parent.b6@orya.test" $pw0).StatusCode -eq 401) "P6: ancien mot de passe refuse a la connexion (401)"
    $sD = LoginFull "parent.b6@orya.test" $pw1
    Check ([bool]$sD.accessToken) "P6: nouveau mot de passe accepte a la connexion"
    $hash1 = KeyOf "SELECT `"passwordHash`" FROM `"User`" WHERE id='$($ids.parent)';"
    Check ($hash1 -ne $hash0 -and $hash1.StartsWith('$argon2id$')) "P7: nouveau hash Argon2id"
    Check ((KeyOf "SELECT count(*) || '/' || max(severity::text) FROM `"AuditLog`" WHERE action='auth.password.changed' AND `"actorId`"='$($ids.parent)';") -eq "1/critical") "P8: changement audite (critical, auteur = titulaire du compte)"
    $auditText = KeyOf "SELECT coalesce(string_agg(coalesce(metadata::text,''), ' '), '') FROM `"AuditLog`" WHERE action LIKE 'auth.password.%';"
    Check (-not $auditText.Contains($pw0) -and -not $auditText.Contains($pw1)) "P8: aucun mot de passe dans l'audit"
    Check ([int](KeyOf "SELECT count(*) FROM `"Device`" WHERE `"userId`"='$($ids.parent)' AND status='active';") -eq 2) "P8: sessions actives = courante A + nouvelle connexion D"

    # P9 : suspension de l'ecole -> lecture seule, mais le changement de mot de passe reste possible.
    $dir = LoginFull "dir.b6@orya.test" $pw0
    $tea = LoginFull "teacher.b6@orya.test" $pw0
    Check ($dir.accessToken -and $tea.accessToken) "P9: direction (MFA) et enseignant connectes"
    $null = Psql $db "UPDATE `"Subscription`" SET status='suspended' WHERE `"schoolId`"='$($ids.A)';"
    Check ((KeyOf "SELECT status FROM `"Subscription`" WHERE `"schoolId`"='$($ids.A)';") -eq "suspended") "P9: ecole suspendue (abonnement suspendu)"
    $tw = Api POST "/attendance/sessions" $tea.accessToken @{}
    Check ($tw.StatusCode -eq 403 -and $tw.Content -match 'SUBSCRIPTION_INACTIVE') "P9: suspendu -> ecriture ordinaire refusee (403 SUBSCRIPTION_INACTIVE)"
    $pwD = "Dir-" + (Rand 8) + "-Kq7!"
    $dc = Api POST "/me/password" $dir.accessToken @{ currentPassword=$pw0; newPassword=$pwD }
    Check ($dc.StatusCode -eq 200) "P9: suspendu -> changement de mot de passe direction accepte (HTTP $($dc.StatusCode))"
    $pw2 = "Nv2-" + (Rand 8) + "-Yy8!"
    $pc = Api POST "/me/password" $sA.accessToken @{ currentPassword=$pw1; newPassword=$pw2 }
    Check ($pc.StatusCode -eq 200 -and [int](J $pc).revokedSessions -eq 1) "P9: suspendu -> changement de mot de passe responsable accepte, session D revoquee"
    Check ([bool](LoginFull "parent.b6@orya.test" $pw2).accessToken) "P9: suspendu -> connexion avec le nouveau mot de passe"
    $null = Psql $db "UPDATE `"Subscription`" SET status='active' WHERE `"schoolId`"='$($ids.A)';"

    # P10 : limitation de debit (PASSWORD_CHANGE_LIMIT=12 par minute et par IP sur cette route).
    $before = [int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.password.change_failed';")
    $codes = @(); for($i=0;$i -lt 14;$i++){ $codes += (Api POST "/me/password" $tea.accessToken @{ currentPassword=("faux-" + (Rand 4)); newPassword="Xy-" + (Rand 6) + "-Q9!" }).StatusCode }
    $after = [int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.password.change_failed';")
    $n429 = @($codes | Where-Object { $_ -eq 429 }).Count
    Check ($n429 -ge 1 -and @($codes | Where-Object { $_ -ne 401 -and $_ -ne 429 }).Count -eq 0) "P10: rafale de 14 essais -> 429 au-dela de la limite ($n429 x 429 ; statuts $($codes -join ','))"
    Check (($after - $before) -eq (14 - $n429)) "P10: les essais limites (429) n'atteignent pas la verification du mot de passe"

    # ===== W : journal des suppressions WORM (B3) =====
    function LastJson([string]$o){ $l = ($o.Trim().Split("`n") | Select-Object -Last 1); try { return ($l | ConvertFrom-Json) } catch { return $null } }
    function Job([string]$At){ Push-Location $apiRoot; try { $o = & npx tsx prisma/run-deletion-job.ts "--at=$At" 2>&1 | Out-String; return [pscustomobject]@{ Rc=$LASTEXITCODE; Out=$o; J=(LastJson $o) } } finally { Pop-Location } }
    function Worm([string]$Cmd){ Push-Location $apiRoot; try { $o = & node test/api/b6-worm.mjs $Cmd 2>&1 | Out-String; return (LastJson $o) } finally { Pop-Location } }
    function Replay(){ Push-Location $apiRoot; try { $o = & npx tsx prisma/run-replay-register.ts 2>&1 | Out-String; return [pscustomobject]@{ Rc=$LASTEXITCODE; Out=$o; J=(LastJson $o) } } finally { Pop-Location } }
    $w1 = LoginFull "worm1.b6@orya.test" $pw0; $w2 = LoginFull "worm2.b6@orya.test" $pw0
    $d1 = Api POST "/me/deletion" $w1.accessToken @{ password=$pw0 }; $d2 = Api POST "/me/deletion" $w2.accessToken @{ password=$pw0 }
    Check ($d1.StatusCode -eq 202 -and $d2.StatusCode -eq 202) "W1: deux demandes de suppression de compte (202)"
    # Sauvegarde AVANT anonymisation (scenario de restauration W10).
    $null = & docker exec $c pg_dump -U $adm -Fc -d $db -f /tmp/orya-b6-before.dump 2>&1
    Check ($LASTEXITCODE -eq 0) "W2: sauvegarde de la base avant anonymisation (pg_dump dans le conteneur jetable)"
    $at = (Get-Date).ToUniversalTime().AddDays(20).ToString("o")
    $j1 = Job $at
    Check ($j1.Rc -eq 0 -and [int]$j1.J.processed -eq 2 -and [int]$j1.J.failed -eq 0) "W3: job d'anonymisation : 2 comptes anonymises"
    $st = Worm "stats"
    $localLines = @(Get-Content $env:DELETION_REGISTER_JOURNAL -EA SilentlyContinue)
    Check ([int]$st.versions -eq 2 -and [int]$st.keys -eq 2 -and [int]$st.locked -eq 2 -and [int]$st.sse -eq 2 -and $localLines.Count -eq 2) "W4: 2 objets WORM (verrou COMPLIANCE actif, SSE AES256) + 2 lignes locales"
    # Identifiants de lecture fournis au SEUL processus de sonde (le job et l'API ne les ont pas).
    $env:DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID=$rId; $env:DELETION_JOURNAL_WORM_READER_SECRET_ACCESS_KEY=$rSec
    $pw = Worm "probe-writer"
    Remove-Item Env:DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID, Env:DELETION_JOURNAL_WORM_READER_SECRET_ACCESS_KEY
    Check ([int]$pw.get -eq 403 -and [int]$pw.list -eq 403) "W5: identifiants d'ecriture : ni lecture (403) ni liste (403) du journal"
    Check ([int]$pw.deleteVersion -eq 403 -and [int]$pw.overwrite -eq 412) "W5: identifiants d'ecriture : suppression d'une version (403) et ecrasement (412) refuses"
    Check ([int]$pw.otherBucket -eq 403 -and [int]$pw.readerPut -eq 403 -and [int]$pw.readerDeleteVersion -eq 403) "W5: autre bucket existant refuse (403) ; identifiants de lecture : ni ecriture ni suppression (403) [$($pw.otherBucket)/$($pw.readerPut)/$($pw.readerDeleteVersion)]"
    $pa = Worm "probe-admin"
    Check ([int]$pa.deleteVersion -eq 403 -and [int]$pa.bypass -eq 403 -and [int]$pa.shorten -eq 403) "W6: meme l'administrateur du stockage : suppression d'une version, contournement, retention raccourcie refuses (403)"
    Check ([int]$pa.simpleDelete -eq 200 -and [int]$pa.versionsAfter -eq 2) "W6: suppression simple = marqueur seulement, les 2 versions verrouillees restent"
    # W7 : echec ferme si la copie WORM est impossible.
    $w3 = LoginFull "worm3.b6@orya.test" $pw0
    Check ((Api POST "/me/deletion" $w3.accessToken @{ password=$pw0 }).StatusCode -eq 202) "W7: troisieme demande de suppression (202)"
    $env:DELETION_JOURNAL_WORM_WRITER_SECRET_ACCESS_KEY = Rand 24
    $j2 = Job $at
    $env:DELETION_JOURNAL_WORM_WRITER_SECRET_ACCESS_KEY = $wSec
    Check ([int]$j2.J.processed -eq 0 -and [int]$j2.J.failed -eq 1 -and [int](KeyOf "SELECT count(*) FROM `"User`" WHERE email='worm3.b6@orya.test';") -eq 1 -and @(Get-Content $env:DELETION_REGISTER_JOURNAL).Count -eq 2) "W7: WORM injoignable (identifiants refuses) -> anonymisation annulee (compte intact, journal local inchange)"
    # W8 : identifiants WORM identiques a ceux du stockage des fichiers -> refuse.
    $env:STORAGE_S3_ACCESS_KEY_ID = $wId
    $j3 = Job $at
    Remove-Item Env:STORAGE_S3_ACCESS_KEY_ID -EA SilentlyContinue
    Check ([int]$j3.J.failed -eq 1 -and $j3.Out -match 'distincts') "W8: identifiants WORM = identifiants du stockage des fichiers -> refuse"
    $j4 = Job $at
    $st2 = Worm "stats"
    Check ([int]$j4.J.processed -eq 1 -and [int]$st2.versions -eq 3 -and [int]$st2.locked -eq 3 -and [int](KeyOf "SELECT count(*) FROM `"User`" WHERE email LIKE 'worm%.b6@orya.test';") -eq 0) "W9: configuration correcte -> 3e compte anonymise, 3 objets WORM verrouilles"
    # W10 : restauration de la sauvegarde d'AVANT les suppressions, fichier local PERDU, rejeu depuis le WORM.
    $rdb = "orya_bloc6_r"
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $rdb WITH (FORCE); CREATE DATABASE $rdb OWNER orya_owner;"
    $null = & docker exec $c pg_restore -U $adm -d $rdb --exit-on-error /tmp/orya-b6-before.dump 2>&1
    $restRc = $LASTEXITCODE
    Check ($restRc -eq 0 -and [int](("" + (Psql $rdb "SELECT count(*) FROM `"User`" WHERE email LIKE 'worm%.b6@orya.test';")).Trim()) -eq 3) "W10: sauvegarde restauree : les 3 comptes supprimes sont REVENUS (avant rejeu)"
    $keepJournal = $env:DELETION_REGISTER_JOURNAL; $keepUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $keepUrl.Replace("/${db}?", "/${rdb}?")
    Remove-Item Env:DELETION_REGISTER_JOURNAL
    $env:DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID=$rId; $env:DELETION_JOURNAL_WORM_READER_SECRET_ACCESS_KEY=$rSec
    $rp = Replay
    Check ($rp.Rc -eq 0 -and [int]$rp.J.restored -eq 3 -and [int]$rp.J.fixed -eq 3 -and $rp.J.sources.local -eq "non configure" -and [int]$rp.J.sources.worm.entries -eq 3 -and [int]$rp.J.sources.worm.locked -eq 3) "W10: rejeu SANS fichier local : 3 entrees lues dans le WORM (verrouillees), registre restaure, 3 comptes re-anonymises"
    Check ([int](("" + (Psql $rdb "SELECT count(*) FROM `"User`" WHERE email LIKE 'worm%.b6@orya.test';")).Trim()) -eq 0 -and [int](("" + (Psql $rdb "SELECT count(*) FROM `"DeletionRegister`";")).Trim()) -eq 3) "W10: base restauree : aucun compte supprime ne reapparait, registre = 3"
    Check ($rp.J.sources.worm.deleteMarkers -ge 1) "W10: le marqueur de suppression simple (W6) n'a rien fait disparaitre"
    # W11 : fichier local ALTERE + WORM -> rejeu accepte, alteration signalee.
    $tampered = "$keepJournal.tampered"
    $tl = @(Get-Content $keepJournal); $tl[0] = $tl[0] -replace '"kind":"[a-z_]+"','"kind":"self_x"'; [IO.File]::WriteAllLines($tampered, $tl)
    $env:DELETION_REGISTER_JOURNAL = $tampered
    $rp2 = Replay
    Check ($rp2.Rc -eq 0 -and $rp2.J.sources.local -eq "altere" -and [int]$rp2.J.sources.worm.entries -eq 3) "W11: fichier local altere -> signale (altere), le WORM fait foi, rejeu execute"
    # W12 : sans identifiants de lecture WORM, un fichier altere bloque toujours le rejeu (bloc 2).
    Remove-Item Env:DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID, Env:DELETION_JOURNAL_WORM_READER_SECRET_ACCESS_KEY
    $rp3 = Replay
    Check ($rp3.Rc -ne 0 -and $rp3.Out -match 'altere') "W12: sans lecture WORM, journal local altere -> rejeu refuse"
    $env:DELETION_REGISTER_JOURNAL = $keepJournal; $env:DATABASE_URL = $keepUrl
    Remove-Item $tampered -EA SilentlyContinue
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $rdb WITH (FORCE);"
    $null = & docker exec $c rm -f /tmp/orya-b6-before.dump
    $allOut = $j1.Out + $j2.Out + $j3.Out + $j4.Out + $rp.Out + $rp2.Out + $rp3.Out + ((Get-Content "$env:TEMP\orya-b6-api.out","$env:TEMP\orya-b6-api.err" -Raw -EA SilentlyContinue) -join "")
    Check (-not $allOut.Contains($wSec) -and -not $allOut.Contains($rSec) -and -not $allOut.Contains($env:DELETION_REGISTER_HMAC_KEY) -and -not $allOut.Contains($env:ORYA_T_S3_ADMIN_SECRET)) "W13: secrets WORM, cle HMAC et secret S3 absents des sorties et journaux"
    Check (-not ($rp.Out -match 'worm[123]\.b6@')) "W13: aucune adresse e-mail dans les sorties du rejeu"
    # W14 : en production, sans journal WORM configure, l'ecriture du journal (donc l'anonymisation) est refusee.
    $probeJ = Join-Path $env:TEMP ("orya-b6-register-prod-" + (Rand 4) + ".jsonl")
    $keepBucket = $env:DELETION_JOURNAL_WORM_BUCKET; Remove-Item Env:DELETION_JOURNAL_WORM_BUCKET
    $env:NODE_ENV = "production"; $env:DELETION_REGISTER_JOURNAL = $probeJ
    Push-Location $apiRoot
    try { $po = & npx tsx -e "require('./src/account/deletion-register').appendJournal({emailHash:'a',userIdHash:'b',studentIdHash:null,kind:'self',anonymizedAt:new Date().toISOString()}).then(()=>console.log('ECRIT'),e=>{console.log('REFUS '+e.message);process.exit(3)})" 2>&1 | Out-String; $prc = $LASTEXITCODE } finally { Pop-Location }
    $env:NODE_ENV = "development"; $env:DELETION_JOURNAL_WORM_BUCKET = $keepBucket; $env:DELETION_REGISTER_JOURNAL = $keepJournal
    Check ($prc -eq 3 -and $po -match 'REFUS .*WORM non configure' -and -not (Test-Path $probeJ)) "W14: production sans journal WORM -> ecriture refusee, aucune ligne locale"
    Remove-Item $probeJ -EA SilentlyContinue

    # ===== S : test de fumee de pre-production (B4) =====
    $smoke = Join-Path $repoRoot "scripts/preprod-smoke.ps1"
    $env:ORYA_SMOKE_EXPORT_EMAIL="smoke.export.b6@orya.test"; $env:ORYA_SMOKE_EXPORT_PASSWORD=$pw0
    $env:ORYA_SMOKE_DELETE_EMAIL="smoke.delete.b6@orya.test"; $env:ORYA_SMOKE_DELETE_PASSWORD=$pw0
    $so = & $smoke -BaseUrl $env:ORYA_T_BASE -ExportTimeoutSeconds 90 *>&1 | Out-String; $src = $LASTEXITCODE
    $sm = [regex]::Match($so, 'SMOKE : (\d+) OK, (\d+) KO')
    Check ($src -eq 0 -and $sm.Success -and [int]$sm.Groups[2].Value -eq 0 -and [int]$sm.Groups[1].Value -ge 17) "S1: test de fumee complet sur l'API locale : $($sm.Value) (code $src)"
    if($src -ne 0){ Write-Host $so }
    Check ($so -match 'SMOKE OK - S1: migrations appliquees = commit deploye' -and $so -match 'SMOKE OK - S3: telechargement PDF' -and $so -match 'SMOKE OK - S4: nouvelle connexion refusee') "S1: migrations, export (JSON + PDF) et suppression (session revoquee, connexion refusee) verifies"
    Check ([int](KeyOf "SELECT count(*) FROM `"AccountDeletionRequest`" r JOIN `"User`" u ON u.id=r.`"userId`" WHERE u.email='smoke.delete.b6@orya.test' AND r.status='pending' AND u.status='disabled';") -eq 1 -and [int](KeyOf "SELECT count(*) FROM `"Device`" d JOIN `"User`" u ON u.id=d.`"userId`" WHERE u.email='smoke.delete.b6@orya.test' AND d.status='active';") -eq 0) "S1: base : demande pending, compte de fumee desactive, aucune session active"
    # S2 : une migration attendue absente de la base -> echec detecte.
    $fakeMig = Join-Path $env:TEMP ("orya-b6-mig-" + (Rand 4))
    New-Item -ItemType Directory -Force $fakeMig | Out-Null
    Get-ChildItem -Directory (Join-Path $apiRoot "prisma/migrations") | ForEach-Object { New-Item -ItemType Directory -Force (Join-Path $fakeMig $_.Name) | Out-Null }
    New-Item -ItemType Directory -Force (Join-Path $fakeMig "29991231000000_non_appliquee") | Out-Null
    $env:ORYA_SMOKE_DELETE_EMAIL = $null; $env:ORYA_SMOKE_DELETE_PASSWORD = $null
    $so2 = & $smoke -BaseUrl $env:ORYA_T_BASE -MigrationsDir $fakeMig -ExportTimeoutSeconds 90 *>&1 | Out-String; $src2 = $LASTEXITCODE
    Remove-Item -Recurse -Force $fakeMig -EA SilentlyContinue
    Check ($src2 -eq 1 -and $so2 -match 'SMOKE KO - S1: migrations') "S2: migration non appliquee -> fumee en echec (code $src2)"
    # S3 : mauvais mot de passe -> echec detecte ; S4 : HTTP hors boucle locale refuse sans appel.
    $env:ORYA_SMOKE_EXPORT_PASSWORD = "Faux-" + (Rand 6) + "-Zz9!"
    $env:ORYA_SMOKE_DELETE_EMAIL = $null; $env:ORYA_SMOKE_DELETE_PASSWORD = $null
    $so3 = & $smoke -BaseUrl $env:ORYA_T_BASE *>&1 | Out-String; $src3 = $LASTEXITCODE
    Check ($src3 -eq 1 -and $so3 -match 'SMOKE KO - S2: connexion du compte de fumee export - connexion refusee \(401\)' -and $so3 -match 'SMOKE KO - S4: .*absentes') "S3: mauvais mot de passe / identifiants absents -> fumee en echec (code $src3)"
    $so4 = & $smoke -BaseUrl "http://preprod.invalid/api/v1" *>&1 | Out-String; $src4 = $LASTEXITCODE
    Check ($src4 -eq 1 -and $so4 -match 'SMOKE KO - S0: HTTPS' -and $so4 -notmatch 'S1:') "S4: URL HTTP hors boucle locale -> refus sans appel (code $src4)"
    Check (-not ($so + $so2 + $so3 + $so4).Contains($pw0) -and -not ($so3).Contains($env:ORYA_SMOKE_EXPORT_PASSWORD)) "S5: aucun mot de passe dans les sorties du test de fumee"
    # S6 : orya_app execute orya_migrations_state() mais ne lit toujours pas _prisma_migrations.
    $deny = Psql $db "SET ROLE orya_app; SELECT count(*) FROM `"_prisma_migrations`";"
    $fnOk = ("" + (Psql $db "SET ROLE orya_app; SELECT applied FROM public.orya_migrations_state();")).Trim()
    Check (("" + $deny) -match 'permission denied' -and [int]($fnOk.Split("`n")[-1]) -eq @(Get-ChildItem -Directory (Join-Path $apiRoot "prisma/migrations")).Count) "S6: orya_app : _prisma_migrations illisible, orya_migrations_state() = agregats seulement"
    $env:ORYA_SMOKE_EXPORT_PASSWORD = $null; $env:ORYA_SMOKE_EXPORT_EMAIL = $null

    $logs = (Get-Content "$env:TEMP\orya-b6-api.out","$env:TEMP\orya-b6-api.err" -Raw -EA SilentlyContinue) -join ""
    Check (-not $logs.Contains($pw0) -and -not $logs.Contains($pw1) -and -not $logs.Contains($pw2) -and -not $logs.Contains($pwD)) "mots de passe absents des journaux API"
}
catch {
    $script:ko++; Write-Host "  B6 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    if($env:DELETION_REGISTER_JOURNAL -and $env:DELETION_REGISTER_JOURNAL -like "*orya-b6-register-*"){ Remove-Item $env:DELETION_REGISTER_JOURNAL -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC6 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0
