#!/bin/bash
# 德仁口腔 AI 助手 - Mac 桌面快捷启动
# 放到桌面上，双击即可启动（程序本体在坚果云里，自动从GitHub更新）

APP_DIR="$HOME/我的坚果云/德仁AI助手v2-部署包"

if [ ! -d "$APP_DIR" ]; then
    echo "❌ 找不到程序文件夹：$APP_DIR"
    echo "请确认已将「德仁AI助手v2-部署包」放到坚果云同步文件夹里"
    echo ""
    read -p "按回车退出..."
    exit 1
fi

cd "$APP_DIR" || exit 1

# 赋予执行权限
chmod +x start.command 2>/dev/null

# ---------- 自动更新（从GitHub）----------
if [ -f "check_update.py" ]; then
    python3 check_update.py 2>/dev/null || python check_update.py 2>/dev/null || echo "(跳过更新检查)"
    echo ""
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装：https://nodejs.org"
    echo ""
    read -p "按回车退出..."
    exit 1
fi

# 首次运行安装依赖
if [ ! -d "node_modules/ws" ]; then
    echo "📦 首次运行，安装依赖中..."
    npm install
    echo ""
fi

# 启动
echo "🚀 启动中..."
sleep 1
open http://localhost:8080 2>/dev/null &
node server.js
