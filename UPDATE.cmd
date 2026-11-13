@echo off
rem VideoHub update - copies this folder's code over the VideoHub installed on this PC (settings and notes stay)
rem -ExecutionPolicy Bypass applies to this one visible PowerShell process only (Windows blocks every .ps1 by default).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
echo.
pause
