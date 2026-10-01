. (Join-Path $PSScriptRoot 'legacy-snapshot.ps1')
. (Join-Path $PSScriptRoot 'maintenance-lease.ps1')
function Assert-MentorCutoverApproval($Approval,$RawReport,$Expected,[DateTimeOffset]$Now=[DateTimeOffset]::UtcNow){
    if($Approval.format -ne 1 -or $Approval.mode -ne 'dry-run'){throw 'A successful cutover dry-run approval is required.'}
    $created=ConvertFrom-MentorReceiptDate $Approval.createdAt
    if($created -gt $Now -or $Now -ge $created.AddMinutes(30)){throw 'Dry-run approval is expired or has a future timestamp.'}
    if($RawReport.completed -ne $false -or @($RawReport.errors).Count -ne 0 -or $RawReport.sourceDigest -notmatch '^[a-f0-9]{64}$' -or $RawReport.importId -cne $Expected.importId -or $RawReport.sourceDigest -cne $Approval.sourceDigest){throw 'The successful CLI dry-run report does not match this operation.'}
    foreach($field in @('importId','sourceDigest','sourceFilesSha256','imageId','jarSha256','environmentManifestSha256','environmentProfilesSha256','targetWorkspace','teacherAccount','reportSha256')){
        if($Approval.$field -cne $Expected.$field){throw 'The closed source, report, trusted pins or explicit target selection has changed.'}
    }
}
function Get-MentorCutoverHash([string]$Path){Assert-MentorRegularPath $Path $false | Out-Null;return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Get-MentorCutoverJsonHash($Value){$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 12 -Compress));return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()}
function Write-MentorCutoverJson([string]$Path,$Value,[switch]$Replace){
    if(-not $Replace -and (Test-Path -LiteralPath $Path)){throw 'Private cutover report must be new.'}
    if(Test-Path -LiteralPath $Path){Assert-MentorRegularPath $Path $false | Out-Null}
    $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp';$stream=$null
    try {
        $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        if(-not $IsWindows){& chmod 600 -- $temporary;if($LASTEXITCODE -ne 0){throw 'Cannot protect cutover report.'}}
        $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 16));$stream.Write($bytes);$stream.Flush($true);$stream.Dispose();$stream=$null
        Move-Item -LiteralPath $temporary -Destination $Path -Force:$Replace
    } finally {if($stream){$stream.Dispose()};if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
}
function Get-MentorCutoverSourceFiles([string]$Snapshot){
    if(-not [IO.Path]::IsPathFullyQualified($Snapshot)){throw 'Snapshot must be an absolute closed directory.'}
    $resolved=[IO.Path]::GetFullPath($Snapshot);$parent=$resolved
    while($parent){Assert-MentorRegularPath $parent $true | Out-Null;$next=[IO.Path]::GetDirectoryName($parent);if($next -eq $parent){break};$parent=$next}
    $files=Get-MentorLegacyManifest $resolved
    foreach($file in $files){if($file.path -match '[\x00-\x1f\\:]' -or $file.path.StartsWith('/') -or @($file.path.Split('/') | Where-Object {$_ -in @('','..','.')}).Count){throw 'Snapshot includes an unsupported portable path.'}}
    return ,$files
}
function Assert-MentorCutoverBindings($Value,$Expected){
    foreach($field in @('importId','sourceDigest','sourceFilesSha256','imageId','jarSha256','environmentManifestSha256','environmentProfilesSha256','targetWorkspace','teacherAccount')){if($Value.$field -cne $Expected.$field){throw 'Backup or resume receipt does not belong to this exact cutover.'}}
}
function Assert-MentorCutoverPath([string]$Path,[bool]$Directory,[switch]$MustExist){
    if(-not [IO.Path]::IsPathFullyQualified($Path)){throw 'Administrative paths must be absolute.'}
    $current=[IO.Path]::GetFullPath($Path);$leaf=$true
    while($current){
        if(Test-Path -LiteralPath $current){Assert-MentorRegularPath $current $(if($leaf){$Directory}else{$true}) | Out-Null}
        elseif($leaf -and $MustExist){throw 'Required administrative input is missing.'}
        $next=[IO.Path]::GetDirectoryName($current);if($next -eq $current){break};$current=$next;$leaf=$false
    }
}
function Read-MentorCutoverJson([string]$Path){
    Assert-MentorCutoverPath $Path $false -MustExist
    try {return ([IO.File]::ReadAllText($Path,[Text.UTF8Encoding]::new($false,$true)) | ConvertFrom-Json -ErrorAction Stop)}
    catch {throw 'Private JSON is unreadable or invalid; inspect the protected input without printing its contents.'}
}