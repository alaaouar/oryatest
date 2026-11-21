# =============================================================================
# ORYA - (re)genere docs/RELEASE_MANIFEST.md pour le HEAD courant (UTF-8 sans BOM).
# Le manifeste decrit le commit PARENT du commit qui l'ajoute (HEAD au moment de la generation).
# Usage : .\scripts\make-release-manifest.ps1
# =============================================================================
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $root
try {
    $full = (git rev-parse HEAD).Trim(); $sha = (git rev-parse --short=12 HEAD).Trim()
    $branch = (git branch --show-current).Trim()
    $date = (git log -1 --format=%cI HEAD).Trim()
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("# ORYA - Manifeste de version (local, non publie)")
    $lines.Add("")
    $lines.Add("Genere par ``scripts/make-release-manifest.ps1``. Decrit le commit ci-dessous ; a regenerer a chaque version.")
    $lines.Add("")
    $lines.Add("| Element | Valeur |"); $lines.Add("|---|---|")
    $lines.Add("| Commit | ``$full`` |"); $lines.Add("| Branche | ``$branch`` |"); $lines.Add("| Date du commit | $date |")
    $lines.Add("| Tag des images | ``$sha`` (``scripts/build-images.ps1``) |")
    $lines.Add("")
    $lines.Add("## Images locales pour ce commit")
    $lines.Add("")
    $lines.Add("| Image | ID |"); $lines.Add("|---|---|")
    foreach ($img in "orya-api", "orya-api-migrate", "orya-web") {
        $ErrorActionPreference = "Continue"; $id = (& docker image inspect "${img}:$sha" --format "{{.Id}}" 2>$null); $ErrorActionPreference = "Stop"
        if ($LASTEXITCODE -ne 0 -or -not $id) { $id = "non construite" }
        $lines.Add("| ``${img}:$sha`` | ``$id`` |")
    }
    $lines.Add("")
    $lines.Add("## Historique recent")
    $lines.Add("")
    git log --format="- ``%h`` %s" -15 HEAD | ForEach-Object { $lines.Add($_) }
    $lines.Add("")
    $lines.Add("## Verification")
    $lines.Add("")
    $lines.Add("``powershell -ExecutionPolicy Bypass -File .\scripts\verify-all.ps1`` (orya-test-pg uniquement).")
    [IO.File]::WriteAllText((Join-Path $root "docs/RELEASE_MANIFEST.md"), (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
    Write-Host "docs/RELEASE_MANIFEST.md regenere pour $sha (sans BOM)."
}
finally { Pop-Location }
