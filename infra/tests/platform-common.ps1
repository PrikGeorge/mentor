#Requires -Version 7.2
# Windows-to-WSL boundaries only: every external command is a double, no Docker/WSL process is started.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../database-rotation-common.ps1')
if (-not $IsWindows) { Write-Output 'SKIP: Windows WSL argument/path checks.'; $global:LASTEXITCODE = 0; return }

function Require([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function SameArguments([string[]]$Actual,[string[]]$Expected,[string]$Message) {
    Require ($Actual.Count -eq $Expected.Count) ($Message + ' Argument count differs.')
    for ($i = 0; $i -lt $Expected.Count; $i++) { Require ($Actual[$i] -ceq $Expected[$i]) ($Message + ' Argument ' + $i + ' differs.') }
}
function Reject([scriptblock]$Action,[string]$Message) {
    $caught = $false
    try { & $Action | Out-Null } catch { $caught = $true }
    Require $caught $Message
}

$previousDistribution = [Environment]::GetEnvironmentVariable('MENTOR_WSL_DISTRIBUTION')
$script:Calls = [Collections.Generic.List[object]]::new()
$script:PathExitCode = 0
$script:ToolExitCode = 0
$script:OverridePath = $false
$script:PathOutput = ''
$script:ValidatedPassphrase = $null
$script:RejectPassphrase = $false
$windows = 'C:\Синтетика с пробелами\$literal\O''Brien\database.dump'
$linux = '/custom-drives/c/Синтетика с пробелами/$literal/O''Brien/database.dump'
$passphrase = 'C:\Синтетика с пробелами\$literal\O''Brien\passphrase.txt'
$output = 'C:\Синтетика с пробелами\$literal\O''Brien\encrypted.gpg'
$gpgScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../gpg-file.sh'))
$script:ToLinux = @{
    $windows = $linux
    $passphrase = '/custom-drives/c/Синтетика с пробелами/$literal/O''Brien/passphrase.txt'
    $output = '/custom-drives/c/Синтетика с пробелами/$literal/O''Brien/encrypted.gpg'
    $gpgScript = '/custom-drives/project/infra/gpg-file.sh'
}
$script:ToWindows = @{ $linux = $windows }

function wsl {
    $arguments = @($args | ForEach-Object { [string]$_ })
    $piped = @($input | ForEach-Object { [string]$_ })
    $script:Calls.Add([pscustomobject]@{ Arguments=$arguments; Stdin=$piped })
    if ($arguments -contains 'wslpath') {
        $global:LASTEXITCODE = $script:PathExitCode
        if ($script:OverridePath) { return $script:PathOutput }
        $map = if ($arguments[-2] -eq '-u') { $script:ToLinux } elseif ($arguments[-2] -eq '-w') { $script:ToWindows } else { throw 'Unexpected wslpath direction.' }
        Require ($map.ContainsKey($arguments[-1])) 'wslpath received an unexpected or re-parsed path.'
        return $map[$arguments[-1]]
    }
    $global:LASTEXITCODE = $script:ToolExitCode
    return 'synthetic-command-output'
}
function docker { throw 'A Windows test must not execute Docker directly.' }
function sh { throw 'A Windows test must not execute sh directly.' }
function Test-MentorPassphraseFile([string]$PassphraseFile) {
    $script:ValidatedPassphrase = $PassphraseFile
    if ($script:RejectPassphrase) { throw 'Synthetic passphrase rejected.' }
}

try {
    foreach ($distribution in @('Mentor QA Синтетика', $null)) {
        if ($null -eq $distribution) { Remove-Item Env:MENTOR_WSL_DISTRIBUTION -ErrorAction SilentlyContinue; $prefix = @('--exec') }
        else { $env:MENTOR_WSL_DISTRIBUTION = $distribution; $prefix = @('--distribution', $distribution, '--exec') }
        $script:Calls.Clear()
        $dockerArguments = @('version', '--format', '{{.Server.Version}}')
        Require ((Invoke-MentorDocker $dockerArguments) -eq 'synthetic-command-output') 'Docker output was lost.'
        SameArguments $script:Calls[0].Arguments ($prefix + @('docker') + $dockerArguments) 'Docker must use the selected WSL/default prefix.'
        SameArguments @(Get-MentorWslArguments) $prefix 'The shared WSL prefix differs.'

        $script:Calls.Clear()
        Require ((ConvertTo-MentorDockerPath $windows) -ceq $linux) 'The configured WSL mount root was replaced by an assumed /mnt root.'
        SameArguments $script:Calls[0].Arguments ($prefix + @('wslpath', '-a', '-u', $windows)) 'Windows path conversion must preserve one literal argument.'
        Require ((ConvertFrom-MentorDockerPath $linux) -ceq $windows) 'Reverse conversion lost a literal path character.'
        SameArguments $script:Calls[1].Arguments ($prefix + @('wslpath', '-a', '-w', $linux)) 'Linux path conversion must preserve one literal argument.'
        $before = $script:Calls.Count
        Require ((ConvertFrom-MentorDockerPath $windows) -ceq $windows) 'A native drive path must remain a native drive path.'
        Require ($script:Calls.Count -eq $before) 'A native drive path needlessly went through WSL.'

        $script:Calls.Clear()
        $stdinText = 'synthetic stdin $literal '' quoted value'
        $stdinArguments = @('exec', '-i', 'synthetic-container', 'psql', '-c', 'SELECT 1')
        Require ((Invoke-MentorDockerStdin $stdinText $stdinArguments) -eq 'synthetic-command-output') 'Docker stdin output was lost.'
        SameArguments $script:Calls[0].Arguments ($prefix + @('docker') + $stdinArguments) 'Docker stdin uses a different WSL prefix.'
        SameArguments $script:Calls[0].Stdin @($stdinText) 'The stdin payload was changed or moved into arguments.'
        Require ($script:Calls[0].Arguments -notcontains $stdinText) 'The stdin payload leaked to arguments.'

        $start = New-MentorDockerProcessStartInfo $stdinArguments
        Require ($start.FileName -ceq 'wsl.exe') 'The maintenance fence does not start WSL directly.'
        SameArguments @($start.ArgumentList) ($prefix + @('docker') + $stdinArguments) 'The maintenance fence uses a different WSL prefix.'
        Require (-not $start.UseShellExecute -and $start.CreateNoWindow) 'The maintenance fence may open a shell/window.'
        Require ($start.RedirectStandardInput -and $start.RedirectStandardOutput -and $start.RedirectStandardError) 'The maintenance fence streams are not redirected.'

        $script:Calls.Clear()
        Invoke-MentorGpg 'encrypt' $passphrase $windows $output | Out-Null
        Require ($script:ValidatedPassphrase -ceq $passphrase) 'GPG skipped passphrase file validation.'
        Require ($script:Calls.Count -eq 5) 'GPG must convert its four paths and then invoke the script.'
        $paths = @($gpgScript, $passphrase, $windows, $output)
        for ($i = 0; $i -lt $paths.Count; $i++) {
            SameArguments $script:Calls[$i].Arguments ($prefix + @('wslpath', '-a', '-u', $paths[$i])) 'GPG path conversion uses a different WSL prefix.'
        }
        SameArguments $script:Calls[4].Arguments ($prefix + @('sh', $script:ToLinux[$gpgScript], 'encrypt', $script:ToLinux[$passphrase], $linux, $script:ToLinux[$output])) 'GPG arguments were changed or interpreted by a shell.'
        Write-Output ('PASS WSL routing: ' + $(if ($distribution) { 'explicit distribution' } else { 'configured WSL default' }))
    }

    $env:MENTOR_WSL_DISTRIBUTION = 'Mentor QA Синтетика'
    $script:OverridePath = $true
    foreach ($invalid in @('', 'relative/path', 'C:\not-linux', "/one`n/two")) {
        $script:PathOutput = $invalid
        Reject { ConvertTo-MentorDockerPath $windows } 'Invalid wslpath Linux output was accepted.'
    }
    foreach ($invalid in @('', 'relative', '/home/synthetic', '\\wsl.localhost\Mentor\home\synthetic', "C:\one`nC:\two")) {
        $script:PathOutput = $invalid
        Reject { ConvertFrom-MentorDockerPath $linux } 'Invalid/UNC wslpath Windows output was accepted.'
    }
    $script:OverridePath = $false
    $script:PathExitCode = 17
    Reject { ConvertTo-MentorDockerPath $windows } 'A failing wslpath -u command was accepted.'
    Reject { ConvertFrom-MentorDockerPath $linux } 'A failing wslpath -w command was accepted.'
    $script:PathExitCode = 0
    $script:ToolExitCode = 23
    Reject { Invoke-MentorDocker @('version') } 'A failing Docker command was accepted.'
    Reject { Invoke-MentorDockerStdin 'synthetic stdin' @('version') } 'A failing Docker stdin command was accepted.'
    Reject { Invoke-MentorGpg 'encrypt' $passphrase $windows $output } 'A failing GPG command was accepted.'
    $script:ToolExitCode = 0

    $script:Calls.Clear()
    $script:RejectPassphrase = $true
    Reject { Invoke-MentorGpg 'encrypt' $passphrase $windows $output } 'A rejected passphrase file reached GPG.'
    Require ($script:Calls.Count -eq 0) 'Rejected passphrase validation still invoked WSL.'
    $script:RejectPassphrase = $false
    Reject { ConvertTo-MentorDockerPath '\\server\share\file.dump' } 'UNC input was accepted as a local drive path.'
    Reject { ConvertFrom-MentorDockerPath 'relative/path' } 'A relative Linux path was accepted.'
    Require ($script:Calls.Count -eq 0) 'Invalid source paths reached WSL.'
    foreach ($invalidDistribution in @(' ', "Mentor`nQA", "Mentor`tQA")) {
        $env:MENTOR_WSL_DISTRIBUTION = $invalidDistribution
        Reject { Get-MentorWslArguments } 'A blank/control-character WSL selector was accepted.'
    }
    Write-Output 'PASS failure boundaries: invalid path/selector, command exit, GPG validation; no external process started.'
} finally {
    if ($null -eq $previousDistribution) { Remove-Item Env:MENTOR_WSL_DISTRIBUTION -ErrorAction SilentlyContinue }
    else { $env:MENTOR_WSL_DISTRIBUTION = $previousDistribution }
    $global:LASTEXITCODE = 0
}
