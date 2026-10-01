#Requires -Version 7.2
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Destination)
. (Join-Path $PSScriptRoot 'legacy-snapshot.ps1')
if(-not [IO.Path]::IsPathFullyQualified($Source) -or -not [IO.Path]::IsPathFullyQualified($Destination)){throw 'Source and Destination must be absolute.'}
$freeze=$null
try {
    $freeze=Open-MentorLegacyFreeze $Source
    $manifest=Copy-MentorLegacySnapshot $freeze $Destination
    # Importer's canonical sourceDigest is authoritative; this utility proves byte-for-byte copying only.
    Write-Output ("Verified private legacy snapshot: $Destination ("+$manifest.files.Count+' files).')
} finally { if($freeze){Close-MentorLegacyFreeze $freeze} }
