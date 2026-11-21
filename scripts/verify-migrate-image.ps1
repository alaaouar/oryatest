# =============================================================================
# ORYA - reconstruit LOCALEMENT orya-api-migrate:<sha12> et verifie que l'outil
#   create-super-admin est present et refuse correctement (sans creer de compte
#   sur une base reelle). Conteneur Jetable orya-test-fd uniquement.
#   Aucun docker push. Mot de passe jamais affiche.
# =============================================================================
param()
$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api = Join-Path $root "apps/api"
$sha = (git -C $root rev-parse --short=12 HEAD).Trim()
$tag = "orya-api-migrate:$sha"
$script:ok = 0; $script:ko = 0
function Check([bool]$Cond, [string]$Label) {
    if ($Cond) { $script:ok++; Write-Host "  MIG OK - $Label" } else { $script:ko++; Write-Host "  MIG KO - $Label" -ForegroundColor Red }
}
$env:ORYA_TEST_CONTAINER = "orya-test-fd"
$env:ORYA_TEST_PORT = "55434"
Remove-Item Env:ORYA_TEST_DB -ErrorAction SilentlyContinue

try {
    Write-Host "=== Build local $tag (aucun push) ===" -ForegroundColor Cyan
    $p = Start-Process -FilePath "docker" -ArgumentList @("build","-f","deploy/Dockerfile.api","--target","migrate","-t",$tag,".") -WorkingDirectory $root -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\orya_mig_build.out" -RedirectStandardError "$env:TEMP\orya_mig_build.err"
    Check ($p.ExitCode -eq 0) "image $tag construite localement"
    if ($p.ExitCode -ne 0) { Get-Content "$env:TEMP\orya_mig_build.err" -ErrorAction SilentlyContinue | Select-Object -Last 20; throw "build echoue" }

    $ls = & docker run --rm --entrypoint sh $tag -c "ls /app/migrate && test -f /app/migrate/create-super-admin.js && echo HAS_TOOL"
    Check (($ls -join "`n") -match "HAS_TOOL") "create-super-admin.js present dans l'image migrate"

    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts/test-pg-up.ps1")
    if ($LASTEXITCODE -ne 0) { throw "orya-test-fd indisponible" }
    . (Join-Path $root "scripts/test-guard.ps1")
    $T = Get-OryaTestTarget -DefaultDb "orya_mig"
    $c = $T.Container; $db = $T.Db; $adm = $T.DbUser
    function Psql([string]$Db, [string]$Sql) { $Sql | & docker exec -i $c psql -U $adm -d $Db -v ON_ERROR_STOP=1 -q -At 2>&1 }
    $null = Psql "postgres" "CREATE DATABASE $db;"
    $null = Get-Content -Raw (Join-Path $api "prisma/sql/000_roles.sql") | & docker exec -i $c psql -U $adm -d $db -v ON_ERROR_STOP=1 -q 2>&1
    $ownerPw = (& node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))").Trim()
    $appPw = (& node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))").Trim()
    $null = Psql $db "ALTER DATABASE $db OWNER TO orya_owner; ALTER SCHEMA public OWNER TO orya_owner; ALTER ROLE orya_owner PASSWORD '$ownerPw'; ALTER ROLE orya_app PASSWORD '$appPw';"
    $direct = "postgresql://orya_owner:${ownerPw}@host.docker.internal:$($T.Port)/${db}?schema=public"
    # Run migrate deploy from image against the test DB
    $netHost = "host.docker.internal"
    $envFile = Join-Path $env:TEMP "orya_mig_env_$([guid]::NewGuid().ToString('N').Substring(0,8)).env"
    # Write env without echoing secrets to console; delete after
    @(
        "DIRECT_DATABASE_URL=$direct"
        "DATABASE_URL=postgresql://orya_app:${appPw}@${netHost}:$($T.Port)/${db}?schema=public"
        "APPLY_ROLES=0"
    ) | Set-Content -Path $envFile -Encoding ASCII
    try {
        $m = Start-Process -FilePath "docker" -ArgumentList @("run","--rm","--env-file",$envFile,"--add-host","host.docker.internal:host-gateway",$tag) -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\orya_mig_run.out" -RedirectStandardError "$env:TEMP\orya_mig_run.err"
        Check ($m.ExitCode -eq 0) "job migrate de l'image applique sur base jetable (APPLY_ROLES=0)"
        # Refusal: password as arg must exit 2
        $r = Start-Process -FilePath "docker" -ArgumentList @("run","--rm","--env-file",$envFile,"--add-host","host.docker.internal:host-gateway","--entrypoint","node",$tag,"migrate/create-super-admin.js","--email=fondateur@orya.test","--password=Bad") -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\orya_mig_ref.out" -RedirectStandardError "$env:TEMP\orya_mig_ref.err"
        $refOut = ((Get-Content "$env:TEMP\orya_mig_ref.out" -Raw -EA SilentlyContinue) + (Get-Content "$env:TEMP\orya_mig_ref.err" -Raw -EA SilentlyContinue))
        Check ($r.ExitCode -eq 2 -and $refOut -match "aucun mot de passe en parametre") "image : mot de passe en parametre refuse (code 2)"
        # Create via stdin tube (ORYA_BOOTSTRAP_STDIN=1). Mot de passe genere ici, jamais journalise.
        $pwBytes = New-Object byte[] 8
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($pwBytes)
        $pw = "Mg-" + (-join ($pwBytes | ForEach-Object { $_.ToString("x2") })) + "-Zq9!"
        function Invoke-Bootstrap([string]$Email) {
            $argsList = @(
                "run","--rm","-i",
                "--env-file",$envFile,
                "-e","ORYA_BOOTSTRAP_STDIN=1",
                "--add-host","host.docker.internal:host-gateway",
                "--entrypoint","node",$tag,
                "migrate/create-super-admin.js",
                "--email=$Email",
                "--name=Fondateur image"
            )
            $out = ($pw + "
" + $pw + "
") | & docker @argsList 2>&1 | Out-String
            return @{ Code = $LASTEXITCODE; Out = $out }
        }
        $c1 = Invoke-Bootstrap "fondateur@orya.test"
        Check ($c1.Code -eq 0 -and $c1.Out -match "cree") "image : super-admin cree via saisie tube (test mode)"
        Check ($c1.Out -notmatch [regex]::Escape($pw)) "image : mot de passe absent de la sortie"
        $c2 = Invoke-Bootstrap "autre@orya.test"
        Check ($c2.Code -eq 3 -and $c2.Out -match "existe deja") "image : second super-admin refuse (code 3)"
        Remove-Variable pw,pwBytes -ErrorAction SilentlyContinue
        $cnt = Psql $db 'SELECT count(*) FROM "UserProfile" WHERE role=''super_admin'';'
        Check ($cnt -eq "1") "un seul super_admin en base apres les essais"
    }
    finally {
        Remove-Item $envFile -Force -ErrorAction SilentlyContinue
    }
}
catch {
    $script:ko++
    Write-Host "  MIG KO - $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts/test-pg-down.ps1")
    Remove-Item Env:ORYA_TEST_CONTAINER, Env:ORYA_TEST_PORT -ErrorAction SilentlyContinue
}
Write-Host "MIGRATE-IMAGE : $($script:ok) OK, $($script:ko) KO"
if ($script:ko -gt 0) { exit 1 }
exit 0
