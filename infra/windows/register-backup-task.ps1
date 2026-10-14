#Requires -Version 7.2
# Registers (or removes) a daily Windows Task Scheduler job that runs run-backup-task.ps1 -> backup.ps1 -Scheduled.
# -DryRun or -WhatIf prints the plan without touching the Task Scheduler; otherwise the task is registered for the current user.
[CmdletBinding(SupportsShouldProcess,DefaultParameterSetName='Register')]
param(
    [Parameter(Mandatory,ParameterSetName='Register')][string]$EnvironmentFile,
    [Parameter(Mandatory,ParameterSetName='Register')][string]$Destination,
    [Parameter(Mandatory,ParameterSetName='Register')][string]$PassphraseFile,
    [Parameter(ParameterSetName='Register')][string]$OffsiteDirectory,
    [Parameter(ParameterSetName='Register')][string]$LogDirectory,
    [Parameter(ParameterSetName='Register')][string]$ProjectName = 'mentor-platform',
    [Parameter(ParameterSetName='Register')][ValidatePattern('^[0-9]{2}:[0-9]{2}$')][string]$StartTime = '03:15',
    [Parameter(ParameterSetName='Register')][ValidateSet('Interactive','S4U')][string]$LogonType = 'Interactive',
    [Parameter(ParameterSetName='Register')][string]$PwshPath,
    [Parameter(Mandatory,ParameterSetName='Unregister')][switch]$Unregister,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 _.-]{0,120}$')][string]$TaskName = 'MentorPlatformBackup',
    [switch]$DryRun
)
. (Join-Path $PSScriptRoot 'backup-task-common.ps1')
if (-not $IsWindows) { throw 'Task Scheduler registration is Windows-only; on Linux use infra/systemd/mentor-backup.service and .timer.' }
if ($Unregister) {
    if ($DryRun -or -not $PSCmdlet.ShouldProcess($TaskName,'Unregister scheduled backup task')) { Write-Output "Dry-run: would unregister scheduled task '$TaskName'. Nothing changed."; return }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Unregistered scheduled task '$TaskName'. Existing backups, logs and alert markers were not touched."
    return
}
if (-not $OffsiteDirectory) {
    throw 'Scheduled backups require -OffsiteDirectory: an absolute path to storage that lives on another host (a mounted share or a disk that is synced away from this machine). backup.ps1 -Scheduled refuses to run without it, because a copy that shares the disk with the live data does not survive the loss of this machine.'
}
foreach ($path in @($EnvironmentFile,$Destination,$PassphraseFile,$OffsiteDirectory)) {
    if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Environment, destination, passphrase and offsite paths must be absolute.' }
}
if ($LogDirectory -and -not [IO.Path]::IsPathFullyQualified($LogDirectory)) { throw 'LogDirectory must be absolute.' }
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') { throw 'Invalid Compose project name.' }
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw 'The platform environment file does not exist; initialize the platform first.' }
Test-MentorPassphraseFile $PassphraseFile
$at = [DateTime]::ParseExact($StartTime,'HH:mm',[cultureinfo]::InvariantCulture)
if (-not $PwshPath) { $PwshPath = (Get-Process -Id $PID).Path }
if (-not (Test-Path -LiteralPath $PwshPath -PathType Leaf) -or (Split-Path -Leaf $PwshPath) -ne 'pwsh.exe') { throw 'PwshPath must point to an existing PowerShell 7 pwsh.exe (the Task Scheduler cannot use Windows PowerShell 5.1 for these scripts).' }
if (-not $LogDirectory) { $LogDirectory = Join-Path $Destination 'task-logs' }
$wrapper = Join-Path $PSScriptRoot 'run-backup-task.ps1'
if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw 'run-backup-task.ps1 is missing next to this script.' }
function Format-MentorTaskArgument([string]$Value) {
    if ($Value -match '["\r\n\x00]') { throw 'Task Scheduler arguments must not contain quotes or control characters.' }
    return '"' + $Value + '"'
}
$arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Format-MentorTaskArgument $wrapper),
    '-EnvironmentFile',(Format-MentorTaskArgument $EnvironmentFile),'-Destination',(Format-MentorTaskArgument $Destination),
    '-OffsiteDirectory',(Format-MentorTaskArgument $OffsiteDirectory),'-PassphraseFile',(Format-MentorTaskArgument $PassphraseFile),
    '-LogDirectory',(Format-MentorTaskArgument $LogDirectory),'-ProjectName',$ProjectName) -join ' '
$user = $env:USERDOMAIN + '\' + $env:USERNAME
@(
    "Scheduled task plan '$TaskName':",
    "  trigger: daily at $($at.ToString('HH:mm')) (local time), start when missed, one instance, 2 h limit",
    "  principal: $user, logon type $LogonType$(if ($LogonType -eq 'Interactive') { ' (runs only while this user is logged on; WSL/Docker Desktop need the user session)' } else { ' (no stored password; verify that wsl.exe and Docker Desktop are reachable without an interactive session)' })",
    "  program: $PwshPath",
    "  arguments: $arguments",
    "  log directory: $LogDirectory (backup-<utc>.log, last-run.json, ALERT-<utc>.json)",
    "  alert: marker file in the log directory and Windows Event Log 'Application', source '$MentorBackupEventSource', event $MentorBackupEventId",
    "  backup.ps1 runs with -Scheduled: verified offsite copy, isolated restore check, 14-day retention of completed copies"
) | Write-Output
if ($DryRun -or -not $PSCmdlet.ShouldProcess($TaskName,'Register scheduled backup task')) { Write-Output 'Dry-run: nothing was registered.'; return }
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$action = New-ScheduledTaskAction -Execute $PwshPath -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType $LogonType -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Daily encrypted Mentor platform backup with offsite copy and restore verification (infra/windows/run-backup-task.ps1).' -Force | Out-Null
try {
    if (-not [Diagnostics.EventLog]::SourceExists($MentorBackupEventSource)) { [Diagnostics.EventLog]::CreateEventSource($MentorBackupEventSource,'Application') }
} catch {
    Write-Warning "Event Log source '$MentorBackupEventSource' is not registered (run this script once from an elevated PowerShell to create it). Alerts still write the marker file and fall back to eventcreate.exe."
}
Write-Output "Registered scheduled task '$TaskName'. First check: Start-ScheduledTask -TaskName '$TaskName', then read $LogDirectory\last-run.json."
