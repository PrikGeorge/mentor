#Requires -Version 7.2
# Actual BuildKit exports FROM scratch probes; all context contents are synthetic, no image/container is run.
. (Join-Path $PSScriptRoot '../platform-common.ps1')
function Require([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$rootIgnore = Join-Path $repository '.dockerignore'
Require (Test-Path -LiteralPath $rootIgnore -PathType Leaf) 'Root .dockerignore fallback is missing.'
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$root = Join-Path $temporaryRoot ('mentor-docker-context-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$fixture = Join-Path $root 'context'
New-Item -ItemType Directory -Path $fixture | Out-Null

$expected = [ordered]@{
    root = @()
    backend = @(
        'pom.xml', 'backend/pom.xml', 'runner/pom.xml',
        'backend/src/main/java/ru/mentor/Probe.java', 'backend/src/main/resources/application.yaml',
        'backend/target/backend-0.1.jar'
    )
    frontend = @(
        'frontend/package.json', 'frontend/package-lock.json', 'frontend/tools/api/package.json',
        'frontend/angular.json', 'frontend/tsconfig.json', 'frontend/src/main.ts',
        'frontend/public/favicon.ico', 'frontend/licenses/synthetic-license.txt',
        'frontend/dist/mentor/browser/index.html', 'frontend/dist/mentor/3rdpartylicenses.txt', 'infra/proxy/Caddyfile'
    )
    'runner-service' = @(
        'pom.xml', 'backend/pom.xml', 'runner/pom.xml', 'contracts/runner.openapi.yaml',
        'runner/src/main/java/ru/mentor/runner/Probe.java', 'runner/src/main/resources/harness/Probe.java',
        'runner/target/runner-0.1.jar'
    )
}
$canaries = @(
    'private/canary.txt', 'data/canary.txt', '.runtime/canary.txt', '.git/config',
    'backup.dump', 'compose.env', 'dist/legacy/index.html', 'training/catalog.json',
    'node_modules/synthetic-package/index.js', 'frontend/node_modules/canary.js',
    'frontend/tools/api/node_modules/canary.js', 'frontend/.angular/cache/canary.txt',
    'frontend/test-results/canary.txt', 'frontend/playwright-report/canary.html',
    'frontend/dist/legacy/index.html', 'frontend/dist/unrelated.txt', 'frontend/dist/mentor/unrelated.txt',
    'backend/target/classes/canary.txt', 'runner/target/classes/canary.txt',
    'backend/target/report.xml', 'runner/target/report.xml',
    'backend/src/test/ProbeTest.java', 'runner/src/test/ProbeTest.java',
    'infra/proxy/unrelated.txt', 'infra/proxy/secrets/canary.txt'
)
function Write-Fixture([string]$Relative, [string]$Content) {
    $path = Join-Path $fixture $Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    [IO.File]::WriteAllText($path, $Content)
}

try {
    # Only ignore policies are copied from the repository. Even package/JAR/config filenames below contain synthetic text.
    Copy-Item -LiteralPath $rootIgnore -Destination (Join-Path $fixture '.dockerignore')
    $publicFiles = @($expected.Values | ForEach-Object { $_ } | Sort-Object -Unique)
    foreach ($relative in $publicFiles) { Write-Fixture $relative ('synthetic-public:' + $relative) }
    foreach ($relative in $canaries) { Write-Fixture $relative ('synthetic-excluded:' + $relative) }
    foreach ($profile in $expected.Keys) {
        $relativeDockerfile = if ($profile -eq 'root') { 'Dockerfile' } else { 'infra/' + $profile + '/Dockerfile' }
        Write-Fixture $relativeDockerfile "FROM scratch`nCOPY . /context/`n"
        if ($profile -ne 'root') {
            $relativeIgnore = $relativeDockerfile + '.dockerignore'
            $ignore = Join-Path $repository $relativeIgnore
            Require (Test-Path -LiteralPath $ignore -PathType Leaf) ('Per-Dockerfile policy is missing: ' + $relativeIgnore)
            Copy-Item -LiteralPath $ignore -Destination (Join-Path $fixture $relativeIgnore)
        }
    }

    $dockerContext = ConvertTo-MentorDockerPath $fixture
    foreach ($profile in $expected.Keys) {
        $relativeDockerfile = if ($profile -eq 'root') { 'Dockerfile' } else { 'infra/' + $profile + '/Dockerfile' }
        $dockerfile = ConvertTo-MentorDockerPath (Join-Path $fixture $relativeDockerfile)
        # Export is a sibling of the context, so prior probe output cannot enter later builds.
        $export = Join-Path $root ('export-' + $profile)
        New-Item -ItemType Directory -Path $export | Out-Null
        $dockerExport = ConvertTo-MentorDockerPath $export
        Invoke-MentorDocker @('buildx', 'build', '--network=none', '--progress=plain', '--file', $dockerfile,
            '--output', ('type=local,dest=' + $dockerExport), $dockerContext) | Out-Null
        if ($profile -eq 'root') {
            $files = if (Test-Path -LiteralPath $export) { @(Get-ChildItem -LiteralPath $export -File -Recurse -Force) } else { @() }
            Require (@($files).Count -eq 0) 'Root fallback exposed files through COPY . instead of denying the context.'
        } else {
            $captured = Join-Path $export 'context'
            Require (Test-Path -LiteralPath $captured -PathType Container) ('Missing exported context for ' + $profile + '.')
            $actualFiles = @(Get-ChildItem -LiteralPath $export -File -Recurse -Force | ForEach-Object {
                [IO.Path]::GetRelativePath($export, $_.FullName).Replace('\', '/')
            } | Sort-Object)
            $expectedFiles = @($expected[$profile] | ForEach-Object { 'context/' + $_ } | Sort-Object)
            Require (($actualFiles -join '|') -ceq ($expectedFiles -join '|')) ($profile + ' exported a different file set: ' + ($actualFiles -join ', '))
            foreach ($relative in $expected[$profile]) {
                $path = Join-Path $captured $relative
                Require (Test-Path -LiteralPath $path -PathType Leaf) ($profile + ' lost a required source/prebuilt file: ' + $relative)
                Require ([IO.File]::ReadAllText($path) -ceq ('synthetic-public:' + $relative)) ($profile + ' changed exported bytes: ' + $relative)
            }
            foreach ($relative in $canaries) {
                Require (-not (Test-Path -LiteralPath (Join-Path $captured $relative))) ($profile + ' exposed an excluded canary: ' + $relative)
            }
        }
        Write-Output ('PASS actual BuildKit context: ' + $profile)
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    Require ((Split-Path -Parent $resolved) -ceq $temporaryRoot -and (Split-Path -Leaf $resolved) -match '^mentor-docker-context-[a-f0-9]{32}$') 'Refusing cleanup outside the owned synthetic context.'
    Remove-MentorOwnedDirectory $resolved $temporaryRoot
}
