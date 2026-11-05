#!/usr/bin/env bash
# veFaaS（火山引擎函数服务）部署脚本
#
# 客观前提：veFaaS 依赖 `vefaas` CLI 与火山引擎账号凭证（VE_ACCESS_KEY / VE_SECRET_KEY）。
# 本仓库 CI runner 与开发机均未安装该 CLI、也未配置凭证，因此脚本在缺失前提下打印 SKIP 并以 0 退出，
# 不阻断主部署链路（AGENTS.md 铁律一：缺私有凭证属客观约束，须显式报告而非静默失败）。
#
# 具备条件后的用法：
#   npm i -g @volcengine/vefaas-cli
#   export VE_ACCESS_KEY=... VE_SECRET_KEY=...
#   VEFAAS_APP_ID=<应用 ID> bash deploy/vefaas/deploy.sh
set -euo pipefail

APP_ID="${VEFAAS_APP_ID:-}"
IMAGE="ghcr.io/afdk1991/mim-api:${GITHUB_SHA:-latest}"

if ! command -v vefaas >/dev/null 2>&1; then
  echo "SKIP: vefaas CLI 未安装（command -v vefaas 无结果）"
  exit 0
fi

if [ -z "${VE_ACCESS_KEY:-}" ] || [ -z "${VE_SECRET_KEY:-}" ]; then
  echo "SKIP: 缺少 VE_ACCESS_KEY / VE_SECRET_KEY（火山引擎私有凭证）"
  exit 0
fi

if [ -z "$APP_ID" ]; then
  echo "SKIP: 缺少 VEFAAS_APP_ID"
  exit 0
fi

echo "==> 发布镜像 $IMAGE 到 veFaaS 应用 $APP_ID"
vefaas release "$APP_ID" --image "$IMAGE" --port 8787
vefaas status "$APP_ID"
