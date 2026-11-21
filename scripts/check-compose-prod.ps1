# =============================================================================
# ORYA - B03 : controle statique de deploy/docker-compose.prod.example.yml.
#   1. "docker compose config" sur une COPIE du fichier dans un dossier temporaire, avec
#      des variables FACTICES uniquement (aucun .env reel lu : pas de .env dans la copie,
#      --env-file vide, deploy/.env.prod remplace par un fichier vide).
#   2. Pour chaque variable obligatoire ${VAR:?message} : config SANS cette variable doit
#      echouer en affichant son message (le ":?" fonctionne et le YAML reste valide).
#   Ne lance, ne construit et ne tire aucune image ; ne touche a aucun conteneur.
#   Sortie : "COMPOSE PROD : <n> OK, <m> KO" ; code 1 si un controle echoue.
# =============================================================================
param([string]$File = "")
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $File) { $File = Join-Path $root "deploy/docker-compose.prod.example.yml" }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("orya-compose-check-" + [guid]::NewGuid().ToString("N"))
$deploy = Join-Path $tmp "deploy"
New-Item -ItemType Directory -Path $deploy -Force | Out-Null
$ok = 0; $ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  OK  $Label" -ForegroundColor Green } else { $script:ko++; Write-Host "  KO  $Label" -ForegroundColor Red }
}
# Variables factices (jamais de valeur reelle).
$dummy = [ordered]@{
    ORYA_IMAGE_TAG = "0000000000000000000000000000000000000000"
    POSTGRES_ADMIN_USER = "dummy_admin"
    POSTGRES_ADMIN_PASSWORD = "dummy-not-a-secret"
    ORYA_APP_PASSWORD = "dummy-not-a-secret"
    PUBLIC_API_BASE = "https://api.example.invalid/api/v1"
}
$saved = @{}
foreach ($k in $dummy.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process") }
function Invoke-Config([string[]]$Without) {
    foreach ($k in $dummy.Keys) {
        if ($Without -contains $k) { [Environment]::SetEnvironmentVariable($k, $null, "Process") }
        else { [Environment]::SetEnvironmentVariable($k, $dummy[$k], "Process") }
    }
    $out = & cmd.exe /c "docker compose --env-file `"$emptyEnv`" -f `"$copy`" config 2>&1"
    return @{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
}
try {
    $copy = Join-Path $deploy (Split-Path $File -Leaf)
    Copy-Item -LiteralPath $File -Destination $copy
    $emptyEnv = Join-Path $tmp "empty.env"
    [IO.File]::WriteAllText($emptyEnv, "")
    # env_file reference par la composition : remplace par un fichier vide (jamais le vrai).
    foreach ($m in [regex]::Matches([IO.File]::ReadAllText($copy), '(?m)^\s*env_file:\s*(\S+)\s*$')) {
        [IO.File]::WriteAllText((Join-Path $deploy $m.Groups[1].Value), "")
    }
    $r = Invoke-Config @()
    Check ($r.Code -eq 0) "docker compose config (variables factices) valide"
    if ($r.Code -ne 0) { Write-Host ($r.Text -split "`n" | Select-Object -First 3 | Out-String) }
    # Chaque ${VAR:?message} : absence -> echec avec le message attendu.
    $required = [regex]::Matches([IO.File]::ReadAllText($copy), '\$\{([A-Z0-9_]+):\?([^}]*)\}') |
        ForEach-Object { [pscustomobject]@{ Name = $_.Groups[1].Value; Message = $_.Groups[2].Value.Trim() } } |
        Sort-Object Name -Unique
    Check (@($required).Count -ge 1) "variables obligatoires detectees : $(@($required | ForEach-Object Name) -join ', ')"
    foreach ($v in $required) {
        if (-not $dummy.Contains($v.Name)) { Check $false "$($v.Name) : aucune valeur factice prevue"; continue }
        $r2 = Invoke-Config @($v.Name)
        Check ($r2.Code -ne 0 -and $r2.Text.Contains($v.Message)) "$($v.Name) absente -> refus avec son message"
    }
}
finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process") }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "COMPOSE PROD : $ok OK, $ko KO"
if ($ko -gt 0) { exit 1 }
exit 0