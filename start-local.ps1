#Requires -Version 7.2
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [string]$EnvironmentFile = (Join-Path $PSScriptRoot '.runtime/platform/compose.env'),
    [string]$ProjectName = 'mentor-platform'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
    . (Join-Path $PSScriptRoot 'infra/platform-common.ps1')
    $EnvironmentFile = [IO.Path]::GetFullPath($EnvironmentFile)
    # The platform launcher owns the maintenance lock and readiness check.
    # Opening the desktop shortcut never imports legacy files.
    & (Join-Path $PSScriptRoot 'infra/start-platform.ps1') -EnvironmentFile $EnvironmentFile -ProjectName $ProjectName
    $context = New-MentorPlatformContext $EnvironmentFile $ProjectName
    $configuration = ((Invoke-MentorCompose $context @('config','--format','json')) -join "`n") | ConvertFrom-Json
    $origin = [Uri][string]$configuration.services.backend.environment.MENTOR_PUBLIC_ORIGIN
    if (-not $origin.IsAbsoluteUri -or $origin.Scheme -notin @('http','https') -or $origin.UserInfo -or $origin.Query -or $origin.Fragment) {
        throw 'Некорректный адрес кабинета в настройках платформы.'
    }
    $url = $origin.GetLeftPart([UriPartial]::Authority) + '/'
    Write-Output "Кабинет готов: $url"
    if (-not $NoBrowser) { Start-Process -FilePath $url }
    exit 0
} catch {
    $message = 'Не удалось открыть кабинет. ' + $_.Exception.Message
    [Console]::Error.WriteLine($message)
    if (-not $NoBrowser -and $IsWindows) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show($message,'Кабинет наставника',
                [System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error)
        } catch { }
    }
    exit 1
}
