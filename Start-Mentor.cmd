@echo off
setlocal DisableDelayedExpansion
set "MENTOR_PWSH="
for /f "delims=" %%I in ('where pwsh.exe 2^>nul') do if not defined MENTOR_PWSH set "MENTOR_PWSH=%%I"
if not defined MENTOR_PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "MENTOR_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined MENTOR_PWSH if exist "%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe" set "MENTOR_PWSH=%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe"
if not defined MENTOR_PWSH (
  powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('Install PowerShell 7.2 or newer, then open Start-Mentor.cmd again. See docs/operations/java-angular.md.','Mentor platform')"
  exit /b 1
)
"%MENTOR_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-local.ps1" %*
exit /b %errorlevel%
