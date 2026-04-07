@echo off
title AI MAZE - 永久囚禁
echo.
echo  ╔════════════════════════════════════╗
echo  ║   永久囚禁 · AI 迷宫              ║
echo  ║   Starting server...              ║
echo  ╚════════════════════════════════════╝
echo.

:: Check if already running
netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel%==0 (
    echo Server already running on port 3000
    echo Opening browser...
    start http://localhost:3000
    timeout /t 2 >nul
    exit
)

:: Start server via WSL from this script's directory
echo Starting server in WSL...
set "SCRIPT_DIR=%~dp0"
for /f "usebackq delims=" %%I in (`wsl wslpath -a "%SCRIPT_DIR%"`) do set "WSL_DIR=%%I"
start /min wsl -e bash -lc "cd '%WSL_DIR%' && node server.js"

:: Wait for server to be ready
echo Waiting for server...
:wait_loop
timeout /t 1 >nul
netstat -ano | findstr ":3000" >nul 2>&1
if %errorlevel% neq 0 goto wait_loop

echo Server ready! Opening browser...
start http://localhost:3000
echo.
echo Game is running at http://localhost:3000
echo Close this window to stop the server.
pause >nul
