#Requires -Version 7.2
[CmdletBinding()]
param(
    [string]$EnvironmentFile = (Join-Path $PSScriptRoot '../.runtime/platform/compose.env'),
    [string]$ProjectName = 'mentor-platform'
)
. (Join-Path $PSScriptRoot 'platform-common.ps1')
$context = New-MentorPlatformContext ([IO.Path]::GetFullPath($EnvironmentFile)) $ProjectName
$configuration = ((Invoke-MentorCompose $context @('config','--format','json')) -join "`n") | ConvertFrom-Json
$origin = [string]$configuration.services.backend.environment.MENTOR_PUBLIC_ORIGIN
$status = [ordered]@{ ready=$false; database='unavailable'; web='unavailable'; worker='unknown'; queue=$null; checkedAt=[DateTime]::UtcNow.ToString('o') }
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
try {
    $response = Invoke-WebRequest -Uri ($origin+'/api/v1/auth/session') -SkipHttpErrorCheck -TimeoutSec 5
    if ($response.StatusCode -eq 200) { $status.web='ready' }
} catch { }
# Lack of a worker delays code checks but must not take the learning platform offline.
$status.ready = $status.database -eq 'up' -and $status.web -eq 'ready'
$status | ConvertTo-Json -Depth 4
if (-not $status.ready) { exit 1 }
