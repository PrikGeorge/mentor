#Requires -Version 7.2
# Scheduled wrapper: runs backup.ps1 -Scheduled with a transcript, then verifies the outcome and raises
# an alert (marker file + Windows Event Log) when failed.json appears or no fresh verified receipt exists.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvironmentFile,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$OffsiteDirectory,
    [Parameter(Mandatory)][string]$PassphraseFile,
    [Parameter(Mandatory)][string]$LogDirectory,
    [string]$ProjectName = 'mentor-platform',
    [ValidateRange(1,3650)][int]$KeepLogDays = 90,
    [switch]$NoEventLog
)
. (Join-Path $PSScriptRoot 'backup-task-common.ps1')
foreach ($path in @($EnvironmentFile,$Destination,$OffsiteDirectory,$PassphraseFile,$LogDirectory)) {
    if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'All scheduled backup paths must be absolute.' }
}
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$startedAt = [DateTimeOffset]::UtcNow
$log = Join-Path $LogDirectory ('backup-' + $startedAt.ToString('yyyyMMddTHHmmssZ') + '.log')
$succeeded = $false; $errorMessage = $null
function Write-MentorTaskLog([string]$Line) {
    # Every stream of backup.ps1 is appended here explicitly; a transcript would lock the file instead.
    try { Add-Content -LiteralPath $log -Value ([DateTime]::UtcNow.ToString('o') + ' ' + $Line) -Encoding utf8 } catch { }
    Write-Output $Line
}
try {
    Write-MentorTaskLog ("Scheduled Mentor backup started " + $startedAt.ToString('o') + " for project '$ProjectName'.")
    & (Join-Path $PSScriptRoot '../backup.ps1') -Destination $Destination -EnvironmentFile $EnvironmentFile -OffsiteDirectory $OffsiteDirectory -PassphraseFile $PassphraseFile -ProjectName $ProjectName -Scheduled *>&1 | ForEach-Object { Write-MentorTaskLog ([string]$_) }
    $succeeded = $true
} catch {
    $errorMessage = $_.Exception.Message
    Write-MentorTaskLog ('backup.ps1 failed: ' + $errorMessage)
}
$outcome = Test-MentorBackupOutcome $Destination $startedAt $succeeded
$summary = [ordered]@{ startedAt=$startedAt.ToString('o'); finishedAt=[DateTime]::UtcNow.ToString('o'); ok=$outcome.ok; reason=$outcome.reason; error=$errorMessage; backup=$outcome.backup; failedMarkers=$outcome.failedMarkers; log=$log; project=$ProjectName }
$alert = $null
if (-not $outcome.ok) {
    $message = "Mentor platform backup FAILED for project '$ProjectName': $($outcome.reason). " + $(if ($errorMessage) { "Error: $errorMessage. " } else { '' }) + "Log: $log"
    $alert = Write-MentorBackupAlert $LogDirectory $message -NoEventLog:$NoEventLog
    $summary.alert = $alert
} else {
    $summary.alert = $null
    if (-not $NoEventLog) { Write-MentorBackupEvent "Mentor platform backup completed for project '$ProjectName': $($outcome.backup)" ([Diagnostics.EventLogEntryType]::Information) | Out-Null }
}
Write-MentorBackupRunSummary $LogDirectory $summary
# Keep the log directory bounded; alert markers are never removed automatically.
$cutoff = [DateTime]::UtcNow.AddDays(-$KeepLogDays)
foreach ($old in (Get-ChildItem -LiteralPath $LogDirectory -File -Filter 'backup-*.log' | Where-Object { $_.LastWriteTimeUtc -lt $cutoff })) { try { Remove-Item -LiteralPath $old.FullName } catch { } }
if (-not $outcome.ok) {
    Write-MentorTaskLog ("ALERT: " + $outcome.reason + ". Marker: " + $alert)
    exit 1
}
Write-MentorTaskLog ('Scheduled backup verified: ' + $outcome.backup)
exit 0
