# Genere run-guide.ps1 a partir de run-e2e.ps1 : base jetable orya_guide, captures, etiquette [DEMO].
$src = Get-Content (Join-Path $PSScriptRoot "run-e2e.ps1") -Raw
$s = $src.Replace('-DefaultDb "orya_e2e"', '-DefaultDb "orya_guide"').Replace('orya_e2e_migration.sql', 'orya_guide_migration.sql')
$s = $s.Replace('try { & npx playwright test; $code = $LASTEXITCODE }', 'try { & npx playwright test -c playwright.guide.config.ts; $code = $LASTEXITCODE }')
$label = 'if ($LASTEXITCODE -ne 0) { throw "Fixture E2E en echec" }'
$s = $s.Replace($label, $label + "`n& docker cp (Join-Path `$root 'scripts/demo-label.sql') `"`${Container}:/tmp/guide_label.sql`"`n& docker exec `$Container psql -U `$DbUser -d `$db -v ON_ERROR_STOP=1 -q -f /tmp/guide_label.sql | Out-Null")
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "run-guide.ps1"), $s, [Text.UTF8Encoding]::new($false))
