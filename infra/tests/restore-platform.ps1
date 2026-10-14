#Requires -Version 7.2
# Doubles only the Docker/GnuPG boundary: no live Compose project, volume or database is touched.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../platform-common.ps1')
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Reject([scriptblock]$Action,[string]$Expected,[string]$Message){$caught=$null;try{& $Action | Out-Null}catch{$caught=$_.Exception.Message};Require ($caught -and $caught -like "*$Expected*") ($Message+' Actual: '+$caught)}
function FromDockerPath([string]$Path){
    if($IsWindows){ if($Path -match '^/mnt/([a-z])/(.*)$'){return ($Matches[1].ToUpperInvariant()+':\'+$Matches[2].Replace('/','\'))}; throw ('Unexpected Docker path in test: '+$Path) }
    return $Path
}
$global:calls=[Collections.Generic.List[string]]::new()
$global:failRestore=$false
$global:currentCounts=[ordered]@{lesson=5;student=4}
$global:ids=@{postgres=('a'*64);backend=('b'*64);web=('c'*64)}
function docker {
    $global:LASTEXITCODE=0;$a=@($args);$global:calls.Add(($a -join ' '))
    if($a[0] -eq 'compose'){
        $sub=$a[[Array]::IndexOf($a,'--project-name')+2]
        switch($sub){
            'config'{return '{"services":{"backend":{"image":"mentor-platform-backend:synthetic","environment":{"MENTOR_PUBLIC_ORIGIN":"http://127.0.0.1:65000","MENTOR_PRODUCTION":"false"}}},"volumes":{"postgres":{"name":"mentor-test_postgres"},"objects":{"name":"mentor-test_objects"}}}'}
            'ps'{return $global:ids[$a[-1]]}
            'stop'{return}
            'start'{return}
        }
        throw ('Unexpected Compose call in restore test: '+($a -join '|'))
    }
    if($a[0] -eq 'inspect'){ if($a[2] -eq '{{.State.Running}}'){return 'true'}; if($a[2] -eq '{{.Config.Image}}'){return 'mentor-platform-backend:synthetic'} }
    if($a[0] -eq 'exec' -and $a[1] -eq $global:ids.postgres){
        switch($a[2]){
            'pg_isready'{return}
            'rm'{return}
            'pg_restore'{ if($global:failRestore){throw 'Synthetic pg_restore failure.'}; return }
            'psql'{
                $sql=$a[-1]
                if($sql -like 'SELECT tablename*'){return @($global:currentCounts.Keys)}
                if($sql -match '^SELECT count\(\*\) FROM public\."([a-z_]+)"$'){return [string]$global:currentCounts[$Matches[1]]}
                if($sql -like 'DROP DATABASE*' -or $sql -like 'CREATE DATABASE*'){return}
            }
        }
    }
    if($a[0] -eq 'cp'){return}
    throw ('Unexpected Docker call in restore test: '+($a -join '|'))
}
function sh {
    $a=@($args);$global:calls.Add(('sh '+($a -join ' ')))
    Require ($a[0] -like '*gpg-file.sh' -and $a[1] -eq 'decrypt') 'Only decryption through gpg-file.sh is expected.'
    Copy-Item -LiteralPath (FromDockerPath $a[3]) -Destination (FromDockerPath $a[4]);$global:LASTEXITCODE=0
}
# PowerShell strips the "--" end-of-options token, so the tool name follows "-d Ubuntu" directly.
function wsl {$a=@($args);Require ($a[0] -eq '-d' -and $a[1] -eq 'Ubuntu') 'Unexpected WSL invocation.';$tool=$a[2];$forward=@($a[3..($a.Count-1)]);if($tool -eq 'docker'){return docker @forward};if($tool -eq 'sh'){return sh @forward};throw ('Unexpected WSL tool: '+$tool)}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-restore-proof-'+[Guid]::NewGuid().ToString('N'))
New-MentorPrivateDirectory $root
function NewBackup([string]$Name,[string[]]$ExtraArchiveEntries){
    $stage=Join-Path $root ($Name+'-stage');New-Item -ItemType Directory -Path $stage,(Join-Path $stage 'objects') | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $stage 'database.dump'),[Security.Cryptography.RandomNumberGenerator]::GetBytes(1024))
    foreach($object in @('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0','11111111-2222-3333-4444-555555555555')){[IO.File]::WriteAllText((Join-Path $stage ('objects/'+$object)),'synthetic object '+$object)}
    $manifest=[ordered]@{format=1;createdAt=[DateTime]::UtcNow.ToString('o');project='mentor-test';databaseSha256=(Get-FileHash -LiteralPath (Join-Path $stage 'database.dump') -Algorithm SHA256).Hash.ToLowerInvariant();counts=[ordered]@{lesson=3;student=2};objects=(Get-MentorObjectManifest (Join-Path $stage 'objects'))}
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8NoBOM
    $entries=@('manifest.json','database.dump','objects')+$ExtraArchiveEntries
    foreach($extra in $ExtraArchiveEntries){[IO.File]::WriteAllText((Join-Path $stage $extra),'unexpected')}
    $archive=Join-Path $stage 'snapshot.tar'
    & tar -cf $archive -C $stage @entries
    Require ($LASTEXITCODE -eq 0) 'Fixture archive creation failed.'
    $backup=Join-Path $root ('backups/mentor-backup-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $archive -Destination (Join-Path $backup 'snapshot.tar.gpg')
    [ordered]@{format=1;completed=$true;createdAt=$manifest.createdAt;sha256=(Get-FileHash -LiteralPath (Join-Path $backup 'snapshot.tar.gpg') -Algorithm SHA256).Hash.ToLowerInvariant();encrypted=$true;offsiteVerified=$false;restoreVerified=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'receipt.json') -Encoding utf8NoBOM
    Remove-Item -LiteralPath $stage -Recurse -Force
    return $backup
}
try {
    $platform=Join-Path $root 'platform';New-Item -ItemType Directory -Path $platform | Out-Null
    $envPath=Join-Path $platform 'compose.env';[IO.File]::WriteAllText($envPath,"MENTOR_RELEASE=synthetic`n")
    $passphrase=Join-Path $platform 'backup-passphrase';[IO.File]::WriteAllText($passphrase,[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)),[Text.UTF8Encoding]::new($false))
    $restore=Join-Path $PSScriptRoot '../restore-platform.ps1'
    $common=@{PassphraseFile=$passphrase;EnvironmentFile=$envPath;ProjectName='mentor-test'}
    $backup=NewBackup 'valid' @()

    # 1. Default dry-run: passphrase/archive/checksums proven, plan printed, nothing stopped or replaced.
    $global:calls.Clear()
    $dryReport=Join-Path $root 'dry-run'
    $output=(& $restore -Backup $backup -ReportDirectory $dryReport @common) -join "`n"
    Require ($output -match 'Restore plan for Compose project' -and $output -match 'Dry-run only') 'Dry-run did not print the plan.'
    $receipt=Get-Content -LiteralPath (Join-Path $dryReport 'restore-receipt.json') -Raw | ConvertFrom-Json
    Require ($receipt.completed -eq $true -and $receipt.mode -eq 'dry-run' -and $receipt.phase -eq 'dry-run' -and $receipt.servicesStopped -eq $false) 'Dry-run receipt is wrong.'
    Require ($receipt.backupCounts.lesson -eq 3 -and $receipt.currentCounts.lesson -eq 5 -and $receipt.backupObjectCount -eq 2) 'Dry-run receipt lost backup/current counts.'
    Require ($receipt.postgresVolume -eq 'mentor-test_postgres' -and $receipt.objectsVolume -eq 'mentor-test_objects') 'Volume names were not taken from Compose config.'
    Require (@($global:calls | Where-Object { $_ -match '\bstop\b|DROP DATABASE|CREATE DATABASE|pg_restore|^cp |^run ' }).Count -eq 0) 'Dry-run issued a mutating Docker command.'
    Require (@(Get-ChildItem -LiteralPath $dryReport -Directory).Count -eq 0) 'Dry-run left its private stage behind.'
    Write-Output 'PASS dry-run: plan printed, receipt written, no stop/replace commands, stage cleaned.'

    # 2. Apply without a rollback decision is refused before any Docker call.
    $global:calls.Clear()
    Reject {& $restore -Backup $backup -ReportDirectory (Join-Path $root 'no-decision') @common -Apply} 'PreRestoreBackupDestination' 'Apply without pre-restore backup decision was accepted.'
    Reject {& $restore -Backup $backup -ReportDirectory (Join-Path $root 'both') @common -Apply -SkipPreRestoreBackup -PreRestoreBackupDestination (Join-Path $root 'pre')} 'not both' 'Contradictory rollback options were accepted.'
    Reject {& $restore -Backup $backup -ReportDirectory 'relative/report' @common} 'absolute' 'Relative report path was accepted.'
    Require ($global:calls.Count -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $root 'no-decision'))) 'Refused apply still reached Docker or created a report.'
    Write-Output 'PASS apply refused without -PreRestoreBackupDestination/-SkipPreRestoreBackup; no Docker calls.'

    # 3. Corrupted ciphertext and a tampered archive are rejected before the services stop.
    $corrupt=Join-Path $root 'backups/corrupt';Copy-Item -LiteralPath $backup -Destination $corrupt -Recurse
    [IO.File]::WriteAllText((Join-Path $corrupt 'snapshot.tar.gpg'),'corrupted ciphertext fixture')
    $global:calls.Clear()
    Reject {& $restore -Backup $corrupt -ReportDirectory (Join-Path $root 'corrupt-report') @common -Apply -SkipPreRestoreBackup} 'checksum is invalid' 'Corrupted ciphertext was accepted.'
    Require ($global:calls.Count -eq 0) 'Corrupted ciphertext reached Docker.'
    $tampered=NewBackup 'tampered' @('extra.txt')
    $tamperedReport=Join-Path $root 'tampered-report'
    Reject {& $restore -Backup $tampered -ReportDirectory $tamperedReport @common -Apply -SkipPreRestoreBackup} 'Unexpected archive path' 'Tampered archive was accepted.'
    $receipt=Get-Content -LiteralPath (Join-Path $tamperedReport 'restore-receipt.json') -Raw | ConvertFrom-Json
    Require ($receipt.completed -eq $false -and $receipt.phase -eq 'failed' -and $receipt.servicesStopped -eq $false) 'Tampered archive receipt is wrong.'
    Require (@($global:calls | Where-Object { $_ -match '\bstop\b|DROP DATABASE' }).Count -eq 0) 'Tampered archive stopped services or dropped the database.'
    Write-Output 'PASS corrupted ciphertext and tampered archive rejected before any stop/replace.'

    # 4. Apply with a failing pg_restore: services stopped before the drop, stay closed, receipt durable, stage cleaned.
    $global:calls.Clear();$global:failRestore=$true
    $failedReport=Join-Path $root 'failed-apply'
    Reject {& $restore -Backup $backup -ReportDirectory $failedReport @common -Apply -SkipPreRestoreBackup} 'Synthetic pg_restore failure' 'Injected restore failure was lost or reported as success.'
    $receipt=Get-Content -LiteralPath (Join-Path $failedReport 'restore-receipt.json') -Raw | ConvertFrom-Json
    Require ($receipt.completed -eq $false -and $receipt.phase -eq 'failed' -and $receipt.mode -eq 'apply' -and $receipt.preRestoreBackupSkipped -eq $true) 'Failed apply receipt state is wrong.'
    Require ($receipt.servicesStopped -eq $true -and $receipt.servicesStarted -eq $false -and @($receipt.cleanupFailures).Count -eq 0) 'Failed apply did not keep the platform closed.'
    $stopIndex=[Array]::FindIndex([string[]]$global:calls,[Predicate[string]]{param($c) $c -match '\bstop\b.*backend web'})
    $dropIndex=[Array]::FindIndex([string[]]$global:calls,[Predicate[string]]{param($c) $c -match 'DROP DATABASE IF EXISTS mentor WITH \(FORCE\)'})
    Require ($stopIndex -ge 0 -and $dropIndex -gt $stopIndex) 'The database was dropped before backend/web were stopped.'
    Require (@($global:calls | Where-Object { $_ -match '\bup\b|\bstart\b' }).Count -eq 0) 'A failed apply reopened the platform.'
    Require (@($global:calls | Where-Object { $_ -match 'rm -f /tmp/mentor-restore-' }).Count -eq 1) 'Temporary dump inside PostgreSQL was not removed.'
    Require (@($global:calls | Where-Object { $_ -match 'find /objects' }).Count -eq 0) 'Objects were emptied although the database restore failed.'
    Require (@(Get-ChildItem -LiteralPath $failedReport -Directory).Count -eq 0) 'Failed apply left its private stage behind.'
    $lease=[IO.File]::Open((Join-Path $platform 'mentor-test.maintenance.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$lease.Dispose()
    Write-Output 'PASS failed apply: stop precedes drop, platform stays closed, durable failed receipt, dump/stage cleaned, maintenance lock released.'
    $global:failRestore=$false

    # 5. Report directory must be new.
    Reject {& $restore -Backup $backup -ReportDirectory $dryReport @common} 'must be new' 'Existing report directory was reused.'
    Write-Output 'PASS: restore-platform dry-run default, refusal without rollback decision, ciphertext/archive validation, failed apply stays closed.'
} finally {
    if($root -notmatch 'mentor-restore-proof-[a-f0-9]{32}$'){throw 'Unexpected fixture cleanup target.'}
    Remove-Variable -Name calls,failRestore,currentCounts,ids -Scope Global -ErrorAction SilentlyContinue
    Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
}
