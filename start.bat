@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================
echo   DR AI v2 Starting...
echo ================================
if exist version.txt (
    set /p VER=<version.txt
    echo   Version: !VER!
)
echo   💡 更新方法: 替换 index.html, server.js, version.txt 后重启
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未找到 Node.js，请先安装 https://nodejs.org
    pause
    exit /b 1
)
node -v

:: 首次运行安装依赖
if not exist "node_modules\ws" (
    echo [首次运行] 安装依赖中...
    call npm install
    echo.
)

:: 启动服务
echo [启动] 服务运行在 http://localhost:8080
echo 按 Ctrl+C 停止服务
echo.
node server.js
pause
