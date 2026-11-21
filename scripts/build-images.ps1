# =============================================================================
# ORYA - construction LOCALE des images, taguees avec le SHA du commit.
#   orya-api:<sha12>  orya-api-migrate:<sha12>  orya-web:<sha12>
# Jamais de docker push. Refuse un arbre de travail modifie (sauf -AllowDirty,
# qui ajoute le suffixe -dirty au tag) pour que le tag decrive exactement le code.
# Usage : .\scripts\build-images.ps1 -ApiBase https://api.<domaine>/api/v1 [-AllowDirty]
# =============================================================================
param(
    [Parameter(Mandatory = $true)][string]$ApiBase,
    [switch]$AllowDirty
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $root
try {
    $sha = (git rev-parse --short=12 HEAD).Trim()
    $full = (git rev-parse HEAD).Trim()
    $dirty = [bool](git status --porcelain)
    if ($dirty -and -not $AllowDirty) { throw "Arbre de travail modifie : commiter d'abord (ou -AllowDirty)." }
    $tag = if ($dirty) { "$sha-dirty" } else { $sha }
    $created = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $labels = @("--label", "org.opencontainers.image.revision=$full", "--label", "org.opencontainers.image.created=$created", "--label", "org.opencontainers.image.version=$tag")
    Write-Host "TAG=$tag (local uniquement, aucun push)"
    & docker build -f deploy/Dockerfile.api --target runtime @labels -t "orya-api:$tag" .
    if ($LASTEXITCODE -ne 0) { throw "build orya-api echoue" }
    & docker build -f deploy/Dockerfile.api --target migrate @labels -t "orya-api-migrate:$tag" .
    if ($LASTEXITCODE -ne 0) { throw "build orya-api-migrate echoue" }
    & docker build -f deploy/Dockerfile.web @labels --label "ma.orya.next-public-api-base=$ApiBase" --build-arg "NEXT_PUBLIC_API_BASE=$ApiBase" -t "orya-web:$tag" .
    if ($LASTEXITCODE -ne 0) { throw "build orya-web echoue" }
    Write-Host "Images construites : orya-api:$tag orya-api-migrate:$tag orya-web:$tag"
    Write-Host "Compose : ORYA_IMAGE_TAG=$tag"
}
finally { Pop-Location }
