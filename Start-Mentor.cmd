@echo off
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('Install PowerShell 7.2 or newer, then open Start-Mentor.cmd again. See docs/operations/java-angular.md.','Mentor platform')"
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-local.ps1" %*
exit /b %errorlevel%
