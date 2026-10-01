# Closed source backup: encrypted bytes plus exact provenance, independent of target DB/object snapshots.
. (Join-Path $PSScriptRoot 'cutover-common.ps1')
function New-MentorCutoverSourceBackup($Session,$Request,[string]$ApprovalPath,[string]$ReportPath,[string]$Destination,[string]$PassphraseFile){
    Test-MentorPassphraseFile $PassphraseFile
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $backup=Join-Path $Destination ('mentor-source-backup-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N'))
    New-MentorPrivateDirectory $backup
    Copy-Item -LiteralPath $ApprovalPath -Destination (Join-Path $Session.Stage 'approval.json')
    Copy-Item -LiteralPath $ReportPath -Destination (Join-Path $Session.Stage 'dryrun-report.json')
    $archive=Join-Path $Session.Stage 'closed-source.tar'
    & tar -cf $archive -C $Session.Stage snapshot environment.json source-manifest.json approval.json dryrun-report.json
    if($LASTEXITCODE -ne 0){throw 'Closed source archive creation failed.'}
    $cipher=Join-Path $backup 'snapshot.tar.gpg';Invoke-MentorGpg encrypt $PassphraseFile $archive $cipher
    $decrypted=Join-Path $Session.Stage 'source-backup-verified.tar';Invoke-MentorGpg decrypt $PassphraseFile $cipher $decrypted
    $archiveSha=Get-MentorCutoverHash $archive
    if((Get-MentorCutoverHash $decrypted) -cne $archiveSha){throw 'Encrypted source backup did not reproduce the exact archive.'}
    $receipt=[ordered]@{format=1;completed=$true;encrypted=$true;verified=$true;createdAt=[DateTime]::UtcNow.ToString('o');importId=$Request.importId;sourceDigest=$Request.sourceDigest;sourceFilesSha256=$Request.sourceFilesSha256;imageId=$Request.imageId;jarSha256=$Request.jarSha256;environmentManifestSha256=$Request.environmentManifestSha256;environmentProfilesSha256=$Request.environmentProfilesSha256;targetWorkspace=$Request.targetWorkspace;teacherAccount=$Request.teacherAccount;reportSha256=(Get-MentorCutoverHash $ReportPath);approvalSha256=(Get-MentorCutoverHash $ApprovalPath);archiveSha256=$archiveSha;sha256=(Get-MentorCutoverHash $cipher)}
    Write-MentorCutoverJson (Join-Path $backup 'receipt.json') $receipt
    return $backup
}
function Test-MentorCutoverSourceBackup($Session,$Request,[string]$Backup,[string]$PassphraseFile){
    Assert-MentorRegularPath $Backup $true | Out-Null
    $receipt=Read-MentorCutoverJson (Join-Path $Backup 'receipt.json')
    if($receipt.format -ne 1 -or $receipt.completed -ne $true -or $receipt.encrypted -ne $true -or $receipt.verified -ne $true){throw 'A completed, verified encrypted source backup is required.'}
    Assert-MentorCutoverBindings $receipt $Request
    if((Get-MentorCutoverHash (Join-Path $Backup 'snapshot.tar.gpg')) -cne $receipt.sha256){throw 'Source backup ciphertext checksum differs.'}
    $archive=Join-Path $Session.Stage 'source-backup-verify.tar';Invoke-MentorGpg decrypt $PassphraseFile (Join-Path $Backup 'snapshot.tar.gpg') $archive
    if((Get-MentorCutoverHash $archive) -cne $receipt.archiveSha256){throw 'Source backup plaintext archive checksum differs.'}
    $expected=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach($name in @('environment.json','source-manifest.json','approval.json','dryrun-report.json','snapshot/')){$expected.Add($name) | Out-Null}
    foreach($file in $Session.Files){$name='snapshot/'+$file.path;$expected.Add($name) | Out-Null;$parent=$name;while($parent.Contains('/')){$parent=$parent.Substring(0,$parent.LastIndexOf('/'));$expected.Add($parent+'/') | Out-Null}}
    $members=@(& tar -tf $archive);if($LASTEXITCODE -ne 0){throw 'Source backup archive is invalid.'}
    $unique=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach($member in $members){if(-not $expected.Contains($member) -or -not $unique.Add($member)){throw 'Source backup contains unexpected or duplicate archive entries.'}}
    if($unique.Count -ne $expected.Count){throw 'Source backup archive is incomplete.'}
    $types=@(& tar -tvf $archive);if($LASTEXITCODE -ne 0 -or @($types | Where-Object {$_ -notmatch '^[d-]'}).Count){throw 'Source backup links and special entries are forbidden.'}
    $verify=Join-Path $Session.Stage 'verified-source-backup';New-MentorPrivateDirectory $verify
    & tar -xf $archive -C $verify;if($LASTEXITCODE -ne 0){throw 'Cannot verify source backup contents.'}
    if((Get-MentorCutoverJsonHash (Get-MentorCutoverSourceFiles (Join-Path $verify 'snapshot'))) -cne $Request.sourceFilesSha256 -or (Get-MentorCutoverHash (Join-Path $verify 'environment.json')) -cne $Request.environmentManifestSha256){throw 'Source backup bytes do not match the approved closed source and manifest.'}
    if((Get-MentorCutoverHash (Join-Path $verify 'dryrun-report.json')) -cne $receipt.reportSha256 -or $receipt.reportSha256 -cne $Request.reportSha256 -or (Get-MentorCutoverHash (Join-Path $verify 'approval.json')) -cne $receipt.approvalSha256){throw 'Source backup reports have changed.'}
    $archived=Read-MentorCutoverJson (Join-Path $verify 'approval.json');Assert-MentorCutoverBindings $archived $Request
    if($archived.format -ne 1 -or $archived.mode -ne 'dry-run'){throw 'Source backup approval is invalid.'}
    $recorded=Read-MentorCutoverJson (Join-Path $verify 'source-manifest.json')
    if($recorded.format -ne 1 -or (Get-MentorCutoverJsonHash $recorded.files) -cne $Request.sourceFilesSha256){throw 'Source backup manifest differs.'}
    return $Backup
}
function Test-MentorCutoverTargetBackup([string]$Backup){
    Assert-MentorRegularPath $Backup $true | Out-Null
    $receiptPath=Join-Path $Backup 'receipt.json';$restorePath=Join-Path $Backup 'restore-report.json';$cipher=Join-Path $Backup 'snapshot.tar.gpg'
    $receipt=Read-MentorCutoverJson $receiptPath;$restore=Read-MentorCutoverJson $restorePath
    if($receipt.completed -ne $true -or $receipt.encrypted -ne $true -or $receipt.restoreVerified -ne $true -or $restore.completed -ne $true -or (Get-MentorCutoverHash $cipher) -cne $receipt.sha256){throw 'An actual verified encrypted pre-import target backup is required.'}
    return [pscustomobject]@{path=$Backup;sha256=$receipt.sha256;receiptSha256=(Get-MentorCutoverHash $receiptPath);restoreReportSha256=(Get-MentorCutoverHash $restorePath)}
}