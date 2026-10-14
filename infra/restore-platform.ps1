#Requires -Version 7.2
# Restores an encrypted backup.ps1 snapshot INTO the working platform (database and objects of the
# named Compose project). Dry-run is the default and changes nothing; -Apply replaces live data.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Backup,
    [Parameter(Mandatory)][string]$PassphraseFile,
    [Parameter(Mandatory)][string]$EnvironmentFile,
    [Parameter(Mandatory)][string]$ReportDirectory,
    [string]$ProjectName = 'mentor-platform',
    [switch]$Apply,
    [string]$PreRestoreBackupDestination,
    [switch]$SkipPreRestoreBackup
)
. (Join-Path $PSScriptRoot 'maintenance-lease.ps1')
foreach ($path in @($Backup,$PassphraseFile,$EnvironmentFile,$ReportDirectory)) {
    if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Backup, passphrase, environment and report paths must be absolute.' }
}
if ($PreRestoreBackupDestination -and -not [IO.Path]::IsPathFullyQualified($PreRestoreBackupDestination)) { throw 'PreRestoreBackupDestination must be absolute.' }
if ($PreRestoreBackupDestination -and $SkipPreRestoreBackup) { throw 'Choose either -PreRestoreBackupDestination or -SkipPreRestoreBackup, not both.' }
if ($Apply -and -not $PreRestoreBackupDestination -and -not $SkipPreRestoreBackup) {
    throw 'Apply replaces the working database and objects. Provide -PreRestoreBackupDestination <absolute dir> for a fresh verified backup of the current state (the only rollback path), or -SkipPreRestoreBackup to proceed with no rollback at all.'
}
Test-MentorPassphraseFile $PassphraseFile
$backupPath = (Resolve-Path -LiteralPath $Backup).Path
$ReportDirectory = [IO.Path]::GetFullPath($ReportDirectory)
$comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
if ($ReportDirectory.StartsWith($backupPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar,$comparison) -or [string]::Equals($ReportDirectory,$backupPath,$comparison)) { throw 'The report directory must be a new directory outside the backup.' }
$receiptSource = Get-Content -LiteralPath (Join-Path $backupPath 'receipt.json') -Raw | ConvertFrom-Json
$encrypted = Join-Path $backupPath 'snapshot.tar.gpg'
if ($receiptSource.format -ne 1 -or $receiptSource.completed -ne $true -or $receiptSource.encrypted -ne $true -or -not (Test-Path -LiteralPath $encrypted -PathType Leaf) -or (Get-FileHash -LiteralPath $encrypted -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receiptSource.sha256) { throw 'Backup receipt/checksum is invalid; this copy cannot be restored.' }
$sourceRestoreVerified = ($receiptSource.PSObject.Properties['restoreVerified'] -and $receiptSource.restoreVerified -eq $true)

function Get-MentorComposeVolumeName($Configuration,[string]$Key,[string]$Project) {
    $name = $null
    $volumes = $Configuration.PSObject.Properties['volumes']
    if ($volumes -and $volumes.Value) {
        $entry = $volumes.Value.PSObject.Properties[$Key]
        if ($entry -and $entry.Value -and $entry.Value.PSObject.Properties['name']) { $name = [string]$entry.Value.name }
    }
    if (-not $name) { $name = $Project + '_' + $Key }
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$') { throw "Unexpected Compose volume name for $Key." }
    return $name
}
function Test-MentorCountsEqual($Actual,$Expected) {
    $expectedKeys = @($Expected.Keys | Sort-Object)
    $actualKeys = @($Actual.Keys | Sort-Object)
    if ($expectedKeys.Count -ne $actualKeys.Count) { return $false }
    for ($i = 0; $i -lt $expectedKeys.Count; $i++) {
        if ($expectedKeys[$i] -cne $actualKeys[$i] -or [long]$Actual[$actualKeys[$i]] -ne [long]$Expected[$expectedKeys[$i]]) { return $false }
    }
    return $true
}
function Write-MentorRestoreReceipt([string]$Path,$Value) {
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
function Get-MentorRunningState([string]$Id) {
    return ((Invoke-MentorDocker @('inspect','--format','{{.State.Running}}',$Id) | Out-String).Trim() -eq 'true')
}
function Wait-MentorPostgresReady([string]$Id) {
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        try { Invoke-MentorDocker @('exec',$Id,'pg_isready','-h','127.0.0.1','-U','mentor','-d','postgres') | Out-Null; return } catch { Start-Sleep -Milliseconds 500 }
    }
    throw 'The working PostgreSQL container did not become ready.'
}

$context = New-MentorPlatformContext $EnvironmentFile $ProjectName
$configuration = ((Invoke-MentorCompose $context @('config','--format','json')) -join "`n") | ConvertFrom-Json
$postgresVolume = Get-MentorComposeVolumeName $configuration 'postgres' $ProjectName
$objectsVolume = Get-MentorComposeVolumeName $configuration 'objects' $ProjectName
$postgres = Get-MentorServiceId $context 'postgres'
$backend = Get-MentorServiceId $context 'backend'
$web = Get-MentorServiceId $context 'web'
$backendImage = (Invoke-MentorDocker @('inspect','--format','{{.Config.Image}}',$backend) | Out-String).Trim()
if ($backendImage -notmatch '^[A-Za-z0-9][A-Za-z0-9:/._@-]{0,511}$') { throw 'Cannot determine the backend image of the working platform.' }
$running = [ordered]@{ postgres=(Get-MentorRunningState $postgres); backend=(Get-MentorRunningState $backend); web=(Get-MentorRunningState $web) }

New-Item -ItemType Directory -Path (Split-Path -Parent $ReportDirectory) -Force | Out-Null
New-MentorPrivateDirectory $ReportDirectory
$stage = Join-Path $ReportDirectory 'private-stage'
New-MentorPrivateDirectory $stage
$receiptPath = Join-Path $ReportDirectory 'restore-receipt.json'
$receipt = [ordered]@{
    format=1; completed=$false; mode=$(if ($Apply) { 'apply' } else { 'dry-run' }); phase='preflight'
    createdAt=[DateTime]::UtcNow.ToString('o'); project=$ProjectName
    backup=[ordered]@{ path=$backupPath; sha256=$receiptSource.sha256; createdAt=$receiptSource.createdAt; restoreVerified=$sourceRestoreVerified }
    backupCounts=$null; backupObjectCount=$null; currentCounts=$null
    postgresVolume=$postgresVolume; objectsVolume=$objectsVolume; backendImage=$backendImage
    preRestoreBackup=$null; preRestoreBackupSkipped=[bool]$SkipPreRestoreBackup
    servicesStopped=$false; servicesStarted=$false; restoredCounts=$null; restoredObjectCount=$null; status=$null
    cleanupFailures=@()
}
$maintenance = $null; $stopped = $false; $dumpCopied = $false; $failure = $null; $succeeded = $false
$dumpName = 'mentor-restore-' + [Guid]::NewGuid().ToString('N') + '.dump'
try {
    # Phase 1 (both modes): prove the passphrase, archive layout and checksums before anything is touched.
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
    if ((ConvertTo-Json -InputObject $objects -Depth 8 -Compress) -ne (ConvertTo-Json -InputObject $manifest.objects -Depth 8 -Compress)) { throw 'Extracted object checksums differ from the backup manifest.' }
    $backupCounts = [ordered]@{}
    foreach ($table in @($manifest.counts.Keys | Sort-Object)) {
        if ($table -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Unexpected table identifier in the backup manifest.' }
        $backupCounts[$table] = [long]$manifest.counts[$table]
    }
    $receipt.backupCounts = $backupCounts; $receipt.backupObjectCount = $objects.Count
    $currentCounts = $null
    if ($running.postgres) { try { $currentCounts = Get-MentorTableCounts $postgres } catch { $currentCounts = $null } }
    $receipt.currentCounts = $currentCounts
    $rowSum = { param($Counts) if ($null -eq $Counts) { 'unavailable' } else { [string](($Counts.Values | Measure-Object -Sum).Sum) + ' rows in ' + $Counts.Count + ' tables' } }
    $plan = @(
        "Restore plan for Compose project '$ProjectName':",
        "  backup: $backupPath",
        "    created $($receiptSource.createdAt); ciphertext sha256 $($receiptSource.sha256); restore-test verified: $sourceRestoreVerified",
        "    database: $(& $rowSum $backupCounts); objects: $($objects.Count) files",
        "  current database: $(& $rowSum $currentCounts)",
        "  services: stop backend and web (running now: backend=$($running.backend), web=$($running.web), postgres=$($running.postgres))",
        "  database: drop and recreate 'mentor' inside volume $postgresVolume, then pg_restore and compare table counts",
        "  objects: empty volume $objectsVolume, copy backup objects, chown 10001:10001, verify checksums (image $backendImage)",
        "  pre-restore backup of the current state: $(if ($SkipPreRestoreBackup) { 'SKIPPED - the current data will be unrecoverable' } elseif ($PreRestoreBackupDestination) { $PreRestoreBackupDestination + ' (backup.ps1 -VerifyRestore)' } else { 'required for -Apply (-PreRestoreBackupDestination)' })",
        "  afterwards: start-platform.ps1 and status-platform.ps1 with this environment file",
        "  receipt: $receiptPath"
    )
    $plan | Write-Output
    if (-not $Apply) {
        $receipt.phase = 'dry-run'; $succeeded = $true
    } else {
        $maintenance = Open-MentorMaintenanceLease $EnvironmentFile $ProjectName $null
        if ($SkipPreRestoreBackup) {
            Write-Warning 'Pre-restore backup skipped: after the services stop, the current database and objects cannot be recovered.'
        } else {
            $receipt.phase = 'pre-restore-backup'; Write-MentorRestoreReceipt $receiptPath $receipt
            New-Item -ItemType Directory -Path $PreRestoreBackupDestination -Force | Out-Null
            $before = @(Get-ChildItem -LiteralPath $PreRestoreBackupDestination -Directory -Force | Select-Object -ExpandProperty Name)
            & (Join-Path $PSScriptRoot 'backup.ps1') -Destination $PreRestoreBackupDestination -EnvironmentFile $EnvironmentFile -PassphraseFile $PassphraseFile -ProjectName $ProjectName -VerifyRestore -MaintenanceLease $maintenance.Stream | Out-Null
            Assert-MentorMaintenanceLease $maintenance.Stream $EnvironmentFile $ProjectName
            $fresh = @(Get-ChildItem -LiteralPath $PreRestoreBackupDestination -Directory -Force | Where-Object { $_.Name -match '^mentor-backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$' -and $_.Name -notin $before })
            if ($fresh.Count -ne 1) { throw 'Cannot identify the fresh pre-restore backup; the working platform was not changed.' }
            $preReceipt = Get-Content -LiteralPath (Join-Path $fresh[0].FullName 'receipt.json') -Raw | ConvertFrom-Json
            if ($preReceipt.completed -ne $true -or $preReceipt.restoreVerified -ne $true) { throw 'The pre-restore backup is not complete and verified; the working platform was not changed.' }
            $receipt.preRestoreBackup = [ordered]@{ path=$fresh[0].FullName; sha256=$preReceipt.sha256 }
            Write-Output ('Pre-restore backup verified: ' + $fresh[0].FullName)
        }
        # Point of no return: from here the working data is being replaced.
        $receipt.phase = 'stopping'; Write-MentorRestoreReceipt $receiptPath $receipt
        Invoke-MentorCompose $context @('stop','--timeout','35','backend','web') | Out-Null
        $stopped = $true; $receipt.servicesStopped = $true
        if (-not (Get-MentorRunningState $postgres)) { Invoke-MentorCompose $context @('start','postgres') | Out-Null }
        Wait-MentorPostgresReady $postgres
        $receipt.phase = 'replacing-database'; Write-MentorRestoreReceipt $receiptPath $receipt
        Invoke-MentorDocker @('exec',$postgres,'psql','-X','-U','mentor','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c','DROP DATABASE IF EXISTS mentor WITH (FORCE)') | Out-Null
        Invoke-MentorDocker @('exec',$postgres,'psql','-X','-U','mentor','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE mentor OWNER mentor') | Out-Null
        Invoke-MentorDocker @('cp',(ConvertTo-MentorDockerPath (Join-Path $stage 'database.dump')),($postgres + ':/tmp/' + $dumpName)) | Out-Null
        $dumpCopied = $true
        Invoke-MentorDocker @('exec',$postgres,'pg_restore','--exit-on-error','--no-owner','-U','mentor','-d','mentor',('/tmp/' + $dumpName)) | Out-Null
        $restoredCounts = Get-MentorTableCounts $postgres
        if (-not (Test-MentorCountsEqual $restoredCounts $backupCounts)) { throw 'Restored table counts differ from the backup manifest; services remain stopped.' }
        $receipt.restoredCounts = $restoredCounts
        $receipt.phase = 'replacing-objects'; Write-MentorRestoreReceipt $receiptPath $receipt
        Invoke-MentorDocker @('run','--rm','--network','none','--user','0:0','--volume',($objectsVolume + ':/objects'),'--entrypoint','sh',$backendImage,'-c','find /objects -mindepth 1 -delete') | Out-Null
        Invoke-MentorDocker @('cp',((ConvertTo-MentorDockerPath (Join-Path $stage 'objects')) + '/.'),($backend + ':/var/lib/mentor/objects')) | Out-Null
        # docker cp does not guarantee ownership suitable for the nonroot application.
        Invoke-MentorDocker @('run','--rm','--network','none','--user','0:0','--volume',($objectsVolume + ':/objects'),'--entrypoint','sh',$backendImage,'-c','chown -R 10001:10001 /objects && chmod 700 /objects && find /objects -type f -exec chmod 600 {} +') | Out-Null
        Invoke-MentorDocker @('run','--rm','--network','none','--user','10001:10001','--volume',($objectsVolume + ':/objects:ro'),'--entrypoint','sh',$backendImage,'-c','for object in /objects/*; do [ -e "$object" ] || continue; cat "$object" >/dev/null || exit 3; done') | Out-Null
        $verify = Join-Path $stage 'verify-objects'
        New-Item -ItemType Directory -Path $verify | Out-Null
        Invoke-MentorDocker @('cp',($backend + ':/var/lib/mentor/objects/.'),(ConvertTo-MentorDockerPath $verify)) | Out-Null
        $restoredObjects = Get-MentorObjectManifest $verify
        if ((ConvertTo-Json -InputObject $restoredObjects -Depth 8 -Compress) -ne (ConvertTo-Json -InputObject $objects -Depth 8 -Compress)) { throw 'Restored volume object checksums differ; services remain stopped.' }
        $receipt.restoredObjectCount = $restoredObjects.Count
        $receipt.phase = 'restored'; Write-MentorRestoreReceipt $receiptPath $receipt
        # start-platform.ps1 owns the same maintenance lock, so release it before the readiness check.
        Close-MentorMaintenanceLease $maintenance; $maintenance = $null
        & (Join-Path $PSScriptRoot 'start-platform.ps1') -EnvironmentFile $EnvironmentFile -ProjectName $ProjectName | Out-Null
        $receipt.servicesStarted = $true; $stopped = $false
        $statusText = (& (Join-Path $PSScriptRoot 'status-platform.ps1') -EnvironmentFile $EnvironmentFile -ProjectName $ProjectName) -join "`n"
        $statusExit = $LASTEXITCODE
        try { $receipt.status = $statusText | ConvertFrom-Json } catch { $receipt.status = $null }
        if ($statusExit -ne 0) { throw 'The platform started but status-platform.ps1 reports it is not ready; inspect backend/PostgreSQL logs.' }
        $receipt.phase = 'complete'; $succeeded = $true
    }
} catch {
    $failure = $_; $receipt.phase = 'failed'
} finally {
    try {
        if ($dumpCopied) { try { Invoke-MentorDocker @('exec',$postgres,'rm','-f',('/tmp/' + $dumpName)) | Out-Null } catch { $receipt.cleanupFailures += 'database_dump_cleanup_failed' } }
        if ($failure -and $stopped) {
            # A failed replacement leaves the platform closed: partially restored data must not be served.
            try { Invoke-MentorCompose $context @('stop','--timeout','35','backend','web') | Out-Null; $receipt.servicesStopped = $true } catch { $receipt.cleanupFailures += 'services_close_failed' }
        }
    } finally {
        $receipt.completed = $succeeded
        try { Write-MentorRestoreReceipt $receiptPath $receipt } catch { if (-not $failure) { $failure = $_ } }
        try { Close-MentorMaintenanceLease $maintenance }
        finally { try { Remove-MentorOwnedDirectory $stage $ReportDirectory } catch { $receipt.cleanupFailures += 'private_stage_cleanup_failed' } }
    }
}
if ($failure) {
    if ($stopped) { Write-Warning ('Restore failed after the services were stopped; backend and web remain stopped. ' + $(if ($receipt.preRestoreBackup) { 'The previous state is in the pre-restore backup: ' + $receipt.preRestoreBackup.path } else { 'No pre-restore backup exists; the previous state cannot be recovered by this script.' }) + ' Receipt: ' + $receiptPath) }
    throw $failure
}
if (-not $Apply) {
    Write-Output "Dry-run only: the passphrase, archive and checksums are valid; nothing was stopped or changed. Receipt: $receiptPath"
    Write-Output 'To replace the working data, repeat with -Apply and -PreRestoreBackupDestination <absolute dir> (or -SkipPreRestoreBackup).'
} else {
    Write-Output "Working platform restored from $backupPath; receipt: $receiptPath"
    Write-Output $(if ($receipt.preRestoreBackup) { 'The previous state exists only in the pre-restore backup: ' + $receipt.preRestoreBackup.path } else { 'No pre-restore backup was made: the previous state is gone.' })
}
