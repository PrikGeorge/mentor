#Requires -Version 7.2
# SCRAM derivation against the RFC 7677 vector, then the rotation script against a Docker double: no live
# Compose project, container or database is touched and no password ever appears on a command line.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../database-rotation-common.ps1')
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Reject([scriptblock]$Action,[string]$Expected,[string]$Message){$caught=$null;try{& $Action | Out-Null}catch{$caught=$_.Exception.Message};Require ($caught -and $caught -like "*$Expected*") ($Message+' Actual: '+$caught)}

# 1. RFC 7677 (SCRAM-SHA-256) example: the proof and server signature must reproduce from our derived keys.
$keys=Get-MentorScramKeys 'pencil' ([Convert]::FromBase64String('W22ZaJ0SNY7soEsUEjb6gQ==')) 4096
$authMessage='n=user,r=rOprNGfwEbeRWgbNEkqO,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0'
$storedHmac=[Security.Cryptography.HMACSHA256]::new($keys.StoredKey);$clientSignature=$storedHmac.ComputeHash([Text.Encoding]::ASCII.GetBytes($authMessage));$storedHmac.Dispose()
$proof=[byte[]]::new(32);for($i=0;$i -lt 32;$i++){$proof[$i]=$keys.ClientKey[$i] -bxor $clientSignature[$i]}
Require ([Convert]::ToBase64String($proof) -eq 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=') 'Client proof differs from RFC 7677: StoredKey/ClientKey derivation is wrong.'
$serverHmac=[Security.Cryptography.HMACSHA256]::new($keys.ServerKey);$serverSignature=$serverHmac.ComputeHash([Text.Encoding]::ASCII.GetBytes($authMessage));$serverHmac.Dispose()
Require ([Convert]::ToBase64String($serverSignature) -eq '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=') 'Server signature differs from RFC 7677: ServerKey derivation is wrong.'
$verifier=New-MentorScramVerifier 'pencil' ([Convert]::FromBase64String('W22ZaJ0SNY7soEsUEjb6gQ=='))
Require ((Test-MentorScramVerifier $verifier) -and $verifier.StartsWith('SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$')) 'Verifier format is not what PostgreSQL stores.'
Reject {New-MentorScramVerifier 'пароль'} 'ASCII' 'Non-ASCII password was accepted without SASLprep.'
Write-Output 'PASS SCRAM: RFC 7677 proof and signature reproduced; verifier format; non-ASCII rejected.'

# 2. Rotation against a Docker double.
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-rotate-proof-'+[Guid]::NewGuid().ToString('N'))
New-MentorPrivateDirectory $root
$global:calls=[Collections.Generic.List[string]]::new()
$global:stdin=[Collections.Generic.List[string]]::new()
$global:databaseVerifier=$null
$global:rejectNewPassword=$false
$global:ids=@{postgres=('a'*64);backend=('b'*64)}
$global:secretDockerPath=$null
function Test-SyntheticAuth([string]$Password){
    # The double checks the password against the stored verifier exactly as PostgreSQL would: same salt and iterations.
    if(-not $global:databaseVerifier){return $false}
    $parts=$global:databaseVerifier -split '[$:]'
    $expected=New-MentorScramVerifier $Password ([Convert]::FromBase64String($parts[2])) ([int]$parts[1])
    return $expected -eq $global:databaseVerifier
}
function docker {
    $global:LASTEXITCODE=0;$a=@($args);$global:calls.Add(($a -join ' '))
    $piped=@($input | ForEach-Object { [string]$_ })
    if($a[0] -eq 'compose'){
        $sub=$a[[Array]::IndexOf($a,'--project-name')+2]
        switch($sub){
            'config'{return ('{"services":{"backend":{"environment":{"MENTOR_PUBLIC_ORIGIN":"http://127.0.0.1:65000"}}},"secrets":{"database_password":{"file":"'+$global:secretDockerPath+'"}}}')}
            'ps'{return $global:ids[$a[-1]]}
            'stop'{$global:backendRunning=$false;return}
            'start'{$global:backendRunning=$true;return}
            'up'{Require ($a -contains '--no-deps' -and $a -contains '--force-recreate' -and $a[-1] -eq 'backend') 'backend must be recreated alone.';$global:backendRunning=$true;return}
        }
        throw ('Unexpected Compose call in rotation test: '+($a -join '|'))
    }
    if($a[0] -eq 'inspect'){
        if($a[-1] -eq $global:ids.postgres){return 'running|healthy'}
        return $(if($global:backendRunning){'running|healthy'}else{'exited|none'})
    }
    if($a[0] -eq 'exec' -and $a[1] -eq '-i' -and $a[2] -eq $global:ids.postgres){
        Require ($piped.Count -eq 1) 'Exactly one stdin line is expected per exec.'
        $global:stdin.Add($piped[0])
        if($a[3] -eq 'psql'){
            Require ($piped[0] -match "^ALTER USER mentor PASSWORD 'SCRAM-SHA-256\$") 'Only a SCRAM verifier may be sent to ALTER USER.'
            $global:databaseVerifier=([regex]::Match($piped[0],"'([^']+)'")).Groups[1].Value
            return
        }
        if($a[3] -eq 'sh'){
            Require ($a[-1] -match 'read -r secret' -and $a[-1] -match 'PGPASSWORD="\$secret"') 'Password check must read the secret from stdin.'
            if($global:rejectNewPassword -and $piped[0] -ne $global:oldPassword){$global:LASTEXITCODE=2;return}
            if(Test-SyntheticAuth $piped[0]){return '1'}
            $global:LASTEXITCODE=2;return
        }
    }
    throw ('Unexpected Docker call in rotation test: '+($a -join '|'))
}
function wsl {$a=@($args);Require ($a[0] -eq '-d' -and $a[1] -eq 'Ubuntu' -and $a[2] -eq 'docker') 'Unexpected WSL invocation.';$forward=@($a[3..($a.Count-1)]);$input | docker @forward}
try {
    $platform=Join-Path $root 'platform';New-Item -ItemType Directory -Path $platform | Out-Null
    $envPath=Join-Path $platform 'compose.env';[IO.File]::WriteAllText($envPath,"MENTOR_RELEASE=synthetic`n")
    $secret=Join-Path $platform 'spring.datasource.password';$mirror=Join-Path $root 'mirror.password'
    $global:oldPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    [IO.File]::WriteAllText($secret,$global:oldPassword,[Text.UTF8Encoding]::new($false));Copy-Item -LiteralPath $secret -Destination $mirror
    $global:databaseVerifier=New-MentorScramVerifier $global:oldPassword
    $global:secretDockerPath=ConvertTo-MentorDockerPath $secret
    $global:backendRunning=$true
    $rotate=Join-Path $PSScriptRoot '../rotate-database-password.ps1'
    $common=@{EnvironmentFile=$envPath;PasswordFile=$secret;ProjectName='mentor-test'}

    # 2a. Dry-run: plan only, no stdin traffic, file untouched.
    $output=(& $rotate @common) -join "`n"
    Require ($output -match 'Database password rotation plan' -and $output -match 'Dry-run only' -and $output -match 'SCRAM-SHA-256 verifier') 'Dry-run plan is incomplete.'
    Require ($global:stdin.Count -eq 0 -and (Read-MentorPasswordFile $secret) -eq $global:oldPassword) 'Dry-run touched the database or the file.'
    Require ($output -notmatch [regex]::Escape($global:oldPassword)) 'Dry-run printed the password.'
    Write-Output 'PASS dry-run: plan printed, nothing sent, file unchanged.'

    # 2b. Refusals: relative path, wrong secret file, mirror equal to the file.
    Reject {& $rotate -EnvironmentFile $envPath -PasswordFile 'relative.password'} 'absolute' 'Relative password path was accepted.'
    $foreign=Join-Path $root 'foreign.password';[IO.File]::WriteAllText($foreign,'x'*64)
    Reject {& $rotate -EnvironmentFile $envPath -PasswordFile $foreign -ProjectName 'mentor-test'} 'not the database_password secret' 'A file the containers do not read was accepted.'
    Reject {& $rotate @common -MirrorPasswordFile @($secret)} 'different file' 'Mirror equal to the secret was accepted.'
    Write-Output 'PASS refusals: absolute path, Compose secret match, distinct mirror.'

    # 2c. Apply: stop, ALTER with verifier, TCP proof, atomic file + mirror replacement, backend recreated.
    $global:calls.Clear();$global:stdin.Clear()
    $output=(& $rotate @common -MirrorPasswordFile @($mirror) -Apply 2>&1 | ForEach-Object { [string]$_ }) -join "`n"
    $newPassword=Read-MentorPasswordFile $secret
    Require ($newPassword -match '^[0-9A-F]{64}$' -and $newPassword -ne $global:oldPassword) 'The secret file was not replaced with a new hex password.'
    Require ((Read-MentorPasswordFile $mirror) -eq $newPassword) 'The mirror was not updated.'
    Require (Test-SyntheticAuth $newPassword) 'The database verifier does not match the new file.'
    Require (@(Get-ChildItem -LiteralPath $platform -File).Name -notcontains 'spring.datasource.password.new') 'A temporary file was left behind.'
    $sequence=@($global:calls | Where-Object { $_ -match '^compose' } | ForEach-Object { ($_ -split ' ')[[Array]::IndexOf(($_ -split ' '),'--project-name')+2] })
    # config -> ps (postgres) -> ps (backend) -> stop backend -> up backend -> ps (health wait of the recreated backend).
    Require (($sequence -join ',') -eq 'config,ps,ps,stop,up,ps') ('Unexpected Compose sequence: '+($sequence -join ','))
    Require (@($global:stdin | Where-Object { $_ -like 'ALTER USER*' }).Count -eq 1) 'ALTER USER must run exactly once on success.'
    Require (($global:calls -join "`n") -notmatch [regex]::Escape($newPassword) -and ($global:calls -join "`n") -notmatch [regex]::Escape($global:oldPassword)) 'A password reached a Docker command line.'
    Require ($output -match 'Database password rotated' -and $output -notmatch [regex]::Escape($newPassword)) 'Success output is missing or leaks the password.'
    Write-Output 'PASS apply: verifier via stdin, proof, atomic replacement with mirror, backend recreated, no password on command lines.'

    # 2d. Rollback: the proof of the new password fails -> old verifier restored, files untouched, backend started again.
    $global:calls.Clear();$global:stdin.Clear();$global:oldPassword=$newPassword;$global:rejectNewPassword=$true
    Reject {& $rotate @common -MirrorPasswordFile @($mirror) -Apply} 'rejected by PostgreSQL' 'A failed proof was reported as success.'
    Require ((Read-MentorPasswordFile $secret) -eq $newPassword -and (Read-MentorPasswordFile $mirror) -eq $newPassword) 'Files changed although the rotation failed.'
    Require ((Test-SyntheticAuth $newPassword)) 'The previous verifier was not restored.'
    Require (@($global:stdin | Where-Object { $_ -like 'ALTER USER*' }).Count -eq 2 -and $global:backendRunning) 'Rollback must ALTER back and start backend.'
    Write-Output 'PASS rollback: old verifier restored, files untouched, backend started.'
    Write-Output 'PASS: rotate-database-password SCRAM vector, dry-run, refusals, apply, rollback.'
} finally {
    if($root -notmatch 'mentor-rotate-proof-[a-f0-9]{32}$'){throw 'Unexpected fixture cleanup target.'}
    Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
}
