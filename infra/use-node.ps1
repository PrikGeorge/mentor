[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$NodeDirectory,
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @()
)
$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathFullyQualified($NodeDirectory)) { throw 'NodeDirectory must be an absolute path.' }
$runtimeDirectory = (Resolve-Path -LiteralPath $NodeDirectory).Path
$nodeExecutable = Join-Path $runtimeDirectory 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw 'node.exe was not found.' }
$runtimeVersion = & $nodeExecutable --version
if ($LASTEXITCODE -ne 0 -or $runtimeVersion -notmatch '^v(24)\.(\d+)\.(\d+)$' -or [version]$runtimeVersion.TrimStart('v') -lt [version]'24.15.0') { throw 'Use Node.js 24.15.0 or later within major 24.' }
$originalPath = $env:PATH
try {
    $env:PATH = "$runtimeDirectory;$originalPath"
    & $Command @Arguments
    $commandExitCode = $LASTEXITCODE
} finally {
    $env:PATH = $originalPath
}
exit $commandExitCode
