#!/bin/bash
# 永久囚禁 · AI迷宫 — 一键启动
set -e
cd "$(dirname "$0")"

# 检查 Node
if ! command -v node &>/dev/null; then
  echo "[错误] 没有找到 Node.js，请先安装: https://nodejs.org"
  exit 1
fi

# 检查是否已在运行
if lsof -i :3000 -sTCP:LISTEN &>/dev/null 2>&1 || ss -tlnp 2>/dev/null | grep -q ':3000 '; then
  echo "[已运行] 服务器已在 http://localhost:3000"
  open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true
  exit 0
fi

echo "╔══════════════════════════════════════╗"
echo "║  永久囚禁 · AI迷宫  正在启动...     ║"
echo "╚══════════════════════════════════════╝"

# 3秒后打开浏览器
(sleep 3 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true)) &

node server.js
