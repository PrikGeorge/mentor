# Alert rules and delivery de-duplication for the scheduled status check (INF-16). Pure functions over the
# status-platform.ps1 JSON plus a small state object persisted between runs; no Docker, no network here.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-MentorFreeSpaceGB([string]$Path) {
    # Free space of the volume that holds $Path (drive letter on Windows, mount point on Linux).
    $full = [IO.Path]::GetFullPath($Path)
    $root = if ($IsWindows) { [IO.Path]::GetPathRoot($full) } else { $full }
    $drive = [IO.DriveInfo]::new($root)
    return [Math]::Round($drive.AvailableFreeSpace / 1GB,2)
}

function New-MentorStatusState() {
    return [ordered]@{ workerUnavailableSince=$null; lastAlertKey=$null; lastAlertAt=$null; lastStatusReady=$null }
}

function ConvertTo-MentorStatusState($Value) {
    $state = New-MentorStatusState
    if ($null -eq $Value) { return $state }
    foreach ($key in @($state.Keys)) {
        $property = $Value.PSObject.Properties[$key]
        if ($property) { $state[$key] = $property.Value }
    }
    return $state
}

function Get-MentorStatusAlerts {
    # Returns @{ alerts=string[]; state=ordered } for one observation. $Status is the parsed status JSON or $null
    # when status-platform.ps1 produced none; $DiskFree maps a path to free gigabytes.
    param($Status,[int]$StatusExitCode,$State,[DateTimeOffset]$Now,[int]$WorkerUnavailableMinutes = 15,[double]$MinFreeGB = 10,[hashtable]$DiskFree = @{},[string]$StatusError)
    $alerts = [Collections.Generic.List[string]]::new()
    $next = ConvertTo-MentorStatusState ([pscustomobject]$State)
    if ($null -eq $Status) {
        $alerts.Add('status-platform.ps1 produced no status' + $(if ($StatusError) { ": $StatusError" } else { " (exit $StatusExitCode)" }))
        $next.lastStatusReady = $false
    } else {
        $next.lastStatusReady = ($Status.ready -eq $true)
        if ($Status.ready -ne $true) {
            $alerts.Add("platform not ready: database=$($Status.database), backend=$($Status.backend), web=$($Status.web), site=$($Status.site)")
        }
        $worker = [string]$Status.worker
        if ($worker -eq 'available') {
            $next.workerUnavailableSince = $null
        } elseif ($worker -eq 'unavailable') {
            if (-not $next.workerUnavailableSince) { $next.workerUnavailableSince = $Now.ToString('o') }
            $since = [DateTimeOffset]::Parse([string]$next.workerUnavailableSince,[cultureinfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)
            $minutes = [int][Math]::Floor(($Now - $since).TotalMinutes)
            if ($minutes -ge $WorkerUnavailableMinutes) {
                $queued = if ($Status.queue) { " ($($Status.queue.waiting) queued, oldest $($Status.queue.oldestPendingSeconds) s)" } else { '' }
                $alerts.Add("worker unavailable for $minutes min$queued; code checks are delayed")
            }
        }
        foreach ($warning in @($Status.warnings)) {
            if ([string]$warning -match 'certificate') { $alerts.Add([string]$warning) }
        }
    }
    foreach ($path in @($DiskFree.Keys | Sort-Object)) {
        $free = [double]$DiskFree[$path]
        if ($free -lt $MinFreeGB) { $alerts.Add("low disk space: $free GB free at $path (threshold $MinFreeGB GB)") }
    }
    return [ordered]@{ alerts=@($alerts.ToArray()); state=$next }
}

function Resolve-MentorAlertDelivery {
    # Decides whether to notify: a new or changed alert set is sent at once, an unchanged one every $RepeatMinutes,
    # and a recovery message once when alerts clear. Returns @{ send; kind=alert|recovered|none; state }.
    param([string[]]$Alerts,$State,[DateTimeOffset]$Now,[int]$RepeatMinutes = 60)
    $next = ConvertTo-MentorStatusState ([pscustomobject]$State)
    $key = (@($Alerts) | Sort-Object) -join "`n"
    $previousKey = [string]$next.lastAlertKey
    if (-not $key) {
        if ($previousKey) { $next.lastAlertKey = $null; $next.lastAlertAt = $null; return [ordered]@{ send=$true; kind='recovered'; state=$next } }
        return [ordered]@{ send=$false; kind='none'; state=$next }
    }
    $repeatDue = $false
    if ($next.lastAlertAt) {
        $last = [DateTimeOffset]::Parse([string]$next.lastAlertAt,[cultureinfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)
        $repeatDue = ($Now - $last).TotalMinutes -ge $RepeatMinutes
    }
    if ($key -ne $previousKey -or $repeatDue) {
        $next.lastAlertKey = $key; $next.lastAlertAt = $Now.ToString('o')
        return [ordered]@{ send=$true; kind='alert'; state=$next }
    }
    return [ordered]@{ send=$false; kind='none'; state=$next }
}
