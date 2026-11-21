# =============================================================================
# ORYA - Bloc 2 (J1.1 + J1.2) sur orya-test-pg uniquement.
# Fixtures textes VALIDES via DIRECT ; un DRAFT sert au refus.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc2"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B2 OK - $Label" } else { $script:ko++; Write-Host "  B2 KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3260
$apiProc=$null
$saved=@{}
foreach ($k in @("DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","STORAGE_LOCAL_DIR","ACCOUNT_DELETION_DELAY_DAYS","ACCOUNT_DELETION_JOB_DISABLED","CONSENT_REQUIRE_ALL_LINKED_GUARDIANS","APPLY_ROLES","DELETION_REGISTER_HMAC_KEY","DELETION_REGISTER_JOURNAL")) {
    $saved[$k]=[Environment]::GetEnvironmentVariable($k)
}
function Psql([string]$DbName,[string]$Sql){ $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 }

try {
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db; CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db"
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw=Rand; $appPw=Rand
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $env:DIRECT_DATABASE_URL="postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL="postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    # Point 2 : cle HMAC du registre, generee pour ce run, hors base, jamais affichee.
    $env:DELETION_REGISTER_HMAC_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    # Point 1 : copie append-only du registre hors base (fichier jetable de ce run).
    $env:DELETION_REGISTER_JOURNAL=Join-Path $env:TEMP ("orya-b2-register-" + (Rand 6) + ".jsonl")
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"; $env:ACCOUNT_DELETION_DELAY_DAYS="14"; $env:CONSENT_REQUIRE_ALL_LINKED_GUARDIANS="0"
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS bloc2"
        $seedOut = & npx tsx test/api/seed-bloc2.ts 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 0) "seed (textes VALIDES via DIRECT + 1 DRAFT)"
    } finally { Pop-Location }
    $ids = ($seedOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json

    $env:API_PORT="$port"; $env:NODE_ENV="development"
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:STORAGE_LOCAL_DIR=Join-Path $env:TEMP "orya-b2-storage"
    New-Item -ItemType Directory -Force -Path $env:STORAGE_LOCAL_DIR | Out-Null
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b2-api.out" -RedirectStandardError "$env:TEMP\orya-b2-api.err"
    $ready=$false
    for($i=0;$i -lt 40;$i++){ Start-Sleep 1; try { if((Invoke-WebRequest "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ $ready=$true; break } } catch {} }
    Check $ready "API up :$port"
    if(-not $ready){ throw "API down" }

        function Get-Totp([string]$Secret){
        $env:ORYA_TOTP_SECRET=$Secret
        Push-Location $apiRoot; try { return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_TOTP_SECRET))").Trim() } finally { Pop-Location }
    }
    function Login([string]$Email,[string]$Password){
        $r=Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/login" -ContentType "application/json" -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
        if(-not $r.mfaRequired){ return $r.accessToken }
        if($r.method -ne "enroll"){ throw "MFA verify inattendue pour $Email (method=$($r.method))" }
        $enroll=Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/mfa/enroll" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken }|ConvertTo-Json)
        if(-not $enroll.secret){ throw "enroll sans secret pour $Email : $($enroll|ConvertTo-Json -Compress)" }
        $code=Get-Totp $enroll.secret
        $verify=Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/mfa/verify" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken; code=$code }|ConvertTo-Json)
        if(-not $verify.accessToken){ throw "MFA enroll/verify sans jeton pour $Email : $($verify|ConvertTo-Json -Compress)" }
        return $verify.accessToken
    }
    function Api([string]$Method,[string]$Path,[string]$Token,$Body=$null){
        $h=@{ Authorization="Bearer $Token" }
        try {
            if($null -eq $Body){ $r=Invoke-WebRequest -Method $Method -Uri "http://127.0.0.1:$port/api/v1$Path" -Headers $h -UseBasicParsing }
            else { $r=Invoke-WebRequest -Method $Method -Uri "http://127.0.0.1:$port/api/v1$Path" -Headers $h -ContentType "application/json" -Body ($Body|ConvertTo-Json) -UseBasicParsing }
            return [pscustomobject]@{ StatusCode=[int]$r.StatusCode; Content=$r.Content }
        } catch {
            $resp=$_.Exception.Response; $code=if($resp){[int]$resp.StatusCode}else{0}
            $text=""
            if($resp){ $text=(New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
            return [pscustomobject]@{ StatusCode=$code; Content=$text }
        }
    }

    $parentTok=Login $ids.parentEmail $ids.password
    $dirTok=Login $ids.dirEmail $ids.password

    $r=Api POST "/family/children/$($ids.studentId)/consents" $parentTok @{ textId=$ids.draftId; purpose="student_account" }
    Check ($r.StatusCode -eq 404) "B: brouillon refuse (404 : invisible hors super-admin, policy consent_text_read)"

    # --- Point 4 : validation d'un texte = super-admin + MFA + reference juridique + audit
    $superTok=Login $ids.superEmail $ids.password
    $v=Api POST "/admin/consent-texts/validate" $dirTok @{ id=$ids.draft2Id; legalDocumentRef="AVIS-JUR-2026-001"; legalValidatedAt="2026-10-01" }
    Check ($v.StatusCode -eq 403) "P4: direction ne valide pas un texte (403)"
    $v=Api POST "/admin/consent-texts/validate" $superTok @{ id=$ids.draft2Id }
    Check ($v.StatusCode -eq 400) "P4: validation sans reference juridique refusee (400)"
    $v=Api POST "/admin/consent-texts/validate" $superTok @{ id=$ids.draft2Id; legalDocumentRef="AVIS-JUR-2026-001"; legalValidatedAt="2099-01-01" }
    Check ($v.StatusCode -eq 400) "P4: date juridique future refusee (400)"
    $v=Api POST "/admin/consent-texts/validate" $superTok @{ id=$ids.draft2Id; legalDocumentRef="AVIS-JUR-2026-001"; legalValidatedAt="2026-10-01" }
    Check ($v.StatusCode -eq 200) "P4: super-admin MFA valide le texte (200)"
    Check ((Psql $db "SELECT `"legalDocumentRef`" || '|' || `"legalValidatedAt`"::text || '|' || (`"validatedById`" IS NOT NULL)::text FROM `"ConsentText`" WHERE id='$($ids.draft2Id)';") -eq "AVIS-JUR-2026-001|2026-10-01|true") "P4: reference, date et validateur enregistres"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='consent.text.validate' AND severity='critical' AND metadata->>'legalDocumentRef'='AVIS-JUR-2026-001' AND metadata->>'legalValidatedAt'='2026-10-01';")) -eq 1) "P4: validation auditee (critique, reference + date)"
    $v=Api POST "/admin/consent-texts/validate" $superTok @{ id=$ids.draft2Id; legalDocumentRef="AUTRE"; legalValidatedAt="2026-10-02" }
    Check ($v.StatusCode -eq 409) "P4: revalidation refusee (409)"
    $trg = Psql $db "UPDATE `"ConsentText`" SET `"legalDocumentRef`"='FALSIFIE' WHERE id='$($ids.draft2Id)';"
    Check (($trg | Out-String) -match "ORYA_CONSENT_TEXT_IMMUTABLE") "P4: reference figee apres validation (trigger, meme en superutilisateur)"
    $chk = Psql $db "INSERT INTO `"ConsentText`" (purpose,version,locale,body,`"bodySha256`",status) VALUES ('transport_alerts','vX','fr','corps de test assez long','x','validated');"
    Check (($chk | Out-String) -match "ConsentText_validated_requires_legal_ref") "P4: CHECK SQL : valide sans reference impossible"
    $ctrlSrc = Get-Content (Join-Path $apiRoot "src/consent/consent.controller.ts") -Raw
    Check ($ctrlSrc -match '@Roles\("super_admin"\)\s*@RequireMfa\(\)\s*@HttpCode\(200\)\s*validate\(') "P4: route de validation sous @RequireMfa (garde MfaGuard)"

    $cur=Api GET "/consent-texts/current?purpose=student_account&locale=fr" $parentTok
    Check ($cur.StatusCode -eq 200 -and ($cur.Content|ConvertFrom-Json).status -eq "validated") "B: texte courant valide"

    $g=Api POST "/family/children/$($ids.studentId)/consents" $parentTok @{ textId=$ids.textFrId; purpose="student_account" }
    Check ($g.StatusCode -eq 201) "B: consentement parent"
    Check ((Psql $db "SELECT `"accountStatus`" FROM `"Student`" WHERE id='$($ids.studentId)';") -eq "active") "D: eleve actif (1 consentement suffit)"

    $paper=Api POST "/students/$($ids.studentId)/consents/paper" $dirTok @{ textId=$ids.textFrId; purpose="student_account"; guardianName="Tuteur Papier"; paperDate="2026-01-15"; paperFileReference="DOS-2026-001" }
    Check ($paper.StatusCode -eq 201) "C: papier direction sans piece jointe"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='consent.grant.paper' AND severity='warning';")) -ge 1) "C: audit warning papier"

    $list=($g.Content|ConvertFrom-Json)
    # revoke web consent of parent
    $clist=((Api GET "/family/children/$($ids.studentId)/consents" $parentTok).Content|ConvertFrom-Json).consents
    $cid=@($clist|Where-Object{ -not $_.revokedAt -and $_.channel -eq "web" })[0].id
    $rev=Api POST "/family/children/$($ids.studentId)/consents/$cid/revoke" $parentTok @{}
    Check ($rev.StatusCode -eq 200) "D: retrait d'un responsable"
    Check ((Psql $db "SELECT `"accountStatus`" FROM `"Student`" WHERE id='$($ids.studentId)';") -eq "active") "D: reste actif (papier reste ; param=0)"

    $plist=((Api GET "/students/$($ids.studentId)/consents" $dirTok).Content|ConvertFrom-Json).consents
    $paperId=@($plist|Where-Object{ -not $_.revokedAt })[0].id
    $null=Api POST "/students/$($ids.studentId)/consents/$paperId/revoke" $dirTok @{}
    Check ((Psql $db "SELECT `"accountStatus`" FROM `"Student`" WHERE id='$($ids.studentId)';") -eq "suspended_no_consent") "D: suspendu sans consentement"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='student.suspend.no_consent';")) -ge 1) "D: suspension auditee"

    $null=Api POST "/family/children/$($ids.studentId)/consents" $parentTok @{ textId=$ids.textFrId; purpose="student_account" }

    $bad=Api POST "/students/deletion" $parentTok @{ studentId=$ids.studentId; password="wrong-password" }
    Check ($bad.StatusCode -eq 401) "E: mauvais mot de passe refuse"
    $delS=Api POST "/students/deletion" $parentTok @{ studentId=$ids.studentId; password=$ids.password }
    Check ($delS.StatusCode -eq 202) "E: suppression eleve par responsable lie (202)"

    # H: avance effectiveAt + job avec horloge simulee
    $null=Psql $db "UPDATE `"AccountDeletionRequest`" SET `"effectiveAt`"=now() - interval '1 hour' WHERE status='pending';"
    Push-Location $apiRoot
    try {
      $at = (Get-Date).ToUniversalTime().AddDays(15).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      $jobOut = & npx tsx prisma/run-deletion-job.ts "--at=$at" 2>&1 | Out-String
      $jobRc = $LASTEXITCODE
    } finally { Pop-Location }
    if($jobRc -ne 0){ Write-Host "JOB_OUT=$jobOut" -ForegroundColor Yellow }
    Check ($jobRc -eq 0) "H: job avec horloge simulee execute"
    $jobJson = ($jobOut.Trim().Split("`n") | Where-Object { $_ -match '^\{\"at\"' } | Select-Object -Last 1) | ConvertFrom-Json
    if(-not $jobJson){ $jobJson = ($jobOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json -EA SilentlyContinue }
    if($null -eq $jobJson){ Write-Host "JOB_RAW=$jobOut" -ForegroundColor Yellow }; Check ($null -ne $jobJson -and [int]$jobJson.processed -ge 1) "H: job a traite au moins 1 demande"
    Check (([int](Psql $db "SELECT count(*) FROM `"DeletionRegister`";")) -ge 1) "G: registre alimente"
    Check ((Psql $db "SELECT `"accountStatus`" FROM `"Student`" WHERE id='$($ids.studentId)';") -eq "none") "F: compte eleve ORYA coupe (dossier scolaire reste)"

    $delP=Api POST "/me/deletion" $parentTok @{ password=$ids.password }
    Check ($delP.StatusCode -eq 202) "E: suppression compte parent demandee"
    $null=Psql $db "UPDATE `"AccountDeletionRequest`" SET `"effectiveAt`"=now() - interval '1 hour' WHERE status='pending';"
    Push-Location $apiRoot
    try {
      $at2 = (Get-Date).ToUniversalTime().AddDays(20).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      $job2 = & npx tsx prisma/run-deletion-job.ts "--at=$at2" 2>&1 | Out-String
      $job2Rc = $LASTEXITCODE
    } finally { Pop-Location }
    if($job2Rc -ne 0 -or $job2 -notmatch '"failed":0'){ Write-Host "JOB2_OUT=$job2" -ForegroundColor Yellow }
    Check ($job2Rc -eq 0) "H: job anonymise parent"
    Check ((Psql $db "SELECT phone FROM `"Guardian`" WHERE `"fullName`"='Parent Un';") -eq "0611111111") "F: telephone ecole conserve"
    Check (@("true","t") -contains (Psql $db "SELECT (`"userId`" IS NULL)::text FROM `"Guardian`" WHERE `"fullName`"='Parent Un';")) "F: lien Guardian coupe"

    # --- Point 2 : empreintes HMAC-SHA256 (cle hors base), plus de SHA-256 simple
    $plainSha = (& node -e "process.stdout.write(require('crypto').createHash('sha256').update('parent.b2@orya.test').digest('hex'))").Trim()
    $hmac = (& node -e "process.stdout.write(require('crypto').createHmac('sha256',Buffer.from(process.env.DELETION_REGISTER_HMAC_KEY,'base64')).update('parent.b2@orya.test').digest('hex'))").Trim()
    Check (([int](Psql $db "SELECT count(*) FROM `"DeletionRegister`" WHERE `"emailHash`"='$plainSha';")) -eq 0) "P2: aucune empreinte SHA-256 simple de l'e-mail"
    Check (([int](Psql $db "SELECT count(*) FROM `"DeletionRegister`" WHERE `"emailHash`"='$hmac';")) -eq 1) "P2: empreinte = HMAC-SHA256(cle hors base)"

    # --- Point 1 : copie append-only hors base, ecrite a chaque suppression
    $jl = @(Get-Content $env:DELETION_REGISTER_JOURNAL -EA SilentlyContinue)
    Check ($jl.Count -eq ([int](Psql $db "SELECT count(*) FROM `"DeletionRegister`";"))) "P1: une ligne de journal par entree du registre ($($jl.Count))"
    Check (-not (($jl -join "`n") -match "@")) "P1: journal sans e-mail en clair"
    Check (([int](Psql $db "SELECT count(*) FROM `"Notification`" WHERE kind='account.guardian_unlinked';")) -ge 1) "F: ecole notifiee"

    $pii=[int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='account.delete.completed' AND (metadata::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' OR metadata::text ~ '0[5-7][0-9]{8}');")
    Check ($pii -eq 0) "I: pas d'e-mail/tel dans AuditLog.metadata"
    $hit=Select-String -Path "$env:TEMP\orya-b2-api.out","$env:TEMP\orya-b2-api.err" -Pattern "parent.b2@orya.test","0611111111" -SimpleMatch -EA SilentlyContinue
    Check (-not $hit) "I: pas d'e-mail/tel dans les journaux API"

    # G replay: recreate user with same email then replay register
    $ins=Psql $db "INSERT INTO `"User`" (id,email,`"passwordHash`",status,`"createdAt`",`"updatedAt`") VALUES (gen_random_uuid(),'parent.b2@orya.test','!','active',now(),now()) RETURNING email;"
    Check ($ins -eq 'parent.b2@orya.test') "G: insert restauration (email rejoue)"
    Push-Location $apiRoot
    try { $repOut=& npx tsx prisma/run-replay-register.ts 2>&1 | Out-String; $repRc=$LASTEXITCODE } finally { Pop-Location }
    if($repRc -ne 0){ Write-Host "REP_OUT=$repOut" -ForegroundColor Yellow }
    Check ($repRc -eq 0) "G: replay execute"
    $rep=($repOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    if($null -eq $rep){ Write-Host "REP_RAW=$repOut" -ForegroundColor Yellow }
    Check ($null -ne $rep -and [int]$rep.fixed -ge 1) "G: utilisateur restaure re-anonymise (fixed=$($rep.fixed))"
    Check ((Psql $db "SELECT count(*) FROM `"User`" WHERE email LIKE 'deleted+%' AND status='deleted';") -ge 2) "G: au moins 2 comptes anonymises apres replay"

    # --- Point 1 : restauration d'une sauvegarde ANTERIEURE aux suppressions :
    # le registre en base est vide (TRUNCATE par le superutilisateur de test = etat restaure),
    # le compte supprime reapparait ; le rejeu repart du journal hors base.
    $null = Psql $db "TRUNCATE `"DeletionRegister`";"
    $null = Psql $db "INSERT INTO `"User`" (id,email,`"passwordHash`",status,`"createdAt`",`"updatedAt`") VALUES (gen_random_uuid(),'parent.b2@orya.test','!','active',now(),now());"
    Push-Location $apiRoot
    try { $rep2=& npx tsx prisma/run-replay-register.ts 2>&1 | Out-String; $rep2Rc=$LASTEXITCODE } finally { Pop-Location }
    $r2=($rep2.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json -EA SilentlyContinue
    Check ($rep2Rc -eq 0 -and $null -ne $r2 -and [int]$r2.restored -eq $jl.Count -and [int]$r2.fixed -ge 1) "P1: rejeu depuis le journal (registre restaure=$($r2.restored), compte re-anonymise=$($r2.fixed))"
    Check (([int](Psql $db "SELECT count(*) FROM `"User`" WHERE email='parent.b2@orya.test';")) -eq 0) "P1: compte supprime absent apres rejeu"
    Check (([int](Psql $db "SELECT count(*) FROM `"DeletionRegister`";")) -eq $jl.Count) "P1: registre en base reconstitue"
    # Journal altere : le rejeu refuse
    $tampered = "$($env:DELETION_REGISTER_JOURNAL).tampered"
    $lines2 = @(Get-Content $env:DELETION_REGISTER_JOURNAL); $lines2[0] = $lines2[0] -replace '"kind":"[a-z_]+"','"kind":"self_x"'
    Set-Content -Path $tampered -Value $lines2 -Encoding ascii
    $keepJ = $env:DELETION_REGISTER_JOURNAL; $env:DELETION_REGISTER_JOURNAL = $tampered
    Push-Location $apiRoot
    try { $rep3=& npx tsx prisma/run-replay-register.ts 2>&1 | Out-String; $rep3Rc=$LASTEXITCODE } finally { Pop-Location; $env:DELETION_REGISTER_JOURNAL = $keepJ }
    Check ($rep3Rc -ne 0 -and $rep3 -match "altere") "P1: journal altere detecte, rejeu refuse"
    # Sans cle HMAC : echec ferme
    $keepK = $env:DELETION_REGISTER_HMAC_KEY; Remove-Item Env:DELETION_REGISTER_HMAC_KEY
    Push-Location $apiRoot
    try { $rep4=& npx tsx prisma/run-replay-register.ts 2>&1 | Out-String; $rep4Rc=$LASTEXITCODE } finally { Pop-Location; $env:DELETION_REGISTER_HMAC_KEY = $keepK }
    Check ($rep4Rc -ne 0) "P2: sans cle HMAC, rejeu refuse (echec ferme)"
    $keyLeak = Select-String -Path "$env:TEMP\orya-b2-api.out","$env:TEMP\orya-b2-api.err" -Pattern $env:DELETION_REGISTER_HMAC_KEY -SimpleMatch -EA SilentlyContinue
    Check (-not $keyLeak -and -not ($rep2 + $rep3 + $rep4 + $jobOut + $job2).Contains($env:DELETION_REGISTER_HMAC_KEY)) "P2: cle HMAC absente des journaux et sorties"
    Remove-Item $tampered -EA SilentlyContinue

    Check ((Get-Content (Join-Path $apiRoot "src/consent/consent.types.ts") -Raw) -match "CONSENT_REQUIRE_ALL_LINKED_GUARDIANS") "D: parametre inversable documente dans le code"
}
catch {
    $script:ko++; Write-Host "  B2 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    if ($env:DELETION_REGISTER_JOURNAL -and $env:DELETION_REGISTER_JOURNAL -like "*orya-b2-register-*") { Remove-Item $env:DELETION_REGISTER_JOURNAL -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC2 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0
