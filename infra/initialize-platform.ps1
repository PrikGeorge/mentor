#Requires -Version 7.2
[CmdletBinding()]
param(
    [string]$Directory = (Join-Path $PSScriptRoot '../.runtime/platform'),
    [string]$PublicOrigin = 'http://127.0.0.1:4174',
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$')][string]$Release = 'local',
    [switch]$Production
)
. (Join-Path $PSScriptRoot 'platform-common.ps1')
$Directory=[IO.Path]::GetFullPath($Directory)
$origin=[Uri]$PublicOrigin
if (-not $origin.IsAbsoluteUri -or $origin.UserInfo -or $origin.Query -or $origin.Fragment -or $PublicOrigin -ne $origin.GetLeftPart([UriPartial]::Authority) -or $origin.Scheme -notin @('http','https')) { throw 'PublicOrigin must be an exact HTTP(S) origin without a trailing slash.' }
if ($Production -and $origin.Scheme -ne 'https') { throw 'Production requires HTTPS.' }
if (-not $Production -and $origin.Host -notin @('localhost','127.0.0.1')) { throw 'Local initialization publishes IPv4 loopback; use http://127.0.0.1:PORT or http://localhost:PORT.' }
if (-not $Production -and $origin.Scheme -ne 'http') { throw 'Use HTTP for local loopback or configure production HTTPS.' }
if ($Directory -match '[\r\n"\x00]') { throw 'Unsupported configuration directory name.' }
New-Item -ItemType Directory -Path (Split-Path -Parent $Directory) -Force | Out-Null
New-MentorPrivateDirectory $Directory
$databaseDirectory=Join-Path $Directory 'secrets'
$workerDirectory=Join-Path $Directory 'worker-secrets'
New-Item -ItemType Directory -Path $databaseDirectory,$workerDirectory | Out-Null
foreach ($file in @((Join-Path $databaseDirectory 'spring.datasource.password'),(Join-Path $workerDirectory 'worker-credential'),(Join-Path $Directory 'backup-passphrase'))) {
    [IO.File]::WriteAllText($file,[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)),[Text.UTF8Encoding]::new($false))
}
if (-not $IsWindows) {
    # The private parent blocks host traversal; mounted secret files/directories remain readable by UID10001.
    & chmod 755 -- $databaseDirectory $workerDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Cannot set container secret directory permissions.' }
    & chmod 444 -- (Join-Path $databaseDirectory 'spring.datasource.password') (Join-Path $workerDirectory 'worker-credential')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot set container secret file permissions.' }
    & chmod 600 -- (Join-Path $Directory 'backup-passphrase')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict backup passphrase permissions.' }
}
$settings=@(
    "MENTOR_RELEASE=$Release",
    "MENTOR_PUBLIC_ORIGIN=$PublicOrigin",
    ('MENTOR_PRODUCTION='+$Production.IsPresent.ToString().ToLowerInvariant()),
    ('MENTOR_BIND_ADDRESS='+$(if($Production){'0.0.0.0'}else{'127.0.0.1'})),
    ('MENTOR_SITE_ADDRESS='+$(if($Production){$origin.Authority}else{':80'})),
    ('MENTOR_HTTP_PORT='+$(if($Production){80}else{$origin.Port})),
    ('MENTOR_HTTPS_PORT='+$(if($Production){$origin.Port}else{8443})),
    ('MENTOR_DB_PASSWORD_FILE="'+(ConvertTo-MentorDockerPath (Join-Path $databaseDirectory 'spring.datasource.password'))+'"'),
    ('MENTOR_WORKER_SECRETS_DIR="'+(ConvertTo-MentorDockerPath $workerDirectory)+'"'),
    '# Structured JSON console logs of the backend (Spring Boot: ecs | logstash | gelf). Delete the line for plain text.',
    'LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs',
    '# Container limits applied by Compose (INF-07); the defaults below suit an 8-16 GB host. Uncomment to override.',
    '# MENTOR_POSTGRES_MEMORY=1g',
    '# MENTOR_POSTGRES_CPUS=1.0',
    '# MENTOR_BACKEND_MEMORY=1536m',
    '# MENTOR_BACKEND_CPUS=2.0',
    '# MENTOR_BACKEND_JAVA_OPTIONS=-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError',
    '# MENTOR_BACKEND_START_PERIOD=120s',
    '# MENTOR_WEB_MEMORY=256m',
    '# MENTOR_WEB_CPUS=0.5',
    '# MENTOR_JOB_GATEWAY_MEMORY=128m',
    '# MENTOR_JOB_GATEWAY_CPUS=0.5',
    '# Strict-Transport-Security value for HTTPS responses; empty keeps the Caddyfile default (max-age=31536000; includeSubDomains).',
    '# MENTOR_HSTS=',
    '# Private job gateway (profile runner): bind address, port, HTTPS site address and the TLS directory from issue-job-tls.ps1.',
    '# MENTOR_JOB_BIND_ADDRESS=127.0.0.1',
    '# MENTOR_JOB_PORT=8444',
    '# MENTOR_JOB_ADDRESS=https://localhost:8443',
    ('# MENTOR_JOB_TLS_DIRECTORY="'+(ConvertTo-MentorDockerPath (Join-Path $Directory 'tls'))+'"')
)
[IO.File]::WriteAllLines((Join-Path $Directory 'compose.env'),$settings,[Text.UTF8Encoding]::new($false))
Write-Output "Created private configuration: $Directory"
Write-Output 'No accounts, database, imports, services or public deployment were created. Keep backup-passphrase separately from encrypted backups.'
Write-Warning ("The backup encryption passphrase was written to '" + (Join-Path $Directory 'backup-passphrase') + "', next to compose.env and the container secrets. Store a copy in a password manager or on offline media now and keep it away from the backup directories: a copy that is lost with this machine makes every encrypted backup unreadable. Procedure: docs/operations/java-angular.md, section 'Хранение секретов и пароля копий'.")
