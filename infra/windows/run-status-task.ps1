#Requires -Version 7.2
# Scheduled wrapper (every N minutes): runs status-platform.ps1, evaluates alert rules (not ready, worker unavailable
# longer than a threshold, low disk space, expiring gateway certificate) and sends de-duplicated alerts through
# infra/notify.ps1. State and the last result live in -LogDirectory; nothing secret is written there.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvironmentFile,
    [Parameter(Mandatory)][string]$LogDirectory,
    [string]$ProjectName = 'mentor-platform',
    [ValidateRange(1,1440)][int]$WorkerUnavailableMinutes = 15,
    [ValidateRange(0,10000)][double]$MinFreeGB = 10,
    [string[]]$DiskPaths,
    [ValidateRange(1,10080)][int]$RepeatMinutes = 60,
    [string]$TelegramTokenFile,
    [string]$TelegramChatId,
    [ValidateRange(1,3650)][int]$KeepLogDays = 90,
    [switch]$NoNotify,
    # Test seams: replace the status/notify scripts with doubles. Production registrations never pass these.
    [string]$StatusScript = (Join-Path $PSScriptRoot '../status-platform.ps1'),
    [string]$NotifyScript = (Join-Path $PSScriptRoot '../notify.ps1')
)
. (Join-Path $PSScriptRoot '../status-alerts.ps1')
foreach ($path in @($EnvironmentFile,$LogDirectory)) { if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Environment and log paths must be absolute.' } }
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') { throw 'Invalid Compose project name.' }
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$now = [DateTimeOffset]::UtcNow
if (-not $DiskPaths) {
    $DiskPaths = @((Split-Path -Parent ([IO.Path]::GetFullPath($EnvironmentFile))))
    # Docker Desktop keeps volumes inside its WSL disk under %LOCALAPPDATA%; Linux engines use /var/lib/docker.
    if ($IsWindows -and $env:LOCALAPPDATA) { $DiskPaths += $env:LOCALAPPDATA } elseif (-not $IsWindows -and (Test-Path -LiteralPath '/var/lib/docker')) { $DiskPaths += '/var/lib/docker' }
}
$statePath = Join-Path $LogDirectory 'status-state.json'
$state = New-MentorStatusState
if (Test-Path -LiteralPath $statePath -PathType Leaf) { try { $state = ConvertTo-MentorStatusState (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json) } catch { } }

$status = $null; $statusError = $null; $statusExit = -1
try {
    $output = (& $StatusScript -EnvironmentFile $EnvironmentFile -ProjectName $ProjectName 2>&1 | ForEach-Object { [string]$_ }) -join "`n"
    $statusExit = $LASTEXITCODE
    $jsonStart = $output.IndexOf('{')
    if ($jsonStart -ge 0) { $status = $output.Substring($jsonStart) | ConvertFrom-Json } else { $statusError = 'no JSON in output' }
} catch { $statusError = $_.Exception.Message }
$diskFree = @{}
foreach ($path in ($DiskPaths | Select-Object -Unique)) { try { $diskFree[$path] = Get-MentorFreeSpaceGB $path } catch { } }
$evaluation = Get-MentorStatusAlerts -Status $status -StatusExitCode $statusExit -State $state -Now $now -WorkerUnavailableMinutes $WorkerUnavailableMinutes -MinFreeGB $MinFreeGB -DiskFree $diskFree -StatusError $statusError
$delivery = Resolve-MentorAlertDelivery -Alerts $evaluation.alerts -State $evaluation.state -Now $now -RepeatMinutes $RepeatMinutes
$notification = [ordered]@{ attempted=$false; sent=$false; kind=$delivery.kind; error=$null }
if ($delivery.send -and -not $NoNotify) {
    $notification.attempted = $true
    $text = if ($delivery.kind -eq 'recovered') { "Recovered: no active alerts for project '$ProjectName'." } else { "ALERT for project '$ProjectName':`n- " + ($evaluation.alerts -join "`n- ") }
    $notifyArguments = @{ Message=$text; Subject='Mentor status' }
    if ($TelegramTokenFile) { $notifyArguments.TelegramTokenFile = $TelegramTokenFile }
    if ($TelegramChatId) { $notifyArguments.TelegramChatId = $TelegramChatId }
    try { & $NotifyScript @notifyArguments | Out-Null; $notification.sent = $true }
    catch {
        # Keep the alert pending so the next run retries instead of considering it delivered.
        $notification.error = $_.Exception.Message
        $delivery.state.lastAlertKey = $state.lastAlertKey; $delivery.state.lastAlertAt = $state.lastAlertAt
    }
}
$summary = [ordered]@{
    checkedAt=$now.ToString('o'); project=$ProjectName; ready=$(if ($status) { $status.ready -eq $true } else { $false })
    statusExitCode=$statusExit; statusError=$statusError; alerts=$evaluation.alerts; diskFreeGB=$diskFree; notification=$notification
    worker=$(if ($status -and $status.PSObject.Properties['worker']) { $status.worker } else { $null }); tls=$(if ($status -and $status.PSObject.Properties['tls']) { $status.tls } else { $null })
}
$delivery.state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $LogDirectory 'status-last-run.json') -Encoding utf8NoBOM
$line = $now.ToString('o') + ' ready=' + $summary.ready + ' alerts=' + $evaluation.alerts.Count + ' notify=' + $delivery.kind + $(if ($notification.error) { ' notifyError' } else { '' })
try { Add-Content -LiteralPath (Join-Path $LogDirectory ('status-' + $now.ToString('yyyyMMdd') + '.log')) -Value $line -Encoding utf8 } catch { }
$cutoff = [DateTime]::UtcNow.AddDays(-$KeepLogDays)
foreach ($old in (Get-ChildItem -LiteralPath $LogDirectory -File -Filter 'status-*.log' | Where-Object { $_.LastWriteTimeUtc -lt $cutoff })) { try { Remove-Item -LiteralPath $old.FullName } catch { } }
$summary | ConvertTo-Json -Depth 5
if ($evaluation.alerts.Count -gt 0) { exit 1 }
exit 0
