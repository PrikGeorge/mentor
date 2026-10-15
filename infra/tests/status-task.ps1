#Requires -Version 7.2
# Alert rules, de-duplication, the notify dry-run and the scheduled wrapper against a synthetic status script.
# No Docker, no Telegram request, no Task Scheduler registration.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../platform-common.ps1')
. (Join-Path $PSScriptRoot '../status-alerts.ps1')
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Reject([scriptblock]$Action,[string]$Expected,[string]$Message){$caught=$null;try{& $Action | Out-Null}catch{$caught=$_.Exception.Message};Require ($caught -and $caught -like "*$Expected*") ($Message+' Actual: '+$caught)}
$cmdlets=@('Register-ScheduledTask','Unregister-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskSettingsSet','New-ScheduledTaskPrincipal')
foreach($cmdlet in $cmdlets){Set-Item -Path ('function:global:'+$cmdlet) -Value ([scriptblock]::Create("throw 'Task Scheduler must not be touched by this test ($cmdlet).'"))}
function Invoke-RestMethod {throw 'No network request may leave this test.'}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-status-proof-'+[Guid]::NewGuid().ToString('N'))
New-MentorPrivateDirectory $root
try {
    $now=[DateTimeOffset]::new(2026,10,15,12,0,0,[TimeSpan]::Zero)
    $healthy=[pscustomobject]@{ready=$true;database='up';backend='healthy';web='healthy';site='reachable';worker='available';queue=[pscustomobject]@{waiting=0;oldestPendingSeconds=0};warnings=@()}
    $down=[pscustomobject]@{ready=$false;database='up';backend='unhealthy';web='healthy';site='unreachable';worker='unknown';queue=$null;warnings=@()}

    # 1. Rules: not ready, worker threshold with persistence, disk threshold, certificate warning, missing status.
    $state=New-MentorStatusState
    $result=Get-MentorStatusAlerts -Status $healthy -StatusExitCode 0 -State $state -Now $now -DiskFree @{'C:\'=120.5}
    Require ($result.alerts.Count -eq 0 -and $result.state.lastStatusReady -eq $true) 'A healthy status raised alerts.'
    $result=Get-MentorStatusAlerts -Status $down -StatusExitCode 1 -State $result.state -Now $now
    Require ($result.alerts.Count -eq 1 -and $result.alerts[0] -match 'platform not ready' -and $result.alerts[0] -match 'backend=unhealthy') 'Not-ready alert is missing.'
    $noWorker=[pscustomobject]@{ready=$true;database='up';backend='healthy';web='healthy';site='reachable';worker='unavailable';queue=[pscustomobject]@{waiting=3;oldestPendingSeconds=700};warnings=@('No worker heartbeat within 60 s; code checks are delayed, the cabinet keeps working.')}
    $result=Get-MentorStatusAlerts -Status $noWorker -StatusExitCode 0 -State (New-MentorStatusState) -Now $now -WorkerUnavailableMinutes 15
    Require ($result.alerts.Count -eq 0 -and $result.state.workerUnavailableSince -eq $now.ToString('o')) 'A fresh worker outage alerted before the threshold or was not remembered.'
    $result=Get-MentorStatusAlerts -Status $noWorker -StatusExitCode 0 -State $result.state -Now $now.AddMinutes(14) -WorkerUnavailableMinutes 15
    Require ($result.alerts.Count -eq 0) 'Worker alert fired before the threshold.'
    $result=Get-MentorStatusAlerts -Status $noWorker -StatusExitCode 0 -State $result.state -Now $now.AddMinutes(15) -WorkerUnavailableMinutes 15
    Require ($result.alerts.Count -eq 1 -and $result.alerts[0] -match 'worker unavailable for 15 min \(3 queued, oldest 700 s\)') 'Worker alert text is wrong.'
    $result=Get-MentorStatusAlerts -Status $healthy -StatusExitCode 0 -State $result.state -Now $now.AddMinutes(16)
    Require ($result.alerts.Count -eq 0 -and $null -eq $result.state.workerUnavailableSince) 'Worker recovery did not clear the outage start.'
    $result=Get-MentorStatusAlerts -Status $healthy -StatusExitCode 0 -State (New-MentorStatusState) -Now $now -MinFreeGB 10 -DiskFree @{'C:\'=4.2;'E:\'=50}
    Require ($result.alerts.Count -eq 1 -and $result.alerts[0] -match 'low disk space: 4.2 GB free at C:\\') 'Disk alert is wrong.'
    $expiring=[pscustomobject]@{ready=$true;database='up';backend='healthy';web='healthy';site='reachable';worker='available';queue=$null;warnings=@('job-gateway certificate expires in 12 days; rotate with infra/issue-job-tls.ps1.')}
    $result=Get-MentorStatusAlerts -Status $expiring -StatusExitCode 0 -State (New-MentorStatusState) -Now $now
    Require ($result.alerts.Count -eq 1 -and $result.alerts[0] -match 'certificate expires in 12 days') 'Certificate warning was not promoted to an alert.'
    $result=Get-MentorStatusAlerts -Status $null -StatusExitCode 1 -State (New-MentorStatusState) -Now $now -StatusError 'Synthetic Docker unavailable.'
    Require ($result.alerts.Count -eq 1 -and $result.alerts[0] -match 'produced no status: Synthetic Docker unavailable') 'A missing status did not alert.'
    Write-Output 'PASS rules: not ready, worker threshold with persistence and recovery, disk, certificate, missing status.'

    # 2. De-duplication: first alert sends, unchanged alert waits, repeat after the interval, changed set sends, recovery once.
    $delivery=Resolve-MentorAlertDelivery -Alerts @('a') -State (New-MentorStatusState) -Now $now -RepeatMinutes 60
    Require ($delivery.send -and $delivery.kind -eq 'alert') 'First alert was not sent.'
    $delivery=Resolve-MentorAlertDelivery -Alerts @('a') -State $delivery.state -Now $now.AddMinutes(10) -RepeatMinutes 60
    Require (-not $delivery.send) 'Unchanged alert was re-sent too early.'
    $delivery=Resolve-MentorAlertDelivery -Alerts @('b','a') -State $delivery.state -Now $now.AddMinutes(20) -RepeatMinutes 60
    Require ($delivery.send -and $delivery.kind -eq 'alert') 'A changed alert set was not sent.'
    $delivery=Resolve-MentorAlertDelivery -Alerts @('a','b') -State $delivery.state -Now $now.AddMinutes(30) -RepeatMinutes 60
    Require (-not $delivery.send) 'Order of alerts must not matter.'
    $delivery=Resolve-MentorAlertDelivery -Alerts @('a','b') -State $delivery.state -Now $now.AddMinutes(81) -RepeatMinutes 60
    Require ($delivery.send) 'Repeat reminder was not sent after the interval.'
    $delivery=Resolve-MentorAlertDelivery -Alerts @() -State $delivery.state -Now $now.AddMinutes(90)
    Require ($delivery.send -and $delivery.kind -eq 'recovered' -and $null -eq $delivery.state.lastAlertKey) 'Recovery was not sent once.'
    $delivery=Resolve-MentorAlertDelivery -Alerts @() -State $delivery.state -Now $now.AddMinutes(100)
    Require (-not $delivery.send -and $delivery.kind -eq 'none') 'Recovery was sent twice.'
    Write-Output 'PASS de-duplication: send, hold, change, repeat, recover once.'

    # 3. notify.ps1: dry-run prints the text and never needs a token; refusals for chat id, token and API origin.
    $notify=Join-Path $PSScriptRoot '../notify.ps1'
    $printed=(& $notify -Message 'synthetic alert' -TelegramChatId '-100123' -DryRun) -join "`n" | ConvertFrom-Json
    Require ($printed.dryRun -eq $true -and $printed.sent -eq $false -and $printed.text -eq '[Mentor platform] synthetic alert' -and $printed.chatId -eq '-100123') 'Dry-run output is wrong.'
    Reject {& $notify -Message 'x' -DryRun} 'chat id' 'Missing chat id was accepted.'
    $tokenFile=Join-Path $root 'token';[IO.File]::WriteAllText($tokenFile,'not-a-token')
    Reject {& $notify -Message 'x' -TelegramChatId '1' -TelegramTokenFile $tokenFile} 'malformed' 'Malformed token was accepted.'
    Reject {& $notify -Message 'x' -TelegramChatId '1' -TelegramApi 'http://example.com'} 'https' 'Plain HTTP API origin was accepted.'
    [IO.File]::WriteAllText($tokenFile,'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi')
    Reject {& $notify -Message 'x' -TelegramChatId '1' -TelegramTokenFile $tokenFile} 'No network request may leave this test' 'The real send path did not reach the HTTP client double.'
    Write-Output 'PASS notify: dry-run text, chat id/token/API validation, send path reaches the HTTP client only.'

    # 4. Wrapper with a synthetic status script and a notify double: alert run (exit 1, state, last-run), then recovery.
    $logs=Join-Path $root 'status-logs'
    $envPath=Join-Path $root 'compose.env';[IO.File]::WriteAllText($envPath,"MENTOR_RELEASE=synthetic`n")
    $statusDouble=Join-Path $root 'status-double.ps1'
    $notifyDouble=Join-Path $root 'notify-double.ps1';$sentFile=Join-Path $root 'sent.txt'
    [IO.File]::WriteAllText($notifyDouble,"param([string]`$Message,[string]`$Subject,[string]`$TelegramTokenFile,[string]`$TelegramChatId)`nAdd-Content -LiteralPath '$($sentFile.Replace("'","''"))' -Value (`$Subject+'|'+`$TelegramChatId+'|'+`$Message.Replace(""``n"",' / '))`n")
    [IO.File]::WriteAllText($statusDouble,"param([string]`$EnvironmentFile,[string]`$ProjectName)`nWrite-Output 'noise before json'`n'" + ($down | ConvertTo-Json -Compress).Replace("'","''") + "'`nexit 1`n")
    $wrapper=Join-Path $PSScriptRoot '../windows/run-status-task.ps1'
    $output=(& $wrapper -EnvironmentFile $envPath -LogDirectory $logs -ProjectName 'mentor-test' -StatusScript $statusDouble -NotifyScript $notifyDouble -TelegramChatId '42' -DiskPaths @($root) -MinFreeGB 0) -join "`n"
    Require ($LASTEXITCODE -eq 1) 'Alert run must exit 1.'
    $lastRun=Get-Content -LiteralPath (Join-Path $logs 'status-last-run.json') -Raw | ConvertFrom-Json
    Require ($lastRun.ready -eq $false -and $lastRun.statusExitCode -eq 1 -and @($lastRun.alerts).Count -eq 1 -and $lastRun.notification.sent -eq $true -and $lastRun.notification.kind -eq 'alert') 'status-last-run.json does not describe the alert.'
    Require (@($lastRun.diskFreeGB.PSObject.Properties).Count -eq 1) 'Disk free space was not recorded for the given path.'
    $sent=Get-Content -LiteralPath $sentFile
    Require (@($sent).Count -eq 1 -and $sent -match '^Mentor status\|42\|ALERT for project ''mentor-test''' -and $sent -match 'platform not ready') 'The notify double did not receive the alert.'
    $stateFile=Get-Content -LiteralPath (Join-Path $logs 'status-state.json') -Raw | ConvertFrom-Json
    Require ($stateFile.lastAlertKey -match 'platform not ready' -and $stateFile.lastAlertAt) 'State was not persisted.'
    & $wrapper -EnvironmentFile $envPath -LogDirectory $logs -ProjectName 'mentor-test' -StatusScript $statusDouble -NotifyScript $notifyDouble -TelegramChatId '42' -DiskPaths @($root) -MinFreeGB 0 | Out-Null
    Require (@(Get-Content -LiteralPath $sentFile).Count -eq 1) 'An unchanged alert was re-sent within the repeat interval.'
    [IO.File]::WriteAllText($statusDouble,"param([string]`$EnvironmentFile,[string]`$ProjectName)`n'" + ($healthy | ConvertTo-Json -Compress).Replace("'","''") + "'`nexit 0`n")
    & $wrapper -EnvironmentFile $envPath -LogDirectory $logs -ProjectName 'mentor-test' -StatusScript $statusDouble -NotifyScript $notifyDouble -TelegramChatId '42' -DiskPaths @($root) -MinFreeGB 0 | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Healthy run must exit 0.'
    $sent=@(Get-Content -LiteralPath $sentFile)
    Require ($sent.Count -eq 2 -and $sent[1] -match 'Recovered: no active alerts') 'Recovery message was not sent.'
    Require ((Get-Content -LiteralPath (Join-Path $logs 'status-last-run.json') -Raw) -notmatch 'token') 'The last-run file mentions a token.'
    # A failing notifier keeps the alert pending for the next run.
    [IO.File]::WriteAllText($statusDouble,"param([string]`$EnvironmentFile,[string]`$ProjectName)`n'" + ($down | ConvertTo-Json -Compress).Replace("'","''") + "'`nexit 1`n")
    [IO.File]::WriteAllText($notifyDouble,"throw 'Synthetic Telegram outage.'`n")
    & $wrapper -EnvironmentFile $envPath -LogDirectory $logs -ProjectName 'mentor-test' -StatusScript $statusDouble -NotifyScript $notifyDouble -TelegramChatId '42' -DiskPaths @($root) -MinFreeGB 0 | Out-Null
    $lastRun=Get-Content -LiteralPath (Join-Path $logs 'status-last-run.json') -Raw | ConvertFrom-Json
    $stateFile=Get-Content -LiteralPath (Join-Path $logs 'status-state.json') -Raw | ConvertFrom-Json
    Require ($lastRun.notification.sent -eq $false -and $lastRun.notification.error -match 'Synthetic Telegram outage' -and -not $stateFile.lastAlertKey) 'A failed notification was recorded as delivered.'
    Write-Output 'PASS wrapper: alert with exit 1, state and last-run files, hold within interval, recovery, pending on notifier failure.'

    # 5. Registration dry-run and refusals (Windows only).
    if($IsWindows){
        $register=Join-Path $PSScriptRoot '../windows/register-status-task.ps1'
        $tokenFile=Join-Path $root 'bot-token';[IO.File]::WriteAllText($tokenFile,'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi')
        foreach($mode in @(@{DryRun=$true},@{WhatIf=$true})){
            $output=(& $register -EnvironmentFile $envPath -LogDirectory $logs -ProjectName 'mentor-test' -TaskName 'MentorTestStatus' -TelegramTokenFile $tokenFile -TelegramChatId '42' -IntervalMinutes 7 @mode) -join "`n"
            Require ($output -match "Scheduled task plan 'MentorTestStatus'" -and $output -match 'every 7 min' -and $output -match [regex]::Escape('run-status-task.ps1') -and $output -match [regex]::Escape('-TelegramChatId 42') -and $output -match 'Dry-run: nothing was registered') 'Registration plan is incomplete.'
            Require ($output -notmatch 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') 'Registration plan printed the token.'
        }
        Reject {& $register -EnvironmentFile $envPath -LogDirectory $logs -DryRun} 'TelegramTokenFile' 'Registration without a channel and without -NoNotify was accepted.'
        $output=(& $register -EnvironmentFile $envPath -LogDirectory $logs -NoNotify -DryRun) -join "`n"
        Require ($output -match 'alerts: disabled' -and $output -match '-NoNotify') '-NoNotify plan is wrong.'
        Reject {& $register -EnvironmentFile (Join-Path $root 'absent.env') -LogDirectory $logs -NoNotify -DryRun} 'does not exist' 'Missing environment file was accepted.'
        Reject {& $register -EnvironmentFile $envPath -LogDirectory 'relative' -NoNotify -DryRun} 'absolute' 'Relative log directory was accepted.'
        $output=(& $register -Unregister -TaskName 'MentorTestStatus' -DryRun) -join "`n"
        Require ($output -match "would unregister scheduled task 'MentorTestStatus'") 'Unregister dry-run did not describe the removal.'
        Write-Output 'PASS registration: dry-run/-WhatIf plan without the token, channel requirement, path checks, unregister dry-run.'
    } else { Write-Output 'SKIP registration: Task Scheduler is Windows-only.' }
    Write-Output 'PASS: status-task rules, de-duplication, notify, wrapper, registration.'
} finally {
    foreach($cmdlet in $cmdlets){Remove-Item -Path ('function:global:'+$cmdlet) -ErrorAction SilentlyContinue}
    if($root -notmatch 'mentor-status-proof-[a-f0-9]{32}$'){throw 'Unexpected fixture cleanup target.'}
    Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
}
