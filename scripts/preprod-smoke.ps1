# =============================================================================
# ORYA - t62u B4 : test de fumee de PRE-PRODUCTION contre une URL d'API donnee.
#   1. sante : /health 200, base "ok", migrations appliquees = migrations du commit deploye
#      (apps/api/prisma/migrations : nombre ET empreinte), aucune en cours ou echouee ;
#   2. connexion d'un compte de fumee (POST /auth/login, MFA TOTP si secret fourni), /me 200 ;
#   3. export de donnees : demande (202), attente "ready", telechargement JSON (contient le
#      compte) et PDF (%PDF) ;
#   4. suppression de compte : mauvais mot de passe refuse, demande (202, pending), session et
#      jeton de rafraichissement revoques, nouvelle connexion refusee. Le compte de fumee
#      "suppression" est CONSOMME (desactive, anonymise a J+14) : un compte fictif neuf par passage ;
#   5. deconnexion (refresh revoque).
# Identifiants : variables d'environnement UNIQUEMENT (jamais en argument, jamais affichees) :
#   ORYA_SMOKE_EXPORT_EMAIL / ORYA_SMOKE_EXPORT_PASSWORD [/ ORYA_SMOKE_EXPORT_TOTP_SECRET]
#   ORYA_SMOKE_DELETE_EMAIL / ORYA_SMOKE_DELETE_PASSWORD [/ ORYA_SMOKE_DELETE_TOTP_SECRET]
# Comptes de fumee : parents fictifs dedies de l'ecole de pre-production (docs/preproduction.md).
# HTTPS exige hors 127.0.0.1 / localhost.
# Sortie : "SMOKE : X OK, Y KO" ; code 1 si un controle echoue.
# Usage : powershell -ExecutionPolicy Bypass -File .\scripts\preprod-smoke.ps1 -BaseUrl https://api.preprod.exemple/api/v1
# =============================================================================
param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [int]$ExportTimeoutSeconds = 180,
    [string]$MigrationsDir = ""
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api = Join-Path $root "apps/api"
if (-not $MigrationsDir) { $MigrationsDir = Join-Path $api "prisma/migrations" }
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  SMOKE OK - $Label" } else { $script:ko++; Write-Host "  SMOKE KO - $Label" }
}
function Finish() { Write-Host "SMOKE : $($script:ok) OK, $($script:ko) KO"; if ($script:ko -gt 0) { exit 1 }; exit 0 }

$BaseUrl = $BaseUrl.TrimEnd("/")
$u = [Uri]$BaseUrl
$isLocal = $u.Host -in @("127.0.0.1", "localhost")
Write-Host "CIBLE $($u.Scheme)://$($u.Authority)$($u.AbsolutePath)"
Check ($u.Scheme -eq "https" -or $isLocal) "S0: HTTPS (ou boucle locale de validation)"
if ($u.Scheme -ne "https" -and -not $isLocal) { Finish }

function Call([string]$Method, [string]$Path, [string]$Token, $Body = $null) {
    $h = @{}; if ($Token) { $h.Authorization = "Bearer $Token" }
    $p = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $h; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($null -ne $Body) { $p.ContentType = "application/json"; $p.Body = ($Body | ConvertTo-Json -Depth 5) }
    try {
        $r = Invoke-WebRequest @p
        return [pscustomobject]@{ StatusCode = [int]$r.StatusCode; Content = $r.Content; Raw = $r.RawContentStream; Headers = $r.Headers }
    } catch {
        $resp = $_.Exception.Response; $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
        return [pscustomobject]@{ StatusCode = $code; Content = ""; Raw = $null; Headers = @{} }
    }
}
function JsonOf($r) { try { return ($r.Content | ConvertFrom-Json) } catch { return $null } }
function Totp([string]$Secret) {
    $env:ORYA_SMOKE_TOTP = $Secret
    Push-Location $api
    try { return (& node -e "const {authenticator}=require('otplib');process.stdout.write(authenticator.generate(process.env.ORYA_SMOKE_TOTP))").Trim() }
    finally { Pop-Location; Remove-Item Env:ORYA_SMOKE_TOTP -ErrorAction SilentlyContinue }
}
function Login([string]$Prefix) {
    $email = [Environment]::GetEnvironmentVariable("ORYA_SMOKE_${Prefix}_EMAIL")
    $pw = [Environment]::GetEnvironmentVariable("ORYA_SMOKE_${Prefix}_PASSWORD")
    $totp = [Environment]::GetEnvironmentVariable("ORYA_SMOKE_${Prefix}_TOTP_SECRET")
    if (-not $email -or -not $pw) { return [pscustomobject]@{ Ok = $false; Why = "ORYA_SMOKE_${Prefix}_EMAIL / _PASSWORD absentes" } }
    $r = Call POST "/auth/login" "" @{ email = $email; password = $pw }
    $j = JsonOf $r
    if ($r.StatusCode -ne 200 -or -not $j) { return [pscustomobject]@{ Ok = $false; Why = "connexion refusee ($($r.StatusCode))" } }
    if ($j.mfaRequired) {
        if ($j.method -ne "verify" -and $j.method -ne "totp") { return [pscustomobject]@{ Ok = $false; Why = "MFA a enroler : compte de fumee non pret" } }
        if (-not $totp) { return [pscustomobject]@{ Ok = $false; Why = "MFA requise : ORYA_SMOKE_${Prefix}_TOTP_SECRET absente" } }
        $v = Call POST "/auth/mfa/verify" "" @{ challengeToken = $j.challengeToken; code = (Totp $totp) }
        $j = JsonOf $v
        if ($v.StatusCode -ne 200 -or -not $j.accessToken) { return [pscustomobject]@{ Ok = $false; Why = "MFA refusee ($($v.StatusCode))" } }
    }
    return [pscustomobject]@{ Ok = [bool]$j.accessToken; Why = ""; Token = $j.accessToken; Refresh = $j.refreshToken; Email = $email; Password = $pw }
}

# ---- 1. Sante et migrations ----
$h = Call GET "/health" ""
$hj = JsonOf $h
Check ($h.StatusCode -eq 200 -and $hj.status -eq "ok" -and $hj.database -eq "ok") "S1: /health 200, base ok"
[string[]]$names = @(Get-ChildItem -Directory $MigrationsDir | ForEach-Object { $_.Name })
[Array]::Sort($names, [StringComparer]::Ordinal)  # meme ordre que ORDER BY migration_name (horodatage en tete)
$md5 = [Security.Cryptography.MD5]::Create()
$expected = (-join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes(($names -join ","))) | ForEach-Object { $_.ToString("x2") })).Substring(0, 12)
$m = $hj.migrations
$mOk = ($m -and $m -ne "inconnu" -and [int]$m.applied -eq $names.Count -and [int]$m.pending -eq 0 -and $m.digest -eq $expected)
$mInfo = if ($m -and $m -ne "inconnu") { "$($m.applied) appliquees, $($m.pending) en cours, empreinte $($m.digest)" } else { "etat inconnu" }
Check $mOk "S1: migrations appliquees = commit deploye ($mInfo ; attendu $($names.Count), $expected)"

# ---- 2. Connexion ----
$ex = Login "EXPORT"
Check $ex.Ok "S2: connexion du compte de fumee export $(if(-not $ex.Ok){'- ' + $ex.Why})"
if ($ex.Ok) {
    $me = Call GET "/me" $ex.Token
    Check ($me.StatusCode -eq 200) "S2: /me 200 avec le jeton"
    Check ((Call GET "/me" "").StatusCode -eq 401) "S2: /me sans jeton -> 401"

    # ---- 3. Export de donnees ----
    $rq = Call POST "/me/data-export" $ex.Token @{}
    $rqj = JsonOf $rq
    Check ($rq.StatusCode -eq 202 -and $rqj.id) "S3: demande d'export (202)"
    $ready = $null
    $deadline = (Get-Date).AddSeconds($ExportTimeoutSeconds)
    while ($rqj.id -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        $it = @((JsonOf (Call GET "/me/data-export" $ex.Token)).items) | Where-Object { $_.id -eq $rqj.id }
        if ($it -and $it.status -eq "ready") { $ready = $it; break }
        if ($it -and $it.status -eq "failed") { break }
    }
    Check ($null -ne $ready) "S3: export pret en moins de $ExportTimeoutSeconds s"
    if ($ready) {
        $dj = Call GET "/me/data-export/$($rqj.id)/json" $ex.Token
        $jsonOk = $false
        if ($dj.StatusCode -eq 200) { $jsonOk = $dj.Content.ToLowerInvariant().Contains($ex.Email.ToLowerInvariant()) }
        elseif ($dj.StatusCode -eq 302 -or $dj.StatusCode -eq 307) { $jsonOk = $true }
        Check $jsonOk "S3: telechargement JSON ($($dj.StatusCode)) contenant le compte"
        $dp = Call GET "/me/data-export/$($rqj.id)/pdf" $ex.Token
        $pdfOk = $false
        if ($dp.StatusCode -eq 200 -and $dp.Raw) { $b = New-Object byte[] 4; $dp.Raw.Position = 0; [void]$dp.Raw.Read($b, 0, 4); $pdfOk = ([Text.Encoding]::ASCII.GetString($b) -eq "%PDF") }
        Check $pdfOk "S3: telechargement PDF ($($dp.StatusCode), %PDF)"
    }
    $lo = Call POST "/auth/logout" $ex.Token @{}
    Check ($lo.StatusCode -in 200, 201, 204) "S5: deconnexion ($($lo.StatusCode))"
    if ($ex.Refresh) { Check ((Call POST "/auth/refresh" "" @{ refreshToken = $ex.Refresh }).StatusCode -eq 401) "S5: jeton de rafraichissement revoque apres deconnexion (401)" }
}

# ---- 4. Suppression de compte (compte de fumee CONSOMME : desactive tout de suite, anonymise a J+14) ----
$de = Login "DELETE"
Check $de.Ok "S4: connexion du compte de fumee suppression $(if(-not $de.Ok){'- ' + $de.Why})"
if ($de.Ok) {
    $bad = Call POST "/me/deletion" $de.Token @{ password = ("x" + $de.Password + "x") }
    Check ($bad.StatusCode -ge 400 -and $bad.StatusCode -lt 500) "S4: demande de suppression avec mauvais mot de passe refusee ($($bad.StatusCode))"
    Check ((Call GET "/me" $de.Token).StatusCode -eq 200) "S4: compte encore actif apres le refus"
    $rd = Call POST "/me/deletion" $de.Token @{ password = $de.Password }
    $rdj = JsonOf $rd
    Check ($rd.StatusCode -eq 202 -and $rdj.status -eq "pending" -and $rdj.effectiveAt) "S4: demande de suppression (202, pending, date d'effet)"
    Check ((Call GET "/me" $de.Token).StatusCode -eq 401) "S4: session revoquee immediatement (/me 401)"
    if ($de.Refresh) { Check ((Call POST "/auth/refresh" "" @{ refreshToken = $de.Refresh }).StatusCode -eq 401) "S4: jeton de rafraichissement revoque (401)" }
    $again = Call POST "/auth/login" "" @{ email = $de.Email; password = $de.Password }
    Check ($again.StatusCode -ge 400 -and $again.StatusCode -lt 500) "S4: nouvelle connexion refusee pendant le delai ($($again.StatusCode))"
}
Finish
