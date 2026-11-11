@echo off
rem VideoHub setup - double-click to install (see README.md)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
