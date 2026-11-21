# Genere run-preprod.ps1 depuis run-e2e.ps1 (meme base jetable orya_e2e) : tests preprod.
$s = Get-Content (Join-Path $PSScriptRoot "run-e2e.ps1") -Raw
$s = $s.Replace('try { & npx playwright test; $code = $LASTEXITCODE }', 'try { & npx playwright test -c playwright.preprod.config.ts; $code = $LASTEXITCODE }')
$label = 'if ($LASTEXITCODE -ne 0) { throw "Fixture E2E en echec" }'
$add = @'
$env:OTHER_SCHOOL_STUDENT_ID = ("" + ('SELECT s.id FROM "Student" s JOIN "School" sc ON sc.id = s."schoolId" WHERE sc.name NOT LIKE ''%Al Nour%'' LIMIT 1;' | & docker exec -i $Container psql -U $DbUser -d $db -tA)).Trim()
$env:E2E_API_URL = "http://127.0.0.1:$ApiPort/api/v1"
Write-Host "Eleve autre ecole : $($env:OTHER_SCHOOL_STUDENT_ID)"
'@
$s = $s.Replace($label, $label + "`n" + $add)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "run-preprod.ps1"), $s, [Text.UTF8Encoding]::new($false))
