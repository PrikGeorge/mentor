#Requires -Version 7.2
[CmdletBinding()]
param(
    [string]$EnvironmentFile = (Join-Path $PSScriptRoot '../.runtime/platform/compose.env'),
    [string]$ProjectName = 'mentor-platform'
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
    Invoke-MentorCompose $context @('up','--detach','--no-build','postgres','backend','web') | Out-Null
    $ready=$false
    for ($attempt=0; $attempt -lt 120; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri ($origin.GetLeftPart([UriPartial]::Authority) + '/api/v1/auth/session') -SkipHttpErrorCheck -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready=$true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Platform is not ready. Inspect backend/PostgreSQL logs; no legacy rollback has been performed.' }
    Write-Output ('Platform ready: ' + $origin.GetLeftPart([UriPartial]::Authority))
} finally { $lock.Dispose() }
