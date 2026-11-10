@echo off
setlocal
cd /d "%~dp0"
node src/scenarios/serve-month.ts
exit /b %ERRORLEVEL%
