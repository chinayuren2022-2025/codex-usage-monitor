@echo off
cd /d "%~dp0"
title Codex Usage Export - close this window when done

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   Node.js is not installed.
    echo.
    echo   This tool requires Node.js (LTS version).
    echo   Opening the download page in your browser...
    echo.
    start https://nodejs.org/en/download
    echo   After installing Node.js, run this again.
    echo.
    pause
    exit /b 1
)

echo.
echo   This will export your Codex usage data and send it to the receiver.
echo   No personal files are touched - only ~/.codex/sessions/**.jsonl
echo.

node "%~dp0export-send.mjs" %*

echo.
pause