# =============================================================================
# ORYA - Bloc 4 (eleve, bus, export, droits) sur conteneurs JETABLES uniquement :
#   orya-test-pg (55433), orya-test-s3 (SeaweedFS, 55435), orya-test-clamav (55436).
# Compte eleve (consultation seule, barriere consentement), statut du bus sans
# position, export de donnees asynchrone (JSON+PDF, 7 jours, antivirus, SSE, URL
# courtes), demandes de rectification/opposition (tracees, sans modification).
# Secrets (mot de passe, cles S3) generes ou lus dans les conteneurs, jamais affiches.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc4"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B4 OK - $Label" } else { $script:ko++; Write-Host "  B4 KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }
function Assert-AuxContainer([string]$Name) {
    $json = (& docker inspect -f '{{json .Config.Labels}}' $Name 2>$null) -join ""
    if ($LASTEXITCODE -ne 0 -or -not $json) { throw "$Name introuvable (scripts/test-files-up.ps1)" }
    $l = $json | ConvertFrom-Json
    if ($null -eq $l -or ("" + $l.'created-by') -ne "orya-test") { throw "$Name sans label created-by=orya-test : refus" }
}

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3280
$apiProc=$null
$keys=@("BUS_ATTENDANT_UPDATES_ENABLED","DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","APPLY_ROLES","ACCOUNT_DELETION_JOB_DISABLED","FILE_RETENTION_JOB_DISABLED","DATA_EXPORT_JOB_DISABLED",
  "STORAGE_DRIVER","STORAGE_S3_ENDPOINT","STORAGE_S3_REGION","STORAGE_S3_BUCKET","STORAGE_S3_ACCESS_KEY_ID","STORAGE_S3_SECRET_ACCESS_KEY","STORAGE_S3_FORCE_PATH_STYLE","STORAGE_S3_SSE","STORAGE_PRESIGN_SECONDS",
  "CLAMAV_HOST","CLAMAV_PORT","ORYA_B4_PASSWORD","ORYA_T_TOKEN","ORYA_T_BASE","ORYA_T_URL","ORYA_T_MARKER","UPLOAD_RATE_LIMIT","ORYA_T_B64","ORYA_T_FILEFIELD","ORYA_T_GEN","ORYA_PENDING_PURGE_ALLOW","AUTH_LOGIN_LIMIT","IMPORT_RATE_LIMIT","API_RATE_LIMIT")
$saved=@{}; foreach ($k in $keys) { $saved[$k]=[Environment]::GetEnvironmentVariable($k) }
function Psql([string]$DbName,[string]$Sql){ $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 }

try {
    Assert-AuxContainer "orya-test-s3"; Assert-AuxContainer "orya-test-clamav"
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db; CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db"
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw=Rand; $appPw=Rand
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $env:DIRECT_DATABASE_URL="postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL="postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"; $env:FILE_RETENTION_JOB_DISABLED="1"; $env:DATA_EXPORT_JOB_DISABLED="1"; $env:UPLOAD_RATE_LIMIT="100"; $env:AUTH_LOGIN_LIMIT="200"; $env:IMPORT_RATE_LIMIT="200"; $env:API_RATE_LIMIT="2000"
    $env:ORYA_B4_PASSWORD = Rand 16
    # Stockage S3 jetable : identifiants lus dans le conteneur (jamais affiches).
    $env:STORAGE_DRIVER="s3"; $env:STORAGE_S3_ENDPOINT="http://127.0.0.1:55435"; $env:STORAGE_S3_REGION="us-east-1"
    $env:STORAGE_S3_BUCKET="orya-test-files"; $env:STORAGE_S3_FORCE_PATH_STYLE="1"; $env:STORAGE_S3_SSE="AES256"; $env:STORAGE_PRESIGN_SECONDS="120"
    $env:STORAGE_S3_ACCESS_KEY_ID=("" + (& docker exec orya-test-s3 printenv AWS_ACCESS_KEY_ID 2>$null)).Trim()
    $env:STORAGE_S3_SECRET_ACCESS_KEY=("" + (& docker exec orya-test-s3 printenv AWS_SECRET_ACCESS_KEY 2>$null)).Trim()
    Check ($env:STORAGE_S3_ACCESS_KEY_ID.Length -gt 0 -and $env:STORAGE_S3_SECRET_ACCESS_KEY.Length -gt 0) "identifiants S3 du conteneur jetable"
    $env:CLAMAV_HOST="127.0.0.1"; $env:CLAMAV_PORT="55436"
    $env:ORYA_T_MARKER = "ORYA-B4-MARK-" + (Rand 8)
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy (dont 20261107000000_bloc4_student_bus_rights)"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS"
        $seedOut = & npx tsx test/api/seed-bloc4.ts 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 0) "seed bloc 4"
        $bk = & node test/api/b3-s3.mjs create-bucket 2>&1 | Out-String
        Check ($bk -match '"ok":true') "bucket prive orya-test-files"
    } finally { Pop-Location }
    $ids = ($seedOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json

    $env:BUS_ATTENDANT_UPDATES_ENABLED="1"  # t50u : drapeau ON pour B1-B4 ; OFF teste en C2
    $env:API_PORT="$port"; $env:NODE_ENV="development"
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b4-api.out" -RedirectStandardError "$env:TEMP\orya-b4-api.err"
    $ready=$false
    for($i=0;$i -lt 40;$i++){ Start-Sleep 1; try { if((Invoke-WebRequest "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ $ready=$true; break } } catch {} }
    Check $ready "API up :$port (STORAGE_DRIVER=s3, CLAMAV)"
    if(-not $ready){ throw "API down" }
    $env:ORYA_T_BASE = "http://127.0.0.1:$port/api/v1"

    function Get-Totp([string]$Secret){
        $env:ORYA_TOTP_SECRET=$Secret
        Push-Location $apiRoot; try { return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_TOTP_SECRET))").Trim() } finally { Pop-Location; Remove-Item Env:ORYA_TOTP_SECRET -EA SilentlyContinue }
    }
    function Login([string]$Email){
        $r=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/login" -ContentType "application/json" -Body (@{email=$Email;password=$env:ORYA_B4_PASSWORD}|ConvertTo-Json)
        if(-not $r.mfaRequired){ return $r.accessToken }
        $enroll=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/mfa/enroll" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken }|ConvertTo-Json)
        $code=Get-Totp $enroll.secret
        $verify=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/mfa/verify" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken; code=$code }|ConvertTo-Json)
        return $verify.accessToken
    }
    function Api([string]$Method,[string]$Path,[string]$Token,$Body=$null){
        $h=@{ Authorization="Bearer $Token" }
        try {
            if($null -eq $Body){ $r=Invoke-WebRequest -Method $Method -Uri "$($env:ORYA_T_BASE)$Path" -Headers $h -UseBasicParsing }
            else { $r=Invoke-WebRequest -Method $Method -Uri "$($env:ORYA_T_BASE)$Path" -Headers $h -ContentType "application/json" -Body ($Body|ConvertTo-Json) -UseBasicParsing }
            return [pscustomobject]@{ StatusCode=[int]$r.StatusCode; Content=$r.Content }
        } catch {
            $resp=$_.Exception.Response; $code=if($resp){[int]$resp.StatusCode}else{0}
            $text=""; if($_.ErrorDetails -and $_.ErrorDetails.Message){ $text=$_.ErrorDetails.Message }; if(-not $text -and $resp){ $text=(New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
            return [pscustomobject]@{ StatusCode=$code; Content=$text }
        }
    }
    function Upload([string]$Token,[string]$Path,[string]$Gen,[string]$Name,[string]$Mime,[string[]]$Fields=@()){
        $env:ORYA_T_TOKEN=$Token
        Push-Location $apiRoot
        try { $o = & node test/api/b3-upload.mjs $Path $Gen $Name $Mime @Fields 2>&1 | Out-String } finally { Pop-Location; Remove-Item Env:ORYA_T_TOKEN -EA SilentlyContinue }
        return ($o.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    }
    function S3([string]$Cmd,[string]$Key=""){
        Push-Location $apiRoot
        try { $o = & node test/api/b3-s3.mjs $Cmd $Key 2>&1 | Out-String } finally { Pop-Location }
        return ($o.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    }
    function KeyOf([string]$Sql){ return ("" + (Psql $db $Sql)).Trim() }

    function LoginWith([string]$Email,[string]$Pw){
        try { $r=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/login" -ContentType "application/json" -Body (@{email=$Email;password=$Pw}|ConvertTo-Json); return $r.accessToken } catch { return $null }
    }
    function Fetch([string]$Url){
        $env:ORYA_T_URL=$Url
        Push-Location $apiRoot
        try { $o = & node test/api/b4-fetch.mjs 2>&1 | Out-String } finally { Pop-Location; Remove-Item Env:ORYA_T_URL -EA SilentlyContinue }
        return ($o.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    }
    function ExportCli([string[]]$CliArgs=@()){
        Push-Location $apiRoot
        try { $o = & npx tsx prisma/run-data-export.ts @CliArgs 2>&1 | Out-String } finally { Pop-Location }
        return ($o.Trim().Split("`n") | Where-Object { $_ -match '^\{' } | Select-Object -Last 1) | ConvertFrom-Json
    }
    function J($r){ return ($r.Content | ConvertFrom-Json -EA SilentlyContinue) }

    $dirTok=Login "dir.b4@orya.test"; $dirBTok=Login "dirb.b4@orya.test"; $parentTok=Login "parent.b4@orya.test"
    $parent2Tok=Login "parent2.b4@orya.test"; $parent3Tok=Login "parent3.b4@orya.test"; $teacherTok=Login "teacher.b4@orya.test"
    $busTok=Login "bus.b4@orya.test"; $orphanTok=Login "orphan.b4@orya.test"
    Check ($dirTok -and $dirBTok -and $parentTok -and $parent2Tok -and $parent3Tok -and $teacherTok -and $busTok -and $orphanTok) "connexions (direction x2 MFA, 3 parents, enseignant, accompagnateur, eleve sans fiche)"

    # ===== S : compte et espace eleve (consultation seule, consentement actif) =====
    $sEmail="eleve.b4@orya.test"
    $s0 = Api POST "/students/$($ids.s1)/student-account" $dirTok @{ email=$sEmail }
    Check ($s0.StatusCode -eq 409) "S1: invitation eleve refusee sans consentement parental actif (409)"
    Check ((Api POST "/students/$($ids.s1)/student-account" $teacherTok @{ email=$sEmail }).StatusCode -eq 403) "S1: enseignant ne peut pas inviter un eleve (403)"
    $g1 = Api POST "/family/children/$($ids.s1)/consents" $parentTok @{ textId=$ids.textId; purpose="student_account" }
    $c1 = (J $g1).id
    Check ($g1.StatusCode -eq 201 -and (KeyOf "SELECT `"accountStatus`" FROM `"Student`" WHERE id='$($ids.s1)';") -eq "active") "S2: consentement parental web -> compte eleve actif"
    $inv = Api POST "/students/$($ids.s1)/student-account" $dirTok @{ email=$sEmail }
    $invTok = (J $inv).token
    Check ($inv.StatusCode -eq 201 -and $invTok) "S2: direction (MFA) cree l'invitation eleve (jeton remis une fois, non affiche)"
    Check ((Api POST "/students/$($ids.s1)/student-account" $dirBTok @{ email="x.b4@orya.test" }).StatusCode -eq 404) "S2: direction d'une autre ecole -> 404"
    $sPw = Rand 16
    $acc = Api POST "/activation/invitation" "" @{ token=$invTok; password=$sPw; fullName="Eleve B4" }
    Check ($acc.StatusCode -eq 200 -and (KeyOf "SELECT count(*) FROM `"UserProfile`" WHERE role='student' AND `"studentId`"='$($ids.s1)';") -eq "1") "S3: invitation acceptee, profil eleve rattache a sa fiche"
    Check ((Api POST "/students/$($ids.s1)/student-account" $dirTok @{ email="autre.b4@orya.test" }).StatusCode -eq 409) "S3: second compte pour le meme eleve refuse (409)"
    $stuTok = LoginWith $sEmail $sPw
    Check ([bool]$stuTok) "S4: connexion de l'eleve"
    $me = Api GET "/student/me" $stuTok
    Check ($me.StatusCode -eq 200 -and (J $me).readOnly -eq $true -and (J $me).classroom.name -eq "B4-5A") "S4: /student/me (consultation seule, classe B4-5A)"
    $ag = Api GET "/student/agenda" $stuTok
    Check ($ag.StatusCode -eq 200 -and @((J $ag).items | Where-Object { $_.title -eq "Devoir B4" }).Count -eq 1) "S4: agenda de sa classe"
    $at = Api GET "/student/attendance" $stuTok
    Check ($at.StatusCode -eq 200 -and @((J $at).items | Where-Object { $_.status -eq "absent" }).Count -eq 1) "S4: ses presences"
    $sj = Api GET "/student/justifications" $stuTok
    Check ($sj.StatusCode -eq 200 -and @((J $sj).items).Count -eq 1 -and -not ($sj.Content -match 'reason|Motif|file|submittedBy')) "S4: justificatifs en statut seulement (ni motif ni piece)"
    $writes = @(
      (Api POST "/student/me" $stuTok @{ displayName="x" }).StatusCode,
      (Api PATCH "/student/me" $stuTok @{ displayName="x" }).StatusCode,
      (Api PUT "/student/agenda" $stuTok @{ x=1 }).StatusCode,
      (Api DELETE "/student/attendance" $stuTok).StatusCode,
      (Api POST "/student/justifications" $stuTok @{ reason="x" }).StatusCode)
    Check (@($writes | Where-Object { $_ -ne 404 }).Count -eq 0) "S5: aucune route d'ecriture dans l'espace eleve (404 x5 : $($writes -join ','))"
    Check ((Api POST "/family/justifications" $stuTok @{ studentId=$ids.s1; fromDate="2026-10-01"; toDate="2026-10-01"; reason="x" }).StatusCode -eq 403) "S5: eleve -> depot de justificatif refuse (403)"
    Check ((Api GET "/family/children" $stuTok).StatusCode -eq 403) "S5: eleve -> espace famille refuse (403)"
    Check ((Api GET "/student/me" $parentTok).StatusCode -eq 403) "S5: parent -> espace eleve refuse (403)"
    Check ((Api GET "/student/me" $orphanTok).StatusCode -eq 403) "S6: profil eleve sans fiche rattachee -> 403"
    # retrait du consentement -> acces refuse a la requete suivante (sans nouvelle connexion)
    $rv = Api POST "/family/children/$($ids.s1)/consents/$c1/revoke" $parentTok @{}
    Check ($rv.StatusCode -eq 200 -and (KeyOf "SELECT `"accountStatus`" FROM `"Student`" WHERE id='$($ids.s1)';") -eq "suspended_no_consent") "S7: retrait du consentement par le parent -> compte suspendu"
    $after = @("/student/me","/student/agenda","/student/attendance","/student/justifications","/student/bus") | ForEach-Object { (Api GET $_ $stuTok).StatusCode }
    Check (@($after | Where-Object { $_ -ne 403 }).Count -eq 0) "S7: apres retrait, les 5 routes eleve refusent avec la MEME session (403 : $($after -join ','))"
    $g2 = Api POST "/family/children/$($ids.s1)/consents" $parentTok @{ textId=$ids.textId; purpose="student_account" }
    Check ($g2.StatusCode -eq 201 -and (Api GET "/student/me" $stuTok).StatusCode -eq 200) "S7: nouveau consentement -> acces retabli"
    # invitation emise pendant un consentement actif, consentement retire AVANT acceptation -> aucun compte cree
    $g3 = Api POST "/family/children/$($ids.s2)/consents" $parent3Tok @{ textId=$ids.textId; purpose="student_account" }
    $inv2 = Api POST "/students/$($ids.s2)/student-account" $dirTok @{ email="eleve2.b4@orya.test" }
    $null = Api POST "/family/children/$($ids.s2)/consents/$((J $g3).id)/revoke" $parent3Tok @{}
    $acc2 = Api POST "/activation/invitation" "" @{ token=(J $inv2).token; password=(Rand 16) }
    Check ($inv2.StatusCode -eq 201 -and $acc2.StatusCode -eq 403 -and (KeyOf "SELECT count(*) FROM `"User`" WHERE email='eleve2.b4@orya.test';") -eq "0") "S8: consentement retire avant acceptation -> 403, aucun compte cree"

    # ===== B : statut du bus, sans carte ni position =====
    # t92 (CDC 3.5) : l'accompagnateur ne saisit que les eleves de SES circuits : circuit de test confie a bus.b4 avec l'eleve s1.
    $null = Psql $db "WITH c AS (INSERT INTO `"BusCircuit`"(`"schoolId`",name,`"attendantProfileId`",`"updatedAt`") SELECT '$($ids.schoolAId)','Circuit B4',p.id,now() FROM `"UserProfile`" p JOIN `"User`" u ON u.id=p.`"userId`" WHERE u.email='bus.b4@orya.test' AND p.role='bus_attendant' RETURNING id) INSERT INTO `"BusCircuitStudent`"(`"schoolId`",`"circuitId`",`"studentId`") SELECT '$($ids.schoolAId)',c.id,'$($ids.s1)' FROM c;"
    $b1 = Api POST "/bus/status" $busTok @{ studentId=$ids.s1; status="on_board" }
    $b1k = @((J $b1).PSObject.Properties.Name) | Sort-Object
    Check ($b1.StatusCode -eq 200 -and ($b1k -join ",") -eq "date,label,status,updatedAt") "B1: accompagnateur -> statut enregistre ; reponse = date,label,status,updatedAt"
    Check ((Api POST "/bus/status" $busTok @{ studentId=$ids.s1; status="on_board"; lat=33.9; lng=-6.8 }).StatusCode -eq 400) "B2: coordonnees lat/lng refusees (400)"
    Check ((Api POST "/bus/status" $busTok @{ studentId=$ids.s1; status="on_board"; location=@{ x=1 } }).StatusCode -eq 400) "B2: champ location refuse (400)"
    Check ((Api POST "/bus/status" $busTok @{ studentId=$ids.s1; status="teleporte" }).StatusCode -eq 400) "B2: statut inconnu refuse (400)"
    $geo='lat|lng|latitude|longitude|coord|position|location|map|gps|route|itinerary|geo'
    $pb = Api GET "/family/children/$($ids.s1)/bus" $parentTok
    Check ($pb.StatusCode -eq 200 -and (J $pb).today.status -eq "on_board" -and -not ($pb.Content -match $geo)) "B3: parent -> statut du jour, aucune donnee de position"
    $sb = Api GET "/student/bus" $stuTok
    Check ($sb.StatusCode -eq 200 -and (J $sb).today.status -eq "on_board" -and -not ($sb.Content -match $geo)) "B3: eleve -> statut du bus, aucune donnee de position"
    $lb = Api GET "/bus/status" $busTok
    Check ($lb.StatusCode -eq 200 -and -not ($lb.Content -match $geo)) "B3: liste accompagnateur sans position"
    Check ((Api GET "/family/children/$($ids.s1)/bus" $parent3Tok).StatusCode -eq 404) "B4: parent d'un autre enfant -> 404"
    Check ((Api POST "/bus/status" $teacherTok @{ studentId=$ids.s1; status="waiting" }).StatusCode -eq 403) "B4: enseignant -> 403"
    Check ((Api POST "/bus/status" $parentTok @{ studentId=$ids.s1; status="waiting" }).StatusCode -eq 403) "B4: parent -> 403"
    Check ((Api POST "/bus/status" $stuTok @{ studentId=$ids.s1; status="waiting" }).StatusCode -eq 403) "B4: eleve -> 403"
    Check ((Api POST "/bus/status" $dirBTok @{ studentId=$ids.s1; status="waiting" }).StatusCode -eq 404) "B4: direction d'une autre ecole -> 404"
    # --- C2 (decision t50u) : BUS_ATTENDANT_UPDATES_ENABLED desactive par defaut (API ci-dessus lancee avec =1)
    $savedBusFlag=$env:BUS_ATTENDANT_UPDATES_ENABLED; $savedP=$env:API_PORT; $savedB=$env:ORYA_T_BASE; $busOffApi=$null
    try {
        if(Get-NetTCPConnection -State Listen -LocalPort 3281 -EA SilentlyContinue){ throw "Port 3281 occupe" }
        Remove-Item Env:BUS_ATTENDANT_UPDATES_ENABLED -EA SilentlyContinue
        $env:API_PORT="3281"; $env:ORYA_T_BASE="http://127.0.0.1:3281/api/v1"
        $busOffApi=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b4-busoff.out" -RedirectStandardError "$env:TEMP\orya-b4-busoff.err"
        $okOff=$false; for($i=0;$i -lt 30;$i++){ Start-Sleep 1; try{ if((Invoke-WebRequest "$($env:ORYA_T_BASE)/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){$okOff=$true;break} }catch{} }
        Check $okOff "C2: API de test prete (drapeau absent = defaut)"
        $offW = Api POST "/bus/status" $busTok @{ studentId=$ids.s1; status="dropped_off" }
        Check ($offW.StatusCode -eq 403 -and $offW.Content -match 'desactivee') "C2: drapeau OFF (defaut) -> accompagnateur refuse (403, message explicite)"
        Check ((J (Api GET "/family/children/$($ids.s1)/bus" $parentTok)).today.status -eq "on_board") "C2: drapeau OFF -> aucun statut modifie"
        Check ((Api GET "/bus/status" $busTok).StatusCode -eq 200) "C2: drapeau OFF -> lecture accompagnateur conservee"
        Check ((Api POST "/bus/status" $dirTok @{ studentId=$ids.s1; status="on_board" }).StatusCode -eq 200) "C2: drapeau OFF -> direction peut toujours saisir"
        Check ((Api POST "/bus/status" $teacherTok @{ studentId=$ids.s1; status="waiting" }).StatusCode -eq 403) "C2: drapeau OFF -> enseignant toujours 403"
    } finally {
        if($busOffApi -and -not $busOffApi.HasExited){ Stop-Process -Id $busOffApi.Id -Force -EA SilentlyContinue }
        $env:BUS_ATTENDANT_UPDATES_ENABLED=$savedBusFlag; $env:API_PORT=$savedP; $env:ORYA_T_BASE=$savedB
    }
    Check ($b1.StatusCode -eq 200) "C2: drapeau ON (=1) -> accompagnateur enregistre (B1)"    $cols = KeyOf "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name='StudentBusStatus';"
    Check (-not ($cols -match $geo)) "B5: table StudentBusStatus sans colonne de position ($cols)"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='bus.status.set';") -ge 1) "B5: changement de statut audite"

    # ===== X : export des donnees (droit d'acces) =====
    $x1 = Api POST "/me/data-export" $parentTok
    $xId = (J $x1).id
    Check ($x1.StatusCode -eq 202 -and (J $x1).status -eq "pending") "X1: demande d'export acceptee (202, asynchrone)"
    Check ((Api POST "/me/data-export" $parentTok).StatusCode -eq 409) "X1: seconde demande pendant la preparation -> 409"
    Check ((Api GET "/me/data-export/$xId/json" $parentTok).StatusCode -eq 409) "X2: export non pret -> 409"
    $pr = ExportCli
    Check ([int]$pr.processed -ge 1 -and [int]$pr.failed -eq 0) "X3: traitement asynchrone (job/CLI) : $($pr.processed) export(s)"
    $xl = (J (Api GET "/me/data-export" $parentTok)).items | Where-Object { $_.id -eq $xId }
    $ttl = ([datetime]$xl.expiresAt - [datetime]$xl.readyAt).TotalDays
    Check ($xl.status -eq "ready" -and [math]::Round($ttl) -eq 7) "X4: export pret, disponible 7 jours"
    $xj = Api GET "/me/data-export/$xId/json" $parentTok
    $xju = (J $xj)
    Check ($xj.StatusCode -eq 200 -and $xju.url -and [int]$xju.expiresInSeconds -le 300) "X5: JSON servi par URL pre-signee courte ($($xju.expiresInSeconds) s)"
    $fj = Fetch $xju.url
    $data = $fj.text | ConvertFrom-Json -EA SilentlyContinue
    Check ($fj.status -eq 200 -and $data.account.email -eq "parent.b4@orya.test" -and @($data.justifications | Where-Object { $_.reason -eq "Motif parent B4" }).Count -eq 1) "X5: JSON contient ses donnees (compte, son justificatif)"
    Check (-not ($fj.text -match 'parent2\.b4|parent3\.b4|Motif prive parent2|passwordHash|mfaSecret')) "X6: aucune donnee d'autrui (co-responsable, autre parent) ni secret"
    $kids = @($data.childrenData)
    $k1 = $kids | Where-Object { $_.id -eq $ids.s1 }
    Check ($k1 -and @($k1.attendance | Where-Object { $_.status -eq 'absent' }).Count -ge 1 -and $null -ne $k1.bus) "C4: export parent -> presences et bus de son enfant (s1)"
    Check (@($kids | Where-Object { $_.id -eq $ids.s3 }).Count -eq 1 -and @($kids | Where-Object { $_.id -eq $ids.s2 }).Count -eq 0) "C4: export parent -> enfant partage inclus, enfant d'un autre parent exclu"
    Check (@($data.justifications | Where-Object { $_.reason -ne 'Motif parent B4' }).Count -eq 0) "C4: export parent -> seuls ses propres justificatifs (rien du co-responsable sur l'enfant partage)"
    Check (@($data.justifications | Where-Object { $_.attachment -and $_.attachment.included -ne $false }).Count -eq 0 -and -not ($fj.text -match 'storageKey|JVBERi')) "X6: aucune piece jointe incluse (metadonnees seulement, pas de cle de stockage)"
    $xp = J (Api GET "/me/data-export/$xId/pdf" $parentTok)
    $fp = Fetch $xp.url
    Check ($fp.status -eq 200 -and $fp.head.StartsWith("%PDF-") -and [int]$fp.expires -le 300) "X7: PDF genere et servi (URL courte)"
    $xk = KeyOf "SELECT f.`"storageKey`" FROM `"DataExportRequest`" r JOIN `"StoredFile`" f ON f.id=r.`"jsonFileId`" WHERE r.id='$xId';"
    Check ((S3 "head" $xk).sse -eq "AES256" -and (KeyOf "SELECT string_agg(DISTINCT f.purpose || '|' || f.`"scanStatus`" || '|' || f.encryption, ',') FROM `"StoredFile`" f WHERE f.purpose='data_export';") -eq "data_export|clean|sse-s3") "X7: fichiers d'export chiffres (SSE), analyses (clean), finalite data_export"
    Check ((Api GET "/me/data-export/$xId/json" $parent2Tok).StatusCode -eq 404 -and (Api GET "/me/data-export/$xId/json" $dirTok).StatusCode -eq 404) "X8: export d'autrui introuvable (autre parent, direction : 404)"
    $rlsOut = @(Psql $db "SET ROLE orya_app; SELECT set_config('app.school_id','$($ids.schoolAId)',false); SELECT 'N=' || count(*) FROM `"DataExportRequest`";") -join " "
    Check ($rlsOut -match "N=0" -and [int](KeyOf "SELECT count(*) FROM `"DataExportRequest`";") -ge 1) "X8: RLS - contexte ecole (orya_app) sans titulaire ne voit aucun export ($rlsOut)"
    $sx = Api POST "/me/data-export" $stuTok
    $null = ExportCli
    $sxu = J (Api GET "/me/data-export/$((J $sx).id)/json" $stuTok)
    $sd = (Fetch $sxu.url).text | ConvertFrom-Json -EA SilentlyContinue
    Check ($sx.StatusCode -eq 202 -and $sd.student -and @($sd.student.attendance).Count -ge 1 -and -not ((Fetch $sxu.url).text -match 'parent\.b4|Motif parent')) "X9: export eleve (presences, bus, statuts) sans donnee des parents"
    $future = (Get-Date).ToUniversalTime().AddDays(8).ToString("o")
    $pg = ExportCli @("--purge","--at=$future")
    Check ([int]$pg.expired -ge 1) "X10: purge a J+7 ($($pg.expired) export(s) expire(s))"
    Check ((Api GET "/me/data-export/$xId/json" $parentTok).StatusCode -eq 410 -and -not (S3 "head" $xk).exists) "X10: export expire -> 410, objet retire du stockage"
    # antivirus indisponible -> echec ferme, rien de stocke
    $nBefore = KeyOf "SELECT count(*) FROM `"StoredFile`" WHERE purpose='data_export';"
    $x11 = Api POST "/me/data-export" $parent3Tok
    & docker stop orya-test-clamav *> $null
    $pf = ExportCli
    & docker start orya-test-clamav *> $null
    Check ([int]$pf.failed -ge 1 -and (KeyOf "SELECT status FROM `"DataExportRequest`" WHERE id='$((J $x11).id)';") -eq "failed" -and (KeyOf "SELECT count(*) FROM `"StoredFile`" WHERE purpose='data_export';") -eq $nBefore) "X11: antivirus indisponible -> export en echec, aucun fichier stocke (echec ferme)"
    for($i=0;$i -lt 90;$i++){ if(((& docker inspect -f '{{.State.Health.Status}}' orya-test-clamav 2>$null) -join "") -eq "healthy"){ break }; Start-Sleep 2 }
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action IN ('privacy.export.requested','privacy.export.ready','privacy.export.downloaded');") -ge 3) "X12: demande, production et telechargements audites"

    # ===== R : rectification et opposition (demande tracee, aucune modification automatique) =====
    $gBefore = KeyOf "SELECT md5(string_agg(g.`"fullName`" || g.email || coalesce(g.phone,''), ',')) FROM `"Guardian`" g;"
    $uBefore = KeyOf "SELECT md5(string_agg(u.email || u.status, ',' ORDER BY u.email)) FROM `"User`" u;"
    $r1 = Api POST "/me/data-rights" $parentTok @{ kind="rectification"; subject="Telephone errone"; message="Mon numero est 0611111111, merci de corriger." }
    $r2 = Api POST "/me/data-rights" $parentTok @{ kind="opposition"; subject="Notifications"; message="Je m'oppose aux rappels non obligatoires." }
    Check ($r1.StatusCode -eq 201 -and (J $r1).status -eq "open" -and $r2.StatusCode -eq 201) "R1: demandes de rectification et d'opposition enregistrees (ouvertes)"
    Check ((Api POST "/me/data-rights" $parentTok @{ kind="suppression"; subject="x"; message="xyz" }).StatusCode -eq 400) "R1: type de demande inconnu -> 400"
    Check ((KeyOf "SELECT md5(string_agg(g.`"fullName`" || g.email || coalesce(g.phone,''), ',')) FROM `"Guardian`" g;") -eq $gBefore -and (KeyOf "SELECT md5(string_agg(u.email || u.status, ',' ORDER BY u.email)) FROM `"User`" u;") -eq $uBefore) "R2: aucune donnee modifiee automatiquement"
    Check (@((J (Api GET "/me/data-rights" $parentTok)).items).Count -eq 2 -and @((J (Api GET "/me/data-rights" $parent2Tok)).items).Count -eq 0) "R3: chacun ne voit que ses demandes"
    $dl = J (Api GET "/data-rights" $dirTok)
    Check (@($dl.items | Where-Object { $_.requester -eq "parent.b4@orya.test" }).Count -eq 2) "R4: la direction de l'ecole recoit les demandes"
    Check (@((J (Api GET "/data-rights" $dirBTok)).items).Count -eq 0) "R4: direction d'une autre ecole -> aucune demande"
    Check ((Api GET "/data-rights" $teacherTok).StatusCode -eq 403 -and (Api GET "/data-rights" $parentTok).StatusCode -eq 403) "R4: enseignant et parent -> liste ecole refusee (403)"
    Check ((Api POST "/data-rights/$((J $r1).id)/close" $dirBTok @{ response="x y z" }).StatusCode -eq 404) "R5: cloture par une autre ecole -> 404"
    $cl = Api POST "/data-rights/$((J $r1).id)/close" $dirTok @{ response="Numero corrige manuellement apres verification." }
    Check ($cl.StatusCode -eq 200 -and (J $cl).status -eq "closed" -and (Api POST "/data-rights/$((J $r1).id)/close" $dirTok @{ response="encore" }).StatusCode -eq 409) "R5: cloture avec reponse ; seconde cloture -> 409"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action IN ('privacy.rights.rectification.requested','privacy.rights.opposition.requested','privacy.rights.closed');") -eq 3) "R6: demandes et cloture auditees"

    # --- Fuites
    $logs = (Get-Content "$env:TEMP\orya-b4-api.out","$env:TEMP\orya-b4-api.err" -Raw -EA SilentlyContinue) -join ""
    Check (-not $logs.Contains($env:STORAGE_S3_SECRET_ACCESS_KEY) -and -not $logs.Contains($env:ORYA_B4_PASSWORD) -and -not $logs.Contains($sPw)) "secrets et mots de passe absents des journaux API"
}
catch {
    $script:ko++; Write-Host "  B4 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC4 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0