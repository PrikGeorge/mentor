#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$EnvironmentFile,
    [Parameter(Mandatory)][string]$PassphraseFile,
    [string]$ProjectName = 'mentor-platform',
    [string]$OffsiteDirectory,
    [switch]$Scheduled,
    [switch]$VerifyRestore,
    [IO.FileStream]$MaintenanceLease
)
. (Join-Path $PSScriptRoot 'maintenance-lease.ps1')
foreach ($path in @($Destination,$PassphraseFile)) {
    if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Backup and passphrase paths must be absolute.' }
}
if ($Scheduled -and -not $OffsiteDirectory) { throw 'Scheduled backups require an explicitly configured off-host directory.' }
if ($OffsiteDirectory -and -not [IO.Path]::IsPathFullyQualified($OffsiteDirectory)) { throw 'OffsiteDirectory must be absolute.' }
Test-MentorPassphraseFile $PassphraseFile
$context = New-MentorPlatformContext $EnvironmentFile $ProjectName
if($null -ne $MaintenanceLease){Assert-MentorMaintenanceLease $MaintenanceLease $EnvironmentFile $ProjectName}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$backupName = 'mentor-backup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N')
$backup = Join-Path $Destination $backupName
$stage = Join-Path $backup 'private-stage'
New-MentorPrivateDirectory $backup
New-MentorPrivateDirectory $stage
$maintenance = $null
$resume = $false
$postgres = $null
$fence = $null
$dumpName = 'mentor-backup-' + [Guid]::NewGuid().ToString('N') + '.dump'
try {
    $maintenance = Open-MentorMaintenanceLease $EnvironmentFile $ProjectName $MaintenanceLease
    $postgres = Get-MentorServiceId $context 'postgres'
    $backend = Get-MentorServiceId $context 'backend'
    $resume = ((Invoke-MentorDocker @('inspect','--format','{{.State.Running}}',$backend) | Out-String).Trim() -eq 'true')
    # No application writes or object cleanup while both parts of the snapshot are taken.
    if ($resume) { Invoke-MentorCompose $context @('stop','--timeout','35','backend') | Out-Null }
    $fence = New-MentorBackupFence $postgres
    $counts = Get-MentorTableCounts $postgres $fence
    Invoke-MentorDocker @('exec',$postgres,'pg_dump','-U','mentor','-d','mentor','--format=custom',('--snapshot=' + $fence.Snapshot),('--file=/tmp/' + $dumpName)) | Out-Null
    Invoke-MentorDocker @('cp',($postgres + ':/tmp/' + $dumpName),(ConvertTo-MentorDockerPath (Join-Path $stage 'database.dump'))) | Out-Null
    $objects = Join-Path $stage 'objects'
    New-Item -ItemType Directory -Path $objects | Out-Null
    Invoke-MentorDocker @('cp',($backend + ':/var/lib/mentor/objects/.'),(ConvertTo-MentorDockerPath $objects)) | Out-Null
    $objectManifest = Get-MentorObjectManifest $objects
    $manifest = [ordered]@{
        format=1; createdAt=[DateTime]::UtcNow.ToString('o'); project=$ProjectName
        databaseSha256=(Get-FileHash -LiteralPath (Join-Path $stage 'database.dump') -Algorithm SHA256).Hash.ToLowerInvariant()
        counts=$counts; objects=$objectManifest
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8NoBOM
    Assert-MentorBackupFence $fence
    Close-MentorBackupFence $fence; $fence=$null
    # Resume promptly; archive/encryption runs on the closed local snapshot.
    if ($resume) { Invoke-MentorCompose $context @('start','backend') | Out-Null; $resume=$false }
    $archive = Join-Path $stage 'snapshot.tar'
    & tar -cf $archive -C $stage manifest.json database.dump objects
    if ($LASTEXITCODE -ne 0) { throw 'Backup archive creation failed.' }
    $encrypted = Join-Path $backup 'snapshot.tar.gpg'
    Invoke-MentorGpg encrypt $PassphraseFile $archive $encrypted
    $cipherHash = (Get-FileHash -LiteralPath $encrypted -Algorithm SHA256).Hash.ToLowerInvariant()
    $offsiteVerified = $false
    if ($OffsiteDirectory) {
        $remoteBackup = Join-Path $OffsiteDirectory $backupName
        if (Test-Path -LiteralPath $remoteBackup) { throw 'Offsite backup already exists.' }
        New-Item -ItemType Directory -Path $remoteBackup | Out-Null
        Copy-Item -LiteralPath $encrypted -Destination (Join-Path $remoteBackup 'snapshot.tar.gpg')
        if ((Get-FileHash -LiteralPath (Join-Path $remoteBackup 'snapshot.tar.gpg') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $cipherHash) { throw 'Offsite checksum mismatch.' }
        $offsiteVerified=$true
    }
    $receipt = [ordered]@{ format=1; completed=$true; createdAt=$manifest.createdAt; sha256=$cipherHash; encrypted=$true; offsiteVerified=$offsiteVerified; restoreVerified=$false }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'receipt.json') -Encoding utf8NoBOM
    if ($offsiteVerified) { Copy-Item -LiteralPath (Join-Path $backup 'receipt.json') -Destination (Join-Path $remoteBackup 'receipt.json') }
    if ($Scheduled -or $VerifyRestore) {
        $backendImage=(Invoke-MentorDocker @('inspect','--format','{{.Config.Image}}',$backend) | Out-String).Trim()
        & (Join-Path $PSScriptRoot 'restore-test.ps1') -Backup $backup -PassphraseFile $PassphraseFile -BackendImage $backendImage
        if ((Get-Content -LiteralPath (Join-Path $backup 'restore-report.json') -Raw | ConvertFrom-Json).completed -ne $true) { throw 'Scheduled restore verification did not complete.' }
        $receipt.restoreVerified=$true
        $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'receipt.json') -Encoding utf8NoBOM
        if ($offsiteVerified) {
            Copy-Item -LiteralPath (Join-Path $backup 'receipt.json'),(Join-Path $backup 'restore-report.json') -Destination $remoteBackup
        }
    }
    if ($Scheduled -and $offsiteVerified -and $receipt.restoreVerified) {
        Remove-MentorExpiredBackups $Destination
        Remove-MentorExpiredBackups $OffsiteDirectory
    }
    Write-Output "Encrypted consistent backup: $backup"
} catch {
    [ordered]@{ completed=$false; failedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'failed.json') -Encoding utf8NoBOM
    throw
} finally {
    try {
        try { if ($postgres) { Invoke-MentorDocker @('exec',$postgres,'rm','-f',('/tmp/' + $dumpName)) | Out-Null } }
        finally {
            try { if ($fence) { Close-MentorBackupFence $fence; $fence=$null } }
            finally { if ($resume) { Invoke-MentorCompose $context @('start','backend') | Out-Null } }
        }
    } finally {
        Close-MentorMaintenanceLease $maintenance
        Remove-MentorOwnedDirectory $stage $backup
    }
}
