#!/bin/bash
# 德仁口腔 AI 助手 v2 - Mac 双击启动
# 双击此文件即可启动，自动检查更新

cd "$(dirname "$0")"

echo "================================"
echo "  德仁口腔 AI 助手 v2"
echo "================================"

# ---------- 自动更新 ----------
if [ -f "check_update.py" ]; then
    python3 check_update.py 2>/dev/null || python check_update.py 2>/dev/null || echo "(跳过更新检查)"
    echo ""
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请安装: https://nodejs.org"
    echo ""
    read -p "按回车退出..."
    exit 1
fi

# 首次运行安装依赖
if [ ! -d "node_modules/ws" ]; then
    echo "[首次运行] 安装依赖中..."
    npm install
    echo ""
fi

# 启动
echo "[启动] http://localhost:8080"
echo "按 Ctrl+C 停止"
echo ""

sleep 1 && open http://localhost:8080 &
node server.js
