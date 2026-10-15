# Shared administrative helpers. No credentials are returned or put on command lines.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-MentorPrivateDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) { throw 'Private operation directory must be new.' }
    New-Item -ItemType Directory -Path $Path | Out-Null
    if ($IsWindows) {
        $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($owner)
        $acl.SetAccessRuleProtection($true,$false)
        foreach ($sid in @($owner,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $Path -AclObject $acl
        if (-not (Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw 'Private directory ACL was not applied.' }
    } else {
        & chmod 700 -- $Path
        if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict private directory permissions.' }
    }
}

function Get-MentorWslArguments {
    $distribution = $env:MENTOR_WSL_DISTRIBUTION
    if ([string]::IsNullOrEmpty($distribution)) { return @('--exec') }
    if ([string]::IsNullOrWhiteSpace($distribution) -or $distribution -match '[\x00-\x1f\x7f]') { throw 'Invalid MENTOR_WSL_DISTRIBUTION.' }
    return @('--distribution',$distribution,'--exec')
}

function ConvertTo-MentorDockerPath([string]$Path) {
    if ($Path -match '[\r\n\x00]') { throw 'Invalid Docker file path.' }
    $absolute = [IO.Path]::GetFullPath($Path)
    if ($IsWindows) {
        if ($absolute -notmatch '^[A-Za-z]:\\') { throw 'Use a local absolute drive path for Docker files.' }
        $wslArguments = @(Get-MentorWslArguments)
        $converted = @(& wsl @wslArguments wslpath -a -u $absolute 2>$null)
        if ($LASTEXITCODE -ne 0 -or $converted.Count -ne 1 -or $converted[0] -notmatch '^/' -or $converted[0] -match '[\r\n\x00]') { throw 'Cannot convert the Docker file path with the selected WSL distribution.' }
        return [string]$converted[0]
    }
    return $absolute
}

function Invoke-MentorDocker {
    param([Parameter(Mandatory)][string[]]$DockerArguments)
    if ($IsWindows) { $wslArguments = @(Get-MentorWslArguments); $output = & wsl @wslArguments docker @DockerArguments }
    else { $output = & docker @DockerArguments }
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed ($($DockerArguments[0])); exit $LASTEXITCODE." }
    return $output
}

function New-MentorPlatformContext([string]$EnvironmentFile,[string]$ProjectName) {
    if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') { throw 'Invalid Compose project name.' }
    if (-not [IO.Path]::IsPathFullyQualified($EnvironmentFile)) { throw 'EnvironmentFile must be absolute.' }
    $resolved = (Resolve-Path -LiteralPath $EnvironmentFile).Path
    $compose = Join-Path $PSScriptRoot 'compose.platform.yaml'
    return @('compose','--env-file',(ConvertTo-MentorDockerPath $resolved),'-f',(ConvertTo-MentorDockerPath $compose),'--project-name',$ProjectName)
}

function Invoke-MentorCompose([string[]]$Context,[string[]]$ComposeArguments) {
    Invoke-MentorDocker -DockerArguments ($Context + $ComposeArguments)
}

function Get-MentorServiceId([string[]]$Context,[string]$Service) {
    $id = (Invoke-MentorCompose $Context @('ps','--all','--quiet',$Service) | Out-String).Trim()
    if ($id -notmatch '^[a-f0-9]{64}$') { throw "Exactly one $Service container is required." }
    return $id
}

function Get-MentorTableCounts([string]$PostgresId,$Fence=$null) {
    $tableQuery="SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    $tables = if ($Fence) { Invoke-MentorFenceQuery $Fence $tableQuery } else { Invoke-MentorDocker @('exec',$PostgresId,'psql','-X','-U','mentor','-d','mentor','-At','-c',$tableQuery) }
    $counts = [ordered]@{}
    foreach ($table in $tables) {
        if ($table -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Unexpected database table identifier.' }
        $query="SELECT count(*) FROM public.`"$table`""
        $count = (($(if ($Fence) { Invoke-MentorFenceQuery $Fence $query } else { Invoke-MentorDocker @('exec',$PostgresId,'psql','-X','-U','mentor','-d','mentor','-At','-c',$query) })) | Out-String).Trim()
        $counts[$table] = [long]$count
    }
    return $counts
}

function Invoke-MentorFenceQuery($Fence,[string]$Sql) {
    if ($Fence.Process.HasExited) { throw 'The database maintenance fence was lost; this snapshot is invalid.' }
    $marker='mentor_done_'+[Guid]::NewGuid().ToString('N')
    $Fence.Process.StandardInput.WriteLine($Sql+"; SELECT '$marker';")
    $Fence.Process.StandardInput.Flush()
    $lines=[Collections.Generic.List[string]]::new()
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while ($true) {
        $remaining=$deadline-[DateTime]::UtcNow
        if ($remaining.TotalMilliseconds -le 0) { throw 'Database maintenance fence response timed out.' }
        $line=$Fence.Process.StandardOutput.ReadLineAsync().WaitAsync($remaining).GetAwaiter().GetResult()
        if ($null -eq $line) { throw 'The database maintenance connection closed; this snapshot is invalid.' }
        if ($line -eq $marker) { break }
        $lines.Add($line)
    }
    return $lines.ToArray()
}

function Close-MentorBackupFence($Fence) {
    if ($null -eq $Fence) { return }
    try {
        if (-not $Fence.Process.HasExited) {
            try { $Fence.Process.StandardInput.WriteLine('\q'); $Fence.Process.StandardInput.Flush(); $Fence.Process.StandardInput.Close() } catch { }
            if (-not $Fence.Process.WaitForExit(5000)) {
                # Match the unguessable operation name as well as PID; never terminate a reused/foreign session.
                if ($Fence.Pid -gt 0 -and $Fence.Name -match '^mentor-backup-fence-[a-f0-9]{32}$') {
                    Invoke-MentorDocker @('exec',$Fence.Postgres,'psql','-X','-U','mentor','-d','mentor','-At','-v','ON_ERROR_STOP=1','-c',("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid="+$Fence.Pid+" AND application_name='"+$Fence.Name+"'")) | Out-Null
                }
                if (-not $Fence.Process.WaitForExit(5000)) { $Fence.Process.Kill($true); $Fence.Process.WaitForExit() }
            }
        }
    } finally { $Fence.Process.Dispose() }
}

function New-MentorDockerProcessStartInfo([string[]]$DockerArguments) {
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=if($IsWindows){'wsl.exe'}else{'docker'}
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $arguments=@(if($IsWindows){@(Get-MentorWslArguments)+@('docker')})
    foreach($argument in ($arguments+$DockerArguments)) { $start.ArgumentList.Add($argument) }
    return $start
}

function New-MentorBackupFence([string]$PostgresId) {
    if ($PostgresId -notmatch '^[a-f0-9]{64}$') { throw 'Invalid maintenance database container.' }
    $start=New-MentorDockerProcessStartInfo @('exec','-i',$PostgresId,'psql','-X','-qAt','-U','mentor','-d','mentor','-v','ON_ERROR_STOP=1')
    $process=[Diagnostics.Process]::Start($start)
    $fence=[pscustomobject]@{Process=$process;Errors=$process.StandardError.ReadToEndAsync();Postgres=$PostgresId;Pid=0;Name=('mentor-backup-fence-'+[Guid]::NewGuid().ToString('N'));Snapshot=$null}
    try {
        $pidLines=@(Invoke-MentorFenceQuery $fence ("SET application_name='"+$fence.Name+"'; SELECT pg_backend_pid()"))
        if ($pidLines.Count -ne 1 -or $pidLines[0] -notmatch '^[1-9][0-9]*$') { throw 'Invalid maintenance connection handshake.' }
        $fence.Pid=[int]$pidLines[0]
        if ((Invoke-MentorFenceQuery $fence 'SELECT pg_try_advisory_lock(1296387668,1229803591)') -ne 't') { throw 'Another platform runtime, import or maintenance operation is active.' }
        if ((Invoke-MentorFenceQuery $fence "SELECT to_regclass('public.import_run') IS NOT NULL") -ne 't') { throw 'The required import/maintenance schema is missing.' }
        if ((Invoke-MentorFenceQuery $fence "SELECT EXISTS(SELECT 1 FROM import_run WHERE state<>'completed')") -ne 'f') { throw 'An incomplete import prevents a platform backup.' }
        $snapshot=@(Invoke-MentorFenceQuery $fence 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot()')
        if ($snapshot.Count -ne 1 -or $snapshot[0] -notmatch '^[A-Fa-f0-9]+-[A-Fa-f0-9]+-[0-9]+$') { throw 'The database snapshot was not exported.' }
        $fence.Snapshot=$snapshot[0]
        return $fence
    } catch { Close-MentorBackupFence $fence; throw }
}

function Assert-MentorBackupFence($Fence) {
    $owned=Invoke-MentorFenceQuery $Fence "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=1296387668::oid AND objid=1229803591::oid AND objsubid=2 AND mode='ExclusiveLock' AND granted)"
    if ($owned -ne 't') { throw 'The database maintenance fence was lost; this snapshot is invalid.' }
}

function Get-MentorObjectManifest([string]$Directory) {
    $items = @()
    foreach ($file in (Get-ChildItem -LiteralPath $Directory -Force | Sort-Object Name)) {
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Name -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'Unexpected object-store entry; backup rejected.' }
        $items += [ordered]@{ name=$file.Name; bytes=$file.Length; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    return ,$items
}

function Test-MentorPassphraseFile([string]$PassphraseFile) {
    $file = Get-Item -LiteralPath $PassphraseFile
    if ($file.PSIsContainer -or $file.Length -gt 16384 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Use a private regular UTF-8 passphrase file.' }
    $value = [IO.File]::ReadAllText($file.FullName,[Text.UTF8Encoding]::new($false,$true))
    if ($value -notmatch '\A[^\r\n]{32,4096}(?:\r?\n)?\z') { throw 'The passphrase file must contain one line of 32 to 4096 characters.' }
    $value = $null
}

function Invoke-MentorGpg([string]$Mode,[string]$PassphraseFile,[string]$InputFile,[string]$OutputFile) {
    Test-MentorPassphraseFile $PassphraseFile
    $script = Join-Path $PSScriptRoot 'gpg-file.sh'
    $arguments = @((ConvertTo-MentorDockerPath $script),$Mode,(ConvertTo-MentorDockerPath $PassphraseFile),(ConvertTo-MentorDockerPath $InputFile),(ConvertTo-MentorDockerPath $OutputFile))
    if ($IsWindows) { $wslArguments = @(Get-MentorWslArguments); & wsl @wslArguments sh @arguments }
    else { & sh @arguments }
    if ($LASTEXITCODE -ne 0) { throw 'GnuPG operation failed; verify GnuPG 2 and the private passphrase file.' }
}

function Remove-MentorOwnedDirectory([string]$Path,[string]$Parent) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or $absolute -eq $root.TrimEnd([IO.Path]::DirectorySeparatorChar)) { throw 'Refusing cleanup outside the owned operation directory.' }
    if (Test-Path -LiteralPath $absolute) { Remove-Item -LiteralPath $absolute -Recurse -Force }
}

function ConvertFrom-MentorReceiptDate($Value) {
    if ($Value -is [DateTime] -or $Value -is [DateTimeOffset]) { return ([DateTimeOffset]$Value).ToUniversalTime() }
    return [DateTimeOffset]::Parse($Value,[cultureinfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}

function Remove-MentorExpiredBackups([string]$Directory) {
    $cutoff = [DateTimeOffset]::UtcNow.AddDays(-14)
    foreach ($candidate in (Get-ChildItem -LiteralPath $Directory -Directory)) {
        if ($candidate.Name -notmatch '^mentor-backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$' -or ($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
        try {
            $receipt = Get-Content -LiteralPath (Join-Path $candidate.FullName 'receipt.json') -Raw | ConvertFrom-Json
            if ($receipt.completed -ne $true -or $receipt.encrypted -ne $true -or (ConvertFrom-MentorReceiptDate $receipt.createdAt) -ge $cutoff) { continue }
            $entries = @(Get-ChildItem -LiteralPath $candidate.FullName -Force)
            if (@($entries | Where-Object { $_.PSIsContainer -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -notin @('receipt.json','snapshot.tar.gpg','restore-report.json') }).Count -gt 0) { continue }
            if (-not (Test-Path -LiteralPath (Join-Path $candidate.FullName 'snapshot.tar.gpg') -PathType Leaf)) { continue }
        } catch { continue } # Incomplete/unrecognized directories are never retention targets.
        Remove-MentorOwnedDirectory $candidate.FullName $Directory
    }
}

function ConvertFrom-MentorDockerPath([string]$Path) {
    # Inverse of ConvertTo-MentorDockerPath for values read back from `docker compose config`.
    if ($IsWindows) {
        if ($Path -match '[\r\n\x00]') { throw 'Invalid Docker file path.' }
        if ($Path -match '^[A-Za-z]:[\\/]') { return [IO.Path]::GetFullPath($Path) }
        if ($Path -notmatch '^/') { throw 'Use an absolute Docker file path.' }
        $wslArguments = @(Get-MentorWslArguments)
        $converted = @(& wsl @wslArguments wslpath -a -w $Path 2>$null)
        if ($LASTEXITCODE -ne 0 -or $converted.Count -ne 1 -or $converted[0] -notmatch '^[A-Za-z]:\\' -or $converted[0] -match '[\r\n\x00]') { throw 'Cannot convert the Docker file path to a local Windows drive with the selected WSL distribution.' }
        return [string]$converted[0]
    }
    return $Path
}

function Get-MentorContainerHealth([string]$Id) {
    # State: created|running|restarting|exited|dead; Health: healthy|unhealthy|starting, or none without a healthcheck.
    if ($Id -notmatch '^[a-f0-9]{64}$') { throw 'Invalid container identifier.' }
    $raw = (Invoke-MentorDocker @('inspect','--format','{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',$Id) | Out-String).Trim()
    $parts = $raw.Split('|')
    if ($parts.Count -ne 2 -or $parts[0] -notmatch '^[a-z]+$' -or $parts[1] -notmatch '^[a-z]+$') { throw 'Unexpected container state output.' }
    return [pscustomobject]@{ State=$parts[0]; Health=$parts[1] }
}

function Wait-MentorServiceHealthy([string[]]$Context,[string]$Service,[int]$TimeoutSeconds = 180) {
    # Readiness comes from the container healthcheck (Actuator readiness / Caddy loopback listener), never from
    # the rate-limited /api/v1/auth/session. Returns the final health value; 'none' means no healthcheck is defined.
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $id = Get-MentorServiceId $Context $Service
    while ($true) {
        $probe = Get-MentorContainerHealth $id
        if ($probe.State -in @('exited','dead')) { throw "The $Service container stopped (state $($probe.State)); inspect its logs." }
        if ($probe.State -eq 'running' -and $probe.Health -in @('healthy','none')) { return $probe.Health }
        if ([DateTime]::UtcNow -ge $deadline) { throw "The $Service container did not become healthy within $TimeoutSeconds s (state $($probe.State), health $($probe.Health))." }
        Start-Sleep -Milliseconds 1000
    }
}
