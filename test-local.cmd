@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run check
exit /b %ERRORLEVEL%
