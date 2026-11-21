# =============================================================================
# ORYA - Lot 10 : sauvegarde d'une base PostgreSQL (pg_dump, format custom -Fc).
#   Lecture seule sur la base source. Fichier horodate + empreinte SHA-256.
#   Usage : .\scripts\backup-db.ps1 -Database <base> -Container <conteneur> -DbUser <role> [-OutDir backups]
#   P0-2 : aucun conteneur par defaut (outil d'exploitation : -Container obligatoire et explicite).
# =============================================================================
param(
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string]$DbUser,
    [string]$OutDir = (Join-Path $PSScriptRoot "..\backups")
)
$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[a-z0-9_]+$') { throw "Nom de base invalide." }
Write-Host "TARGET container=$Container db=$Database (lecture seule, pg_dump)"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$name = "$Database-$stamp.dump"
$inner = "/tmp/$name"
& docker exec $Container pg_dump -U $DbUser -d $Database -Fc --no-owner --no-privileges -f $inner
if ($LASTEXITCODE -ne 0) { throw "pg_dump a echoue." }
$target = Join-Path (Resolve-Path $OutDir) $name
& docker cp "${Container}:$inner" $target
& docker exec $Container rm -f $inner | Out-Null
$hash = (Get-FileHash $target -Algorithm SHA256).Hash.ToLower()
"$hash  $name" | Set-Content -Encoding ascii "$target.sha256"
Write-Host "Sauvegarde : $target"
Write-Host "SHA-256    : $hash"
