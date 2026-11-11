@echo off
setlocal
cd /d "%~dp0"
echo La direccion aparece al iniciar.
echo Ctrl+C para detener el servidor.
call npm.cmd start
exit /b %ERRORLEVEL%
