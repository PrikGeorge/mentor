#Requires -Version 7.2
# Synthetic Trivy reports only: no scanner, Docker, WSL or image download is invoked.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Reject([scriptblock]$Operation, [string]$Message) {
    $failed = $false
    try { & $Operation | Out-Null } catch { $failed = $true }
    Require $failed $Message
}
function docker { throw 'Image report tests must not invoke Docker.' }
function wsl { throw 'Image report tests must not invoke WSL.' }
function trivy { throw 'Image report tests must not invoke a scanner.' }

$checker = Join-Path $PSScriptRoot '../check-image-scan.ps1'
Require (Test-Path -LiteralPath $checker -PathType Leaf) 'The image scan report validator is not implemented.'
$expectedId = 'sha256:' + ('a' * 64)
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$root = Join-Path $temporaryRoot ('mentor-image-scan-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$script:reportNumber = 0

function New-Result([string]$Target, [string]$Class, [string]$Type) {
    return @{
        Target = $Target
        Class = $Class
        Type = $Type
        Packages = @(@{ Name = 'synthetic-package'; Version = '1.0.0' })
        Vulnerabilities = @()
    }
}
function New-Report([string]$Profile) {
    $osType = if ($Profile -in @('web', 'postgres')) { 'alpine' } else { 'debian' }
    $results = @(New-Result 'synthetic-image (synthetic OS)' 'os-pkgs' $osType)
    if ($Profile -in @('backend', 'runner')) { $results += New-Result 'opt/mentor/application.jar' 'lang-pkgs' 'jar' }
    if ($Profile -in @('web', 'runner')) {
        $target = if ($Profile -eq 'runner') { 'usr/local/bin/docker' } else { 'usr/bin/caddy' }
        $results += New-Result $target 'lang-pkgs' 'gobinary'
    }
    return @{
        SchemaVersion = 2
        ArtifactName = 'synthetic-image:fixture'
        ArtifactType = 'container_image'
        Metadata = @{ ImageID = $expectedId }
        Results = $results
    }
}
function New-Finding([string]$Severity, $FixedVersion) {
    return @{
        VulnerabilityID = 'CVE-2099-0001'
        PkgName = 'synthetic-package'
        InstalledVersion = '1.0.0'
        Severity = $Severity
        FixedVersion = $FixedVersion
    }
}
function Save-Report($Report) {
    $script:reportNumber++
    $path = Join-Path $root ('report-' + $script:reportNumber + '.json')
    [IO.File]::WriteAllText($path, ($Report | ConvertTo-Json -Depth 20))
    return $path
}
function Accept-Report($Report, [string]$Profile, [int]$Total = 0, [int]$Unfixed = 0) {
    $path = Save-Report $Report
    $original = [IO.File]::ReadAllText($path)
    $output = @(& $checker -ReportFile $path -ExpectedImageId $expectedId -Profile $Profile)
    Require ($output.Count -eq 1) 'Successful validation must return exactly one summary.'
    $summary = $output[0]
    Require ($summary.ImageId -ceq $expectedId -and $summary.Profile -ceq $Profile) 'The summary lost its image/profile binding.'
    Require ($summary.BlockingCount -eq 0) 'A successful report contains blocking vulnerabilities.'
    Require ($summary.TotalVulnerabilities -eq $Total) 'The summary omitted vulnerabilities from its total.'
    Require ($summary.UnfixedHighCriticalCount -eq $Unfixed) 'The unfixed HIGH/CRITICAL count is wrong.'
    Require ([IO.File]::ReadAllText($path) -ceq $original) 'Validation rewrote the scanner report.'
}
function Reject-Report($Report, [string]$Profile, [string]$Message) {
    $path = Save-Report $Report
    Reject { & $checker -ReportFile $path -ExpectedImageId $expectedId -Profile $Profile } $Message
}

try {
    foreach ($profile in @('backend', 'web', 'runner', 'postgres')) { Accept-Report (New-Report $profile) $profile }
    foreach ($profile in @('backend', 'web', 'runner', 'postgres')) {
        $report = New-Report $profile
        foreach ($result in $report.Results) { $result.Remove('Vulnerabilities') }
        Accept-Report $report $profile
    }
    foreach ($profile in @('web', 'runner')) {
        $report = New-Report $profile
        $report.Results[-1].Packages[0].Remove('Version')
        Accept-Report $report $profile
    }
    Write-Output 'PASS: complete OS/JAR/Go inventory for each image profile, exact summary binding, unchanged source report.'
    Write-Output 'PASS: Trivy omitempty Vulnerabilities and Go package without a known Version are accepted.'

    $report = New-Report 'backend'
    $missingFix = New-Finding 'HIGH' $null
    $missingFix.Remove('FixedVersion')
    $report.Results[0].Vulnerabilities = @(
        (New-Finding 'UNKNOWN' ''), (New-Finding 'LOW' '1.0.1'), (New-Finding 'MEDIUM' '1.0.1'),
        (New-Finding 'HIGH' " `t "), (New-Finding 'CRITICAL' $null), $missingFix
    )
    $report.Results[1].Vulnerabilities = @((New-Finding 'LOW' '1.0.2'))
    Accept-Report $report 'backend' 7 3
    foreach ($case in @(
        @{ Profile = 'postgres'; Index = 0; Severity = 'HIGH' },
        @{ Profile = 'backend'; Index = 1; Severity = 'CRITICAL' },
        @{ Profile = 'web'; Index = 1; Severity = 'HIGH' },
        @{ Profile = 'runner'; Index = 2; Severity = 'CRITICAL' }
    )) {
        $report = New-Report $case.Profile
        $report.Results[$case.Index].Vulnerabilities = @((New-Finding $case.Severity '1.0.1'))
        Reject-Report $report $case.Profile ('A fixed ' + $case.Severity + ' finding was accepted for ' + $case.Profile + '.')
    }
    Write-Output 'PASS: all severities counted, absent/blank fixes allowed, fixed HIGH/CRITICAL rejected in OS/JAR/Go findings.'

    foreach ($field in @('SchemaVersion', 'ArtifactType', 'Metadata', 'Results')) {
        $report = New-Report 'postgres'
        $report.Remove($field)
        Reject-Report $report 'postgres' ('A missing report field was accepted: ' + $field)
    }
    $report = New-Report 'postgres'; $report.SchemaVersion = 1
    Reject-Report $report 'postgres' 'An unsupported Trivy schema version was accepted.'
    $report = New-Report 'postgres'; $report.ArtifactType = 'filesystem'
    Reject-Report $report 'postgres' 'A filesystem scan was accepted as an image scan.'
    $report = New-Report 'postgres'; $report.Metadata.Remove('ImageID')
    Reject-Report $report 'postgres' 'A report without an image ID was accepted.'
    $report = New-Report 'postgres'; $report.Metadata.ImageID = 'sha256:' + ('b' * 64)
    Reject-Report $report 'postgres' 'A scan of a different image was accepted.'
    $report = New-Report 'postgres'; $report.Results = @()
    Reject-Report $report 'postgres' 'An empty scan was accepted as zero vulnerabilities.'
    foreach ($field in @('Class', 'Type', 'Packages')) {
        $report = New-Report 'postgres'; $report.Results[0].Remove($field)
        Reject-Report $report 'postgres' ('Incomplete OS inventory was accepted: ' + $field)
    }
    $report = New-Report 'postgres'; $report.Results[0].Type = 'unknown'
    Reject-Report $report 'postgres' 'An unsupported OS package inventory was accepted.'
    foreach ($profile in @('backend', 'web', 'runner', 'postgres')) {
        $report = New-Report $profile; $report.Results[0].Packages = @()
        Reject-Report $report $profile ('Empty OS packages were accepted for ' + $profile + '.')
        $report = New-Report $profile; $report.Results = @($report.Results | Where-Object { $_.Class -ne 'os-pkgs' })
        Reject-Report $report $profile ('Missing OS inventory was accepted for ' + $profile + '.')
    }
    foreach ($profile in @('backend', 'runner')) {
        $report = New-Report $profile; $report.Results[1].Packages = @()
        Reject-Report $report $profile ('Empty JAR packages were accepted for ' + $profile + '.')
        $report = New-Report $profile; $report.Results = @($report.Results | Where-Object { $_.Type -ne 'jar' })
        Reject-Report $report $profile ('Missing JAR inventory was accepted for ' + $profile + '.')
    }
    foreach ($profile in @('web', 'runner')) {
        $report = New-Report $profile; $report.Results[-1].Packages = @()
        Reject-Report $report $profile ('Empty Go packages were accepted for ' + $profile + '.')
        $report = New-Report $profile; $report.Results = @($report.Results | Where-Object { $_.Type -ne 'gobinary' })
        Reject-Report $report $profile ('Missing Go inventory was accepted for ' + $profile + '.')
    }
    foreach ($inventory in @(
        @{ Profile = 'postgres'; Index = 0; Type = 'OS' },
        @{ Profile = 'backend'; Index = 1; Type = 'JAR' },
        @{ Profile = 'web'; Index = 1; Type = 'Caddy Go' },
        @{ Profile = 'runner'; Index = 2; Type = 'Docker Go' }
    )) {
        foreach ($invalid in @(
            @{ Description = 'null'; Package = $null },
            @{ Description = 'empty object'; Package = @{} },
            @{ Description = 'blank name'; Package = @{ Name = '' } }
        )) {
            $report = New-Report $inventory.Profile
            $report.Results[$inventory.Index].Packages = @($invalid.Package)
            Reject-Report $report $inventory.Profile ($inventory.Type + ' inventory accepted a ' + $invalid.Description + ' package.')
        }
    }
    $report = New-Report 'web'; $report.Results[-1].Target = 'usr/bin/unrelated'
    Reject-Report $report 'web' 'An unrelated Go binary substituted for Caddy.'
    $report = New-Report 'runner'; $report.Results[-1].Target = 'usr/local/bin/unrelated'
    Reject-Report $report 'runner' 'An unrelated Go binary substituted for the runner Docker CLI.'
    $report = New-Report 'runner'; $report.Results[-1].Packages = @()
    $report.Results += New-Result 'usr/bin/unrelated' 'lang-pkgs' 'gobinary'
    Reject-Report $report 'runner' 'Other Go packages hid an empty Docker CLI inventory.'
    Write-Output 'PASS: malformed metadata, wrong image, empty/invalid OS/JAR/Go inventories and wrong Caddy/Docker targets rejected.'

    $invalidJson = Join-Path $root 'invalid.json'
    [IO.File]::WriteAllText($invalidJson, '{ synthetic invalid JSON')
    Reject { & $checker -ReportFile $invalidJson -ExpectedImageId $expectedId -Profile postgres } 'Invalid JSON was accepted.'
    $missing = Join-Path $root 'missing.json'
    Reject { & $checker -ReportFile $missing -ExpectedImageId $expectedId -Profile postgres } 'A missing report was accepted.'
    Reject { & $checker -ReportFile 'relative-report.json' -ExpectedImageId $expectedId -Profile postgres } 'A relative report path was accepted.'
    $validPath = Save-Report (New-Report 'postgres')
    Reject { & $checker -ReportFile $validPath -ExpectedImageId 'sha256:not-an-image-id' -Profile postgres } 'A malformed expected image ID was accepted.'
    Write-Output 'PASS: invalid JSON, missing/relative report paths and malformed expected image ID rejected; no scanner invoked.'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    Require ((Split-Path -Parent $resolved) -ceq $temporaryRoot) 'Refusing to clean a directory outside the owned temporary root.'
    Require ((Split-Path -Leaf $resolved) -match '^mentor-image-scan-[a-f0-9]{32}$') 'Refusing to clean an unowned temporary directory.'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
