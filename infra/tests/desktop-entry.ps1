#Requires -Version 7.2
# Reproduces launching the real CMD entry point without Codex's injected PATH.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $IsWindows){throw 'This entry-point regression requires Windows.'}
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$fixture=Join-Path $repository ('.runtime/desktop-entry-'+[Guid]::NewGuid().ToString('N'))
$project=Join-Path $fixture 'project with spaces & !'
$bin=Join-Path $fixture 'bin'
$local=Join-Path $fixture 'local'
$empty=Join-Path $fixture 'empty'
foreach($directory in @($project,$bin,$empty,(Join-Path $local 'Programs/PowerShell'))){New-Item -ItemType Directory -Path $directory -Force | Out-Null}
Copy-Item -LiteralPath (Join-Path $repository 'Start-Mentor.cmd') -Destination $project
# Only the missing-runtime dialog boundary is doubled, so a failing test cannot display a blocking GUI.
Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32/whoami.exe') -Destination (Join-Path $bin 'powershell.exe')
$junction=New-Item -ItemType Junction -Path (Join-Path $local 'Programs/PowerShell/7') -Target $PSHOME
$probe=@'
[CmdletBinding()]
param([switch]$NoBrowser,[string]$EnvironmentFile,[string]$ProjectName)
@{noBrowser=[bool]$NoBrowser;environmentFile=$EnvironmentFile;projectName=$ProjectName;version=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'result.json')
exit 37
'@
[IO.File]::WriteAllText((Join-Path $project 'start-local.ps1'),$probe,[Text.UTF8Encoding]::new($false))
function RunCase([string]$Name,[bool]$PathRuntime,[bool]$LocalRuntime,[bool]$ExpectedSuccess){
    $result=Join-Path $project 'result.json'
    if(Test-Path -LiteralPath $result){Remove-Item -LiteralPath $result}
    $start=[Diagnostics.ProcessStartInfo]::new((Join-Path $env:SystemRoot 'System32/cmd.exe'))
    $start.Arguments='/d /v:off /s /c ""'+(Join-Path $project 'Start-Mentor.cmd')+'" -NoBrowser -EnvironmentFile "a path with spaces & !" -ProjectName "entry-test""'
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $start.Environment['PATH']=$bin+';'+(Join-Path $env:SystemRoot 'System32')+$(if($PathRuntime){';'+$PSHOME}else{''})
    $start.Environment['LOCALAPPDATA']=$(if($LocalRuntime){$local}else{$empty})
    $start.Environment['ProgramFiles']=$empty;$start.Environment['ProgramW6432']=$empty
    $process=[Diagnostics.Process]::Start($start)
    if(-not $process.WaitForExit(15000)){$process.Kill($true);throw "${Name}: launcher hung."}
    $stdout=$process.StandardOutput.ReadToEnd();$stderr=$process.StandardError.ReadToEnd()
    if($ExpectedSuccess){
        if($process.ExitCode -ne 37 -or -not (Test-Path -LiteralPath $result)){throw "${Name}: installed PowerShell was not used (exit $($process.ExitCode))."}
        $actual=Get-Content -Raw -LiteralPath $result | ConvertFrom-Json
        if(-not $actual.noBrowser -or $actual.environmentFile -cne 'a path with spaces & !' -or $actual.projectName -cne 'entry-test' -or [version]$actual.version -lt [version]'7.2'){throw "${Name}: arguments or runtime changed."}
    }elseif($process.ExitCode -ne 1 -or (Test-Path -LiteralPath $result)){throw "${Name}: missing runtime did not fail before launch."}
    Write-Output "PASS $Name"
}
try {
    RunCase 'per-user install without PATH' $false $true $true
    RunCase 'runtime on PATH' $true $false $true
    RunCase 'missing runtime' $false $false $false
}finally{
    # Remove only our junction itself; never recursively traverse its runtime target.
    if(Test-Path -LiteralPath $junction.FullName){Remove-Item -LiteralPath $junction.FullName}
}
