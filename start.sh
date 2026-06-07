#!/bin/bash
# 德仁口腔 AI 助手 v2 - Mac 终端启动
# 用法: bash start.sh

set -e
cd "$(dirname "$0")"

echo "================================"
echo "  德仁口腔 AI 助手 v2"
echo "================================"

# ---------- 自动更新 ----------
if [ -f "check_update.py" ]; then
    python3 check_update.py 2>/dev/null || python check_update.py 2>/dev/null || echo "(跳过更新检查)"
    echo ""
fi

if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请安装: https://nodejs.org"
    exit 1
fi
echo "Node.js: $(node -v)"

if [ ! -d "node_modules/ws" ]; then
    echo "[首次运行] 安装依赖中..."
    npm install
    echo ""
fi

echo "[启动] http://localhost:8080"
echo "按 Ctrl+C 停止"
echo ""
node server.js
