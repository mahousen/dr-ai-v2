#!/bin/bash
# 德仁口腔 AI 助手 v2 - Mac 启动脚本
# 用法: cd 到项目目录，运行 bash start.sh

set -e

echo "================================"
echo "  DR AI v2 Starting..."
echo "================================"
if [ -f "version.txt" ]; then
  echo "  Version: $(cat version.txt)"
fi
echo "  💡 更新方法: 替换 index.html, server.js, version.txt 后重启"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] 未找到 Node.js，请先安装：https://nodejs.org"
    exit 1
fi
echo "Node.js: $(node -v)"

# 首次运行安装依赖
if [ ! -d "node_modules/ws" ]; then
    echo "[首次运行] 安装依赖中..."
    npm install
    echo ""
fi

# 启动服务
echo "[启动] 服务运行在 http://localhost:8080"
echo "按 Ctrl+C 停止服务"
echo ""
node server.js
