# =============================================================================
# ORYA - controle de derive de schema (t52u) sur le conteneur JETABLE orya-test-pg.
#   Base orya_drift creee, migrations appliquees (prisma migrate deploy), puis
#   prisma migrate diff : base migree -> prisma/schema.prisma (--exit-code).
#   L'URL de connexion est construite dans ce processus et passee par variable
#   d'environnement : jamais en argument, jamais affichee, journalisee ni ecrite.
#   Sortie : "DERIVE SCHEMA : aucune" (code 0), le SQL de derive (code 1), ou une
#   erreur generique (code 2, sortie Prisma non reproduite).
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiRoot = Join-Path $repoRoot "apps/api"
. (Join-Path $PSScriptRoot "test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_drift" 6>$null
$c = $T.Container; $db = $T.Db; $adm = $T.DbUser
function Psql([string]$DbName, [string]$Sql) { $Sql | & docker exec -i $c psql -U $adm -d $DbName -v ON_ERROR_STOP=1 -q -At 2>&1 | Out-Null; return $LASTEXITCODE }
$saved = @{}; foreach ($k in @("DATABASE_URL", "DIRECT_DATABASE_URL")) { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
$rc = 2
try {
    if ((Psql "postgres" "DROP DATABASE IF EXISTS $db; CREATE DATABASE $db;") -ne 0) { throw "creation de la base de controle impossible" }
    $null = Get-Content -Raw (Join-Path $apiRoot "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $url = "postgresql://" + $T.DbUser + ":" + [Uri]::EscapeDataString($T.DbPassword) + "@127.0.0.1:" + $T.Port + "/" + $db + "?schema=public"
    $env:DATABASE_URL = $url; $env:DIRECT_DATABASE_URL = $url; $url = $null
    Push-Location $apiRoot
    try {
        & npx prisma migrate deploy *> $null
        if ($LASTEXITCODE -ne 0) { throw "migrate deploy en echec" }
        $diff = & npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script --exit-code 2>$null | Out-String
        $code = $LASTEXITCODE
    } finally { Pop-Location }
    if ($code -eq 0) { Write-Host "DERIVE SCHEMA : aucune (base migree = prisma/schema.prisma)"; $rc = 0 }
    elseif ($code -eq 2) {
        Write-Host "DERIVE SCHEMA : DETECTEE - SQL necessaire pour aligner la base migree sur schema.prisma :"
        Write-Host ($diff -replace 'postgres(ql)?://\S+', '<url masquee>')
        $rc = 1
    } else { Write-Host "DERIVE SCHEMA : ERREUR prisma migrate diff (code $code, sortie non reproduite)"; $rc = 2 }
}
catch { Write-Host "DERIVE SCHEMA : ERREUR - $($_.Exception.Message)"; $rc = 2 }
finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    $null = Psql "postgres" "DROP DATABASE IF EXISTS $db;"
}
exit $rc