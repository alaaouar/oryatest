# =============================================================================
# ORYA - Bloc 3 (fichiers) sur conteneurs JETABLES uniquement :
#   orya-test-pg (55433), orya-test-s3 (SeaweedFS, 55435), orya-test-clamav (55436).
# Envoi multipart reel (multer), S3 + SSE + URL pre-signees courtes, ClamAV
# (EICAR, echec ferme), administration seulement, scan du consentement papier,
# conservation + purge (horloge simulee).
# Secrets (mot de passe, cles S3) generes ou lus dans les conteneurs, jamais affiches.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc3"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B3 OK - $Label" } else { $script:ko++; Write-Host "  B3 KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }
function Assert-AuxContainer([string]$Name) {
    $json = (& docker inspect -f '{{json .Config.Labels}}' $Name 2>$null) -join ""
    if ($LASTEXITCODE -ne 0 -or -not $json) { throw "$Name introuvable (scripts/test-files-up.ps1)" }
    $l = $json | ConvertFrom-Json
    if ($null -eq $l -or ("" + $l.'created-by') -ne "orya-test") { throw "$Name sans label created-by=orya-test : refus" }
}

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3270
$apiProc=$null
$keys=@("DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","APPLY_ROLES","ACCOUNT_DELETION_JOB_DISABLED","FILE_RETENTION_JOB_DISABLED",
  "STORAGE_DRIVER","STORAGE_S3_ENDPOINT","STORAGE_S3_REGION","STORAGE_S3_BUCKET","STORAGE_S3_ACCESS_KEY_ID","STORAGE_S3_SECRET_ACCESS_KEY","STORAGE_S3_FORCE_PATH_STYLE","STORAGE_S3_SSE","STORAGE_PRESIGN_SECONDS",
  "CLAMAV_HOST","CLAMAV_PORT","CLAMAV_TIMEOUT_MS","CLAMAV_MAX_CONCURRENT","JUSTIFICATION_COGUARDIAN_STATUS","ORYA_B3_PASSWORD","ORYA_T_TOKEN","ORYA_T_BASE","ORYA_T_URL","ORYA_T_MARKER","UPLOAD_RATE_LIMIT","ORYA_T_B64","ORYA_T_FILEFIELD","ORYA_T_GEN","ORYA_PENDING_PURGE_ALLOW","AUTH_LOGIN_LIMIT","IMPORT_RATE_LIMIT","API_RATE_LIMIT")
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
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"; $env:FILE_RETENTION_JOB_DISABLED="1"; $env:UPLOAD_RATE_LIMIT="100"; $env:AUTH_LOGIN_LIMIT="200"; $env:IMPORT_RATE_LIMIT="200"; $env:API_RATE_LIMIT="2000"
    $env:ORYA_B3_PASSWORD = Rand 16
    # Stockage S3 jetable : identifiants lus dans le conteneur (jamais affiches).
    $env:STORAGE_DRIVER="s3"; $env:STORAGE_S3_ENDPOINT="http://127.0.0.1:55435"; $env:STORAGE_S3_REGION="us-east-1"
    $env:STORAGE_S3_BUCKET="orya-test-files"; $env:STORAGE_S3_FORCE_PATH_STYLE="1"; $env:STORAGE_S3_SSE="AES256"; $env:STORAGE_PRESIGN_SECONDS="120"
    $env:STORAGE_S3_ACCESS_KEY_ID=("" + (& docker exec orya-test-s3 printenv AWS_ACCESS_KEY_ID 2>$null)).Trim()
    $env:STORAGE_S3_SECRET_ACCESS_KEY=("" + (& docker exec orya-test-s3 printenv AWS_SECRET_ACCESS_KEY 2>$null)).Trim()
    Check ($env:STORAGE_S3_ACCESS_KEY_ID.Length -gt 0 -and $env:STORAGE_S3_SECRET_ACCESS_KEY.Length -gt 0) "identifiants S3 du conteneur jetable"
    $env:CLAMAV_HOST="127.0.0.1"; $env:CLAMAV_PORT="55436"
    $env:ORYA_T_MARKER = "ORYA-B3-MARK-" + (Rand 8)
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy (dont 20261106000000_bloc3_files)"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS"
        $seedOut = & npx tsx test/api/seed-bloc3.ts 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 0) "seed bloc 3"
        $bk = & node test/api/b3-s3.mjs create-bucket 2>&1 | Out-String
        Check ($bk -match '"ok":true') "bucket prive orya-test-files"
    } finally { Pop-Location }
    $ids = ($seedOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json

    $env:API_PORT="$port"; $env:NODE_ENV="development"
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b3-api.out" -RedirectStandardError "$env:TEMP\orya-b3-api.err"
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
        $r=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/login" -ContentType "application/json" -Body (@{email=$Email;password=$env:ORYA_B3_PASSWORD}|ConvertTo-Json)
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

    $dirTok=Login $ids.dirEmail; $dirBTok=Login $ids.dirBEmail; $parentTok=Login $ids.parentEmail
    $teacherTok=Login $ids.teacherEmail; $studentTok=Login $ids.studentEmail
    $parent2Tok=Login $ids.parent2Email; $parent3Tok=Login $ids.parent3Email
    Check ($dirTok -and $dirBTok -and $parentTok -and $teacherTok -and $studentTok -and $parent2Tok -and $parent3Tok) "connexions (direction x2 MFA, 3 parents, enseignant, eleve)"
    $jf=@("studentId=$($ids.studentId)","fromDate=2026-10-05","toDate=2026-10-06","reason=Consultation medicale B3")

    # --- F1 : envoi multipart reel (multer) + antivirus clean
    $u1 = Upload $parentTok "/family/justifications" "pdf" "certificat.pdf" "application/pdf" $jf
    Check ($u1.status -eq 201 -and $u1.body.file.scanStatus -eq "clean" -and $u1.body.reason -eq "Consultation medicale B3") "F1: multipart multer PDF accepte, ClamAV clean, motif rendu au parent auteur"
    $j1 = [string]$u1.body.id
    $key1 = KeyOf "SELECT f.`"storageKey`" FROM `"AbsenceJustification`" j JOIN `"StoredFile`" f ON f.id=j.`"fileId`" WHERE j.id='$j1';"
    Check ((KeyOf "SELECT f.`"scanStatus`" || '|' || f.encryption || '|' || f.purpose || '|' || (f.`"retentionUntil`" > now() + interval '364 days')::text FROM `"StoredFile`" f WHERE f.`"storageKey`"='$key1';") -eq "clean|sse-s3|justification|true") "F1: StoredFile clean, sse-s3, finalite, conservation 365 j"

    # --- F2 : URL pre-signee courte, administration seulement
    $d1 = Api GET "/justifications/$j1/file" $dirTok
    $dj = $d1.Content | ConvertFrom-Json -EA SilentlyContinue
    Check ($d1.StatusCode -eq 200 -and $dj.url -and [int]$dj.expiresInSeconds -le 300) "F2: direction obtient une URL pre-signee (expiresIn=$($dj.expiresInSeconds) s <= 300)"
    $env:ORYA_T_URL = $dj.url
    $g1 = S3 "fetch-url"
    Check ($g1.status -eq 200 -and $g1.sha256 -eq $u1.sha256 -and [int]$g1.expires -le 300 -and $g1.disposition -like "attachment*") "F2: URL pre-signee : contenu identique, X-Amz-Expires=$($g1.expires), attachment"
    $env:ORYA_T_URL = ($dj.url -replace 'X-Amz-Signature=[0-9a-f]+','X-Amz-Signature=00')
    $g2 = S3 "fetch-url"
    Check ($g2.status -eq 403) "F2: URL a signature alteree refusee (403)"
    Remove-Item Env:ORYA_T_URL -EA SilentlyContinue

    # --- F3/F4/F5 : bucket prive, SSE, contenu chiffre au repos
    $un = S3 "unsigned" $key1
    Check ($un.status -eq 403 -or $un.status -eq 401) "F3: lecture non signee refusee ($($un.status))"
    $h1 = S3 "head" $key1
    Check ($h1.exists -and $h1.sse -eq "AES256") "F4: objet chiffre cote serveur (SSE-S3 AES256)"
    $raw = & docker exec orya-test-s3 grep -r -l -a $env:ORYA_T_MARKER /data 2>$null
    Check (-not $raw) "F5: marqueur en clair introuvable dans les donnees brutes du stockage (chiffrement au repos)"

    # --- F6 : EICAR -> refuse, rien de stocke
    $before = [int](KeyOf "SELECT count(*) FROM `"StoredFile`";")
    $u6 = Upload $parentTok "/family/justifications" "eicar" "virus.pdf" "application/pdf" $jf
    Check ($u6.status -eq 422) "F6a: EICAR deguise en .pdf refuse par ClamAV avant le controle de type (422)"
    $u6b = Upload $parentTok "/family/justifications" "eicar" "virus.png" "image/png" $jf
    Check ($u6b.status -eq 422) "F6b: EICAR deguise en .png refuse (422)"
    $u6c = Upload $parentTok "/family/justifications" "eicar" "eicar.heic" "image/heic" $jf
    Check ($u6c.status -eq 422) "F6c: EICAR deguise en .heic refuse (422)"
    Check ([int](KeyOf "SELECT count(*) FROM `"StoredFile`";") -eq $before) "F6: aucun fichier infecte stocke"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='file.rejected.infected' AND severity='warning';") -ge 1) "F6: rejet antivirus audite"

    # --- F7/F8 : taille et types par magic bytes
    $u7 = Upload $parentTok "/family/justifications" "big" "gros.pdf" "application/pdf" $jf
    Check ($u7.status -eq 413) "F7: 10 Mo + 1 octet refuse par multer (413)"
    $u8 = Upload $parentTok "/family/justifications" "heic" "photo.heic" "image/heic" $jf
    Check ($u8.status -eq 201 -and $u8.body.file.scanStatus -eq "clean") "F8: HEIC accepte (ftyp heic)"
    $u8b = Upload $parentTok "/family/justifications" "jpg" "photo.jpg" "image/jpeg" $jf
    Check ($u8b.status -eq 201) "F8: JPG accepte"
    $u8c = Upload $parentTok "/family/justifications" "exe" "photo.heic" "image/heic" $jf
    Check ($u8c.status -eq 400) "F8: executable nomme .heic refuse (400)"
    $u8d = Upload $parentTok "/family/justifications" "png" "scan.pdf" "application/pdf" $jf
    Check ($u8d.status -eq 400) "F8: PNG declare application/pdf refuse (MIME ignore, magic bytes)"
    $u8e = Upload $parentTok "/family/justifications" "exe" "doc.pdf" "application/pdf" $jf
    Check ($u8e.status -eq 400) "F8: executable declare application/pdf refuse (400)"

    # --- F9 (decision t49u) : auteur = sa donnee ; administration = tout ; enseignant/eleve = statut ; autre parent = rien
    $own = Api GET "/family/justifications/$j1/file" $parentTok
    Check ($own.StatusCode -eq 200 -and ($own.Content | ConvertFrom-Json).url) "F9: parent auteur -> sa piece (URL pre-signee courte)"
    Check ((Api GET "/family/justifications/$j1/file" $parent2Tok).StatusCode -eq 404) "F9: autre parent du MEME enfant -> piece introuvable (404)"
    $p2l = ((Api GET "/family/justifications" $parent2Tok).Content | ConvertFrom-Json).justifications
    Check (-not (@($p2l | ForEach-Object { $_.id }) -contains $j1)) "F9: autre parent du meme enfant -> justificatif absent de sa liste"
    Check ((Api GET "/family/justifications/$j1/file" $parent3Tok).StatusCode -eq 404) "F9: parent d'un autre enfant de la meme ecole -> 404"
    $p3l = ((Api GET "/family/justifications" $parent3Tok).Content | ConvertFrom-Json).justifications
    Check (@($p3l).Count -eq 0) "F9: parent d'un autre enfant -> liste vide"
    # --- C1 (decision t50u, JUSTIFICATION_COGUARDIAN_STATUS=1 par defaut) : co-responsable = statut seul
    $p2raw = Api GET "/family/justifications" $parent2Tok
    $p2c = @(($p2raw.Content | ConvertFrom-Json).coGuardian)
    Check (@($p2c | Where-Object { $_.id -eq $j1 -and $_.status -eq "pending" }).Count -eq 1) "C1: co-responsable du meme enfant -> statut du justificatif de l'autre responsable"
    $c1keys = (@($p2c | Where-Object { $_.id -eq $j1 } | Select-Object -First 1 | ForEach-Object { $_.PSObject.Properties.Name }) | Sort-Object) -join ","
    Check ($c1keys -eq "fromDate,id,status,student,toDate" -and -not ($p2raw.Content -match 'Consultation medicale|"reason"|"file"|"reviewNote"|submittedBy')) "C1: co-responsable -> ni motif, ni piece, ni note, ni auteur [$c1keys]"
    $p1raw = Api GET "/family/justifications" $parentTok
    Check (@((($p1raw.Content | ConvertFrom-Json).justifications) | Where-Object { $_.id -eq $j1 -and $_.reason }).Count -eq 1 -and @((($p1raw.Content | ConvertFrom-Json).coGuardian) | Where-Object { $_.id -eq $j1 }).Count -eq 0) "C1: parent auteur -> son envoi complet, pas de doublon en statut"
    Check (@((((Api GET "/family/justifications" $parent3Tok).Content | ConvertFrom-Json).coGuardian) | Where-Object { $_.id -eq $j1 }).Count -eq 0) "C1: parent d'un autre enfant -> aucun statut"
    Check ((Api GET "/family/justifications" $teacherTok).StatusCode -ne 200 -and (Api GET "/family/justifications" $studentTok).StatusCode -ne 200 -and (Api GET "/family/justifications" $dirTok).StatusCode -ne 200) "C1: enseignant, eleve, direction -> pas de vue famille (statut via leurs routes)"
    $ts = Api GET "/justification-status/$($ids.studentId)" $teacherTok
    $tsj = ($ts.Content | ConvertFrom-Json).justifications
    Check ($ts.StatusCode -eq 200 -and @($tsj | Where-Object { $_.id -eq $j1 -and $_.status -eq "pending" }).Count -eq 1) "F9: enseignant de la classe -> statut du justificatif"
    Check (-not ($ts.Content -match '"reason"|"file"|"reviewNote"|Consultation')) "F9: vue enseignant sans motif, piece ni note"
    Check ((Api GET "/justification-status/$($ids.student2Id)" $teacherTok).StatusCode -eq 404) "F9: enseignant -> eleve hors de ses classes (404)"
    Check ((Api GET "/justification-status/$($ids.studentId)" $parentTok).StatusCode -eq 403) "F9: parent -> vue enseignant refusee (403)"
    Check ((Api GET "/justifications/$j1/file" $parentTok).StatusCode -eq 403) "F9: parent -> route administration refusee (403)"
    Check ((Api GET "/justifications/$j1/file" $teacherTok).StatusCode -eq 403) "F9: enseignant -> piece refusee (403)"
    Check ((Api GET "/justifications/$j1/file" $studentTok).StatusCode -eq 403) "F9: eleve -> piece refusee (403)"
    Check ((Api GET "/justifications" $teacherTok).StatusCode -eq 403) "F9: enseignant -> motifs refuses (403)"
    Check ((Api GET "/justifications" $studentTok).StatusCode -eq 403) "F9: eleve -> motifs refuses (403)"
    Check ((Api GET "/family/justifications" $studentTok).StatusCode -eq 403) "F9: eleve -> espace famille refuse (403)"
    Check ((Api GET "/justifications/$j1/file" $dirBTok).StatusCode -eq 404) "F9: direction d'une autre ecole -> 404"
    $pl = ((Api GET "/family/justifications" $parentTok).Content | ConvertFrom-Json).justifications
    Check (@($pl | Where-Object { $_.id -eq $j1 -and $_.reason -eq "Consultation medicale B3" }).Count -eq 1) "F9: liste du parent auteur avec son motif"
    $sl = ((Api GET "/justifications" $dirTok).Content | ConvertFrom-Json).justifications
    Check (@($sl | Where-Object { $_.reason -eq "Consultation medicale B3" }).Count -ge 1) "F9: direction voit le motif"

    # --- F10 : scan du consentement papier, meme pipeline
    $pc = Api POST "/students/$($ids.studentId)/consents/paper" $dirTok @{ textId=$ids.textId; purpose="student_account"; guardianName="Tuteur Papier B3"; paperDate="2026-09-01"; paperFileReference="DOS-B3-001" }
    $pcId = ($pc.Content | ConvertFrom-Json).id
    Check ($pc.StatusCode -eq 201) "F10: consentement papier cree"
    $s1 = Upload $dirTok "/students/$($ids.studentId)/consents/$pcId/scan" "png" "formulaire.png" "image/png"
    Check ($s1.status -eq 201 -and $s1.body.file.scanStatus -eq "clean") "F10: scan papier multipart accepte (ClamAV clean)"
    $s1b = Upload $dirTok "/students/$($ids.studentId)/consents/$pcId/scan" "png" "formulaire2.png" "image/png"
    Check ($s1b.status -eq 409) "F10: second scan refuse (409)"
    $sd = Api GET "/students/$($ids.studentId)/consents/$pcId/scan" $dirTok
    Check ($sd.StatusCode -eq 200 -and ($sd.Content | ConvertFrom-Json).url) "F10: direction obtient l'URL du scan"
    Check ((Api GET "/students/$($ids.studentId)/consents/$pcId/scan" $parentTok).StatusCode -eq 403) "F10: parent -> scan refuse (403)"
    Check ((Api GET "/students/$($ids.studentId)/consents/$pcId/scan" $teacherTok).StatusCode -eq 403) "F10: enseignant -> scan refuse (403)"
    Check ((Api GET "/students/$($ids.studentId)/consents/$pcId/scan" $studentTok).StatusCode -eq 403) "F10: eleve -> scan refuse (403)"
    $sp = Upload $parentTok "/students/$($ids.studentId)/consents/$pcId/scan" "png" "f.png" "image/png"
    Check ($sp.status -eq 403) "F10: parent ne depose pas de scan (403)"
    $pc2 = Api POST "/students/$($ids.studentId)/consents/paper" $dirTok @{ textId=$ids.textId; purpose="student_account"; guardianName="Tuteur Papier B3"; paperDate="2026-09-02"; paperFileReference="DOS-B3-002" }
    $pc2Id = ($pc2.Content | ConvertFrom-Json).id
    $s2 = Upload $dirTok "/students/$($ids.studentId)/consents/$pc2Id/scan" "eicar" "formulaire.pdf" "application/pdf"
    Check ($s2.status -eq 422) "F10: scan papier infecte refuse (422)"
    $scanKey = KeyOf "SELECT f.`"storageKey`" FROM `"ParentalConsent`" p JOIN `"StoredFile`" f ON f.id=p.`"paperFileId`" WHERE p.id='$pcId';"
    Check ((KeyOf "SELECT purpose || '|' || (`"retentionUntil`" > now() + interval '1800 days')::text FROM `"StoredFile`" WHERE `"storageKey`"='$scanKey';") -eq "consent_scan|true") "F10: scan conserve 1825 j (finalite consent_scan)"
    $fl = ((Api GET "/family/children/$($ids.studentId)/consents" $parentTok).Content)
    Check (($fl -match "consents|\[") -and -not ($fl -match "paperFileId|storageKey|consent_scan|/scan")) "F10: liste famille sans reference au scan"

    # --- G (bloc 3b) : plus de voie base64 ; agenda et imports dans le meme pipeline
    $b64 = Api POST "/family/justifications" $parentTok @{ studentId=$ids.studentId; fromDate="2026-10-05"; toDate="2026-10-06"; reason="Base64 B3"; file=@{ filename="c.pdf"; contentBase64="JVBERi0xLjQK" } }
    Check ($b64.StatusCode -eq 400) "G1: ancienne voie JSON base64 refusee (400)"
    $hwf=@("kind=homework","classroomId=$($ids.classroomId)","title=Devoir B3 multipart","date=2026-11-20")
    $env:ORYA_T_FILEFIELD="attachments"
    $hw = Upload $teacherTok "/agenda" "pdf" "consignes.pdf" "application/pdf" $hwf
    Check ($hw.status -eq 201 -and @($hw.body.attachments).Count -eq 1) "G2: devoir avec piece jointe multipart (FilesInterceptor)"
    $agBefore = [int](KeyOf "SELECT count(*) FROM `"StoredFile`" WHERE purpose='agenda';")
    $hwv = Upload $teacherTok "/agenda" "eicar" "devoir.pdf" "application/pdf" $hwf
    Check ($hwv.status -eq 422) "G2: piece jointe d'agenda EICAR refusee (422)"
    $hwx = Upload $teacherTok "/agenda" "exe" "devoir.pdf" "application/pdf" $hwf
    Check ($hwx.status -eq 400) "G2: piece jointe d'agenda executable refusee (400)"
    Remove-Item Env:ORYA_T_FILEFIELD -EA SilentlyContinue
    Check ([int](KeyOf "SELECT count(*) FROM `"StoredFile`" WHERE purpose='agenda';") -eq $agBefore) "G2: aucune piece d'agenda refusee stockee"
    $hwId=[string]$hw.body.id; $hwAtt=[string]@($hw.body.attachments)[0].id
    Check ((KeyOf "SELECT f.`"scanStatus`" || '|' || f.encryption FROM `"AgendaAttachment`" a JOIN `"StoredFile`" f ON f.id=a.`"fileId`" WHERE a.id='$hwAtt';") -eq "clean|sse-s3") "G2: piece d'agenda analysee clean et chiffree"
    $hwd = Api GET "/family/agenda/$hwId/attachments/$hwAtt/file" $parentTok
    Check ($hwd.StatusCode -eq 200 -and ($hwd.Content | ConvertFrom-Json).url) "G2: parent de la classe -> URL pre-signee de la piece d'agenda"
    $hwa = Upload $teacherTok "/agenda/$hwId/attachments" "eicar" "ajout.png" "image/png"
    Check ($hwa.status -eq 422) "G2: ajout d'une piece EICAR a un devoir refuse (422)"
    $hwa2 = Upload $teacherTok "/agenda/$hwId/attachments" "png" "schema.png" "image/png"
    Check ($hwa2.status -eq 201 -and @($hwa2.body.attachments).Count -eq 2) "G2: ajout d'une piece saine en multipart"
    $eicarCsv = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(("X5O!P%@AP[4\PZX54(P^)7CC)7}" + '$' + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!" + '$' + "H+H*")))
    $imp = Api POST "/imports" $dirTok @{ filename="eleves.csv"; contentBase64=$eicarCsv; schoolYear="2026-2027" }
    Check ($imp.StatusCode -eq 422) "G3: import CSV EICAR refuse par ClamAV avant analyse (422)"
    $impOk = Api POST "/imports" $dirTok @{ filename="eleves.csv"; contentBase64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("code eleve;nom;classe`nB3I001;Eleve Import;B3-6A`n")); schoolYear="2026-2027" }
    Check ($impOk.StatusCode -ne 422 -and $impOk.StatusCode -ne 503) "G3: import CSV sain passe l'antivirus (statut $($impOk.StatusCode))"

    # --- C5 (t50u) : retention PROVISOIRE des pieces d'agenda (365 j, a valider par le juriste)
    $agKey = KeyOf "SELECT f.`"storageKey`" FROM `"AgendaAttachment`" a JOIN `"StoredFile`" f ON f.id=a.`"fileId`" WHERE a.id='$hwAtt';"
    Check ((KeyOf "SELECT purpose || '|' || (`"retentionUntil`" > now() + interval '364 days')::text || '|' || (`"retentionUntil`" < now() + interval '366 days')::text FROM `"StoredFile`" WHERE `"storageKey`"='$agKey';") -eq "agenda|true|true") "C5: piece d'agenda : retentionUntil = J+365 (provisoire)"
    Push-Location $apiRoot
    try {
      $at200 = (Get-Date).ToUniversalTime().AddDays(200).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      $p200 = & npx tsx prisma/run-file-purge.ts "--at=$at200" 2>&1 | Out-String; $p200Rc = $LASTEXITCODE
    } finally { Pop-Location }
    Check ($p200Rc -eq 0 -and (S3 "head" $agKey).exists -and (KeyOf "SELECT (`"purgedAt`" IS NULL)::text FROM `"StoredFile`" WHERE `"storageKey`"='$agKey';") -eq "true") "C5: horloge simulee J+200 -> piece d'agenda conservee"
    # --- F12 : conservation + purge (horloge simulee), avant l'arret de ClamAV
    Push-Location $apiRoot
    try {
      $at = (Get-Date).ToUniversalTime().AddDays(400).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      $pOut = & npx tsx prisma/run-file-purge.ts "--at=$at" 2>&1 | Out-String; $pRc = $LASTEXITCODE
    } finally { Pop-Location }
    $pj = ($pOut.Trim().Split("`n") | Where-Object { $_ -match '^\{"at"' } | Select-Object -Last 1) | ConvertFrom-Json -EA SilentlyContinue
    Check ($pRc -eq 0 -and $null -ne $pj -and [int]$pj.purged -ge 3 -and [int]$pj.failed -eq 0) "F12: purge a J+400 (purges=$($pj.purged), echecs=$($pj.failed))"
    Check (-not (S3 "head" $key1).exists) "F12: objet du justificatif supprime du stockage"
    Check ((S3 "head" $scanKey).exists) "F12: scan de consentement conserve (1825 j)"
    Check (-not (S3 "head" $agKey).exists -and (KeyOf "SELECT (`"purgedAt`" IS NOT NULL)::text FROM `"StoredFile`" WHERE `"storageKey`"='$agKey';") -eq "true") "C5: horloge simulee J+400 -> piece d'agenda purgee (objet supprime, purgedAt)"
    Check ((Api GET "/justifications/$j1/file" $dirTok).StatusCode -eq 410) "F12: fichier purge -> 410"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='file.purged';") -eq [int]$pj.purged) "F12: purges auditees"
    Check ((KeyOf "SELECT count(*) FROM `"AbsenceJustification`" WHERE id='$j1';") -eq "1") "F12: fiche du justificatif conservee"

    # --- F11 : echec ferme, antivirus injoignable
    & docker stop orya-test-clamav *> $null
    $u11 = Upload $parentTok "/family/justifications" "pdf" "apres-panne.pdf" "application/pdf" $jf
    Check ($u11.status -eq 201 -and $u11.body.file.scanStatus -eq "error") "F11: antivirus arrete -> fichier recu mais scanStatus=error"
    Check ((Api GET "/justifications/$($u11.body.id)/file" $dirTok).StatusCode -eq 409) "F11: fichier non analyse non telechargeable (409, echec ferme)"
    $noAvBefore = KeyOf 'SELECT (SELECT count(*) FROM "ImportJob") || ''|'' || (SELECT count(*) FROM "ImportRowError") || ''|'' || (SELECT count(*) FROM "StoredFile");'
    $imp11 = Api POST "/imports" $dirTok @{ filename="eleves.csv"; contentBase64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("code eleve;nom;classe`nB3I002;X;B3-6A`n")); schoolYear="2026-2027" }
    Check ($imp11.StatusCode -eq 503) "F11: import sans antivirus refuse (503, echec ferme)"
    $noAvAfter = KeyOf 'SELECT (SELECT count(*) FROM "ImportJob") || ''|'' || (SELECT count(*) FROM "ImportRowError") || ''|'' || (SELECT count(*) FROM "StoredFile");'
    Check ($noAvBefore -eq $noAvAfter) "F11: antivirus indisponible -> aucune ecriture import/fichier"
    Push-Location $apiRoot
    try { $nr = & node test/api/wait-clamav.mjs --timeout-ms=1000 2>&1 | Out-String; $nrCode=$LASTEXITCODE } finally { Pop-Location }
    Check ($nrCode -eq 78 -and $nr -match 'ClamAV non pr') "F11: attente bornee -> message distinct ClamAV non pret (code 78)"
    # remise en route du conteneur jetable (relance de la suite)
    & docker start orya-test-clamav *> $null
    $pong=$false
    for($i=0;$i -lt 60;$i++){ Start-Sleep 2; $hs=(& docker inspect -f '{{.State.Health.Status}}' orya-test-clamav 2>$null); if($hs -eq "healthy"){ $pong=$true; break } }
    Check $pong "ClamAV de nouveau sain"

    # t51u : timeout de scan distinct, HTTP 503 et aucune ecriture. Pas de contournement du pipeline.
    $silent=$null; $timeoutApi=$null
    $savedAvHost=$env:CLAMAV_HOST; $savedAvPort=$env:CLAMAV_PORT; $savedAvTimeout=$env:CLAMAV_TIMEOUT_MS; $savedApiPort=$env:API_PORT; $savedBase=$env:ORYA_T_BASE
    try {
        if(Get-NetTCPConnection -State Listen -LocalPort 3271,55437 -EA SilentlyContinue){ throw "Port test timeout occupe" }
        $silent=Start-Process node -ArgumentList "test/api/clamav-silent.mjs" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-clam-silent.out" -RedirectStandardError "$env:TEMP\orya-clam-silent.err"
        $silentReady=$false
        for($i=0;$i -lt 15;$i++){ Start-Sleep 1; if((Get-Content "$env:TEMP\orya-clam-silent.out" -Raw -EA SilentlyContinue) -match 'SILENT_CLAMD_READY'){ $silentReady=$true;break } }
        Check $silentReady "F11T: scanner silencieux de test pret"
        $env:CLAMAV_PORT="55437"; $env:CLAMAV_TIMEOUT_MS="1000"; $env:API_PORT="3271"; $env:ORYA_T_BASE="http://127.0.0.1:3271/api/v1"
        $timeoutApi=Start-Process node -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-timeout-api.out" -RedirectStandardError "$env:TEMP\orya-timeout-api.err"
        $tr=$false
        for($i=0;$i -lt 30;$i++){ Start-Sleep 1; try{if((Invoke-WebRequest "$($env:ORYA_T_BASE)/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){$tr=$true;break}}catch{} }
        Check $tr "F11T: API timeout de test prete"
        $timeoutBefore = KeyOf 'SELECT (SELECT count(*) FROM "ImportJob") || ''|'' || (SELECT count(*) FROM "ImportRowError") || ''|'' || (SELECT count(*) FROM "StoredFile");'
        $timp = Api POST "/imports" $dirTok @{ filename="timeout.csv"; contentBase64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("code eleve;nom;classe`nB3T001;Test;B3-6A`n")); schoolYear="2026-2027" }
        Check ($timp.StatusCode -eq 503) "F11T: timeout antivirus -> HTTP 503"
        Check ($timp.Content -match 'Delai analyse antivirus depasse') "F11T: message timeout distinct (pas un refus ZIP)"
        if($timp.Content -notmatch 'Delai analyse antivirus depasse'){ Write-Host ("    F11T recu : " + ("" + $timp.Content).Substring(0,[Math]::Min(300,("" + $timp.Content).Length))) }
        $timeoutAfter = KeyOf 'SELECT (SELECT count(*) FROM "ImportJob") || ''|'' || (SELECT count(*) FROM "ImportRowError") || ''|'' || (SELECT count(*) FROM "StoredFile");'
        Check ($timeoutBefore -eq $timeoutAfter) "F11T: timeout -> aucun import ni fichier stocke"
        $sfTBefore = KeyOf 'SELECT (SELECT count(*) FROM "StoredFile") || ''|'' || (SELECT count(*) FROM "AbsenceJustification");'
        $tup = Upload $parentTok "/family/justifications" "pdf" "timeout.pdf" "application/pdf" $jf
        $sfTAfter = KeyOf 'SELECT (SELECT count(*) FROM "StoredFile") || ''|'' || (SELECT count(*) FROM "AbsenceJustification");'
        Check ($tup.status -eq 503 -and ("" + $tup.body.message) -match 'Delai analyse antivirus depasse' -and $sfTBefore -eq $sfTAfter) "F11T: justificatif en timeout -> 503, rien n'est enregistre (t52u)"
    } finally {
        if($timeoutApi -and -not $timeoutApi.HasExited){Stop-Process -Id $timeoutApi.Id -Force -EA SilentlyContinue}
        if($silent -and -not $silent.HasExited){Stop-Process -Id $silent.Id -Force -EA SilentlyContinue}
        $env:CLAMAV_HOST=$savedAvHost; $env:CLAMAV_PORT=$savedAvPort; $env:CLAMAV_TIMEOUT_MS=$savedAvTimeout; $env:API_PORT=$savedApiPort; $env:ORYA_T_BASE=$savedBase
    }

    # --- t52u EX0 : limites clamd du conteneur jetable + mesure 10 Mo (rapport)
    $cfg = (& docker exec orya-test-clamav cat /etc/clamav/clamd.conf 2>$null) -join "`n"
    $cfgOk = $true; foreach($k in @("MaxScanTime 20000","MaxFileSize 60M","MaxScanSize 120M","StreamMaxLength 12M","MaxRecursion 10","MaxFiles 1000","AlertExceedsMax yes")){ if(-not ($cfg -match [regex]::Escape($k))){ $cfgOk=$false } }
    Check $cfgOk "EX0: limites clamd du conteneur jetable (MaxScanTime, MaxFileSize, MaxScanSize, StreamMaxLength, MaxRecursion, MaxFiles, AlertExceedsMax)"
    Push-Location $apiRoot
    try { $mOut = & node test/api/measure-scan.mjs 2>&1 | Out-String } finally { Pop-Location }
    $m = ($mOut.Trim().Split("`n") | Where-Object { $_ -match '^\{"bytes"' } | Select-Object -Last 1) | ConvertFrom-Json -EA SilentlyContinue
    Check ($m -and $m.status -eq "clean") "EX0: fichier legitime de 10 Mo analyse clean sous les limites"
    if($m){ Write-Host ("  MESURE t52u : scan ClamAV fichier legitime {0} octets = {1} ms (mediane de 3 : {2})" -f $m.bytes, $m.medianMs, ($m.runs -join "/")) }

    # --- t52u EX1-EX7 : epuisement (bombe ZIP sans ClamAV, plafond d'analyses, debit)
    $fake=$null; $exApi=$null; $rateApi=$null; $script:exProcs=@()
    $sv=@{}; foreach($k in @("CLAMAV_HOST","CLAMAV_PORT","CLAMAV_TIMEOUT_MS","CLAMAV_MAX_CONCURRENT","API_PORT","ORYA_T_BASE","IMPORT_RATE_LIMIT","UPLOAD_RATE_LIMIT")){ $sv[$k]=[Environment]::GetEnvironmentVariable($k) }
    $statsFile = Join-Path $env:TEMP "orya-clam-fake-stats.json"
    function FakeStats { return (Get-Content -Raw $statsFile | ConvertFrom-Json) }
    function Start-TestApi([int]$P,[string]$Tag){
        $env:API_PORT="$P"; $env:ORYA_T_BASE="http://127.0.0.1:$P/api/v1"
        $proc=Start-Process node -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-$Tag-api.out" -RedirectStandardError "$env:TEMP\orya-$Tag-api.err"
        $script:exProcs += $proc
        $ok=$false; for($i=0;$i -lt 30;$i++){ Start-Sleep 1; try{ if((Invoke-WebRequest "$($env:ORYA_T_BASE)/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){$ok=$true;break} }catch{} }
        return [pscustomobject]@{ Proc=$proc; Ready=$ok }
    }
    function Send-ExParallel([string]$Kind,[int]$N,[string]$Gen,[string]$Tok){
        $env:ORYA_T_TOKEN=$Tok; Push-Location $apiRoot
        try { $o = & node test/api/b3-parallel.mjs $Kind $N $Gen $ids.studentId 2>&1 | Out-String } finally { Pop-Location; Remove-Item Env:ORYA_T_TOKEN -EA SilentlyContinue }
        return ($o.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    }
    $stateQ = 'SELECT (SELECT count(*) FROM "ImportJob") || ''|'' || (SELECT count(*) FROM "StoredFile") || ''|'' || (SELECT count(*) FROM "AbsenceJustification");'
    function Get-ExState { $s = (KeyOf $stateQ).Split('|'); return [pscustomobject]@{ Imports=[int]$s[0]; Files=[int]$s[1]; Justifs=[int]$s[2] } }
    try {
        if(Get-NetTCPConnection -State Listen -LocalPort 3272,3273,55438 -EA SilentlyContinue){ throw "Port test epuisement occupe" }
        Remove-Item $statsFile -EA SilentlyContinue
        $fake=Start-Process node -ArgumentList "test/api/clamav-fake.mjs","55438","2500",$statsFile -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-clam-fake.out" -RedirectStandardError "$env:TEMP\orya-clam-fake.err"
        $fr=$false; for($i=0;$i -lt 15;$i++){ Start-Sleep 1; if((Get-Content "$env:TEMP\orya-clam-fake.out" -Raw -EA SilentlyContinue) -match 'FAKE_CLAMD_READY'){ $fr=$true;break } }
        Check $fr "EX: faux clamd espion de test pret (55438)"
        $env:CLAMAV_HOST="127.0.0.1"; $env:CLAMAV_PORT="55438"; $env:CLAMAV_TIMEOUT_MS="30000"; $env:CLAMAV_MAX_CONCURRENT="3"
        $exApi = Start-TestApi 3272 "ex"
        Check $exApi.Ready "EX: API de test prete (plafond 3 analyses simultanees, clamd espion)"

        $st0=Get-ExState; $s0=(FakeStats).total
        $zb = Send-ExParallel "import" 1 "zipbomb" $dirTok
        $calls=(FakeStats).total - $s0
        Check ($zb.statuses[0] -eq 400 -and $zb.ms[0] -lt 2000 -and $calls -eq 0) "EX1: bombe ZIP rejetee en moins de 2 s sans que ClamAV soit appele (import .xlsx : $($zb.statuses[0]), $($zb.ms[0]) ms, appels clamd $calls)"
        $zf = Send-ExParallel "justif" 1 "zipbomb" $parentTok
        $calls=(FakeStats).total - $s0
        Check ($zf.statuses[0] -eq 400 -and $zf.ms[0] -lt 2000 -and $calls -eq 0) "EX2: bombe ZIP deguisee en .pdf rejetee en moins de 2 s sans que ClamAV soit appele (justificatif : $($zf.statuses[0]), $($zf.ms[0]) ms, appels clamd $calls)"
        $st1=Get-ExState
        Check ($st1.Imports -eq $st0.Imports -and $st1.Files -eq $st0.Files -and $st1.Justifs -eq $st0.Justifs) "EX1/EX2: bombes refusees sans aucune ecriture"

        $st0=Get-ExState
        $pi = Send-ExParallel "import" 8 "csv" $dirTok
        $okI=@($pi.statuses | Where-Object { $_ -eq 201 }).Count; $satI=@($pi.statuses | Where-Object { $_ -eq 503 }).Count
        $st1=Get-ExState; $fs=FakeStats
        Check ($okI -ge 1 -and $okI -le 3 -and $satI -ge 1 -and ($okI + $satI) -eq 8) "EX3: 8 imports paralleles -> $okI acceptes, $satI refuses 503 (plafond 3) [$($pi.statuses -join ',')]"
        Check (@($pi.messages | Where-Object { $_ -match 'saturee' }).Count -eq $satI) "EX3: refus de saturation au message distinct"
        Check (($st1.Imports - $st0.Imports) -eq $okI -and $st1.Files -eq $st0.Files) "EX3: seuls les imports acceptes sont ecrits (+$($st1.Imports - $st0.Imports) ImportJob, 0 fichier)"
        $st0=Get-ExState
        $pj = Send-ExParallel "justif" 8 "pdf" $parentTok
        $okJ=@($pj.statuses | Where-Object { $_ -eq 201 }).Count; $satJ=@($pj.statuses | Where-Object { $_ -eq 503 }).Count
        $st1=Get-ExState; $fs=FakeStats
        Check ($okJ -ge 1 -and $okJ -le 3 -and $satJ -ge 1 -and ($okJ + $satJ) -eq 8) "EX4: 8 justificatifs paralleles -> $okJ acceptes, $satJ refuses 503 [$($pj.statuses -join ',')]"
        Check (($st1.Files - $st0.Files) -eq $okJ -and ($st1.Justifs - $st0.Justifs) -eq $okJ) "EX4: seuls les justificatifs acceptes sont ecrits (+$($st1.Files - $st0.Files) fichier(s))"
        Check ($fs.max -ge 1 -and $fs.max -le 3) "EX3/EX4: plafond respecte cote clamd (maximum simultane observe $($fs.max) <= 3)"
        $alive=$false; try { $alive=((Invoke-WebRequest "$($env:ORYA_T_BASE)/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) } catch {}
        Check ($alive -and -not $exApi.Proc.HasExited) "EX: API toujours debout apres les rafales (aucun plantage)"
        Stop-Process -Id $exApi.Proc.Id -Force -EA SilentlyContinue

        $env:CLAMAV_PORT="55436"; $env:CLAMAV_MAX_CONCURRENT="4"; $env:IMPORT_RATE_LIMIT="3"; $env:UPLOAD_RATE_LIMIT="3"
        $rateApi = Start-TestApi 3273 "rate"
        Check $rateApi.Ready "EX: API de test prete (debit 3 envois/min, vrai ClamAV)"
        $st0=Get-ExState; $ri=@()
        for($i=0;$i -lt 5;$i++){ $ri += (Api POST "/imports" $dirTok @{ filename="debit-$i.csv"; contentBase64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("code eleve;nom;classe`nRT00$i;Debit;B3-6A`n")); schoolYear="2026-2027" }).StatusCode }
        $st1=Get-ExState
        Check (@($ri | Where-Object { $_ -eq 201 }).Count -eq 3 -and @($ri | Where-Object { $_ -eq 429 }).Count -eq 2) "EX5: debit des imports plafonne (3/min) [$($ri -join ',')]"
        Check (($st1.Imports - $st0.Imports) -eq 3) "EX5: imports refuses 429 sans ecriture"
        $st0=Get-ExState; $rj=@()
        for($i=0;$i -lt 5;$i++){ $rj += (Upload $parentTok "/family/justifications" "pdf" "debit-$i.pdf" "application/pdf" $jf).status }
        $st1=Get-ExState
        Check (@($rj | Where-Object { $_ -eq 201 }).Count -eq 3 -and @($rj | Where-Object { $_ -eq 429 }).Count -eq 2) "EX6: debit des justificatifs plafonne (3/min) [$($rj -join ',')]"
        Check (($st1.Files - $st0.Files) -eq 3 -and ($st1.Justifs - $st0.Justifs) -eq 3) "EX6: justificatifs refuses 429 sans ecriture"
        $fakeConsent = [guid]::NewGuid().ToString(); $rc=@()
        for($i=0;$i -lt 4;$i++){ $rc += (Upload $dirTok "/students/$($ids.studentId)/consents/$fakeConsent/scan" "pdf" "scan-$i.pdf" "application/pdf").status }
        Check ($rc[3] -eq 429 -and @($rc[0..2] | Where-Object { $_ -eq 429 }).Count -eq 0) "EX7: debit du scan de consentement papier plafonne (429 au 4e envoi) [$($rc -join ',')]"
    } finally {
        foreach($pp in $script:exProcs){ if($pp -and -not $pp.HasExited){ Stop-Process -Id $pp.Id -Force -EA SilentlyContinue } }
        if($fake -and -not $fake.HasExited){ Stop-Process -Id $fake.Id -Force -EA SilentlyContinue }
        Remove-Item $statsFile -EA SilentlyContinue
        foreach($k in $sv.Keys){ [Environment]::SetEnvironmentVariable($k,$sv[$k]) }
    }
    # --- C1 inverse : JUSTIFICATION_COGUARDIAN_STATUS=0 -> le co-responsable ne voit rien (regle t49u)
    $savedCg = $env:JUSTIFICATION_COGUARDIAN_STATUS; $savedPort = $env:API_PORT; $savedBase2 = $env:ORYA_T_BASE; $script:exProcs=@()
    try {
        if(Get-NetTCPConnection -State Listen -LocalPort 3274 -EA SilentlyContinue){ throw "Port 3274 occupe" }
        $env:JUSTIFICATION_COGUARDIAN_STATUS = "0"
        $cgApi = Start-TestApi 3274 "cg"
        Check $cgApi.Ready "C1: API de test prete (JUSTIFICATION_COGUARDIAN_STATUS=0)"
        Check (@(((Api GET "/family/justifications" $parent2Tok).Content | ConvertFrom-Json).coGuardian).Count -eq 0) "C1 inverse: co-responsable -> aucun statut"
        Check (@((((Api GET "/family/justifications" $parentTok).Content | ConvertFrom-Json).justifications) | Where-Object { $_.id -eq $j1 }).Count -eq 1) "C1 inverse: parent auteur -> son envoi toujours visible"
    } finally {
        foreach($pp in $script:exProcs){ if($pp -and -not $pp.HasExited){ Stop-Process -Id $pp.Id -Force -EA SilentlyContinue } }
        $env:JUSTIFICATION_COGUARDIAN_STATUS = $savedCg; $env:API_PORT = $savedPort; $env:ORYA_T_BASE = $savedBase2
    }

    # --- H (bloc 3b, point 2) : reprise des justificatifs "pending"/"error"
    $legacyClean = "$($ids.schoolAId)/" + (Rand 32); $legacyVirus = "$($ids.schoolAId)/" + (Rand 32); $legacyOld = "$($ids.schoolAId)/" + (Rand 32)
    $env:ORYA_T_GEN="pdf"; $null = S3 "put" $legacyClean; $null = S3 "put" $legacyOld
    $env:ORYA_T_GEN="eicar"; $null = S3 "put" $legacyVirus; Remove-Item Env:ORYA_T_GEN -EA SilentlyContinue
    foreach($k in @($legacyClean,$legacyVirus)){ $null = Psql $db "INSERT INTO `"StoredFile`" (`"schoolId`",driver,`"storageKey`",`"mimeType`",`"sizeBytes`",sha256,`"originalName`",purpose) VALUES ('$($ids.schoolAId)','s3','$k','application/pdf',40,'x','ancien.pdf','legacy');" }
    Push-Location $apiRoot
    try { $rOut = & npx tsx prisma/run-file-pending.ts --rescan 2>&1 | Out-String; $rRc=$LASTEXITCODE } finally { Pop-Location }
    $rj = ($rOut.Trim().Split("`n") | Where-Object { $_ -match '^\{"action"' } | Select-Object -Last 1) | ConvertFrom-Json -EA SilentlyContinue
    Check ($rRc -eq 0 -and $rj.action -eq "rescan" -and [int]$rj.clean -ge 2 -and [int]$rj.infected -eq 1) "H1: re-analyse (clean=$($rj.clean), infecte=$($rj.infected), inconnu=$($rj.stillUnknown))"
    Check ((Api GET "/justifications/$($u11.body.id)/file" $dirTok).StatusCode -eq 200) "H1: fichier recu pendant la panne telechargeable apres re-analyse clean"
    Check ((KeyOf "SELECT `"scanStatus`" || '|' || (`"purgedAt`" IS NOT NULL)::text FROM `"StoredFile`" WHERE `"storageKey`"='$legacyVirus';") -eq "infected|true") "H1: ancien fichier infecte marque et retire"
    Check (-not (S3 "head" $legacyVirus).exists) "H1: objet infecte supprime du stockage"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='file.rescan.infected' AND severity='critical';") -eq 1) "H1: detection a la re-analyse auditee (critique)"
    $null = Psql $db "INSERT INTO `"StoredFile`" (`"schoolId`",driver,`"storageKey`",`"mimeType`",`"sizeBytes`",sha256,`"originalName`",purpose,`"createdAt`") VALUES ('$($ids.schoolAId)','s3','$legacyOld','application/pdf',40,'x','vieux.pdf','legacy',now() - interval '3 years');"
    $cut = (Get-Date).ToUniversalTime().AddYears(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
    Push-Location $apiRoot
    try {
        $x1 = & npx tsx prisma/run-file-pending.ts --purge "--before=$cut" "--confirm=$db" 2>&1 | Out-String; $x1Rc=$LASTEXITCODE
        $env:ORYA_PENDING_PURGE_ALLOW="1"
        $x2 = & npx tsx prisma/run-file-pending.ts --purge "--before=$cut" "--confirm=autre" 2>&1 | Out-String; $x2Rc=$LASTEXITCODE
        $savedUrl=$env:DATABASE_URL; $env:DATABASE_URL="postgresql://refus:refus@127.0.0.1:1/orya"
        $x3 = & npx tsx prisma/run-file-pending.ts --purge "--before=$cut" "--confirm=orya" 2>&1 | Out-String; $x3Rc=$LASTEXITCODE
        $env:DATABASE_URL=$savedUrl
        $x4 = & npx tsx prisma/run-file-pending.ts --purge "--before=$cut" "--confirm=$db" 2>&1 | Out-String; $x4Rc=$LASTEXITCODE
    } finally { Pop-Location; Remove-Item Env:ORYA_PENDING_PURGE_ALLOW -EA SilentlyContinue }
    Check ($x1Rc -ne 0 -and $x1 -match "ORYA_PENDING_PURGE_ALLOW") "H2: purge refusee sans autorisation explicite"
    Check ($x2Rc -ne 0 -and $x2 -match "confirm") "H2: purge refusee si la confirmation ne nomme pas la base"
    Check ($x3Rc -ne 0 -and $x3 -match "interdite") "H2: purge refusee sur une base nommee orya (aucune connexion)"
    $xj = ($x4.Trim().Split("`n") | Where-Object { $_ -match '^\{"action"' } | Select-Object -Last 1) | ConvertFrom-Json -EA SilentlyContinue
    Check ($x4Rc -eq 0 -and [int]$xj.purged -eq 1 -and [int]$xj.failed -eq 0) "H2: purge explicite des anciens fichiers non analyses (purges=$($xj.purged))"
    Check (-not (S3 "head" $legacyOld).exists -and [int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='file.purged.unscanned';") -eq 1) "H2: objet supprime et purge auditee"

    # --- Fuites
    $logs = (Get-Content "$env:TEMP\orya-b3-api.out","$env:TEMP\orya-b3-api.err" -Raw -EA SilentlyContinue) -join ""
    Check (-not $logs.Contains($env:STORAGE_S3_SECRET_ACCESS_KEY) -and -not $logs.Contains($env:ORYA_B3_PASSWORD)) "secrets S3 et mot de passe absents des journaux API"
    Check (-not $logs.Contains("parent.b3@orya.test")) "pas d'e-mail dans les journaux API"
}
catch {
    $script:ko++; Write-Host "  B3 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC3 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0