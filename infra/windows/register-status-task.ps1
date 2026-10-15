#Requires -Version 7.2
# Registers (or removes) a Windows Task Scheduler job that runs run-status-task.ps1 every -IntervalMinutes.
# -DryRun or -WhatIf prints the plan without touching the Task Scheduler. On Linux use a systemd timer instead
# (same wrapper, see docs/operations/java-angular.md, section on monitoring).
[CmdletBinding(SupportsShouldProcess,DefaultParameterSetName='Register')]
param(
    [Parameter(Mandatory,ParameterSetName='Register')][string]$EnvironmentFile,
    [Parameter(Mandatory,ParameterSetName='Register')][string]$LogDirectory,
    [Parameter(ParameterSetName='Register')][string]$ProjectName = 'mentor-platform',
    [Parameter(ParameterSetName='Register')][ValidateRange(1,1440)][int]$IntervalMinutes = 10,
    [Parameter(ParameterSetName='Register')][ValidateRange(1,1440)][int]$WorkerUnavailableMinutes = 15,
    [Parameter(ParameterSetName='Register')][ValidateRange(0,10000)][double]$MinFreeGB = 10,
    [Parameter(ParameterSetName='Register')][ValidateRange(1,10080)][int]$RepeatMinutes = 60,
    [Parameter(ParameterSetName='Register')][string]$TelegramTokenFile,
    [Parameter(ParameterSetName='Register')][string]$TelegramChatId,
    [Parameter(ParameterSetName='Register')][switch]$NoNotify,
    [Parameter(ParameterSetName='Register')][ValidateSet('Interactive','S4U')][string]$LogonType = 'Interactive',
    [Parameter(ParameterSetName='Register')][string]$PwshPath,
    [Parameter(Mandatory,ParameterSetName='Unregister')][switch]$Unregister,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 _.-]{0,120}$')][string]$TaskName = 'MentorPlatformStatus',
    [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Task Scheduler registration is Windows-only; on Linux schedule infra/windows/run-status-task.ps1 with a systemd timer.' }
if ($Unregister) {
    if ($DryRun -or -not $PSCmdlet.ShouldProcess($TaskName,'Unregister scheduled status task')) { Write-Output "Dry-run: would unregister scheduled task '$TaskName'. Nothing changed."; return }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Unregistered scheduled task '$TaskName'. Logs and state files were not touched."
    return
}
foreach ($path in @($EnvironmentFile,$LogDirectory)) { if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Environment and log paths must be absolute.' } }
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') { throw 'Invalid Compose project name.' }
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw 'The platform environment file does not exist; initialize the platform first.' }
if (-not $NoNotify) {
    if (-not $TelegramTokenFile -or -not $TelegramChatId) { throw 'Alerts need -TelegramTokenFile (absolute path to a private file with the bot token) and -TelegramChatId, or -NoNotify to only write status-last-run.json and the exit code.' }
    if (-not [IO.Path]::IsPathFullyQualified($TelegramTokenFile) -or -not (Test-Path -LiteralPath $TelegramTokenFile -PathType Leaf)) { throw 'TelegramTokenFile must be an existing absolute file.' }
    if ($TelegramChatId -notmatch '^-?[0-9]{1,20}$') { throw 'TelegramChatId must be numeric.' }
}
if (-not $PwshPath) { $PwshPath = (Get-Process -Id $PID).Path }
if (-not (Test-Path -LiteralPath $PwshPath -PathType Leaf) -or (Split-Path -Leaf $PwshPath) -ne 'pwsh.exe') { throw 'PwshPath must point to an existing PowerShell 7 pwsh.exe.' }
$wrapper = Join-Path $PSScriptRoot 'run-status-task.ps1'
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw 'run-status-task.ps1 is missing next to this script.' }
function Format-MentorTaskArgument([string]$Value) {
    if ($Value -match '["\r\n\x00]') { throw 'Task Scheduler arguments must not contain quotes or control characters.' }
    return '"' + $Value + '"'
}
$argumentList = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Format-MentorTaskArgument $wrapper),
    '-EnvironmentFile',(Format-MentorTaskArgument $EnvironmentFile),'-LogDirectory',(Format-MentorTaskArgument $LogDirectory),'-ProjectName',$ProjectName,
    '-WorkerUnavailableMinutes',$WorkerUnavailableMinutes,'-MinFreeGB',$MinFreeGB.ToString([cultureinfo]::InvariantCulture),'-RepeatMinutes',$RepeatMinutes)
if ($NoNotify) { $argumentList += '-NoNotify' } else { $argumentList += @('-TelegramTokenFile',(Format-MentorTaskArgument $TelegramTokenFile),'-TelegramChatId',$TelegramChatId) }
$arguments = $argumentList -join ' '
$user = $env:USERDOMAIN + '\' + $env:USERNAME
@(
    "Scheduled task plan '$TaskName':",
    "  trigger: every $IntervalMinutes min, starting one minute after registration; one instance, 5 min limit",
    "  principal: $user, logon type $LogonType$(if ($LogonType -eq 'Interactive') { ' (runs only while this user is logged on; WSL/Docker Desktop need the user session)' } else { ' (no stored password; verify that wsl.exe and Docker Desktop are reachable without an interactive session)' })",
    "  program: $PwshPath",
    "  arguments: $arguments",
    "  log directory: $LogDirectory (status-last-run.json, status-state.json, status-<date>.log)",
    "  alerts: $(if ($NoNotify) { 'disabled (-NoNotify); exit code 1 and status-last-run.json only' } else { 'Telegram chat ' + $TelegramChatId + ', token from file, repeated every ' + $RepeatMinutes + ' min while unchanged, recovery message when clear' })",
    "  rules: ready=false; worker unavailable >= $WorkerUnavailableMinutes min; free disk < $MinFreeGB GB; gateway certificate warnings"
) | Write-Output
if ($DryRun -or -not $PSCmdlet.ShouldProcess($TaskName,'Register scheduled status task')) { Write-Output 'Dry-run: nothing was registered.'; return }
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$action = New-ScheduledTaskAction -Execute $PwshPath -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType $LogonType -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Mentor platform status check with alerts (infra/windows/run-status-task.ps1).' -Force | Out-Null
Write-Output "Registered scheduled task '$TaskName'. First check: Start-ScheduledTask -TaskName '$TaskName', then read $LogDirectory\status-last-run.json."
