# =============================================================================
# ORYA - Lot 10 : environnement de DEMONSTRATION (base orya_demo, donnees fictives).
#   Toutes les ecoles sont renommees "[DEMO] ..." ; aucun lien avec orya / orya_v2.
#   Usage : $env:SEED_PASSWORD="..." ; .\scripts\demo-env.ps1
#   Cible orya-test-pg (scripts/test-pg-up.ps1) ; role orya_t_<base> recree a chaque execution
#   (URL ecrite dans %TEMP%\<base>.env, jamais affichee).
# =============================================================================
param()
. (Join-Path $PSScriptRoot "../scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_demo"
$Container = $T.Container; $DbUser = $T.DbUser; $DbPassword = $T.DbPassword; $PgPort = $T.Port
$ErrorActionPreference = "Stop"
$db = $T.Db
# Demo : SEED_PASSWORD doit etre defini par Ayoub dans son terminal (jamais genere, lu pour affichage ni ecrit ici).
if (-not $env:SEED_PASSWORD -or $env:SEED_PASSWORD.Length -lt 12) { [Console]::Error.WriteLine("REFUS (demo-env) : SEED_PASSWORD absent ou trop court (12 caracteres minimum). Definissez-le vous-meme dans votre terminal ; il ne sera jamais affiche."); exit 2 }
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api = Join-Path $root "apps/api"
& docker exec $Container psql -U $DbUser -d postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE);" | Out-Null
& docker exec $Container psql -U $DbUser -d postgres -q -c "CREATE DATABASE $db;" | Out-Null
# Role applicatif sans bypass RLS, propre a la base de demo (mot de passe regenere).
$appPassword = (& node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))").Trim()
# P0-2 : role propre a la base de test (cree a neuf dans le conteneur jetable, jamais d'ALTER ROLE).
$testRole = "orya_t_$db"
& docker exec $Container psql -U $DbUser -d postgres -v ON_ERROR_STOP=1 -q -c "DROP ROLE IF EXISTS $testRole; CREATE ROLE $testRole LOGIN NOBYPASSRLS PASSWORD '$appPassword';" | Out-Null
$dirs = Get-ChildItem (Join-Path $api "prisma/migrations") -Directory | Sort-Object Name
$tempRoot = if ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }
$migration = Join-Path $tempRoot "orya_demo_migration.sql"
[IO.File]::WriteAllText($migration, (($dirs | ForEach-Object { [IO.File]::ReadAllText((Join-Path $_.FullName "migration.sql")) }) -join "`n"), [Text.UTF8Encoding]::new($false))
foreach ($f in @($migration, (Join-Path $api "prisma/sql/010_rls.sql"), (Join-Path $api "test/api/grant-test-role.sql"))) {
    & docker cp $f "${Container}:/tmp/demo_$(Split-Path $f -Leaf)"
    & docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -v test_role=$testRole -q -f "/tmp/demo_$(Split-Path $f -Leaf)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Echec $f" }
}
$env:DIRECT_DATABASE_URL = "postgresql://${DbUser}:${DbPassword}@127.0.0.1:${PgPort}/${db}?schema=public"
$env:DATABASE_URL = "postgresql://${testRole}:${appPassword}@127.0.0.1:${PgPort}/${db}?schema=public"
$env:NODE_ENV = "development"
Push-Location $api
try { & npx tsx prisma/seed.ts | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Seed en echec" } }
finally { Pop-Location }
foreach ($f in @((Join-Path $api "test/api/seed-attendance.sql"), (Join-Path $root "e2e/seed-e2e.sql"), (Join-Path $PSScriptRoot "demo-label.sql"))) {
    & docker cp $f "${Container}:/tmp/demo_$(Split-Path $f -Leaf)"
    & docker exec $Container psql -U $DbUser -d $db -v ON_ERROR_STOP=1 -v test_role=$testRole -q -f "/tmp/demo_$(Split-Path $f -Leaf)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Echec $f" }
}
Write-Host "Base de demonstration $db prete (ecoles prefixees [DEMO])." -ForegroundColor Green
$envFile = Join-Path $tempRoot "$db.env"
[IO.File]::WriteAllText($envFile, "DATABASE_URL=postgresql://${testRole}:$appPassword@127.0.0.1:${PgPort}/${db}?schema=public`n", [Text.UTF8Encoding]::new($false))
Write-Host "DATABASE_URL de demo (role sans bypass RLS) ecrite dans $envFile (non affichee)."
Write-Host "Comptes : direction@ecole-a.orya.test, professeur@ecole-a.orya.test, parent1@ecole-a.orya.test (mot de passe = SEED_PASSWORD)."
