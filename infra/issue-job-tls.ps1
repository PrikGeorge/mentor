#Requires -Version 7.2
# Issues (or rotates) the self-signed server certificate of the private job gateway and the PKCS#12 truststore
# the Java runner uses to trust it. Pure .NET: no openssl, keytool or WSL involved, so the same script runs on
# the Windows host and on a Linux VPS. Nothing is restarted here; the printed plan says what to restart.
#
# Rotation keeps the previous certificate inside the new truststore (overlap), so the safe order is:
#   1) copy truststore.p12 to the runner host and restart the runner (it now trusts old AND new),
#   2) restart job-gateway (it serves the new certificate), 3) status-platform.ps1 shows the new expiry.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Directory,
    [string[]]$Hostnames = @('job-gateway','localhost'),
    [string[]]$IpAddresses = @('127.0.0.1'),
    [ValidateRange(1,825)][int]$ValidityDays = 365,
    [ValidateSet(2048,3072,4096)][int]$KeyBits = 3072,
    [string]$TruststoreFile,
    # Protects only the MAC of a store that holds public certificates; the runner may also open it with no password.
    [string]$TruststorePassword = 'changeit',
    [string[]]$AlsoTrust = @(),
    [switch]$NoPreviousOverlap,
    [switch]$DryRun
)
. (Join-Path $PSScriptRoot 'platform-common.ps1')
. (Join-Path $PSScriptRoot 'job-tls-common.ps1')
if (-not [IO.Path]::IsPathFullyQualified($Directory)) { throw 'Directory must be absolute: it is the MENTOR_JOB_TLS_DIRECTORY mounted into job-gateway.' }
$Directory = [IO.Path]::GetFullPath($Directory)
if ($Directory -match '[\r\n"\x00]') { throw 'Unsupported TLS directory name.' }
if ($Hostnames.Count -lt 1) { throw 'At least one SAN host name is required (the runner connects by this name).' }
foreach ($name in $Hostnames) { if (-not (Test-MentorTlsHostname $name)) { throw "Invalid SAN host name: $name" } }
foreach ($text in $IpAddresses) { $parsed = $null; if (-not [Net.IPAddress]::TryParse($text,[ref]$parsed)) { throw "Invalid SAN IP address: $text" } }
if ($TruststorePassword.Length -lt 1 -or $TruststorePassword -match '[\r\n\x00]') { throw 'TruststorePassword must be a non-empty single line.' }
if (-not $TruststoreFile) { $TruststoreFile = Join-Path $Directory 'truststore.p12' }
if (-not [IO.Path]::IsPathFullyQualified($TruststoreFile)) { throw 'TruststoreFile must be absolute.' }
foreach ($extra in $AlsoTrust) { if (-not [IO.Path]::IsPathFullyQualified($extra) -or -not (Test-Path -LiteralPath $extra -PathType Leaf)) { throw "AlsoTrust entries must be existing absolute certificate files: $extra" } }
$certificatePath = Join-Path $Directory 'server.crt'
$keyPath = Join-Path $Directory 'server.key'
$previous = $null
if (Test-Path -LiteralPath $certificatePath -PathType Leaf) {
    $previous = Get-MentorCertificateInfo $certificatePath
    if ($previous.daysLeft -lt 0) { Write-Warning 'The current certificate has already expired; it is not kept in the truststore.'; $previous = $null }
}
$overlap = ($null -ne $previous) -and -not $NoPreviousOverlap
$plan = @(
    "Job gateway TLS plan:",
    "  directory: $Directory $(if (Test-Path -LiteralPath $Directory) { '(exists)' } else { '(will be created, private)' })",
    "  certificate: $certificatePath; private key: $keyPath (RSA $KeyBits, SHA-256, $ValidityDays days)",
    "  SAN: $((@($Hostnames | ForEach-Object { 'DNS:' + $_ }) + @($IpAddresses | ForEach-Object { 'IP:' + $_ })) -join ', ')",
    "  truststore: $TruststoreFile (PKCS#12, MAC password given, also loadable without a password)",
    "  truststore contents: new certificate$(if ($overlap) { ' + previous certificate (valid until ' + $previous.notAfter + ')' })$(if ($AlsoTrust.Count) { ' + ' + $AlsoTrust.Count + ' extra file(s)' })",
    "  previous files: $(if ($previous) { 'kept as server.crt.previous / server.key.previous until the next rotation' } else { 'none' })"
)
$plan | Write-Output
if ($DryRun) { Write-Output 'Dry-run: nothing was written.'; return }

$trusted = [Collections.Generic.List[Security.Cryptography.X509Certificates.X509Certificate2]]::new()
$issued = New-MentorSelfSignedServerCertificate -Hostnames $Hostnames -IpAddresses $IpAddresses -ValidityDays $ValidityDays -KeyBits $KeyBits
$trusted.Add($issued.Certificate)
if ($overlap) { $trusted.Add((Import-MentorPemCertificate $certificatePath)) }
foreach ($extra in $AlsoTrust) { $trusted.Add((Import-MentorPemCertificate $extra)) }
$truststore = New-MentorTruststore -Certificates $trusted.ToArray() -Password $TruststorePassword

if (-not (Test-Path -LiteralPath $Directory)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Directory) -Force | Out-Null
    New-MentorPrivateDirectory $Directory
}
$truststoreDirectory = Split-Path -Parent $TruststoreFile
if (-not (Test-Path -LiteralPath $truststoreDirectory)) { New-Item -ItemType Directory -Path $truststoreDirectory -Force | Out-Null }
if ($previous) {
    Copy-Item -LiteralPath $certificatePath -Destination ($certificatePath + '.previous') -Force
    if (Test-Path -LiteralPath $keyPath -PathType Leaf) { Copy-Item -LiteralPath $keyPath -Destination ($keyPath + '.previous') -Force; if (-not $IsWindows) { & chmod 600 -- ($keyPath + '.previous') } }
}
$utf8 = [Text.UTF8Encoding]::new($false)
# Key first, then certificate: Caddy only ever sees a key that belongs to the certificate next to it.
Write-MentorPrivateFile $keyPath $utf8.GetBytes($issued.PrivateKeyPem) '600'
Write-MentorPrivateFile $certificatePath $utf8.GetBytes($issued.CertificatePem) '644'
Write-MentorPrivateFile $TruststoreFile $truststore '644'
$info = Get-MentorCertificateInfo $certificatePath
$entries = Get-MentorTruststoreCertificates $TruststoreFile $TruststorePassword
if (@($entries | Where-Object { $_.thumbprint -eq $info.thumbprint -and $_.trustedKeyUsage }).Count -ne 1) { throw 'The written truststore does not contain the new certificate as a trusted entry.' }
[ordered]@{
    certificate=$certificatePath; privateKey=$keyPath; truststore=$TruststoreFile
    thumbprint=$info.thumbprint; subjectAlternativeNames=$info.subjectAlternativeNames; notAfter=$info.notAfter; daysLeft=$info.daysLeft
    truststoreEntries=@($entries | ForEach-Object { $_.thumbprint }); previousKept=[bool]$previous
} | ConvertTo-Json -Depth 4
@(
    'Next steps:',
    "  1. Copy $TruststoreFile to MENTOR_RUNNER_CONFIG on the runner host and restart the runner (docker compose ... restart runner).",
    "  2. Restart the gateway: docker compose --env-file <platform.env> -f infra/compose.platform.yaml --project-name <project> --profile runner restart job-gateway",
    '  3. status-platform.ps1 must show tls.daysLeft of the new certificate and worker: available within a minute.',
    '  4. server.crt.previous / server.key.previous can be deleted once the runner uses the new truststore.'
) | Write-Output
