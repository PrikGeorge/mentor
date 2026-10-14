# Shared by the Windows Task Scheduler registration and the scheduled backup wrapper.
# Operates on paths and receipts only; never reads the passphrase or compose.env contents.
. (Join-Path $PSScriptRoot '../platform-common.ps1')
$MentorBackupEventSource = 'MentorPlatformBackup'
$MentorBackupEventId = 1001

function Test-MentorBackupOutcome([string]$Destination,[DateTimeOffset]$StartedAt,[bool]$ScriptSucceeded) {
    # A run is healthy only when backup.ps1 exited cleanly AND left exactly one fresh completed receipt
    # (offsite copy verified, isolated restore verified) and no failed.json created by this run.
    $result = [ordered]@{ ok=$false; reason=$null; backup=$null; failedMarkers=@() }
    $threshold = $StartedAt.ToUniversalTime().AddMinutes(-1)
    $fresh = @(); $failed = @()
    if (Test-Path -LiteralPath $Destination -PathType Container) {
        foreach ($candidate in (Get-ChildItem -LiteralPath $Destination -Directory -Force)) {
            if ($candidate.Name -notmatch '^mentor-backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$') { continue }
            $failedPath = Join-Path $candidate.FullName 'failed.json'
            if ((Test-Path -LiteralPath $failedPath -PathType Leaf) -and ([DateTimeOffset](Get-Item -LiteralPath $failedPath).LastWriteTimeUtc) -ge $threshold) { $failed += $candidate.FullName; continue }
            $receiptPath = Join-Path $candidate.FullName 'receipt.json'
            if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { continue }
            try {
                $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
                if ($receipt.completed -ne $true -or (ConvertFrom-MentorReceiptDate $receipt.createdAt) -lt $threshold) { continue }
                $fresh += [pscustomobject]@{ path=$candidate.FullName; receipt=$receipt }
            } catch { continue }
        }
    }
    $result.failedMarkers = $failed
    if (-not $ScriptSucceeded) { $result.reason = 'backup.ps1 exited with an error' }
    elseif ($failed.Count -gt 0) { $result.reason = 'failed.json was written by this run' }
    elseif ($fresh.Count -ne 1) { $result.reason = "expected exactly one fresh completed receipt.json, found $($fresh.Count)" }
    elseif ($fresh[0].receipt.offsiteVerified -ne $true) { $result.reason = 'the fresh receipt has no verified offsite copy' }
    elseif ($fresh[0].receipt.restoreVerified -ne $true) { $result.reason = 'the fresh receipt has no verified isolated restore' }
    else { $result.ok = $true; $result.backup = $fresh[0].path }
    if ($fresh.Count -eq 1 -and -not $result.backup) { $result.backup = $fresh[0].path }
    return $result
}

function Write-MentorBackupEvent([string]$Message,[Diagnostics.EventLogEntryType]$EntryType) {
    if (-not $IsWindows) { return 'skipped' }
    try {
        [Diagnostics.EventLog]::WriteEntry($MentorBackupEventSource,$Message,$EntryType,$MentorBackupEventId)
        return 'eventlog'
    } catch {
        # An unregistered source needs elevation once; eventcreate.exe works for an ordinary user.
        try {
            $kind = if ($EntryType -eq [Diagnostics.EventLogEntryType]::Error) { 'ERROR' } elseif ($EntryType -eq [Diagnostics.EventLogEntryType]::Warning) { 'WARNING' } else { 'INFORMATION' }
            & eventcreate /L APPLICATION /SO $MentorBackupEventSource /T $kind /ID $MentorBackupEventId /D $Message | Out-Null
            if ($LASTEXITCODE -eq 0) { return 'eventcreate' }
        } catch { }
        return 'failed'
    }
}

function Write-MentorBackupAlert([string]$LogDirectory,[string]$Message,[switch]$NoEventLog) {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $now = [DateTimeOffset]::UtcNow
    $marker = Join-Path $LogDirectory ('ALERT-' + $now.ToString('yyyyMMddTHHmmssZ') + '.json')
    $channel = if ($NoEventLog) { 'disabled' } else { Write-MentorBackupEvent $Message ([Diagnostics.EventLogEntryType]::Error) }
    [ordered]@{ alert=$true; at=$now.ToString('o'); message=$Message; eventLog=$channel; source=$MentorBackupEventSource; eventId=$MentorBackupEventId } | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding utf8NoBOM
    return $marker
}

function Write-MentorBackupRunSummary([string]$LogDirectory,$Summary) {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $Summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $LogDirectory 'last-run.json') -Encoding utf8NoBOM
}
