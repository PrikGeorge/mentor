param(
    [switch]$NoBrowser,
    [ValidateRange(1, 65535)]
    [int]$Port = 4173
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskRoot = $PSScriptRoot
$taskUrl = "http://127.0.0.1:$Port/"

function Test-MentorHealth {
    $response = $null
    $reader = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create("${taskUrl}api/health")
        $request.Proxy = $null
        $request.Timeout = 400
        $request.ReadWriteTimeout = 400
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $health = $reader.ReadToEnd() | ConvertFrom-Json
        return ($health.app -eq 'mentor-local' -and $health.version -eq 1)
    }
    catch { return $false }
    finally {
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
    }
}

function Test-LocalPort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connection = $client.ConnectAsync('127.0.0.1', $Port)
        return ($connection.Wait(400) -and $client.Connected)
    }
    catch { return $false }
    finally { $client.Dispose() }
}

function Show-LaunchError([string]$Message) {
    [Console]::Error.WriteLine($Message)
    if (-not $NoBrowser) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show(
                $Message, 'Локальный кабинет наставника',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
        catch { Write-Host $Message }
    }
}

try {
    if (Test-MentorHealth) {
        Write-Host "Кабинет уже запущен: $taskUrl"
        if (-not $NoBrowser) { Start-Process -FilePath $taskUrl }
        exit 0
    }

    if (Test-LocalPort) {
        throw "Порт $Port занят другим приложением. Оно не было остановлено. Закройте его самостоятельно или запустите start-local.ps1 -Port 4174."
    }

    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $nodeCommand) {
        throw 'Node.js не найден в PATH. Установите Node.js, затем повторно откройте Start-Mentor.cmd.'
    }

    $serverPath = Join-Path $taskRoot 'server.cjs'
    if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
        throw "Не найден файл сервера: $serverPath. Запускайте кабинет из полной папки mentor-site."
    }

    $logDirectory = Join-Path $taskRoot 'data\runtime'
    [void][System.IO.Directory]::CreateDirectory($logDirectory)
    $logName = 'server-{0}-{1}-{2}' -f $Port, (Get-Date -Format 'yyyyMMdd-HHmmss'), $PID
    $outputLog = Join-Path $logDirectory "$logName.out.log"
    $errorLog = Join-Path $logDirectory "$logName.err.log"

    # Only the child inherits this PORT value. Restore the launcher's environment afterwards.
    $previousPort = [Environment]::GetEnvironmentVariable('PORT', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('PORT', [string]$Port, 'Process')
        $serverProcess = Start-Process -FilePath $nodeCommand.Source `
            -ArgumentList ('"{0}"' -f $serverPath) `
            -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog
        # Keep the native handle so Windows PowerShell can still read a fast child's exit code.
        $null = $serverProcess.Handle
    }
    finally {
        [Environment]::SetEnvironmentVariable('PORT', $previousPort, 'Process')
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(7)
    $ready = $false
    do {
        $serverProcess.Refresh()
        if ($serverProcess.HasExited) {
            $serverProcess.WaitForExit()
            throw "Сервер завершился с кодом $($serverProcess.ExitCode). Подробности: $errorLog"
        }
        if (Test-MentorHealth) { $ready = $true; break }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)

    if (-not $ready) {
        throw "Сервер не подтвердил запуск за 7 секунд. Повторите запуск через несколько секунд. Журнал: $errorLog"
    }

    Write-Host "Кабинет запущен: $taskUrl"
    if (-not $NoBrowser) { Start-Process -FilePath $taskUrl }
    exit 0
}
catch {
    Show-LaunchError $_.Exception.Message
    exit 1
}
