# Private TLS for the job gateway: self-signed server certificates, PKCS#12 truststores for the Java runner and
# expiry inspection. Pure .NET (no openssl/keytool dependency), usable on Windows and Linux alike.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-MentorPem([byte[]]$Der,[string]$Label) {
    $base64 = [Convert]::ToBase64String($Der)
    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add("-----BEGIN $Label-----")
    for ($offset = 0; $offset -lt $base64.Length; $offset += 64) { $lines.Add($base64.Substring($offset,[Math]::Min(64,$base64.Length-$offset))) }
    $lines.Add("-----END $Label-----")
    return ($lines -join "`n") + "`n"
}

function Test-MentorTlsHostname([string]$Name) {
    return $Name -match '^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$'
}

function New-MentorSelfSignedServerCertificate {
    param(
        [Parameter(Mandatory)][string[]]$Hostnames,
        [string[]]$IpAddresses = @(),
        [ValidateRange(1,825)][int]$ValidityDays = 365,
        [ValidateSet(2048,3072,4096)][int]$KeyBits = 3072
    )
    foreach ($name in $Hostnames) { if (-not (Test-MentorTlsHostname $name)) { throw "Invalid SAN host name: $name" } }
    $addresses = @(foreach ($text in $IpAddresses) { $parsed = $null; if (-not [Net.IPAddress]::TryParse($text,[ref]$parsed)) { throw "Invalid SAN IP address: $text" }; $parsed })
    $rsa = [Security.Cryptography.RSA]::Create($KeyBits)
    try {
        $subject = [Security.Cryptography.X509Certificates.X500DistinguishedName]::new('CN=' + $Hostnames[0] + ', O=Mentor job gateway')
        $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new($subject,$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        foreach ($name in $Hostnames) { $san.AddDnsName($name) }
        foreach ($address in $addresses) { $san.AddIpAddress($address) }
        [void]$request.CertificateExtensions.Add($san.Build($false))
        [void]$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
        [void]$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]'DigitalSignature, KeyEncipherment',$true))
        $serverAuth = [Security.Cryptography.OidCollection]::new(); [void]$serverAuth.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
        [void]$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($serverAuth,$false))
        [void]$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($request.PublicKey,$false))
        $notBefore = [DateTimeOffset]::UtcNow.AddMinutes(-5)
        $certificate = $request.CreateSelfSigned($notBefore,$notBefore.AddDays($ValidityDays))
        try {
            return [pscustomobject]@{
                CertificatePem = ConvertTo-MentorPem $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert) 'CERTIFICATE'
                PrivateKeyPem = ConvertTo-MentorPem $rsa.ExportPkcs8PrivateKey() 'PRIVATE KEY'
                Certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
            }
        } finally { $certificate.Dispose() }
    } finally { $rsa.Dispose() }
}

function Import-MentorPemCertificate([string]$Path) {
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer -or $file.Length -gt 65536 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Use a regular PEM or DER certificate file.' }
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    if ($text -match '-----BEGIN CERTIFICATE-----') { return [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($text) }
    return [Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes)
}

function Get-MentorCertificateInfo([string]$Path) {
    $certificate = Import-MentorPemCertificate $Path
    try {
        $sans = @()
        foreach ($extension in $certificate.Extensions) {
            if ($extension.Oid.Value -ne '2.5.29.17') { continue }
            # The typed parser (.NET 7+) is culture-independent; Format() output is localized on Windows.
            if ('System.Security.Cryptography.X509Certificates.X509SubjectAlternativeNameExtension' -as [type]) {
                $typed = [Security.Cryptography.X509Certificates.X509SubjectAlternativeNameExtension]::new($extension.RawData,$false)
                $sans = @(@($typed.EnumerateDnsNames() | ForEach-Object { 'DNS:' + $_ }) + @($typed.EnumerateIPAddresses() | ForEach-Object { 'IP:' + $_.ToString() }))
            } else {
                $sans = @(($extension.Format($false) -split ',\s*') | ForEach-Object { ($_ -split '=',2)[-1].Trim() } | Where-Object { $_ })
            }
        }
        $notAfter = [DateTimeOffset]::new($certificate.NotAfter.ToUniversalTime(),[TimeSpan]::Zero)
        return [ordered]@{
            path=$Path; subject=$certificate.Subject; thumbprint=$certificate.Thumbprint.ToLowerInvariant()
            notBefore=[DateTimeOffset]::new($certificate.NotBefore.ToUniversalTime(),[TimeSpan]::Zero).ToString('o'); notAfter=$notAfter.ToString('o')
            daysLeft=[int][Math]::Floor(($notAfter - [DateTimeOffset]::UtcNow).TotalDays); subjectAlternativeNames=$sans
        }
    } finally { $certificate.Dispose() }
}

function Get-MentorDerBmpString([string]$Value) {
    $content = [Text.Encoding]::BigEndianUnicode.GetBytes($Value)
    if ($content.Length -gt 127) { throw 'Truststore alias is too long.' }
    return [byte[]](@(0x1E,$content.Length) + $content)
}

function New-MentorTruststore {
    # PKCS#12 with certificate-only bags carrying the Oracle "trusted key usage" attribute (anyExtendedKeyUsage):
    # without it Java's PKCS12 KeyStore silently drops key-less certificates (that is why keytool/-jdktrust exist).
    # Safe contents stay unencrypted (public certificates); the MAC uses $Password, and Java also loads the file
    # with no password at all, which is how compose.runner.yaml references it.
    param([Parameter(Mandatory)][Security.Cryptography.X509Certificates.X509Certificate2[]]$Certificates,[string]$Password = 'changeit',[string]$AliasPrefix = 'mentor-job-gateway')
    $contents = [Security.Cryptography.Pkcs.Pkcs12SafeContents]::new()
    $index = 0
    foreach ($certificate in $Certificates) {
        $index++
        $bag = $contents.AddCertificate($certificate)
        $alias = $AliasPrefix + '-' + $certificate.Thumbprint.Substring(0,16).ToLowerInvariant()
        [void]$bag.Attributes.Add([Security.Cryptography.Pkcs.Pkcs9AttributeObject]::new([Security.Cryptography.Oid]::new('1.2.840.113549.1.9.20'),(Get-MentorDerBmpString $alias)))
        [void]$bag.Attributes.Add([Security.Cryptography.Pkcs.Pkcs9AttributeObject]::new([Security.Cryptography.Oid]::new('2.16.840.1.113894.746875.1.1'),[byte[]](0x06,0x04,0x55,0x1D,0x25,0x00)))
    }
    $builder = [Security.Cryptography.Pkcs.Pkcs12Builder]::new()
    $builder.AddSafeContentsUnencrypted($contents)
    $builder.SealWithMac($Password,[Security.Cryptography.HashAlgorithmName]::SHA256,2048)
    Write-Output -NoEnumerate ([byte[]]$builder.Encode())
}

function Get-MentorTruststoreCertificates([string]$Path,[string]$Password = 'changeit') {
    # Reads a PKCS#12 truststore back (verification only); returns thumbprints of the trusted certificates.
    $bytes = [IO.File]::ReadAllBytes($Path)
    $info = [Security.Cryptography.Pkcs.Pkcs12Info]::Decode($bytes,[ref]0,$true)
    if ($info.IntegrityMode -eq [Security.Cryptography.Pkcs.Pkcs12IntegrityMode]::Password -and -not $info.VerifyMac($Password)) { throw 'Truststore MAC does not verify with the given password.' }
    $result = @()
    foreach ($safe in $info.AuthenticatedSafe) {
        foreach ($bag in $safe.GetBags()) {
            if ($bag -is [Security.Cryptography.Pkcs.Pkcs12CertBag]) {
                $trusted = $false
                foreach ($attribute in $bag.Attributes) { if ($attribute.Oid.Value -eq '2.16.840.1.113894.746875.1.1') { $trusted = $true } }
                $certificate = $bag.GetCertificate()
                try { $result += [pscustomobject]@{ thumbprint=$certificate.Thumbprint.ToLowerInvariant(); subject=$certificate.Subject; trustedKeyUsage=$trusted } } finally { $certificate.Dispose() }
            }
        }
    }
    # Callers wrap the result in @(); a leading comma here would nest the array once more.
    return $result
}

function Write-MentorPrivateFile([string]$Path,[byte[]]$Bytes,[string]$UnixMode) {
    # Write to a sibling temporary file, then replace atomically so a reader never sees a half-written file.
    $temporary = $Path + '.tmp-' + [Guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllBytes($temporary,$Bytes)
    if (-not $IsWindows) {
        & chmod $UnixMode -- $temporary
        if ($LASTEXITCODE -ne 0) { throw "Cannot set permissions on $Path." }
    }
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
