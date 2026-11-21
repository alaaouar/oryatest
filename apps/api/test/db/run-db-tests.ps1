# =============================================================================
# ORYA - rejoue la verification du Lot 1 sur deux bases jetables.
#
#   cd apps\api
#   (SEED_PASSWORD est genere automatiquement pour chaque run ; inutile de le definir)
#   powershell -ExecutionPolicy Bypass -File .\test\db\run-db-tests.ps1
#
# Cible : conteneur jetable orya-test-pg (scripts/test-pg-up.ps1) ; ORYA_TEST_DB = base RLS,
# <ORYA_TEST_DB>_seed = base seed. Refus de orya, orya_v2, orya-postgres et du port 5432.
# Fichier en UTF-8 avec BOM : indispensable pour Windows PowerShell 5.1.
# =============================================================================
param()
. (Join-Path $PSScriptRoot "../../../../scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_lot1_rls"
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
$rlsDb = $T.Db
$seedDb = Assert-OryaTestDbName "$($T.Db)_seed"
Write-Host "TARGET host=$($T.Host) port=$PgPort db=$seedDb"

$ErrorActionPreference = "Stop"

$here = $PSScriptRoot
$api = Resolve-Path (Join-Path $here "../..")
$sqlDir = Join-Path $api "prisma/sql"
# Dossier temporaire portable : Windows utilise %TEMP%, Linux /tmp.
$tempRoot = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }
$migrationDirs = Get-ChildItem (Join-Path $api "prisma/migrations") -Directory | Sort-Object Name
if (-not $migrationDirs) {
    throw "Aucune migration trouvee dans prisma\migrations."
}

$migrationDir = Join-Path $tempRoot "orya_migrations_$PID"
New-Item -ItemType Directory -Force -Path $migrationDir | Out-Null
$migrationFile = Join-Path $migrationDir "migration.sql"
$combinedSql = ($migrationDirs | ForEach-Object { [IO.File]::ReadAllText((Join-Path $_.FullName "migration.sql")) }) -join "`n"
[IO.File]::WriteAllText($migrationFile, $combinedSql, [Text.UTF8Encoding]::new($false))

function Invoke-Psql {
    param([string]$Database, [string]$File, [switch]$Quiet)

    $psqlArgs = @("exec", $Container, "psql", "-U", $DbUser, "-d", $Database, "-v", "ON_ERROR_STOP=1")
    if ($Quiet) { $psqlArgs += "-q" }
    $psqlArgs += @("-f", $File)

    & docker @psqlArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Echec psql sur $Database ($File) - code $LASTEXITCODE."
    }
}

function Reset-Database {
    param([string]$Name)

    & docker exec $Container psql -U $DbUser -d postgres -q -c "DROP DATABASE IF EXISTS $Name WITH (FORCE);" | Out-Null
    & docker exec $Container psql -U $DbUser -d postgres -q -c "CREATE DATABASE $Name;" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Impossible de recreer la base $Name."
    }
}

Write-Host "=== 0. Conteneur ===" -ForegroundColor Cyan
$running = & docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($running -ne "true") {
    throw "Le conteneur $Container n'est pas demarre. Lancez : scripts/test-pg-up.ps1"
}

Write-Host "=== 1. Copie des scripts dans le conteneur ===" -ForegroundColor Cyan
$files = @(
    $migrationFile,
    (Join-Path $sqlDir "000_roles.sql"),
    (Join-Path $sqlDir "010_rls.sql"),
    (Join-Path $here "verify.sql"),
    (Join-Path $here "verify-bloc5-billing.sql"),
    (Join-Path $here "count.sql"),
    (Join-Path $here "state.sql"),
    (Join-Path $here "verify-user-auth-columns.sql"),
    (Join-Path $here "verify-user-down.sql"),
    (Join-Path $here "verify-auth-owner-negative.sql"),
    (Join-Path $sqlDir "down/020_user_auth_columns_down.sql")
)

foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        throw "Fichier manquant : $file"
    }
    $name = Split-Path $file -Leaf
    & docker cp $file "${Container}:/tmp/$name"
    if ($LASTEXITCODE -ne 0) {
        throw "docker cp a echoue pour $file"
    }
}

Write-Host "=== 2. Roles PostgreSQL ===" -ForegroundColor Cyan
& docker exec $Container psql -U $DbUser -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/000_roles.sql
if ($LASTEXITCODE -ne 0) {
    throw "Echec de 000_roles.sql."
}

Write-Host "=== 3. Base RLS : $rlsDb ===" -ForegroundColor Cyan
Reset-Database $rlsDb
Invoke-Psql -Database $rlsDb -File "/tmp/migration.sql" -Quiet
Invoke-Psql -Database $rlsDb -File "/tmp/010_rls.sql" -Quiet
Invoke-Psql -Database $rlsDb -File "/tmp/verify.sql"
# Bloc 5 : facturation ecole (numerotation sans trou, immuabilite, RLS).
Invoke-Psql -Database $rlsDb -File "/tmp/verify-bloc5-billing.sql"
& docker exec $Container psql -U $DbUser -d $rlsDb -f /tmp/state.sql
Write-Host "--- P0-3 : privileges User (base neuve) ---"
Invoke-Psql -Database $rlsDb -File "/tmp/verify-user-auth-columns.sql"
Invoke-Psql -Database $rlsDb -File "/tmp/verify-auth-owner-negative.sql"

Write-Host "=== 4. Base seed : $seedDb ===" -ForegroundColor Cyan
Reset-Database $seedDb
Invoke-Psql -Database $seedDb -File "/tmp/migration.sql" -Quiet
Invoke-Psql -Database $seedDb -File "/tmp/010_rls.sql" -Quiet

if (-not $env:SEED_PASSWORD -or $env:SEED_PASSWORD.Length -lt 12) {
    throw "SEED_PASSWORD est requis (12 caracteres minimum) pour tester le seed."
}

$env:DIRECT_DATABASE_URL = "postgresql://${DbUser}:${DbPassword}@127.0.0.1:${PgPort}/${seedDb}?schema=public"
$env:DATABASE_URL = "postgresql://orya_app:placeholder@127.0.0.1:${PgPort}/${seedDb}?schema=public"
$env:NODE_ENV = "development"

Push-Location $api
try {
    Write-Host "--- seed, 1re execution ---"
    & npx tsx prisma/seed.ts
    if ($LASTEXITCODE -ne 0) { throw "Le seed a echoue." }

    Write-Host "--- seed, 2e execution (idempotence) ---"
    & npx tsx prisma/seed.ts
    if ($LASTEXITCODE -ne 0) { throw "Le second seed a echoue." }
}
finally {
    Pop-Location
}

Write-Host "--- compteurs attendus : 3 / 13 / 13 / 6 / 6 / 12 / 12 ---"
& docker exec $Container psql -U $DbUser -d $seedDb -f /tmp/count.sql

Write-Host "--- P0-3 : privileges User (base seedee), retour arriere puis reapplication ---"
Invoke-Psql -Database $seedDb -File "/tmp/verify-user-auth-columns.sql"
Invoke-Psql -Database $seedDb -File "/tmp/020_user_auth_columns_down.sql" -Quiet
Invoke-Psql -Database $seedDb -File "/tmp/verify-user-down.sql"
Invoke-Psql -Database $seedDb -File "/tmp/010_rls.sql" -Quiet
Invoke-Psql -Database $seedDb -File "/tmp/verify-user-auth-columns.sql"

Write-Host ""
Write-Host "=== TERMINE : RLS et seed verifies ===" -ForegroundColor Green
}
finally {
    # Restaure la valeur d'avant le run (ou supprime la variable si elle etait absente).
    if ($null -eq $__oryaSeedPrev) { Remove-Item Env:SEED_PASSWORD -ErrorAction SilentlyContinue } else { $env:SEED_PASSWORD = $__oryaSeedPrev }
    Remove-Variable __oryaSeedPrev -ErrorAction SilentlyContinue
}
