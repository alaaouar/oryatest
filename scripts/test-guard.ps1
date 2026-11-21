# =============================================================================
# ORYA - P0-2 : garde commune des scripts de test. A dot-sourcer EN TETE de script :
#   . (Join-Path $PSScriptRoot "<chemin>/scripts/test-guard.ps1")
#   $T = Get-OryaTestTarget -DefaultDb "orya_xxx"
#
# Cible redirigeable par variables d'environnement (hote toujours 127.0.0.1) :
#   ORYA_TEST_CONTAINER (defaut orya-test-pg)
#   ORYA_TEST_PORT      (defaut 55433)
#   ORYA_TEST_DB        (defaut : base jetable propre a chaque suite)
# Refus (code de sortie 3) AVANT toute commande Docker ou base si :
#   conteneur = orya-postgres, port = 5432, base = orya / orya_v2 / postgres / template0 / template1
#   (comparaison insensible a la casse, espaces retires).
# Refus aussi si le conteneur ne porte pas le label created-by=orya-test (cree par
# scripts/test-pg-up.ps1) ou ne publie pas 127.0.0.1:<port>.
# Le mot de passe du superutilisateur jetable est lu dans le conteneur, jamais affiche.
# =============================================================================
$script:OryaForbiddenContainers = @("orya-postgres")
$script:OryaForbiddenPorts = @(5432)
$script:OryaForbiddenDbs = @("orya", "orya_v2", "postgres", "template0", "template1")

function Stop-OryaTest([string]$Message) {
    [Console]::Error.WriteLine("REFUS (test-guard) : $Message")
    exit 3
}

function Assert-OryaTestDbName([string]$Name) {
    $n = ("" + $Name).Trim().ToLowerInvariant()
    if (-not $n) { Stop-OryaTest "nom de base vide." }
    if ($script:OryaForbiddenDbs -contains $n) { Stop-OryaTest "base '$n' interdite." }
    if ($n -notmatch '^[a-z][a-z0-9_]{0,40}$') { Stop-OryaTest "nom de base invalide '$n'." }
    return $n
}

function Get-OryaTestTarget {
    param([Parameter(Mandatory = $true)][string]$DefaultDb)

    $container = ("" + $env:ORYA_TEST_CONTAINER).Trim()
    if (-not $container) { $container = "orya-test-pg" }
    $portRaw = ("" + $env:ORYA_TEST_PORT).Trim()
    if (-not $portRaw) { $portRaw = "55433" }
    $dbRaw = ("" + $env:ORYA_TEST_DB).Trim()
    if (-not $dbRaw) { $dbRaw = $DefaultDb }

    # 1. Controles purs (aucune commande externe).
    if ($script:OryaForbiddenContainers -contains $container.ToLowerInvariant()) { Stop-OryaTest "conteneur '$container' interdit." }
    if ($container -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$') { Stop-OryaTest "nom de conteneur invalide." }
    $port = 0
    if (-not [int]::TryParse($portRaw, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) { Stop-OryaTest "port invalide '$portRaw'." }
    if ($script:OryaForbiddenPorts -contains $port) { Stop-OryaTest "port $port interdit." }
    $db = Assert-OryaTestDbName $dbRaw

    # 2. Le conteneur doit etre celui cree par scripts/test-pg-up.ps1 (lecture seule).
    $json = (& docker inspect -f '{{json .Config.Labels}}' $container 2>$null) -join ""
    if ($LASTEXITCODE -ne 0 -or -not $json) { Stop-OryaTest "conteneur '$container' introuvable (lancer scripts/test-pg-up.ps1)." }
    $labels = $json | ConvertFrom-Json
    if ($null -eq $labels -or ("" + $labels.'created-by') -ne "orya-test") { Stop-OryaTest "conteneur '$container' sans label created-by=orya-test." }
    $running = ("" + (& docker inspect -f '{{.State.Running}}' $container 2>$null)).Trim()
    if ($running -ne "true") { Stop-OryaTest "conteneur '$container' arrete." }
    $mapped = (& docker port $container 5432/tcp 2>$null) -join " "
    if ($mapped -notmatch ("(^|\s)127\.0\.0\.1:" + $port + "(\s|$)")) { Stop-OryaTest "le conteneur ne publie pas 127.0.0.1:$port." }
    $user = ("" + (& docker exec $container printenv POSTGRES_USER 2>$null)).Trim()
    $pw = ("" + (& docker exec $container printenv POSTGRES_PASSWORD 2>$null)).Trim()
    if (-not $user -or -not $pw) { Stop-OryaTest "identifiants du conteneur de test indisponibles." }

    Write-Host "TARGET host=127.0.0.1 port=$port db=$db container=$container"
    return @{ Host = "127.0.0.1"; Port = $port; Db = $db; Container = $container; DbUser = $user; DbPassword = $pw }
}
