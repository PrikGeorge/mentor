#Requires -Version 7.2
param([string]$NodeExecutable)
. (Join-Path $PSScriptRoot '../legacy-snapshot.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-snapshot-proof-'+[Guid]::NewGuid().ToString('N'))
New-MentorPrivateDirectory $root
$source=Join-Path $root 'source';$destination=Join-Path $root 'snapshot';$freeze=$null
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
try {
    foreach($relative in @('data/mentoring.json','data/auth/accounts.json','private/materials/manifest.json','private/materials/content.json','training/catalog.json','training/environments.json','content/example.md','code/Sample.java')){
        $path=Join-Path $source $relative;New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
        [IO.File]::WriteAllText($path,"exact synthetic bytes $relative`r`n  Я😀  `r`n",[Text.UTF8Encoding]::new($false))
    }
    [IO.File]::WriteAllText((Join-Path $source 'data/auth/sessions.json'),'MUST NOT COPY')
    [IO.File]::WriteAllText((Join-Path $source 'content/old.md.bak'),'MUST NOT COPY')
    $freeze=Open-MentorLegacyFreeze $source
    if($NodeExecutable){
        $probe=Join-Path $root 'writer-probe.cjs'
        [IO.File]::WriteAllText($probe,"const {createAuthStore}=require(process.argv[2]);try{const store=createAuthStore({dataDir:process.argv[3]});store.close();process.exit(1);}catch(e){if(e.status!==503)process.exit(2);process.stdout.write('PASS actual legacy writer refuses live snapshot lock\n');}")
        & $NodeExecutable $probe (Join-Path $PSScriptRoot '../../lib/auth-store.cjs') (Join-Path $source 'data')
        Require ($LASTEXITCODE -eq 0) 'Actual legacy writer did not refuse the snapshot lock.'
    }
    $secondFailed=$false;try{$second=Open-MentorLegacyFreeze $source;Close-MentorLegacyFreeze $second}catch{$secondFailed=$true}
    Require $secondFailed 'Concurrent legacy freeze unexpectedly acquired ownership.'
    $report=Copy-MentorLegacySnapshot $freeze $destination
    Require ($report.verified -and $report.files.Count -eq 8 -and -not $report.optionalPracticePresent) 'Canonical copy membership is incorrect.'
    Require (-not (Test-Path -LiteralPath (Join-Path $destination 'data/auth/accounts.lock'))) 'Writer lock entered imported source.'
    Require (-not (Test-Path -LiteralPath (Join-Path $destination 'data/auth/sessions.json'))) 'Sessions entered imported source.'
    foreach($entry in $report.files){Require ((Get-FileHash -LiteralPath (Join-Path $source $entry.path)).Hash -eq (Get-FileHash -LiteralPath (Join-Path $destination $entry.path)).Hash) 'Unicode/CRLF source bytes changed.'}
    $oldHash=(Get-FileHash -LiteralPath (Join-Path $destination 'content/example.md')).Hash
    $existingFailed=$false;try{Copy-MentorLegacySnapshot $freeze $destination | Out-Null}catch{$existingFailed=$true}
    Require ($existingFailed -and (Get-FileHash -LiteralPath (Join-Path $destination 'content/example.md')).Hash -eq $oldHash) 'An existing snapshot was overwritten.'
    $outside=Join-Path $root 'outside';New-Item -ItemType Directory -Path $outside | Out-Null
    [IO.File]::WriteAllText((Join-Path $outside 'excluded.txt'),'MUST NOT FOLLOW')
    $linked=Join-Path $source 'content/linked'
    New-Item -ItemType $(if($IsWindows){'Junction'}else{'SymbolicLink'}) -Path $linked -Target $outside | Out-Null
    $linkFailed=$false;try{Copy-MentorLegacySnapshot $freeze (Join-Path $root 'unsafe-snapshot') | Out-Null}catch{$linkFailed=$true}
    Require ($linkFailed -and -not (Test-Path -LiteralPath (Join-Path $root 'unsafe-snapshot'))) 'Linked source was followed or a failed copy remained.'
    Remove-Item -LiteralPath $linked
    Close-MentorLegacyFreeze $freeze;$freeze=$null
    Require (-not (Test-Path -LiteralPath (Join-Path $source 'data/auth/accounts.lock'))) 'Owned source lock leaked.'
    Write-Output 'PASS: exclusive legacy freeze, canonical private byte-exact copy, absent practice preserved, sessions/backups excluded, existing snapshot protected, reparse escape rejected.'
} finally {
    try { if($freeze){Close-MentorLegacyFreeze $freeze} }
    finally {
        $link=Join-Path $source 'content/linked'
        if(Test-Path -LiteralPath $link){Remove-Item -LiteralPath $link}
        if($root -notmatch 'mentor-snapshot-proof-[a-f0-9]{32}$'){throw 'Unexpected fixture cleanup target.'}
        Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
    }
}
