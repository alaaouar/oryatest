# =============================================================================
# ORYA - Bloc 3 : conteneurs JETABLES des tests fichiers (label created-by=orya-test).
#   orya-test-s3     : SeaweedFS (S3 compatible, SSE-S3 active), 127.0.0.1:55435, volume orya-test-s3-data
#   orya-test-clamav : ClamAV clamd, 127.0.0.1:55436 (signatures de l'image, sans volume ; CLAMAV_NO_FRESHCLAMD=true : aucun rechargement de base pendant les suites, sinon clamd depasse MaxScanTime et repond Heuristics.Limits.Exceeded.MaxScanTime)
# Usage : scripts/test-files-up.ps1 [-Only s3|clamav]   ;  scripts/test-files-down.ps1
# Refuse tout conteneur/volume existant sans label, tout port deja occupe.
# Identifiants S3 et cle SSE generes ici, passes par variables d'environnement
# (jamais en ligne de commande), jamais affiches ni ecrits sur disque.
# =============================================================================
param([ValidateSet("all", "s3", "clamav")][string]$Only = "all")
$S3Image = "chrislusf/seaweedfs:4.50"
$ClamImage = "clamav/clamav:1.4"

function Get-Label([string]$Kind, [string]$Ref) {
    if ($Kind -eq "container") { $json = (& docker container inspect -f '{{json .Config.Labels}}' $Ref 2>$null) -join "" }
    else { $json = (& docker volume inspect -f '{{json .Labels}}' $Ref 2>$null) -join "" }
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    $l = $json | ConvertFrom-Json
    if ($null -eq $l) { return "" }
    return ("" + $l.'created-by')
}
function Assert-Free([string]$Name, [string]$Volume, [int]$Port) {
    $c = Get-Label "container" $Name
    if ($null -ne $c) {
        if ($c -ne "orya-test") { [Console]::Error.WriteLine("REFUS : conteneur '$Name' sans label created-by=orya-test."); exit 3 }
        [Console]::Error.WriteLine("REFUS : '$Name' existe deja (scripts/test-files-down.ps1)."); exit 4
    }
    if ($Volume) {
        $v = Get-Label "volume" $Volume
        if ($null -ne $v) {
            if ($v -ne "orya-test") { [Console]::Error.WriteLine("REFUS : volume '$Volume' sans label created-by=orya-test."); exit 3 }
            [Console]::Error.WriteLine("REFUS : volume '$Volume' existe deja."); exit 4
        }
    }
    $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse("127.0.0.1"), $Port)
    try { $probe.Start(); $probe.Stop() } catch { [Console]::Error.WriteLine("REFUS : port 127.0.0.1:$Port deja occupe."); exit 3 }
}
function New-Secret([int]$n) {
    $b = New-Object byte[] $n; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return -join ($b | ForEach-Object { $_.ToString("x2") })
}

if ($Only -in @("all", "s3")) {
    Assert-Free "orya-test-s3" "orya-test-s3-data" 55435
    $env:AWS_ACCESS_KEY_ID = "orya" + (New-Secret 8)
    $env:AWS_SECRET_ACCESS_KEY = New-Secret 24
    $env:WEED_S3_SSE_KEY = New-Secret 32
    try {
        & docker volume create --label created-by=orya-test orya-test-s3-data | Out-Null
        if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("ECHEC : volume S3."); exit 1 }
        & docker run -d --name orya-test-s3 --label created-by=orya-test -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e WEED_S3_SSE_KEY -p "127.0.0.1:55435:8333" -v "orya-test-s3-data:/data" $S3Image server -dir=/data -s3 -s3.port=8333 -master.volumeSizeLimitMB=64 -volume.max=8 | Out-Null
        if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("ECHEC : demarrage orya-test-s3."); exit 1 }
    } finally { Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:WEED_S3_SSE_KEY -ErrorAction SilentlyContinue }
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 1
        try { $r = Invoke-WebRequest "http://127.0.0.1:55435/" -UseBasicParsing -TimeoutSec 2; $ready = $true; break }
        catch { if ($_.Exception.Response) { $ready = $true; break } }
    }
    if (-not $ready) { [Console]::Error.WriteLine("ECHEC : orya-test-s3 non pret."); exit 1 }
    Write-Host "S3 host=127.0.0.1 port=55435 container=orya-test-s3 (pret)"
}

if ($Only -in @("all", "clamav")) {
    Assert-Free "orya-test-clamav" "" 55436
    # t52u : limites clamd (MaxScanTime, MaxFileSize, MaxRecursion, MaxFiles, AlertExceedsMax)
    # copiees dans CE conteneur jetable avant son demarrage. Aucun clamd global touche.
    $confSrc = Join-Path $PSScriptRoot "clamav/clamd-orya-test.conf"
    $confTmp = Join-Path $env:TEMP ("orya-clamd-" + [guid]::NewGuid().ToString("N") + ".conf")
    [IO.File]::WriteAllText($confTmp, ((Get-Content -Raw $confSrc) -replace "`r`n", "`n"))
    & docker create --name orya-test-clamav --label created-by=orya-test -e CLAMAV_NO_FRESHCLAMD=true -p "127.0.0.1:55436:3310" $ClamImage | Out-Null
    if ($LASTEXITCODE -ne 0) { Remove-Item $confTmp -ErrorAction SilentlyContinue; [Console]::Error.WriteLine("ECHEC : creation orya-test-clamav."); exit 1 }
    & docker cp $confTmp "orya-test-clamav:/etc/clamav/clamd.conf" | Out-Null
    $cpRc = $LASTEXITCODE; Remove-Item $confTmp -ErrorAction SilentlyContinue
    if ($cpRc -ne 0) { & docker rm -f orya-test-clamav | Out-Null; [Console]::Error.WriteLine("ECHEC : configuration clamd du conteneur jetable."); exit 1 }
    & docker start orya-test-clamav | Out-Null
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("ECHEC : demarrage orya-test-clamav."); exit 1 }
    $ready = $false
    for ($i = 0; $i -lt 300; $i++) {
        Start-Sleep -Seconds 2
        try {
            $tcp = New-Object Net.Sockets.TcpClient; $tcp.Connect("127.0.0.1", 55436)
            $st = $tcp.GetStream(); $st.ReadTimeout = 3000
            $msg = [Text.Encoding]::ASCII.GetBytes("zPING`0"); $st.Write($msg, 0, $msg.Length)
            $buf = New-Object byte[] 16; $n = $st.Read($buf, 0, 16); $tcp.Close()
            if ([Text.Encoding]::ASCII.GetString($buf, 0, $n) -like "PONG*") { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) { [Console]::Error.WriteLine(("ClamAV non pr{0}t : orya-test-clamav (clamd), delai maximal depasse." -f [char]234)); exit 78 }
    Write-Host "CLAMAV host=127.0.0.1 port=55436 container=orya-test-clamav (pret)"
}
exit 0
