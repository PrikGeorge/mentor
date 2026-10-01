#Requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)][string]$GoldenSnapshot,[Parameter(Mandatory)][string]$Manifest,[Parameter(Mandatory)][string]$BackendImage,[string]$WebImage='mentor-platform-web:task15-v7-proof',[switch]$KeepFixture)
. (Join-Path $PSScriptRoot '../cutover-import.ps1')
. (Join-Path $PSScriptRoot '../cutover-backup.ps1')
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Reject([scriptblock]$Action,[string]$Message){$caught=$false;try{& $Action | Out-Null}catch{$caught=$true};Require $caught $Message}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-cutover-proof-'+[guid]::NewGuid().ToString('N'));New-MentorPrivateDirectory $root
$project='mentor-cutover-'+[guid]::NewGuid().ToString('N').Substring(0,12);$context=$null;$receiptFile=Join-Path $root 'fixture.private.json'
$success=$false;$prepared=$null
try {
    $snapshot=Join-Path $root 'snapshot';New-MentorPrivateDirectory $snapshot
    Copy-Item -Path (Join-Path $GoldenSnapshot '*') -Destination $snapshot -Recurse -Force
    $manifestPath=Join-Path $root 'operator-manifest.json';Copy-Item -LiteralPath $Manifest -Destination $manifestPath
    $imageId=(Invoke-MentorDocker @('image','inspect','--format','{{.Id}}',$BackendImage) | Out-String).Trim();Require ($imageId -match '^sha256:[a-f0-9]{64}$') 'Missing prebuilt V8 image.'
    $release='cutover-proof-'+[guid]::NewGuid().ToString('N').Substring(0,12)
    Invoke-MentorDocker @('tag',$imageId,('mentor-platform-backend:'+$release)) | Out-Null
    Invoke-MentorDocker @('tag',$WebImage,('mentor-platform-web:'+$release)) | Out-Null
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
    $platform=Join-Path $root 'platform';$origin='http://127.0.0.1:'+$port
    & (Join-Path $PSScriptRoot '../initialize-platform.ps1') -Directory $platform -PublicOrigin $origin -Release $release | Out-Null
    $envPath=Join-Path $platform 'compose.env'
    [IO.File]::AppendAllText($envPath,"`nMENTOR_WEB_SUBNET=172.28.87.0/24`nMENTOR_PROXY_IP=172.28.87.2`nMENTOR_BACKEND_IP=172.28.87.3`nMENTOR_PROXY_IP_REGEX=172[.]28[.]87[.]2`n")
    $context=New-MentorPlatformContext $envPath $project
    & (Join-Path $PSScriptRoot '../start-platform.ps1') -EnvironmentFile $envPath -ProjectName $project | Out-Null
    $backend=Get-MentorServiceId $context 'backend';$web=Get-MentorServiceId $context 'web';$postgres=Get-MentorServiceId $context 'postgres'
    function Query([string]$Sql){Invoke-MentorDocker @('exec',$postgres,'psql','-X','-U','mentor','-d','mentor','-At','-v','ON_ERROR_STOP=1','-c',$Sql)}
    function Running([string]$Id){return ((Invoke-MentorDocker @('inspect','--format','{{.State.Running}}',$Id) | Out-String).Trim() -eq 'true')}
    $arguments=@{Snapshot=$snapshot;ImportId=('cutover-test-'+[guid]::NewGuid().ToString('N'));TargetWorkspace=('cutover-space-'+[guid]::NewGuid().ToString('N'));TeacherAccount='account-fixture-teacher';EnvironmentManifest=$manifestPath;EnvironmentManifestSha256=(Get-MentorCutoverHash $manifestPath);EnvironmentProfilesSha256=(Get-MentorCutoverHash (Join-Path $snapshot 'training/environments.json'));BackendImage=$imageId}
    $cutover=Join-Path $PSScriptRoot '../cutover.ps1'
    $before=Get-MentorCutoverJsonHash (Get-MentorTableCounts $postgres)
    $dryDir=Join-Path $root 'dryrun'; & $cutover @arguments -ReportDirectory $dryDir | Out-Null
    $approvalPath=Join-Path $dryDir 'approval.json';$approval=Read-MentorCutoverJson $approvalPath;$raw=Read-MentorCutoverJson (Join-Path $dryDir 'dryrun-report.json')
    Require (-not $raw.completed -and @($raw.errors).Count -eq 0 -and $approval.sourceDigest -eq $raw.sourceDigest) 'Actual packaged dry-run failed.'
    Require ((Running $backend) -and (Running $web) -and $before -ceq (Get-MentorCutoverJsonHash (Get-MentorTableCounts $postgres))) 'Default dry-run changed target services/DB.'
    if(-not $IsWindows){Require ((& stat --format=%a -- $snapshot) -eq '700') 'Host snapshot permissions weakened.';Require ((& stat --format=%a -- (Join-Path $dryDir 'dryrun-report.json')) -eq '600') 'CLI report is not private.'}
    Write-Output 'PASS actual packaged default dryrun: no target services/database writes; private host snapshot/report.'
    $backupRoot=Join-Path $root 'backups';New-MentorPrivateDirectory $backupRoot;$passphrase=Join-Path $platform 'backup-passphrase'
    $apply=@{Apply=$true;Approval=$approvalPath;EnvironmentFile=$envPath;ProjectName=$project;BackupDestination=$backupRoot;PassphraseFile=$passphrase}
    $sourceFile=Join-Path $snapshot 'training/exercises/list-task/pkg/ListTask.java';$original=[IO.File]::ReadAllBytes($sourceFile)
    [IO.File]::AppendAllText($sourceFile,"`n// changed closed source")
    Reject {& $cutover @arguments @apply -ReportDirectory (Join-Path $root 'changed-source')} 'Changed source accepted.'
    [IO.File]::WriteAllBytes($sourceFile,$original)
    Require ((Running $backend) -and (Running $web) -and $before -ceq (Get-MentorCutoverJsonHash (Get-MentorTableCounts $postgres))) 'Changed-source rejection stopped/mutated target.'
    Write-Output 'PASS source change rejected before target stop/apply.'
    $sourcePrep=Join-Path $root 'source-backup-preparation';New-MentorPrivateDirectory $sourcePrep
    $prepared=New-MentorCutoverSession $snapshot $manifestPath $sourcePrep $imageId $null $null
    $sourceBackup=New-MentorCutoverSourceBackup $prepared $approval $approvalPath (Join-Path $dryDir 'dryrun-report.json') $backupRoot $passphrase
    $cleanup=Close-MentorCutoverSession $prepared;$prepared=$null;Require ($cleanup.Count -eq 0) 'Source backup preparation leaked resources.'
    $cipher=Join-Path $sourceBackup 'snapshot.tar.gpg';$savedCipher=Join-Path $root 'cipher.private.gpg';Copy-Item -LiteralPath $cipher -Destination $savedCipher
    [IO.File]::WriteAllText($cipher,'corrupted encrypted source fixture')
    Reject {& $cutover @arguments @apply -SourceBackup $sourceBackup -ReportDirectory (Join-Path $root 'bad-cipher')} 'Corrupt encrypted source backup accepted.'
    Copy-Item -LiteralPath $savedCipher -Destination $cipher -Force;Remove-Item -LiteralPath $savedCipher
    Require ((Running $backend) -and (Running $web) -and $before -ceq (Get-MentorCutoverJsonHash (Get-MentorTableCounts $postgres))) 'Corrupt-source-backup rejection stopped/mutated target.'
    Write-Output 'PASS real encrypted source backup verified; corrupted ciphertext rejected before target stop.'
    Query 'CREATE FUNCTION cutover_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION ''synthetic partial apply fault''; END $$; CREATE TRIGGER cutover_test_fail BEFORE INSERT ON lesson FOR EACH ROW EXECUTE FUNCTION cutover_test_fail()' | Out-Null
    $failedDir=Join-Path $root 'partial-apply'
    Reject {& $cutover @arguments @apply -SourceBackup $sourceBackup -ReportDirectory $failedDir} 'Actual injected CLI failure did not fail.'
    $failed=Read-MentorCutoverJson (Join-Path $failedDir 'operation.json')
    Require (-not $failed.completed -and $failed.targetClosed -and $failed.targetBackup -and -not (Running $backend) -and -not (Running $web) -and @($failed.cleanupFailures).Count -eq 0) 'Partial apply did not preserve closed resumable state and cleanup.'
    Require (((Query "SELECT count(*) FROM import_run WHERE state='applying'") | Out-String).Trim() -eq '1') 'Actual partial durable import not retained.'
    Query 'DROP TRIGGER cutover_test_fail ON lesson; DROP FUNCTION cutover_test_fail()' | Out-Null
    Write-Output 'PASS actual partial CLI failure: durable applying row, verified pre-import backup retained, target closed, resources cleaned.'
    $resumeDir=Join-Path $root 'resumed'
    & $cutover @arguments @apply -SourceBackup $sourceBackup -ResumeReceipt (Join-Path $failedDir 'operation.json') -ReportDirectory $resumeDir | Out-Null
    $resumed=Read-MentorCutoverJson (Join-Path $resumeDir 'operation.json')
    Require ($resumed.completed -and $resumed.targetClosed -and -not (Running $backend) -and -not (Running $web)) 'Actual same-ID resume did not complete safely closed.'
    Require (((Query "SELECT count(*) FROM import_run WHERE state='completed'") | Out-String).Trim() -eq '1') 'Completed import not durably recorded.'
    $counts=Get-MentorCutoverJsonHash (Get-MentorTableCounts $postgres)
    Write-Output 'PASS actual matching ResumeReceipt: exact sourceDigest/bindings, preserved pre-import backup, completed importer.'
    # External filesystem fault after the durable prepared receipt, before final replacement.
    # No production fault switch; the saved receipt remains available for recovery.
    $finalizationDir=Join-Path $root 'finalization-fault'
    $watcher=Start-Job -ScriptBlock {
        param($Directory)
        $path=Join-Path $Directory 'operation.json';$deadline=[DateTime]::UtcNow.AddMinutes(5)
        while(-not (Test-Path -LiteralPath $path)){
            if([DateTime]::UtcNow -ge $deadline){throw 'Prepared receipt never appeared.'};Start-Sleep -Milliseconds 40
        }
        $saved=Join-Path $Directory 'prepared-operation.private.json'
        Move-Item -LiteralPath $path -Destination $saved
        New-Item -ItemType Directory -Path $path | Out-Null
        $stage=@(Get-ChildItem -LiteralPath $Directory -Directory -Filter 'private-stage-*');if($stage.Count -ne 1){throw 'Owned stage missing at preparation.'};Write-Output $stage[0].Name.Substring(14)
    } -ArgumentList $finalizationDir
    try {
        Reject {& $cutover @arguments @apply -SourceBackup $sourceBackup -ReportDirectory $finalizationDir} 'Receipt finalization failure was reported as success.'
        $watcher | Wait-Job -Timeout 10 | Out-Null
        Require ($watcher.State -eq 'Completed') 'External finalization fault was not installed.'
        $faultOperation=(Receive-Job $watcher -ErrorAction Stop | Out-String).Trim();Require ($faultOperation -match '^[a-f0-9]{32}$') 'Fault operation ownership missing.'
        $saved=Read-MentorCutoverJson (Join-Path $finalizationDir 'prepared-operation.private.json')
        Require (-not $saved.completed -and $saved.phase -eq 'prepared' -and $saved.targetBackup) 'Durable prepared backup bindings lost after finalization failure.'
        Require ((Test-Path -LiteralPath (Join-Path $finalizationDir 'apply-report.json')) -and -not (Running $backend) -and -not (Running $web) -and $counts -ceq (Get-MentorCutoverJsonHash (Get-MentorTableCounts $postgres))) 'Finalization fault changed rows or reopened target.'
        Require (((Invoke-MentorDocker @('ps','-aq','--filter',('label=ru.mentor.cutover='+$faultOperation))) | Out-String).Trim().Length -eq 0) 'Finalization failure leaked owned CLI containers.'
        Require (((Invoke-MentorDocker @('volume','ls','-q','--filter',('label=ru.mentor.cutover='+$faultOperation))) | Out-String).Trim().Length -eq 0) 'Finalization failure leaked its owned source/report volumes.'
        Remove-Item -LiteralPath (Join-Path $finalizationDir 'operation.json')
        Write-Output 'PASS actual finalization failure: no false completion, target closed, durable prepared receipt/verified backup retained, CLI resources cleaned.'
    } finally {if($watcher.State -eq 'Running'){Stop-Job $watcher};Remove-Job $watcher}
    $replayDir=Join-Path $root 'replayed'
    & $cutover @arguments @apply -SourceBackup $sourceBackup -ReportDirectory $replayDir | Out-Null
    $replayed=Read-MentorCutoverJson (Join-Path $replayDir 'operation.json')
    Require ($replayed.completed -and $counts -ceq (Get-MentorCutoverJsonHash (Get-MentorTableCounts $postgres)) -and -not (Running $backend) -and -not (Running $web)) 'Completed same-ID replay changed rows or reopened target.'
    Write-Output 'PASS completed same-ID replay: no duplicate rows and target remains closed.'
    $success=$true
    Write-MentorCutoverJson $receiptFile @{completed=$true;project=$project;root=$root;sourceDigest=$approval.sourceDigest;imageId=$imageId;cases=7;targetClosed=$true}
    Write-Output ('PASS actual cutover lifecycle7: '+$root)
} finally {
    if($prepared){Close-MentorCutoverSession $prepared | Out-Null}
    if($context -and -not $KeepFixture){Invoke-MentorCompose $context @('down','--volumes','--remove-orphans') | Out-Null}
    # Preserve this private synthetic lane/reports/backup evidence; never delete another fixture.
    Write-Output ('Synthetic cutover evidence retained: '+$root)
}