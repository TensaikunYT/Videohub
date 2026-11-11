@echo off
rem VideoHub update - copies this folder's code over the VideoHub installed on this PC (settings and notes stay)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
echo.
pause
