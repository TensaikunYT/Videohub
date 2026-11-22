@echo off
rem vh - VideoHub launcher. Starts the server if needed and opens the app window.
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0vh.ps1" %*
