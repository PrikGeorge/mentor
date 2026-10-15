#Requires -Version 7.2
[CmdletBinding()]
param(
    [string]$EnvironmentFile = (Join-Path $PSScriptRoot '../.runtime/platform/compose.env'),
    [string]$ProjectName = 'mentor-platform',
    [ValidateRange(30,1800)][int]$ReadyTimeoutSeconds = 300
)
. (Join-Path $PSScriptRoot 'platform-common.ps1')
$EnvironmentFile = [IO.Path]::GetFullPath($EnvironmentFile)
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw 'Platform configuration is missing. Follow docs/operations/java-angular.md; existing legacy data is never imported automatically on startup.' }
$context = New-MentorPlatformContext $EnvironmentFile $ProjectName
# Parse locally without printing expanded deployment configuration or secret paths.
$configuration = ((Invoke-MentorCompose $context @('config','--format','json')) -join "`n") | ConvertFrom-Json
$originText = [string]$configuration.services.backend.environment.MENTOR_PUBLIC_ORIGIN
$origin = [Uri]$originText
$production = $configuration.services.backend.environment.MENTOR_PRODUCTION -eq 'true'
if (-not $origin.IsAbsoluteUri -or $origin.UserInfo -or $origin.Query -or $origin.Fragment -or $originText -ne $origin.GetLeftPart([UriPartial]::Authority) -or $origin.Scheme -notin @('http','https')) { throw 'Configure an exact public origin without a trailing slash.' }
if ($production -and $origin.Scheme -ne 'https') { throw 'Public deployment requires HTTPS.' }
if (-not $production) {
    if ($origin.Host -notin @('localhost','127.0.0.1','[::1]')) { throw 'Local HTTP mode requires a loopback origin.' }
    foreach ($port in $configuration.services.web.ports) {
        if ($port.host_ip -notin @('127.0.0.1','::1')) { throw 'Local HTTP mode must publish only on loopback.' }
    }
}
$lock = [IO.File]::Open((Join-Path (Split-Path -Parent $EnvironmentFile) ($ProjectName + '.maintenance.lock')),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    # The launcher consumes prebuilt images: no Node.js or Python runtime needed.
    # `up` itself blocks until backend is healthy because web depends on it with condition: service_healthy;
    # an unhealthy backend makes `up` fail instead of leaving a half-started platform behind.
    Invoke-MentorCompose $context @('up','--detach','--no-build','postgres','backend','web') | Out-Null
    $backendHealth = Wait-MentorServiceHealthy $context 'backend' $ReadyTimeoutSeconds
    $webHealth = Wait-MentorServiceHealthy $context 'web' 90
    if ($backendHealth -eq 'none' -or $webHealth -eq 'none') { Write-Warning 'A service has no healthcheck; readiness relies on the HTTP probe below only.' }
    # One static request through the published port proves the edge; it never touches the rate-limited auth endpoint.
    $authority = $origin.GetLeftPart([UriPartial]::Authority)
    $ready=$false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri ($authority + '/') -SkipHttpErrorCheck -TimeoutSec 5
            if ($response.StatusCode -eq 200) { $ready=$true; break }
        } catch { }
        Start-Sleep -Milliseconds 1000
    }
    if (-not $ready) { throw 'Platform containers are healthy but the public address does not answer. Check the published port, firewall and MENTOR_PUBLIC_ORIGIN; no legacy rollback has been performed.' }
    Write-Output ('Platform ready: ' + $authority)
} finally { $lock.Dispose() }
