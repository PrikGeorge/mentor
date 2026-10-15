#Requires -Version 7.2
# Sends one operator alert. First channel: Telegram bot (sendMessage). The bot token comes from a private file
# (-TelegramTokenFile / MENTOR_ALERT_TELEGRAM_TOKEN_FILE) or, as a fallback, from MENTOR_ALERT_TELEGRAM_TOKEN;
# the chat id from -TelegramChatId / MENTOR_ALERT_TELEGRAM_CHAT. The token is never printed, not even on errors.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Message,
    [string]$Subject = 'Mentor platform',
    [string]$TelegramTokenFile = $env:MENTOR_ALERT_TELEGRAM_TOKEN_FILE,
    [string]$TelegramChatId = $env:MENTOR_ALERT_TELEGRAM_CHAT,
    [string]$TelegramApi = 'https://api.telegram.org',
    [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Subject -match '[\r\n]') { throw 'Subject must be a single line.' }
$text = ('[' + $Subject + '] ' + $Message).Trim()
if ($text.Length -gt 4096) { $text = $text.Substring(0,4093) + '...' } # Telegram message limit.
if (-not $TelegramChatId -or $TelegramChatId -notmatch '^-?[0-9]{1,20}$') { throw 'Telegram chat id is missing or invalid: pass -TelegramChatId or set MENTOR_ALERT_TELEGRAM_CHAT (numeric, negative for groups).' }
if ($TelegramApi -notmatch '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' -and $TelegramApi -notmatch '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$') { throw 'TelegramApi must be an https origin (plain http is allowed for loopback test doubles only).' }
$result = [ordered]@{ channel='telegram'; chatId=$TelegramChatId; dryRun=[bool]$DryRun; sent=$false; length=$text.Length }
if ($DryRun) {
    $result.text = $text
    $result | ConvertTo-Json
    return
}
$token = $null
if ($TelegramTokenFile) {
    if (-not [IO.Path]::IsPathFullyQualified($TelegramTokenFile)) { throw 'TelegramTokenFile must be absolute.' }
    $file = Get-Item -LiteralPath $TelegramTokenFile
    if ($file.PSIsContainer -or $file.Length -gt 4096 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Use a private regular token file.' }
    $token = ([IO.File]::ReadAllText($file.FullName,[Text.UTF8Encoding]::new($false,$true)) -replace '\s+\z','')
} elseif ($env:MENTOR_ALERT_TELEGRAM_TOKEN) {
    $token = $env:MENTOR_ALERT_TELEGRAM_TOKEN
}
if (-not $token -or $token -notmatch '^[0-9]{5,12}:[A-Za-z0-9_-]{30,64}$') { throw 'Telegram bot token is missing or malformed: provide -TelegramTokenFile (preferred) or MENTOR_ALERT_TELEGRAM_TOKEN.' }
try {
    $response = Invoke-RestMethod -Method Post -Uri ($TelegramApi + '/bot' + $token + '/sendMessage') -Body @{ chat_id=$TelegramChatId; text=$text; disable_web_page_preview='true' } -TimeoutSec 20
    if ($response.ok -ne $true) { throw 'Telegram answered ok=false.' }
    $result.sent = $true
    $result.messageId = $response.result.message_id
} catch {
    $reason = ([string]$_.Exception.Message).Replace($token,'***')
    throw ('Telegram sendMessage failed: ' + $reason)
} finally { $token = $null }
$result | ConvertTo-Json
