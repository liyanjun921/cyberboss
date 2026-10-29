@echo off
setlocal
if /i "%~1"=="--inside" goto inside
start "Cyberboss Setup - Keep This Window Open" "%ComSpec%" /d /k ""%~f0" --inside"
exit /b

:inside
cd /d "%~dp0"
echo Cyberboss Windows setup
echo Folder: "%CD%"
echo.
if not exist "scripts\windows-setup.js" goto missing
where node >nul 2>nul
if errorlevel 1 goto neednode
echo Node version:
node --version
echo.
node "scripts\windows-setup.js"
set "CYBERBOSS_SETUP_EXIT=%ERRORLEVEL%"
echo.
echo Setup finished with exit code %CYBERBOSS_SETUP_EXIT%.
echo This window will stay open. Send a screenshot of any error above.
echo Do not share account tokens or credential files.
goto end

:missing
echo ERROR: scripts\windows-setup.js is missing.
echo Extract the COMPLETE ZIP first. Do not run this file inside the ZIP preview.
goto end

:neednode
echo ERROR: Node.js was not found.
echo Install Node.js LTS from https://nodejs.org/en/download
echo Then close this window and reopen START-WINDOWS.cmd.
goto end

:end
echo.
echo You can close this window after reading the result.
