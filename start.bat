@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ================================
echo   德仁口腔 AI 助手 v2
echo ================================

:: ---------- 自动更新 ----------
if exist check_update.py (
    echo 检查更新...
    python check_update.py 2>nul
    if !errorlevel! neq 0 (
        echo (跳过更新检查^)
    )
    echo.
)

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请安装 https://nodejs.org
    pause
    exit /b 1
)

:: 首次安装依赖
if not exist "node_modules\ws" (
    echo [首次运行] 安装依赖中...
    call npm install
    echo.
)

:: 启动
echo [启动] http://localhost:8080
echo 按 Ctrl+C 停止
echo.
node server.js
pause
