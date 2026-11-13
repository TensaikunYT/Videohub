@echo off
rem Opens VideoHub through the installed Node.js runtime. A console window may remain for the server.
node "%~dp0scripts\install.mjs" open %*
if errorlevel 1 pause
