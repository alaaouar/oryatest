# =============================================================================
# ORYA - Lot 10 : tests E2E navigateur (Playwright) sur une pile locale JETABLE.
#   Base orya_e2e (recreee a chaque run), API :3013, web :3100.
#   Cible orya-test-pg (scripts/test-pg-up.ps1) ; garde scripts/test-guard.ps1. Requiert $env:SEED_PASSWORD et Docker.
#   Usage : cd e2e ; npm install ; npx playwright install chromium ; npm run e2e
# =============================================================================
param(
    [int]$ApiPort = 3013,
    [int]$WebPort = 3100
)
. (Join-Path $PSScriptRoot "../scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_e2e"
$Container = $T.Container; $DbUser = $T.DbUser; $DbPassword = $T.DbPassword; $PgPort = $T.Port
$__oryaSeedPrev = $env:SEED_PASSWORD   # sauvegarde interne (jamais affichee ni ecrite), restauree dans le finally final
# P0-2 : SEED_PASSWORD jetable, genere pour CE run uniquement (conteneur orya-test-pg deja verifie par la garde).
# Toute valeur existante est ecrasee sans etre lue ; jamais affiche, journalise ni ecrit sur disque.
# Lancer avec 'powershell -File' : la variable reste dans ce processus et ses enfants (seed, API).
$seedBytes = New-Object byte[] 20
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($seedBytes)
$env:SEED_PASSWORD = "Ot-" + (-join ($seedBytes | ForEach-Object { $_.ToString("x2") })) + "-A9!"
Remove-Variable seedBytes
try {

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api = Join-Path $root "apps/api"
$web = Join-Path $root "apps/web"
$db = $T.Db
$db = Assert-OryaTestDbName $db
if (-not $env:SEED_PASSWORD -or $env:SEED_PASSWORD.Length -lt 12) { throw "SEED_PASSWORD est requis (12 caracteres minimum)." }
$tempRoot = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }

Write-Host "=== 1. Base jetable $db ===" -ForegroundColor Cyan
& docker exec $Container psql -U $DbUser -d postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE);" | Out-Null
& docker exec $Container psql -U $DbUser -d postgres -q -c "CREATE DATABASE $db;" | Out-Null
$dirs = Get-ChildItem (Join-Path $api "prisma/migrations") -Directory | Sort-Object Name
$migration = Join-Path $tempRoot "orya_e2e_migration.sql"
[IO.File]::WriteAllText($migration, (($dirs | ForEach-Object { [IO.File]::ReadAllText((Join-Path $_.FullName "migration.sql")) }) -join "`n"), [Text.UTF8Encoding]::new($false))
$files = @($migration, (Join-Path $api "prisma/sql/010_rls.sql"), (Join-Path $api "test/api/grant-test-role.sql"), (Join-Path $api "test/api/seed-attendance.sql"), (Join-Path $PSScriptRoot "seed-e2e.sql"))
foreach ($file in $files) { & docker cp $file "${Container}:/tmp/e2e_$(Split-Path $file -Leaf)"; if ($LASTEXITCODE -ne 0) { throw "docker cp $file" } }
foreach ($name in @("orya_e2e_migration.sql", "010_rls.sql")) {
    & docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -f "/tmp/e2e_$name" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Echec $name" }
}
$appPassword = (& node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))").Trim()
# P0-2 : role propre a la base de test (cree a neuf dans le conteneur jetable, jamais d'ALTER ROLE).
$testRole = "orya_t_$db"
& docker exec $Container psql -U $DbUser -d postgres -v ON_ERROR_STOP=1 -q -c "DROP ROLE IF EXISTS $testRole; CREATE ROLE $testRole LOGIN NOBYPASSRLS PASSWORD '$appPassword';" | Out-Null
& docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -v test_role=$testRole -f /tmp/e2e_grant-test-role.sql | Out-Null

Write-Host "=== 2. Seed ===" -ForegroundColor Cyan
$env:DIRECT_DATABASE_URL = "postgresql://${DbUser}:${DbPassword}@127.0.0.1:${PgPort}/${db}?schema=public"
$env:DATABASE_URL = "postgresql://${testRole}:${appPassword}@127.0.0.1:${PgPort}/${db}?schema=public"
$env:NODE_ENV = "development"
Push-Location $api
try { & npx tsx prisma/seed.ts | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Seed en echec" } } finally { Pop-Location }
& docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -f /tmp/e2e_seed-attendance.sql | Out-Null
& docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -q -f /tmp/e2e_seed-e2e.sql | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Fixture E2E en echec" }
$env:OTHER_SCHOOL_STUDENT_ID = ("" + ('SELECT s.id FROM "Student" s JOIN "School" sc ON sc.id = s."schoolId" WHERE sc.name NOT LIKE ''%Al Nour%'' LIMIT 1;' | & docker exec -i $Container psql -U $DbUser -d $db -tA)).Trim()
$env:E2E_API_URL = "http://127.0.0.1:$ApiPort/api/v1"
Write-Host "Eleve autre ecole : $($env:OTHER_SCHOOL_STUDENT_ID)"

Write-Host "=== 3. Build web (API :$ApiPort) ===" -ForegroundColor Cyan
$env:NEXT_PUBLIC_API_BASE = "http://127.0.0.1:$ApiPort/api/v1"
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:NODE_ENV = "production"
Push-Location $web
try { & npx next build | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Build web en echec" } } finally { Pop-Location }

Write-Host "=== 4. Demarrage API et web ===" -ForegroundColor Cyan
$env:NODE_ENV = "development"
$env:API_PORT = "$ApiPort"
$env:CORS_ORIGINS = "http://127.0.0.1:$WebPort,http://localhost:$WebPort"
$env:WEB_ORIGIN = "http://127.0.0.1:$WebPort"
$env:AUTH_LOGIN_LIMIT = "200"
$env:API_RATE_LIMIT = "5000"
$env:UPLOAD_RATE_LIMIT = "200"
$env:STORAGE_LOCAL_DIR = Join-Path $tempRoot "orya-e2e-private-storage"
$env:JWT_ACCESS_SECRET = (& node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))").Trim()
$env:MFA_ENCRYPTION_KEY = (& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))").Trim()
$common = @{ PassThru = $true; WindowStyle = "Hidden" }
$apiProc = Start-Process node -ArgumentList "dist/main.js" -WorkingDirectory $api -RedirectStandardOutput (Join-Path $tempRoot "orya-e2e-api.log") -RedirectStandardError (Join-Path $tempRoot "orya-e2e-api.err") @common
$webProc = Start-Process node -ArgumentList "node_modules/next/dist/bin/next", "start", "-p", "$WebPort", "-H", "127.0.0.1" -WorkingDirectory $web -RedirectStandardOutput (Join-Path $tempRoot "orya-e2e-web.log") -RedirectStandardError (Join-Path $tempRoot "orya-e2e-web.err") @common
$code = 1
try {
    foreach ($url in @("http://127.0.0.1:$ApiPort/api/v1/health", "http://127.0.0.1:$WebPort/login")) {
        $ok = $false
        for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 1; try { if ((Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { } }
        if (-not $ok) { throw "Service indisponible : $url" }
    }
    Write-Host "=== 5. Playwright (navigateur reel) ===" -ForegroundColor Cyan
    $env:E2E_WEB_URL = "http://127.0.0.1:$WebPort"
    Push-Location $PSScriptRoot
    try { & npx playwright test -c playwright.preprod.config.ts; $code = $LASTEXITCODE } finally { Pop-Location }
}
finally {
    foreach ($p in @($webProc, $apiProc)) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
if ($code -ne 0) { Write-Host "=== ECHEC E2E ===" -ForegroundColor Red; exit $code }
Write-Host "=== TOUS LES TESTS E2E SONT PASSES ===" -ForegroundColor Green
}
finally {
    # Restaure la valeur d'avant le run (ou supprime la variable si elle etait absente).
    if ($null -eq $__oryaSeedPrev) { Remove-Item Env:SEED_PASSWORD -ErrorAction SilentlyContinue } else { $env:SEED_PASSWORD = $__oryaSeedPrev }
    Remove-Variable __oryaSeedPrev -ErrorAction SilentlyContinue
}
