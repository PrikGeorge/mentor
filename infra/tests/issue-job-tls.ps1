#Requires -Version 7.2
# Certificate issuance and rotation on a temporary directory only; no Docker, no running gateway, no runner.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../platform-common.ps1')
. (Join-Path $PSScriptRoot '../job-tls-common.ps1')
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Reject([scriptblock]$Action,[string]$Expected,[string]$Message){$caught=$null;try{& $Action | Out-Null}catch{$caught=$_.Exception.Message};Require ($caught -and $caught -like "*$Expected*") ($Message+' Actual: '+$caught)}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-tls-proof-'+[Guid]::NewGuid().ToString('N'))
New-MentorPrivateDirectory $root
try {
    $issue=Join-Path $PSScriptRoot '../issue-job-tls.ps1'
    $tls=Join-Path $root 'tls'

    # 1. Dry-run prints the plan and writes nothing.
    $output=(& $issue -Directory $tls -DryRun) -join "`n"
    Require ($output -match 'Job gateway TLS plan' -and $output -match 'DNS:job-gateway, DNS:localhost, IP:127.0.0.1' -and $output -match 'Dry-run: nothing was written') 'Dry-run plan is incomplete.'
    Require (-not (Test-Path -LiteralPath $tls)) 'Dry-run created the TLS directory.'
    Write-Output 'PASS dry-run: plan with SAN list, nothing written.'

    # 2. Refusals: relative directory, invalid host name, invalid IP, missing extra certificate.
    Reject {& $issue -Directory 'relative/tls' -DryRun} 'absolute' 'Relative directory was accepted.'
    Reject {& $issue -Directory $tls -Hostnames @('bad_host!') -DryRun} 'Invalid SAN host name' 'Invalid host name was accepted.'
    Reject {& $issue -Directory $tls -IpAddresses @('999.1.1.1') -DryRun} 'Invalid SAN IP address' 'Invalid IP was accepted.'
    Reject {& $issue -Directory $tls -AlsoTrust @(Join-Path $root 'missing.crt') -DryRun} 'AlsoTrust' 'Missing extra certificate was accepted.'
    Write-Output 'PASS refusals: absolute directory, SAN validation, extra certificate presence.'

    # 3. First issuance: files, SAN, validity, truststore with exactly the new certificate as a trusted entry.
    $output=(& $issue -Directory $tls -Hostnames @('job-gateway','gateway.internal.test') -IpAddresses @('10.20.30.40') -ValidityDays 400 -KeyBits 2048) -join "`n"
    foreach($name in @('server.crt','server.key','truststore.p12')){Require (Test-Path -LiteralPath (Join-Path $tls $name) -PathType Leaf) "$name was not written."}
    Require (-not (Test-Path -LiteralPath (Join-Path $tls 'server.crt.previous'))) 'A first issuance invented a previous certificate.'
    $key=Get-Content -LiteralPath (Join-Path $tls 'server.key') -Raw
    Require ($key -match '^-----BEGIN PRIVATE KEY-----' -and $key -match '-----END PRIVATE KEY-----\n$' -and $key -notmatch "`r") 'Private key is not a LF PKCS#8 PEM.'
    $info=Get-MentorCertificateInfo (Join-Path $tls 'server.crt')
    Require ($info.subjectAlternativeNames -contains 'DNS:job-gateway' -and $info.subjectAlternativeNames -contains 'DNS:gateway.internal.test' -and $info.subjectAlternativeNames -contains 'IP:10.20.30.40') 'SAN entries are missing.'
    Require ($info.daysLeft -ge 398 -and $info.daysLeft -le 400) "Validity is wrong: $($info.daysLeft) days."
    Require ($output -match [regex]::Escape($info.thumbprint) -and $output -match 'Next steps') 'Issuance output lacks the thumbprint or the restart plan.'
    $entries=@(Get-MentorTruststoreCertificates (Join-Path $tls 'truststore.p12') 'changeit')
    Require ($entries.Count -eq 1 -and $entries[0].thumbprint -eq $info.thumbprint -and $entries[0].trustedKeyUsage) 'Truststore does not hold exactly the new trusted certificate.'
    Reject {Get-MentorTruststoreCertificates (Join-Path $tls 'truststore.p12') 'wrong-password'} 'MAC' 'Truststore MAC accepted a wrong password.'
    # The private key must belong to the certificate.
    $certificate=Import-MentorPemCertificate (Join-Path $tls 'server.crt')
    $rsa=[Security.Cryptography.RSA]::Create();$rsa.ImportFromPem($key)
    $probe=[Text.Encoding]::ASCII.GetBytes('mentor key proof')
    $signature=$rsa.SignData($probe,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
    Require ([System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($certificate).VerifyData($probe,$signature,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)) 'server.key does not match server.crt.'
    $certificate.Dispose();$rsa.Dispose()
    Write-Output 'PASS issuance: PEM files, SAN, validity, matching key, single trusted truststore entry, MAC check.'

    # 4. Rotation keeps the previous certificate in the truststore and as .previous files; -NoPreviousOverlap drops it.
    $firstThumbprint=$info.thumbprint
    & $issue -Directory $tls -ValidityDays 30 | Out-Null
    $second=Get-MentorCertificateInfo (Join-Path $tls 'server.crt')
    Require ($second.thumbprint -ne $firstThumbprint -and $second.daysLeft -le 30) 'Rotation did not replace the certificate.'
    Require ((Get-MentorCertificateInfo (Join-Path $tls 'server.crt.previous')).thumbprint -eq $firstThumbprint -and (Test-Path -LiteralPath (Join-Path $tls 'server.key.previous'))) 'Previous certificate/key were not kept.'
    $entries=@(Get-MentorTruststoreCertificates (Join-Path $tls 'truststore.p12') 'changeit')
    Require ($entries.Count -eq 2 -and ($entries.thumbprint -contains $firstThumbprint) -and ($entries.thumbprint -contains $second.thumbprint)) 'Rotated truststore does not trust old and new certificates.'
    $other=Join-Path $root 'other'
    & $issue -Directory $other -Hostnames @('other-gateway') | Out-Null
    & $issue -Directory $tls -NoPreviousOverlap -AlsoTrust @(Join-Path $other 'server.crt') -TruststorePassword 'another-secret' | Out-Null
    $third=Get-MentorCertificateInfo (Join-Path $tls 'server.crt')
    $entries=@(Get-MentorTruststoreCertificates (Join-Path $tls 'truststore.p12') 'another-secret')
    Require ($entries.Count -eq 2 -and ($entries.thumbprint -contains $third.thumbprint) -and ($entries.thumbprint -contains (Get-MentorCertificateInfo (Join-Path $other 'server.crt')).thumbprint) -and -not ($entries.thumbprint -contains $second.thumbprint)) 'NoPreviousOverlap/AlsoTrust produced the wrong truststore.'
    Write-Output 'PASS rotation: overlap by default, .previous files, -NoPreviousOverlap and -AlsoTrust, custom MAC password.'

    # 5. Java interoperability when a JDK is present: keytool must list trustedCertEntry items (the attribute matters).
    $keytool=Get-Command keytool -ErrorAction SilentlyContinue
    if($keytool){
        $listing=(& $keytool.Source -list -keystore (Join-Path $tls 'truststore.p12') -storetype PKCS12 -storepass another-secret 2>&1) -join "`n"
        Require ($LASTEXITCODE -eq 0 -and ([regex]::Matches($listing,'trustedCertEntry')).Count -eq 2) ('keytool does not see two trusted entries: '+$listing)
        Write-Output 'PASS keytool: both certificates are trustedCertEntry items.'
    } else { Write-Output 'SKIP keytool: no JDK on PATH; the Oracle trusted-key-usage attribute is verified structurally only.' }
    Write-Output 'PASS: issue-job-tls dry-run, refusals, issuance, rotation, truststore interoperability.'
} finally {
    if($root -notmatch 'mentor-tls-proof-[a-f0-9]{32}$'){throw 'Unexpected fixture cleanup target.'}
    Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
}
