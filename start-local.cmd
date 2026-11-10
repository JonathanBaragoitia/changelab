@echo off
setlocal
cd /d "%~dp0"
echo ChangeLab - La direccion aparece al iniciar.
echo Ctrl+C para detener el servidor.
call npm.cmd start
exit /b %ERRORLEVEL%
