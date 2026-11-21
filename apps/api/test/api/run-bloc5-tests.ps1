# =============================================================================
# ORYA - Bloc 5 (Avenant n 1) facturation ecole, sur orya-test-pg UNIQUEMENT (base orya_bloc5).
# Contrat, comptage a la date de reference, facture annuelle, numerotation sans trou (y compris
# en concurrence), complement, avoir, PDF, CSV comptable, rapprochement manuel (super-admin + MFA,
# audite), statuts essai/facture/en retard/suspendu/paye, isolation des ecoles.
# Mot de passe et secrets generes, jamais affiches. Identifiants legaux : valeurs FICTIVES.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc5"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B5 OK - $Label" } else { $script:ko++; Write-Host "  B5 KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3290
$apiProc=$null
$keys=@("DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","APPLY_ROLES","ACCOUNT_DELETION_JOB_DISABLED","FILE_RETENTION_JOB_DISABLED","DATA_EXPORT_JOB_DISABLED","SCHOOL_BILLING_JOB_DISABLED",
  "STORAGE_LOCAL_DIR","ORYA_B5_PASSWORD","ORYA_T_TOKEN","ORYA_T_BASE","AUTH_LOGIN_LIMIT","API_RATE_LIMIT")
$saved=@{}; foreach ($k in $keys) { $saved[$k]=[Environment]::GetEnvironmentVariable($k) }
function Psql([string]$DbName,[string]$Sql){ $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 }

try {
    if(Get-NetTCPConnection -State Listen -LocalPort $port -EA SilentlyContinue){ throw "Port $port occupe" }
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db; CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db"
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw=Rand; $appPw=Rand
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $env:DIRECT_DATABASE_URL="postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL="postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"; $env:FILE_RETENTION_JOB_DISABLED="1"; $env:DATA_EXPORT_JOB_DISABLED="1"; $env:SCHOOL_BILLING_JOB_DISABLED="1"
    $env:AUTH_LOGIN_LIMIT="200"; $env:API_RATE_LIMIT="2000"
    $env:ORYA_B5_PASSWORD = Rand 16
    $env:STORAGE_LOCAL_DIR=Join-Path $env:TEMP "orya-b5-storage"; New-Item -ItemType Directory -Force -Path $env:STORAGE_LOCAL_DIR | Out-Null
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy (dont 20261109000000_bloc5_school_billing)"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS + declencheurs de facturation"
        $seedOut = & npx tsx test/api/seed-bloc5.ts 2>&1 | Out-String
        Check ($LASTEXITCODE -eq 0) "seed bloc 5"
    } finally { Pop-Location }
    $ids = ($seedOut.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json

    $env:API_PORT="$port"; $env:NODE_ENV="development"
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b5-api.out" -RedirectStandardError "$env:TEMP\orya-b5-api.err"
    $ready=$false
    for($i=0;$i -lt 40;$i++){ Start-Sleep 1; try { if((Invoke-WebRequest "http://127.0.0.1:$port/api/v1/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ $ready=$true; break } } catch {} }
    Check $ready "API up :$port"
    if(-not $ready){ throw "API down" }
    $env:ORYA_T_BASE = "http://127.0.0.1:$port/api/v1"

    function Get-Totp([string]$Secret){
        $env:ORYA_TOTP_SECRET=$Secret
        Push-Location $apiRoot; try { return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_TOTP_SECRET))").Trim() } finally { Pop-Location; Remove-Item Env:ORYA_TOTP_SECRET -EA SilentlyContinue }
    }
    function Login([string]$Email){
        $r=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/login" -ContentType "application/json" -Body (@{email=$Email;password=$env:ORYA_B5_PASSWORD}|ConvertTo-Json)
        if(-not $r.mfaRequired){ return $r.accessToken }
        $enroll=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/mfa/enroll" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken }|ConvertTo-Json)
        $code=Get-Totp $enroll.secret
        $verify=Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/mfa/verify" -ContentType "application/json" -Body (@{ challengeToken=$r.challengeToken; code=$code }|ConvertTo-Json)
        return $verify.accessToken
    }
    function Api([string]$Method,[string]$Path,[string]$Token,$Body=$null){
        $h=@{}; if($Token){ $h.Authorization="Bearer $Token" }
        try {
            if($null -eq $Body){ $r=Invoke-WebRequest -Method $Method -Uri "$($env:ORYA_T_BASE)$Path" -Headers $h -UseBasicParsing }
            else { $r=Invoke-WebRequest -Method $Method -Uri "$($env:ORYA_T_BASE)$Path" -Headers $h -ContentType "application/json" -Body ($Body|ConvertTo-Json) -UseBasicParsing }
            return [pscustomobject]@{ StatusCode=[int]$r.StatusCode; Content=$r.Content; Headers=$r.Headers }
        } catch {
            $resp=$_.Exception.Response; $code=if($resp){[int]$resp.StatusCode}else{0}
            $text=""; if($_.ErrorDetails -and $_.ErrorDetails.Message){ $text=$_.ErrorDetails.Message }; if(-not $text -and $resp){ $text=(New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
            return [pscustomobject]@{ StatusCode=$code; Content=$text; Headers=$null }
        }
    }
    function Download([string]$Path,[string]$Token){
        $out = Join-Path $env:TEMP ("orya-b5-dl-" + (Rand 4))
        try {
            $r = Invoke-WebRequest -Uri "$($env:ORYA_T_BASE)$Path" -Headers @{ Authorization="Bearer $Token" } -UseBasicParsing -OutFile $out -PassThru
            $bytes = [IO.File]::ReadAllBytes($out)
            return [pscustomobject]@{ StatusCode=[int]$r.StatusCode; Bytes=$bytes; Text=[Text.Encoding]::GetEncoding(28591).GetString($bytes); Type=("" + $r.Headers["Content-Type"]); Cache=("" + $r.Headers["Cache-Control"]) }
        } catch {
            $resp=$_.Exception.Response; return [pscustomobject]@{ StatusCode=$(if($resp){[int]$resp.StatusCode}else{0}); Bytes=@(); Text=""; Type=""; Cache="" }
        } finally { Remove-Item $out -EA SilentlyContinue }
    }
    function KeyOf([string]$Sql){ return ("" + (Psql $db $Sql)).Trim() }
    function J($r){ return ($r.Content | ConvertFrom-Json -EA SilentlyContinue) }

    # ===== M : MFA obligatoire pour le super-admin =====
    $raw = Invoke-RestMethod -Method POST -Uri "$($env:ORYA_T_BASE)/auth/login" -ContentType "application/json" -Body (@{email="super.b5@orya.test";password=$env:ORYA_B5_PASSWORD}|ConvertTo-Json)
    Check ($raw.mfaRequired -eq $true -and -not $raw.accessToken) "M1: super-admin -> MFA exigee, aucun jeton d'acces sans second facteur"
    $suTok=Login "super.b5@orya.test"; $dirTok=Login "dir.b5@orya.test"; $dirBTok=Login "dirb.b5@orya.test"; $teacherTok=Login "teacher.b5@orya.test"
    Check ($suTok -and $dirTok -and $dirBTok -and $teacherTok) "connexions (super-admin MFA, 2 directions MFA, enseignant)"

    # ===== K : contrat parametrable (100 HT / TVA 20 % / 120 TTC) =====
    $k1 = Api PATCH "/admin/billing/schools/$($ids.A)/contract" $suTok @{ unitPriceHtMinor=10000; vatRateBp=2000; paymentTermDays=30; noticeDays=15 }
    $kc = J $k1
    Check ($k1.StatusCode -eq 200 -and [int]$kc.unitPriceTtcMinor -eq 12000 -and $kc.status -eq "trial" -and $kc.reference -eq "CTR-B5TSTA" -and $kc.referenceMonthDay -eq "10-31") "K1: contrat ecole A 100,00 HT + 20 % = 120,00 TTC, statut essai, reference au 31/10"
    $k2 = J (Api PATCH "/admin/billing/schools/$($ids.B)/contract" $suTok @{ unitPriceHtMinor=15000; vatRateBp=1000 })
    Check ([int]$k2.unitPriceTtcMinor -eq 16500) "K2: prix configurable (150,00 HT, TVA 10 % -> 165,00 TTC)"
    Check ((Api PATCH "/admin/billing/schools/$($ids.A)/contract" $dirTok @{ unitPriceHtMinor=1 }).StatusCode -eq 403 -and (Api PATCH "/admin/billing/schools/$($ids.A)/contract" $teacherTok @{ unitPriceHtMinor=1 }).StatusCode -eq 403) "K3: direction et enseignant -> contrat refuse (403)"
    Check ((Api PATCH "/admin/billing/schools/$($ids.A)/contract" "" @{ unitPriceHtMinor=1 }).StatusCode -eq 401) "K3: sans authentification -> 401"
    Check ((Api PATCH "/admin/billing/schools/$($ids.A)/contract" $suTok @{ referenceMonthDay="13-40" }).StatusCode -eq 400) "K4: date de reference invalide -> 400"
    foreach($p in $ids.P){ $null = Api PATCH "/admin/billing/schools/$p/contract" $suTok @{} }
    Check ([int](KeyOf "SELECT count(*) FROM `"SchoolContract`";") -eq 7) "K5: un contrat par ecole (7 contrats)"

    # ===== C : comptage a la date de reference =====
    $pv = J (Api GET "/admin/billing/schools/$($ids.A)/preview?schoolYear=2026-2027" $suTok)
    Check ($pv.referenceDate -eq "2026-10-31" -and [int]$pv.quantity -eq 3 -and [int]$pv.totalTtcMinor -eq 36000 -and [int]$pv.totalHtMinor -eq 30000 -and [int]$pv.totalVatMinor -eq 6000) "C1: au 31/10 : inscrit + parti apres + arrive le jour J = 3 eleves (300,00 HT, 60,00 TVA, 360,00 TTC)"
    $pv2 = J (Api GET "/admin/billing/schools/$($ids.A)/preview?schoolYear=2026-2027&referenceDate=2026-09-15" $suTok)
    Check ([int]$pv2.quantity -eq 4) "C2: au 15/09 : partis le 15/10 et le 31/10 encore comptes, arrivees ulterieures non (4)"
    Check ((Api GET "/admin/billing/schools/$($ids.A)/preview?schoolYear=2026-2027&referenceDate=2027-10-01" $suTok).StatusCode -eq 400) "C3: date de reference hors annee scolaire -> 400"

    # ===== F : facture annuelle, numerotation =====
    $f1 = Api POST "/admin/billing/schools/$($ids.A)/invoices" $suTok @{ schoolYear="2026-2027" }
    $inv = (J $f1).invoice
    $yr = (Get-Date).ToUniversalTime().Year
    Check ($f1.StatusCode -eq 201 -and $inv.number -eq "ORYA-FA-$yr-000001" -and [int]$inv.quantity -eq 3 -and [int]$inv.totalTtcMinor -eq 36000 -and (J $f1).status -eq "invoiced") "F1: facture annuelle ORYA-FA-$yr-000001 (3 eleves, 360,00 TTC), statut facture"
    $counted = (KeyOf "SELECT `"countedStudentIds`"::text FROM `"SchoolInvoice`" WHERE id='$($inv.id)';")
    Check ($counted.Contains($ids.e1) -and $counted.Contains($ids.e3) -and $counted.Contains($ids.e6) -and -not $counted.Contains($ids.e2) -and -not $counted.Contains($ids.e4) -and -not $counted.Contains($ids.e5) -and -not $counted.Contains($ids.e7)) "F1: eleves factures figes sur la facture (e1,e3,e6 ; ni partis, ni futurs, ni non inscrits)"
    Check ((Api POST "/admin/billing/schools/$($ids.A)/invoices" $suTok @{ schoolYear="2026-2027" }).StatusCode -eq 409) "F2: seconde facture annuelle pour la meme annee -> 409"
    Check ((Api POST "/admin/billing/schools/$($ids.B)/invoices" $suTok @{ schoolYear="2026-2027" }).StatusCode -eq 409) "F3: aucun eleve actif -> 409 (rien a facturer)"
    Check ((Api POST "/admin/billing/schools/$($ids.A)/invoices" $dirTok @{ schoolYear="2026-2027" }).StatusCode -eq 403) "F4: direction -> emission refusee (403)"
    # Concurrence : 5 ecoles + 3 doublons de P1, en parallele
    $env:ORYA_T_TOKEN=$suTok
    Push-Location $apiRoot
    try { $po = & node test/api/b5-parallel.mjs $ids.P[0] $ids.P[1] $ids.P[2] $ids.P[3] $ids.P[4] $ids.P[0] $ids.P[0] $ids.P[0] 2>&1 | Out-String } finally { Pop-Location; Remove-Item Env:ORYA_T_TOKEN -EA SilentlyContinue }
    $pr = ($po.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    $n201 = @($pr.statuses | Where-Object { $_ -eq 201 }).Count; $n409 = @($pr.statuses | Where-Object { $_ -eq 409 }).Count
    Check ($n201 -eq 5 -and $n409 -eq 3) "F5: 8 emissions simultanees -> 5 creees, 3 doublons refuses (409) ; statuts $($pr.statuses -join ',')"
    $gap = KeyOf "SELECT count(*) || '/' || max(seq) || '/' || (SELECT `"lastValue`" FROM `"InvoiceSequence`" WHERE series='FA' AND year=$yr) FROM `"SchoolInvoice`" WHERE series='FA' AND year=$yr;"
    Check ($gap -eq "6/6/6") "F5: numerotation FA sans trou ni doublon apres concurrence (nombre/max/compteur = $gap)"
    Check ([int](KeyOf "SELECT count(DISTINCT `"schoolId`") FROM `"SchoolInvoice`" WHERE kind='invoice';") -eq 6) "F5: une seule facture annuelle par ecole"

    # ===== P : PDF =====
    $pdf = Download "/admin/billing/invoices/$($inv.id)/pdf" $suTok
    Check ($pdf.StatusCode -eq 200 -and $pdf.Text.StartsWith("%PDF-") -and $pdf.Text.Contains($inv.number) -and $pdf.Type -match 'application/pdf' -and $pdf.Cache -match 'no-store') "P1: PDF super-admin (%PDF, numero, no-store)"
    Check ($pdf.Text.Contains("FICTIF") -and $pdf.Text.Contains("120,00") -and $pdf.Text.Contains("360,00")) "P2: PDF : emetteur FICTIF, PU TTC 120,00, total 360,00"
    $pdfD = Download "/billing/school/invoices/$($inv.id)/pdf" $dirTok
    Check ($pdfD.StatusCode -eq 200 -and $pdfD.Text.Contains($inv.number)) "P3: direction de l'ecole -> son PDF"
    Check ((Download "/billing/school/invoices/$($inv.id)/pdf" $dirBTok).StatusCode -eq 404) "P4: direction d'une autre ecole -> 404"
    Check ((Download "/billing/school/invoices/$($inv.id)/pdf" $teacherTok).StatusCode -eq 403) "P4: enseignant -> 403"

    # ===== E : dates d'inscription, complement, avoir =====
    $ed = Api PATCH "/billing/school/enrollments/$($ids.e2)" $dirTok @{ schoolYear="2026-2027"; startsOn="2026-09-01" }
    Check ($ed.StatusCode -eq 200 -and [int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='enrollment.dates.updated';") -eq 1) "E1: direction saisit une date d'entree (auditee)"
    Check ((Api PATCH "/billing/school/enrollments/$($ids.e2)" $dirTok @{ schoolYear="2026-2027"; endsOn="2026-08-01" }).StatusCode -eq 400) "E2: sortie avant entree -> 400"
    Check ((Api PATCH "/billing/school/enrollments/$($ids.e2)" $dirBTok @{ schoolYear="2026-2027"; startsOn="2026-09-02" }).StatusCode -eq 404) "E3: autre ecole -> 404"
    Check ((Api PATCH "/billing/school/enrollments/$($ids.e2)" $teacherTok @{ schoolYear="2026-2027"; startsOn="2026-09-02" }).StatusCode -eq 403) "E3: enseignant -> 403"
    $cp = Api POST "/admin/billing/invoices/$($inv.id)/complementary" $suTok @{ countDate="2026-11-08"; reason="Arrivee en cours d'annee" }
    $cpi = (J $cp).invoice
    Check ($cp.StatusCode -eq 201 -and [int]$cpi.quantity -eq 1 -and $cpi.number -eq "ORYA-FA-$yr-000007" -and $cpi.relatedInvoiceId -eq $inv.id) "E4: facture complementaire (1 eleve arrive apres la reference) ORYA-FA-$yr-000007"
    Check ((Api POST "/admin/billing/invoices/$($inv.id)/complementary" $suTok @{ countDate="2026-11-08"; reason="Doublon test" }).StatusCode -eq 409) "E5: second complement sans nouvel eleve -> 409 (pas de double facturation)"
    Check ((Api POST "/admin/billing/invoices/$($inv.id)/complementary" $suTok @{ countDate="2026-10-01"; reason="Avant reference" }).StatusCode -eq 400) "E5: date de comptage anterieure a la reference -> 400"
    Check ((Api POST "/admin/billing/invoices/$($cpi.id)/credit-notes" $suTok @{ quantity=1; reason="Mauvais document" }).StatusCode -eq 409) "E6: avoir rattache a un complement -> 409 (facture annuelle uniquement)"
    Check ((Api POST "/admin/billing/invoices/$($inv.id)/credit-notes" $suTok @{ quantity=5; reason="Trop eleve" }).StatusCode -eq 409) "E6: avoir de 5 eleves pour 4 factures -> 409"
    $av = Api POST "/admin/billing/invoices/$($inv.id)/credit-notes" $suTok @{ quantity=1; reason="Eleve parti, accord commercial" }
    $avi = (J $av).invoice
    Check ($av.StatusCode -eq 201 -and $avi.number -eq "ORYA-AV-$yr-000001" -and [int]$avi.totalTtcMinor -eq 12000) "E7: avoir ORYA-AV-$yr-000001 (1 eleve, 120,00 TTC), serie distincte"
    $pdfA = Download "/admin/billing/invoices/$($avi.id)/pdf" $suTok
    Check ($pdfA.Text.Contains("AVOIR") -and $pdfA.Text.Contains($inv.number)) "E7: PDF d'avoir avec la facture d'origine"

    # ===== R : rapprochement manuel =====
    Check ((Api POST "/admin/billing/invoices/$($inv.id)/payments" $dirTok @{ amountMinor=100; receivedOn="2026-11-01"; bankReference="VIR-TEST-1" }).StatusCode -eq 403) "R1: direction -> rapprochement refuse (403)"
    Check ((Api POST "/admin/billing/invoices/$($inv.id)/payments" "" @{ amountMinor=100; receivedOn="2026-11-01"; bankReference="VIR-TEST-1" }).StatusCode -eq 401) "R1: sans authentification -> 401"
    Check ((Api POST "/admin/billing/invoices/$($avi.id)/payments" $suTok @{ amountMinor=100; receivedOn="2026-11-01"; bankReference="VIR-TEST-1" }).StatusCode -eq 409) "R2: virement sur un avoir -> 409"
    Check ((Api POST "/admin/billing/invoices/$($inv.id)/payments" $suTok @{ amountMinor=36001; receivedOn="2026-11-01"; bankReference="VIR-TEST-1" }).StatusCode -eq 409) "R2: montant superieur au solde (360,00 = 4 x 120 - 120) -> 409"
    Check ((Api POST "/admin/billing/invoices/$($inv.id)/payments" $suTok @{ amountMinor=100; receivedOn="2099-01-01"; bankReference="VIR-TEST-1" }).StatusCode -eq 400) "R2: date de reception future -> 400"

    # ===== S : statuts et suspension =====
    # Dates relatives a l'echeance reelle de l'ecole A (emission du jour + delai de paiement, lue en base) :
    # le resultat ne depend plus du jour d'execution (avant : asOf codes en dur 2026-12-15 / 2026-12-30).
    $dueTxt = KeyOf "SELECT min(`"dueDate`")::text FROM `"SchoolInvoice`" WHERE `"schoolId`"='$($ids.A)' AND kind IN ('invoice','complementary');"
    $notice = [int](KeyOf "SELECT `"noticeDays`" FROM `"SchoolContract`" WHERE `"schoolId`"='$($ids.A)';")
    $due = [datetime]::ParseExact($dueTxt, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
    Check ($due -gt (Get-Date).ToUniversalTime().Date -and $notice -eq 15) "S0: echeance lue en base ($dueTxt) posterieure au jour d'execution ; preavis 15 j"
    $null = Api POST "/admin/billing/evaluate" $suTok @{ asOf=$due.ToString("yyyy-MM-dd") }
    Check ((KeyOf "SELECT status FROM `"SchoolContract`" WHERE `"schoolId`"='$($ids.A)';") -eq "invoiced") "S0: jour meme de l'echeance -> encore facture (pas de retard)"
    $s1 = J (Api POST "/admin/billing/evaluate" $suTok @{ asOf=$due.AddDays(1).ToString("yyyy-MM-dd") })
    Check ((KeyOf "SELECT status FROM `"SchoolContract`" WHERE `"schoolId`"='$($ids.A)';") -eq "overdue" -and (KeyOf "SELECT status FROM `"Subscription`" WHERE `"schoolId`"='$($ids.A)';") -eq "past_due") "S1: echeance depassee (asOf echeance + 1 j) -> en retard ; abonnement past_due"
    $null = Api POST "/admin/billing/evaluate" $suTok @{ asOf=$due.AddDays($notice).ToString("yyyy-MM-dd") }
    Check ((KeyOf "SELECT status FROM `"SchoolContract`" WHERE `"schoolId`"='$($ids.A)';") -eq "overdue") "S1: dernier jour du preavis (echeance + 15 j) -> encore en retard, pas suspendu"
    $s2 = J (Api POST "/admin/billing/evaluate" $suTok @{ asOf=$due.AddDays($notice + 1).ToString("yyyy-MM-dd") })
    Check ((KeyOf "SELECT status FROM `"SchoolContract`" WHERE `"schoolId`"='$($ids.A)';") -eq "suspended" -and (KeyOf "SELECT status FROM `"Subscription`" WHERE `"schoolId`"='$($ids.A)';") -eq "suspended") "S2: echeance + preavis de 15 j depasses -> suspendu ; abonnement suspendu"
    Check ((KeyOf "SELECT status FROM `"Subscription`" WHERE `"schoolId`"='$($ids.P[1])';") -eq "suspended") "S2: ecole sans abonnement -> abonnement cree en suspendu (lecture seule effective)"
    $vw = Api GET "/billing/school" $dirTok
    Check ($vw.StatusCode -eq 200 -and (J $vw).readOnly -eq $true -and @((J $vw).documents).Count -eq 3 -and (J $vw).transfer.rib -match 'FICTIF') "S3: suspendu -> la direction LIT toujours contrat, 3 documents, RIB FICTIF"
    $w = Api PATCH "/billing/school/enrollments/$($ids.e2)" $dirTok @{ schoolYear="2026-2027"; startsOn="2026-09-03" }
    Check ($w.StatusCode -eq 403 -and $w.Content -match 'SUBSCRIPTION_INACTIVE') "S4: suspendu -> ecriture direction refusee (403 SUBSCRIPTION_INACTIVE)"
    Check ([int](KeyOf "SELECT count(*) FROM `"Enrollment`" e JOIN `"Student`" s ON s.id=e.`"studentId`" WHERE s.`"schoolId`"='$($ids.A)';") -eq 7 -and [int](KeyOf "SELECT count(*) FROM `"SchoolInvoice`" WHERE `"schoolId`"='$($ids.A)';") -eq 3) "S5: suspension : aucune donnee supprimee (7 inscriptions, 3 documents)"
    # ===== S10-S19 : la suspension ne bloque JAMAIS securite, export, suppression, retrait du consentement =====
    $parTok = Login "parent.b5@orya.test"
    Check ([bool]$parTok) "S10: suspendu -> connexion d'un responsable acceptee"
    $d2Tok = Login "dir2.b5@orya.test"
    Check ([bool]$d2Tok) "S11: suspendu -> premiere connexion direction avec enrolement + verification MFA acceptee"
    $parTok2 = Login "parent.b5@orya.test"
    $devs = (J (Api GET "/me/devices" $parTok2)).devices
    $other = @($devs | Where-Object { -not $_.current -and $_.status -ne "revoked" }) | Select-Object -First 1
    $rv = if($other){ Api DELETE "/me/devices/$($other.id)" $parTok2 } else { [pscustomobject]@{StatusCode=0;Content="aucun autre appareil"} }
    Check ($rv.StatusCode -ge 200 -and $rv.StatusCode -lt 300 -and (KeyOf "SELECT status FROM `"Device`" WHERE id='$($other.id)';") -eq "revoked") "S12: suspendu -> revocation d'une autre session acceptee (HTTP $($rv.StatusCode))"
    $parTok = Login "parent.b5@orya.test"
    $ex = Api POST "/me/data-export" $parTok
    Check ($ex.StatusCode -eq 202 -and [int](KeyOf "SELECT count(*) FROM `"DataExportRequest`";") -ge 1) "S13: suspendu -> demande d'export des donnees acceptee (202)"
    $r1 = Api POST "/family/children/$($ids.e1)/consents/$($ids.consentE1)/revoke" $parTok @{}
    Check ($r1.StatusCode -ge 200 -and $r1.StatusCode -lt 300 -and (KeyOf "SELECT (`"revokedAt`" IS NOT NULL)::text FROM `"ParentalConsent`" WHERE id='$($ids.consentE1)';") -eq "true") "S14: suspendu -> retrait du consentement par le responsable accepte (HTTP $($r1.StatusCode))"
    $r2 = Api POST "/students/$($ids.e3)/consents/$($ids.consentE3)/revoke" $dirTok @{}
    Check ($r2.StatusCode -ge 200 -and $r2.StatusCode -lt 300 -and (KeyOf "SELECT (`"revokedAt`" IS NOT NULL)::text FROM `"ParentalConsent`" WHERE id='$($ids.consentE3)';") -eq "true") "S15: suspendu -> retrait d'un consentement par l'ecole accepte (HTTP $($r2.StatusCode))"
    $sd = Api POST "/students/deletion" $parTok @{ studentId=$ids.e3; password=$env:ORYA_B5_PASSWORD }
    Check ($sd.StatusCode -eq 202) "S16: suspendu -> demande de suppression du compte d'un enfant acceptee (HTTP $($sd.StatusCode))"
    $p2Tok = Login "parent2.b5@orya.test"
    $md = Api POST "/me/deletion" $p2Tok @{ password=$env:ORYA_B5_PASSWORD }
    Check ($md.StatusCode -eq 202) "S17: suspendu -> demande de suppression de son propre compte acceptee (HTTP $($md.StatusCode))"
    $lo = Api POST "/auth/logout" $parTok2 @{}
    Check ($lo.StatusCode -ge 200 -and $lo.StatusCode -lt 300) "S18: suspendu -> deconnexion acceptee (HTTP $($lo.StatusCode))"
    $tw = Api POST "/attendance/sessions" $teacherTok @{}
    $dw = Api POST "/students/$($ids.e1)/consents/paper" $dirTok @{}
    Check ($tw.StatusCode -eq 403 -and $tw.Content -match 'SUBSCRIPTION_INACTIVE' -and $dw.StatusCode -eq 403 -and $dw.Content -match 'SUBSCRIPTION_INACTIVE') "S19: suspendu -> ecritures ordinaires refusees (enseignant appel, direction consentement papier : 403 SUBSCRIPTION_INACTIVE)"
    $ls = Api GET "/students" $dirTok
    Check ($ls.StatusCode -eq 200 -and $ls.Content.Contains("B5E1") -and $ls.Content.Contains("B5E7")) "S19: suspendu -> aucune donnee masquee (liste eleves complete en lecture)"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='consent.revoke';") -eq 2) "S19: retraits audites pendant la suspension"
    $pay = Api POST "/admin/billing/invoices/$($inv.id)/payments" $suTok @{ amountMinor=36000; receivedOn=(Get-Date).ToUniversalTime().ToString("yyyy-MM-dd"); bankReference="VIR-TEST-0001"; note="Virement fictif de test" }
    Check ($pay.StatusCode -eq 201 -and (J $pay).status -eq "paid" -and (KeyOf "SELECT status FROM `"Subscription`" WHERE `"schoolId`"='$($ids.A)';") -eq "active") "S6: rapprochement du virement (super-admin MFA, ecole suspendue) -> paye ; abonnement reactive"
    Check ((Api PATCH "/billing/school/enrollments/$($ids.e2)" $dirTok @{ schoolYear="2026-2027"; startsOn="2026-09-03" }).StatusCode -eq 200) "S6: apres paiement -> ecritures direction retablies"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='billing.payment.reconciled' AND severity='critical' AND `"actorId`"='$($ids.superId)';") -eq 1) "S7: rapprochement audite (critical, auteur = super-admin)"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='billing.status.changed';") -ge 3) "S7: changements de statut audites"
    $null = Api POST "/admin/billing/evaluate" $suTok @{}
    Check ((KeyOf "SELECT status FROM `"SchoolContract`" WHERE `"schoolId`"='$($ids.A)';") -eq "paid") "S8: reevaluation a la date du jour -> reste paye"
    Check ((KeyOf "SELECT status FROM `"SchoolContract`" WHERE `"schoolId`"='$($ids.B)';") -eq "trial") "S8: ecole sans document -> essai"
    Check ((Api POST "/admin/billing/evaluate" $dirTok @{}).StatusCode -eq 403) "S9: evaluation reservee au super-admin (403)"

    # ===== X : export comptable CSV, vues =====
    $csv = Download "/admin/billing/export.csv" $suTok
    $csvText = [Text.Encoding]::UTF8.GetString($csv.Bytes)
    Check ($csv.StatusCode -eq 200 -and $csv.Bytes[0] -eq 0xEF -and $csv.Bytes[1] -eq 0xBB -and $csvText.Contains("numero;type;date_emission") -and $csvText.Contains("ORYA-AV-$yr-000001;avoir") -and $csvText.Contains("-120,00")) "X1: CSV comptable (BOM, ';', avoir negatif)"
    Check ($csvText.Contains("'=SUM(1+1)") -and -not ($csvText -match ';=SUM')) "X2: CSV : formule neutralisee dans le nom d'ecole"
    Check ([int](KeyOf "SELECT count(*) FROM `"AuditLog`" WHERE action='billing.export.csv';") -eq 1 -and (Download "/admin/billing/export.csv" $dirTok).StatusCode -eq 403) "X3: export audite ; direction -> 403"
    $lc = J (Api GET "/admin/billing/contracts" $suTok)
    $la = $lc.schools | Where-Object { $_.id -eq $ids.A }
    Check (@($lc.schools).Count -eq 7 -and [int]$la.balanceMinor -eq 0 -and [int]$la.paidMinor -eq 36000 -and [int]$la.documents -eq 3) "X4: liste super-admin (7 ecoles ; A : 3 documents, encaisse 360,00, solde 0)"
    $vb = J (Api GET "/billing/school" $dirBTok)
    Check (@($vb.documents).Count -eq 0 -and @($vb.payments).Count -eq 0 -and $vb.contract.reference -eq "CTR-B5TSTB") "X5: direction B ne voit que son contrat, aucun document de A"
    Check ((Api GET "/billing/school" $teacherTok).StatusCode -eq 403 -and (Api GET "/admin/billing/contracts" $dirTok).StatusCode -eq 403) "X5: enseignant -> 403 ; direction -> liste super-admin 403"
    $imm = @(Psql $db "UPDATE `"SchoolInvoice`" SET `"totalTtcMinor`"=1 WHERE id='$($inv.id)';") -join " "
    Check ($imm -match 'immuable|insufficient|ERROR|ERREUR') "X6: facture emise immuable (UPDATE proprietaire refuse par declencheur)"

    $logs = (Get-Content "$env:TEMP\orya-b5-api.out","$env:TEMP\orya-b5-api.err" -Raw -EA SilentlyContinue) -join ""
    Check (-not $logs.Contains($env:ORYA_B5_PASSWORD) -and -not $logs.Contains($suTok)) "mots de passe et jetons absents des journaux API"
}
catch {
    $script:ko++; Write-Host "  B5 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC5 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0