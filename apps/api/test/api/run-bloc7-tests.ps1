# =============================================================================
# ORYA - Bloc 7 (t74u) : ecran direction "Consentements", route GET consents/overview.
# Base jetable orya_bloc7 sur orya-test-pg uniquement (garde scripts/test-guard.ps1).
# Verifie : garde de role (direction seule), isolation entre ecoles, aucune donnee
# personnelle au-dela de ce que la direction voit deja (ni e-mail, ni telephone, ni IP,
# ni user-agent), brouillons juridiques signales sans version, compteurs, et canal papier
# par la route EXISTANTE (refus sur brouillon, refus sur un eleve d'une autre ecole).
# Mot de passe des comptes : genere par la fixture, jamais affiche.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc7"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B7 OK - $Label" } else { $script:ko++; Write-Host "  B7 KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3292
$apiProc=$null
$saved=@{}
foreach ($k in @("DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","STORAGE_LOCAL_DIR","ACCOUNT_DELETION_JOB_DISABLED","APPLY_ROLES","DELETION_REGISTER_HMAC_KEY","DELETION_REGISTER_JOURNAL","CONSENT_REQUIRE_ALL_LINKED_GUARDIANS","AUTH_LOGIN_LIMIT")) {
    $saved[$k]=[Environment]::GetEnvironmentVariable($k)
}
function Psql([string]$DbName,[string]$Sql){ $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 }

try {
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db WITH (FORCE); CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db"
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw=Rand; $appPw=Rand
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $env:DIRECT_DATABASE_URL="postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL="postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DELETION_REGISTER_HMAC_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:DELETION_REGISTER_JOURNAL=Join-Path $env:TEMP ("orya-b7-register-" + (Rand 6) + ".jsonl")
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"; $env:CONSENT_REQUIRE_ALL_LINKED_GUARDIANS="0"
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS (010_rls.sql)"
        $seedOut = & npx tsx test/api/seed-bloc7.ts 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 0) "seed (2 ecoles, textes valides + brouillons, web/papier/retire/sans consentement)"
    } finally { Pop-Location }
    $ids = ($seedOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    if (-not $ids.password) { throw "fixture illisible" }

    $env:API_PORT="$port"; $env:NODE_ENV="development"
    # 8 connexions (6 profils) dans la minute : meme plafond que la suite E2E, sur cette API jetable seulement.
    $env:AUTH_LOGIN_LIMIT="200"
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:STORAGE_LOCAL_DIR=Join-Path $env:TEMP "orya-b7-storage"
    New-Item -ItemType Directory -Force -Path $env:STORAGE_LOCAL_DIR | Out-Null
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b7-api.out" -RedirectStandardError "$env:TEMP\orya-b7-api.err"
    $ready=$false
    for($i=0;$i -lt 40;$i++){ Start-Sleep 1; try { if((Invoke-WebRequest "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ $ready=$true; break } } catch {} }
    Check $ready "API up :$port"
    if(-not $ready){ throw "API down" }

    function Get-Totp([string]$Secret){
        $env:ORYA_TOTP_SECRET=$Secret
        Push-Location $apiRoot; try { return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_TOTP_SECRET))").Trim() } finally { Pop-Location; Remove-Item Env:ORYA_TOTP_SECRET -EA SilentlyContinue }
    }
    function Login([string]$Email){
        $r=Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/login" -ContentType "application/json" -Body (@{email=$Email;password=$ids.password}|ConvertTo-Json)
        if(-not $r.mfaRequired){ return $r.accessToken }
        if($r.method -ne "enroll"){ throw "MFA verify inattendue pour $Email" }
        $enroll=Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/mfa/enroll" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken }|ConvertTo-Json)
        $verify=Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$port/api/v1/auth/mfa/verify" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken; code=(Get-Totp $enroll.secret) }|ConvertTo-Json)
        if(-not $verify.accessToken){ throw "MFA sans jeton pour $Email" }
        return $verify.accessToken
    }
    function Api([string]$Method,[string]$Path,[string]$Token,$Body=$null){
        $h=@{}
        if($Token){ $h.Authorization="Bearer $Token" }
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

    # --- R : garde de role (direction seule) ---------------------------------
    $r=Api GET "/consents/overview" $null
    Check ($r.StatusCode -eq 401) "R0: sans session -> 401"
    $dirA=Login "dir.a.b7@orya.test"
    $dirB=Login "dir.b.b7@orya.test"
    foreach($pair in @(@("prof.a.b7@orya.test","enseignant"),@("parent.a.b7@orya.test","parent"),@("eleve.a.b7@orya.test","eleve"),@("super.b7@orya.test","super-admin"))){
        $tok=Login $pair[0]
        $r=Api GET "/consents/overview" $tok
        Check ($r.StatusCode -eq 403) "R1: $($pair[1]) -> 403 ($($r.StatusCode))"
    }
    $ctrl = Get-Content (Join-Path $apiRoot "src/consent/consent.controller.ts") -Raw
    Check ($ctrl -match '@Get\("consents/overview"\)\s*@Roles\("direction"\)\s*overview\(') "R2: route sous @Roles(direction) seul (+ JwtAuthGuard, RolesGuard, MfaGuard de la classe)"

    # --- O : contenu pour la direction de l'ecole A --------------------------
    $r=Api GET "/consents/overview" $dirA
    Check ($r.StatusCode -eq 200) "O0: direction A -> 200"
    $o=$r.Content | ConvertFrom-Json
    $names=@($o.students | ForEach-Object { $_.displayName })
    Check ($names.Count -eq 5) "O1: 5 eleves de l'ecole A ($($names.Count))"
    $sa=@($o.purposes | Where-Object { $_.purpose -eq "student_account" })[0]
    Check ($sa.accepted -eq 3 -and $sa.withdrawn -eq 1 -and $sa.pending -eq 1 -and $null -eq $sa.refused) "O2: compte eleve : 3 acceptes, 1 retire, 1 en attente, refus non modelise (null)"
    $ta=@($o.purposes | Where-Object { $_.purpose -eq "transport_alerts" })[0]
    Check ($ta.pending -eq 5 -and $ta.accepted -eq 0) "O3: alertes transport : 5 en attente"
    $tFr=@($o.texts | Where-Object { $_.id -eq $ids.textFr })[0]
    $tAr=@($o.texts | Where-Object { $_.id -eq $ids.textAr })[0]
    Check ($tFr.version -eq "v1-b7" -and $tFr.status -eq "validated" -and -not $tFr.legalDraft -and $tFr.accepted -eq 2 -and $tFr.withdrawn -eq 0) "O4: texte FR valide v1-b7 : 2 acceptes (web + papier), ecole B non comptee"
    Check ($tAr.accepted -eq 0 -and $tAr.withdrawn -eq 1) "O5: texte AR : 1 retire"
    $tDraft=@($o.texts | Where-Object { $_.id -eq $ids.draftStudent })[0]
    Check ($null -ne $tDraft -and $tDraft.legalDraft -and $null -eq $tDraft.version -and $tDraft.accepted -eq 1) "O6: texte reference mais brouillon -> legalDraft=true, version non communiquee"
    Check (-not ($r.Content -match "v0-student-draft-b7|v0-draft-b7|non juridique")) "O7: ni version ni corps des brouillons dans la reponse (policy consent_text_read intacte)"
    $curT=@($o.current | Where-Object { $_.purpose -eq "transport_alerts" -and $_.locale -eq "fr" })[0]
    Check ($curT.legalDraft -and $null -eq $curT.textId) "O8: alertes transport FR : aucune version validee -> brouillon juridique"
    $row2=@($o.students | Where-Object { $_.id -eq $ids.s2 })[0]
    $rec2=@($row2.records)[0]
    Check ($row2.purposes.student_account.status -eq "accepted" -and $rec2.channel -eq "paper_school" -and $rec2.guardian -eq "Tuteur Papier B7" -and $rec2.paperFileReference -eq "DOS-B7-001" -and $row2.classroom.name -eq "6e A B7") "O9: papier : statut, canal, responsable, reference, classe"
    $row1=@($o.students | Where-Object { $_.id -eq $ids.s1 })[0]
    Check ($row1.purposes.student_account.status -eq "accepted" -and @($row1.records)[0].channel -eq "web" -and @($row1.records)[0].guardian -eq "Parent Un B7") "O10: en ligne : responsable lie (nom complet)"
    $row3=@($o.students | Where-Object { $_.id -eq $ids.s3 })[0]
    $row4=@($o.students | Where-Object { $_.id -eq $ids.s4 })[0]
    Check ($row3.purposes.student_account.status -eq "withdrawn" -and $null -ne @($row3.records)[0].revokedAt -and $row4.purposes.student_account.status -eq "pending" -and @($row4.records).Count -eq 0) "O11: retire (date de retrait) et en attente (aucun enregistrement)"

    # --- P : pas de donnees personnelles en plus ------------------------------
    Check (-not ($r.Content -match "parent\.a\.b7@orya\.test|parent3\.b7@orya\.test|0611111117|0633333337|rue Fictive|203\.0\.113\.7|UA-B7-SECRET")) "P1: ni e-mail, ni telephone, ni adresse, ni IP, ni user-agent"
    Check (-not ($r.Content -match '"(email|phone|ip|userAgent|passwordHash|activationCodeHash|massarCode|birthDate|body)"')) "P2: aucune cle sensible dans le JSON"

    # --- I : isolation entre ecoles -------------------------------------------
    Check (-not ($r.Content -match "Zineb B7B|Tuteur Ecole B7B|DOS-B7B-001|B7Z001")) "I1: direction A ne voit rien de l'ecole B"
    $rq=Api GET "/consents/overview?schoolId=$($ids.B)" $dirA
    Check ($rq.StatusCode -eq 200 -and -not ($rq.Content -match "Zineb B7B") -and (($rq.Content | ConvertFrom-Json).students.Count -eq 5)) "I2: parametre schoolId ignore (contexte = jeton)"
    $rb=Api GET "/consents/overview" $dirB
    $ob=$rb.Content | ConvertFrom-Json
    Check ($rb.StatusCode -eq 200 -and $ob.students.Count -eq 1 -and $ob.students[0].displayName -eq "Zineb B7B" -and -not ($rb.Content -match "Amine B7|Basma B7|Tuteur Papier B7|6e A B7")) "I3: direction B ne voit que son eleve"
    $tFrB=@($ob.texts | Where-Object { $_.id -eq $ids.textFr })[0]
    Check ($tFrB.accepted -eq 1 -and -not (@($ob.texts | Where-Object { $_.id -eq $ids.draftStudent }).Count)) "I4: compteurs de l'ecole B seuls (texte FR : 1), brouillon de A absent"

    # --- W : canal papier par la route EXISTANTE ------------------------------
    $paperBody=@{ textId=$ids.draftStudent; purpose="student_account"; guardianName="Tuteur Test B7"; paperDate="2026-11-01"; paperFileReference="DOS-B7-010" }
    $w=Api POST "/students/$($ids.s4)/consents/paper" $dirA $paperBody
    Check ($w.StatusCode -eq 404 -or $w.StatusCode -eq 409) "W1: papier sur un brouillon refuse ($($w.StatusCode))"
    $paperBody.textId=$ids.textFr
    $w=Api POST "/students/$($ids.zb)/consents/paper" $dirA $paperBody
    Check ($w.StatusCode -eq 404) "W2: papier sur un eleve de l'ecole B refuse (404)"
    $tokT=Login "prof.a.b7@orya.test"
    $w=Api POST "/students/$($ids.s4)/consents/paper" $tokT $paperBody
    Check ($w.StatusCode -eq 403) "W3: enseignant ne peut pas enregistrer de papier (403)"
    $w=Api POST "/students/$($ids.s4)/consents/paper" $dirA $paperBody
    Check ($w.StatusCode -eq 201) "W4: direction enregistre un papier sur texte valide (201)"
    $o2=((Api GET "/consents/overview" $dirA).Content | ConvertFrom-Json)
    $row4b=@($o2.students | Where-Object { $_.id -eq $ids.s4 })[0]
    Check ($row4b.purposes.student_account.status -eq "accepted" -and @($row4b.records)[0].guardian -eq "Tuteur Test B7" -and (@($o2.purposes | Where-Object { $_.purpose -eq "student_account" })[0].pending -eq 0)) "W5: l'apercu reflete le papier (en attente -> accepte)"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='consent.grant.paper';")) -eq 1) "W6: papier audite (consent.grant.paper)"
    Check (([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action LIKE 'consent.%' AND action <> 'consent.grant.paper';")) -eq 0) "W7: la lecture de l'apercu n'ecrit rien"

    $hit=Select-String -Path "$env:TEMP\orya-b7-api.out","$env:TEMP\orya-b7-api.err" -Pattern "parent.a.b7@orya.test","0611111117",$ids.password -SimpleMatch -EA SilentlyContinue
    Check (-not $hit) "P3: ni e-mail, ni telephone, ni mot de passe dans les journaux API"
}
catch {
    $script:ko++; Write-Host "  B7 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    if ($env:DELETION_REGISTER_JOURNAL -and $env:DELETION_REGISTER_JOURNAL -like "*orya-b7-register-*") { Remove-Item $env:DELETION_REGISTER_JOURNAL -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC7 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0
