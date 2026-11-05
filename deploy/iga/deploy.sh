#!/usr/bin/env bash
# IGA Pages 部署脚本
#
# 客观前提：IGA Pages 依赖其专用 CLI 与账号 token（IGA_TOKEN）。二者在本仓库 CI 与开发机上均不存在，
# 因此缺失时打印 SKIP 并以 0 退出，不阻断主部署链路（AGENTS.md 铁律一：缺私有凭证属客观约束）。
#
# 具备条件后的用法：
#   IGA_TOKEN=... IGA_PROJECT_ID=... bash deploy/iga/deploy.sh
set -euo pipefail

CLI=""
for candidate in iga iga-cli iga-pages; do
  if command -v "$candidate" >/dev/null 2>&1; then
    CLI="$candidate"
    break
  fi
done

if [ -z "$CLI" ]; then
  echo "SKIP: 未找到 IGA CLI（已尝试 iga / iga-cli / iga-pages）"
  exit 0
fi

if [ -z "${IGA_TOKEN:-}" ]; then
  echo "SKIP: 缺少 IGA_TOKEN"
  exit 0
fi

echo "==> 使用 $CLI 部署 apps/web/dist"
"$CLI" deploy --project "${IGA_PROJECT_ID:?缺少 IGA_PROJECT_ID}" --dir apps/web/dist --token "$IGA_TOKEN"
