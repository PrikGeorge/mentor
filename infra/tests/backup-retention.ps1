#Requires -Version 7.2
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../platform-common.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('mentor-retention-test-'+[Guid]::NewGuid().ToString('N'))
$originalCulture=[cultureinfo]::CurrentCulture
New-MentorPrivateDirectory $root
try {
    [cultureinfo]::CurrentCulture=[cultureinfo]::GetCultureInfo('ru-RU')
    $known='2026-10-01T02:56:53.1369790Z'
    $typed=('{"createdAt":"'+$known+'"}' | ConvertFrom-Json).createdAt
    foreach($value in @($known,$typed)) {
        if((ConvertFrom-MentorReceiptDate $value).ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ') -ne $known) { throw 'Receipt date changed month/day or time zone.' }
    }
    # JSON date values become DateTime in newer PowerShell. Passing that object
    # through Parse(string) reverses ambiguous month/day under Russian culture.
    $future=[DateTimeOffset]::new([DateTime]::UtcNow.Year+1,10,1,2,0,0,[TimeSpan]::Zero)
    $old=[DateTimeOffset]::UtcNow.AddDays(-20)
    foreach($entry in @(@{id='1';date=$future;completed=$true},@{id='2';date=$old;completed=$true},@{id='3';date=$old;completed=$false})) {
        $path=Join-Path $root ('mentor-backup-'+$entry.date.ToString('yyyyMMddTHHmmssZ')+'-'+($entry.id*32))
        New-Item -ItemType Directory -Path $path | Out-Null
        @{completed=$entry.completed;encrypted=$true;createdAt=$entry.date.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $path 'receipt.json')
        [IO.File]::WriteAllText((Join-Path $path 'snapshot.tar.gpg'),'synthetic fixture')
    }
    # Also preserve the current backup (the actual October 1 regression).
    $current=Join-Path $root ('mentor-backup-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+('4'*32))
    New-Item -ItemType Directory -Path $current | Out-Null
    @{completed=$true;encrypted=$true;createdAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $current 'receipt.json')
    [IO.File]::WriteAllText((Join-Path $current 'snapshot.tar.gpg'),'synthetic fixture')
    Remove-MentorExpiredBackups $root
    $remaining=@(Get-ChildItem -LiteralPath $root -Directory).Name
    if($remaining.Count -ne 3 -or -not (Test-Path -LiteralPath $current) -or @($remaining | Where-Object { $_.EndsWith('2'*32) }).Count) { throw 'Retention removed a current backup or retained an expired completed copy.' }
    Write-Output 'PASS: culture-independent receipt dates; only expired completed backups removed.'
} finally {
    [cultureinfo]::CurrentCulture=$originalCulture
    Remove-MentorOwnedDirectory $root ([IO.Path]::GetTempPath())
}
