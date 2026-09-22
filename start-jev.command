#!/bin/zsh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 18+（推荐 20+）。"
  echo ""
  read "?按回车退出..."
  exit 1
fi

echo "正在启动 Jev 五子棋……"
echo "默认尝试 8787；如果被占用，会自动寻找 8788-8797，必要时自动选择其他可用端口。"
echo ""
JEV_PROXY_OPEN=1 node jev-proxy.mjs
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo ""
  read "?启动失败，按回车退出..."
fi
exit "$STATUS"
