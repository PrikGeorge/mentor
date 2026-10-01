#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Snapshot,[Parameter(Mandatory)][string]$ImportId,
    [Parameter(Mandatory)][string]$TargetWorkspace,[Parameter(Mandatory)][string]$TeacherAccount,
    [Parameter(Mandatory)][string]$EnvironmentManifest,[Parameter(Mandatory)][string]$EnvironmentManifestSha256,
    [Parameter(Mandatory)][string]$EnvironmentProfilesSha256,[Parameter(Mandatory)][string]$BackendImage,
    [Parameter(Mandatory)][string]$ReportDirectory,[switch]$DryRun,[switch]$Apply,
    [string]$Approval,[string]$SourceBackup,[string]$ResumeReceipt,[string]$BackupDestination,[string]$PassphraseFile,
    [string]$EnvironmentFile,[string]$ProjectName='mentor-platform',
    [string]$ImmutableJar,[string]$JarSha256,[ValidateRange(1,2147483647)][long]$MaximumMaterialBytes=67108864
)
. (Join-Path $PSScriptRoot 'cutover-import.ps1')
. (Join-Path $PSScriptRoot 'cutover-backup.ps1')
if($DryRun -and $Apply){throw 'Choose one cutover mode; dry-run is the default.'}
foreach($path in @($Snapshot,$EnvironmentManifest,$ReportDirectory)){if(-not [IO.Path]::IsPathFullyQualified($path)){throw 'Snapshot, manifest and new report directory must be absolute.'}}
foreach($path in @($Approval,$SourceBackup,$ResumeReceipt,$BackupDestination,$PassphraseFile,$EnvironmentFile,$ImmutableJar)){if($path -and -not [IO.Path]::IsPathFullyQualified($path)){throw 'Optional administrative paths must be absolute.'}}
if($ImportId -notmatch '^[A-Za-z0-9_-]{1,100}$' -or $TargetWorkspace -notmatch '^[A-Za-z0-9_-]{1,100}$' -or [string]::IsNullOrWhiteSpace($TeacherAccount) -or $TargetWorkspace -match '[\x00-\x1f]' -or $TeacherAccount -match '[\x00-\x1f]'){throw 'Select an explicit import ID, target workspace and exact sole teacher account.'}
if($BackendImage -notmatch '^[A-Za-z0-9][A-Za-z0-9:/._@-]{0,511}$'){throw 'Choose an existing trusted backend image.'}
foreach($hash in @($EnvironmentManifestSha256,$EnvironmentProfilesSha256)){if($hash -notmatch '^[a-fA-F0-9]{64}$'){throw 'Trusted manifest and profile SHA256 pins are required.'}}
if($ImmutableJar -and $JarSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'An immutable JAR requires its exact SHA256 pin.'}
if(-not $ImmutableJar -and $JarSha256){throw 'A JAR pin must have a corresponding immutable JAR.'}
if($Apply -and (-not $Approval -or -not $EnvironmentFile -or -not $BackupDestination -or -not $PassphraseFile)){throw 'Apply requires a fresh approval, target environment and verified encrypted backups.'}
$Snapshot=[IO.Path]::GetFullPath($Snapshot);$ReportDirectory=[IO.Path]::GetFullPath($ReportDirectory)
$comparison=if($IsWindows){[StringComparison]::OrdinalIgnoreCase}else{[StringComparison]::Ordinal}
if([string]::Equals($Snapshot,$ReportDirectory,$comparison) -or $ReportDirectory.StartsWith($Snapshot.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar,$comparison)){throw 'Reports must be outside the closed source snapshot.'}
foreach($path in @($Snapshot,$ReportDirectory,$SourceBackup,$BackupDestination)){if($path){Assert-MentorCutoverPath $path $true}}
foreach($path in @($EnvironmentManifest,$Approval,$ResumeReceipt,$PassphraseFile,$EnvironmentFile,$ImmutableJar)){if($path){Assert-MentorCutoverPath $path $false -MustExist}}
foreach($output in @($BackupDestination,$(if($Apply){Split-Path -Parent $EnvironmentFile}))){if($output){$absolute=[IO.Path]::GetFullPath($output);if([string]::Equals($Snapshot,$absolute,$comparison) -or $absolute.StartsWith($Snapshot.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar,$comparison)){throw 'Administrative outputs and locks must be outside the closed source snapshot.'}}}
$auth=Read-MentorCutoverJson (Join-Path $Snapshot 'data/auth/accounts.json')
$teachers=@($auth.accounts | Where-Object {$_.role -ceq 'teacher'})
if($teachers.Count -ne 1 -or $teachers[0].id -cne $TeacherAccount){throw 'Select the exact sole source teacher; target ownership is never inferred.'}
$files=Get-MentorCutoverSourceFiles $Snapshot
$manifestSha=Get-MentorCutoverHash $EnvironmentManifest
if($manifestSha -cne $EnvironmentManifestSha256.ToLowerInvariant() -or (Get-MentorCutoverHash (Join-Path $Snapshot 'training/environments.json')) -cne $EnvironmentProfilesSha256.ToLowerInvariant()){throw 'Trusted environment pins differ from the supplied source/manifest.'}
$imageId=(Invoke-MentorDocker @('image','inspect','--format','{{.Id}}',$BackendImage) | Out-String).Trim();if($imageId -notmatch '^sha256:[a-f0-9]{64}$'){throw 'Backend image must resolve to one immutable local image.'}
$request=[ordered]@{importId=$ImportId;sourceDigest='';sourceFilesSha256=(Get-MentorCutoverJsonHash $files);imageId=$imageId;jarSha256=$(if($ImmutableJar){$JarSha256.ToLowerInvariant()}else{$null});environmentManifestSha256=$manifestSha;environmentProfilesSha256=$EnvironmentProfilesSha256.ToLowerInvariant();targetWorkspace=$TargetWorkspace;teacherAccount=$TeacherAccount;reportSha256='';maximumMaterialBytes=$MaximumMaterialBytes}
$previous=$null
if($Apply){
    Assert-MentorRegularPath $Approval $false | Out-Null
    $previous=Read-MentorCutoverJson $Approval
    $previousReport=Join-Path (Split-Path -Parent $Approval) 'dryrun-report.json'
    $rawPrevious=Read-MentorCutoverJson $previousReport
    $request.sourceDigest=$rawPrevious.sourceDigest;$request.reportSha256=Get-MentorCutoverHash $previousReport
    Assert-MentorCutoverApproval $previous $rawPrevious $request
    Test-MentorPassphraseFile $PassphraseFile
}
New-Item -ItemType Directory -Path (Split-Path -Parent $ReportDirectory) -Force | Out-Null
New-MentorPrivateDirectory $ReportDirectory
$session=$null;$maintenance=$null;$operationLock=$null;$context=$null;$stopped=$false;$failure=$null;$cleanup=@();$succeeded=$false
$receiptPath=Join-Path $ReportDirectory 'operation.json'
$receipt=[ordered]@{format=1;completed=$false;phase='preflight';createdAt=[DateTime]::UtcNow.ToString('o');importId=$ImportId;sourceDigest=$request.sourceDigest;sourceFilesSha256=$request.sourceFilesSha256;imageId=$imageId;jarSha256=$request.jarSha256;environmentManifestSha256=$manifestSha;environmentProfilesSha256=$request.environmentProfilesSha256;targetWorkspace=$TargetWorkspace;teacherAccount=$TeacherAccount;project=$ProjectName;sourceBackup=$null;targetBackup=$null;dryrunReport=$null;applyReport=$null;targetClosed=$false;userWritesOpened=$false;cleanupFailures=@();ownedPreparationResources=$null}
try {
    $session=New-MentorCutoverSession $Snapshot $EnvironmentManifest $ReportDirectory $imageId $ImmutableJar $request.jarSha256
    if($session.SourceFilesSha256 -cne $request.sourceFilesSha256 -or (Get-MentorCutoverHash (Join-Path $session.Stage 'environment.json')) -cne $manifestSha){throw 'Source or manifest changed after validation.'}
    $dryPath=Join-Path $ReportDirectory 'dryrun-report.json'
    $raw=Invoke-MentorCutoverCli $session $request $dryPath
    if($Apply -and $raw.sourceDigest -cne $request.sourceDigest){throw 'Current source digest differs from the successful approval.'}
    $request.sourceDigest=$raw.sourceDigest;$request.reportSha256=Get-MentorCutoverHash $dryPath
    if($Apply){Assert-MentorCutoverApproval $previous $raw $request}
    $receipt.sourceDigest=$request.sourceDigest;$receipt.dryrunReport=@{path=$dryPath;sha256=$request.reportSha256}
    $newApproval=[ordered]@{format=1;mode='dry-run';createdAt=[DateTime]::UtcNow.ToString('o')}
    foreach($key in $request.Keys){$newApproval[$key]=$request[$key]}
    $approvalPath=Join-Path $ReportDirectory 'approval.json';Write-MentorCutoverJson $approvalPath $newApproval
    if(-not $Apply){$receipt.phase='dry-run';$succeeded=$true}
    else {
        if($SourceBackup){$receipt.sourceBackup=Test-MentorCutoverSourceBackup $session $request $SourceBackup $PassphraseFile}
        else {$receipt.sourceBackup=New-MentorCutoverSourceBackup $session $request $approvalPath $dryPath $BackupDestination $PassphraseFile}
        $context=New-MentorPlatformContext $EnvironmentFile $ProjectName
        $operationPath=Join-Path (Split-Path -Parent $EnvironmentFile) ($ProjectName+'.cutover.lock')
        if((Test-Path -LiteralPath $operationPath) -and ((Get-Item -LiteralPath $operationPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Cutover operation lock must not be a link.'}
        $operationLock=[IO.File]::Open($operationPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $maintenance=Open-MentorMaintenanceLease $EnvironmentFile $ProjectName $null
        # Nothing can reopen this target between its closed verified backup and offline apply.
        $backend=Get-MentorServiceId $context 'backend';$web=Get-MentorServiceId $context 'web';$postgres=Get-MentorServiceId $context 'postgres'
        $deployment=((Invoke-MentorCompose $context @('config','--format','json')) -join "`n") | ConvertFrom-Json
        $configuredImage=(Invoke-MentorDocker @('image','inspect','--format','{{.Id}}',[string]$deployment.services.backend.image) | Out-String).Trim()
        $runningImage=(Invoke-MentorDocker @('inspect','--format','{{.Image}}',$backend) | Out-String).Trim()
        if($configuredImage -cne $imageId -or $runningImage -cne $imageId){throw 'Configured and existing target backend must use the exact selected immutable importer image before cutover.'}
        if($ImmutableJar){
            $targetJar=Join-Path $session.Stage 'target-app.jar';Invoke-MentorDocker @('cp',($backend+':/opt/mentor/app.jar'),(ConvertTo-MentorDockerPath $targetJar)) | Out-Null
            if((Get-MentorCutoverHash $targetJar) -cne $request.jarSha256){throw 'The configured target application JAR differs from the immutable importer JAR; prepare the matching target image first.'}
        }
        $stopped=$true;Invoke-MentorCompose $context @('stop','--timeout','35','backend','web') | Out-Null;$receipt.targetClosed=$true
        $incompleteQuery="SELECT COALESCE(json_agg(json_build_object('id',id,'sourceDigest',trim(source_digest),'targetWorkspace',target_workspace,'teacherAccount',source_teacher_id,'environmentManifestSha256',trim(approval_hash),'environmentProfilesSha256',trim(profiles_hash))),'[]'::json) FROM import_run WHERE state<>'completed'"
        $incomplete=@(((Invoke-MentorDocker @('exec',$postgres,'psql','-X','-U','mentor','-d','mentor','-At','-v','ON_ERROR_STOP=1','-c',$incompleteQuery)) -join "`n") | ConvertFrom-Json)
        if($ResumeReceipt){
            $resume=Read-MentorCutoverJson $ResumeReceipt
            if($resume.format -ne 1 -or $resume.completed -ne $false -or $resume.project -cne $ProjectName -or -not $resume.targetBackup){throw 'Resume requires the preserved prepared/failed receipt and its verified pre-import backup.'}
            Assert-MentorCutoverBindings $resume $request
            if($incomplete.Count -ne 1){throw 'Resume requires exactly this incomplete durable import. For completed imports use ordinary same-ID replay.'}
            foreach($field in @('id','sourceDigest','targetWorkspace','teacherAccount','environmentManifestSha256','environmentProfilesSha256')){$expected=if($field -eq 'id'){$request.importId}else{$request[$field]};if($incomplete[0].$field -cne $expected){throw 'An unrelated or changed incomplete import cannot be resumed.'}}
            $saved=Test-MentorCutoverTargetBackup $resume.targetBackup.path
            foreach($field in @('sha256','receiptSha256','restoreReportSha256')){if($saved.$field -cne $resume.targetBackup.$field){throw 'The preserved pre-import backup or restore receipt has changed.'}}
            $receipt.targetBackup=$saved
        } else {
            if($incomplete.Count){throw 'An incomplete import exists. Use its preserved matching ResumeReceipt; do not back up partial data, wipe or roll back.'}
            New-Item -ItemType Directory -Path $BackupDestination -Force | Out-Null
            $before=@(Get-ChildItem -LiteralPath $BackupDestination -Directory -Force | Select-Object -ExpandProperty Name)
            & (Join-Path $PSScriptRoot 'backup.ps1') -Destination $BackupDestination -EnvironmentFile $EnvironmentFile -PassphraseFile $PassphraseFile -ProjectName $ProjectName -VerifyRestore -MaintenanceLease $maintenance.Stream | Out-Null
            Assert-MentorMaintenanceLease $maintenance.Stream $EnvironmentFile $ProjectName
            $fresh=@(Get-ChildItem -LiteralPath $BackupDestination -Directory -Force | Where-Object {$_.Name -match '^mentor-backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$' -and $_.Name -notin $before})
            if($fresh.Count -ne 1){throw 'Cannot identify the newly verified target backup.'}
            $receipt.targetBackup=Test-MentorCutoverTargetBackup $fresh[0].FullName
        }
        if((Get-MentorCutoverJsonHash (Get-MentorCutoverSourceFiles $Snapshot)) -cne $request.sourceFilesSha256){throw 'Closed source changed before apply; target remains closed.'}
        $receipt.phase='prepared';Write-MentorCutoverJson $receiptPath $receipt
        # Durable prepared receipt precedes every importer write, including an interrupted process.
        $applyPath=Join-Path $ReportDirectory 'apply-report.json'
        $applied=Invoke-MentorCutoverCli $session $request $applyPath -Apply -ComposeContext $context
        if($applied.sourceDigest -cne $request.sourceDigest){throw 'Importer completion digest differs; inspect the closed target.'}
        $receipt.applyReport=@{path=$applyPath;sha256=(Get-MentorCutoverHash $applyPath)};$receipt.phase='complete';$succeeded=$true
    }
} catch {
    $failure=$_;$receipt.phase='failed'
    if($failure.Exception.Data.Contains('mentor.cutover.cleanupFailures')){
        $receipt.cleanupFailures=@($failure.Exception.Data['mentor.cutover.cleanupFailures'])
        $receipt.ownedPreparationResources=$failure.Exception.Data['mentor.cutover.preparationResources']
    }
}
finally {
    $cleanup=Close-MentorCutoverSession $session
    if($cleanup.Count){$succeeded=$false;$receipt.phase='failed';$receipt.cleanupFailures+=$cleanup;if(-not $failure){$failure=[Management.Automation.ErrorRecord]::new([InvalidOperationException]::new('Owned cutover cleanup is incomplete.'),'CutoverCleanup','InvalidOperation',$null)}}
    if($failure -and $stopped){try{Invoke-MentorCompose $context @('stop','--timeout','35','backend','web') | Out-Null;$receipt.targetClosed=$true}catch{$receipt.targetClosed=$false;$receipt.cleanupFailures+=,'target_close_failed'}}
    $receipt.completed=$succeeded
    try {Write-MentorCutoverJson $receiptPath $receipt -Replace} catch {if(-not $failure){$failure=$_}}
    try {Close-MentorMaintenanceLease $maintenance} finally {if($operationLock){$operationLock.Dispose()}}
}
if($failure){throw $failure}
if($Apply){Write-Output ('Cutover import completed; target remains closed for explicit smoke/opening: '+$ReportDirectory)}else{Write-Output ('Cutover dry-run verified; target services/database/objects unchanged: '+$ReportDirectory)}