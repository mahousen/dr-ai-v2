#!/bin/bash
# 德仁口腔 AI 助手 v2 - Mac 双击启动
# 双击这个文件即可启动，不需要开终端输命令

cd "$(dirname "$0")"

echo "================================"
echo "  DR AI v2 Starting..."
echo "================================"
if [ -f "version.txt" ]; then
  echo "  Version: $(cat version.txt)"
fi
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] 未找到 Node.js，请先安装：https://nodejs.org"
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

# 启动服务并自动打开浏览器
echo "[启动] 服务运行在 http://localhost:8080"
echo "按 Ctrl+C 停止服务"
echo ""

# 自动打开浏览器
sleep 1 && open http://localhost:8080 &

node server.js
