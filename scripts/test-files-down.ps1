# =============================================================================
# ORYA - Bloc 3 : supprime orya-test-s3 (+ volume orya-test-s3-data) et orya-test-clamav.
#   Ne supprime QUE des ressources portant le label created-by=orya-test. Absent = ignore.
# =============================================================================
param()
$rc = 0
foreach ($name in @("orya-test-s3", "orya-test-clamav")) {
    $json = (& docker container inspect -f '{{json .Config.Labels}}' $name 2>$null) -join ""
    if ($LASTEXITCODE -ne 0 -or -not $json) { continue }
    $l = $json | ConvertFrom-Json
    if ($null -eq $l -or ("" + $l.'created-by') -ne "orya-test") { [Console]::Error.WriteLine("REFUS : '$name' sans label created-by=orya-test (non supprime)."); $rc = 3; continue }
    & docker rm -f $name | Out-Null
    if ($LASTEXITCODE -ne 0) { $rc = 1 }
}
$vol = "orya-test-s3-data"
$json = (& docker volume inspect -f '{{json .Labels}}' $vol 2>$null) -join ""
if ($LASTEXITCODE -eq 0 -and $json) {
    $l = $json | ConvertFrom-Json
    if ($null -eq $l -or ("" + $l.'created-by') -ne "orya-test") { [Console]::Error.WriteLine("REFUS : volume '$vol' sans label (non supprime)."); $rc = 3 }
    else { & docker volume rm $vol | Out-Null; if ($LASTEXITCODE -ne 0) { $rc = 1 } }
}
Write-Host "FILES DOWN (code $rc)"
exit $rc
