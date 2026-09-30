param(
    [string]$Profiles = 'training/environments.json',
    [string]$Cache = '.runtime/training-cache',
    [string]$Manifest = '.runtime/runner-environments.json'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $repo
try {
    & .\mvnw.cmd -pl runner -DskipTests package
    if ($LASTEXITCODE -ne 0) { throw 'Runner packaging failed.' }
    & java -jar runner/target/runner-0.1.0-SNAPSHOT.jar --prepare $Profiles --cache $Cache --manifest $Manifest
    if ($LASTEXITCODE -ne 0) { throw 'Environment preparation failed. Pull the approved base image and verify the dependency cache.' }
    Write-Output "Prepared operator manifest: $Manifest"
} finally { Pop-Location }
