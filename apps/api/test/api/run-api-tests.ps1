# =============================================================================
# ORYA - tests d'API du Lot 1 (authentification, roles, isolation, sessions).
#
#   cd apps\api
#   npm run build
#   (SEED_PASSWORD est genere automatiquement pour chaque run ; inutile de le definir)
#   powershell -ExecutionPolicy Bypass -File .\test\api\run-api-tests.ps1
#
# Le script :
#   1. recree une base jetable orya_lot1_auth (migration + RLS + seed) ;
#   2. cree un role orya_t_<base> (NOBYPASSRLS) avec un mot de passe aleatoire,
#      pour ne jamais modifier orya_app ;
#   3. demarre l'API sur un port dedie et execute les scenarios ;
#   4. arrete l'API.
#
# Cible : conteneur jetable orya-test-pg (scripts/test-pg-up.ps1), redirigeable par
# ORYA_TEST_CONTAINER / ORYA_TEST_PORT / ORYA_TEST_DB ; refus de orya, orya_v2, orya-postgres, 5432.
# Fichier en UTF-8 avec BOM (Windows PowerShell 5.1).
# =============================================================================
param(
    [int]$Port = 3012
)
. (Join-Path $PSScriptRoot "../../../../scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_lot1_auth"
$Container = $T.Container; $DbUser = $T.DbUser; $DbPassword = $T.DbPassword; $PgPort = $T.Port
# P0-2 : SEED_PASSWORD jetable, genere pour CE run uniquement (conteneur orya-test-pg deja verifie par la garde).
# Toute valeur existante est ecrasee sans etre lue ; jamais affiche, journalise ni ecrit sur disque.
# Lancer avec 'powershell -File' : la variable reste dans ce processus et ses enfants (seed, API).
$__oryaSeedPrev = $env:SEED_PASSWORD   # sauvegarde interne (jamais affichee ni ecrite), restauree dans le finally final
$seedBytes = New-Object byte[] 20
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($seedBytes)
$env:SEED_PASSWORD = "Ot-" + (-join ($seedBytes | ForEach-Object { $_.ToString("x2") })) + "-A9!"
Remove-Variable seedBytes
try {

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$api = (Resolve-Path (Join-Path $here "../..")).Path
$sqlDir = Join-Path $api "prisma/sql"
$db = $T.Db
# Dossier temporaire portable : Windows utilise %TEMP%, Linux /tmp.
$tempRoot = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }
$base = "http://127.0.0.1:$Port/api/v1"
$script:failures = 0
$script:passes = 0

function Assert-True {
    param([bool]$Condition, [string]$Label)
    if ($Condition) {
        Write-Host "  PASS  $Label" -ForegroundColor Green
        $script:passes++
    }
    else {
        Write-Host "  FAIL  $Label" -ForegroundColor Red
        $script:failures++
    }
}

# Bloc 3b : envoi multipart reel (multer). Jeton et contenu passes par variables d'environnement.
function Invoke-Upload {
    param([string]$Path, [string]$Token, [string]$Base64, [string]$Name, [string]$Mime, [string[]]$Fields = @(), [string]$FileField = "file")
    $env:ORYA_T_TOKEN = $Token; $env:ORYA_T_BASE = $base; $env:ORYA_T_B64 = $Base64; $env:ORYA_T_FILEFIELD = $FileField
    Push-Location $api
    try { $o = & node test/api/b3-upload.mjs $Path "b64" $Name $Mime @Fields 2>&1 | Out-String }
    finally { Pop-Location; foreach ($k in "ORYA_T_TOKEN", "ORYA_T_B64", "ORYA_T_FILEFIELD") { Remove-Item "Env:$k" -ErrorAction SilentlyContinue } }
    $r = ($o.Trim().Split("`n") | Select-Object -Last 1) | ConvertFrom-Json
    return [pscustomobject]@{ Status = [int]$r.status; Json = $r.body }
}

function Invoke-Api {
    param(
        [string]$Method = "GET",
        [string]$Path,
        $Body = $null,
        [string]$Token = $null
    )

    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }

    $params = @{
        Method          = $Method
        Uri             = "$base$Path"
        Headers         = $headers
        UseBasicParsing = $true
        ErrorAction     = "Stop"
    }
    if ($null -ne $Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 6 -Compress)
        $params["ContentType"] = "application/json"
    }

    try {
        $response = Invoke-WebRequest @params
        $json = $null
        try { $json = $response.Content | ConvertFrom-Json } catch { }
        return [pscustomobject]@{ Ok = $true; Status = [int]$response.StatusCode; Json = $json; Raw = $response.Content }
    }
    catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }
        # PowerShell 5.1 place le corps d'une reponse 4xx/5xx dans ErrorDetails.
        $text = $null
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $text = $_.ErrorDetails.Message }
        if (-not $text) {
            $stream = $resp.GetResponseStream()
            if ($stream) { $text = (New-Object System.IO.StreamReader($stream)).ReadToEnd() }
        }
        if ($null -eq $text) { $text = "" }
        $json = $null
        try { $json = $text | ConvertFrom-Json } catch { }
        return [pscustomobject]@{ Ok = $false; Status = [int]$resp.StatusCode; Json = $json; Raw = $text }
    }
}

# L'anti-rejeu TOTP (User.mfaLastStep) refuse un code deja consomme : pour une
# seconde connexion du meme compte, il faut attendre le pas de temps suivant.
function Wait-NextTotpStep {
    $elapsed = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % 30)
    $wait = 32 - $elapsed
    if ($wait -lt 2) { $wait = 2 }
    Write-Host "  (attente de $wait s pour le prochain pas TOTP)" -ForegroundColor DarkGray
    Start-Sleep -Seconds $wait
}

function Get-Totp {
    param([string]$Secret)
    $env:ORYA_TOTP_SECRET = $Secret
    Push-Location $api
    try {
        return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_TOTP_SECRET))").Trim()
    }
    finally { Pop-Location }
}

function Reset-Database {
    param([string]$Name)
    & docker exec $Container psql -U $DbUser -d postgres -q -c "DROP DATABASE IF EXISTS $Name WITH (FORCE);" | Out-Null
    & docker exec $Container psql -U $DbUser -d postgres -q -c "CREATE DATABASE $Name;" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Impossible de recreer la base $Name." }
}

Write-Host "=== 0. Verification du conteneur ===" -ForegroundColor Cyan
$running = & docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($running -ne "true") { throw "Le conteneur $Container n'est pas demarre (scripts/test-pg-up.ps1)." }

if (-not $env:SEED_PASSWORD -or $env:SEED_PASSWORD.Length -lt 12) {
    throw "SEED_PASSWORD est requis (12 caracteres minimum)."
}

Write-Host "=== 1. Base jetable $db ===" -ForegroundColor Cyan
Reset-Database $db

$migrationDirs = Get-ChildItem (Join-Path $api "prisma/migrations") -Directory | Sort-Object Name
if (-not $migrationDirs) { throw "Aucune migration trouvee dans prisma\migrations." }
$migrationDir = Join-Path $tempRoot "orya_migrations_$PID"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationFile = Join-Path $migrationDir "migration.sql"
$combinedSql = ($migrationDirs | ForEach-Object { [IO.File]::ReadAllText((Join-Path $_.FullName "migration.sql")) }) -join "`n"
[IO.File]::WriteAllText($migrationFile, $combinedSql, [Text.UTF8Encoding]::new($false))
foreach ($file in @($migrationFile, (Join-Path $sqlDir "010_rls.sql"), (Join-Path $here "reset-lock.sql"), (Join-Path $here "grant-test-role.sql"), (Join-Path $here "seed-activation.sql"), (Join-Path $here "seed-attendance.sql"))) {
    & docker cp $file "${Container}:/tmp/$(Split-Path $file -Leaf)"
    if ($LASTEXITCODE -ne 0) { throw "docker cp a echoue pour $file" }
}

foreach ($script in @("migration.sql", "010_rls.sql")) {
    & docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -f "/tmp/$script"
    if ($LASTEXITCODE -ne 0) { throw "Echec de $script." }
}

Write-Host "=== 2. Role de test orya_t_$db (NOBYPASSRLS) ===" -ForegroundColor Cyan
$appPassword = (& node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))").Trim()
# P0-2 : role propre a la base de test (cree a neuf dans le conteneur jetable, jamais d'ALTER ROLE).
$testRole = "orya_t_$db"
& docker exec $Container psql -U $DbUser -d postgres -v ON_ERROR_STOP=1 -q -c "DROP ROLE IF EXISTS $testRole; CREATE ROLE $testRole LOGIN NOBYPASSRLS PASSWORD '$appPassword';"
if ($LASTEXITCODE -ne 0) { throw "Creation du role $testRole impossible." }
& docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -v test_role=$testRole -f /tmp/grant-test-role.sql
if ($LASTEXITCODE -ne 0) { throw "Attribution des privileges a $testRole impossible." }

Write-Host "=== 3. Seed ===" -ForegroundColor Cyan
$env:DIRECT_DATABASE_URL = "postgresql://${DbUser}:${DbPassword}@127.0.0.1:${PgPort}/${db}?schema=public"
$env:DATABASE_URL = "postgresql://${testRole}:${appPassword}@127.0.0.1:${PgPort}/${db}?schema=public"
$env:NODE_ENV = "development"
Push-Location $api
try {
    & npx tsx prisma/seed.ts | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Le seed a echoue." }
}
finally { Pop-Location }

& docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -f /tmp/seed-activation.sql
if ($LASTEXITCODE -ne 0) { throw "Fixture d'activation impossible." }
& docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -f /tmp/seed-attendance.sql
if ($LASTEXITCODE -ne 0) { throw "Fixture d'appel (Lot 2.2) impossible." }

Write-Host "=== 4. Demarrage de l'API (port $Port) ===" -ForegroundColor Cyan
$env:API_PORT = "$Port"
$env:AUTH_LOGIN_LIMIT = "200"
$env:ACTIVATION_RATE_LIMIT = "1000"
$env:IMPORT_RATE_LIMIT = "200"
$env:API_RATE_LIMIT = "2000"
$env:UPLOAD_RATE_LIMIT = "200"
$env:STORAGE_LOCAL_DIR = Join-Path $env:TEMP "orya-test-private-storage"
# Bloc 3b : pieces jointes et imports passent par ClamAV (conteneur jetable orya-test-clamav, verify-all).
if (-not $env:CLAMAV_HOST) { throw "CLAMAV_HOST absent : lancer via scripts/verify-all.ps1 (orya-test-clamav)." }
$env:IMPORT_MAX_ROWS = "10"
$env:JWT_ACCESS_SECRET = (& node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))").Trim()
$env:MFA_ENCRYPTION_KEY = (& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()

$logOut = Join-Path $tempRoot "orya-api-test-out.log"
$logErr = Join-Path $tempRoot "orya-api-test-err.log"

# -WindowStyle n'existe pas sur Linux ; -NoNewWindow n'est pas necessaire sous
# Windows (ou il fait echouer Start-Process en session non interactive).
$startParams = @{
    FilePath               = "node"
    ArgumentList           = "dist/main.js"
    WorkingDirectory       = $api
    PassThru               = $true
    RedirectStandardOutput = $logOut
    RedirectStandardError  = $logErr
}
if ($env:OS -eq "Windows_NT") {
    $startParams["WindowStyle"] = "Hidden"
}
else {
    $startParams["NoNewWindow"] = $true
}

$process = Start-Process @startParams

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-WebRequest "$base/health" -UseBasicParsing -TimeoutSec 2
        if ([int]$health.StatusCode -eq 200) { $ready = $true; break }
    }
    catch { }
}

try {
    Write-Host "=== 5. Scenarios ===" -ForegroundColor Cyan
    Assert-True $ready "API demarree et /health repond"

    if (-not $ready) {
        Get-Content $logErr -ErrorAction SilentlyContinue | Select-Object -Last 20
        throw "L'API n'a pas demarre."
    }

    # --- Connexion : compte inconnu -----------------------------------------
    $unknown = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "inconnu@orya.test"; password = "MotDePasse123!" }
    Assert-True ($unknown.Status -eq 401) "T-login : compte inconnu refuse (401, message generique)"
    Assert-True ($unknown.Json.message -eq "Identifiants incorrects.") "T-login : message non revelateur"

    # --- Direction A : MFA obligatoire --------------------------------------
    $loginA = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "direction@ecole-a.orya.test"; password = $env:SEED_PASSWORD; platform = "web" }
    Assert-True ($loginA.Status -eq 200) "T10 : connexion direction acceptee (mot de passe valide)"
    Assert-True ($loginA.Json.mfaRequired -eq $true) "T10 : direction sans MFA -> defi, aucun jeton emis"
    Assert-True ($null -eq $loginA.Json.accessToken) "T10 : aucun jeton d'acces avant le second facteur"
    Assert-True ($loginA.Json.method -eq "enroll") "T10 : premier facteur -> methode enroll"

    $challengeA = $loginA.Json.challengeToken

    $enrollA = Invoke-Api -Method POST -Path "/auth/mfa/enroll" -Body @{ challengeToken = $challengeA }
    Assert-True ($enrollA.Status -eq 200 -and $enrollA.Json.otpauthUrl -like "otpauth://*") "T10 : enrolement TOTP (otpauth://)"
    $secretA = $enrollA.Json.secret

    $badCode = Invoke-Api -Method POST -Path "/auth/mfa/verify" -Body @{ challengeToken = $challengeA; code = "000000" }
    Assert-True ($badCode.Status -eq 401) "T10 : code TOTP invalide refuse"

    $goodCode = Get-Totp -Secret $secretA
    $verifyA = Invoke-Api -Method POST -Path "/auth/mfa/verify" -Body @{ challengeToken = $challengeA; code = $goodCode }
    Assert-True ($verifyA.Status -eq 200 -and $verifyA.Json.accessToken) "T10 : code valide -> jetons emis"
    Assert-True ($verifyA.Json.profile.role -eq "direction") "T10 : profil actif = direction"
    Assert-True ($verifyA.Json.profile.schoolName -like "*Al Nour*") "T-school : nom de l ecole resolu hors contexte identite"
    $tokenA = $verifyA.Json.accessToken
    $refreshA = $verifyA.Json.refreshToken

    # --- /me et isolation ----------------------------------------------------
    $me = Invoke-Api -Path "/me" -Token $tokenA
    Assert-True ($me.Status -eq 200 -and @($me.Json.profiles).Count -ge 1) "T-me : /me renvoie les profils du compte"
    Assert-True (@($me.Json.profiles)[0].schoolName -like "*Al Nour*") "T-me : /me renvoie le nom de l ecole"
    Assert-True ($null -eq $me.Json.user.passwordHash) "T-me : aucun hash de mot de passe expose"

    $studentsA = Invoke-Api -Path "/students" -Token $tokenA
    # 2 seed + 1 fixture activation + 30 fixture appel = 33
    Assert-True ($studentsA.Status -eq 200 -and @($studentsA.Json.students).Count -eq 33) "T1 : ecole A voit ses 33 eleves (seed + fixtures)"
    $studentAId = $studentsA.Json.students[0].id

    # --- Direction B ---------------------------------------------------------
    $loginB = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "direction@ecole-b.orya.test"; password = $env:SEED_PASSWORD }
    $challengeB = $loginB.Json.challengeToken
    $enrollB = Invoke-Api -Method POST -Path "/auth/mfa/enroll" -Body @{ challengeToken = $challengeB }
    $codeB = Get-Totp -Secret $enrollB.Json.secret
    $verifyB = Invoke-Api -Method POST -Path "/auth/mfa/verify" -Body @{ challengeToken = $challengeB; code = $codeB }
    $tokenB = $verifyB.Json.accessToken
    if ($null -eq $tokenB) {
        Write-Host ("  debug B: login=" + $loginB.Status + " enroll=" + $enrollB.Status + " verify=" + $verifyB.Status + " body=" + $verifyB.Raw) -ForegroundColor Yellow
    }
    Assert-True ($null -ne $tokenB) "T5 : connexion de l'ecole B etablie"

    $studentsB = Invoke-Api -Path "/students" -Token $tokenB
    Assert-True ($studentsB.Status -eq 200 -and @($studentsB.Json.students).Count -eq 2) "T5 : ecole B voit uniquement ses 2 eleves"
    $studentBId = $studentsB.Json.students[0].id

    $crossA = Invoke-Api -Path "/students/$studentBId" -Token $tokenA
    Assert-True ($crossA.Status -eq 404) "T4 : eleve de B demande par A -> 404 (pas 403)"
    $crossB = Invoke-Api -Path "/students/$studentAId" -Token $tokenB
    Assert-True ($crossB.Status -eq 404) "T4 : eleve de A demande par B -> 404"

    $readOwn = Invoke-Api -Path "/students/$studentAId" -Token $tokenA
    Assert-True ($readOwn.Status -eq 200) "T4 : A lit son propre eleve (200)"

    # --- Enseignant : pas de MFA, roles limites ------------------------------
    $loginTeacher = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "professeur@ecole-a.orya.test"; password = $env:SEED_PASSWORD }
    Assert-True ($null -ne $loginTeacher.Json.accessToken) "T-role : enseignant connecte sans MFA"
    $teacherToken = $loginTeacher.Json.accessToken

    $teacherStudents = Invoke-Api -Path "/students" -Token $teacherToken
    Assert-True ($teacherStudents.Status -eq 200) "T-role : enseignant autorise a lire les eleves"

    $teacherAudit = Invoke-Api -Path "/audit" -Token $teacherToken
    Assert-True ($teacherAudit.Status -eq 403) "T12 : enseignant refuse sur le journal d'audit (403)"

    # --- Parent : aucun acces aux eleves -------------------------------------
    $loginParent = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "parent1@ecole-a.orya.test"; password = $env:SEED_PASSWORD }
    $parentToken = $loginParent.Json.accessToken
    Assert-True ($null -ne $parentToken) "T-role : parent connecte"
    $parentStudents = Invoke-Api -Path "/students" -Token $parentToken
    Assert-True ($parentStudents.Status -eq 403) "T-role : parent refuse sur /students (403)"

    # --- Absence de jeton ----------------------------------------------------
    $noToken = Invoke-Api -Path "/me"
    Assert-True ($noToken.Status -eq 401) "T-auth : requete sans jeton -> 401"

    $forged = Invoke-Api -Path "/me" -Token "eyJhbGciOiJIUzI1NiJ9.faux.faux"
    Assert-True ($forged.Status -eq 401) "T-auth : jeton falsifie -> 401"

    # --- Rotation et reutilisation du refresh --------------------------------
    $refresh1 = Invoke-Api -Method POST -Path "/auth/refresh" -Body @{ refreshToken = $refreshA }
    Assert-True ($refresh1.Status -eq 200 -and $refresh1.Json.accessToken) "T11 : rotation du jeton de rafraichissement"
    $refreshB = $refresh1.Json.refreshToken
    Assert-True ($refreshB -ne $refreshA) "T11 : nouveau jeton different de l'ancien"

    $replay = Invoke-Api -Method POST -Path "/auth/refresh" -Body @{ refreshToken = $refreshA }
    Assert-True ($replay.Status -eq 401) "T11 : reutilisation de l'ancien jeton refusee (401)"

    $afterRevoke = Invoke-Api -Method POST -Path "/auth/refresh" -Body @{ refreshToken = $refreshB }
    Assert-True ($afterRevoke.Status -eq 401) "T11 : appareil revoque -> le jeton valide ne fonctionne plus"

    # --- Journal d'audit de l'ecole A ----------------------------------------
    $loginA2 = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "direction@ecole-a.orya.test"; password = $env:SEED_PASSWORD }
    Wait-NextTotpStep
    $codeA2 = Get-Totp -Secret $secretA
    $verifyA2 = Invoke-Api -Method POST -Path "/auth/mfa/verify" -Body @{ challengeToken = $loginA2.Json.challengeToken; code = $codeA2 }
    $tokenA2 = $verifyA2.Json.accessToken
    Assert-True ($null -ne $tokenA2) "T-audit : nouvelle session direction A"

    $auditA = Invoke-Api -Path "/audit" -Token $tokenA2
    Assert-True ($auditA.Status -eq 200 -and @($auditA.Json.entries).Count -gt 0) "T-audit : le journal de l'ecole est consultable"
    $hasLogin = ($auditA.Json.entries | Where-Object { $_.action -like "auth.login.success*" }).Count -gt 0
    Assert-True $hasLogin "T-audit : la connexion reussie est tracee"

    # --- Activation : acces en attente (CDC 3.2) -----------------------------
    $pendingLogin = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "direction@ecole-c.orya.test"; password = $env:SEED_PASSWORD }
    Assert-True ($pendingLogin.Status -eq 403) "T-gate : ecole en attente -> connexion refusee (403)"
    Assert-True ($pendingLogin.Json.message -like "*attente d'activation*") "T-gate : message d'attente explicite"

    $pendingActivation = Invoke-Api -Method POST -Path "/activation/parent" -Body @{ schoolCode = "IBNSIN"; activationCode = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; email = "parent.c@test.test"; password = "MotDePasse123!"; fullName = "Parent C" }
    Assert-True ($pendingActivation.Status -eq 403) "T-gate : activation refusee sur ecole en attente"

    # --- Code d'activation long et expirant (emis par la direction) ----------
    $actStudent = @($studentsA.Json.students) | Where-Object { $_.studentCode -eq "ACTIV-001" } | Select-Object -First 1
    Assert-True ($null -ne $actStudent) "T-activation : eleve de test present"

    $issued = Invoke-Api -Method POST -Path "/students/$($actStudent.id)/activation-code" -Body @{ ttlDays = "30" } -Token $tokenA2
    Assert-True ($issued.Status -eq 201 -and $issued.Json.code) "T-activation : code emis par la direction (201)"
    Assert-True ($issued.Json.code.Length -ge 32) "T-activation : code long (>= 32 caracteres)"
    $actCode = $issued.Json.code

    $badCode = Invoke-Api -Method POST -Path "/activation/parent" -Body @{ schoolCode = "ALNOUR"; activationCode = "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"; email = "intrus@ecole-a.test"; password = "MotDePasse123!"; fullName = "Intrus" }
    Assert-True ($badCode.Status -eq 404) "T-activation : code invalide refuse (404)"

    $act1 = Invoke-Api -Method POST -Path "/activation/parent" -Body @{ schoolCode = "ALNOUR"; activationCode = $actCode; email = "parent.actif1@ecole-a.test"; password = "MotDePasse123!"; fullName = "Parent Actif 1"; relationship = "pere" }
    Assert-True ($act1.Status -eq 201 -and $act1.Json.accessToken) "T-activation : parent active (201 + jetons)"
    Assert-True ($act1.Json.profile.role -eq "parent") "T-activation : profil parent"

    $parentLogin = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "parent.actif1@ecole-a.test"; password = "MotDePasse123!" }
    Assert-True ($parentLogin.Status -eq 200 -and $parentLogin.Json.accessToken) "T-activation : connexion du parent active"

    $act2 = Invoke-Api -Method POST -Path "/activation/parent" -Body @{ schoolCode = "ALNOUR"; activationCode = $actCode; email = "parent.actif2@ecole-a.test"; password = "MotDePasse123!"; fullName = "Parent Actif 2" }
    Assert-True ($act2.Status -eq 201) "T-activation : second responsable accepte"

    $act3 = Invoke-Api -Method POST -Path "/activation/parent" -Body @{ schoolCode = "ALNOUR"; activationCode = $actCode; email = "parent.actif3@ecole-a.test"; password = "MotDePasse123!"; fullName = "Parent Actif 3" }
    Assert-True ($act3.Status -eq 409) "T-activation : troisieme responsable refuse (409)"

    # --- Verrouillage des tentatives d'activation ----------------------------
    $activationLocked = $false
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        $wrong = Invoke-Api -Method POST -Path "/activation/parent" -Body @{ schoolCode = "ALNOUR"; activationCode = ("Z" * 32); email = "brute$attempt@ecole-a.test"; password = "MotDePasse123!"; fullName = "Brute $attempt" }
        if ($wrong.Status -eq 429) { $activationLocked = $true; break }
    }
    Assert-True $activationLocked "T-activation : verrouillage apres echecs repetes (429)"

    # --- Invitation nominative -----------------------------------------------
    $invite = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "teacher"; email = "prof.invite@ecole-a.test" } -Token $tokenA2
    Assert-True ($invite.Status -eq 201 -and $invite.Json.token) "T-invitation : creee par la direction"

    $invalidRole = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "direction"; email = "x@y.test" } -Token $tokenA2
    Assert-True ($invalidRole.Status -eq 400) "T-invitation : role direction refuse"

    $teacherInvite = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "teacher"; email = "y@z.test" } -Token $teacherToken
    Assert-True ($teacherInvite.Status -eq 403) "T-invitation : enseignant non autorise (403)"

    $accept = Invoke-Api -Method POST -Path "/activation/invitation" -Body @{ token = $invite.Json.token; password = "MotDePasse123!"; fullName = "Prof Invite"; locale = "fr" }
    Assert-True ($accept.Status -eq 200 -and $accept.Json.accessToken) "T-invitation : acceptee, jetons emis"
    Assert-True ($accept.Json.profile.role -eq "teacher") "T-invitation : profil enseignant"

    $reuse = Invoke-Api -Method POST -Path "/activation/invitation" -Body @{ token = $invite.Json.token; password = "MotDePasse123!"; fullName = "Prof Invite" }
    Assert-True ($reuse.Status -eq 401) "T-invitation : invitation deja utilisee refusee"

    # --- Super-admin : validation d'une ecole ---------------------------------
    $superLogin = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "superadmin@orya.test"; password = $env:SEED_PASSWORD }
    $superChallenge = $superLogin.Json.challengeToken
    Assert-True ($null -ne $superChallenge) "T-super : MFA exigee pour le super-admin"
    $superEnroll = Invoke-Api -Method POST -Path "/auth/mfa/enroll" -Body @{ challengeToken = $superChallenge }
    $superCode = Get-Totp -Secret $superEnroll.Json.secret
    $superVerify = Invoke-Api -Method POST -Path "/auth/mfa/verify" -Body @{ challengeToken = $superChallenge; code = $superCode }
    $superToken = $superVerify.Json.accessToken
    Assert-True ($null -ne $superToken) "T-super : session super-admin etablie"

    $validate = Invoke-Api -Method POST -Path "/schools/0a000000-0000-4000-8000-000000000003/validate" -Token $superToken
    Assert-True ($validate.Status -eq 200 -and $validate.Json.status -eq "active") "T-super : ecole validee (active)"

    $schoolList = Invoke-Api -Path "/schools" -Token $superToken
    Assert-True ($schoolList.Status -eq 200 -and @($schoolList.Json.schools).Count -ge 3) "T-super : liste des ecoles (console)"

    $schoolForbidden = Invoke-Api -Path "/schools" -Token $tokenA2
    Assert-True ($schoolForbidden.Status -eq 403) "T-role : direction ne peut pas lister les ecoles"
    $afterValidate = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "direction@ecole-c.orya.test"; password = $env:SEED_PASSWORD }
    Assert-True ($afterValidate.Status -eq 200 -and $afterValidate.Json.mfaRequired) "T-super : ecole validee -> connexion possible (defi MFA)"
    # --- Import CSV : apercu, erreurs, commit, idempotence -------------------
    $csvContent = "classe;code_eleve;nom;code_massar;date_naissance`n6e A;IMP-001;Eleve Import 1;MAS-001;2014-09-01`n6e A;IMP-002;Eleve Import 2;MAS-002;`n6e A;IMP-003;Eleve Import 3;MAS-003;15/03/2014`n6e A;;Eleve Sans Code;;;"
    $csvBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($csvContent))

    $import1 = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "eleves.csv"; contentBase64 = $csvBase64; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($import1.Status -eq 201) "T-import : apercu CSV cree (201)"
    Assert-True ($import1.Json.totalRows -eq 4) "T-import : 4 lignes lues"
    Assert-True ($import1.Json.validRows -eq 3) "T-import : 3 lignes valides"
    Assert-True ($import1.Json.invalidRows -eq 1) "T-import : 1 ligne invalide listee"
    Assert-True ($import1.Json.errors[0].message -like "*code*") "T-import : motif d erreur explicite"
    Assert-True ($import1.Json.errors[0].line -eq 5) "T-import : numero de ligne exact"
    $importId = $import1.Json.id

    $commit1 = Invoke-Api -Method POST -Path "/imports/$importId/commit" -Token $tokenA2
    Assert-True ($commit1.Status -eq 200 -and $commit1.Json.students -eq 3) "T-import : commit applique 3 eleves"
    Assert-True ($commit1.Json.classrooms -eq 1) "T-import : 1 classe creee"

    $recommit = Invoke-Api -Method POST -Path "/imports/$importId/commit" -Token $tokenA2
    Assert-True ($recommit.Status -eq 409) "T-import : double validation refusee (409)"

    $import2 = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "eleves.csv"; contentBase64 = $csvBase64; schoolYear = "2026-2027" } -Token $tokenA2
    $commit2 = Invoke-Api -Method POST -Path "/imports/$($import2.Json.id)/commit" -Token $tokenA2
    Assert-True ($commit2.Status -eq 200) "T-import : reimport accepte"
    $studentsAfter = Invoke-Api -Path "/students" -Token $tokenA2
    # 33 (seed+fixtures) + 3 import?s, sans doublon au r?import
    Assert-True (@($studentsAfter.Json.students).Count -eq 36) "T-import : aucun doublon apres reimport (33 + 3)"

    # R?import sans colonne Massar : le code d?j? enregistr? doit ?tre conserv?.
    $csvSansMassar = "classe;code_eleve;nom`n6e A;IMP-001;Eleve Import 1 Renomme"
    $csvSansMassarB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($csvSansMassar))
    $importMassar = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "sans-massar.csv"; contentBase64 = $csvSansMassarB64; schoolYear = "2026-2027" } -Token $tokenA2
    $commitMassar = Invoke-Api -Method POST -Path "/imports/$($importMassar.Json.id)/commit" -Token $tokenA2
    Assert-True ($commitMassar.Status -eq 200) "T-import : reimport sans Massar accepte"
    $studentMassar = Invoke-Api -Path "/students" -Token $tokenA2
    $imp001 = @($studentMassar.Json.students) | Where-Object { $_.studentCode -eq "IMP-001" } | Select-Object -First 1
    Assert-True ($null -ne $imp001) "T-import : eleve IMP-001 present apres reimport"
    Assert-True ($imp001.massarCode -eq "MAS-001") "T-import : code Massar preserve si absente de l import"
    Assert-True ($imp001.displayName -eq "Eleve Import 1 Renomme") "T-import : nom mis a jour lors du reimport"

    $crossJob = Invoke-Api -Path "/imports/$importId" -Token $tokenB
    Assert-True ($crossJob.Status -eq 404) "T-import : job invisible depuis une autre ecole (404)"

    $xlsxPath = Join-Path $tempRoot "orya-import-test.xlsx"
    $env:XLSX_OUT = $xlsxPath
    Push-Location $api
    try {
        & node -e "const ExcelJS=require('exceljs');(async()=>{const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Eleves');ws.addRow(['classe','code_eleve','nom']);ws.addRow(['6e C','IMP-X1','Eleve Xlsx']);await wb.xlsx.writeFile(process.env.XLSX_OUT);})()" | Out-Null
    }
    finally { Pop-Location }
    $xlsxBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($xlsxPath))
    $xlsxImport = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "eleves.xlsx"; contentBase64 = $xlsxBase64; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($xlsxImport.Status -eq 201 -and $xlsxImport.Json.validRows -eq 1) "T-import : XLSX accepte (1 ligne)"

    $fakeBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("ceci n est pas une archive zip"))
    $fake = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "faux.xlsx"; contentBase64 = $fakeBase64; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($fake.Status -eq 400) "T-import : faux XLSX refuse avant decompression (400)"

    $badExt = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "notes.xls"; contentBase64 = $fakeBase64; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($badExt.Status -eq 400) "T-import : extension .xls refusee (400)"

    # Bombe ZIP : 60 Mo de zeros compresses en quelques dizaines de Ko.
    # Le garde-fou doit refuser AVANT de confier le fichier a exceljs.
    $bombPath = Join-Path $tempRoot "orya-import-bomb.xlsx"
    $env:BOMB_OUT = $bombPath
    Push-Location $api
    try {
        & node -e "const JSZip=require('jszip');(async()=>{const z=new JSZip();z.file('[Content_Types].xml','<Types/>');z.file('xl/worksheets/sheet1.xml',Buffer.alloc(60*1024*1024,0));const b=await z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});require('fs').writeFileSync(process.env.BOMB_OUT,b);})()" | Out-Null
    }
    finally { Pop-Location }
    $bombSize = (Get-Item $bombPath).Length
    Write-Host ("  (bombe generee : {0} Ko compresses pour 60 Mo decompresses)" -f [int]($bombSize / 1KB)) -ForegroundColor DarkGray
    $bombBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($bombPath))
    # t52u : garde ZIP (repertoire central, sans decompression) AVANT l'antivirus :
    # la bombe est refusee sans appel a clamd (preuve par espion : BLOC3 EX1/EX2).
    function Import-State {
        $q = 'SELECT (SELECT count(*) FROM "ImportJob") || ''|'' || (SELECT count(*) FROM "ImportRowError") || ''|'' || (SELECT count(*) FROM "StoredFile");'
        $state = ($q | & docker exec -i $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -At) -join ""
        if ($LASTEXITCODE -ne 0) { throw "Observation etat import impossible" }
        return $state.Trim()
    }
    $zipStateBefore = Import-State
    $zipFilesBefore = @(Get-ChildItem $env:STORAGE_LOCAL_DIR -Recurse -File -ErrorAction SilentlyContinue).Count
    $bomb = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "bomb.xlsx"; contentBase64 = $bombBase64; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($bomb.Status -eq 400) "T-import : bombe ZIP refusee (400)"
    Assert-True ($bomb.Json.message -like "*refus*") "T-import : motif de refus explicite"
    Assert-True ((Import-State) -eq $zipStateBefore) "T-import : bombe ZIP sans ecriture ImportJob/ImportRowError/StoredFile"
    Assert-True (@(Get-ChildItem $env:STORAGE_LOCAL_DIR -Recurse -File -ErrorAction SilentlyContinue).Count -eq $zipFilesBefore) "T-import : bombe ZIP sans fichier stocke"

    # --- Import : refus et cas limites ---------------------------------------
    $teacherImport = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "eleves.csv"; contentBase64 = $csvBase64; schoolYear = "2026-2027" } -Token $teacherToken
    Assert-True ($teacherImport.Status -eq 403) "T-import : enseignant refuse (403)"

    $missingColumns = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("foo;bar`n1;2"))
    $badColumns = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "vide.csv"; contentBase64 = $missingColumns; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($badColumns.Status -eq 400) "T-import : colonnes obligatoires manquantes (400)"

    $tooManyRowsCsv = "classe;code_eleve;nom`n" + ((1..12 | ForEach-Object { "6e D;IMP-L$_;Eleve L$_" }) -join "`n")
    $tooManyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($tooManyRowsCsv))
    $tooMany = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "gros.csv"; contentBase64 = $tooManyBase64; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($tooMany.Status -eq 400) "T-import : au-dela de la limite de lignes (400)"

    # Envoi via Node : ConvertTo-Json / Invoke-WebRequest de PowerShell 5.1
    # tronquent ou saturent sur un corps ~7 Mo. L'assertion HTTP 413 reste inchang?e.
    $tooBigRaw = & node -e @"
const http = require('http');
const payload = Buffer.alloc(5_100_000, 0x78);
const body = JSON.stringify({
  filename: 'enorme.csv',
  contentBase64: payload.toString('base64'),
  schoolYear: '2026-2027',
});
const req = http.request({
  hostname: '127.0.0.1',
  port: $Port,
  path: '/api/v1/imports',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    Authorization: 'Bearer $($tokenA2)',
  },
}, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => process.stdout.write(String(res.statusCode) + '\n' + data));
});
req.on('error', (err) => { console.error(err); process.exit(2); });
req.write(body);
req.end();
"@
    $tooBigStatus = 0
    if ($tooBigRaw -is [array]) { $tooBigStatus = [int]($tooBigRaw[0]) } else { $tooBigStatus = [int](($tooBigRaw -split "`n")[0]) }
    Assert-True ($tooBigStatus -eq 413) "T-import : fichier > 5 Mo refuse (413)"

    $toCancel = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "a-annuler.csv"; contentBase64 = $csvBase64; schoolYear = "2026-2027" } -Token $tokenA2
    $cancel = Invoke-Api -Method POST -Path "/imports/$($toCancel.Json.id)/cancel" -Token $tokenA2
    Assert-True ($cancel.Status -eq 200) "T-import : annulation acceptee"
    $commitCancelled = Invoke-Api -Method POST -Path "/imports/$($toCancel.Json.id)/commit" -Token $tokenA2
    Assert-True ($commitCancelled.Status -eq 409) "T-import : validation impossible apres annulation (409)"

    # --- Lot 2.2 : affectations et appels ------------------------------------
    $classAtt = "a2000000-0000-4000-8000-000000000001"
    $classForbidden = "a2000000-0000-4000-8000-000000000002"
    $teacherProfileA = "0c000000-0000-4000-8000-000000000012"
    $student1 = "a2100000-0000-4000-8000-000000000001"

    $assign = Invoke-Api -Method POST -Path "/assignments" -Body @{
        teacherProfileId = $teacherProfileA
        classroomId      = $classAtt
        schoolYear       = "2026-2027"
    } -Token $tokenA2
    Assert-True ($assign.Status -eq 201 -and $assign.Json.id) "T-assign : affectation enseignant-classe creee"

    $assignDup = Invoke-Api -Method POST -Path "/assignments" -Body @{
        teacherProfileId = $teacherProfileA
        classroomId      = $classAtt
        schoolYear       = "2026-2027"
    } -Token $tokenA2
    Assert-True ($assignDup.Status -eq 409) "T-assign : doublon d affectation refuse (409)"

    $teacherForbidden = Invoke-Api -Method POST -Path "/attendance/sessions" -Body @{
        classroomId = $classForbidden
        date        = "2026-10-30"
        slot        = "morning"
    } -Token $teacherToken
    Assert-True ($teacherForbidden.Status -eq 403) "T-attendance : enseignant refuse sur classe non affectee (403)"

    $openMorning = Invoke-Api -Method POST -Path "/attendance/sessions" -Body @{
        classroomId = $classAtt
        date        = "2026-10-30"
        slot        = "morning"
    } -Token $teacherToken
    Assert-True ($openMorning.Status -eq 201 -and $openMorning.Json.id) "T-attendance : ouverture session matin"
    Assert-True ($openMorning.Json.slot -eq "morning") "T-attendance : creneau morning"
    $sessionId = [string]$openMorning.Json.id

    $openDup = Invoke-Api -Method POST -Path "/attendance/sessions" -Body @{
        classroomId = $classAtt
        date        = "2026-10-30"
        slot        = "morning"
    } -Token $teacherToken
    Assert-True ($openDup.Status -eq 409) "T-attendance : session doublon refusee (409)"

    $openAfternoon = Invoke-Api -Method POST -Path "/attendance/sessions" -Body @{
        classroomId = $classAtt
        date        = "2026-10-30"
        slot        = "afternoon"
    } -Token $teacherToken
    Assert-True ($openAfternoon.Status -eq 201 -and $openAfternoon.Json.slot -eq "afternoon") "T-attendance : session afternoon distincte"

    $roster = Invoke-Api -Path "/attendance/classrooms/$classAtt/roster?date=2026-10-30" -Token $teacherToken
    Assert-True ($roster.Status -eq 200 -and @($roster.Json.students).Count -eq 30) "T-attendance : roster 30 eleves"

    $bulkRows = 1..30 | ForEach-Object {
        @{
            studentId = ("a2100000-0000-4000-8000-" + $_.ToString().PadLeft(12, "0"))
            status    = $(if ($_ % 5 -eq 0) { "late" } elseif ($_ % 3 -eq 0) { "absent" } else { "present" })
        }
    }
    $bulkBody = @{ rows = @($bulkRows) }
    $bulkJson = $bulkBody | ConvertTo-Json -Depth 6 -Compress
    $bulkHeaders = @{ Authorization = "Bearer $teacherToken" }
    try {
        $bulkResp = Invoke-WebRequest -Method POST -Uri "$base/attendance/sessions/$sessionId/rows/bulk" -Headers $bulkHeaders -Body $bulkJson -ContentType "application/json" -UseBasicParsing
        $bulk = [pscustomobject]@{ Status = [int]$bulkResp.StatusCode; Json = ($bulkResp.Content | ConvertFrom-Json) }
    }
    catch {
        $bulk = [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Json = $null }
    }
    Assert-True ($bulk.Status -eq 200 -and $bulk.Json.accepted -eq 30) "T-attendance : enregistrement groupe de 30 eleves"

    $patchOne = Invoke-Api -Method POST -Path "/attendance/sessions/$sessionId/rows" -Body @{
        studentId = $student1
        status    = "absent"
    } -Token $teacherToken
    Assert-True ($patchOne.Status -eq 200 -and $patchOne.Json.accepted -eq 1) "T-attendance : modification avant cloture"

    $close = Invoke-Api -Method POST -Path "/attendance/sessions/$sessionId/close" -Token $teacherToken
    Assert-True ($close.Status -eq 200 -and $close.Json.status -eq "closed") "T-attendance : cloture de session"

    $writeAfterClose = Invoke-Api -Method POST -Path "/attendance/sessions/$sessionId/rows" -Body @{
        studentId = $student1
        status    = "present"
    } -Token $teacherToken
    Assert-True ($writeAfterClose.Status -eq 409) "T-attendance : ecriture apres cloture refusee (409)"

    $reopenTeacher = Invoke-Api -Method POST -Path "/attendance/sessions/$sessionId/reopen" -Body @{ reason = "erreur de saisie" } -Token $teacherToken
    Assert-True ($reopenTeacher.Status -eq 403) "T-attendance : enseignant ne peut pas rouvrir (403)"

    $reopenNoReason = Invoke-Api -Method POST -Path "/attendance/sessions/$sessionId/reopen" -Body @{ reason = "ab" } -Token $tokenA2
    Assert-True ($reopenNoReason.Status -eq 400) "T-attendance : motif trop court refuse (400)"

    $reopen = Invoke-Api -Method POST -Path "/attendance/sessions/$sessionId/reopen" -Body @{ reason = "Correction direction apres erreur maternelle" } -Token $tokenA2
    Assert-True ($reopen.Status -eq 200 -and $reopen.Json.status -eq "open") "T-attendance : reouverture direction avec motif"

    $writeAfterReopen = Invoke-Api -Method POST -Path "/attendance/sessions/$sessionId/rows" -Body @{
        studentId = $student1
        status    = "present"
    } -Token $teacherToken
    Assert-True ($writeAfterReopen.Status -eq 200) "T-attendance : ecriture possible apres reouverture"

    $auditAtt = Invoke-Api -Path "/audit?limit=100" -Token $tokenA2
    $actions = @($auditAtt.Json.entries) | ForEach-Object { $_.action }
    Assert-True ($actions -contains "attendance.session.closed") "T-attendance : cloture tracee dans AuditLog"
    Assert-True ($actions -contains "attendance.session.reopened") "T-attendance : reouverture tracee dans AuditLog"

    $crossSession = Invoke-Api -Path "/attendance/sessions/$sessionId" -Token $tokenB
    Assert-True ($crossSession.Status -eq 404) "T-attendance : session invisible depuis une autre ecole (404)"

    # --- Lot 2.3 : lectures de reference et historique ------------------------
    $classesDir = Invoke-Api -Path "/classrooms" -Token $tokenA2
    $att30 = @($classesDir.Json.classrooms) | Where-Object { $_.id -eq $classAtt }
    Assert-True ($classesDir.Status -eq 200 -and $att30 -and $att30.studentCount -eq 30) "T-2.3 : direction liste les classes (effectif 30)"
    Assert-True (@($att30.teachers | Where-Object { $_.profileId -eq $teacherProfileA }).Count -eq 1) "T-2.3 : classe expose l enseignant affecte"

    $classesTeacher = Invoke-Api -Path "/classrooms" -Token $teacherToken
    $teacherIds = @($classesTeacher.Json.classrooms) | ForEach-Object { $_.id }
    Assert-True ($classesTeacher.Status -eq 200 -and ($teacherIds -contains $classAtt) -and -not ($teacherIds -contains $classForbidden)) "T-2.3 : enseignant ne voit que ses classes affectees"

    $classesB = Invoke-Api -Path "/classrooms" -Token $tokenB
    $idsB = @($classesB.Json.classrooms) | ForEach-Object { $_.id }
    Assert-True ($classesB.Status -eq 200 -and -not ($idsB -contains $classAtt)) "T-2.3 : classes isolees par ecole"

    $teachersDir = Invoke-Api -Path "/teachers" -Token $tokenA2
    $teacherRow = @($teachersDir.Json.teachers) | Where-Object { $_.id -eq $teacherProfileA }
    Assert-True ($teachersDir.Status -eq 200 -and $teacherRow) "T-2.3 : direction liste les enseignants"
    Assert-True (-not ($teachersDir.Raw -match "@")) "T-2.3 : liste enseignants sans e-mail"
    $teachersByTeacher = Invoke-Api -Path "/teachers" -Token $teacherToken
    Assert-True ($teachersByTeacher.Status -eq 403) "T-2.3 : enseignant refuse sur /teachers (403)"

    $found = Invoke-Api -Path "/attendance/sessions?classroomId=$classAtt&date=2026-10-30" -Token $teacherToken
    Assert-True ($found.Status -eq 200 -and @($found.Json.sessions).Count -eq 2) "T-2.3 : recherche sessions classe + date (2 creneaux)"
    $foundMorning = Invoke-Api -Path "/attendance/sessions?classroomId=$classAtt&date=2026-10-30&slot=morning" -Token $teacherToken
    Assert-True ($foundMorning.Status -eq 200 -and @($foundMorning.Json.sessions).Count -eq 1 -and $foundMorning.Json.sessions[0].id -eq $sessionId) "T-2.3 : recherche par creneau renvoie la session du matin"
    Assert-True ($foundMorning.Json.sessions[0].markedCount -eq 30) "T-2.3 : compteur d eleves marques"
    $foundForbidden = Invoke-Api -Path "/attendance/sessions?classroomId=$classForbidden&date=2026-10-30" -Token $teacherToken
    Assert-True ($foundForbidden.Status -eq 403) "T-2.3 : recherche refusee sur classe non affectee (403)"
    $foundBad = Invoke-Api -Path "/attendance/sessions?date=2026-10-30" -Token $teacherToken
    Assert-True ($foundBad.Status -eq 400) "T-2.3 : recherche sans classe refusee (400)"
    $foundCross = Invoke-Api -Path "/attendance/sessions?classroomId=$classAtt&date=2026-10-30" -Token $tokenB
    Assert-True ($foundCross.Status -eq 404) "T-2.3 : recherche depuis une autre ecole (404)"

    $history = Invoke-Api -Path "/attendance/sessions/$sessionId/history" -Token $teacherToken
    $hActions = @($history.Json.entries) | ForEach-Object { $_.action }
    Assert-True ($history.Status -eq 200 -and ($hActions -contains "attendance.session.opened") -and ($hActions -contains "attendance.session.reopened")) "T-2.3 : historique de session lisible par l enseignant"
    $withChanges = @($history.Json.entries) | Where-Object { @($_.changes).Count -gt 0 }
    Assert-True (@($withChanges).Count -ge 2) "T-2.3 : historique detaille les changements par eleve"
    $reopenEntry = @($history.Json.entries) | Where-Object { $_.action -eq "attendance.session.reopened" } | Select-Object -First 1
    Assert-True ($reopenEntry.reason -and $reopenEntry.actor.displayName) "T-2.3 : historique expose motif et auteur de reouverture"
    $historyCross = Invoke-Api -Path "/attendance/sessions/$sessionId/history" -Token $tokenB
    Assert-True ($historyCross.Status -eq 404) "T-2.3 : historique invisible depuis une autre ecole (404)"
    $historyBad = Invoke-Api -Path "/attendance/sessions/pas-un-uuid/history" -Token $teacherToken
    Assert-True ($historyBad.Status -eq 400) "T-2.3 : identifiant de session invalide (400)"

    $formulaCsv = "classe,code,nom`nATT-F,F-001,=1+1`nATT-F,F-002,Eleve Sain`n"
    $formulaB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($formulaCsv))
    $formula = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "formule.csv"; contentBase64 = $formulaB64; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($formula.Raw -match "formule") "T-2.3 : injection de formule CSV detectee a l import"
    if ($formula.Json.id) { Invoke-Api -Method POST -Path "/imports/$($formula.Json.id)/cancel" -Token $tokenA2 | Out-Null }

    $fakeXlsx = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("pas un classeur"))
    $badXlsx = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "faux.xlsx"; contentBase64 = $fakeXlsx; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($badXlsx.Status -eq 400) "T-2.3 : faux .xlsx refuse (400)"

    # --- Lot 3 : eleves et familles -----------------------------------------
    $student2 = "a2100000-0000-4000-8000-000000000002"
    $seedStudentA1 = "0d000000-0000-4000-8000-000000000011"

    $stList = Invoke-Api -Path "/students?search=ATT-00" -Token $tokenA2
    Assert-True ($stList.Status -eq 200 -and @($stList.Json.students).Count -ge 9 -and @($stList.Json.students)[0].classroom.name) "T-3 : liste eleves filtree avec classe"
    $stClass = Invoke-Api -Path "/students?classroomId=$classAtt" -Token $tokenA2
    Assert-True ($stClass.Status -eq 200 -and @($stClass.Json.students).Count -eq 30) "T-3 : filtre par classe (30)"

    $profile1 = Invoke-Api -Path "/students/$student1/profile" -Token $tokenA2
    Assert-True ($profile1.Status -eq 200 -and $profile1.Json.currentClassroom.name -eq "ATT-30") "T-3 : fiche eleve avec classe courante"
    Assert-True (($profile1.Json.attendance.present + $profile1.Json.attendance.absent + $profile1.Json.attendance.late) -ge 1) "T-3 : fiche eleve avec resume des presences"
    $profileSeedTeacher = Invoke-Api -Path "/students/$seedStudentA1/profile" -Token $teacherToken
    Assert-True ($profileSeedTeacher.Status -eq 200 -and @($profileSeedTeacher.Json.guardians).Count -eq 2 -and $null -eq $profileSeedTeacher.Json.guardians[0].email) "T-3 : enseignant voit la fiche sans coordonnees familles"
    $profileCross = Invoke-Api -Path "/students/$student1/profile" -Token $tokenB
    Assert-True ($profileCross.Status -eq 404) "T-3 : fiche eleve invisible depuis une autre ecole (404)"
    $profileParent = Invoke-Api -Path "/students/$student1/profile" -Token $parentToken
    Assert-True ($profileParent.Status -eq 403) "T-3 : parent refuse sur la fiche eleve directe (403)"

    $patchMassar = Invoke-Api -Method PATCH -Path "/students/$student1" -Body @{ massarCode = "J130000001" } -Token $tokenA2
    Assert-True ($patchMassar.Status -eq 200 -and $patchMassar.Json.massarCode -eq "J130000001") "T-3 : mise a jour du code Massar"
    $patchFormula = Invoke-Api -Method PATCH -Path "/students/$student1" -Body @{ displayName = "=CMD()" } -Token $tokenA2
    Assert-True ($patchFormula.Status -eq 400) "T-3 : nom commencant par une formule refuse (400)"
    $patchTeacher = Invoke-Api -Method PATCH -Path "/students/$student1" -Body @{ displayName = "Pirate" } -Token $teacherToken
    Assert-True ($patchTeacher.Status -eq 403) "T-3 : enseignant ne modifie pas un eleve (403)"

    $move = Invoke-Api -Method POST -Path "/students/$student2/enrollment" -Body @{ classroomId = $classForbidden; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($move.Status -eq 200 -and $move.Json.from -eq "ATT-30" -and $move.Json.to -eq "ATT-INTERDITE") "T-3 : changement de classe"
    $moveSame = Invoke-Api -Method POST -Path "/students/$student2/enrollment" -Body @{ classroomId = $classForbidden; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($moveSame.Status -eq 409) "T-3 : changement vers la meme classe refuse (409)"
    $moveBack = Invoke-Api -Method POST -Path "/students/$student2/enrollment" -Body @{ classroomId = $classAtt; schoolYear = "2026-2027" } -Token $tokenA2
    Assert-True ($moveBack.Status -eq 200) "T-3 : retour dans la classe d origine"
    $profile2 = Invoke-Api -Path "/students/$student2/profile" -Token $tokenA2
    $p2Actions = @($profile2.Json.history) | ForEach-Object { $_.action }
    Assert-True ($p2Actions -contains "student.class.changed") "T-3 : historique eleve trace le changement de classe"

    $g1 = Invoke-Api -Method POST -Path "/guardians" -Body @{ fullName = "Fatima Zahra Test"; email = "fz.test@famille.ma"; phone = "+212 600000001"; address = "12 rue Atlas, Rabat" } -Token $tokenA2
    Assert-True ($g1.Status -eq 201 -and $g1.Json.id) "T-3 : creation d un responsable"
    $guardianId = [string]$g1.Json.id
    $gDup = Invoke-Api -Method POST -Path "/guardians" -Body @{ fullName = "Autre"; email = "FZ.TEST@famille.ma" } -Token $tokenA2
    Assert-True ($gDup.Status -eq 409) "T-3 : e-mail de responsable en double refuse (409)"
    $gBadPhone = Invoke-Api -Method POST -Path "/guardians" -Body @{ fullName = "Tel Faux"; phone = "abc" } -Token $tokenA2
    Assert-True ($gBadPhone.Status -eq 400) "T-3 : telephone invalide refuse (400)"

    $link1 = Invoke-Api -Method POST -Path "/guardians/$guardianId/students" -Body @{ studentId = $student1; relationship = "mere" } -Token $tokenA2
    $link2 = Invoke-Api -Method POST -Path "/guardians/$guardianId/students" -Body @{ studentId = $student2; relationship = "mere" } -Token $tokenA2
    Assert-True ($link1.Status -eq 201 -and $link2.Status -eq 201 -and @($link2.Json.students).Count -eq 2) "T-3 : un responsable rattache a deux enfants"
    $linkDup = Invoke-Api -Method POST -Path "/guardians/$guardianId/students" -Body @{ studentId = $student1 } -Token $tokenA2
    Assert-True ($linkDup.Status -eq 409) "T-3 : lien en double refuse (409)"
    $linkFull = Invoke-Api -Method POST -Path "/guardians/$guardianId/students" -Body @{ studentId = $seedStudentA1 } -Token $tokenA2
    Assert-True ($linkFull.Status -eq 409) "T-3 : troisieme responsable refuse (409)"
    $gTeacher = Invoke-Api -Path "/guardians" -Token $teacherToken
    Assert-True ($gTeacher.Status -eq 403) "T-3 : enseignant refuse sur /guardians (403)"
    $gCross = Invoke-Api -Path "/guardians/$guardianId" -Token $tokenB
    Assert-True ($gCross.Status -eq 404) "T-3 : responsable invisible depuis une autre ecole (404)"

    $invite = Invoke-Api -Method POST -Path "/guardians/$guardianId/invitation" -Token $tokenA2
    Assert-True ($invite.Status -eq 201 -and $invite.Json.token) "T-3 : invitation parent emise"
    $accept = Invoke-Api -Method POST -Path "/activation/invitation" -Body @{ token = $invite.Json.token; password = "MotDePasse123!"; fullName = "Fatima Zahra Test" }
    Assert-True ($accept.Json.accessToken -and $accept.Json.profile.role -eq "parent") "T-3 : invitation acceptee, compte parent cree"
    $newParentToken = $accept.Json.accessToken
    $kids = Invoke-Api -Path "/family/children" -Token $newParentToken
    $kidIds = @($kids.Json.children) | ForEach-Object { $_.id }
    Assert-True ($kids.Status -eq 200 -and $kidIds.Count -eq 2 -and ($kidIds -contains $student1) -and ($kidIds -contains $student2)) "T-3 : parent voit ses deux enfants"
    $kidOther = Invoke-Api -Path "/family/children/$seedStudentA1" -Token $newParentToken
    Assert-True ($kidOther.Status -eq 404) "T-3 : parent ne voit pas un enfant d une autre famille (404)"
    $kidOne = Invoke-Api -Path "/family/children/$student1" -Token $newParentToken
    Assert-True ($kidOne.Status -eq 200 -and @($kidOne.Json.recent).Count -ge 1) "T-3 : parent consulte les presences de son enfant"
    $parentStudentsList = Invoke-Api -Path "/students" -Token $newParentToken
    Assert-True ($parentStudentsList.Status -eq 403) "T-3 : nouveau parent refuse sur /students (403)"
    $reinvite = Invoke-Api -Method POST -Path "/guardians/$guardianId/invitation" -Token $tokenA2
    Assert-True ($reinvite.Status -eq 409) "T-3 : responsable deja inscrit non reinvitable (409)"
    $seedKids = Invoke-Api -Path "/family/children" -Token $parentToken
    Assert-True ($seedKids.Status -eq 200 -and @($seedKids.Json.children).Count -eq 2) "T-3 : parent du seed voit ses deux enfants"
    $familyByDirection = Invoke-Api -Path "/family/children" -Token $tokenA2
    Assert-True ($familyByDirection.Status -eq 403) "T-3 : espace parent refuse a la direction (403)"

    $unlink = Invoke-Api -Method DELETE -Path "/guardians/$guardianId/students/$student2" -Token $tokenA2
    Assert-True ($unlink.Status -eq 200 -and @($unlink.Json.students).Count -eq 1) "T-3 : retrait d un lien responsable-eleve"
    $kidsAfter = Invoke-Api -Path "/family/children" -Token $newParentToken
    Assert-True (@($kidsAfter.Json.children).Count -eq 1) "T-3 : le parent ne voit plus l enfant detache"

    $gCsv = "code eleve,responsable,email,telephone,lien`nATT-003,Karim Import,karim.import@famille.ma,0611223344,pere`nATT-003,Salma Import,,0611223355,mere`nATT-004,Karim Import,karim.import@famille.ma,,pere`nINCONNU-1,Personne,,,`nATT-005,=EVIL(),,,`n"
    $gB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($gCsv))
    $gImport = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "responsables.csv"; contentBase64 = $gB64; schoolYear = "2026-2027"; kind = "guardians" } -Token $tokenA2
    Assert-True ($gImport.Status -eq 201 -and $gImport.Json.kind -eq "guardians" -and $gImport.Json.validRows -eq 3 -and $gImport.Json.invalidRows -eq 2) "T-3 : apercu import responsables (3 valides, 2 erreurs)"
    $gCommit = Invoke-Api -Method POST -Path "/imports/$($gImport.Json.id)/commit" -Token $tokenA2
    Assert-True ($gCommit.Status -eq 201 -or $gCommit.Status -eq 200) "T-3 : validation import responsables"
    Assert-True ($gCommit.Json.guardiansCreated -eq 2 -and $gCommit.Json.guardiansReused -eq 1 -and $gCommit.Json.links -eq 3) "T-3 : responsables crees, reutilises et lies"
    $karim = Invoke-Api -Path "/guardians?search=Karim%20Import" -Token $tokenA2
    Assert-True (@($karim.Json.guardians).Count -eq 1 -and @(@($karim.Json.guardians)[0].students).Count -eq 2) "T-3 : responsable importe rattache a deux enfants"
    $gBadHeader = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("code eleve,email`nATT-003,a@b.ma`n"))
    $gImportBad = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "resp.csv"; contentBase64 = $gBadHeader; schoolYear = "2026-2027"; kind = "guardians" } -Token $tokenA2
    Assert-True ($gImportBad.Status -eq 400) "T-3 : import responsables sans colonne nom refuse (400)"

    # --- Lot 4 : espace parents ---------------------------------------------
    $pdfB64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n1 0 obj<<>>endobj`ntrailer<<>>`n%%EOF`n"))
    $exeB64 = [Convert]::ToBase64String([byte[]](0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00))
    $pngB64 = [Convert]::ToBase64String([byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00))

    $j1 = Invoke-Upload -Path "/family/justifications" -Token $newParentToken -Base64 $pdfB64 -Name "certificat.pdf" -Mime "application/pdf" -Fields @("studentId=$student1", "fromDate=2026-10-01", "toDate=2026-10-30", "reason=Maladie, certificat medical joint")
    Assert-True ($j1.Status -eq 201 -and $j1.Json.status -eq "pending" -and $j1.Json.file.scanStatus -eq "clean" -and $j1.Json.reason -eq "Maladie, certificat medical joint") "T-4 : justificatif depose en multipart avec PDF (ClamAV clean, motif rendu au parent auteur)"
    $jB64 = Invoke-Api -Method POST -Path "/family/justifications" -Body @{ studentId = $student1; fromDate = "2026-10-01"; toDate = "2026-10-02"; reason = "Ancienne voie"; file = @{ filename = "certificat.pdf"; contentBase64 = $pdfB64 } } -Token $newParentToken
    Assert-True ($jB64.Status -eq 400) "T-4 : ancienne voie JSON base64 supprimee (400)"
    $j1Id = [string]$j1.Json.id
    $jOther = Invoke-Api -Method POST -Path "/family/justifications" -Body @{ studentId = $seedStudentA1; fromDate = "2026-10-01"; toDate = "2026-10-02"; reason = "Pas mon enfant" } -Token $newParentToken
    Assert-True ($jOther.Status -eq 404) "T-4 : justificatif refuse pour l enfant d une autre famille (404)"
    $jExe = Invoke-Upload -Path "/family/justifications" -Token $newParentToken -Base64 $exeB64 -Name "certificat.pdf" -Mime "application/pdf" -Fields @("studentId=$student1", "fromDate=2026-10-01", "toDate=2026-10-02", "reason=Fichier piege")
    Assert-True ($jExe.Status -eq 400) "T-4 : executable deguise en PDF refuse (magic bytes, 400)"
    $jMismatch = Invoke-Upload -Path "/family/justifications" -Token $newParentToken -Base64 $pngB64 -Name "photo.pdf" -Mime "application/pdf" -Fields @("studentId=$student1", "fromDate=2026-10-01", "toDate=2026-10-02", "reason=Extension fausse")
    Assert-True ($jMismatch.Status -eq 400) "T-4 : extension incoherente avec le contenu refusee (400)"
    $jRange = Invoke-Api -Method POST -Path "/family/justifications" -Body @{ studentId = $student1; fromDate = "2026-09-01"; toDate = "2026-10-30"; reason = "Trop long" } -Token $newParentToken
    Assert-True ($jRange.Status -eq 400) "T-4 : periode de plus de 31 jours refusee (400)"
    $jFormula = Invoke-Api -Method POST -Path "/family/justifications" -Body @{ studentId = $student1; fromDate = "2026-10-01"; toDate = "2026-10-02"; reason = "=HYPERLINK(1)" } -Token $newParentToken
    Assert-True ($jFormula.Status -eq 400) "T-4 : motif commencant par une formule refuse (400)"
    $jTeacher = Invoke-Api -Method POST -Path "/family/justifications" -Body @{ studentId = $student1; fromDate = "2026-10-01"; toDate = "2026-10-02"; reason = "Enseignant" } -Token $teacherToken
    Assert-True ($jTeacher.Status -eq 403) "T-4 : enseignant ne depose pas de justificatif (403)"

    $jMine = Invoke-Api -Path "/family/justifications" -Token $newParentToken
    Assert-True ((@($jMine.Json.justifications) | ForEach-Object { $_.id }) -contains $j1Id) "T-4 : parent voit son justificatif"
    $jSeedParent = Invoke-Api -Path "/family/justifications" -Token $parentToken
    Assert-True (-not ((@($jSeedParent.Json.justifications) | ForEach-Object { $_.id }) -contains $j1Id)) "T-4 : autre parent ne voit pas ce justificatif"
    $fileOther = Invoke-Api -Path "/family/justifications/$j1Id/file" -Token $parentToken
    Assert-True ($fileOther.Status -eq 404) "T-4 : fichier inaccessible a un autre parent (404, decision t49u)"
    $fileOwn = Invoke-WebRequest -Uri "$base/family/justifications/$j1Id/file" -Headers @{ Authorization = "Bearer $newParentToken" } -UseBasicParsing
    Assert-True ($fileOwn.StatusCode -eq 200 -and $fileOwn.Headers["Content-Type"] -eq "application/pdf") "T-4 : le parent auteur telecharge sa propre piece (decision t49u)"
    $fileNoAuth = Invoke-Api -Path "/justifications/$j1Id/file"
    Assert-True ($fileNoAuth.Status -eq 401) "T-4 : aucun acces anonyme au fichier (401)"

    $jPending = Invoke-Api -Path "/justifications?status=pending" -Token $tokenA2
    Assert-True ((@($jPending.Json.justifications) | ForEach-Object { $_.id }) -contains $j1Id) "T-4 : direction voit le justificatif en attente"
    $fileDir = Invoke-Api -Path "/justifications/$j1Id/file" -Token $tokenA2
    Assert-True ($fileDir.Status -eq 200) "T-4 : direction telecharge la piece analysee clean"
    $fileCross = Invoke-Api -Path "/justifications/$j1Id/file" -Token $tokenB
    Assert-True ($fileCross.Status -eq 404) "T-4 : fichier invisible depuis une autre ecole (404)"
    $reviewCross = Invoke-Api -Method POST -Path "/justifications/$j1Id/review" -Body @{ decision = "accepted" } -Token $tokenB
    Assert-True ($reviewCross.Status -eq 404) "T-4 : examen impossible depuis une autre ecole (404)"
    $jListTeacher = Invoke-Api -Path "/justifications" -Token $teacherToken
    Assert-True ($jListTeacher.Status -eq 403) "T-4 : enseignant n examine pas les justificatifs (403)"
    $reviewByParent = Invoke-Api -Method POST -Path "/justifications/$j1Id/review" -Body @{ decision = "accepted" } -Token $newParentToken
    Assert-True ($reviewByParent.Status -eq 403) "T-4 : parent ne s auto-valide pas (403)"
    $rejectNoNote = Invoke-Api -Method POST -Path "/justifications/$j1Id/review" -Body @{ decision = "rejected" } -Token $tokenA2
    Assert-True ($rejectNoNote.Status -eq 400) "T-4 : refus sans motif refuse (400)"
    $accept4 = Invoke-Api -Method POST -Path "/justifications/$j1Id/review" -Body @{ decision = "accepted"; note = "Certificat recu" } -Token $tokenA2
    Assert-True ($accept4.Status -eq 200 -and $accept4.Json.status -eq "accepted") "T-4 : justificatif accepte"
    $acceptAgain = Invoke-Api -Method POST -Path "/justifications/$j1Id/review" -Body @{ decision = "rejected"; note = "Trop tard" } -Token $tokenA2
    Assert-True ($acceptAgain.Status -eq 409) "T-4 : double examen refuse (409)"

    $child4 = Invoke-Api -Path "/family/children/$student1" -Token $newParentToken
    $missed4 = @($child4.Json.recent) | Where-Object { $_.status -ne "present" }
    Assert-True ($child4.Status -eq 200 -and $child4.Json.recentUnjustified -eq 0 -and (@($missed4 | Where-Object { -not $_.justified }).Count -eq 0)) "T-4 : absences couvertes marquees justifiees"
    $hist4 = Invoke-Api -Path "/students/$student1/profile" -Token $tokenA2
    Assert-True ((@($hist4.Json.history) | ForEach-Object { $_.action }) -contains "student.justification.accepted") "T-4 : decision tracee dans l historique eleve"

    $notif = Invoke-Api -Path "/notifications" -Token $newParentToken
    $notifAccepted = @($notif.Json.notifications) | Where-Object { $_.kind -eq "justification.accepted" } | Select-Object -First 1
    Assert-True ($notif.Status -eq 200 -and $notif.Json.unread -ge 1 -and $notifAccepted) "T-4 : notification in-app de la decision"
    $notifForeign = Invoke-Api -Method POST -Path "/notifications/$($notifAccepted.id)/read" -Token $parentToken
    Assert-True ($notifForeign.Status -eq 404) "T-4 : notification d un autre compte inaccessible (404)"
    $notifRead = Invoke-Api -Method POST -Path "/notifications/$($notifAccepted.id)/read" -Token $newParentToken
    $notifAfter = Invoke-Api -Path "/notifications" -Token $newParentToken
    Assert-True ($notifRead.Status -eq 200 -and $notifAfter.Json.unread -eq ($notif.Json.unread - 1)) "T-4 : notification marquee lue"

    $act = Invoke-Api -Method POST -Path "/parent-actions" -Body @{ studentId = $student1; title = "Signer la fiche sanitaire"; dueDate = "2026-11-15" } -Token $tokenA2
    Assert-True ($act.Status -eq 201 -and $act.Json.status -eq "open" -and $act.Json.notified -ge 1) "T-4 : action demandee aux parents, notification envoyee"
    $actId = [string]$act.Json.id
    $actCross = Invoke-Api -Method POST -Path "/parent-actions" -Body @{ studentId = $student1; title = "Intrusion" } -Token $tokenB
    Assert-True ($actCross.Status -eq 404) "T-4 : action sur un eleve d une autre ecole refusee (404)"
    $actByParent = Invoke-Api -Method POST -Path "/parent-actions" -Body @{ studentId = $student1; title = "Parent createur" } -Token $newParentToken
    Assert-True ($actByParent.Status -eq 403) "T-4 : parent ne cree pas d action (403)"
    $actSeed = Invoke-Api -Path "/family/actions" -Token $parentToken
    Assert-True (-not ((@($actSeed.Json.actions) | ForEach-Object { $_.id }) -contains $actId)) "T-4 : action invisible pour un autre parent"
    $actSeedDone = Invoke-Api -Method POST -Path "/family/actions/$actId/done" -Token $parentToken
    Assert-True ($actSeedDone.Status -eq 404) "T-4 : autre parent ne cloture pas l action (404)"
    $actMine = Invoke-Api -Path "/family/actions" -Token $newParentToken
    Assert-True ((@($actMine.Json.actions) | ForEach-Object { $_.id }) -contains $actId) "T-4 : parent voit l action demandee"
    $actDone = Invoke-Api -Method POST -Path "/family/actions/$actId/done" -Token $newParentToken
    Assert-True ($actDone.Status -eq 200 -and $actDone.Json.status -eq "done") "T-4 : parent signale l action faite"
    $actDoneAgain = Invoke-Api -Method POST -Path "/family/actions/$actId/done" -Token $newParentToken
    Assert-True ($actDoneAgain.Status -eq 409) "T-4 : action deja faite (409)"

    # --- Lot 5 : communication ecole-famille --------------------------------
    $chan = Invoke-Api -Path "/messages/channels" -Token $tokenA2
    $chanEmail = @($chan.Json.channels) | Where-Object { $_.channel -eq "email" }
    $chanInApp = @($chan.Json.channels) | Where-Object { $_.channel -eq "in_app" }
    $chanNames = (@($chan.Json.channels) | ForEach-Object { $_.channel }) -join ","
    Assert-True ($chanNames -eq "in_app,email") "P0-6 : /messages/channels ne renvoie que in_app et email (aucun canal SMS ni WhatsApp)"
    $m0 = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "class_message"; audience = "classroom"; classroomId = $classAtt; title = "Canal retire"; body = "x"; channels = @("whatsapp") } -Token $teacherToken
    Assert-True ($m0.Status -eq 400) "P0-6 : un canal retire est refuse a la creation (400)"
    Assert-True ($chan.Status -eq 200 -and $chanInApp.configured -eq $true -and $chanEmail.configured -eq $false -and $chanEmail.label -like "Non configur*") "T-5 : canaux (in-app actif, e-mail non configure)"

    $m1 = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "class_message"; audience = "classroom"; classroomId = $classAtt; title = "Sortie au musee"; body = "Merci de confirmer la lecture."; requiresAck = $true; channels = @("email") } -Token $teacherToken
    $m1Email = @($m1.Json.delivery) | Where-Object { $_.channel -eq "email" }
    $m1InApp = @($m1.Json.delivery) | Where-Object { $_.channel -eq "in_app" }
    Assert-True ($m1.Status -eq 201 -and $m1.Json.recipients -ge 1 -and $m1InApp.status -eq "sent") "T-5 : message de classe envoye par l enseignant"
    Assert-True ($m1Email.status -eq "not_configured" -and $m1Email.delivered -eq 0) "T-5 : e-mail non configure, aucun envoi simule"
    $m1Id = [string]$m1.Json.id
    $mForbidden = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "class_message"; audience = "classroom"; classroomId = $classForbidden; title = "Pas ma classe"; body = "x" } -Token $teacherToken
    Assert-True ($mForbidden.Status -eq 403) "T-5 : enseignant refuse sur une classe non affectee (403)"
    $mTeacherSchool = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "announcement"; audience = "school"; title = "Annonce prof"; body = "x" } -Token $teacherToken
    Assert-True ($mTeacherSchool.Status -eq 403) "T-5 : enseignant ne publie pas a toute l ecole (403)"
    $mMismatch = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "direct"; audience = "school"; title = "Incoherent"; body = "x" } -Token $tokenA2
    Assert-True ($mMismatch.Status -eq 400) "T-5 : type et public incoherents (400)"
    $mEventNoDate = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "event"; audience = "school"; title = "Fete de fin d annee"; body = "x" } -Token $tokenA2
    Assert-True ($mEventNoDate.Status -eq 400) "T-5 : evenement sans date refuse (400)"
    $mEvent = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "event"; audience = "school"; title = "Fete de fin d annee"; body = "Au gymnase."; eventAt = "2026-12-18T15:00:00.000Z"; eventLocation = "Gymnase" } -Token $tokenA2
    Assert-True ($mEvent.Status -eq 201) "T-5 : evenement publie"
    $mAnn = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "announcement"; audience = "school"; title = "Reunion parents"; body = "Jeudi 18h."; important = $true } -Token $tokenA2
    Assert-True ($mAnn.Status -eq 201 -and $mAnn.Json.recipients -ge 2) "T-5 : annonce importante a toute l ecole"
    $mAnnId = [string]$mAnn.Json.id
    $mCross = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "class_message"; audience = "classroom"; classroomId = $classAtt; title = "Intrusion"; body = "x" } -Token $tokenB
    Assert-True ($mCross.Status -eq 404) "T-5 : envoi vers une classe d une autre ecole (404)"
    $mCrossRead = Invoke-Api -Path "/messages/$m1Id" -Token $tokenB
    Assert-True ($mCrossRead.Status -eq 404) "T-5 : message invisible depuis une autre ecole (404)"
    $mByParent = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "announcement"; audience = "school"; title = "Parent"; body = "x" } -Token $newParentToken
    Assert-True ($mByParent.Status -eq 403) "T-5 : parent ne publie pas (403)"
    $teacherOtherMsg = Invoke-Api -Path "/messages/$mAnnId" -Token $teacherToken
    Assert-True ($teacherOtherMsg.Status -eq 404) "T-5 : enseignant ne lit pas le suivi d un message de la direction (404)"

    $inbox = Invoke-Api -Path "/family/messages" -Token $newParentToken
    $inboxM1 = @($inbox.Json.messages) | Where-Object { $_.id -eq $m1Id }
    Assert-True ($inbox.Status -eq 200 -and $inboxM1 -and $null -eq $inboxM1.readAt) "T-5 : parent recoit le message de classe (non lu)"
    $inboxSeed = Invoke-Api -Path "/family/messages" -Token $parentToken
    $seedIds = @($inboxSeed.Json.messages) | ForEach-Object { $_.id }
    Assert-True ((-not ($seedIds -contains $m1Id)) -and ($seedIds -contains $mAnnId)) "T-5 : autre parent recoit l annonce mais pas le message de classe"
    $seedOpen = Invoke-Api -Path "/family/messages/$m1Id" -Token $parentToken
    Assert-True ($seedOpen.Status -eq 404) "T-5 : message d une autre classe inaccessible (404)"
    $open1 = Invoke-Api -Path "/family/messages/$m1Id" -Token $newParentToken
    Assert-True ($open1.Status -eq 200 -and $open1.Json.readAt) "T-5 : ouverture marque le message lu"
    $ack1 = Invoke-Api -Method POST -Path "/family/messages/$m1Id/ack" -Token $newParentToken
    Assert-True ($ack1.Status -eq 200 -and $ack1.Json.acknowledgedAt) "T-5 : accuse de reception"
    $ackAnn = Invoke-Api -Method POST -Path "/family/messages/$mAnnId/ack" -Token $newParentToken
    Assert-True ($ackAnn.Status -eq 400) "T-5 : accuse refuse si non demande (400)"
    $track = Invoke-Api -Path "/messages/$m1Id" -Token $teacherToken
    Assert-True ($track.Status -eq 200 -and @(@($track.Json.tracking) | Where-Object { $_.readAt -and $_.acknowledgedAt }).Count -ge 1) "T-5 : suivi des lectures et accuses par parent"
    $sent = Invoke-Api -Path "/messages" -Token $teacherToken
    $sentM1 = @($sent.Json.messages) | Where-Object { $_.id -eq $m1Id }
    Assert-True ($sentM1.readCount -ge 1 -and $sentM1.ackCount -ge 1 -and -not (@($sent.Json.messages) | Where-Object { $_.id -eq $mAnnId })) "T-5 : liste envoyee de l enseignant avec compteurs"

    $direct = Invoke-Api -Method POST -Path "/messages" -Body @{ kind = "direct"; audience = "student"; studentId = $student1; title = "Comportement en classe"; body = "Pouvons-nous en parler ?" } -Token $teacherToken
    Assert-True ($direct.Status -eq 201 -and $direct.Json.recipients -ge 1) "T-5 : message individuel a une famille"
    $directId = [string]$direct.Json.id
    $replyP = Invoke-Api -Method POST -Path "/family/messages/$directId/replies" -Body @{ body = "Oui, mardi apres 17h." } -Token $newParentToken
    Assert-True ($replyP.Status -eq 201) "T-5 : reponse du parent"
    $replyT = Invoke-Api -Method POST -Path "/messages/$directId/replies" -Body @{ body = "Parfait, a mardi." } -Token $teacherToken
    Assert-True ($replyT.Status -eq 201) "T-5 : reponse de l enseignant"
    $thread = Invoke-Api -Path "/family/messages/$directId" -Token $newParentToken
    Assert-True (@($thread.Json.replies).Count -eq 2 -and @($thread.Json.replies)[0].mine -eq $true) "T-5 : historique de l echange"
    $replyClass = Invoke-Api -Method POST -Path "/family/messages/$m1Id/replies" -Body @{ body = "Reponse" } -Token $newParentToken
    Assert-True ($replyClass.Status -eq 400) "T-5 : pas de reponse sur un message de classe (400)"
    $replySeed = Invoke-Api -Method POST -Path "/family/messages/$directId/replies" -Body @{ body = "Intrusion" } -Token $parentToken
    Assert-True ($replySeed.Status -eq 404) "T-5 : autre parent ne repond pas a l echange (404)"
    $teacherNotif = Invoke-Api -Path "/notifications" -Token $teacherToken
    Assert-True (@(@($teacherNotif.Json.notifications) | Where-Object { $_.kind -eq "message.reply" }).Count -ge 1) "T-5 : enseignant notifie de la reponse"
    $parentNotif = Invoke-Api -Path "/notifications" -Token $newParentToken
    $kinds5 = @($parentNotif.Json.notifications) | ForEach-Object { $_.kind }
    Assert-True (($kinds5 -contains "message.new") -and ($kinds5 -contains "message.important")) "T-5 : notifications in-app des messages"

    $s5 = Invoke-Api -Method POST -Path "/attendance/sessions" -Body @{ classroomId = $classAtt; date = "2026-10-29"; slot = "afternoon" } -Token $teacherToken
    $s5Id = [string]$s5.Json.id
    $s5Mark = Invoke-Api -Method POST -Path "/attendance/sessions/$s5Id/rows" -Body @{ studentId = $student1; status = "absent" } -Token $teacherToken
    $s5Close = Invoke-Api -Method POST -Path "/attendance/sessions/$s5Id/close" -Token $teacherToken
    Assert-True ($s5.Status -eq 201 -and $s5Mark.Status -eq 200 -and $s5Close.Status -eq 200 -and $s5Close.Json.familiesNotified -ge 1) "T-5 : cloture notifie les familles des absents"
    Assert-True ($s5Close.Json.actionsCreated -eq 1) "P0-5 : cloture avec 1 absent lie a un parent -> 1 carte A faire creee"
    $p5Actions = @((Invoke-Api -Path "/family/actions" -Token $newParentToken).Json.actions) | Where-Object { $_.title -like "Justifier l'absence du 29/10/2026*" }
    Assert-True (@($p5Actions).Count -eq 1 -and @($p5Actions)[0].status -eq "open") "P0-5 : carte ouverte visible dans /family/actions"
    $p5Other = @((Invoke-Api -Path "/family/actions" -Token $parentToken).Json.actions) | Where-Object { $_.title -like "Justifier l'absence du 29/10/2026*" }
    Assert-True (@($p5Other).Count -eq 0) "P0-5 : carte invisible pour un parent d un autre eleve"
    $absNotif = Invoke-Api -Path "/notifications" -Token $newParentToken
    Assert-True (@(@($absNotif.Json.notifications) | Where-Object { $_.kind -eq "attendance.absent" }).Count -eq 1) "T-5 : parent notifie de l absence"
    $s5Reopen = Invoke-Api -Method POST -Path "/attendance/sessions/$s5Id/reopen" -Body @{ reason = "verification lot 5" } -Token $tokenA2
    $s5Close2 = Invoke-Api -Method POST -Path "/attendance/sessions/$s5Id/close" -Token $tokenA2
    Assert-True ($s5Reopen.Status -eq 200 -and $s5Close2.Json.familiesNotified -eq 0) "T-5 : pas de notification en double apres reouverture"
    Assert-True ($s5Close2.Json.actionsCreated -eq 0) "P0-5 : pas de carte en double apres reouverture et nouvelle cloture"

    # --- t87u tache 5 : synchronisation hors ligne (F03 / B11, ADR-003) -----
    $syS = Invoke-Api -Method POST -Path "/attendance/sessions" -Body @{ classroomId = $classAtt; date = "2026-10-28"; slot = "morning" } -Token $teacherToken
    $syId = [string]$syS.Json.id
    $syStu3 = "a2100000-0000-4000-8000-000000000003"; $syStu4 = "a2100000-0000-4000-8000-000000000004"
    $syIso = { param($d) $d.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") }
    $syT0 = (Get-Date).ToUniversalTime().AddMinutes(-30)
    $syM1 = [guid]::NewGuid().ToString(); $syM2 = [guid]::NewGuid().ToString()
    $syBatch1 = @(
        @{ clientMutationId = $syM1; studentId = $syStu3; status = "absent"; recordedAt = (& $syIso $syT0) },
        @{ clientMutationId = $syM2; studentId = $syStu4; status = "late"; recordedAt = (& $syIso $syT0.AddSeconds(5)) }
    )
    $sy1 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = $syBatch1 } -Token $teacherToken
    Assert-True ($syS.Status -eq 201 -and $sy1.Status -eq 200 -and $sy1.Json.sessionStatus -eq "open" -and @(@($sy1.Json.results) | Where-Object { $_.result -eq "applied" }).Count -eq 2) "SYNC-1 : file hors ligne appliquee (2 mutations, session ouverte)"
    $syV1 = (Invoke-Api -Path "/attendance/sessions/$syId" -Token $teacherToken).Json.version
    $sy2 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = $syBatch1 } -Token $teacherToken
    $syV2 = (Invoke-Api -Path "/attendance/sessions/$syId" -Token $teacherToken).Json.version
    Assert-True ($sy2.Status -eq 200 -and @(@($sy2.Json.results) | Where-Object { $_.result -eq "duplicate" }).Count -eq 2 -and $syV2 -eq $syV1) "SYNC-2 : rejeu identique -> duplicate, aucune ecriture (version de session inchangee)"
    $sy3 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "present"; recordedAt = (& $syIso $syT0.AddSeconds(60)) }) } -Token $teacherToken
    $sy4 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "late"; recordedAt = (& $syIso $syT0.AddSeconds(30)) }) } -Token $teacherToken
    $syRow3 = @((Invoke-Api -Path "/attendance/sessions/$syId" -Token $teacherToken).Json.rows) | Where-Object { $_.studentId -eq $syStu3 }
    Assert-True (@($sy3.Json.results)[0].result -eq "applied" -and @($sy4.Json.results)[0].result -eq "stale" -and @($sy4.Json.results)[0].status -eq "present" -and $syRow3.status -eq "present") "SYNC-3 : dernier ecrit gagne ; mutation plus ancienne -> stale, ligne inchangee"
    $syOnline = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/rows" -Body @{ studentId = $syStu4; status = "present" } -Token $teacherToken
    $sy5 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu4; status = "absent"; recordedAt = (& $syIso $syT0.AddSeconds(10)) }) } -Token $teacherToken
    Assert-True ($syOnline.Status -eq 200 -and @($sy5.Json.results)[0].result -eq "stale" -and @($sy5.Json.results)[0].status -eq "present") "SYNC-4 : saisie en ligne plus recente gagne sur une mutation hors ligne plus ancienne"
    $sy6 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "absent"; recordedAt = "2030-01-01T00:00:00.000Z" }) } -Token $teacherToken
    $syRow3b = @((Invoke-Api -Path "/attendance/sessions/$syId" -Token $teacherToken).Json.rows) | Where-Object { $_.studentId -eq $syStu3 }
    Assert-True (@($sy6.Json.results)[0].result -eq "applied" -and ([datetime]$syRow3b.recordedAt).ToUniversalTime() -le (Get-Date).ToUniversalTime().AddSeconds(5)) "SYNC-5 : heure client future bornee a l heure serveur"
    $sy7 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = $syM2; studentId = $syStu3; status = "absent"; recordedAt = (& $syIso (Get-Date)) }) } -Token $teacherToken
    Assert-True ($sy7.Status -eq 200 -and @($sy7.Json.results)[0].result -eq "rejected") "SYNC-6 : identifiant de mutation courant reutilise pour un autre eleve -> rejected"
    $sy8 = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = "a2100000-0000-4000-8000-000000000999"; status = "absent"; recordedAt = (& $syIso (Get-Date)) }) } -Token $teacherToken
    Assert-True ($sy8.Status -eq 200 -and @($sy8.Json.results)[0].result -eq "rejected") "SYNC-7 : eleve non inscrit dans la classe -> rejected"
    $syNoId = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ studentId = $syStu3; status = "absent"; recordedAt = (& $syIso (Get-Date)) }) } -Token $teacherToken
    $syBadDate = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "absent"; recordedAt = "hier" }) } -Token $teacherToken
    $syTooMany = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(1..201 | ForEach-Object { @{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "present"; recordedAt = "2026-10-28T08:00:00.000Z" } }) } -Token $teacherToken
    Assert-True ($syNoId.Status -eq 400 -and $syBadDate.Status -eq 400 -and $syTooMany.Status -eq 400) "SYNC-8 : identifiant client et heure ISO obligatoires, 200 mutations maximum (400)"
    $syCross = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "absent"; recordedAt = (& $syIso (Get-Date)) }) } -Token $tokenB
    Assert-True ($syCross.Status -eq 404) "SYNC-9 : session d une autre ecole introuvable (404)"
    $syPresent = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "present"; recordedAt = (& $syIso (Get-Date)) }) } -Token $teacherToken
    $syClose = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/close" -Token $teacherToken
    $syLate = Invoke-Api -Method POST -Path "/attendance/sessions/$syId/sync" -Body @{ mutations = @(@{ clientMutationId = [guid]::NewGuid().ToString(); studentId = $syStu3; status = "absent"; recordedAt = (& $syIso (Get-Date)) }) } -Token $teacherToken
    $syRow3c = @((Invoke-Api -Path "/attendance/sessions/$syId" -Token $teacherToken).Json.rows) | Where-Object { $_.studentId -eq $syStu3 }
    Assert-True (@($syPresent.Json.results)[0].result -eq "applied" -and $syClose.Status -eq 200 -and $syClose.Json.actionsCreated -eq 0 -and $syLate.Status -eq 200 -and $syLate.Json.sessionStatus -eq "closed" -and @($syLate.Json.results)[0].result -eq "closed" -and $syRow3c.status -eq "present") "SYNC-10 : apres cloture le serveur gagne (closed, rien n est ecrit, pas de 409)"
    $syAudit = @((Invoke-Api -Path "/audit?limit=100" -Token $tokenA2).Json.entries) | Where-Object { $_.action -eq "attendance.rows.synced" }
    Assert-True (@($syAudit).Count -ge 5) "SYNC-11 : chaque synchronisation tracee (attendance.rows.synced)"
    # --- Lot 6 : agenda et devoirs ------------------------------------------
    $hw = Invoke-Upload -Path "/agenda" -Token $teacherToken -Base64 $pdfB64 -Name "consignes.pdf" -Mime "application/pdf" -FileField "attachments" -Fields @("kind=homework", "classroomId=$classAtt", "title=Exercices 4 a 7 page 52", "description=Rediger proprement.", "date=2026-11-05")
    Assert-True ($hw.Status -eq 201 -and @($hw.Json.attachments).Count -eq 1 -and $hw.Json.notified -ge 1) "T-6 : devoir publie par l enseignant avec piece jointe, parents notifies"
    $hwId = [string]$hw.Json.id
    $hwAtt = [string]@($hw.Json.attachments)[0].id
    $hwForbidden = Invoke-Api -Method POST -Path "/agenda" -Body @{ kind = "homework"; classroomId = $classForbidden; title = "Pas ma classe"; date = "2026-11-05" } -Token $teacherToken
    Assert-True ($hwForbidden.Status -eq 403) "T-6 : enseignant refuse sur une classe non affectee (403)"
    $teacherSchoolDate = Invoke-Api -Method POST -Path "/agenda" -Body @{ kind = "important_date"; title = "Vacances"; date = "2026-12-20" } -Token $teacherToken
    Assert-True ($teacherSchoolDate.Status -eq 403) "T-6 : enseignant ne publie pas de date d ecole (403)"
    $hwNoClass = Invoke-Api -Method POST -Path "/agenda" -Body @{ kind = "homework"; title = "Sans classe"; date = "2026-11-05" } -Token $tokenA2
    Assert-True ($hwNoClass.Status -eq 400) "T-6 : devoir sans classe refuse (400)"
    $hwExe = Invoke-Upload -Path "/agenda" -Token $teacherToken -Base64 $exeB64 -Name "devoir.pdf" -Mime "application/pdf" -FileField "attachments" -Fields @("kind=homework", "classroomId=$classAtt", "title=Piege", "date=2026-11-05")
    Assert-True ($hwExe.Status -eq 400) "T-6 : piece jointe executable refusee (400)"
    $impDate = Invoke-Api -Method POST -Path "/agenda" -Body @{ kind = "important_date"; title = "Vacances d hiver"; date = "2026-12-20" } -Token $tokenA2
    Assert-True ($impDate.Status -eq 201) "T-6 : date importante d ecole publiee par la direction"
    $impId = [string]$impDate.Json.id
    $hwCross = Invoke-Api -Method POST -Path "/agenda" -Body @{ kind = "homework"; classroomId = $classAtt; title = "Intrusion"; date = "2026-11-05" } -Token $tokenB
    Assert-True ($hwCross.Status -eq 404) "T-6 : devoir sur une classe d une autre ecole (404)"
    $hwCrossRead = Invoke-Api -Path "/agenda/$hwId" -Token $tokenB
    Assert-True ($hwCrossRead.Status -eq 404) "T-6 : devoir invisible depuis une autre ecole (404)"
    $hwByParent = Invoke-Api -Method POST -Path "/agenda" -Body @{ kind = "homework"; classroomId = $classAtt; title = "Parent"; date = "2026-11-05" } -Token $newParentToken
    Assert-True ($hwByParent.Status -eq 403) "T-6 : parent ne publie pas (403)"
    $teacherListForbidden = Invoke-Api -Path "/agenda?classroomId=$classForbidden" -Token $teacherToken
    Assert-True ($teacherListForbidden.Status -eq 403) "T-6 : enseignant ne lit pas l agenda d une autre classe (403)"

    $famAgenda = Invoke-Api -Path "/family/agenda?from=2026-10-25&to=2026-12-31" -Token $newParentToken
    $famIds = @($famAgenda.Json.items) | ForEach-Object { $_.id }
    Assert-True ($famAgenda.Status -eq 200 -and ($famIds -contains $hwId) -and ($famIds -contains $impId)) "T-6 : parent voit le devoir de la classe et la date d ecole"
    Assert-True (@($famAgenda.Json.events).Count -ge 1) "T-6 : evenements du lot 5 fusionnes sans copie"
    $seedAgenda = Invoke-Api -Path "/family/agenda?from=2026-10-25&to=2026-12-31" -Token $parentToken
    $seedAgendaIds = @($seedAgenda.Json.items) | ForEach-Object { $_.id }
    Assert-True ((-not ($seedAgendaIds -contains $hwId)) -and ($seedAgendaIds -contains $impId)) "T-6 : autre parent ne voit pas le devoir d une autre classe"
    $seedHw = Invoke-Api -Path "/family/agenda/$hwId" -Token $parentToken
    Assert-True ($seedHw.Status -eq 404) "T-6 : detail du devoir d une autre classe (404)"
    $seedHwFile = Invoke-Api -Path "/family/agenda/$hwId/attachments/$hwAtt/file" -Token $parentToken
    Assert-True ($seedHwFile.Status -eq 404) "T-6 : piece jointe d une autre classe (404)"
    $hwFile = Invoke-WebRequest -Uri "$base/family/agenda/$hwId/attachments/$hwAtt/file" -Headers @{ Authorization = "Bearer $newParentToken" } -UseBasicParsing
    Assert-True ($hwFile.StatusCode -eq 200 -and $hwFile.Headers["Content-Type"] -eq "application/pdf" -and $hwFile.Headers["Content-Disposition"] -like "attachment*") "T-6 : parent telecharge la piece jointe du devoir"
    $hwFileCross = Invoke-Api -Path "/agenda/$hwId/attachments/$hwAtt/file" -Token $tokenB
    Assert-True ($hwFileCross.Status -eq 404) "T-6 : piece jointe invisible depuis une autre ecole (404)"

    $hwPatch = Invoke-Api -Method PATCH -Path "/agenda/$hwId" -Body @{ date = "2026-11-06"; description = "Rediger proprement, sur copie double." } -Token $teacherToken
    Assert-True ($hwPatch.Status -eq 200 -and $hwPatch.Json.date -eq "2026-11-06") "T-6 : devoir modifie (echeance)"
    $hwDetail = Invoke-Api -Path "/agenda/$hwId" -Token $tokenA2
    $hwUpd = @($hwDetail.Json.history) | Where-Object { $_.action -eq "agenda.updated" } | Select-Object -First 1
    Assert-True ($hwDetail.Status -eq 200 -and $hwUpd -and $hwUpd.metadata.changes.date.from -eq "2026-11-05" -and $hwUpd.metadata.changes.date.to -eq "2026-11-06") "T-6 : historique de modification (avant / apres)"
    $hwPatchForbidden = Invoke-Api -Method PATCH -Path "/agenda/$impId" -Body @{ title = "Modifie par prof" } -Token $teacherToken
    Assert-True ($hwPatchForbidden.Status -eq 403) "T-6 : enseignant ne modifie pas une date d ecole (403)"
    $hwAdd = Invoke-Upload -Path "/agenda/$hwId/attachments" -Token $teacherToken -Base64 $pngB64 -Name "schema.png" -Mime "image/png"
    Assert-True ($hwAdd.Status -eq 201 -and @($hwAdd.Json.attachments).Count -eq 2) "T-6 : ajout d une piece jointe"
    $hwCancel = Invoke-Api -Method POST -Path "/agenda/$hwId/cancel" -Token $teacherToken
    Assert-True ($hwCancel.Status -eq 200 -and $hwCancel.Json.cancelled -eq $true) "T-6 : devoir annule"
    $hwCancelAgain = Invoke-Api -Method POST -Path "/agenda/$hwId/cancel" -Token $teacherToken
    Assert-True ($hwCancelAgain.Status -eq 409) "T-6 : double annulation (409)"
    $hwAfterCancel = Invoke-Api -Path "/family/agenda/$hwId" -Token $newParentToken
    Assert-True ($hwAfterCancel.Status -eq 404) "T-6 : devoir annule masque au parent"
    $hwNotif = Invoke-Api -Path "/notifications" -Token $newParentToken
    Assert-True (@(@($hwNotif.Json.notifications) | Where-Object { $_.kind -eq "agenda.homework" }).Count -ge 1) "T-6 : notification in-app du devoir"

    # --- Deconnexion ---------------------------------------------------------
Write-Host "=== Lot 7 : tableau de bord direction ===" -ForegroundColor Cyan
$dash = Invoke-Api -Path "/dashboard/summary" -Token $tokenA2
Assert-True ($dash.Status -eq 200) "L7 : direction -> synthese 200"
$stuA = Invoke-Api -Path "/students" -Token $tokenA2
Assert-True ($dash.Json.students.total -eq @($stuA.Json.students).Count) "L7 : nombre d'eleves = liste reelle de l'ecole"
$sumClasses = (@($dash.Json.classes) | Measure-Object -Property students -Sum).Sum
Assert-True ($dash.Json.students.enrolled -eq $sumClasses) "L7 : effectifs par classe coherents avec le total inscrit"
$t = $dash.Json.today
Assert-True ($t.marked -eq ($t.present + $t.absent + $t.late) -and $t.sessions.opened -eq ($t.sessions.open + $t.sessions.closed)) "L7 : appel du jour coherent"
Assert-True (@($dash.Json.activity.days).Count -eq 30 -and $dash.Json.range.days -eq 30) "L7 : indicateurs sur 30 jours par defaut"
Assert-True ($dash.Json.communications.sent -ge 1 -and $dash.Json.communications.recipients -ge $dash.Json.communications.read) "L7 : communications envoyees et lues comptees"
$teacherRow = @($dash.Json.teachers) | Where-Object { $_.messagesSent -ge 1 } | Select-Object -First 1
Assert-True ($null -ne $teacherRow) "L7 : activite enseignant (messages publies) visible"
Assert-True ($dash.Json.unjustified.total -ge 0 -and $dash.Json.pending.justifications -ge 0) "L7 : absences non justifiees et attentes presentes"
$dashTeacher = Invoke-Api -Path "/dashboard/summary" -Token $teacherToken
Assert-True ($dashTeacher.Status -eq 403) "L7 : enseignant -> 403"
$dashParent = Invoke-Api -Path "/dashboard/summary" -Token $parentToken
Assert-True ($dashParent.Status -eq 403) "L7 : parent -> 403"
$dashAnon = Invoke-Api -Path "/dashboard/summary"
Assert-True ($dashAnon.Status -eq 401) "L7 : sans jeton -> 401"
$dashB = Invoke-Api -Path "/dashboard/summary" -Token $tokenB
$stuB = Invoke-Api -Path "/students" -Token $tokenB
Assert-True ($dashB.Status -eq 200 -and $dashB.Json.students.total -eq @($stuB.Json.students).Count -and $dashB.Json.students.total -ne $dash.Json.students.total) "L7 : ecole B ne voit que ses propres chiffres"
$aIds = @($dash.Json.classes) | ForEach-Object { $_.id }
$leak = @($dashB.Json.classes) | Where-Object { $aIds -contains $_.id }
Assert-True ($leak.Count -eq 0) "L7 : aucune classe de A dans le tableau de B"
$badRange = Invoke-Api -Path "/dashboard/summary?from=2026-01-01&to=2026-12-31" -Token $tokenA2
Assert-True ($badRange.Status -eq 400) "L7 : periode > 92 jours refusee"
$inverted = Invoke-Api -Path "/dashboard/summary?from=2026-10-30&to=2026-10-01" -Token $tokenA2
Assert-True ($inverted.Status -eq 400) "L7 : periode inversee refusee"
$badDate = Invoke-Api -Path "/dashboard/summary?from=30/10/2026" -Token $tokenA2
Assert-True ($badDate.Status -eq 400) "L7 : format de date invalide refuse"
$week = Invoke-Api -Path "/dashboard/summary?from=2026-10-24&to=2026-10-30" -Token $tokenA2
Assert-True ($week.Status -eq 200 -and @($week.Json.activity.days).Count -eq 7) "L7 : periode personnalisee (7 jours)"
$empty = Invoke-Api -Path "/dashboard/summary?from=2025-01-01&to=2025-01-31" -Token $tokenA2
Assert-True ($empty.Status -eq 200 -and $empty.Json.activity.hasData -eq $false -and $empty.Json.communications.sent -eq 0 -and $null -eq $empty.Json.communications.readRate) "L7 : periode sans donnees -> zero et taux null (pas de chiffre invente)"
$csv = Invoke-WebRequest -Uri "$base/dashboard/export?report=classes&format=csv" -Headers @{ Authorization = "Bearer $tokenA2" } -UseBasicParsing
$csvBytes = $csv.RawContentStream.ToArray()
Assert-True ($csv.StatusCode -eq 200 -and $csvBytes[0] -eq 0xEF -and $csvBytes[1] -eq 0xBB -and $csv.Headers["Content-Disposition"] -like "*orya-classes-*.csv*") "L7 : export CSV effectifs (UTF-8 BOM, piece jointe)"
$xlsx = Invoke-WebRequest -Uri "$base/dashboard/export?report=activity&format=xlsx" -Headers @{ Authorization = "Bearer $tokenA2" } -UseBasicParsing
$xlsxBytes = $xlsx.RawContentStream.ToArray()
Assert-True ($xlsx.StatusCode -eq 200 -and $xlsxBytes[0] -eq 0x50 -and $xlsxBytes[1] -eq 0x4B) "L7 : export XLSX activite (classeur valide)"
foreach ($rep in @("today", "teachers", "unjustified", "communications")) {
    $r = Invoke-Api -Path "/dashboard/export?report=$rep&format=csv" -Token $tokenA2
    Assert-True ($r.Status -eq 200) "L7 : export $rep disponible"
}
$badRep = Invoke-Api -Path "/dashboard/export?report=passwords&format=csv" -Token $tokenA2
Assert-True ($badRep.Status -eq 400) "L7 : rapport inconnu refuse"
$expTeacher = Invoke-Api -Path "/dashboard/export?report=classes&format=csv" -Token $teacherToken
Assert-True ($expTeacher.Status -eq 403) "L7 : export interdit a l'enseignant"
$escape = node (Join-Path $PSScriptRoot "check-export-escape.cjs")
Assert-True ($escape -eq "OK") "L7 : echappement anti-formule des exports (= + - @)"
$expAudit = Invoke-Api -Path "/audit?limit=100" -Token $tokenA2
$expEntry = @($expAudit.Json.entries) | Where-Object { $_.action -eq "dashboard.exported" } | Select-Object -First 1
Assert-True ($null -ne $expEntry) "L7 : export journalise (audit dashboard.exported)"

Write-Host "=== Lot 8 : preparation Massar ===" -ForegroundColor Cyan
$mc = Invoke-Api -Path "/massar/check" -Token $tokenA2
$stuAll = Invoke-Api -Path "/students" -Token $tokenA2
Assert-True ($mc.Status -eq 200 -and $mc.Json.totals.students -eq @($stuAll.Json.students).Count) "L8 : controle Massar sur tous les eleves de l'ecole"
Assert-True ($mc.Json.disclaimer -like "*compatible pour saisie Massar*" -and $mc.Json.disclaimer -like "*aucune connexion officielle*") "L8 : mention format ORYA compatible, sans connexion officielle"
Assert-True ($mc.Json.byCode.massar_missing -ge 1) "L8 : codes Massar manquants detectes"
$fmt = @(@($mc.Json.anomalies) | Where-Object { $_.code -eq "massar_format" -and $_.massarCode -eq "MAS-001" })
    Assert-True ($fmt.Count -ge 1) "L8 : format de code Massar a verifier (MAS-001)"
Assert-True ($mc.Json.totals.ready -le $mc.Json.totals.students) "L8 : eleves prets <= total"
$s1 = @($stuAll.Json.students)[0]; $s2 = @($stuAll.Json.students)[1]
$p1 = Invoke-Api -Method PATCH -Path "/students/$($s1.id)" -Body @{ massarCode = "J130000777" } -Token $tokenA2
$p2 = Invoke-Api -Method PATCH -Path "/students/$($s2.id)" -Body @{ massarCode = "j130000777" } -Token $tokenA2
Assert-True ($p1.Status -eq 200 -and $p2.Status -eq 200) "L8 : codes saisis (meme code, casse differente)"
$mc2 = Invoke-Api -Path "/massar/check" -Token $tokenA2
$dup = @(@($mc2.Json.anomalies) | Where-Object { $_.code -eq "massar_duplicate" })
Assert-True ($dup.Count -ge 2) "L8 : doublon de code Massar detecte (insensible a la casse)"
$p2b = Invoke-Api -Method PATCH -Path "/students/$($s2.id)" -Body @{ massarCode = "J130000778" } -Token $tokenA2
$mc3 = Invoke-Api -Path "/massar/check" -Token $tokenA2
$dup3 = @(@($mc3.Json.anomalies) | Where-Object { $_.code -eq "massar_duplicate" -and $_.massarCode -like "J13000077*" })
Assert-True ($p2b.Status -eq 200 -and $dup3.Count -eq 0) "L8 : doublon corrige -> anomalie disparue"
$csvPres = "classe;code_eleve;nom;code_massar`n6e A;IMP-001;Eleve Import 1;MAS-999"
$impPres = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "massar-change.csv"; contentBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($csvPres)); schoolYear = "2026-2027" } -Token $tokenA2
$comPres = Invoke-Api -Method POST -Path "/imports/$($impPres.Json.id)/commit" -Token $tokenA2
$imp1 = Invoke-Api -Path "/students?search=IMP-001" -Token $tokenA2
$imp1Row = @($imp1.Json.students) | Where-Object { $_.studentCode -eq "IMP-001" } | Select-Object -First 1
Assert-True ($comPres.Status -eq 200 -and $comPres.Json.massarPreserved -eq 1 -and $imp1Row.massarCode -eq "MAS-001") "L8 : import ne remplace jamais un code Massar existant"
$mcT = Invoke-Api -Path "/massar/check" -Token $teacherToken
Assert-True ($mcT.Status -eq 403) "L8 : enseignant -> 403"
$mcP = Invoke-Api -Path "/massar/check" -Token $parentToken
Assert-True ($mcP.Status -eq 403) "L8 : parent -> 403"
$mcN = Invoke-Api -Path "/massar/check"
Assert-True ($mcN.Status -eq 401) "L8 : sans jeton -> 401"
$mcB = Invoke-Api -Path "/massar/check" -Token $tokenB
$aIdsM = @($stuAll.Json.students) | ForEach-Object { $_.id }
$leakM = @(@($mcB.Json.anomalies) | Where-Object { $aIdsM -contains $_.studentId })
Assert-True ($mcB.Status -eq 200 -and $leakM.Count -eq 0 -and $mcB.Json.totals.students -ne $mc.Json.totals.students) "L8 : ecole B isolee"
$badYear = Invoke-Api -Path "/massar/check?schoolYear=2026" -Token $tokenA2
Assert-True ($badYear.Status -eq 400) "L8 : annee scolaire invalide refusee"
foreach ($rep in @("students", "enrollments", "anomalies")) {
    $r = Invoke-WebRequest -Uri "$base/massar/export?report=$rep&format=csv" -Headers @{ Authorization = "Bearer $tokenA2" } -UseBasicParsing
    $b = $r.RawContentStream.ToArray()
    Assert-True ($r.StatusCode -eq 200 -and $b[0] -eq 0xEF -and $r.Headers["Content-Disposition"] -like "*orya-compatible-massar-$rep-*") "L8 : export CSV $rep"
}
$csvStu = [Text.Encoding]::UTF8.GetString((Invoke-WebRequest -Uri "$base/massar/export?report=students&format=csv" -Headers @{ Authorization = "Bearer $tokenA2" } -UseBasicParsing).RawContentStream.ToArray())
Assert-True ($csvStu -like "*Code Massar;Code*" -and $csvStu -like "*J130000777*") "L8 : colonnes et codes Massar conserves dans l'export"
$noPeriod = Invoke-Api -Path "/massar/export?report=absences&format=csv" -Token $tokenA2
Assert-True ($noPeriod.Status -eq 400) "L8 : export absences sans periode refuse"
$tooLong = Invoke-Api -Path "/massar/export?report=absences&format=csv&from=2025-01-01&to=2026-10-30" -Token $tokenA2
Assert-True ($tooLong.Status -eq 400) "L8 : periode > 366 jours refusee"
$abs = Invoke-WebRequest -Uri "$base/massar/export?report=absences&format=xlsx&from=2026-09-01&to=2026-10-31" -Headers @{ Authorization = "Bearer $tokenA2" } -UseBasicParsing
$absB = $abs.RawContentStream.ToArray()
Assert-True ($abs.StatusCode -eq 200 -and $absB[0] -eq 0x50 -and $absB[1] -eq 0x4B) "L8 : export XLSX absences par periode"
$tot = Invoke-Api -Path "/massar/export?report=absence-totals&format=csv&from=2026-09-01&to=2026-10-31" -Token $tokenA2
Assert-True ($tot.Status -eq 200) "L8 : export totaux d'absences par eleve"
$expT = Invoke-Api -Path "/massar/export?report=students&format=csv" -Token $teacherToken
Assert-True ($expT.Status -eq 403) "L8 : export interdit a l'enseignant"
$hist = Invoke-Api -Path "/massar/exports" -Token $tokenA2
$h0 = @($hist.Json.exports) | Select-Object -First 1
Assert-True ($hist.Status -eq 200 -and @($hist.Json.exports).Count -ge 6 -and $h0.sha256.Length -eq 64 -and $h0.columnsVersion -like "orya-massar-*") "L8 : historique des exports enregistre (empreinte, version des colonnes)"
$histB = Invoke-Api -Path "/massar/exports" -Token $tokenB
Assert-True ($histB.Status -eq 200 -and @($histB.Json.exports).Count -eq 0) "L8 : historique de A invisible pour B"
$auditM = Invoke-Api -Path "/audit?limit=100" -Token $tokenA2
$auditMEntry = @($auditM.Json.entries) | Where-Object { $_.action -eq "massar.exported" } | Select-Object -First 1
Assert-True ($null -ne $auditMEntry) "L8 : export trace dans l'AuditLog"
$pf = Invoke-Api -Method PATCH -Path "/students/$($s1.id)" -Body @{ displayName = "=HYPERLINK(""http://x"")" } -Token $tokenA2
$csvF = [Text.Encoding]::UTF8.GetString((Invoke-WebRequest -Uri "$base/massar/export?report=students&format=csv" -Headers @{ Authorization = "Bearer $tokenA2" } -UseBasicParsing).RawContentStream.ToArray())
Assert-True (($pf.Status -ne 200) -or ($csvF -like "*'=HYPERLINK*" -and $csvF -notmatch "(^|;)=HYPERLINK")) "L8 : nom piege neutralise dans l'export (anti-formule)"
$restore = Invoke-Api -Method PATCH -Path "/students/$($s1.id)" -Body @{ displayName = $s1.displayName; massarCode = $(if ($s1.massarCode) { $s1.massarCode } else { "" }) } -Token $tokenA2
$restore2 = Invoke-Api -Method PATCH -Path "/students/$($s2.id)" -Body @{ massarCode = $(if ($s2.massarCode) { $s2.massarCode } else { "" }) } -Token $tokenA2
Assert-True ($restore.Status -eq 200 -and $restore2.Status -eq 200) "L8 : donnees de test restaurees"

Write-Host "=== Lot 9 : abonnements et administration SaaS ===" -ForegroundColor Cyan
$ov = Invoke-Api -Path "/admin/overview" -Token $superToken
Assert-True ($ov.Status -eq 200 -and $ov.Json.totals.schools -ge 3) "L9 : super-admin -> tableau de bord plateforme"
$meA9 = Invoke-Api -Path "/me" -Token $tokenA2
$meB9 = Invoke-Api -Path "/me" -Token $tokenB
$nameA = (@($meA9.Json.profiles) | Where-Object { $_.id -eq $meA9.Json.activeProfileId } | Select-Object -First 1).schoolName
$nameB = (@($meB9.Json.profiles) | Where-Object { $_.id -eq $meB9.Json.activeProfileId } | Select-Object -First 1).schoolName
$rowA = @($ov.Json.schools) | Where-Object { $_.name -eq $nameA } | Select-Object -First 1
$rowB = @($ov.Json.schools) | Where-Object { $_.name -eq $nameB } | Select-Object -First 1
$stuA9 = Invoke-Api -Path "/students" -Token $tokenA2
Assert-True ($null -ne $rowA -and $null -ne $rowB -and $rowA.usage.students -eq @($stuA9.Json.students).Count) "L9 : usage reel par ecole (eleves = base)"
Assert-True ($rowA.usage.staff -ge 1 -and $null -ne $rowA.usage.lastActivityAt) "L9 : comptes personnel et derniere activite"
Assert-True ($ov.Json.billingProvider.configured -eq $false -and $ov.Json.billingProvider.label -like "Non configur*") "L9 : fournisseur de paiement non configure"
foreach ($p in @("/admin/overview", "/admin/plans", "/admin/schools/$($rowB.id)", "/admin/billing/provider")) {
    $d = Invoke-Api -Path $p -Token $tokenA2
    Assert-True ($d.Status -eq 403) "L9 : direction -> 403 sur $p"
}
$dPatch = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowA.id)/subscription" -Body @{ status = "active" } -Token $tokenA2
Assert-True ($dPatch.Status -eq 403) "L9 : direction ne peut pas modifier son abonnement"
$tOv = Invoke-Api -Path "/admin/overview" -Token $teacherToken
$pOv = Invoke-Api -Path "/admin/overview" -Token $parentToken
$nOv = Invoke-Api -Path "/admin/overview"
Assert-True ($tOv.Status -eq 403 -and $pOv.Status -eq 403 -and $nOv.Status -eq 401) "L9 : enseignant/parent 403, sans jeton 401"
$plans = Invoke-Api -Path "/admin/plans" -Token $superToken
$ph = @(@($plans.Json.plans) | Where-Object { $_.code -like "plan-a-definir-*" })
Assert-True ($ph.Count -eq 3 -and @($ph | Where-Object { $null -ne $_.priceMinor -or $null -ne $_.maxStudents }).Count -eq 0) "L9 : plans placeholders, prix et limites a definir (null)"
$planCode = "test-limite-" + (Get-Random -Maximum 99999)
$newPlan = Invoke-Api -Method POST -Path "/admin/plans" -Body @{ code = $planCode; name = "Plan test limites"; maxStudents = $rowA.usage.students; maxStaff = $rowA.usage.staff } -Token $superToken
Assert-True ($newPlan.Status -eq 201 -and $newPlan.Json.toBeDefined -eq $true) "L9 : creation d'un plan configurable"
$dupPlan = Invoke-Api -Method POST -Path "/admin/plans" -Body @{ code = $planCode; name = "Doublon" } -Token $superToken
Assert-True ($dupPlan.Status -eq 409) "L9 : code de plan unique"
$assign = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowA.id)/subscription" -Body @{ planId = $newPlan.Json.id } -Token $superToken
Assert-True ($assign.Status -eq 200 -and $assign.Json.planRef.code -eq $planCode) "L9 : plan attribue a l'ecole A"
$csvLim = "classe;code_eleve;nom`n6e A;LIM-001;Eleve Limite"
$impLim = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "limite.csv"; contentBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($csvLim)); schoolYear = "2026-2027" } -Token $tokenA2
$comLim = Invoke-Api -Method POST -Path "/imports/$($impLim.Json.id)/commit" -Token $tokenA2
Assert-True ($comLim.Status -eq 402 -and $comLim.Json.code -eq "PLAN_LIMIT_REACHED") "L9 : limite d'eleves -> 402 PLAN_LIMIT_REACHED"
$invLim = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "teacher"; email = "limite$(Get-Random)@ecole-a.test" } -Token $tokenA2
Assert-True ($invLim.Status -eq 402 -and $invLim.Json.code -eq "PLAN_LIMIT_REACHED") "L9 : limite de comptes personnel -> 402"
$relax = Invoke-Api -Method PATCH -Path "/admin/plans/$($newPlan.Json.id)" -Body @{ maxStudents = $null; maxStaff = $null } -Token $superToken
$impLim2 = Invoke-Api -Method POST -Path "/imports" -Body @{ filename = "limite.csv"; contentBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($csvLim)); schoolYear = "2026-2027" } -Token $tokenA2
$comLim2 = Invoke-Api -Method POST -Path "/imports/$($impLim2.Json.id)/commit" -Token $tokenA2
Assert-True ($relax.Status -eq 200 -and $comLim2.Status -eq 200) "L9 : limite levee (null) -> import accepte"
$trialB = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowB.id)/subscription" -Body @{ status = "trial"; trialEndsAt = "2026-01-01" } -Token $superToken
$wTrial = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "teacher"; email = "trial$(Get-Random)@ecole-b.test" } -Token $tokenB
Assert-True ($trialB.Status -eq 200 -and $wTrial.Status -eq 402 -and $wTrial.Json.code -eq "TRIAL_EXPIRED") "L9 : essai termine -> ecriture 402 TRIAL_EXPIRED"
$noReason = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowB.id)/subscription" -Body @{ status = "suspended" } -Token $superToken
Assert-True ($noReason.Status -eq 400) "L9 : suspension sans motif refusee"
$susp = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowB.id)/subscription" -Body @{ status = "suspended"; reason = "Test de suspension" } -Token $superToken
$wSusp = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "teacher"; email = "susp$(Get-Random)@ecole-b.test" } -Token $tokenB
$rSusp = Invoke-Api -Path "/students" -Token $tokenB
Assert-True ($susp.Status -eq 200 -and $wSusp.Status -eq 403 -and $wSusp.Json.code -eq "SUBSCRIPTION_INACTIVE" -and $rSusp.Status -eq 200) "L9 : suspendu -> lecture seule (403 en ecriture, lecture 200)"
$wA = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "teacher"; email = "okA$(Get-Random)@ecole-a.test" } -Token $tokenA2
Assert-True ($wA.Status -eq 201) "L9 : suspension de B sans effet sur A"
$badTr = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowB.id)/subscription" -Body @{ status = "past_due" } -Token $superToken
Assert-True ($badTr.Status -eq 409) "L9 : transition interdite (suspended -> past_due)"
$react = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowB.id)/subscription" -Body @{ status = "active" } -Token $superToken
$wReact = Invoke-Api -Method POST -Path "/invitations" -Body @{ role = "teacher"; email = "react$(Get-Random)@ecole-b.test" } -Token $tokenB
Assert-True ($react.Status -eq 200 -and $wReact.Status -eq 201) "L9 : reactivation -> ecriture retablie"
$badStatus = Invoke-Api -Method PATCH -Path "/admin/schools/$($rowB.id)/subscription" -Body @{ status = "gratuit" } -Token $superToken
Assert-True ($badStatus.Status -eq 400) "L9 : statut inconnu refuse"
$snap = Invoke-Api -Method POST -Path "/admin/schools/$($rowA.id)/usage-snapshots" -Token $superToken
Assert-True ($snap.Status -eq 201 -and $snap.Json.metrics.students -ge 1) "L9 : instantane d'usage enregistre"
$inv = Invoke-Api -Method POST -Path "/admin/schools/$($rowA.id)/invoices" -Body @{ periodStart = "2026-10-01"; periodEnd = "2026-10-31" } -Token $superToken
Assert-True ($inv.Status -eq 201 -and $inv.Json.status -eq "draft" -and $null -eq $inv.Json.amountMinor -and $inv.Json.provider -eq "none") "L9 : brouillon de facture sans montant invente (prix a definir)"
$badInv = Invoke-Api -Method POST -Path "/admin/schools/$($rowA.id)/invoices" -Body @{ periodStart = "2026-10-31"; periodEnd = "2026-10-01" } -Token $superToken
Assert-True ($badInv.Status -eq 400) "L9 : periode de facture invalide refusee"
$col = Invoke-Api -Method POST -Path "/admin/invoices/$($inv.Json.id)/collect" -Token $superToken
Assert-True ($col.Status -eq 503 -and $col.Json.code -eq "BILLING_PROVIDER_NOT_CONFIGURED") "L9 : encaissement impossible (fournisseur non configure)"
$billA = Invoke-Api -Path "/billing" -Token $tokenA2
$billB = Invoke-Api -Path "/billing" -Token $tokenB
$invIdsB = @($billB.Json.invoices) | ForEach-Object { $_.id }
Assert-True ($billA.Status -eq 200 -and @(@($billA.Json.invoices) | Where-Object { $_.id -eq $inv.Json.id }).Count -eq 1 -and $billA.Json.subscription.planRef.code -eq $planCode) "L9 : direction voit son abonnement et ses factures"
Assert-True ($billB.Status -eq 200 -and -not ($invIdsB -contains $inv.Json.id)) "L9 : factures de A invisibles pour B"
$billT = Invoke-Api -Path "/billing" -Token $teacherToken
Assert-True ($billT.Status -eq 403) "L9 : enseignant -> 403 sur /billing"
$det = Invoke-Api -Path "/admin/schools/$($rowA.id)" -Token $superToken
$det404 = Invoke-Api -Path "/admin/schools/00000000-0000-0000-0000-000000000000" -Token $superToken
Assert-True ($det.Status -eq 200 -and @($det.Json.snapshots).Count -ge 1 -and $det404.Status -eq 404) "L9 : fiche ecole super-admin (usage, instantanes), 404 si inconnue"
$auditS = Invoke-Api -Path "/audit?limit=100" -Token $superToken
$acts = @($auditS.Json.entries) | ForEach-Object { $_.action }
Assert-True ($auditS.Status -eq 200 -and ($acts -contains "subscription.updated") -and ($acts -contains "school.inspected") -and ($acts -contains "platform.overview.viewed")) "L9 : acces inter-ecoles et changements journalises"
$auditA9 = Invoke-Api -Path "/audit?limit=100" -Token $tokenA2
$leakAudit = @($auditA9.Json.entries) | Where-Object { $_.action -eq "platform.overview.viewed" }
Assert-True (@($leakAudit).Count -eq 0) "L9 : journal plateforme invisible pour la direction"

Write-Host "=== Lot 10 : session web en cookies httpOnly + CSRF ===" -ForegroundColor Cyan
$ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$cookieLogin = Invoke-WebRequest -Method POST -Uri "$base/auth/login" -WebSession $ws -Headers @{ "X-Orya-Client" = "web" } -ContentType "application/json" -Body (@{ email = "professeur@ecole-a.orya.test"; password = $env:SEED_PASSWORD; platform = "web" } | ConvertTo-Json) -UseBasicParsing
$cl = $cookieLogin.Content | ConvertFrom-Json
$setCookie = ($cookieLogin.Headers["Set-Cookie"]) -join " | "
Assert-True ($cookieLogin.StatusCode -eq 200 -and $cl.csrfToken -and $null -eq $cl.accessToken -and $null -eq $cl.refreshToken) "L10-C : client web -> aucun jeton dans le corps, jeton CSRF fourni"
Assert-True ($setCookie -like "*orya_at=*HttpOnly*" -and $setCookie -like "*orya_rt=*Path=/api/v1/auth*" -and $setCookie -like "*SameSite=Strict*") "L10-C : cookies httpOnly SameSite=Strict poses"
$meCookie = Invoke-WebRequest -Uri "$base/me" -WebSession $ws -UseBasicParsing
Assert-True ($meCookie.StatusCode -eq 200) "L10-C : lecture authentifiee par cookie"
function Invoke-Cookie { param([string]$Method, [string]$Path, [hashtable]$Headers)
    try { if ($Method -eq "GET") { $r = Invoke-WebRequest -Uri "$base$Path" -WebSession $ws -Headers $Headers -UseBasicParsing } else { $r = Invoke-WebRequest -Method $Method -Uri "$base$Path" -WebSession $ws -Headers $Headers -ContentType "application/json" -Body "{}" -UseBasicParsing }; return [int]$r.StatusCode }
    catch { return [int]$_.Exception.Response.StatusCode } }
$noCsrf = Invoke-Cookie -Method POST -Path "/auth/logout" -Headers @{ "X-Orya-Client" = "web" }
Assert-True ($noCsrf -eq 403) "L10-C : ecriture par cookie sans jeton CSRF -> 403"
$badCsrf = Invoke-Cookie -Method POST -Path "/auth/logout" -Headers @{ "X-Orya-Client" = "web"; "X-CSRF-Token" = ("x" * 43) }
Assert-True ($badCsrf -eq 403) "L10-C : jeton CSRF errone -> 403"
$refNoCsrf = Invoke-Cookie -Method POST -Path "/auth/refresh" -Headers @{ "X-Orya-Client" = "web" }
Assert-True ($refNoCsrf -eq 403) "L10-C : rafraichissement par cookie sans CSRF -> 403"
$ref = Invoke-WebRequest -Method POST -Uri "$base/auth/refresh" -WebSession $ws -Headers @{ "X-Orya-Client" = "web"; "X-CSRF-Token" = $cl.csrfToken } -ContentType "application/json" -Body "{}" -UseBasicParsing
$rj = $ref.Content | ConvertFrom-Json
Assert-True ($ref.StatusCode -eq 200 -and $rj.csrfToken -and $null -eq $rj.accessToken -and $rj.csrfToken -ne $cl.csrfToken) "L10-C : rafraichissement par cookie (rotation, nouveau CSRF)"
# B07 : reprise du jeton CSRF d'une session cookie active (nouvel onglet), sans rotation ni jeton de session.
$csrfGet = Invoke-WebRequest -Uri "$base/auth/csrf" -WebSession $ws -Headers @{ "X-Orya-Client" = "web" } -UseBasicParsing
$cg = $csrfGet.Content | ConvertFrom-Json
Assert-True ($csrfGet.StatusCode -eq 200 -and $cg.csrfToken -eq $rj.csrfToken -and $null -eq $cg.accessToken -and $null -eq $cg.refreshToken -and (($csrfGet.Headers["Set-Cookie"]) -join "") -notmatch "orya_at|orya_rt") "B07 : GET /auth/csrf rend le jeton CSRF de la session cookie, sans rotation ni jeton de session"
Assert-True (($csrfGet.Headers["Cache-Control"]) -match "no-store") "B07 : GET /auth/csrf non mis en cache (no-store)"
$wsAnon = New-Object Microsoft.PowerShell.Commands.WebRequestSession
try { $anon = [int](Invoke-WebRequest -Uri "$base/auth/csrf" -WebSession $wsAnon -Headers @{ "X-Orya-Client" = "web" } -UseBasicParsing).StatusCode } catch { $anon = [int]$_.Exception.Response.StatusCode }
Assert-True ($anon -eq 401) "B07 : GET /auth/csrf sans session cookie -> 401"
try { $bearerCsrf = [int](Invoke-WebRequest -Uri "$base/auth/csrf" -Headers @{ "X-Orya-Client" = "web"; Authorization = "Bearer $tokenA2" } -UseBasicParsing).StatusCode } catch { $bearerCsrf = [int]$_.Exception.Response.StatusCode }
Assert-True ($bearerCsrf -eq 401) "B07 : GET /auth/csrf avec un jeton Bearer seul (pas de session cookie) -> 401"
$oldAt = ($ws.Cookies.GetCookies([Uri]"$base/me") | Where-Object { $_.Name -eq "orya_at" }).Value
$oldRt = ($ws.Cookies.GetCookies([Uri]"$base/auth/refresh") | Where-Object { $_.Name -eq "orya_rt" }).Value
Assert-True ([bool]$oldAt -and [bool]$oldRt) "L10-S : jetons de la session cookie captures pour le test de rejeu"
$okLogout = Invoke-Cookie -Method POST -Path "/auth/logout" -Headers @{ "X-Orya-Client" = "web"; "X-CSRF-Token" = $rj.csrfToken }
Assert-True ($okLogout -eq 200) "L10-C : deconnexion avec CSRF valide"
$after = Invoke-Cookie -Method GET -Path "/me" -Headers @{}
$csrfAfter = Invoke-Cookie -Method GET -Path "/auth/csrf" -Headers @{ "X-Orya-Client" = "web" }
Assert-True ($csrfAfter -eq 401) "B07 : GET /auth/csrf apres deconnexion -> 401"
Assert-True ($after -eq 401) "L10-C : cookies effaces apres deconnexion -> 401"
$bearerStill = Invoke-Api -Path "/me" -Token $tokenA2
Assert-True ($bearerStill.Status -eq 200) "L10-C : clients Bearer (API, mobile) inchanges"
$replayAt = Invoke-Api -Path "/me" -Token $oldAt
Assert-True ($replayAt.Status -eq 401) "L10-S : jeton d'acces rejoue apres deconnexion -> 401 (revocation serveur)"
$replayRt = Invoke-Api -Method POST -Path "/auth/refresh" -Body @{ refreshToken = $oldRt }
Assert-True ($replayRt.Status -eq 401) "L10-S : jeton de rafraichissement rejoue apres deconnexion -> 401"
Assert-True ($bearerStill.Status -eq 200) "L10-S : la deconnexion ne ferme que la session courante (autre appareil toujours valide)"

    $logout = Invoke-Api -Method POST -Path "/auth/logout" -Token $tokenA2
    Assert-True ($logout.Status -eq 200) "T-session : deconnexion acceptee"
    $afterAccess = Invoke-Api -Path "/me" -Token $tokenA2
    Assert-True ($afterAccess.Status -eq 401) "L10-S : jeton d'acces Bearer refuse immediatement apres deconnexion"
    $afterLogout = Invoke-Api -Method POST -Path "/auth/refresh" -Body @{ refreshToken = $verifyA2.Json.refreshToken }
    Assert-True ($afterLogout.Status -eq 401) "T-session : refresh impossible apres deconnexion"

    # --- Verrouillage progressif ---------------------------------------------
    $locked = $false
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $bad = Invoke-Api -Method POST -Path "/auth/login" -Body @{ email = "parent2@ecole-a.orya.test"; password = "MauvaisMotDePasse!$attempt" }
        if ($bad.Status -eq 429) { $locked = $true; break }
    }
    Assert-True $locked "T10b : verrouillage progressif apres echecs repetes (429)"
    # --- P0-4 : trust proxy et limite de debit (seconde instance, limites basses) ---
    $p4Port = $Port + 50
    $p4Base = "http://127.0.0.1:$p4Port/api/v1"
    $p4Saved = @{ API_PORT = $env:API_PORT; API_RATE_LIMIT = $env:API_RATE_LIMIT; AUTH_LOGIN_LIMIT = $env:AUTH_LOGIN_LIMIT; TRUST_PROXY_HOPS = $env:TRUST_PROXY_HOPS }
    $env:API_PORT = "$p4Port"; $env:API_RATE_LIMIT = "20"; $env:AUTH_LOGIN_LIMIT = "3"; $env:TRUST_PROXY_HOPS = "1"
    $p4Params = $startParams.Clone()
    $p4Params["RedirectStandardOutput"] = Join-Path $tempRoot "orya-api-p04-out.log"
    $p4Params["RedirectStandardError"] = Join-Path $tempRoot "orya-api-p04-err.log"
    $p4 = Start-Process @p4Params
    foreach ($k in @($p4Saved.Keys)) { if ($null -eq $p4Saved[$k]) { Remove-Item "Env:$k" -ErrorAction SilentlyContinue } else { Set-Item "Env:$k" $p4Saved[$k] } }
    try {
        $p4Ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 1
            try { if ([int](Invoke-WebRequest "$p4Base/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $p4Ready = $true; break } } catch { }
        }
        Assert-True $p4Ready "P0-4 : instance a limites basses demarree (API_RATE_LIMIT=20, TRUST_PROXY_HOPS=1)"
        $h429 = 0; $hOk = 0
        for ($i = 0; $i -lt 500; $i++) {
            try { $r = Invoke-WebRequest "$p4Base/health" -UseBasicParsing -TimeoutSec 5; if ([int]$r.StatusCode -eq 200) { $hOk++ } }
            catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 429) { $h429++ } }
        }
        Assert-True ($h429 -eq 0 -and $hOk -eq 500) "P0-4 : 500 appels /health -> 500 x 200, 0 x 429 (health hors limite de debit)"
        $g429 = 0
        for ($i = 0; $i -lt 25; $i++) {
            try { Invoke-WebRequest "$p4Base/me" -UseBasicParsing -TimeoutSec 5 | Out-Null }
            catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 429) { $g429++ } }
        }
        Assert-True ($g429 -gt 0) "P0-4 : la limite globale s'applique toujours aux autres routes (429 sur /me)"
        function Send-P4Login([string]$ClientIp) {
            try {
                Invoke-WebRequest -Method POST -Uri "$p4Base/auth/login" -Headers @{ "X-Forwarded-For" = $ClientIp } -ContentType "application/json" -Body '{"email":"inconnu-p04@orya.test","password":"MauvaisMotDePasse!1"}' -UseBasicParsing -TimeoutSec 10 | Out-Null
                return 200
            }
            catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
        }
        $codesA = @(1..4 | ForEach-Object { Send-P4Login "203.0.113.10" })
        Assert-True ($codesA[0] -eq 401 -and $codesA[3] -eq 429) "P0-4 : connexion limitee par IP client reelle (X-Forwarded-For 203.0.113.10 : 401 puis 429)"
        $codeB = Send-P4Login "203.0.113.11"
        Assert-True ($codeB -eq 401) "P0-4 : autre IP client derriere le meme proxy non bloquee (401, pas 429)"
    }
    finally {
        if ($p4 -and -not $p4.HasExited) { Stop-Process -Id $p4.Id -Force -ErrorAction SilentlyContinue }
    }
}
finally {
    Write-Host "=== 6. Arret de l'API ===" -ForegroundColor Cyan
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    # Remise a zero du verrouillage pour laisser la base de test utilisable.
    & docker exec $Container psql -U $DbUser -d $db -q -f /tmp/reset-lock.sql 2>$null | Out-Null
}

Write-Host ""
Write-Host ("Resultat : {0} succes, {1} echec(s)." -f $script:passes, $script:failures)
if ($script:failures -gt 0) {
    Write-Host "--- journal API (extrait) ---" -ForegroundColor Yellow
    Get-Content $logErr -ErrorAction SilentlyContinue | Select-Object -Last 15
    exit 1
}

Write-Host "=== TOUS LES TESTS D'API SONT PASSES ===" -ForegroundColor Green
}
finally {
    # Restaure la valeur d'avant le run (ou supprime la variable si elle etait absente).
    if ($null -eq $__oryaSeedPrev) { Remove-Item Env:SEED_PASSWORD -ErrorAction SilentlyContinue } else { $env:SEED_PASSWORD = $__oryaSeedPrev }
    Remove-Variable __oryaSeedPrev -ErrorAction SilentlyContinue
}
