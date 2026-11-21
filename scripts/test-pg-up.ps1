# =============================================================================
# ORYA - P0-2 : cree le conteneur PostgreSQL JETABLE des tests (postgres:16).
#   Nom ORYA_TEST_CONTAINER (defaut orya-test-pg), port 127.0.0.1:ORYA_TEST_PORT
#   (defaut 55433), volume neuf <nom>-data. Labels created-by=orya-test.
#   Refuse orya-postgres, le port 5432, un port deja occupe, et tout conteneur ou
#   volume existant qui ne porte pas le label. Ne touche a aucune autre ressource.
#   Mot de passe superutilisateur genere ici, jamais affiche ni ecrit sur disque.
# =============================================================================
param()
# Pas de $ErrorActionPreference = "Stop" : Windows PowerShell 5.1 transformerait le stderr
# de "docker inspect" (ressource absente) en exception ; chaque code de sortie est verifie.
$name = ("" + $env:ORYA_TEST_CONTAINER).Trim(); if (-not $name) { $name = "orya-test-pg" }
$portRaw = ("" + $env:ORYA_TEST_PORT).Trim(); if (-not $portRaw) { $portRaw = "55433" }
$port = 0
if (-not [int]::TryParse($portRaw, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) { [Console]::Error.WriteLine("REFUS : port invalide."); exit 3 }
if ($name.ToLowerInvariant() -eq "orya-postgres") { [Console]::Error.WriteLine("REFUS : conteneur orya-postgres interdit."); exit 3 }
if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$') { [Console]::Error.WriteLine("REFUS : nom invalide."); exit 3 }
if ($port -eq 5432) { [Console]::Error.WriteLine("REFUS : port 5432 interdit."); exit 3 }
$volume = "$name-data"

function Get-Label([string]$Kind, [string]$Ref) {
    if ($Kind -eq "container") { $json = (& docker container inspect -f '{{json .Config.Labels}}' $Ref 2>$null) -join "" }
    else { $json = (& docker volume inspect -f '{{json .Labels}}' $Ref 2>$null) -join "" }
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $l = $json | ConvertFrom-Json
    if ($null -eq $l) { return "" }
    return ("" + $l.'created-by')
}

$cLabel = Get-Label "container" $name
if ($null -ne $cLabel) {
    if ($cLabel -ne "orya-test") { [Console]::Error.WriteLine("REFUS : un conteneur '$name' existe sans label created-by=orya-test."); exit 3 }
    [Console]::Error.WriteLine("REFUS : le conteneur de test '$name' existe deja (scripts/test-pg-down.ps1 pour repartir d'un volume neuf)."); exit 4
}
$vLabel = Get-Label "volume" $volume
if ($null -ne $vLabel) {
    if ($vLabel -ne "orya-test") { [Console]::Error.WriteLine("REFUS : un volume '$volume' existe sans label created-by=orya-test."); exit 3 }
    [Console]::Error.WriteLine("REFUS : le volume '$volume' existe deja (scripts/test-pg-down.ps1)."); exit 4
}
$probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse("127.0.0.1"), $port)
try { $probe.Start(); $probe.Stop() } catch { [Console]::Error.WriteLine("REFUS : port 127.0.0.1:$port deja occupe."); exit 3 }

$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:POSTGRES_PASSWORD = -join ($bytes | ForEach-Object { $_.ToString("x2") })
try {
    & docker volume create --label created-by=orya-test $volume | Out-Null
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("ECHEC : creation du volume impossible."); exit 1 }
    # -e POSTGRES_PASSWORD sans valeur : Docker lit la variable du client (absente de la ligne de commande).
    & docker run -d --name $name --label created-by=orya-test -e POSTGRES_USER=orya_test_admin -e POSTGRES_PASSWORD -p "127.0.0.1:${port}:5432" -v "${volume}:/var/lib/postgresql/data" postgres:16 | Out-Null
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("ECHEC : demarrage du conteneur impossible (volume $volume a supprimer par test-pg-down.ps1)."); exit 1 }
}
finally { Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue }

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    & docker exec $name pg_isready -U orya_test_admin -d postgres -h 127.0.0.1 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
if (-not $ready) { [Console]::Error.WriteLine("ECHEC : PostgreSQL de test non pret."); exit 1 }
Write-Host "TARGET host=127.0.0.1 port=$port container=$name volume=$volume (pret)"
