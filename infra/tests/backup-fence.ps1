#Requires -Version 7.2
# Actual isolated PostgreSQL; no application data or public ports.
. (Join-Path $PSScriptRoot '../platform-common.ps1')
$name='mentor-fence-proof-'+[Guid]::NewGuid().ToString('N')
$container=$null; $fence=$null
function Query([string]$Sql) { Invoke-MentorDocker @('exec',$container,'psql','-X','-U','mentor','-d','mentor','-At','-v','ON_ERROR_STOP=1','-c',$Sql) }
function Require([bool]$Condition,[string]$Message) { if(-not $Condition){throw $Message} }
function RejectFence([string]$Expected) {
    $caught=$null; $unexpected=$null
    try { $unexpected=New-MentorBackupFence $container } catch { $caught=$_.Exception.Message }
    finally { if($unexpected){Close-MentorBackupFence $unexpected} }
    Require ($caught -like "*$Expected*") 'The expected fence rejection did not occur.'
}
try {
    $container=(Invoke-MentorDocker @('run','--detach','--name',$name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m',
        '-e','POSTGRES_DB=mentor','-e','POSTGRES_USER=mentor','-e','POSTGRES_HOST_AUTH_METHOD=trust',
        'postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94') | Out-String).Trim()
    Require ($container -match '^[a-f0-9]{64}$') 'Unexpected test container identity.'
    $ready=$false
    for($attempt=0;$attempt -lt 60;$attempt++) {
        try { Invoke-MentorDocker @('exec',$container,'pg_isready','-h','127.0.0.1','-U','mentor','-d','mentor') | Out-Null; $ready=$true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    Require $ready 'Synthetic PostgreSQL did not start.'
    RejectFence 'schema is missing'
    Query "CREATE TABLE import_run(state text NOT NULL); CREATE TABLE probe_data(value text); INSERT INTO probe_data VALUES ('closed snapshot')" | Out-Null
    $fence=New-MentorBackupFence $container
    Assert-MentorBackupFence $fence
    Require ((Query 'SELECT pg_try_advisory_lock(1296387668,1229803591)') -eq 'f') 'An exclusive backup fence did not exclude another SQL connection.'
    RejectFence 'operation is active'
    Assert-MentorBackupFence $fence
    $counts=Get-MentorTableCounts $container $fence
    Require ($counts.probe_data -eq 1) 'Fenced table counts are wrong.'
    # A privileged, deliberately uncooperative writer proves the exported database snapshot stays consistent.
    Query "INSERT INTO probe_data VALUES ('later uncooperative write')" | Out-Null
    Invoke-MentorDocker @('exec',$container,'pg_dump','-U','mentor','-d','mentor','--format=custom',('--snapshot='+$fence.Snapshot),'--file=/tmp/proof.dump') | Out-Null
    $dump=(Invoke-MentorDocker @('exec',$container,'pg_restore','--data-only','--table=probe_data','--file=-','/tmp/proof.dump')) -join "`n"
    Require ($dump.Contains('closed snapshot') -and -not $dump.Contains('later uncooperative write')) 'The dump did not use the same exported snapshot as counts.'
    Assert-MentorBackupFence $fence
    Query ("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid="+$fence.Pid+" AND application_name='"+$fence.Name+"'") | Out-Null
    $lost=$false; try { Assert-MentorBackupFence $fence } catch { $lost=$true }
    Require $lost 'A killed fence was mistaken for a valid snapshot.'
    Close-MentorBackupFence $fence; $fence=$null
    Query "INSERT INTO import_run VALUES ('applying')" | Out-Null
    RejectFence 'incomplete import'
    Query "UPDATE import_run SET state='completed'" | Out-Null
    $fence=New-MentorBackupFence $container; Assert-MentorBackupFence $fence
    Close-MentorBackupFence $fence; $fence=$null
    Require ((Query "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=1296387668::oid AND objid=1229803591::oid") -eq '0') 'Maintenance cleanup leaked an advisory lock.'
    Write-Output 'PASS: missing schema/incomplete import rejection, competing maintenance exclusion, exported-snapshot dump/counts, killed connection fails closed, no lock leak.'
} finally {
    try { if($fence){Close-MentorBackupFence $fence} }
    finally { if($container -match '^[a-f0-9]{64}$' -and $name -match '^mentor-fence-proof-[a-f0-9]{32}$'){Invoke-MentorDocker @('rm','--force',$container) | Out-Null} }
}
