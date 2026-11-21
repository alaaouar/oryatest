# =============================================================================
# ORYA - Lot 10 : restauration d'une sauvegarde dans une base CIBLE NEUVE.
#   Refuse toujours orya et orya_v2 (et toute base existante sans -Recreate).
#   Verifie l'empreinte SHA-256 avant restauration.
#   Usage : .\scripts\restore-db.ps1 -Dump backups\x.dump -Target orya_restore_test [-Recreate]
# =============================================================================
param(
    [Parameter(Mandatory = $true)][string]$Dump,
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$DbUser,
    [switch]$Recreate,
    # Bloc 3 / point 1 : rejoue le registre des suppressions (base + journal hors base)
    # apres restauration. Exige DATABASE_URL (orya_app), DELETION_REGISTER_HMAC_KEY et
    # DELETION_REGISTER_JOURNAL dans l'environnement de l'operateur (jamais en argument).
    # t62u B3 : avec DELETION_JOURNAL_WORM_BUCKET (+ REGION/ENDPOINT) et les identifiants de
    # LECTURE DELETION_JOURNAL_WORM_READER_*, la copie WORM est relue (fichier local facultatif).
    [switch]$Replay
)
$ErrorActionPreference = "Stop"
$forbidden = @("orya", "orya_v2", "postgres", "template0", "template1")
$Target = $Target.Trim()
if ($Container.Trim().ToLower() -eq "orya-postgres") { throw "Restauration interdite dans le conteneur orya-postgres." }
if ($forbidden -contains $Target.ToLower()) { throw "Restauration interdite dans '$Target' (base protegee)." }
if ($Target -notmatch '^[a-z0-9_]+$') { throw "Nom de base invalide." }
if (-not (Test-Path $Dump)) { throw "Fichier introuvable : $Dump" }
Write-Host "TARGET container=$Container db=$Target"
$sumFile = "$Dump.sha256"
if (Test-Path $sumFile) {
    $expected = ((Get-Content $sumFile -Raw).Split(" ")[0]).Trim()
    $actual = (Get-FileHash $Dump -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { throw "Empreinte SHA-256 differente : fichier altere." }
    Write-Host "Empreinte verifiee."
}
$exists = ("" + (& docker exec $Container psql -U $DbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Target'")).Trim()
if ($exists -eq "1") {
    if (-not $Recreate) { throw "La base $Target existe deja (utiliser -Recreate pour une base jetable)." }
    & docker exec $Container psql -U $DbUser -d postgres -q -c "DROP DATABASE $Target WITH (FORCE);" | Out-Null
}
& docker exec $Container psql -U $DbUser -d postgres -q -c "CREATE DATABASE $Target;" | Out-Null
$inner = "/tmp/restore-$Target.dump"
& docker cp $Dump "${Container}:$inner"
& docker exec $Container pg_restore -U $DbUser -d $Target --no-owner --no-privileges --exit-on-error $inner
$code = $LASTEXITCODE
& docker exec $Container rm -f $inner | Out-Null
if ($code -ne 0) { throw "pg_restore a echoue ($code)." }
Write-Host "Restauration terminee dans $Target."
if ($Replay) {
    Push-Location (Join-Path $PSScriptRoot "../apps/api")
    try { & npx tsx prisma/run-replay-register.ts; $rc = $LASTEXITCODE } finally { Pop-Location }
    if ($rc -ne 0) { throw "Rejeu du registre des suppressions en echec ($rc) : base restauree NON exploitable." }
    Write-Host "Registre des suppressions rejoue."
} else {
    Write-Host "OBLIGATOIRE avant remise en service : rejouer le registre des suppressions (-Replay ou apps/api/prisma/run-replay-register.ts)." -ForegroundColor Yellow
}
