@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\google-auth-library\package.json" (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node --env-file-if-exists=.env.local local.mjs --open
if errorlevel 1 pause
