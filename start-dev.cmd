@echo off
rem Starts the QA Inspection App for local development, each server in its
rem own window (close a window to stop that server). Double-click this file,
rem or run it from a terminal. Uses `node src/index.js` for the backend, not
rem `npm run dev` -- node --watch crashes on this mapped network drive (see
rem CLAUDE.md), so restart the backend window by hand after backend changes.

cd /d "%~dp0"

rem Skip a server that's already running instead of starting a second copy.
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul
if errorlevel 1 (
  start "QA App - Backend (https://localhost:3001)" /d "%~dp0backend" cmd /k node src/index.js
) else (
  echo Backend already running on port 3001.
)

netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if errorlevel 1 (
  start "QA App - Frontend (https://localhost:5173)" /d "%~dp0frontend" cmd /k npm run dev
) else (
  echo Frontend already running on port 5173.
)

echo.
echo App: https://localhost:5173
timeout /t 5 >nul
