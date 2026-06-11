@echo off
cd /d "%~dp0"
title Codex Usage Monitor - close this window to stop
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install it from https://nodejs.org and run again.
  echo.
  pause
  exit /b 1
)
rem First run sets up a Desktop shortcut (idempotent, silent).
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-shortcut.ps1" >nul 2>nul
node src\server.mjs
echo.
echo   Server stopped.
pause
