#!/usr/bin/env bash
# veFaaS（火山引擎函数服务）部署脚本
#
# 客观前提：veFaaS 依赖 `vefaas` CLI 与火山引擎账号凭证（VE_ACCESS_KEY / VE_SECRET_KEY + 已存在的应用 ID）。
# 缺失时打印 SKIP 并以 0 退出，不阻断主部署链路（AGENTS.md 铁律一：缺私有凭证属客观约束，须显式报告）。
#
# 具备条件后的用法：
#   export VE_ACCESS_KEY=... VE_SECRET_KEY=... VEFAAS_APP_ID=app-xxxxx
#   bash deploy/vefaas/deploy.sh
#
# CLI 接口以 @volcengine/vefaas-cli 实测为准（v0.3.2）：
#   vefaas login --accessKey <AK> --secretKey <SK>
#   vefaas deploy --appId <ID> --yes
set -euo pipefail

APP_ID="${VEFAAS_APP_ID:-}"

if [ -z "${VE_ACCESS_KEY:-}" ] || [ -z "${VE_SECRET_KEY:-}" ]; then
  echo "SKIP: 缺少 VE_ACCESS_KEY / VE_SECRET_KEY（火山引擎私有凭证）"
  exit 0
fi

if [ -z "$APP_ID" ]; then
  echo "SKIP: 缺少 VEFAAS_APP_ID（需先在火山引擎控制台创建 veFaaS 应用）"
  exit 0
fi

if ! command -v vefaas >/dev/null 2>&1; then
  echo "==> 安装 @volcengine/vefaas-cli"
  npm i -g @volcengine/vefaas-cli@latest >/dev/null 2>&1 || true
fi
if ! command -v vefaas >/dev/null 2>&1; then
  echo "SKIP: vefaas CLI 安装失败（command -v vefaas 无结果）"
  exit 0
fi

echo "==> 登录火山引擎"
vefaas login --accessKey "$VE_ACCESS_KEY" --secretKey "$VE_SECRET_KEY" >/dev/null

echo "==> 发布到 veFaaS 应用 $APP_ID"
vefaas deploy --appId "$APP_ID" --yes

echo "==> 应用状态"
vefaas app info --id "$APP_ID"
