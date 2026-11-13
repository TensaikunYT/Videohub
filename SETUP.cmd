@echo off
rem VideoHub setup - double-click to install (see README.md)
rem -ExecutionPolicy Bypass applies to this one visible PowerShell process only (Windows blocks every .ps1 by default);
rem it changes no setting. VideoHub itself never starts PowerShell with it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
