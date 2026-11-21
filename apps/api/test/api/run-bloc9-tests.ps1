# =============================================================================
# ORYA - Bloc 9 (t92) : ecarts CDC restants (selecteur de profil 3.3, sessions inactives 3.4,
# justificatifs M4, ciblage M5, rappel d'appel M3, calendrier M2, resultats M7...).
# Base jetable orya_bloc9 sur orya-test-pg uniquement (garde scripts/test-guard.ps1).
# SEED_PASSWORD : genere ici, jamais affiche.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$repoRoot = (Resolve-Path (Join-Path $apiRoot "../..")).Path
. (Join-Path $repoRoot "scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_bloc9"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  B9 OK - $Label" } else { $script:ko++; Write-Host "  B9 KO - $Label" -ForegroundColor Red }
}
function Rand([int]$n=24) { (& node -e "process.stdout.write(require('crypto').randomBytes($n).toString('hex'))").Trim() }

$c=$T.Container; $db=$T.Db; $adm=$T.DbUser; $port=3294
$apiProc=$null
$saved=@{}
$keys=@("DATABASE_URL","DIRECT_DATABASE_URL","NODE_ENV","API_PORT","JWT_ACCESS_SECRET","MFA_ENCRYPTION_KEY","STORAGE_LOCAL_DIR","ACCOUNT_DELETION_JOB_DISABLED","APPLY_ROLES","DELETION_REGISTER_HMAC_KEY","DELETION_REGISTER_JOURNAL","AUTH_LOGIN_LIMIT","SEED_PASSWORD","WEB_ORIGIN","API_RATE_LIMIT","SESSION_IDLE_MINUTES","SESSION_IDLE_MOBILE_MINUTES","ATTENDANCE_REMINDER_JOB_DISABLED","WEEKLY_SUMMARY_JOB_DISABLED","BUS_ATTENDANT_UPDATES_ENABLED")
foreach ($k in $keys) { $saved[$k]=[Environment]::GetEnvironmentVariable($k) }
function Psql([string]$DbName,[string]$Sql){ $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 }
$base = "http://127.0.0.1:$port/api/v1"

function Api([string]$Method,[string]$Path,$Body=$null,[string]$Token="",[string]$Ip=""){
    if(-not $Ip){ $Ip = "198.51.100.$(Get-Random -Minimum 1 -Maximum 250)" }
    $h=@{ "X-Forwarded-For" = $Ip }
    if($Token){ $h.Authorization="Bearer $Token" }
    try {
        if($null -eq $Body){ $r=Invoke-WebRequest -Method $Method -Uri "$base$Path" -Headers $h -UseBasicParsing }
        else { $r=Invoke-WebRequest -Method $Method -Uri "$base$Path" -Headers $h -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 8))) -UseBasicParsing }
        $txt=$r.Content; $j=$null; try { $j=$txt|ConvertFrom-Json } catch {}
        return [pscustomobject]@{ StatusCode=[int]$r.StatusCode; Content=$txt; Json=$j }
    } catch {
        $resp=$_.Exception.Response; $code=if($resp){[int]$resp.StatusCode}else{0}
        $text=""; if($_.ErrorDetails -and $_.ErrorDetails.Message){ $text=$_.ErrorDetails.Message } elseif($resp){ try { $text=(New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
        $j=$null; try { $j=$text|ConvertFrom-Json } catch {}
        return [pscustomobject]@{ StatusCode=$code; Content=$text; Json=$j }
    }
}
function Get-Totp([string]$Secret){
    $env:ORYA_TOTP_SECRET=$Secret
    Push-Location $apiRoot; try { return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_TOTP_SECRET))").Trim() } finally { Pop-Location; Remove-Item Env:ORYA_TOTP_SECRET -EA SilentlyContinue }
}
$script:mfaSecrets=@{}
# Ouvre une session ; enrole/verifie le TOTP si le profil actif l'exige. Retourne l'objet de session (accessToken, refreshToken).
function Session([string]$Email){
    $r = Api POST "/auth/login" @{ email=$Email; password=$env:SEED_PASSWORD }
    if($r.StatusCode -ne 200){ throw "login $Email -> $($r.StatusCode)" }
    if(-not $r.Json.mfaRequired){ return $r.Json }
    if($r.Json.method -eq "enroll"){
        $en = Api POST "/auth/mfa/enroll" @{ challengeToken=$r.Json.challengeToken }
        $script:mfaSecrets[$Email]=$en.Json.secret
    }
    $code = Get-Totp $script:mfaSecrets[$Email]
    $v = Api POST "/auth/mfa/verify" @{ challengeToken=$r.Json.challengeToken; code=$code }
    if(-not $v.Json.accessToken){
        # Anti-rejeu TOTP : un code deja utilise dans la meme fenetre de 30 s est refuse ; attendre la suivante.
        $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); Start-Sleep -Seconds (31 - ($epoch % 30))
        $v = Api POST "/auth/mfa/verify" @{ challengeToken=$r.Json.challengeToken; code=(Get-Totp $script:mfaSecrets[$Email]) }
    }
    if(-not $v.Json.accessToken){ throw "MFA sans jeton pour $Email ($($v.StatusCode))" }
    return $v.Json
}
function Tok([string]$Email){ (Session $Email).accessToken }

try {
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db WITH (FORCE); CREATE DATABASE $db;"
    Check ($LASTEXITCODE -eq 0) "base $db"
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw=Rand; $appPw=Rand
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $env:DIRECT_DATABASE_URL="postgresql://orya_owner:${ownerPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DATABASE_URL="postgresql://orya_app:${appPw}@127.0.0.1:$($T.Port)/${db}?schema=public"
    $env:DELETION_REGISTER_HMAC_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:DELETION_REGISTER_JOURNAL=Join-Path $env:TEMP ("orya-b9-register-" + (Rand 6) + ".jsonl")
    $env:APPLY_ROLES="0"; $env:ACCOUNT_DELETION_JOB_DISABLED="1"; $env:ATTENDANCE_REMINDER_JOB_DISABLED="1"; $env:WEEKLY_SUMMARY_JOB_DISABLED="1"
    $env:SEED_PASSWORD = "Ot-" + (Rand 20) + "-A9!"
    $env:NODE_ENV="development"
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null; Check ($LASTEXITCODE -eq 0) "migrate deploy"
        & npx tsx prisma/apply-sql.ts *> $null; Check ($LASTEXITCODE -eq 0) "RLS (apply-sql)"
        & npx tsx prisma/seed.ts *> $null; Check ($LASTEXITCODE -eq 0) "seed (comptes de demonstration)"
    } finally { Pop-Location }

    $env:API_PORT="$port"; $env:AUTH_LOGIN_LIMIT="500"; $env:API_RATE_LIMIT="5000"
    $env:WEB_ORIGIN="http://127.0.0.1:3199"
    $env:SESSION_IDLE_MINUTES="30"; $env:SESSION_IDLE_MOBILE_MINUTES="43200"
    $env:BUS_ATTENDANT_UPDATES_ENABLED="1"  # t92 section T : saisie accompagnateur limitee a ses circuits
    $env:JWT_ACCESS_SECRET=Rand 48
    $env:MFA_ENCRYPTION_KEY=(& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
    $env:STORAGE_LOCAL_DIR=Join-Path $env:TEMP "orya-b9-storage"
    New-Item -ItemType Directory -Force -Path $env:STORAGE_LOCAL_DIR | Out-Null
    $apiProc=Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\orya-b9-api.out" -RedirectStandardError "$env:TEMP\orya-b9-api.err"
    $ready=$false
    for($i=0;$i -lt 40;$i++){ Start-Sleep 1; try { if((Invoke-WebRequest "$base/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ $ready=$true; break } } catch {} }
    Check $ready "API up :$port"
    if(-not $ready){ throw "API down" }

    $schoolA = Psql $db "SELECT id FROM `"School`" WHERE code='ALNOUR';"
    $schoolB = Psql $db "SELECT id FROM `"School`" WHERE code='ALMSAR';"

    # --- P : selecteur de profil (CDC 3.3) -----------------------------------------
    $teacherMail = "professeur@ecole-a.orya.test"
    $teacherId = Psql $db "SELECT id FROM `"User`" WHERE email='$teacherMail';"
    $profParent = Psql $db "INSERT INTO `"UserProfile`" (`"userId`",`"schoolId`",role,`"displayName`",`"updatedAt`") VALUES ('$teacherId','$schoolA','parent','Parent (enseignant)',now()) RETURNING id;" | Select-Object -First 1
    $profDir = Psql $db "INSERT INTO `"UserProfile`" (`"userId`",`"schoolId`",role,`"displayName`",`"updatedAt`") VALUES ('$teacherId','$schoolB','direction','Direction B',now()) RETURNING id;" | Select-Object -First 1
    $otherProfile = Psql $db "SELECT p.id FROM `"UserProfile`" p JOIN `"User`" u ON u.id=p.`"userId`" WHERE u.email='parent1@ecole-a.orya.test';"
    $ts = Session $teacherMail
    $me = Api GET "/me" $null $ts.accessToken
    $teacherProfile = Psql $db "SELECT id FROM `"UserProfile`" WHERE `"userId`"='$teacherId' AND role='teacher';"
    Check ($me.StatusCode -eq 200 -and @($me.Json.profiles).Count -eq 3 -and $me.Json.activeProfileId -eq $teacherProfile) "P0: /me liste les 3 profils du compte, profil actif = enseignant ($($me.StatusCode) n=$(@($me.Json.profiles).Count))"
    Check ((Api GET "/assignments" $null $ts.accessToken).StatusCode -eq 200 -and (Api GET "/family/children" $null $ts.accessToken).StatusCode -eq 403) "P1: profil enseignant : /assignments 200, /family/children 403"
    $sel = Api POST "/me/profiles/select" @{ profileId=$profParent } $ts.accessToken
    Check ($sel.StatusCode -eq 200 -and $sel.Json.accessToken -and $sel.Json.profile.role -eq "parent") "P2: bascule vers le profil parent -> 200, nouveau jeton, role parent ($($sel.StatusCode))"
    $pt = $sel.Json.accessToken
    $me2 = Api GET "/me" $null $pt
    Check ($me2.Json.activeProfileId -eq $profParent -and (Api GET "/family/children" $null $pt).StatusCode -eq 200 -and (Api GET "/assignments" $null $pt).StatusCode -eq 403) "P3: avec le jeton parent : /family/children 200, /assignments 403"
    $rf = Api POST "/auth/refresh" @{ refreshToken=$ts.refreshToken }
    $me3 = if($rf.Json.accessToken){ Api GET "/me" $null $rf.Json.accessToken } else { $null }
    Check ($rf.StatusCode -eq 200 -and $me3 -and $me3.Json.activeProfileId -eq $profParent) "P4: le profil choisi survit au rafraichissement de session"
    $foreign = Api POST "/me/profiles/select" @{ profileId=$otherProfile } $pt
    Check ($foreign.StatusCode -eq 404) "P5: profil d'un autre compte -> 404 ($($foreign.StatusCode))"
    $esc = Api POST "/me/profiles/select" @{ profileId=$profDir } $pt
    Check ($esc.StatusCode -eq 403 -and (Api GET "/me" $null $pt).Json.activeProfileId -eq $profParent) "P6: profil direction sans second facteur -> 403, profil actif inchange ($($esc.StatusCode))"
    $bad = Api POST "/me/profiles/select" @{ profileId="pas-un-uuid" } $pt
    Check ($bad.StatusCode -eq 400) "P7: identifiant invalide -> 400 ($($bad.StatusCode))"
    $aud = Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.profile.switched' AND `"entityId`"='$profParent';"
    Check ([int]$aud -ge 1) "P8: bascule auditee (auth.profile.switched)"
    $web = Get-Content -Raw (Join-Path $repoRoot "apps/web/app/(console)/dashboard/page.tsx")
    Check ($web -match 'selectProfile\(item\.id\)' -and $web -match 'Utiliser ce profil') "P9: console : bouton 'Utiliser ce profil' branche sur POST /me/profiles/select"

    # --- I : deconnexion des sessions inactives (CDC 3.4) ------------------------
    # Limite configuree pour ce bloc : SESSION_IDLE_MINUTES=30 (web / client sans plateforme),
    # SESSION_IDLE_MOBILE_MINUTES=43200 (30 jours, android / ios).
    function DeviceOf([string]$AccessToken){
        $p = $AccessToken.Split(".")[1].Replace('-','+').Replace('_','/'); while($p.Length % 4){ $p += "=" }
        ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json).sid
    }
    function LoginAs([string]$Email,[string]$Platform){
        $b = @{ email=$Email; password=$env:SEED_PASSWORD }; if($Platform){ $b.platform=$Platform }
        (Api POST "/auth/login" $b).Json
    }
    $pMail = "parent2@ecole-a.orya.test"
    $s1 = LoginAs $pMail "web"; $d1 = DeviceOf $s1.accessToken
    $null = Psql $db "UPDATE `"Device`" SET `"lastSeenAt`" = now() - interval '10 minutes' WHERE id='$d1';"
    $r = Api GET "/me" $null $s1.accessToken
    $fresh = Psql $db "SELECT (`"lastSeenAt`" > now() - interval '1 minute')::text FROM `"Device`" WHERE id='$d1';"
    Check ($r.StatusCode -eq 200 -and $fresh -eq "true") "I0: session web active depuis 10 min : 200 et activite enregistree (lastSeenAt rafraichi)"
    $null = Psql $db "UPDATE `"Device`" SET `"lastSeenAt`" = now() - interval '31 minutes' WHERE id='$d1';"
    $r = Api GET "/me" $null $s1.accessToken
    Check ($r.StatusCode -eq 401 -and $r.Content -match 'inactivit') "I1: session web inactive depuis 31 min -> 401 'inactivite' ($($r.StatusCode))"
    $st = Psql $db "SELECT status::text || '/' || (`"revokedAt`" IS NOT NULL)::text FROM `"Device`" WHERE id='$d1';"
    Check ($st -eq "revoked/true") "I2: appareil revoque en base ($st)"
    $r2 = Api POST "/auth/refresh" @{ refreshToken=$s1.refreshToken }
    Check ($r2.StatusCode -eq 401) "I3: le jeton de rafraichissement de la session expiree est refuse ($($r2.StatusCode))"
    $aud = Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action='auth.session.idle_expired' AND `"entityId`"='$d1';"
    Check ($aud -eq "1") "I4: expiration auditee une fois (auth.session.idle_expired)"
    $s2 = LoginAs $pMail "web"; $d2 = DeviceOf $s2.accessToken
    $null = Psql $db "UPDATE `"Device`" SET `"lastSeenAt`" = now() - interval '31 minutes' WHERE id='$d2';"
    $r = Api POST "/auth/refresh" @{ refreshToken=$s2.refreshToken }
    $st2 = Psql $db "SELECT status::text FROM `"Device`" WHERE id='$d2';"
    Check ($r.StatusCode -eq 401 -and $st2 -eq "revoked") "I5: rafraichissement d'une session inactive -> 401 et revocation ($($r.StatusCode) $st2)"
    $s3 = LoginAs $pMail "android"; $d3 = DeviceOf $s3.accessToken
    $null = Psql $db "UPDATE `"Device`" SET `"lastSeenAt`" = now() - interval '2 days' WHERE id='$d3';"
    Check ((Api GET "/me" $null $s3.accessToken).StatusCode -eq 200) "I6: application mobile inactive depuis 2 jours : session conservee (limite mobile 30 j)"
    $null = Psql $db "UPDATE `"Device`" SET `"lastSeenAt`" = now() - interval '31 days' WHERE id='$d3';"
    Check ((Api GET "/me" $null $s3.accessToken).StatusCode -eq 401) "I7: application mobile inactive depuis 31 jours -> 401"
    $s4 = LoginAs $pMail ""; $d4 = DeviceOf $s4.accessToken
    $null = Psql $db "UPDATE `"Device`" SET `"lastSeenAt`" = NULL, `"createdAt`" = now() - interval '40 minutes' WHERE id='$d4';"
    Check ((Api GET "/me" $null $s4.accessToken).StatusCode -eq 401) "I8: client sans plateforme ni activite enregistree : limite web appliquee depuis la creation -> 401"
    $s5 = LoginAs $pMail "web"; $d5 = DeviceOf $s5.accessToken
    Check ((Api GET "/me" $null $s5.accessToken).StatusCode -eq 200) "I9: une nouvelle connexion reste possible apres expiration"

    # --- J : justificatif "a completer" et 5 cartes maximum (CDC M4) -------------
    $par = Tok "parent1@ecole-a.orya.test"
    $par2 = Tok "parent2@ecole-a.orya.test"
    $dirT = Tok "direction@ecole-a.orya.test"
    $kids = (Api GET "/family/children" $null $par).Json
    $kid = @($kids.children + $kids)[0]; if($kid.id){ $kidId=$kid.id } else { $kidId=(@($kids.children)[0]).id }
    $sub = Api POST "/family/justifications" @{ studentId=$kidId; fromDate="2026-11-10"; toDate="2026-11-10"; reason="Rendez-vous medical" } $par
    $jid = $sub.Json.id
    Check ($sub.StatusCode -eq 201 -and $sub.Json.status -eq "pending") "J0: justificatif depose (201, pending) ($($sub.StatusCode))"
    $noNote = Api POST "/justifications/$jid/review" @{ decision="incomplete" } $dirT
    Check ($noNote.StatusCode -eq 400) "J1: 'a completer' sans indication de ce qui manque -> 400 ($($noNote.StatusCode))"
    $inc = Api POST "/justifications/$jid/review" @{ decision="incomplete"; note="Ajoutez le certificat du medecin." } $dirT
    Check ($inc.StatusCode -eq 200 -and $inc.Json.status -eq "incomplete") "J2: direction -> 'a completer' (200, incomplete) ($($inc.StatusCode))"
    $mine = @((Api GET "/family/justifications" $null $par).Json.justifications) | Where-Object { $_.id -eq $jid }
    $cards = (Api GET "/family/actions" $null $par).Json
    $card = @($cards.actions) | Where-Object { $_.justificationId -eq $jid -and $_.status -eq "open" }
    $notif = @((Api GET "/notifications" $null $par).Json.notifications) | Where-Object { $_.kind -eq "justification.incomplete" }
    Check ($mine.status -eq "incomplete" -and $mine.reviewNote -match 'certificat' -and @($card).Count -eq 1 -and @($notif).Count -ge 1) "J3: parent : statut 'a completer' + note, carte 'A faire' liee, notification"
    $again = Api POST "/justifications/$jid/review" @{ decision="accepted" } $dirT
    Check ($again.StatusCode -eq 409) "J4: pas de decision tant que la famille n'a pas complete (409) ($($again.StatusCode))"
    $other = Api POST "/family/justifications/$jid/complete" @{ reason="Autre parent" } $par2
    Check ($other.StatusCode -eq 404) "J5: un autre parent ne peut pas completer (404) ($($other.StatusCode))"
    $empty = Api POST "/family/justifications/$jid/complete" @{} $par
    Check ($empty.StatusCode -eq 400) "J6: completer sans motif ni piece -> 400 ($($empty.StatusCode))"
    $done = Api POST "/family/justifications/$jid/complete" @{ reason="Rendez-vous medical, certificat remis au secretariat" } $par
    $cardAfter = Psql $db "SELECT status::text FROM `"ParentAction`" WHERE `"justificationId`"='$jid';"
    Check ($done.StatusCode -eq 200 -and $done.Json.status -eq "pending" -and $cardAfter -eq "done") "J7: famille complete -> retour 'en attente', carte fermee ($($done.StatusCode) $cardAfter)"
    Check ([int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action IN ('student.justification.incomplete','student.justification.completed');") -ge 2) "J8: 'a completer' et completion audites"
    $twice = Api POST "/family/justifications/$jid/complete" @{ reason="Encore" } $par
    Check ($twice.StatusCode -eq 409) "J9: completer un justificatif deja en attente -> 409 ($($twice.StatusCode))"
    $acc = Api POST "/justifications/$jid/review" @{ decision="accepted" } $dirT
    Check ($acc.StatusCode -eq 200 -and $acc.Json.status -eq "accepted") "J10: la direction peut ensuite accepter ($($acc.StatusCode))"
    $flt = Api GET "/justifications?status=incomplete" $null $dirT
    Check ($flt.StatusCode -eq 200) "J11: filtre direction status=incomplete accepte ($($flt.StatusCode))"
    for($i=1;$i -le 7;$i++){ $null = Api POST "/parent-actions" @{ studentId=$kidId; title="Document $i"; dueDate=("2026-12-{0:d2}" -f (10+$i)) } $dirT }
    $openDb = [int](Psql $db "SELECT count(*) FROM `"ParentAction`" a WHERE a.status='open' AND a.`"studentId`" IN (SELECT `"studentId`" FROM `"StudentGuardian`" g JOIN `"Guardian`" gu ON gu.id=g.`"guardianId`" JOIN `"User`" u ON u.id=gu.`"userId`" WHERE u.email='parent1@ecole-a.orya.test');")
    $fa = (Api GET "/family/actions" $null $par).Json
    $openShown = @(@($fa.actions) | Where-Object { $_.status -eq "open" })
    Check ($openShown.Count -eq 5 -and $fa.openTotal -eq $openDb -and $fa.hiddenOpen -eq ($openDb - 5)) "J12: 5 cartes ouvertes maximum affichees (affichees=$($openShown.Count), total=$($fa.openTotal), base=$openDb, masquees=$($fa.hiddenOpen))"
    Check ($openShown[0].title -eq "Document 1" -and $openShown[4].title -eq "Document 5") "J13: les 5 plus urgentes d'abord (echeance la plus proche)"
    $null = Api POST "/family/actions/$($openShown[0].id)/done" $null $par
    $fb = (Api GET "/family/actions" $null $par).Json
    $openShown2 = @(@($fb.actions) | Where-Object { $_.status -eq "open" })
    Check ($openShown2.Count -eq 5 -and $openShown2[4].title -eq "Document 6" -and $fb.openTotal -eq ($openDb - 1)) "J14: une carte terminee libere la place de la suivante"
    $jp = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "apps/web/app/(console)/justifications/page.tsx")
    $fp = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "apps/web/app/(console)/family/page.tsx")
    Check ($jp -match '"incomplete"' -and $fp -match 'completeJustification\(' -and $fp -match 'hiddenOpen') "J15: console : bouton 'A completer' (direction), formulaire de completion et compteur de cartes masquees (parent)"

    # --- K : messages cibles par niveau et par selection d'eleves (CDC M5) --------
    Push-Location $apiRoot; try { $sy = (& npx tsx -e "import('./src/core/school-year').then(m=>process.stdout.write(m.schoolYearForDate(new Date())))" 2>$null | Select-Object -Last 1) } finally { Pop-Location }
    $fx = @"
DO `$`$
DECLARE s uuid := '$schoolA'; sy text := '$sy'; c6a uuid; c6b uuid; c5a uuid; st uuid; g uuid; u uuid; i int;
BEGIN
  INSERT INTO "Classroom"(id,"schoolId",name,level,"updatedAt") VALUES (gen_random_uuid(),s,'B9-6A','6e',now()) RETURNING id INTO c6a;
  INSERT INTO "Classroom"(id,"schoolId",name,level,"updatedAt") VALUES (gen_random_uuid(),s,'B9-6B','6e',now()) RETURNING id INTO c6b;
  INSERT INTO "Classroom"(id,"schoolId",name,level,"updatedAt") VALUES (gen_random_uuid(),s,'B9-5A','5e',now()) RETURNING id INTO c5a;
  FOR i IN 1..4 LOOP
    INSERT INTO "Student"(id,"schoolId","studentCode","displayName","updatedAt") VALUES (gen_random_uuid(),s,'B9-'||i,'Eleve B9 '||i,now()) RETURNING id INTO st;
    INSERT INTO "User"(id,email,"passwordHash","updatedAt") VALUES (gen_random_uuid(),'b9-g'||i||'@ecole-a.orya.test','x',now()) RETURNING id INTO u;
    INSERT INTO "Guardian"(id,"schoolId","userId","fullName","updatedAt") VALUES (gen_random_uuid(),s,u,'Responsable B9 '||i,now()) RETURNING id INTO g;
    INSERT INTO "StudentGuardian"("schoolId","studentId","guardianId") VALUES (s,st,g);
    INSERT INTO "Enrollment"("schoolId","studentId","classroomId","schoolYear") VALUES (s,st,CASE i WHEN 1 THEN c6a WHEN 2 THEN c6b ELSE c5a END,sy);
  END LOOP;
  INSERT INTO "TeacherClassroomAssignment"("schoolId","teacherProfileId","classroomId","schoolYear","updatedAt")
    SELECT s, p.id, c5a, sy, now() FROM "UserProfile" p JOIN "User" x ON x.id=p."userId" WHERE x.email='professeur@ecole-a.orya.test' AND p.role='teacher';
END `$`$;
"@
    $fxOut = Psql $db $fx
    Check ($LASTEXITCODE -eq 0) "K-: jeu d'essai (3 classes 6e/6e/5e, 4 eleves avec un responsable chacun, enseignant affecte a B9-5A) $fxOut"
    $stu = @{}; foreach($i in 1..4){ $stu[$i] = Psql $db "SELECT id FROM `"Student`" WHERE `"studentCode`"='B9-$i';" }
    function RecipientsOf([string]$MessageId){ (Psql $db "SELECT coalesce(string_agg(u.email, ',' ORDER BY u.email),'') FROM `"MessageRecipient`" r JOIN `"User`" u ON u.id=r.`"userId`" WHERE r.`"messageId`"='$MessageId';") }
    $dirK = $dirT
    # Section P a laisse le profil parent actif sur ce compte (choix persistant) : revenir au profil enseignant.
    $teaK = (Api POST "/me/profiles/select" @{ profileId=$teacherProfile } (Tok "professeur@ecole-a.orya.test")).Json.accessToken
    $lv = Api POST "/messages" @{ kind="announcement"; audience="level"; level="6e"; title="Sortie des 6e"; body="Sortie au musee jeudi." } $dirK
    Check ($lv.StatusCode -eq 201 -and $lv.Json.recipients -eq 2 -and (RecipientsOf $lv.Json.id) -eq "b9-g1@ecole-a.orya.test,b9-g2@ecole-a.orya.test") "K0: annonce au niveau 6e -> les familles des 2 classes de 6e uniquement ($($lv.StatusCode) n=$($lv.Json.recipients))"
    $lvBad = Api POST "/messages" @{ kind="announcement"; audience="level"; level="9e"; title="Niveau inconnu"; body="x" } $dirK
    $lvNo = Api POST "/messages" @{ kind="announcement"; audience="level"; title="Sans niveau"; body="x" } $dirK
    Check ($lvBad.StatusCode -eq 404 -and $lvNo.StatusCode -eq 400) "K1: niveau inconnu -> 404, niveau absent -> 400 ($($lvBad.StatusCode)/$($lvNo.StatusCode))"
    $sel = Api POST "/messages" @{ kind="announcement"; audience="selection"; studentIds=@($stu[1],$stu[3]); title="Reunion"; body="Reunion parents-professeurs." } $dirK
    Check ($sel.StatusCode -eq 201 -and $sel.Json.recipients -eq 2 -and (RecipientsOf $sel.Json.id) -eq "b9-g1@ecole-a.orya.test,b9-g3@ecole-a.orya.test") "K2: selection de 2 eleves -> leurs familles uniquement ($($sel.StatusCode) n=$($sel.Json.recipients))"
    $foreignStu = Psql $db "SELECT id FROM `"Student`" WHERE `"schoolId`"='$schoolB' LIMIT 1;"
    $selF = Api POST "/messages" @{ kind="announcement"; audience="selection"; studentIds=@($stu[1],$foreignStu); title="Fuite"; body="x" } $dirK
    $selE = Api POST "/messages" @{ kind="announcement"; audience="selection"; studentIds=@(); title="Vide"; body="x" } $dirK
    Check ($selF.StatusCode -eq 404 -and $selE.StatusCode -eq 400) "K3: selection avec un eleve d'une autre ecole -> 404 (aucun envoi), selection vide -> 400 ($($selF.StatusCode)/$($selE.StatusCode))"
    $tSel = Api POST "/messages" @{ kind="announcement"; audience="selection"; studentIds=@($stu[3],$stu[4]); title="Groupe de soutien"; body="Seance mardi." } $teaK
    $tSelX = Api POST "/messages" @{ kind="announcement"; audience="selection"; studentIds=@($stu[3],$stu[1]); title="Hors classe"; body="x" } $teaK
    $tLv = Api POST "/messages" @{ kind="announcement"; audience="level"; level="5e"; title="Niveau"; body="x" } $teaK
    Check ($tSel.StatusCode -eq 201 -and $tSel.Json.recipients -eq 2 -and $tSelX.StatusCode -eq 403 -and $tLv.StatusCode -eq 403) "K4: enseignant : selection dans sa classe 201, eleve hors de ses classes 403, niveau 403 ($($tSel.StatusCode)/$($tSelX.StatusCode)/$($tLv.StatusCode)) $(if($tSel.StatusCode -ne 201){$tSel.Content})"
    $mis = Api POST "/messages" @{ kind="class_message"; audience="level"; level="6e"; title="Type"; body="x" } $dirK
    Check ($mis.StatusCode -eq 400) "K5: message de classe adresse a un niveau -> 400 ($($mis.StatusCode))"
    $sent = @((Api GET "/messages" $null $dirK).Json.messages)
    $sl = $sent | Where-Object { $_.id -eq $lv.Json.id }; $ss = $sent | Where-Object { $_.id -eq $sel.Json.id }
    Check ($sl.audience -eq "level" -and $sl.level -eq "6e" -and $ss.audience -eq "selection" -and @($ss.studentIds).Count -eq 2) "K6: messages envoyes : public 'niveau 6e' et 'selection (2)' restitues"
    $am = Psql $db "SELECT coalesce(metadata->>'level','-') || '/' || coalesce(metadata->>'selection','-') FROM `"AuditLog`" WHERE action='message.sent' AND `"entityId`" IN ('$($lv.Json.id)','$($sel.Json.id)') ORDER BY `"createdAt`";"
    Check (($am -join " ") -eq "6e/- -/2") "K7: audit message.sent avec le niveau / la taille de la selection ($($am -join ' '))"
    $mp = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "apps/web/app/(console)/messages/page.tsx")
    Check ($mp -match 'level: "Un niveau"' -and $mp -match 'selection: "Une s' -and $mp -match 'studentIds') "K8: console : publics 'Un niveau' et 'Une selection d'eleves' dans le formulaire d'envoi"

    # --- C : calendrier de l'ecole (CDC M2) : jours ouvres, vacances, effet sur l'appel ----
    $c5a = Psql $db "SELECT id FROM `"Classroom`" WHERE name='B9-5A';"
    $cal0 = Api GET "/calendar" $null $dirK
    Check ($cal0.StatusCode -eq 200 -and (@($cal0.Json.workingDays) -join ",") -eq "1,2,3,4,5,6" -and $cal0.Json.configured -eq $false -and @($cal0.Json.holidays).Count -eq 0 -and $cal0.Json.timezone -eq "Africa/Casablanca") "C0: calendrier par defaut (lundi-samedi, non configure, aucune vacance, Africa/Casablanca) ($($cal0.StatusCode))"
    $tCal = Api GET "/calendar" $null $teaK
    $tPut = Api PUT "/calendar/working-days" @{ workingDays=@(1,2,3,4,5) } $teaK
    Check ($tCal.StatusCode -eq 200 -and $tPut.StatusCode -eq 403) "C1: enseignant : lecture 200, modification 403 ($($tCal.StatusCode)/$($tPut.StatusCode))"
    $bad1 = Api PUT "/calendar/working-days" @{ workingDays=@(0,8) } $dirK
    $bad2 = Api PUT "/calendar/working-days" @{ workingDays=@() } $dirK
    $put = Api PUT "/calendar/working-days" @{ workingDays=@(5,1,2,3,4,1) } $dirK
    Check ($bad1.StatusCode -eq 400 -and $bad2.StatusCode -eq 400 -and $put.StatusCode -eq 200 -and (@($put.Json.workingDays) -join ",") -eq "1,2,3,4,5" -and $put.Json.configured -eq $true) "C2: jours ouvres lundi-vendredi enregistres (tries, dedoublonnes) ; 0/8 ou vide -> 400 ($($bad1.StatusCode)/$($bad2.StatusCode)/$($put.StatusCode))"
    $hol = Api POST "/calendar/holidays" @{ label="Vacances d'automne"; startDate="2026-11-23"; endDate="2026-11-29" } $dirK
    $holBad = Api POST "/calendar/holidays" @{ label="Inverse"; startDate="2026-11-29"; endDate="2026-11-23" } $dirK
    $holLong = Api POST "/calendar/holidays" @{ label="Trop long"; startDate="2026-01-01"; endDate="2026-12-31" } $dirK
    Check ($hol.StatusCode -eq 201 -and $hol.Json.id -and $holBad.StatusCode -eq 400 -and $holLong.StatusCode -eq 400) "C3: periode de vacances creee (201) ; fin avant debut / plus de 120 jours -> 400 ($($hol.StatusCode)/$($holBad.StatusCode)/$($holLong.StatusCode))"
    $dH = Api GET "/calendar/day?date=2026-11-24" $null $teaK
    $dS = Api GET "/calendar/day?date=2026-11-21" $null $teaK
    $dF = Api GET "/calendar/day?date=2026-11-20" $null $teaK
    Check ($dH.Json.schoolDay -eq $false -and $dH.Json.reason -eq "holiday" -and $dH.Json.holiday.label -eq "Vacances d'automne" -and $dS.Json.schoolDay -eq $false -and $dS.Json.reason -eq "non_working_day" -and $dF.Json.schoolDay -eq $true) "C4: mardi 24/11 = vacances, samedi 21/11 = jour non ouvre, vendredi 20/11 = jour de classe"
    $oH = Api POST "/attendance/sessions" @{ classroomId=$c5a; date="2026-11-24"; slot="morning" } $dirK
    $oS = Api POST "/attendance/sessions" @{ classroomId=$c5a; date="2026-11-21"; slot="morning" } $dirK
    $oF = Api POST "/attendance/sessions" @{ classroomId=$c5a; date="2026-11-20"; slot="morning" } $dirK
    Check ($oH.StatusCode -eq 409 -and $oS.StatusCode -eq 409 -and $oF.StatusCode -eq 201) "C5: appel refuse un jour de vacances et un jour non ouvre (409), accepte un jour de classe (201) ($($oH.StatusCode)/$($oS.StatusCode)/$($oF.StatusCode))"
    $dirB = Tok "direction@ecole-b.orya.test"
    $calB = Api GET "/calendar" $null $dirB
    $delB = Api DELETE "/calendar/holidays/$($hol.Json.id)" $null $dirB
    Check ($calB.StatusCode -eq 200 -and @($calB.Json.holidays).Count -eq 0 -and $calB.Json.configured -eq $false -and $delB.StatusCode -eq 404) "C6: isolation : l'ecole B ne voit ni ne supprime les vacances de l'ecole A ($($calB.StatusCode)/$($delB.StatusCode))"
    $del = Api DELETE "/calendar/holidays/$($hol.Json.id)" $null $dirK
    $dH2 = Api GET "/calendar/day?date=2026-11-24" $null $dirK
    Check ($del.StatusCode -eq 200 -and $dH2.Json.schoolDay -eq $true) "C7: suppression de la periode -> le 24/11 redevient un jour de classe ($($del.StatusCode))"
    $calAud = [int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action IN ('calendar.working_days.updated','calendar.holiday.created','calendar.holiday.deleted') AND `"schoolId`"='$schoolA';")
    Check ($calAud -eq 3) "C8: modifications du calendrier auditees ($calAud/3)"
    $null = Api POST "/calendar/holidays" @{ label="Vacances d'automne"; startDate="2026-11-23"; endDate="2026-11-29" } $dirK
    $cp = Join-Path $repoRoot "apps/web/app/(console)/calendrier/page.tsx"
    $cpt = if(Test-Path -LiteralPath $cp){ Get-Content -Raw -Encoding UTF8 -LiteralPath $cp } else { "" }
    Check ($cpt -match 'Jours ouvr' -and $cpt -match 'Vacances' -and $cpt -match 'addHoliday\(') "C9: console : page /calendrier (jours ouvres, periodes de vacances)"

    # --- R : rappel d'appel 7h45 et information eleve a la cloture (CDC M3) -------
    function Remind([string]$At){
        Push-Location $apiRoot; try { $o = (& npx tsx prisma/run-attendance-reminders.ts "--at=$At" 2>&1 | Select-Object -Last 1) } finally { Pop-Location }
        try { return ("$o" | ConvertFrom-Json) } catch { return [pscustomobject]@{ error="$o"; reminders=-1 } }
    }
    function RemCount([string]$Date){ [int](Psql $db "SELECT count(*) FROM `"Notification`" WHERE `"userId`"='$teacherId' AND kind='attendance.reminder' AND link LIKE '%date=$Date';") }
    $r0 = Remind "2026-11-16T06:00:00Z"
    Check ($r0.reminders -ge 0 -and (RemCount "2026-11-16") -eq 0) "R0: lundi 16/11 avant 7h45 (heure de l'ecole) : aucun rappel ($($r0.error))"
    $r1 = Remind "2026-11-16T07:50:00Z"
    $n1 = RemCount "2026-11-16"
    Check ($n1 -eq 1) "R1: lundi 16/11 apres 7h45, appel de B9-5A non ouvert : 1 rappel a l'enseignant affecte ($n1 ; total $($r1.reminders))"
    $null = Remind "2026-11-16T08:30:00Z"
    $n2 = RemCount "2026-11-16"
    Check ($n2 -eq 1) "R2: second passage le meme matin : pas de doublon ($n2)"
    $null = Remind "2026-11-24T07:50:00Z"; $null = Remind "2026-11-21T07:50:00Z"
    Check ((RemCount "2026-11-24") -eq 0 -and (RemCount "2026-11-21") -eq 0) "R3: vacances (24/11) et samedi non ouvre (21/11) : aucun rappel"
    $o18 = Api POST "/attendance/sessions" @{ classroomId=$c5a; date="2026-11-18"; slot="morning" } $teaK
    $null = Remind "2026-11-18T07:50:00Z"
    Check ($o18.StatusCode -eq 201 -and (RemCount "2026-11-18") -eq 0) "R4: appel deja ouvert le 18/11 : aucun rappel ($($o18.StatusCode))"
    $null = Remind "2026-11-19T12:30:00Z"
    Check ((RemCount "2026-11-19") -eq 0) "R5: apres la fenetre 7h45-12h00 : aucun rappel"
    $tn = @(@((Api GET "/notifications" $null $teaK).Json.notifications) | Where-Object { $_.kind -eq "attendance.reminder" })
    Check ($tn.Count -eq 1 -and $tn[0].link -eq "/attendance?classe=$c5a&date=2026-11-16" -and $tn[0].title -match 'B9-5A') "R6: l'enseignant voit le rappel, lien vers l'appel de la classe ($($tn.Count))"
    # Information eleve : compte eleve actif pour B9-3 (classe B9-5A) ; B9-4 sans compte eleve.
    $st3 = $stu[3]; $st4 = $stu[4]
    $fxS = Psql $db "UPDATE `"Student`" SET `"accountStatus`"='active' WHERE id='$st3'; WITH u AS (INSERT INTO `"User`"(id,email,`"passwordHash`",status,`"updatedAt`") SELECT gen_random_uuid(),'b9-e3@ecole-a.orya.test',`"passwordHash`",status,now() FROM `"User`" WHERE email='parent1@ecole-a.orya.test' RETURNING id), p AS (INSERT INTO `"UserProfile`"(`"userId`",`"schoolId`",role,`"displayName`",`"studentId`",`"updatedAt`") SELECT u.id,'$schoolA','student','Eleve B9 3','$st3',now() FROM u RETURNING id,`"userId`") UPDATE `"User`" x SET `"activeProfileId`"=p.id FROM p WHERE x.id=p.`"userId`";"
    $s19 = Api POST "/attendance/sessions" @{ classroomId=$c5a; date="2026-11-19"; slot="morning" } $teaK
    $mk = Api POST "/attendance/sessions/$($s19.Json.id)/rows/bulk" @{ rows=@(@{ studentId=$st3; status="absent" }, @{ studentId=$st4; status="late" }) } $teaK
    $cl = Api POST "/attendance/sessions/$($s19.Json.id)/close" @{} $teaK
    $stuN = [int](Psql $db "SELECT count(*) FROM `"Notification`" n JOIN `"User`" u ON u.id=n.`"userId`" WHERE u.email='b9-e3@ecole-a.orya.test' AND n.kind='attendance.student.absent';")
    Check ($s19.StatusCode -eq 201 -and $cl.StatusCode -in 200,201 -and $cl.Json.studentsNotified -eq 1 -and $stuN -eq 1) "R7: cloture : l'eleve absent avec compte actif est informe, l'eleve sans compte non ($($s19.StatusCode)/$($mk.StatusCode)/$($cl.StatusCode) n=$($cl.Json.studentsNotified))"
    $ro = Api POST "/attendance/sessions/$($s19.Json.id)/reopen" @{ reason="Correction de saisie" } $dirK
    $cl2 = Api POST "/attendance/sessions/$($s19.Json.id)/close" @{} $dirK
    $stuN2 = [int](Psql $db "SELECT count(*) FROM `"Notification`" n JOIN `"User`" u ON u.id=n.`"userId`" WHERE u.email='b9-e3@ecole-a.orya.test';")
    Check ($ro.StatusCode -in 200,201 -and $cl2.Json.studentsNotified -eq 0 -and $stuN2 -eq 1) "R8: reouverture puis nouvelle cloture : pas de doublon pour l'eleve ($($ro.StatusCode)/$($cl2.StatusCode) n=$stuN2)"
    $eTok = Tok "b9-e3@ecole-a.orya.test"
    $en = Api GET "/student/notifications" $null $eTok
    $null = Psql $db "UPDATE `"Student`" SET `"accountStatus`"='suspended_no_consent' WHERE id='$st3';"
    $en2 = Api GET "/student/notifications" $null $eTok
    $null = Psql $db "UPDATE `"Student`" SET `"accountStatus`"='active' WHERE id='$st3';"
    Check ($en.StatusCode -eq 200 -and @($en.Json.items).Count -eq 1 -and @($en.Json.items)[0].title -match '^Absence enregistr' -and $en2.StatusCode -eq 403) "R9: espace eleve : l'information est lisible (200), refusee sans consentement actif (403) ($($en.StatusCode)/$($en2.StatusCode))"
    $ep = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "apps/web/app/(console)/eleve/page.tsx")
    Check ($ep -match 'studentApi\.notifications\(\)' -and $ep -match 'student_info') "R10: console eleve : bloc 'Informations de l'ecole'"

    # --- M : resultats saisis par l'enseignant et resume hebdomadaire (CDC M7) ------
    $c6a = Psql $db "SELECT id FROM `"Classroom`" WHERE name='B9-6A';"
    $null = Psql $db "INSERT INTO `"StudentGuardian`"(`"schoolId`",`"studentId`",`"guardianId`") SELECT '$schoolA','$st3',g.id FROM `"Guardian`" g JOIN `"User`" u ON u.id=g.`"userId`" WHERE u.email='parent1@ecole-a.orya.test' LIMIT 1;"
    $as = Api POST "/results/assessments" @{ classroomId=$c5a; subject="Mathematiques"; title="Controle 1"; date="2026-11-17"; maxScore=20 } $teaK
    $asOther = Api POST "/results/assessments" @{ classroomId=$c6a; subject="Mathematiques"; title="Hors classe"; date="2026-11-17" } $teaK
    Check ($as.StatusCode -eq 201 -and $as.Json.maxScore -eq 20 -and $as.Json.publishedAt -eq $null -and $asOther.StatusCode -eq 403) "M0: enseignant : evaluation creee dans sa classe (201), refusee hors de ses classes (403) ($($as.StatusCode)/$($asOther.StatusCode))"
    $aid = $as.Json.id
    $det = Api GET "/results/assessments/$aid" $null $teaK
    $detB = Api GET "/results/assessments/$aid" $null $dirB
    Check ($det.StatusCode -eq 200 -and @($det.Json.students).Count -eq 2 -and $detB.StatusCode -eq 404) "M1: grille de saisie = eleves inscrits de la classe (2) ; ecole B : 404 ($($det.StatusCode)/$($detB.StatusCode))"
    $bad = Api PUT "/results/assessments/$aid/scores" @{ scores=@(@{ studentId=$st3; score=21 }) } $teaK
    $foreign = Api PUT "/results/assessments/$aid/scores" @{ scores=@(@{ studentId=$stu[1]; score=10 }) } $teaK
    $sc = Api PUT "/results/assessments/$aid/scores" @{ scores=@(@{ studentId=$st3; score=15.5; comment="Bon travail" }, @{ studentId=$st4; absent=$true }) } $teaK
    $s3 = @($sc.Json.students) | Where-Object { $_.studentId -eq $st3 }; $s4 = @($sc.Json.students) | Where-Object { $_.studentId -eq $st4 }
    Check ($bad.StatusCode -eq 400 -and $foreign.StatusCode -eq 400 -and $sc.StatusCode -eq 200 -and $s3.score -eq 15.5 -and $s4.absent -eq $true -and $s4.score -eq $null) "M2: notes enregistrees (15,5 ; absent) ; note > bareme ou eleve hors classe -> 400 ($($bad.StatusCode)/$($foreign.StatusCode)/$($sc.StatusCode))"
    $par1 = Tok "parent1@ecole-a.orya.test"
    $pre = Api GET "/family/children/$st3/results" $null $par1
    $preS = Api GET "/student/results" $null $eTok
    Check ($pre.StatusCode -eq 200 -and @($pre.Json.items).Count -eq 0 -and $preS.StatusCode -eq 200 -and @($preS.Json.items).Count -eq 0) "M3: avant publication : rien cote parent ni cote eleve ($($pre.StatusCode)/$($preS.StatusCode))"
    $pub = Api POST "/results/assessments/$aid/publish" $null $teaK
    $pub2 = Api POST "/results/assessments/$aid/publish" $null $teaK
    $pn = [int](Psql $db "SELECT count(*) FROM `"Notification`" n JOIN `"User`" u ON u.id=n.`"userId`" WHERE u.email='parent1@ecole-a.orya.test' AND n.kind='results.published' AND n.link LIKE '%resultat=$aid%';")
    Check ($pub.StatusCode -eq 200 -and $pub.Json.familiesNotified -ge 1 -and $pub2.StatusCode -eq 409 -and $pn -eq 1) "M4: publication : familles prevenues (in-app), seconde publication 409 ($($pub.StatusCode)/$($pub2.StatusCode) n=$($pub.Json.familiesNotified) parent1=$pn)"
    $post = Api GET "/family/children/$st3/results" $null $par1
    $pi = @($post.Json.items)
    Check ($post.StatusCode -eq 200 -and $pi.Count -eq 1 -and $pi[0].score -eq 15.5 -and $pi[0].maxScore -eq 20 -and $pi[0].subject -eq "Mathematiques" -and $pi[0].comment -eq "Bon travail") "M5: parent : resultat publie de son enfant (15,5 / 20) ($($post.StatusCode) n=$($pi.Count))"
    $par2 = Tok "parent2@ecole-a.orya.test"
    $other = Api GET "/family/children/$st3/results" $null $par2
    $teaFam = Api GET "/family/children/$st3/results" $null $teaK
    Check ($other.StatusCode -eq 404 -and $teaFam.StatusCode -eq 403) "M6: autre parent : 404 ; enseignant sur l'espace parent : 403 ($($other.StatusCode)/$($teaFam.StatusCode))"
    $sr = Api GET "/student/results" $null $eTok
    Check ($sr.StatusCode -eq 200 -and @($sr.Json.items).Count -eq 1 -and @($sr.Json.items)[0].score -eq 15.5) "M7: eleve (compte actif) : son resultat publie ($($sr.StatusCode))"
    $resAud = [int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action IN ('results.assessment.created','results.scores.updated','results.assessment.published') AND `"entityId`"='$aid';")
    Check ($resAud -eq 3) "M8: creation, saisie et publication auditees ($resAud/3)"
    function Weekly([string]$At){
        Push-Location $apiRoot; try { $o = (& npx tsx prisma/run-weekly-summary.ts "--at=$At" 2>&1 | Select-Object -Last 1) } finally { Pop-Location }
        try { return ("$o" | ConvertFrom-Json) } catch { return [pscustomobject]@{ error="$o"; summaries=-1 } }
    }
    function SumOf([string]$Email){ Psql $db "SELECT coalesce(string_agg(n.body, ' | '),'') || '#' || count(*) FROM `"Notification`" n JOIN `"User`" u ON u.id=n.`"userId`" WHERE u.email='$Email' AND n.kind='summary.weekly' AND n.link='/family?resume=2026-11-16&eleve=$st3';" }
    $w0 = Weekly "2026-11-19T17:30:00Z"
    Check ($w0.summaries -ge 0 -and (SumOf "parent1@ecole-a.orya.test").EndsWith("#0")) "M9: jeudi : pas encore de resume ($($w0.error))"
    $w1 = Weekly "2026-11-20T17:30:00Z"
    $sum1 = SumOf "parent1@ecole-a.orya.test"
    Check ($sum1 -like "1 absence(s), 0 retard(s), 1 r*sultat(s) publi*(s) cette semaine*#1") "M10: vendredi soir : resume de la semaine du 16/11 pour B9-3 (1 absence, 1 resultat) ($sum1)"
    $null = Weekly "2026-11-21T10:00:00Z"
    Check ((SumOf "parent1@ecole-a.orya.test").EndsWith("#1")) "M11: second passage (samedi) : pas de doublon"
    $rp = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "apps/web/app/(console)/resultats/page.tsx")
    $fp = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "apps/web/app/(console)/family/page.tsx")
    Check ($rp -match 'publishAssessment\(' -and $rp -match 'setAssessmentScores\(' -and $fp -match 'getChildResults\(') "M12: console : page /resultats (saisie, publication) et resultats dans l'espace parent"

    # --- T : circuits de transport, accompagnateur unique (CDC 3.2 / 3.5 / 5) -------
    $null = Psql $db "WITH src AS (SELECT `"passwordHash`" h, status s FROM `"User`" WHERE email='parent1@ecole-a.orya.test'), u AS (INSERT INTO `"User`"(id,email,`"passwordHash`",status,`"updatedAt`") SELECT gen_random_uuid(), v.e, src.h, src.s, now() FROM src, (VALUES ('b9-bus1@ecole-a.orya.test'),('b9-bus2@ecole-a.orya.test')) v(e) RETURNING id, email), p AS (INSERT INTO `"UserProfile`"(`"userId`",`"schoolId`",role,`"displayName`",`"updatedAt`") SELECT u.id,'$schoolA','bus_attendant','Accompagnateur ' || split_part(u.email,'@',1), now() FROM u RETURNING id, `"userId`") UPDATE `"User`" x SET `"activeProfileId`"=p.id FROM p WHERE x.id=p.`"userId`";"
    $bus1Prof = Psql $db "SELECT p.id FROM `"UserProfile`" p JOIN `"User`" u ON u.id=p.`"userId`" WHERE u.email='b9-bus1@ecole-a.orya.test';"
    $att = Api GET "/bus/attendants" $null $dirK
    $cA = Api POST "/bus/circuits" @{ name="Circuit Nord"; attendantProfileId=$bus1Prof } $dirK
    $cDup = Api POST "/bus/circuits" @{ name="Circuit Nord" } $dirK
    $cBad = Api POST "/bus/circuits" @{ name="Circuit X"; attendantProfileId=$teacherProfile } $dirK
    $cTea = Api POST "/bus/circuits" @{ name="Circuit Y" } $teaK
    Check ($att.StatusCode -eq 200 -and @($att.Json.attendants).Count -eq 2 -and $cA.StatusCode -eq 201 -and $cA.Json.attendantProfileId -eq $bus1Prof -and $cDup.StatusCode -eq 409 -and $cBad.StatusCode -eq 400 -and $cTea.StatusCode -eq 403) "T0: direction : circuit confie a un accompagnateur (201) ; nom en double 409 ; profil non accompagnateur 400 ; enseignant 403 ($($cA.StatusCode)/$($cDup.StatusCode)/$($cBad.StatusCode)/$($cTea.StatusCode))"
    $cid = $cA.Json.id
    $sA = Api POST "/bus/circuits/$cid/stops" @{ name="Place centrale" } $dirK
    $sB = Api POST "/bus/circuits/$cid/stops" @{ name="Ecole" } $dirK
    $stops = @($sB.Json.stops)
    Check ($sA.StatusCode -eq 201 -and $stops.Count -eq 2 -and $stops[0].name -eq "Place centrale" -and $stops[1].position -eq 2) "T1: arrets ajoutes dans l'ordre de passage ($($sA.StatusCode)/$($sB.StatusCode))"
    $memBad = Api PUT "/bus/circuits/$cid/students" @{ students=@(@{ studentId=$st3; stopId=$cid }) } $dirK
    $mem = Api PUT "/bus/circuits/$cid/students" @{ students=@(@{ studentId=$st3; stopId=$stops[0].id }) } $dirK
    Check ($memBad.StatusCode -eq 400 -and $mem.StatusCode -eq 200 -and @(@($mem.Json.stops)[0].students).Count -eq 1 -and @($mem.Json.stops)[0].students[0].id -eq $st3) "T2: eleve B9-3 inscrit a l'arret 1 ; arret hors circuit -> 400 ($($memBad.StatusCode)/$($mem.StatusCode))"
    $bus1 = Tok "b9-bus1@ecole-a.orya.test"; $bus2 = Tok "b9-bus2@ecole-a.orya.test"
    $l1 = Api GET "/bus/circuits" $null $bus1; $l2 = Api GET "/bus/circuits" $null $bus2
    $rm1 = Api GET "/bus/circuits/$cid/roadmap?date=2026-11-20" $null $bus1; $rm2 = Api GET "/bus/circuits/$cid/roadmap?date=2026-11-20" $null $bus2
    Check ($l1.StatusCode -eq 200 -and @($l1.Json.circuits).Count -eq 1 -and @($l2.Json.circuits).Count -eq 0 -and $rm1.StatusCode -eq 200 -and @($rm1.Json.stops)[0].students[0].id -eq $st3 -and $rm2.StatusCode -eq 403) "T3: accompagnateur : ses circuits et sa feuille de route seulement (autre accompagnateur 403) ($($rm1.StatusCode)/$($rm2.StatusCode))"
    $null = Psql $db "WITH t AS (INSERT INTO `"ConsentText`"(purpose,version,locale,body,`"bodySha256`") VALUES ('transport_alerts','b9','fr','Texte FICTIF de test (alertes transport), non juridique.','b9') RETURNING id) INSERT INTO `"ParentalConsent`"(`"schoolId`",`"studentId`",`"guardianId`",`"userId`",purpose,`"textId`",channel) SELECT '$schoolA','$st3',g.id,u.id,'transport_alerts',t.id,'web' FROM t, `"Guardian`" g JOIN `"User`" u ON u.id=g.`"userId`" WHERE u.email='parent1@ecole-a.orya.test' LIMIT 1;"
    $okT = Api POST "/bus/status" @{ studentId=$st3; status="on_board"; date="2026-11-20" } $bus1
    $noT = Api POST "/bus/status" @{ studentId=$st4; status="on_board"; date="2026-11-20" } $bus1
    $no2 = Api POST "/bus/status" @{ studentId=$st3; status="dropped_off"; date="2026-11-20" } $bus2
    Check ($okT.StatusCode -eq 200 -and $okT.Json.status -eq "on_board" -and $noT.StatusCode -eq 403 -and $no2.StatusCode -eq 403) "T4: saisie en un geste pour un eleve de son circuit (200) ; hors circuit 403 ; autre accompagnateur 403 ($($okT.StatusCode)/$($noT.StatusCode)/$($no2.StatusCode))"
    $null = Api POST "/bus/status" @{ studentId=$st3; status="on_board"; date="2026-11-20" } $bus1
    $al1 = [int](Psql $db "SELECT count(*) FROM `"Notification`" n JOIN `"User`" u ON u.id=n.`"userId`" WHERE u.email='parent1@ecole-a.orya.test' AND n.kind='bus.status' AND n.link LIKE '%eleve=$st3%';")
    $alg = [int](Psql $db "SELECT count(*) FROM `"Notification`" n JOIN `"User`" u ON u.id=n.`"userId`" WHERE u.email='b9-g3@ecole-a.orya.test' AND n.kind='bus.status';")
    Check ($al1 -eq 1 -and $alg -eq 0) "T5: alerte transport in-app au seul parent ayant consenti (transport_alerts), sans doublon ($al1/$alg)"
    $lb1 = Api GET "/bus/status?date=2026-11-20" $null $bus1
    $lbD = Api GET "/bus/status?date=2026-11-20" $null $dirK
    Check ($lb1.StatusCode -eq 200 -and @($lb1.Json.items).Count -eq 1 -and @($lb1.Json.items)[0].student.id -eq $st3 -and $lbD.StatusCode -eq 200) "T6: liste du jour de l'accompagnateur limitee a son circuit ($(@($lb1.Json.items).Count))"
    $off = Api PATCH "/bus/circuits/$cid" @{ active=$false } $dirK
    $afterOff = Api POST "/bus/status" @{ studentId=$st3; status="dropped_off"; date="2026-11-20" } $bus1
    $l1off = Api GET "/bus/circuits" $null $bus1
    $null = Api PATCH "/bus/circuits/$cid" @{ active=$true } $dirK
    Check ($off.StatusCode -eq 200 -and $off.Json.active -eq $false -and $afterOff.StatusCode -eq 403 -and @($l1off.Json.circuits).Count -eq 0) "T7: circuit desactive : plus de saisie (403) ni de feuille de route pour l'accompagnateur ($($off.StatusCode)/$($afterOff.StatusCode))"
    $cB = Api GET "/bus/circuits" $null $dirB
    $rB = Api GET "/bus/circuits/$cid/roadmap" $null $dirB
    $pB = Api PUT "/bus/circuits/$cid/students" @{ students=@() } $dirB
    Check ($cB.StatusCode -eq 200 -and @($cB.Json.circuits).Count -eq 0 -and $rB.StatusCode -eq 404 -and $pB.StatusCode -eq 404) "T8: isolation : l'ecole B ne voit ni ne modifie le circuit ($($rB.StatusCode)/$($pB.StatusCode))"
    $busAud = [int](Psql $db "SELECT count(*) FROM `"AuditLog`" WHERE action IN ('bus.circuit.created','bus.stop.created','bus.circuit.students.set','bus.circuit.updated') AND `"schoolId`"='$schoolA';")
    Check ($busAud -ge 6) "T9: gestion des circuits auditee ($busAud)"
    $tp = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "apps/web/app/(console)/transport/page.tsx")
    Check ($tp -match 'setBusStatus\(' -and $tp -match 'setCircuitStudents\(' -and $tp -match 'getCircuitRoadmap\(') "T10: console : page /transport (circuits, arrets, eleves, feuille de route en un geste)"

    #@@SECTIONS@@
}
catch {
    $script:ko++; Write-Host "  B9 KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    if($apiProc -and -not $apiProc.HasExited){ Stop-Process -Id $apiProc.Id -Force -EA SilentlyContinue }
    if ($env:DELETION_REGISTER_JOURNAL -and $env:DELETION_REGISTER_JOURNAL -like "*orya-b9-register-*") { Remove-Item $env:DELETION_REGISTER_JOURNAL -EA SilentlyContinue }
    foreach($k in $saved.Keys){ [Environment]::SetEnvironmentVariable($k,$saved[$k]) }
}
Write-Host "BLOC9 : $($script:ok) OK, $($script:ko) KO"
if($script:ko -gt 0){ exit 1 }
exit 0
