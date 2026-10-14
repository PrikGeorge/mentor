#Requires -Version 7.2
# Task Scheduler and Docker boundaries are doubled: no task is registered, no live Compose project is touched,
# nothing is written to the Windows Event Log.
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'The Task Scheduler registration test requires Windows.'}
. (Join-Path $PSScriptRoot '../windows/backup-task-common.ps1')
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Reject([scriptblock]$Action,[string]$Expected,[string]$Message){$caught=$null;try{& $Action | Out-Null}catch{$caught=$_.Exception.Message};Require ($caught -and $caught -like "*$Expected*") ($Message+' Actual: '+$caught)}
foreach($cmdlet in @('Register-ScheduledTask','Unregister-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskSettingsSet','New-ScheduledTaskPrincipal')){
    Set-Item -Path ('function:global:'+$cmdlet) -Value ([scriptblock]::Create("throw 'Task Scheduler must not be touched by this test ($cmdlet).'"))
}
# backup.ps1 reaches Docker through wsl.exe; the double fails before any container is addressed.
function wsl {throw 'Synthetic Docker unavailable.'}
function docker {throw 'Synthetic Docker unavailable.'}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-task-proof-'+[Guid]::NewGuid().ToString('N'))
New-MentorPrivateDirectory $root
try {
    $platform=Join-Path $root 'platform';New-Item -ItemType Directory -Path $platform | Out-Null
    $envPath=Join-Path $platform 'compose.env';[IO.File]::WriteAllText($envPath,"MENTOR_RELEASE=synthetic`n")
    $passphrase=Join-Path $platform 'backup-passphrase';[IO.File]::WriteAllText($passphrase,[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)),[Text.UTF8Encoding]::new($false))
    $destination=Join-Path $root 'backups';$offsite=Join-Path $root 'offsite';$logs=Join-Path $root 'task-logs'
    $register=Join-Path $PSScriptRoot '../windows/register-backup-task.ps1'
    $common=@{EnvironmentFile=$envPath;Destination=$destination;PassphraseFile=$passphrase;ProjectName='mentor-test';TaskName='MentorTestBackup'}

    # 1. Dry-run and -WhatIf print the exact plan and register nothing.
    foreach($mode in @(@{DryRun=$true},@{WhatIf=$true})){
        $output=(& $register @common -OffsiteDirectory $offsite -LogDirectory $logs @mode) -join "`n"
        Require ($output -match "Scheduled task plan 'MentorTestBackup'" -and $output -match 'Dry-run: nothing was registered') 'Dry-run did not print the plan.'
        Require ($output -match [regex]::Escape('run-backup-task.ps1') -and $output -match [regex]::Escape('-OffsiteDirectory "'+$offsite+'"') -and $output -match [regex]::Escape('-ProjectName mentor-test')) 'Planned arguments are incomplete.'
        Require ($output -match [regex]::Escape((Get-Process -Id $PID).Path) -and $output -match 'daily at 03:15') 'Planned program or trigger is wrong.'
        Require (-not (Test-Path -LiteralPath $logs)) 'Dry-run created the log directory.'
    }
    $output=(& $register @common -OffsiteDirectory $offsite -StartTime '22:40' -DryRun) -join "`n"
    Require ($output -match 'daily at 22:40' -and $output -match [regex]::Escape((Join-Path $destination 'task-logs'))) 'Custom start time or default log directory missing from the plan.'
    Write-Output 'PASS dry-run/-WhatIf: plan with wrapper, offsite, project and pwsh path; no registration, no directories.'

    # 2. Refusals: no offsite, relative paths, missing environment, wrong pwsh, unregister dry-run.
    Reject {& $register @common -DryRun} 'OffsiteDirectory' 'Missing offsite directory was accepted.'
    Reject {& $register @common -OffsiteDirectory 'offsite' -DryRun} 'absolute' 'Relative offsite path was accepted.'
    Reject {& $register @common -OffsiteDirectory $offsite -PwshPath (Join-Path $root 'missing-pwsh.exe') -DryRun} 'pwsh.exe' 'Missing pwsh path was accepted.'
    Reject {& $register -EnvironmentFile (Join-Path $root 'absent.env') -Destination $destination -PassphraseFile $passphrase -OffsiteDirectory $offsite -DryRun} 'does not exist' 'Missing environment file was accepted.'
    $output=(& $register -Unregister -TaskName 'MentorTestBackup' -DryRun) -join "`n"
    Require ($output -match "would unregister scheduled task 'MentorTestBackup'") 'Unregister dry-run did not describe the removal.'
    Write-Output 'PASS refusals: offsite required with explanation, absolute paths, pwsh presence, environment presence; unregister dry-run.'

    # 3. Outcome evaluation on receipt fixtures.
    New-Item -ItemType Directory -Path $destination | Out-Null
    $started=[DateTimeOffset]::UtcNow
    function NewBackupDirectory([string]$Suffix){$path=Join-Path $destination ('mentor-backup-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+($Suffix*32));New-Item -ItemType Directory -Path $path | Out-Null;return $path}
    $outcome=Test-MentorBackupOutcome $destination $started $true
    Require (-not $outcome.ok -and $outcome.reason -match 'found 0') 'An empty destination counted as success.'
    $stale=NewBackupDirectory 'a'
    @{format=1;completed=$true;encrypted=$true;offsiteVerified=$true;restoreVerified=$true;createdAt=$started.AddDays(-1).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stale 'receipt.json')
    $outcome=Test-MentorBackupOutcome $destination $started $true
    Require (-not $outcome.ok -and $outcome.reason -match 'found 0') 'Yesterday''s receipt counted as a fresh backup.'
    $partial=NewBackupDirectory 'b'
    @{format=1;completed=$true;encrypted=$true;offsiteVerified=$false;restoreVerified=$false;createdAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $partial 'receipt.json')
    $outcome=Test-MentorBackupOutcome $destination $started $true
    Require (-not $outcome.ok -and $outcome.reason -match 'offsite') 'A receipt without offsite verification counted as success.'
    (Get-Content -LiteralPath (Join-Path $partial 'receipt.json') -Raw).Replace('"offsiteVerified": false','"offsiteVerified": true') | Set-Content -LiteralPath (Join-Path $partial 'receipt.json')
    $outcome=Test-MentorBackupOutcome $destination $started $true
    Require (-not $outcome.ok -and $outcome.reason -match 'restore') 'A receipt without restore verification counted as success.'
    (Get-Content -LiteralPath (Join-Path $partial 'receipt.json') -Raw).Replace('"restoreVerified": false','"restoreVerified": true') | Set-Content -LiteralPath (Join-Path $partial 'receipt.json')
    $outcome=Test-MentorBackupOutcome $destination $started $true
    Require ($outcome.ok -and $outcome.backup -eq $partial) 'A fresh fully verified receipt was not recognized.'
    Require (-not (Test-MentorBackupOutcome $destination $started $false).ok) 'A failed backup.ps1 exit counted as success despite a receipt.'
    $broken=NewBackupDirectory 'c'
    @{completed=$false;failedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $broken 'failed.json')
    $outcome=Test-MentorBackupOutcome $destination $started $true
    Require (-not $outcome.ok -and $outcome.reason -match 'failed.json' -and @($outcome.failedMarkers).Count -eq 1) 'failed.json from this run was ignored.'
    $marker=Write-MentorBackupAlert $logs 'synthetic alert message' -NoEventLog
    $alert=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    Require ($alert.alert -eq $true -and $alert.message -eq 'synthetic alert message' -and $alert.eventLog -eq 'disabled' -and (Split-Path -Leaf $marker) -match '^ALERT-[0-9]{8}T[0-9]{6}Z[.]json$') 'Alert marker is wrong.'
    Write-Output 'PASS outcome evaluation: stale/partial receipts, failed.json, script failure, verified receipt; alert marker written.'

    # 4. The scheduled wrapper against an unavailable Docker: transcript, failed.json detected, marker + last-run.json, exit 1.
    Remove-Item -LiteralPath $destination,$logs -Recurse -Force
    $wrapper=Join-Path $PSScriptRoot '../windows/run-backup-task.ps1'
    $output=(& $wrapper -EnvironmentFile $envPath -Destination $destination -OffsiteDirectory $offsite -PassphraseFile $passphrase -LogDirectory $logs -ProjectName 'mentor-test' -NoEventLog 2>&1) -join "`n"
    Require ($LASTEXITCODE -eq 1 -and $output -match 'ALERT:') 'Wrapper did not report the failed backup.'
    $lastRun=Get-Content -LiteralPath (Join-Path $logs 'last-run.json') -Raw | ConvertFrom-Json
    Require ($lastRun.ok -eq $false -and $lastRun.error -match 'Synthetic Docker unavailable' -and $lastRun.reason -eq 'backup.ps1 exited with an error' -and @($lastRun.failedMarkers).Count -eq 1) 'last-run.json does not describe the failure.'
    Require ((Test-Path -LiteralPath $lastRun.alert) -and (Test-Path -LiteralPath $lastRun.log) -and @(Get-ChildItem -LiteralPath $logs -Filter 'ALERT-*.json').Count -eq 1) 'Alert marker or transcript missing.'
    Require ((Get-Content -LiteralPath $lastRun.log -Raw) -match 'backup.ps1 failed: Synthetic Docker unavailable') 'Run log lacks the failure.'
    Require ((Get-Content -LiteralPath $lastRun.log -Raw) -notmatch [regex]::Escape((Get-Content -LiteralPath $passphrase -Raw))) 'Run log disclosed the passphrase.'
    Write-Output 'PASS scheduled wrapper: failed.json + script error detected, marker and last-run.json written, run log kept, exit 1.'
    Write-Output 'PASS: register-backup-task dry-run/-WhatIf, offsite requirement, outcome evaluation, wrapper alerting.'
} finally {
    foreach($cmdlet in @('Register-ScheduledTask','Unregister-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger','New-ScheduledTaskSettingsSet','New-ScheduledTaskPrincipal')){Remove-Item -Path ('function:global:'+$cmdlet) -ErrorAction SilentlyContinue}
    if($root -notmatch 'mentor-task-proof-[a-f0-9]{32}$'){throw 'Unexpected fixture cleanup target.'}
    Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
}
