#Requires -Version 7.2
$ErrorActionPreference='Stop'
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
$leaseHelper=Join-Path $PSScriptRoot '../maintenance-lease.ps1'
$guardHelper=Join-Path $PSScriptRoot '../cutover-common.ps1'
Require (Test-Path -LiteralPath $leaseHelper) 'Caller-owned maintenance lease support is not implemented.'
Require (Test-Path -LiteralPath $guardHelper) 'Cutover approval guards are not implemented.'
. $leaseHelper
. $guardHelper
function Reject([scriptblock]$Operation,[string]$Message){$failed=$false;try{& $Operation}catch{$failed=$true};Require $failed $Message}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-cutover-guards-'+[guid]::NewGuid().ToString('N'))
New-MentorPrivateDirectory $root
try {
    $envPath=Join-Path $root 'compose.env';[IO.File]::WriteAllText($envPath,'# synthetic paths only')
    $owned=Open-MentorMaintenanceLease $envPath 'mentor-test' $null
    Require ($owned.Owned -and $owned.Stream.CanWrite) 'Normal lock was not owned.'
    Reject {Open-MentorMaintenanceLease $envPath 'mentor-test' $null} 'Concurrent maintenance lock acquired.'
    $borrowed=Open-MentorMaintenanceLease $envPath 'mentor-test' $owned.Stream
    Require (-not $borrowed.Owned) 'Borrowed lock was marked owned.'
    Close-MentorMaintenanceLease $borrowed
    Require $owned.Stream.CanWrite 'Borrowed cleanup disposed caller lock.'
    Reject {Open-MentorMaintenanceLease $envPath 'other-project' $owned.Stream} 'Wrong project lease accepted.'
    Close-MentorMaintenanceLease $owned
    Reject {Open-MentorMaintenanceLease $envPath 'mentor-test' $owned.Stream} 'Disposed lease accepted.'
    $again=Open-MentorMaintenanceLease $envPath 'mentor-test' $null
    Close-MentorMaintenanceLease $again
    Require (-not $again.Stream.CanWrite) 'Owned cleanup leaked lock.'

    $now=[DateTimeOffset]::UtcNow
    $digest='1'*64
    $expected=@{importId='synthetic-cutover';sourceDigest=$digest;sourceFilesSha256=('2'*64);imageId=('sha256:'+('3'*64));jarSha256=$null;environmentManifestSha256=('4'*64);environmentProfilesSha256=('5'*64);targetWorkspace='workspace-explicit';teacherAccount='teacher-explicit';reportSha256=('6'*64)}
    $approval=@{};foreach($key in $expected.Keys){$approval[$key]=$expected[$key]};$approval.format=1;$approval.mode='dry-run';$approval.createdAt=$now.AddMinutes(-1).ToString('o')
    $raw=@{importId=$expected.importId;sourceDigest=$digest;errors=@();completed=$false}
    Assert-MentorCutoverApproval $approval $raw $expected $now
    foreach($key in @('importId','sourceDigest','sourceFilesSha256','imageId','environmentManifestSha256','environmentProfilesSha256','targetWorkspace','teacherAccount','reportSha256')){
        $changed=$approval.Clone();$changed[$key]='changed'
        Reject {Assert-MentorCutoverApproval $changed $raw $expected $now} ('Changed approval binding accepted: '+$key)
    }
    $changed=$approval.Clone();$changed.jarSha256='7'*64
    Reject {Assert-MentorCutoverApproval $changed $raw $expected $now} 'Changed immutable JAR accepted.'
    $changed=$approval.Clone();$changed.createdAt=$now.AddMinutes(-30).ToString('o')
    Reject {Assert-MentorCutoverApproval $changed $raw $expected $now} 'Exact expired approval accepted.'
    $changed=$approval.Clone();$changed.createdAt=$now.AddSeconds(1).ToString('o')
    Reject {Assert-MentorCutoverApproval $changed $raw $expected $now} 'Future approval accepted.'
    $bad=$raw.Clone();$bad.errors=@('synthetic reader failure')
    Reject {Assert-MentorCutoverApproval $approval $bad $expected $now} 'Failed CLI dryrun accepted.'
    $bad=$raw.Clone();$bad.completed=$true
    Reject {Assert-MentorCutoverApproval $approval $bad $expected $now} 'Apply report used as dryrun approval.'
    $bad=$raw.Clone();$bad.sourceDigest=''
    Reject {Assert-MentorCutoverApproval $approval $bad $expected $now} 'Empty source digest accepted.'
    $receiptDirectory=Join-Path $root 'receipt.json';New-Item -ItemType Directory -Path $receiptDirectory | Out-Null
    Reject {Write-MentorCutoverJson $receiptDirectory @{completed=$true} -Replace} 'A directory was accepted as the durable receipt file.'
    Require ([bool](Get-Command Assert-MentorCutoverPath -ErrorAction SilentlyContinue)) 'Administrative ancestor/path rejection is not implemented.'
    $badJson=Join-Path $root 'bad.json';[IO.File]::WriteAllText($badJson,'{synthetic-secret-marker')
    $caught=$null;try{Read-MentorCutoverJson $badJson}catch{$caught=$_.Exception.Message}
    Require ($caught -and $caught -notmatch 'synthetic-secret-marker') 'Malformed private JSON leaked content.'
    $outside=Join-Path $root 'outside';New-Item -ItemType Directory -Path $outside | Out-Null
    $link=Join-Path $root 'linked';New-Item -ItemType $(if($IsWindows){'Junction'}else{'SymbolicLink'}) -Path $link -Target $outside | Out-Null
    Reject {Assert-MentorCutoverPath (Join-Path $link 'new-report') $true} 'Linked report ancestor accepted.'
    Remove-Item -LiteralPath $link
    $source=Join-Path $root 'valid-source';New-MentorPrivateDirectory $source
    foreach($relative in @('data/mentoring.json','data/auth/accounts.json','private/materials/manifest.json','private/materials/content.json','training/catalog.json','training/environments.json')){$path=Join-Path $source $relative;New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null;[IO.File]::WriteAllText($path,'{}')}
    $listed=Get-MentorCutoverSourceFiles $source
    Require ($listed.Count -eq 6 -and @($listed | Where-Object {$_.path -isnot [string]}).Count -eq 0) 'Valid source records are nested or rejected.'
    Write-Output 'PASS: maintenance borrow/ownership/concurrency/closed/wrong-project; exact approval bindings, deadlines and CLI errors.'
} finally {
    if($owned -and $owned.Stream.CanWrite){Close-MentorMaintenanceLease $owned}
    Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
}