# =============================================================================
# ORYA - P0-2 : supprime UNIQUEMENT le conteneur et le volume de test crees par
#   scripts/test-pg-up.ps1, apres verification du label created-by=orya-test.
#   Refuse orya-postgres et toute ressource sans label. Aucun nettoyage global.
# =============================================================================
param()
# Pas de $ErrorActionPreference = "Stop" (voir test-pg-up.ps1) : codes de sortie verifies.
$name = ("" + $env:ORYA_TEST_CONTAINER).Trim(); if (-not $name) { $name = "orya-test-pg" }
if ($name.ToLowerInvariant() -eq "orya-postgres") { [Console]::Error.WriteLine("REFUS : conteneur orya-postgres interdit."); exit 3 }
if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$') { [Console]::Error.WriteLine("REFUS : nom invalide."); exit 3 }
$volume = "$name-data"

$cj = (& docker container inspect -f '{{json .Config.Labels}}' $name 2>$null) -join ""
if ($LASTEXITCODE -eq 0 -and $cj) {
    $l = $cj | ConvertFrom-Json
    if ($null -eq $l -or ("" + $l.'created-by') -ne "orya-test") { [Console]::Error.WriteLine("REFUS : '$name' ne porte pas le label created-by=orya-test."); exit 3 }
    & docker rm -f $name | Out-Null
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("ECHEC : suppression du conteneur $name impossible."); exit 1 }
    Write-Host "Conteneur $name supprime."
} else { Write-Host "Conteneur $name absent." }

$vj = (& docker volume inspect -f '{{json .Labels}}' $volume 2>$null) -join ""
if ($LASTEXITCODE -eq 0 -and $vj) {
    $l = $vj | ConvertFrom-Json
    if ($null -eq $l -or ("" + $l.'created-by') -ne "orya-test") { [Console]::Error.WriteLine("REFUS : volume '$volume' sans label created-by=orya-test."); exit 3 }
    & docker volume rm $volume | Out-Null
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("ECHEC : suppression du volume $volume impossible."); exit 1 }
    Write-Host "Volume $volume supprime."
} else { Write-Host "Volume $volume absent." }
