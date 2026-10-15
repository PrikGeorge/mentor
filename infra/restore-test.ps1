#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Backup,
    [Parameter(Mandatory)][string]$PassphraseFile,
    [string]$BackendImage = 'mentor-platform-backend:local'
)
. (Join-Path $PSScriptRoot 'platform-common.ps1')
if (-not [IO.Path]::IsPathFullyQualified($Backup) -or -not [IO.Path]::IsPathFullyQualified($PassphraseFile)) { throw 'Use absolute backup and passphrase paths.' }
$backupPath = (Resolve-Path -LiteralPath $Backup).Path
$receipt = Get-Content -LiteralPath (Join-Path $backupPath 'receipt.json') -Raw | ConvertFrom-Json
$encrypted = Join-Path $backupPath 'snapshot.tar.gpg'
if ($receipt.format -ne 1 -or $receipt.completed -ne $true -or $receipt.encrypted -ne $true -or (Get-FileHash -LiteralPath $encrypted -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receipt.sha256) { throw 'Backup receipt/checksum is invalid.' }
$id = [Guid]::NewGuid().ToString('N')
$name = 'mentor-restore-' + $id
$stage = Join-Path $backupPath ('restore-test-' + $id)
New-MentorPrivateDirectory $stage
$pgCreated = $false; $objectsCreated = $false; $pgVolumeCreated = $false; $objectVolumeCreated = $false
$reportPath = Join-Path $backupPath 'restore-report.json'
$failure = $null
$cleanupErrors = [Collections.Generic.List[string]]::new()
$successReport = $null
try {
    $archive = Join-Path $stage 'snapshot.tar'
    Invoke-MentorGpg decrypt $PassphraseFile $encrypted $archive
    $names = & tar -tf $archive
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect backup archive.' }
    if (@($names | Select-Object -Unique).Count -ne @($names).Count) { throw 'Duplicate archive entries rejected.' }
    foreach ($entry in $names) {
        if ($entry -notmatch '^(manifest[.]json|database[.]dump|objects/|objects/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$') { throw 'Unexpected archive path rejected.' }
    }
    $types = & tar -tvf $archive
    if ($LASTEXITCODE -ne 0 -or @($types | Where-Object { $_ -notmatch '^[d-]' }).Count -gt 0) { throw 'Archive links/special files rejected.' }
    & tar -xf $archive -C $stage
    if ($LASTEXITCODE -ne 0) { throw 'Backup extraction failed.' }
    $manifest = Get-Content -LiteralPath (Join-Path $stage 'manifest.json') -Raw | ConvertFrom-Json -AsHashtable
    if ($manifest.format -ne 1 -or (Get-FileHash -LiteralPath (Join-Path $stage 'database.dump') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.databaseSha256) { throw 'Database dump checksum mismatch.' }
    $objects = Get-MentorObjectManifest (Join-Path $stage 'objects')
    if ((ConvertTo-Json -InputObject $objects -Depth 8 -Compress) -ne (ConvertTo-Json -InputObject $manifest.objects -Depth 8 -Compress)) { throw 'Extracted object checksums differ.' }
    $secret = Join-Path $stage 'restore-password'
    [IO.File]::WriteAllText($secret,[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)))
    Invoke-MentorDocker @('volume','create',($name + '-pg')) | Out-Null; $pgVolumeCreated=$true
    Invoke-MentorDocker @('volume','create',($name + '-objects')) | Out-Null; $objectVolumeCreated=$true
    Invoke-MentorDocker @('run','--detach','--name',$name,'--network','none','--mount',("type=bind,src=$(ConvertTo-MentorDockerPath $secret),dst=/run/secrets/password,readonly"),'--volume',($name + '-pg:/var/lib/postgresql/data'),'--env','POSTGRES_DB=mentor','--env','POSTGRES_USER=mentor','--env','POSTGRES_PASSWORD_FILE=/run/secrets/password','postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24') | Out-Null
    $pgCreated=$true
    $ready=$false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        try { Invoke-MentorDocker @('exec',$name,'pg_isready','-h','127.0.0.1','-U','mentor','-d','mentor') | Out-Null; $ready=$true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'Fresh restore database did not become ready.' }
    Invoke-MentorDocker @('cp',(ConvertTo-MentorDockerPath (Join-Path $stage 'database.dump')),($name + ':/tmp/restore.dump')) | Out-Null
    Invoke-MentorDocker @('exec',$name,'pg_restore','--exit-on-error','--no-owner','-U','mentor','-d','mentor','/tmp/restore.dump') | Out-Null
    $counts = Get-MentorTableCounts $name
    if ((ConvertTo-Json -InputObject $counts -Compress) -ne (ConvertTo-Json -InputObject $manifest.counts -Compress)) { throw 'Restored table counts differ.' }
    Invoke-MentorDocker @('create','--name',($name + '-objects'),'--network','none','--volume',($name + '-objects:/var/lib/mentor/objects'),$BackendImage) | Out-Null
    $objectsCreated=$true
    Invoke-MentorDocker @('cp',((ConvertTo-MentorDockerPath (Join-Path $stage 'objects')) + '/.'),($name + '-objects:/var/lib/mentor/objects')) | Out-Null
    # docker cp does not guarantee ownership suitable for the nonroot application.
    Invoke-MentorDocker @('run','--rm','--network','none','--user','0:0','--volume',($name + '-objects:/objects'),'--entrypoint','sh',$BackendImage,'-c','chown -R 10001:10001 /objects && chmod 700 /objects && find /objects -type f -exec chmod 600 {} +') | Out-Null
    Invoke-MentorDocker @('run','--rm','--network','none','--user','10001:10001','--volume',($name + '-objects:/objects:ro'),'--entrypoint','sh',$BackendImage,'-c','for object in /objects/*; do [ -e "$object" ] || continue; cat "$object" >/dev/null || exit 3; done') | Out-Null
    $verify = Join-Path $stage 'verify-objects'
    New-Item -ItemType Directory -Path $verify | Out-Null
    Invoke-MentorDocker @('cp',($name + '-objects:/var/lib/mentor/objects/.'),(ConvertTo-MentorDockerPath $verify)) | Out-Null
    $restoredObjects = Get-MentorObjectManifest $verify
    if ((ConvertTo-Json -InputObject $restoredObjects -Depth 8 -Compress) -ne (ConvertTo-Json -InputObject $objects -Depth 8 -Compress)) { throw 'Restored volume object checksums differ.' }
    $successReport = [ordered]@{ completed=$true; checkedAt=[DateTime]::UtcNow.ToString('o'); backupSha256=$receipt.sha256; counts=$counts; objectCount=$objects.Count; restoredChecksums=$restoredObjects; isolatedDatabase=$true; isolatedObjectVolume=$true; applicationUidReadable=$true }
} catch {
    $failure = $_
} finally {
    if ($name -notmatch '^mentor-restore-[a-f0-9]{32}$') { throw 'Refusing cleanup of an unexpected restore target.' }
    if ($objectsCreated) { try { Invoke-MentorDocker @('rm','--force',($name + '-objects')) | Out-Null } catch { $cleanupErrors.Add($name + '-objects container') } }
    if ($pgCreated) { try { Invoke-MentorDocker @('rm','--force',$name) | Out-Null } catch { $cleanupErrors.Add($name + ' database container') } }
    if ($objectVolumeCreated) { try { Invoke-MentorDocker @('volume','rm',($name + '-objects')) | Out-Null } catch { $cleanupErrors.Add($name + '-objects volume') } }
    if ($pgVolumeCreated) { try { Invoke-MentorDocker @('volume','rm',($name + '-pg')) | Out-Null } catch { $cleanupErrors.Add($name + '-pg volume') } }
    try { Remove-MentorOwnedDirectory $stage $backupPath } catch { $cleanupErrors.Add('private restore stage') }
}
if ($failure -or $cleanupErrors.Count) {
    [ordered]@{ completed=$false; checkedAt=[DateTime]::UtcNow.ToString('o'); backupSha256=$receipt.sha256; cleanupErrors=@($cleanupErrors) } | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding utf8NoBOM
    if ($failure) { throw $failure }
    throw 'Restore cleanup was incomplete; inspect restore-report.json.'
}
$successReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8NoBOM
Write-Output "Restore verified in a new isolated database and object volume: $reportPath"
