. (Join-Path $PSScriptRoot 'platform-common.ps1')

function Assert-MentorRegularPath([string]$Path,[bool]$Directory) {
    $item=Get-Item -LiteralPath $Path -Force
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.PSIsContainer -ne $Directory){throw 'Snapshot paths must be regular files/directories without links.'}
    if(-not $IsWindows){
        $kind=& env LC_ALL=C stat --format=%F -- $Path
        if($LASTEXITCODE -ne 0 -or $kind -notin @('regular file','regular empty file','directory')){throw 'Snapshot special files are not supported.'}
    }
    return $item.FullName
}

function Open-MentorLegacyFreeze([string]$Source) {
    $sourceRoot=Assert-MentorRegularPath ([IO.Path]::GetFullPath($Source)) $true
    $data=Assert-MentorRegularPath (Join-Path $sourceRoot 'data') $true
    $auth=Assert-MentorRegularPath (Join-Path $data 'auth') $true
    $lockPath=Join-Path $auth 'accounts.lock'
    # Compatible with the legacy exclusive writer: its startup must refuse this live PID/nonce.
    # Do not reclaim or delete someone else's existing/stale lock from the snapshot utility.
    $stream=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    $nonce=[Guid]::NewGuid().ToString()
    try {
        $owner=@{pid=$PID;hostname=[Environment]::MachineName;nonce=$nonce} | ConvertTo-Json -Compress
        $bytes=[Text.UTF8Encoding]::new($false).GetBytes($owner)
        $stream.Write($bytes);$stream.Flush($true)
        return [pscustomobject]@{Source=$sourceRoot;Path=$lockPath;Nonce=$nonce;Stream=$stream}
    } catch { $stream.Dispose(); throw }
}

function Assert-MentorLegacyFreeze($Freeze) {
    Assert-MentorRegularPath $Freeze.Path $false | Out-Null
    $reader=[IO.StreamReader]::new([IO.File]::Open($Freeze.Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite),[Text.UTF8Encoding]::new($false,$true))
    try { $owner=$reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if($owner.nonce -ne $Freeze.Nonce -or $owner.pid -ne $PID -or $owner.hostname -ne [Environment]::MachineName){throw 'Legacy writer ownership changed; snapshot rejected.'}
}

function Close-MentorLegacyFreeze($Freeze) {
    if($null -eq $Freeze){return}
    try { Assert-MentorLegacyFreeze $Freeze }
    finally { $Freeze.Stream.Dispose() }
    Remove-Item -LiteralPath $Freeze.Path
}

function Get-MentorLegacyFiles([string]$Source) {
    $files=[Collections.Generic.List[string]]::new()
    foreach($relative in @('data/mentoring.json','data/auth/accounts.json','private/materials/manifest.json','private/materials/content.json','training/catalog.json','training/environments.json')){
        $full=Join-Path $Source $relative
        $parent=[IO.Path]::GetDirectoryName($full)
        while($parent -ne $Source){Assert-MentorRegularPath $parent $true | Out-Null;$parent=[IO.Path]::GetDirectoryName($parent)}
        Assert-MentorRegularPath $full $false | Out-Null;$files.Add($relative)
    }
    $state=Join-Path $Source 'data/practice/state.json'
    if(Test-Path -LiteralPath $state){Assert-MentorRegularPath (Split-Path -Parent $state) $true | Out-Null;Assert-MentorRegularPath $state $false | Out-Null;$files.Add('data/practice/state.json')}
    foreach($relative in @('data/practice/uploads','private/materials','training/exercises','training/templates','content','code')){
        $directory=Join-Path $Source $relative
        if(-not (Test-Path -LiteralPath $directory)){continue}
        $parent=[IO.Path]::GetDirectoryName($directory)
        while($parent -ne $Source){Assert-MentorRegularPath $parent $true | Out-Null;$parent=[IO.Path]::GetDirectoryName($parent)}
        $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($directory)
        while($pending.Count){
            $next=Assert-MentorRegularPath $pending.Pop() $true
            foreach($item in Get-ChildItem -LiteralPath $next -Force){
                if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked source content is not supported; snapshot rejected.'}
                if($item.PSIsContainer){$pending.Push($item.FullName)}
                elseif($item.Name -notmatch '(?i)\.(?:lock|tmp|bak)(?:\.|$)'){
                    Assert-MentorRegularPath $item.FullName $false | Out-Null
                    $relativeFile=[IO.Path]::GetRelativePath($Source,$item.FullName).Replace('\','/')
                    if(-not $files.Contains($relativeFile)){$files.Add($relativeFile)}
                }
            }
        }
    }
    $files.Sort([StringComparer]::Ordinal)
    return $files.ToArray()
}

function Get-MentorLegacyManifest([string]$Source) {
    $records=@()
    foreach($relative in Get-MentorLegacyFiles $Source){
        $file=Get-Item -LiteralPath (Join-Path $Source $relative)
        $records+=,[ordered]@{path=$relative;bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    }
    return ,$records
}

function Copy-MentorLegacySnapshot($Freeze,[string]$Destination) {
    Assert-MentorLegacyFreeze $Freeze
    $destinationRoot=[IO.Path]::GetFullPath($Destination)
    $sourcePrefix=$Freeze.Source.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    if($destinationRoot -eq $Freeze.Source -or $destinationRoot.StartsWith($sourcePrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Store the closed snapshot outside the legacy source tree.'}
    New-MentorPrivateDirectory $destinationRoot
    try {
        $before=Get-MentorLegacyManifest $Freeze.Source
        foreach($entry in $before){
            $target=Join-Path $destinationRoot $entry.path
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $Freeze.Source $entry.path) -Destination $target
        }
        $after=Get-MentorLegacyManifest $Freeze.Source
        $copied=Get-MentorLegacyManifest $destinationRoot
        $expected=ConvertTo-Json -InputObject $before -Compress -Depth 4
        if($expected -cne (ConvertTo-Json -InputObject $after -Compress -Depth 4) -or $expected -cne (ConvertTo-Json -InputObject $copied -Compress -Depth 4)){throw 'Source changed or snapshot bytes differ; copy rejected.'}
        Assert-MentorLegacyFreeze $Freeze
        return [pscustomobject]@{format=1;files=$copied;optionalPracticePresent=(Test-Path -LiteralPath (Join-Path $destinationRoot 'data/practice/state.json'));verified=$true}
    } catch { Remove-MentorOwnedDirectory $destinationRoot (Split-Path -Parent $destinationRoot); throw }
}
