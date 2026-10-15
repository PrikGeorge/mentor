#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReportFile,
    [Parameter(Mandatory)][ValidatePattern('^sha256:[a-f0-9]{64}$')][string]$ExpectedImageId,
    [Parameter(Mandatory)][ValidateSet('backend', 'web', 'runner', 'postgres')][string]$Profile
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not [IO.Path]::IsPathFullyQualified($ReportFile) -or -not (Test-Path -LiteralPath $ReportFile -PathType Leaf)) {
    throw 'The scan report must be an existing absolute file path.'
}
$report = Get-Content -LiteralPath $ReportFile -Raw | ConvertFrom-Json -AsHashtable
if ($report -isnot [System.Collections.IDictionary] -or $report.SchemaVersion -ne 2 -or
    $report.ArtifactType -cne 'container_image' -or $report.Metadata.ImageID -cne $ExpectedImageId -or
    $report.Results -isnot [array] -or $report.Results.Count -eq 0) {
    throw 'Invalid Trivy image report, unsupported schema or different image ID.'
}

$hasOs = $false; $hasJar = $false; $hasGo = $false
$blocking = @(); $unfixed = 0; $total = 0
foreach ($result in $report.Results) {
    if ($result -isnot [System.Collections.IDictionary] -or [string]::IsNullOrWhiteSpace($result.Class) -or
        [string]::IsNullOrWhiteSpace($result.Type) -or [string]::IsNullOrWhiteSpace($result.Target)) {
        throw 'A scan result is missing its class, type or target.'
    }
    $hasPackages = $result['Packages'] -is [array] -and $result['Packages'].Count -gt 0
    if ($hasPackages) {
        foreach ($package in $result.Packages) {
            if ($package -isnot [System.Collections.IDictionary] -or [string]::IsNullOrWhiteSpace($package['Name'])) {
                throw 'Invalid package inventory entry.'
            }
        }
    }
    if ($result.Class -ceq 'os-pkgs' -and $result.Type -cin @('ubuntu', 'debian', 'alpine') -and $hasPackages) { $hasOs = $true }
    if ($result.Class -ceq 'lang-pkgs' -and $result.Type -ceq 'jar' -and $hasPackages) { $hasJar = $true }
    if ($result.Class -ceq 'lang-pkgs' -and $result.Type -ceq 'gobinary' -and $hasPackages) {
        if (($Profile -eq 'runner' -and $result.Target -cmatch '^/?usr/local/bin/docker$') -or
            ($Profile -eq 'web' -and $result.Target -cmatch '^/?usr/bin/caddy$')) { $hasGo = $true }
    }
    if ($null -ne $result['Vulnerabilities'] -and $result['Vulnerabilities'] -isnot [array]) { throw 'Invalid vulnerability list.' }
    foreach ($finding in $result['Vulnerabilities']) {
        if ($finding -isnot [System.Collections.IDictionary] -or
            $finding.Severity -cnotin @('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') -or
            [string]::IsNullOrWhiteSpace($finding.VulnerabilityID) -or [string]::IsNullOrWhiteSpace($finding.PkgName)) {
            throw 'Invalid vulnerability entry.'
        }
        $total++
        if ($finding.Severity -cin @('HIGH', 'CRITICAL')) {
            if ([string]::IsNullOrWhiteSpace($finding['FixedVersion'])) { $unfixed++ }
            else { $blocking += "$($finding.VulnerabilityID) $($finding.PkgName) -> $($finding.FixedVersion) [$($result.Target)]" }
        }
    }
}
if (-not $hasOs -or ($Profile -in @('backend', 'runner') -and -not $hasJar) -or
    ($Profile -in @('web', 'runner') -and -not $hasGo)) {
    throw "Incomplete OS/JAR/Go package inventory for $Profile; an empty scan is not a passing scan."
}
if ($blocking.Count -gt 0) { throw "Found $($blocking.Count) fixable HIGH/CRITICAL vulnerabilities: $($blocking -join '; ')" }
[pscustomobject]@{
    ImageId = $ExpectedImageId
    Profile = $Profile
    BlockingCount = 0
    UnfixedHighCriticalCount = $unfixed
    TotalVulnerabilities = $total
}
