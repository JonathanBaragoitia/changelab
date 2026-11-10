@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instala Node.js 24 LTS y abre una terminal nueva.
  pause
  exit /b 1
)
echo ChangeLab - Crear cuenta
node --env-file-if-exists=.env src\setup-users.ts
set "CHANGELAB_RESULT=%ERRORLEVEL%"
pause
exit /b %CHANGELAB_RESULT%
