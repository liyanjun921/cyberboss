@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install the LTS version, then reopen this file.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node scripts/windows-setup.js
if errorlevel 1 echo Setup stopped. Please send the error text above, without account tokens.
pause
