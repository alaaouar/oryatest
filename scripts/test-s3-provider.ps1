# =============================================================================
# ORYA - t62u B2 : harnais de test du fournisseur S3 (apps/api/test/api/s3-provider-suite.ts).
#   Mode fournisseur (defaut) : utilise UNIQUEMENT les variables STORAGE_S3_* deja presentes dans
#     la session (jamais en argument, jamais affichees). A lancer par l'exploitant sur la
#     pre-production, avec un bucket et des identifiants DE PRE-PRODUCTION (docs/preproduction.md).
#   -Disposable : validation locale sur le S3 JETABLE orya-test-s3 (label created-by=orya-test,
#     scripts/test-files-up.ps1) : bucket de test cree puis supprime, identifiants du conteneur
#     jetable lus par docker exec et jamais affiches.
# Sortie : "S3PROVIDER : X OK, Y KO" ; code 1 si un controle echoue.
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\test-s3-provider.ps1 [-Disposable]
# =============================================================================
param([switch]$Disposable)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api = Join-Path $root "apps/api"
$keys = @("STORAGE_S3_BUCKET","STORAGE_S3_ENDPOINT","STORAGE_S3_REGION","STORAGE_S3_FORCE_PATH_STYLE","STORAGE_S3_ACCESS_KEY_ID","STORAGE_S3_SECRET_ACCESS_KEY","STORAGE_S3_SSE","S3_HARNESS_CREATE_BUCKET")
$saved = @{}; foreach ($k in $keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
$rc = 1
try {
    if ($Disposable) {
        $json = (& docker container inspect -f '{{json .Config.Labels}}' orya-test-s3 2>$null) -join ""
        if ($LASTEXITCODE -ne 0 -or -not $json -or ("" + ($json | ConvertFrom-Json).'created-by') -ne "orya-test") {
            [Console]::Error.WriteLine("REFUS : orya-test-s3 absent ou sans label created-by=orya-test (scripts/test-files-up.ps1 -Only s3)."); exit 3
        }
        $b = New-Object byte[] 4; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
        $env:STORAGE_S3_BUCKET = "orya-test-harness-" + (-join ($b | ForEach-Object { $_.ToString("x2") }))
        $env:STORAGE_S3_ENDPOINT = "http://127.0.0.1:55435"; $env:STORAGE_S3_REGION = "us-east-1"; $env:STORAGE_S3_FORCE_PATH_STYLE = "1"
        $env:STORAGE_S3_ACCESS_KEY_ID = ("" + (& docker exec orya-test-s3 printenv AWS_ACCESS_KEY_ID 2>$null)).Trim()
        $env:STORAGE_S3_SECRET_ACCESS_KEY = ("" + (& docker exec orya-test-s3 printenv AWS_SECRET_ACCESS_KEY 2>$null)).Trim()
        $env:STORAGE_S3_SSE = "AES256"; $env:S3_HARNESS_CREATE_BUCKET = "1"
    } else {
        Remove-Item Env:S3_HARNESS_CREATE_BUCKET -ErrorAction SilentlyContinue
        foreach ($k in "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY") {
            if (-not [Environment]::GetEnvironmentVariable($k)) { [Console]::Error.WriteLine("REFUS : $k absente de la session."); exit 2 }
        }
    }
    Push-Location $api
    try {
        $out = & npx tsx test/api/s3-provider-suite.ts 2>&1 | Out-String
        $rc = $LASTEXITCODE
    } finally { Pop-Location }
    # Filet : aucun secret de la session ne doit apparaitre dans la sortie.
    $sec = [Environment]::GetEnvironmentVariable("STORAGE_S3_SECRET_ACCESS_KEY")
    if ($sec -and $out.Contains($sec)) { $out = $out.Replace($sec, "***"); Write-Host "  S3P KO - secret present dans la sortie (masque)"; $rc = 1 }
    Write-Host $out.TrimEnd()
}
finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
}
exit $rc
