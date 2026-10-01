# A caller may lend the same exclusive maintenance file lock to nested backup work.
. (Join-Path $PSScriptRoot 'platform-common.ps1')
function Get-MentorMaintenancePath([string]$EnvironmentFile,[string]$ProjectName){
    if(-not [IO.Path]::IsPathFullyQualified($EnvironmentFile) -or $ProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$'){throw 'Choose an absolute environment file and valid project name.'}
    return [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($EnvironmentFile))) ($ProjectName+'.maintenance.lock')))
}
function Assert-MentorMaintenanceLease([IO.FileStream]$Lease,[string]$EnvironmentFile,[string]$ProjectName){
    $expected=Get-MentorMaintenancePath $EnvironmentFile $ProjectName
    $comparison=if($IsWindows){[StringComparison]::OrdinalIgnoreCase}else{[StringComparison]::Ordinal}
    try {
        if($null -eq $Lease -or -not $Lease.CanWrite -or $Lease.SafeFileHandle.IsClosed -or $Lease.SafeFileHandle.IsInvalid -or -not [string]::Equals([IO.Path]::GetFullPath($Lease.Name),$expected,$comparison)){throw 'Invalid lease.'}
    } catch {throw 'Maintenance lease must be open, writable and owned by this exact project lock.'}
    if((Get-Item -LiteralPath $expected -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Maintenance locks must not be links.'}
    $probe=$null
    try {$probe=[IO.File]::Open($expected,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)} catch [IO.IOException] {return}
    finally {if($probe){$probe.Dispose()}}
    throw 'Maintenance lease must exclude competing writers.'
}
function Open-MentorMaintenanceLease([string]$EnvironmentFile,[string]$ProjectName,[IO.FileStream]$Borrowed){
    $path=Get-MentorMaintenancePath $EnvironmentFile $ProjectName
    if($null -ne $Borrowed){Assert-MentorMaintenanceLease $Borrowed $EnvironmentFile $ProjectName;return [pscustomobject]@{Stream=$Borrowed;Owned=$false}}
    if((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Maintenance locks must not be links.'}
    return [pscustomobject]@{Stream=[IO.File]::Open($path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);Owned=$true}
}
function Close-MentorMaintenanceLease($Context){if($Context -and $Context.Owned){$Context.Stream.Dispose()}}