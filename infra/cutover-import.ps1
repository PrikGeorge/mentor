# Isolated CLI source staging and container lifecycle; never mounts the original host snapshot.
. (Join-Path $PSScriptRoot 'cutover-common.ps1')
function New-MentorCutoverSession([string]$Snapshot,[string]$Manifest,[string]$ReportDirectory,[string]$ImageId,[string]$ImmutableJar,[string]$JarSha256){
    $operation=[guid]::NewGuid().ToString('N')
    $session=[pscustomobject]@{Operation=$operation;Stage=(Join-Path $ReportDirectory ('private-stage-'+$operation));ReportDirectory=$ReportDirectory;ImageId=$ImageId;Volume=('mentor-cutover-source-'+$operation);VolumeCreated=$false;ReportVolume=('mentor-cutover-report-'+$operation);ReportVolumeCreated=$false;Containers=[Collections.Generic.List[string]]::new();Files=@();SourceFilesSha256='';App='/opt/mentor/app.jar'}
    try {
        New-MentorPrivateDirectory $session.Stage
        $session.Files=Get-MentorCutoverSourceFiles $Snapshot;$session.SourceFilesSha256=Get-MentorCutoverJsonHash $session.Files
        $copy=Join-Path $session.Stage 'snapshot';New-Item -ItemType Directory -Path $copy | Out-Null
        foreach($entry in $session.Files){$path=Join-Path $copy $entry.path;New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null;Copy-Item -LiteralPath (Join-Path $Snapshot $entry.path) -Destination $path}
        if((Get-MentorCutoverJsonHash (Get-MentorCutoverSourceFiles $Snapshot)) -cne $session.SourceFilesSha256 -or (Get-MentorCutoverJsonHash (Get-MentorCutoverSourceFiles $copy)) -cne $session.SourceFilesSha256){throw 'Closed source changed while staging.'}
        Copy-Item -LiteralPath $Manifest -Destination (Join-Path $session.Stage 'environment.json')
        Write-MentorCutoverJson (Join-Path $session.Stage 'source-manifest.json') @{format=1;files=$session.Files}
        if($ImmutableJar){if((Get-MentorCutoverHash $ImmutableJar) -cne $JarSha256){throw 'Immutable importer JAR checksum differs.'};Copy-Item -LiteralPath $ImmutableJar -Destination (Join-Path $session.Stage 'app.jar');if((Get-MentorCutoverHash (Join-Path $session.Stage 'app.jar')) -cne $JarSha256){throw 'Importer JAR changed while staging.'};$session.App='/mentor-import/app.jar'}
        $volume=(Invoke-MentorDocker @('volume','create','--label',('ru.mentor.cutover='+$operation),$session.Volume) | Out-String).Trim();if($volume -cne $session.Volume){throw 'Unexpected source volume identity.'};$session.VolumeCreated=$true
        $reportVolume=(Invoke-MentorDocker @('volume','create','--label',('ru.mentor.cutover='+$operation),$session.ReportVolume) | Out-String).Trim();if($reportVolume -cne $session.ReportVolume){throw 'Unexpected report volume identity.'};$session.ReportVolumeCreated=$true
        $name='mentor-cutover-prepare-'+$operation
        $id=(Invoke-MentorDocker @('create','--pull','never','--name',$name,'--label',('ru.mentor.cutover='+$operation),'--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','--mount',('type=volume,source='+$session.Volume+',target=/mentor-import'),'--mount',('type=volume,source='+$session.ReportVolume+',target=/mentor-report'),'--entrypoint','/bin/sh',$ImageId,'-c','chmod 700 /mentor-report && chown 10001:10001 /mentor-report && find /mentor-import -type d -exec chmod 700 {} + && find /mentor-import -type f -exec chmod 600 {} + && chown -R 10001:10001 /mentor-import') | Out-String).Trim()
        if($id -notmatch '^[a-f0-9]{64}$'){throw 'Unexpected preparation container identity.'};$session.Containers.Add($id)
        Invoke-MentorDocker @('cp',((ConvertTo-MentorDockerPath $session.Stage)+'/.'),($id+':/mentor-import/')) | Out-Null
        Invoke-MentorDocker @('start',$id) | Out-Null
        if((Invoke-MentorDocker @('wait',$id) | Out-String).Trim() -ne '0'){Invoke-MentorDocker @('logs',$id) *> (Join-Path $ReportDirectory 'preparation-errors.private.log');throw 'Private source volume preparation failed; inspect its protected diagnostic.'}
        Invoke-MentorDocker @('rm',$id) | Out-Null;$session.Containers.Remove($id) | Out-Null
        return $session
    } catch {
        $preparationFailure=$_
        $cleanup=Close-MentorCutoverSession $session
        if($cleanup.Count){
            # The assignment has not returned a session to the caller. Carry only owned resource identities.
            $preparationFailure.Exception.Data['mentor.cutover.cleanupFailures']=$cleanup
            $preparationFailure.Exception.Data['mentor.cutover.preparationResources']=[pscustomobject]@{
                operationId=$session.Operation;containers=@($session.Containers)
                sourceVolume=$(if($session.VolumeCreated){$session.Volume}else{$null})
                reportVolume=$(if($session.ReportVolumeCreated){$session.ReportVolume}else{$null})
                privateStageCleanupFailed=($cleanup -contains 'private_stage_cleanup_failed')
            }
        }
        throw $preparationFailure
    }
}
function Invoke-MentorCutoverCli($Session,$Request,[string]$ReportPath,[switch]$Apply,[string[]]$ComposeContext){
    if(Test-Path -LiteralPath $ReportPath){throw 'CLI report must be new.'}
    $name='mentor-cutover-cli-'+[guid]::NewGuid().ToString('N')
    $arguments=@('-jar',$Session.App,'legacy-import',$(if($Apply){'--apply'}else{'--dry-run'}),'--source','/mentor-import/snapshot','--import-id',$Request.importId,'--environment-manifest','/mentor-import/environment.json','--environment-manifest-sha256',$Request.environmentManifestSha256,'--environment-profiles-sha256',$Request.environmentProfilesSha256,'--maximum-material-bytes',[string]$Request.maximumMaterialBytes,'--report',('/mentor-report/'+$name+'.json'))
    if($Apply){
        $arguments+=@('--target-workspace',$Request.targetWorkspace,'--teacher-account',$Request.teacherAccount)
        $override=Join-Path $Session.Stage 'compose-import.json';Write-MentorCutoverJson $override @{services=@{backend=@{image=$Session.ImageId}}}
        $context=$ComposeContext+@('-f',(ConvertTo-MentorDockerPath $override))
        $id=(Invoke-MentorCompose $context (@('run','--detach','--no-deps','--pull','never','--name',$name,'--label',('ru.mentor.cutover='+$Session.Operation),'--user','10001:10001','--entrypoint','java','--volume',($Session.Volume+':/mentor-import:ro'),'--volume',($Session.ReportVolume+':/mentor-report'),'backend')+$arguments) | Out-String).Trim()
    } else {
        $id=(Invoke-MentorDocker (@('create','--pull','never','--name',$name,'--label',('ru.mentor.cutover='+$Session.Operation),'--network','none','--user','10001:10001','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777','--mount',('type=volume,source='+$Session.Volume+',target=/mentor-import,readonly'),'--mount',('type=volume,source='+$Session.ReportVolume+',target=/mentor-report'),'--entrypoint','java',$Session.ImageId)+$arguments) | Out-String).Trim()
        if($id -notmatch '^[a-f0-9]{64}$'){throw 'Unexpected CLI container identity.'};$Session.Containers.Add($id);Invoke-MentorDocker @('start',$id) | Out-Null
    }
    if($id -notmatch '^[a-f0-9]{64}$'){throw 'Unexpected offline CLI container identity.'};if(-not $Session.Containers.Contains($id)){$Session.Containers.Add($id)}
    $status=(Invoke-MentorDocker @('wait',$id) | Out-String).Trim()
    if($status -ne '0'){Invoke-MentorDocker @('logs',$id) *> (Join-Path $Session.ReportDirectory 'cli-errors.private.log');if(-not $IsWindows){& chmod 600 -- (Join-Path $Session.ReportDirectory 'cli-errors.private.log')}}
    Invoke-MentorDocker @('cp',($id+':/mentor-report/'+$name+'.json'),(ConvertTo-MentorDockerPath $ReportPath)) | Out-Null
    $raw=Read-MentorCutoverJson $ReportPath
    if($status -ne '0' -or @($raw.errors).Count -ne 0 -or $raw.importId -cne $Request.importId -or $raw.sourceDigest -notmatch '^[a-f0-9]{64}$' -or $raw.completed -ne [bool]$Apply){throw 'Importer rejected the operation; inspect its private report and durable run before retrying.'}
    Invoke-MentorDocker @('rm',$id) | Out-Null;$Session.Containers.Remove($id) | Out-Null
    return $raw
}
function Close-MentorCutoverSession($Session){
    $failures=[Collections.Generic.List[string]]::new()
    if($null -eq $Session){return ,$failures.ToArray()}
    foreach($id in @($Session.Containers)){
        try {if($id -notmatch '^[a-f0-9]{64}$'){throw 'Unsafe container identity.'};Invoke-MentorDocker @('rm','--force',$id) | Out-Null;$Session.Containers.Remove($id) | Out-Null}catch{$failures.Add('container_cleanup_failed')}
    }
    if($Session.VolumeCreated){try{if($Session.Volume -notmatch '^mentor-cutover-source-[a-f0-9]{32}$'){throw 'Unsafe volume name.'};Invoke-MentorDocker @('volume','rm',$Session.Volume) | Out-Null;$Session.VolumeCreated=$false}catch{$failures.Add('volume_cleanup_failed')}}
    if($Session.ReportVolumeCreated){try{if($Session.ReportVolume -notmatch '^mentor-cutover-report-[a-f0-9]{32}$'){throw 'Unsafe report volume name.'};Invoke-MentorDocker @('volume','rm',$Session.ReportVolume) | Out-Null;$Session.ReportVolumeCreated=$false}catch{$failures.Add('report_volume_cleanup_failed')}}
    try {Remove-MentorOwnedDirectory $Session.Stage $Session.ReportDirectory}catch{$failures.Add('private_stage_cleanup_failed')}
    return ,$failures.ToArray()
}