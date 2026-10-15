#Requires -Version 7.2
# Operational status as JSON: container health (not the rate-limited auth endpoint), queue aggregates, worker
# freshness and the job-gateway certificate expiry. Exit code 1 when the learning platform is not ready.
[CmdletBinding()]
param(
    [string]$EnvironmentFile = (Join-Path $PSScriptRoot '../.runtime/platform/compose.env'),
    [string]$ProjectName = 'mentor-platform',
    [ValidateRange(1,365)][int]$TlsWarningDays = 30
)
. (Join-Path $PSScriptRoot 'platform-common.ps1')
. (Join-Path $PSScriptRoot 'job-tls-common.ps1')
$context = New-MentorPlatformContext ([IO.Path]::GetFullPath($EnvironmentFile)) $ProjectName
$configuration = ((Invoke-MentorCompose $context @('config','--format','json')) -join "`n") | ConvertFrom-Json
$origin = [string]$configuration.services.backend.environment.MENTOR_PUBLIC_ORIGIN
$status = [ordered]@{ ready=$false; database='unavailable'; backend='unavailable'; web='unavailable'; site='unreachable'; worker='unknown'; queue=$null; tls=$null; warnings=@(); checkedAt=[DateTime]::UtcNow.ToString('o') }
function Get-MentorServiceStatus([string]$Service) {
    # healthy | unhealthy | starting | running (no healthcheck) | stopped | unavailable (no container)
    try {
        $probe = Get-MentorContainerHealth (Get-MentorServiceId $context $Service)
        if ($probe.State -ne 'running') { return 'stopped' }
        if ($probe.Health -eq 'none') { return 'running' }
        return $probe.Health
    } catch { return 'unavailable' }
}
try {
    $postgres = Get-MentorServiceId $context 'postgres'
    $query = @'
SELECT json_build_object(
 'waiting',(SELECT count(*) FROM practice_job WHERE state='queued'),
 'running',(SELECT count(*) FROM practice_job WHERE state='running'),
 'retryPending',(SELECT count(*) FROM practice_job WHERE state='retry_pending'),
 'oldestPendingSeconds',(SELECT COALESCE(GREATEST(0,EXTRACT(EPOCH FROM now()-min(created_at))),0)::bigint FROM practice_job WHERE state IN ('queued','running','retry_pending')),
 'lastWorkerSeenSeconds',(SELECT CASE WHEN last_worker_seen_at IS NULL THEN NULL ELSE GREATEST(0,EXTRACT(EPOCH FROM now()-last_worker_seen_at))::bigint END FROM practice_queue_control WHERE id=1),
 'completedLastDay',(SELECT count(*) FROM practice_attempt WHERE job_state='completed' AND created_at>=now()-interval '1 day'),
 'failedLastDay',(SELECT count(*) FROM practice_attempt WHERE job_state='failed' AND created_at>=now()-interval '1 day'),
 'averageRuntimeMsLastDay',(SELECT round(avg((result->>'elapsedMs')::numeric)) FROM practice_attempt WHERE job_state='completed' AND created_at>=now()-interval '1 day'));
'@
    $status.queue = ((Invoke-MentorDocker @('exec',$postgres,'psql','-X','-U','mentor','-d','mentor','-At','-v','ON_ERROR_STOP=1','-c',$query)) -join "`n") | ConvertFrom-Json
    $status.database = 'up'
    $status.worker = if ($null -ne $status.queue.lastWorkerSeenSeconds -and $status.queue.lastWorkerSeenSeconds -le 60) { 'available' } else { 'unavailable' }
} catch { } # Operational output contains no connection details, row IDs, code or credentials.
$status.backend = Get-MentorServiceStatus 'backend'
$status.web = Get-MentorServiceStatus 'web'
try {
    # A static document through the published port; the auth endpoint is rate-limited and stays untouched.
    $response = Invoke-WebRequest -Uri ($origin+'/') -SkipHttpErrorCheck -TimeoutSec 5
    if ($response.StatusCode -eq 200) { $status.site='reachable' }
} catch { }
try {
    # The gateway is behind the runner profile, so its bind mounts appear only in a profile-aware config.
    $gatewayConfiguration = ((Invoke-MentorCompose $context @('--profile','runner','config','--format','json')) -join "`n") | ConvertFrom-Json
    $tlsDirectory = $null
    foreach ($mount in @($gatewayConfiguration.services.'job-gateway'.volumes)) {
        if ($mount.target -eq '/run/mentor-tls' -and $mount.type -eq 'bind') { $tlsDirectory = ConvertFrom-MentorDockerPath ([string]$mount.source) }
    }
    if ($tlsDirectory -and (Test-Path -LiteralPath (Join-Path $tlsDirectory 'server.crt') -PathType Leaf)) {
        $certificate = Get-MentorCertificateInfo (Join-Path $tlsDirectory 'server.crt')
        $status.tls = [ordered]@{ notAfter=$certificate.notAfter; daysLeft=$certificate.daysLeft; subjectAlternativeNames=$certificate.subjectAlternativeNames; thumbprint=$certificate.thumbprint }
        if ($certificate.daysLeft -lt 0) { $status.warnings += 'job-gateway certificate has EXPIRED; run infra/issue-job-tls.ps1 and restart the gateway and runner.' }
        elseif ($certificate.daysLeft -lt $TlsWarningDays) { $status.warnings += ('job-gateway certificate expires in ' + $certificate.daysLeft + ' days; rotate with infra/issue-job-tls.ps1.') }
    }
} catch { } # No gateway profile or unreadable certificate: not a platform outage.
if ($status.worker -eq 'unavailable') { $status.warnings += 'No worker heartbeat within 60 s; code checks are delayed, the cabinet keeps working.' }
# Lack of a worker delays code checks but must not take the learning platform offline.
$status.ready = $status.database -eq 'up' -and $status.backend -in @('healthy','running') -and $status.web -in @('healthy','running') -and $status.site -eq 'reachable'
$status | ConvertTo-Json -Depth 4
if (-not $status.ready) { exit 1 }
