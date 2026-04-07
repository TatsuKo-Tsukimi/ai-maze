@echo off
chcp 65001 >nul 2>&1
title 永久囚禁 · AI迷宫

:: ── 检查 Node.js ──
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 没有找到 Node.js，请先安装: https://nodejs.org
    pause
    exit /b 1
)

:: ── 切到脚本所在目录 ──
cd /d "%~dp0"

:: ── 检查端口是否已占用（服务器已在运行） ──
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [已运行] 服务器已在 http://localhost:3000 运行
    echo 正在打开浏览器...
    start http://localhost:3000
    exit /b 0
)

:: ── 启动服务器 ──
echo ╔══════════════════════════════════════╗
echo ║  永久囚禁 · AI迷宫  正在启动...     ║
echo ╚══════════════════════════════════════╝
echo.

:: 3秒后打开浏览器（给服务器启动时间）
start /b cmd /c "timeout /t 3 /noq >nul && start http://localhost:3000"

:: 前台运行服务器（关闭窗口 = 关闭服务器）
node server.js

:: 如果服务器退出
echo.
echo [服务器已停止] 按任意键关闭...
pause >nul
