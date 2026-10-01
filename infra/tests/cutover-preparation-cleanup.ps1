#Requires -Version 7.2
# Inject only the Docker boundary; actual packaged lifecycle is independently exercised by cutover-integration.ps1.
. (Join-Path $PSScriptRoot '../cutover-common.ps1')
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-cutover-cleanup-'+[guid]::NewGuid().ToString('N'));New-MentorPrivateDirectory $root
try {
    $snapshot=Join-Path $root 'snapshot';New-MentorPrivateDirectory $snapshot
    foreach($relative in @('data/mentoring.json','data/auth/accounts.json','private/materials/manifest.json','private/materials/content.json','training/catalog.json','training/environments.json')){
        $path=Join-Path $snapshot $relative;New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
        $json=if($relative -eq 'data/auth/accounts.json'){'{"accounts":[{"id":"synthetic-teacher","role":"teacher","private":"do-not-expose-source-marker"}]}'}else{'{}'}
        [IO.File]::WriteAllText($path,$json)
    }
    $manifest=Join-Path $root 'manifest.json';[IO.File]::WriteAllText($manifest,'{}')
    function docker {
        $global:LASTEXITCODE=0;$a=@($args)
        if($a[0] -eq 'image' -and $a[1] -eq 'inspect'){return ('sha256:'+('3'*64))}
        if($a[0] -eq 'volume' -and $a[1] -eq 'create'){
            $name=$a[-1];if($name -match '^mentor-cutover-source-'){return $name}
            throw 'Synthetic preparation Docker unavailable.'
        }
        if($a[0] -eq 'volume' -and $a[1] -eq 'rm'){throw 'Synthetic cleanup Docker unavailable.'}
        throw ('Unexpected Docker boundary in preparation test: '+($a -join '|'))
    }
    function wsl {$a=@($args);$start=[Array]::IndexOf($a,'docker')+1;$forward=$a[$start..($a.Count-1)];docker @forward}
    $report=Join-Path $root 'report';$caught=$null
    try {
        & (Join-Path $PSScriptRoot '../cutover.ps1') -Snapshot $snapshot -ImportId synthetic-cleanup -TargetWorkspace synthetic-space -TeacherAccount synthetic-teacher -EnvironmentManifest $manifest -EnvironmentManifestSha256 (Get-MentorCutoverHash $manifest) -EnvironmentProfilesSha256 (Get-MentorCutoverHash (Join-Path $snapshot 'training/environments.json')) -BackendImage synthetic-image -ReportDirectory $report | Out-Null
    } catch {$caught=$_}
    Require ($null -ne $caught -and $caught.Exception.Message -eq 'Synthetic preparation Docker unavailable.') 'Original preparation failure was lost or reported as success.'
    Require (Test-Path -LiteralPath (Join-Path $report 'operation.json')) ('Preparation receipt absent: '+$caught.Exception.Message)
    $receipt=Read-MentorCutoverJson (Join-Path $report 'operation.json')
    Require (-not $receipt.completed -and $receipt.phase -eq 'failed') 'Failed preparation completion state wrong.'
    Require (@($receipt.cleanupFailures).Count -eq 1 -and $receipt.cleanupFailures[0] -eq 'volume_cleanup_failed') 'Preparation cleanup failure was discarded from durable receipt.'
    Require ($receipt.ownedPreparationResources.operationId -match '^[a-f0-9]{32}$' -and $receipt.ownedPreparationResources.sourceVolume -eq ('mentor-cutover-source-'+$receipt.ownedPreparationResources.operationId)) 'Remaining preparation resource identity missing.'
    Require ($null -eq $receipt.ownedPreparationResources.reportVolume -and @($receipt.ownedPreparationResources.containers).Count -eq 0) 'Receipt invents resources not created.'
    Require (@(Get-ChildItem -LiteralPath $report -Directory -Filter 'private-stage-*').Count -eq 0) 'Available local cleanup did not run after Docker failure.'
    Require (([IO.File]::ReadAllText((Join-Path $report 'operation.json'))) -notmatch 'do-not-expose-source-marker') 'Cleanup diagnostics disclosed private source contents.'
    Write-Output 'PASS preparation Docker failure: original failure retained, durable cleanup failure + exact owned identities, local stage cleaned, no private source content.'
} finally {Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())}