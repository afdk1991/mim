#!/usr/bin/env bash
# IGA Pages（火山引擎 IGA）部署脚本
#
# 客观前提：IGA Pages 依赖 `@iga-pages/cli` 与火山引擎账号凭证（AK/SK）。
# 缺失时打印 SKIP 并以 0 退出，不阻断主部署链路（AGENTS.md 铁律一：缺私有凭证属客观约束）。
#
# 具备条件后的用法：
#   export IGA_ACCESS_KEY=... IGA_SECRET_KEY=...
#   bash deploy/iga/deploy.sh
#
# CLI 接口以 @iga-pages/cli 实测为准（v1.2.2）：
#   iga login --accessKey <AK> --secretKey <SK>
#   iga pages deploy --name <项目名>
set -euo pipefail

NAME="${IGA_PROJECT_NAME:-mim}"

if [ -z "${IGA_ACCESS_KEY:-}" ] || [ -z "${IGA_SECRET_KEY:-}" ]; then
  echo "SKIP: 缺少 IGA_ACCESS_KEY / IGA_SECRET_KEY（火山引擎私有凭证）"
  exit 0
fi

if ! command -v iga >/dev/null 2>&1; then
  echo "==> 安装 @iga-pages/cli"
  npm i -g @iga-pages/cli@latest >/dev/null 2>&1 || true
fi
if ! command -v iga >/dev/null 2>&1; then
  echo "SKIP: iga CLI 安装失败（command -v iga 无结果）"
  exit 0
fi

echo "==> 登录火山引擎"
iga login --accessKey "$IGA_ACCESS_KEY" --secretKey "$IGA_SECRET_KEY"

echo "==> 构建前端"
pnpm --filter @mim/web build

# IGA 以「当前工作目录」为纯静态产物根目录；monorepo 根目录会把源码一并上传，
# 因此进入构建产物目录再部署。
echo "==> 部署 apps/web/dist 到 IGA Pages 项目 $NAME"
cd apps/web/dist
iga pages deploy --name "$NAME"
