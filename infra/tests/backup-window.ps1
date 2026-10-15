#Requires -Version 7.2
# Run the real backup script with synthetic files and strict command doubles, never Docker/WSL/GnuPG.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function SameArguments([string[]]$Actual, [string[]]$Expected) {
    Require (($Actual -join '|') -ceq ($Expected -join '|')) ('Unexpected command arguments: ' + ($Actual -join '|'))
}
function BytesHash([byte[]]$Bytes) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant() }
function Before([string]$First, [string]$Second) {
    $events = $global:MentorBackupWindow.Events
    Require ($events.IndexOf($First) -ge 0 -and $events.IndexOf($Second) -gt $events.IndexOf($First)) ($First + ' must precede ' + $Second + '. Events: ' + ($events -join ', '))
}
function docker { throw 'The backup window test must not invoke Docker.' }
function wsl { throw 'The backup window test must not invoke WSL.' }
function gpg { throw 'The backup window test must not invoke GnuPG.' }

$previousState = Get-Variable -Name MentorBackupWindow -Scope Global -ErrorAction SilentlyContinue
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$root = Join-Path $temporaryRoot ('mentor-backup-window-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$fixtureScript = Join-Path $root 'backup.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../backup.ps1') -Destination $fixtureScript
$commonPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../platform-common.ps1'))
$stub = @'
. ($global:MentorBackupWindow.CommonPath)
function New-MentorPrivateDirectory([string]$Path) {
    Require (-not (Test-Path -LiteralPath $Path)) 'Fixture private directory must be new.'
    New-Item -ItemType Directory -Path $Path | Out-Null
}
function New-MentorPlatformContext([string]$EnvironmentFile, [string]$ProjectName) {
    Require ($EnvironmentFile -ceq $global:MentorBackupWindow.EnvironmentFile -and $ProjectName -ceq 'mentor-window-test') 'Unexpected project/config.'
    return @('synthetic-compose-context')
}
function Open-MentorMaintenanceLease([string]$EnvironmentFile, [string]$ProjectName, $Borrowed) {
    Require ($EnvironmentFile -ceq $global:MentorBackupWindow.EnvironmentFile -and $ProjectName -ceq 'mentor-window-test' -and $null -eq $Borrowed) 'Unexpected maintenance lease.'
    $global:MentorBackupWindow.Events.Add('lease-open')
    $global:MentorBackupWindow.LeaseOpen = $true
    return [pscustomobject]@{ Synthetic = $true }
}
function Close-MentorMaintenanceLease($Lease) {
    $state = $global:MentorBackupWindow
    Require ($null -ne $Lease -and $Lease.Synthetic -and $state.LeaseOpen) 'Maintenance lease was lost or closed twice.'
    $operations = @(Get-ChildItem -LiteralPath $state.Destination -Directory)
    Require ($operations.Count -eq 1) 'Maintenance lease ended without its operation directory.'
    $hasReceipt = (Test-Path -LiteralPath (Join-Path $operations[0].FullName 'receipt.json')) -or (Test-Path -LiteralPath (Join-Path $operations[0].FullName 'failed.json'))
    Require $hasReceipt 'Maintenance lease ended before the operation receipt was written.'
    $state.Events.Add('lease-close')
    $state.LeaseOpen = $false
}
function Get-MentorServiceId([string[]]$Context, [string]$Service) {
    SameArguments $Context @('synthetic-compose-context')
    if ($Service -eq 'postgres') { return ('a' * 64) }
    if ($Service -eq 'backend') { return ('b' * 64) }
    throw 'Unexpected service.'
}
function Invoke-MentorCompose([string[]]$Context, [string[]]$ComposeArguments) {
    SameArguments $Context @('synthetic-compose-context')
    $state = $global:MentorBackupWindow
    if ($ComposeArguments[0] -eq 'stop') {
        SameArguments $ComposeArguments @('stop', '--timeout', '35', 'backend')
        Require $state.Running 'An already stopped backend was stopped again.'
        $state.Events.Add('stop'); $state.Running = $false
        return
    }
    SameArguments $ComposeArguments @('start', 'backend')
    Require (-not $state.Running -and -not $state.FenceOpen) 'Backend resumed before the fence was closed, or resumed twice.'
    $state.StartAttempts++
    $state.Events.Add('start-attempt')
    if ($state.Fault -eq 'start' -and $state.StartAttempts -eq 1) { throw 'Synthetic first start failure.' }
    $state.Running = $true
    $state.Events.Add('start')
    # Simulate writes/cleanup as soon as the application resumes; captured files must remain independent.
    [IO.File]::WriteAllText($state.SourceDatabase, 'database changed after restart')
    [IO.File]::WriteAllText((Join-Path $state.SourceObjects $state.ObjectNames[0]), 'object changed after restart')
    Remove-Item -LiteralPath (Join-Path $state.SourceObjects $state.ObjectNames[1])
    [IO.File]::WriteAllText((Join-Path $state.SourceObjects '33333333-3333-3333-3333-333333333333'), 'new object after restart')
    $state.SourceCounts = @{ student = 99; lesson = 101 }
}
function New-MentorBackupFence([string]$PostgresId) {
    Require ($PostgresId -ceq ('a' * 64) -and -not $global:MentorBackupWindow.Running) 'Fence opened while application writes were possible.'
    $global:MentorBackupWindow.Events.Add('fence-open')
    $global:MentorBackupWindow.FenceOpen = $true
    return [pscustomobject]@{ Snapshot = '00000001-00000001-1' }
}
function Get-MentorTableCounts([string]$PostgresId, $Fence) {
    Require ($PostgresId -ceq ('a' * 64) -and $Fence.Snapshot -ceq '00000001-00000001-1' -and $global:MentorBackupWindow.FenceOpen) 'Counts are not bound to the open snapshot.'
    $global:MentorBackupWindow.Events.Add('counts')
    return $global:MentorBackupWindow.SourceCounts.Clone()
}
function Assert-MentorBackupFence($Fence) {
    Require ($Fence.Snapshot -ceq '00000001-00000001-1' -and $global:MentorBackupWindow.FenceOpen) 'Unexpected fence assertion.'
    $global:MentorBackupWindow.Events.Add('fence-assert')
    if ($global:MentorBackupWindow.Fault -eq 'fence') { throw 'Synthetic fence lost.' }
}
function Close-MentorBackupFence($Fence) {
    Require ($Fence.Snapshot -ceq '00000001-00000001-1' -and $global:MentorBackupWindow.FenceOpen) 'Fence closed twice.'
    $global:MentorBackupWindow.FenceClosedAt = [DateTime]::UtcNow
    $global:MentorBackupWindow.Events.Add('fence-close')
    $global:MentorBackupWindow.FenceOpen = $false
}
function ConvertTo-MentorDockerPath([string]$Path) { return $Path }
function Invoke-MentorDocker([string[]]$DockerArguments) {
    $a = $DockerArguments; $state = $global:MentorBackupWindow; $postgres = 'a' * 64; $backend = 'b' * 64
    if ($a[0] -eq 'inspect') {
        SameArguments $a @('inspect', '--format', '{{.State.Running}}', $backend)
        return $state.Running.ToString().ToLowerInvariant()
    }
    if ($a[0] -eq 'exec' -and $a[2] -eq 'pg_dump') {
        SameArguments $a[0..8] @('exec', $postgres, 'pg_dump', '-U', 'mentor', '-d', 'mentor', '--format=custom', '--snapshot=00000001-00000001-1')
        Require ($a.Count -eq 10 -and $a[9] -match '^--file=/tmp/mentor-backup-[a-f0-9]{32}\.dump$') 'Unexpected dump path.'
        Require ($state.FenceOpen -and -not $state.Running) 'Dump is outside the stopped/fenced window.'
        $state.Events.Add('dump')
        $state.DumpPath = $a[9].Substring('--file='.Length)
        $state.DumpBytes = [IO.File]::ReadAllBytes($state.SourceDatabase)
        return
    }
    if ($a[0] -eq 'exec' -and $a[2] -eq 'rm') {
        SameArguments $a @('exec', $postgres, 'rm', '-f', $state.DumpPath)
        $state.Events.Add('dump-remove')
        return
    }
    Require ($a.Count -eq 3 -and $a[0] -eq 'cp' -and $state.FenceOpen -and -not $state.Running) 'Unexpected Docker call or copy outside the capture window.'
    if ($a[1] -ceq ($postgres + ':' + $state.DumpPath)) {
        Require ((Split-Path -Leaf $a[2]) -ceq 'database.dump') 'Unexpected database copy destination.'
        $state.Events.Add('copy-database')
        [IO.File]::WriteAllBytes($a[2], $state.DumpBytes)
        if ($state.Fault -eq 'copy-database') { throw 'Synthetic database copy failure.' }
        return
    }
    Require ($a[1] -ceq ($backend + ':/var/lib/mentor/objects/.') -and (Split-Path -Leaf $a[2]) -ceq 'objects') 'Unexpected objects copy.'
    $state.Events.Add('copy-objects')
    foreach ($name in $state.ObjectNames) {
        Copy-Item -LiteralPath (Join-Path $state.SourceObjects $name) -Destination (Join-Path $a[2] $name)
        if ($state.Fault -eq 'copy') { throw 'Synthetic object copy failure.' }
    }
}
function Get-FileHash([string]$LiteralPath, [string]$Algorithm) {
    Require ($Algorithm -ceq 'SHA256') 'Unexpected hash algorithm.'
    $state = $global:MentorBackupWindow; $name = Split-Path -Leaf $LiteralPath
    Require $state.LeaseOpen 'Hashing ran without the maintenance lease.'
    Require ($name -in ($state.ObjectNames + @('database.dump', 'snapshot.tar.gpg'))) 'Unexpected file was hashed.'
    $state.Events.Add('hash:' + $name)
    if ($state.Fault -eq 'hash' -and $name -ne 'snapshot.tar.gpg') { throw 'Synthetic hash failure.' }
    return Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $LiteralPath -Algorithm $Algorithm
}
function tar {
    $a = @($args); $state = $global:MentorBackupWindow
    Require ($a.Count -eq 7) 'Unexpected tar arguments.'
    SameArguments @($a[0], $a[2], $a[4], $a[5], $a[6]) @('-cf', '-C', 'manifest.json', 'database.dump', 'objects')
    Require ($a[1] -ceq (Join-Path $a[3] 'snapshot.tar')) 'Archive is outside its private stage.'
    Require (-not $state.FenceOpen -and $state.Running -eq $state.InitiallyRunning -and $state.LeaseOpen) 'Archive creation blocks application availability or lost the maintenance lease.'
    $state.Events.Add('tar')
    $manifest = Get-Content -LiteralPath (Join-Path $a[3] 'manifest.json') -Raw | ConvertFrom-Json
    Require ($manifest.format -eq 1 -and $manifest.project -ceq 'mentor-window-test') 'Snapshot manifest format/project changed.'
    Require (([DateTimeOffset]$manifest.createdAt).UtcDateTime -le $state.FenceClosedAt) 'Snapshot timestamp was taken after the fence closed.'
    Require ($manifest.counts.student -eq 2 -and $manifest.counts.lesson -eq 3) 'Manifest counts came from the resumed application.'
    Require ($manifest.databaseSha256 -ceq (BytesHash $state.OriginalDatabase)) 'Manifest database hash differs from the captured snapshot.'
    Require ((BytesHash ([IO.File]::ReadAllBytes((Join-Path $a[3] 'database.dump')))) -ceq $manifest.databaseSha256) 'Captured database changed after restart.'
    Require (@($manifest.objects).Count -eq 2) 'Captured object count changed after restart.'
    foreach ($name in $state.ObjectNames) {
        $entries = @($manifest.objects | Where-Object { $_.name -ceq $name })
        Require ($entries.Count -eq 1) 'A captured object is missing/duplicated in the manifest.'
        $expected = $state.OriginalObjects[$name]
        Require ($entries[0].bytes -eq $expected.Length -and $entries[0].sha256 -ceq (BytesHash $expected)) 'Manifest describes resumed source objects.'
        Require ((BytesHash ([IO.File]::ReadAllBytes((Join-Path $a[3] ('objects/' + $name))))) -ceq $entries[0].sha256) 'Captured object bytes changed after restart.'
    }
    $state.ManifestCreatedAt = $manifest.createdAt
    [IO.File]::WriteAllText($a[1], 'synthetic archive of the validated captured snapshot')
    $global:LASTEXITCODE = 0
}
function Invoke-MentorGpg([string]$Mode, [string]$PassphraseFile, [string]$InputFile, [string]$OutputFile) {
    $state = $global:MentorBackupWindow
    Require $state.LeaseOpen 'Encryption ran without the maintenance lease.'
    Require ($Mode -ceq 'encrypt' -and $PassphraseFile -ceq $state.PassphraseFile) 'Unexpected encryption invocation.'
    Require ((Split-Path -Leaf $InputFile) -ceq 'snapshot.tar' -and (Split-Path -Leaf $OutputFile) -ceq 'snapshot.tar.gpg') 'Unexpected archive/cipher path.'
    Require ([IO.File]::ReadAllText($InputFile) -ceq 'synthetic archive of the validated captured snapshot') 'Encryption did not use the validated archive.'
    $state.Events.Add('encrypt')
    [IO.File]::WriteAllText($OutputFile, 'synthetic ciphertext')
}
'@
[IO.File]::WriteAllText((Join-Path $root 'maintenance-lease.ps1'), $stub)

function Run-Case([string]$CaseName, [bool]$InitiallyRunning, [string]$Fault, [string]$ExpectedError = '') {
    $caseRoot = Join-Path $root $CaseName
    $sourceObjects = Join-Path $caseRoot 'source-objects'
    New-Item -ItemType Directory -Path $caseRoot, $sourceObjects | Out-Null
    $names = @('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
    $global:MentorBackupWindow = @{
        CommonPath = $commonPath; Events = [Collections.Generic.List[string]]::new()
        InitiallyRunning = $InitiallyRunning; Running = $InitiallyRunning; Fault = $Fault; StartAttempts = 0; FenceOpen = $false
        LeaseOpen = $false; FenceClosedAt = $null; Destination = (Join-Path $caseRoot 'backups')
        SourceDatabase = (Join-Path $caseRoot 'source.dump'); SourceObjects = $sourceObjects; ObjectNames = $names
        SourceCounts = @{ student = 2; lesson = 3 }; OriginalDatabase = [Text.Encoding]::UTF8.GetBytes('synthetic database before restart')
        OriginalObjects = @{}; DumpPath = $null; DumpBytes = $null; ManifestCreatedAt = $null
        EnvironmentFile = (Join-Path $caseRoot 'synthetic.env'); PassphraseFile = (Join-Path $caseRoot 'synthetic-passphrase')
    }
    $state = $global:MentorBackupWindow
    [IO.File]::WriteAllBytes($state.SourceDatabase, $state.OriginalDatabase)
    foreach ($name in $names) {
        $state.OriginalObjects[$name] = [Text.Encoding]::UTF8.GetBytes('Синтетический снимок · ' + $name)
        [IO.File]::WriteAllBytes((Join-Path $sourceObjects $name), $state.OriginalObjects[$name])
    }
    [IO.File]::WriteAllText($state.EnvironmentFile, '# synthetic configuration, never read by Compose')
    [IO.File]::WriteAllText($state.PassphraseFile, 'synthetic-passphrase-for-tests-only-00000000')
    $destination = $state.Destination
    $caught = $null
    try { & $fixtureScript -Destination $destination -EnvironmentFile $state.EnvironmentFile -PassphraseFile $state.PassphraseFile -ProjectName 'mentor-window-test' | Out-Null }
    catch { $caught = $_.Exception.Message }
    if ($ExpectedError) { Require ($caught -ceq $ExpectedError) ('Wrong failure for ' + $CaseName + ': ' + $caught) }
    else { Require ($null -eq $caught) ('Unexpected failure for ' + $CaseName + ': ' + $caught) }

    $backups = @(Get-ChildItem -LiteralPath $destination -Directory)
    Require ($backups.Count -eq 1) 'Expected one backup operation directory.'
    $backup = $backups[0].FullName
    Require (-not (Test-Path -LiteralPath (Join-Path $backup 'private-stage'))) 'Private staging data survived cleanup.'
    Require (-not $state.FenceOpen -and -not $state.LeaseOpen -and $state.Running -eq $InitiallyRunning) 'Cleanup changed backend availability or retained a fence/lease.'
    Require ($state.Events.Contains('dump-remove') -and $state.Events.Contains('lease-close')) 'Dump/maintenance cleanup was omitted.'
    Before 'counts' 'dump'; Before 'dump' 'copy-database'
    if ($Fault -eq 'copy-database') { Require (-not $state.Events.Contains('copy-objects')) 'A failed database copy continued to object capture.' }
    else { Before 'copy-database' 'copy-objects' }
    if ($InitiallyRunning) { Before 'stop' 'fence-open'; Before 'fence-close' 'start' }
    else { Require (-not $state.Events.Contains('stop') -and -not $state.Events.Contains('start-attempt')) 'An initially stopped backend was restarted.' }

    if ($ExpectedError) {
        Require (-not $state.Events.Contains('tar') -and -not $state.Events.Contains('encrypt')) 'A failed snapshot reached archive/encryption.'
        Require (-not (Test-Path -LiteralPath (Join-Path $backup 'receipt.json')) -and -not (Test-Path -LiteralPath (Join-Path $backup 'snapshot.tar.gpg'))) 'Failed backup has a success receipt/ciphertext.'
        $failure = Get-Content -LiteralPath (Join-Path $backup 'failed.json') -Raw | ConvertFrom-Json
        Require ($failure.completed -eq $false) 'Failure receipt reports completion.'
        if ($Fault -in @('copy', 'copy-database', 'fence', 'start')) {
            Require (@($state.Events | Where-Object { $_ -like 'hash:*' }).Count -eq 0) 'A failed capture/resume hashed data before availability was restored.'
        }
        if ($Fault -eq 'hash') { Before 'start' ('hash:' + $names[0]) }
        Require ($state.StartAttempts -eq $(if ($Fault -eq 'start') { 2 } else { 1 })) 'Finally did not retry the failed start exactly once, or restarted a healthy backend.'
    } else {
        Before 'copy-objects' 'fence-assert'; Before 'fence-assert' 'fence-close'
        foreach ($event in @(('hash:' + $names[0]), ('hash:' + $names[1]), 'hash:database.dump')) {
            Before $(if ($InitiallyRunning) { 'start' } else { 'fence-close' }) $event
            Before $event 'tar'
        }
        Before 'tar' 'encrypt'; Before 'encrypt' 'hash:snapshot.tar.gpg'
        $receipt = Get-Content -LiteralPath (Join-Path $backup 'receipt.json') -Raw | ConvertFrom-Json
        Require ((@($receipt.PSObject.Properties.Name | Sort-Object) -join '|') -ceq 'completed|createdAt|encrypted|format|offsiteVerified|restoreVerified|sha256') 'Existing receipt fields changed.'
        Require ($receipt.format -eq 1 -and $receipt.completed -and $receipt.encrypted -and -not $receipt.offsiteVerified -and -not $receipt.restoreVerified) 'Receipt completion/options changed.'
        Require ($receipt.createdAt -eq $state.ManifestCreatedAt -and $receipt.sha256 -ceq (BytesHash ([IO.File]::ReadAllBytes((Join-Path $backup 'snapshot.tar.gpg'))))) 'Receipt no longer matches the captured snapshot/ciphertext.'
        Require (-not (Test-Path -LiteralPath (Join-Path $backup 'failed.json'))) 'Successful backup has a failure marker.'
        if ($InitiallyRunning) {
            Require ((BytesHash ([IO.File]::ReadAllBytes($state.SourceDatabase))) -cne (BytesHash $state.OriginalDatabase)) 'Restart did not change the synthetic source; snapshot consistency was not exercised.'
            Require (-not (Test-Path -LiteralPath (Join-Path $sourceObjects $names[1]))) 'Restart did not exercise synthetic source object cleanup.'
        }
    }
    Write-Output ('PASS backup window: ' + $CaseName)
}

try {
    Run-Case 'running-consistent-snapshot' $true ''
    Run-Case 'already-stopped' $false ''
    Run-Case 'database-copy-failure' $true 'copy-database' 'Synthetic database copy failure.'
    Run-Case 'copy-failure' $true 'copy' 'Synthetic object copy failure.'
    Run-Case 'lost-fence' $true 'fence' 'Synthetic fence lost.'
    Run-Case 'hash-after-resume-failure' $true 'hash' 'Synthetic hash failure.'
    Run-Case 'start-retried-in-finally' $true 'start' 'Synthetic first start failure.'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    Require ((Split-Path -Parent $resolved) -ceq $temporaryRoot -and (Split-Path -Leaf $resolved) -match '^mentor-backup-window-[a-f0-9]{32}$') 'Refusing cleanup outside the owned temporary fixture.'
    Remove-Item -LiteralPath $resolved -Recurse -Force
    if ($null -eq $previousState) { Remove-Variable -Name MentorBackupWindow -Scope Global }
    else { Set-Variable -Name MentorBackupWindow -Scope Global -Value $previousState.Value }
}
