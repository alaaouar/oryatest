# =============================================================================
# ORYA - Lot 10 : test de bout en bout sauvegarde -> restauration, sur bases JETABLES.
#   Source : orya_e2e (creee par e2e/run-e2e.ps1) ; cible : orya_restore_test.
#   Compare le nombre de lignes de tables cles et la presence des policies RLS.
# =============================================================================
param([string]$Target = "orya_restore_test")
. (Join-Path $PSScriptRoot "../scripts/test-guard.ps1")
$T = Get-OryaTestTarget -DefaultDb "orya_e2e"
$Container = $T.Container; $DbUser = $T.DbUser; $DbPassword = $T.DbPassword; $PgPort = $T.Port
$Source = $T.Db
$Target = Assert-OryaTestDbName $Target
Write-Host "TARGET host=$($T.Host) port=$PgPort db=$Target (restauration)"
$ErrorActionPreference = "Stop"
if (@("orya", "orya_v2") -contains $Source -or @("orya", "orya_v2") -contains $Target) { throw "Test interdit sur orya / orya_v2." }
$out = Join-Path $env:TEMP "orya-backup-test"
& (Join-Path $PSScriptRoot "backup-db.ps1") -Database $Source -OutDir $out -Container $Container -DbUser $DbUser
$dump = Get-ChildItem $out -Filter "$Source-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
& (Join-Path $PSScriptRoot "restore-db.ps1") -Dump $dump.FullName -Target $Target -Recreate -Container $Container -DbUser $DbUser
$query = 'SELECT (SELECT count(*) FROM "School")||''/''||(SELECT count(*) FROM "Student")||''/''||(SELECT count(*) FROM "AttendanceRow")||''/''||(SELECT count(*) FROM "AuditLog")||''/''||(SELECT count(*) FROM pg_policies)'
$a = ("" + ($query | & docker exec -i $Container psql -U $DbUser -d $Source -tA)).Trim()
$b = ("" + ($query | & docker exec -i $Container psql -U $DbUser -d $Target -tA)).Trim()
Write-Host "Source  (ecoles/eleves/appels/audit/policies) : $a"
Write-Host "Restore (ecoles/eleves/appels/audit/policies) : $b"
& docker exec $Container psql -U $DbUser -d postgres -q -c "DROP DATABASE IF EXISTS $Target WITH (FORCE);" | Out-Null
Remove-Item -Recurse -Force $out
if ($a -ne $b) { throw "ECHEC : contenu restaure different." }
Write-Host "=== SAUVEGARDE / RESTAURATION OK ===" -ForegroundColor Green
