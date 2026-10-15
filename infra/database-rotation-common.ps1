# Helpers for rotating the PostgreSQL password without ever putting a plaintext password on a command line.
# PostgreSQL stores SCRAM-SHA-256 verifiers; ALTER USER accepts a precomputed verifier, so the statement that
# travels to psql (and could end up in a server log with log_statement=ddl) never contains the password itself.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'platform-common.ps1')

function Get-MentorScramKeys([string]$Password,[byte[]]$Salt,[int]$Iterations = 4096) {
    # RFC 5802 / RFC 7677. PostgreSQL applies SASLprep first; for printable ASCII that is the identity, and the
    # passwords this platform generates are hex strings, so anything else is rejected rather than silently mismatched.
    if ($Password -notmatch '^[\x21-\x7E]{1,4096}$') { throw 'The password must be 1-4096 printable ASCII characters without spaces (SASLprep is not implemented here).' }
    if ($Salt.Length -lt 8) { throw 'The SCRAM salt must have at least 8 bytes.' }
    if ($Iterations -lt 4096) { throw 'PostgreSQL requires at least 4096 SCRAM iterations.' }
    $salted = [Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2([Text.Encoding]::UTF8.GetBytes($Password),$Salt,$Iterations,[Security.Cryptography.HashAlgorithmName]::SHA256,32)
    $hmac = [Security.Cryptography.HMACSHA256]::new($salted)
    try {
        $clientKey = $hmac.ComputeHash([Text.Encoding]::ASCII.GetBytes('Client Key'))
        $serverKey = $hmac.ComputeHash([Text.Encoding]::ASCII.GetBytes('Server Key'))
    } finally { $hmac.Dispose() }
    $storedKey = [Security.Cryptography.SHA256]::HashData($clientKey)
    return [pscustomobject]@{ Salt=$Salt; Iterations=$Iterations; ClientKey=$clientKey; StoredKey=$storedKey; ServerKey=$serverKey }
}

function New-MentorScramVerifier([string]$Password,[byte[]]$Salt,[int]$Iterations = 4096) {
    if (-not $Salt) { $Salt = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16) }
    $keys = Get-MentorScramKeys $Password $Salt $Iterations
    return 'SCRAM-SHA-256$' + $Iterations + ':' + [Convert]::ToBase64String($keys.Salt) + '$' + [Convert]::ToBase64String($keys.StoredKey) + ':' + [Convert]::ToBase64String($keys.ServerKey)
}

function Test-MentorScramVerifier([string]$Verifier) {
    return $Verifier -match '^SCRAM-SHA-256\$[0-9]{4,9}:[A-Za-z0-9+/=]{12,}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$'
}

function Read-MentorPasswordFile([string]$Path) {
    # Spring config trees and the PostgreSQL entrypoint both drop one trailing line break; mirror that exactly.
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer -or $file.Length -gt 8192 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Use a private regular password file.' }
    $value = [IO.File]::ReadAllText($file.FullName,[Text.UTF8Encoding]::new($false,$true))
    return ($value -replace '\r?\n\z','')
}

function Invoke-MentorDockerStdin {
    # Like Invoke-MentorDocker, but feeds $InputText through stdin (never through the argument list).
    param([Parameter(Mandatory)][string]$InputText,[Parameter(Mandatory)][string[]]$DockerArguments)
    if ($IsWindows) { $output = $InputText | & wsl -d Ubuntu -- docker @DockerArguments 2>$null }
    else { $output = $InputText | & docker @DockerArguments 2>$null }
    # stderr is dropped on purpose: a failing statement is echoed back by psql together with its input.
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed ($($DockerArguments[0]) with stdin); exit $LASTEXITCODE." }
    return $output
}

function Set-MentorPostgresPasswordVerifier([string]$PostgresId,[string]$Verifier) {
    if ($PostgresId -notmatch '^[a-f0-9]{64}$') { throw 'Invalid PostgreSQL container.' }
    if (-not (Test-MentorScramVerifier $Verifier)) { throw 'Refusing to send anything but a SCRAM-SHA-256 verifier to ALTER USER.' }
    # Local socket connections inside the official image are trusted; TCP connections (backend) use the verifier.
    Invoke-MentorDockerStdin -InputText ("ALTER USER mentor PASSWORD '" + $Verifier + "';") -DockerArguments @('exec','-i',$PostgresId,'psql','-X','-qAt','-U','mentor','-d','mentor','-v','ON_ERROR_STOP=1') | Out-Null
}

function Test-MentorPostgresPassword([string]$PostgresId,[string]$Password) {
    # Authenticates over TCP exactly as the backend does; the password reaches the container only via stdin.
    if ($PostgresId -notmatch '^[a-f0-9]{64}$') { throw 'Invalid PostgreSQL container.' }
    if ($Password -match '[\r\n\x00]') { throw 'Invalid password characters.' }
    try {
        $output = Invoke-MentorDockerStdin -InputText $Password -DockerArguments @('exec','-i',$PostgresId,'sh','-c','IFS= read -r secret && PGPASSWORD="$secret" exec psql -X -qAt -h 127.0.0.1 -U mentor -d mentor -v ON_ERROR_STOP=1 -c "SELECT 1"')
    } catch { return $false }
    return (($output | Out-String).Trim() -eq '1')
}

function Write-MentorSecretFile([string]$Path,[string]$Value,[string]$UnixMode = '444') {
    # Sibling temporary file plus rename: readers (bind mounts of the directory, mirrors) never see a partial file.
    $temporary = $Path + '.new-' + [Guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($temporary,$Value,[Text.UTF8Encoding]::new($false))
    if (-not $IsWindows) {
        & chmod $UnixMode -- $temporary
        if ($LASTEXITCODE -ne 0) { throw 'Cannot set secret file permissions.' }
    }
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
