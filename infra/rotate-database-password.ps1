#Requires -Version 7.2
# Rotates the PostgreSQL password of the working platform. Dry-run is the default and changes nothing.
# -Apply: stop backend -> ALTER USER with a SCRAM verifier -> prove the new password over TCP -> replace the secret
# file(s) atomically -> recreate backend so its /run/secrets bind picks up the new file -> wait for readiness.
# If the proof fails, the old verifier is restored and backend is started again with the untouched file.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvironmentFile,
    [Parameter(Mandatory)][string]$PasswordFile,
    [string]$ProjectName = 'mentor-platform',
    # Second copies of the same secret file (for example a duplicated configuration directory for another shortcut).
    [string[]]$MirrorPasswordFile = @(),
    [ValidateRange(60,1800)][int]$ReadyTimeoutSeconds = 300,
    [switch]$Apply
)
. (Join-Path $PSScriptRoot 'maintenance-lease.ps1')
. (Join-Path $PSScriptRoot 'database-rotation-common.ps1')
foreach ($path in @($EnvironmentFile,$PasswordFile) + $MirrorPasswordFile) {
    if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Environment, password and mirror paths must be absolute.' }
}
$PasswordFile = [IO.Path]::GetFullPath($PasswordFile)
if (-not (Test-Path -LiteralPath $PasswordFile -PathType Leaf)) { throw 'The current password file does not exist.' }
foreach ($mirror in $MirrorPasswordFile) {
    if (-not (Test-Path -LiteralPath $mirror -PathType Leaf)) { throw "Mirror password file does not exist: $mirror" }
    if ([string]::Equals([IO.Path]::GetFullPath($mirror),$PasswordFile,[StringComparison]::OrdinalIgnoreCase)) { throw 'A mirror must be a different file from -PasswordFile.' }
}
$context = New-MentorPlatformContext $EnvironmentFile $ProjectName
$configuration = ((Invoke-MentorCompose $context @('config','--format','json')) -join "`n") | ConvertFrom-Json
$configuredSecret = [string]$configuration.secrets.database_password.file
$expectedSecret = ConvertTo-MentorDockerPath $PasswordFile
if (-not [string]::Equals($configuredSecret.TrimEnd('/'),$expectedSecret.TrimEnd('/'),[StringComparison]::OrdinalIgnoreCase)) {
    throw 'The -PasswordFile is not the database_password secret of this Compose project (MENTOR_DB_PASSWORD_FILE in compose.env). Refusing to rotate a file the containers do not read.'
}
$postgres = Get-MentorServiceId $context 'postgres'
$backend = Get-MentorServiceId $context 'backend'
$postgresState = Get-MentorContainerHealth $postgres
if ($postgresState.State -ne 'running') { throw 'PostgreSQL must be running for a rotation (start-platform.ps1 first).' }
$backendRunning = (Get-MentorContainerHealth $backend).State -eq 'running'
$plan = @(
    "Database password rotation plan for Compose project '$ProjectName':",
    "  secret file: $PasswordFile$(if ($MirrorPasswordFile.Count) { ' (+ ' + $MirrorPasswordFile.Count + ' mirror(s))' })",
    '  1. stop backend (maintenance lock held; backups and start-platform wait)',
    "  2. ALTER USER mentor PASSWORD '<SCRAM-SHA-256 verifier>' inside the postgres container (no plaintext on the command line)",
    '  3. prove the new password over TCP as the backend would; on failure restore the old verifier and start backend',
    '  4. replace the secret file(s) atomically; the old value is gone from disk afterwards',
    '  5. docker compose up -d --no-deps --force-recreate backend, wait for the readiness healthcheck',
    "  backend running now: $backendRunning; postgres keeps its old mount until it is recreated (harmless: the file is read only at initdb)",
    '  afterwards: store the new value of the secret file in the password manager; update the entry for this contour'
)
$plan | Write-Output
if (-not $Apply) { Write-Output 'Dry-run only: nothing was changed. Repeat with -Apply to rotate.'; return }

$maintenance = $null; $stopped = $false; $altered = $false; $failure = $null
$oldPassword = Read-MentorPasswordFile $PasswordFile
$newPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$oldVerifier = New-MentorScramVerifier $oldPassword
$newVerifier = New-MentorScramVerifier $newPassword
try {
    $maintenance = Open-MentorMaintenanceLease $EnvironmentFile $ProjectName $null
    if (-not (Test-MentorPostgresPassword $postgres $oldPassword)) { throw 'The current password file does not authenticate against PostgreSQL; fix that mismatch before rotating.' }
    if ($backendRunning) { Invoke-MentorCompose $context @('stop','--timeout','35','backend') | Out-Null; $stopped = $true }
    Set-MentorPostgresPasswordVerifier $postgres $newVerifier
    $altered = $true
    if (-not (Test-MentorPostgresPassword $postgres $newPassword)) { throw 'The new password was rejected by PostgreSQL; the previous verifier is being restored.' }
    Write-MentorSecretFile $PasswordFile $newPassword
    foreach ($mirror in $MirrorPasswordFile) { Write-MentorSecretFile $mirror $newPassword }
    $altered = $false # The database and the files now agree; from here on a rollback would be wrong.
    # Compose secrets are file bind mounts: the running container keeps the old inode, so it must be recreated.
    Invoke-MentorCompose $context @('up','--detach','--no-build','--no-deps','--force-recreate','backend') | Out-Null
    $stopped = $false
    $health = Wait-MentorServiceHealthy $context 'backend' $ReadyTimeoutSeconds
    Write-Output "Database password rotated; backend recreated (health: $health). Record the new value from $PasswordFile in the password manager now."
} catch {
    $failure = $_
} finally {
    $oldPassword = $null; $newPassword = $null
    try {
        if ($failure -and $altered) {
            try { Set-MentorPostgresPasswordVerifier $postgres $oldVerifier; Write-Warning 'Restored the previous database password; the secret file was not changed.' }
            catch { Write-Warning 'Could not restore the previous database password. The files still hold the OLD password while PostgreSQL has the NEW one: rotate again with -Apply as soon as PostgreSQL is reachable, or set the verifier manually.' }
        }
        if ($failure -and $stopped) {
            try { Invoke-MentorCompose $context @('start','backend') | Out-Null } catch { Write-Warning 'backend could not be started again; run start-platform.ps1.' }
        }
    } finally { Close-MentorMaintenanceLease $maintenance }
}
if ($failure) { throw $failure }
