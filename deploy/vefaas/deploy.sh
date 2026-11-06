#!/usr/bin/env bash
# veFaaS（火山引擎函数服务）部署脚本
#
# 客观前提：veFaaS 依赖 `vefaas` CLI、火山引擎账号凭证，以及一个已处于 running 的 API 网关
# （veFaaS 没有独立 HTTP trigger，公网入口只能挂 APIG 网关；APIG 为计费资源，创建网关要求
# 账户余额 + 代金券合计 ≥ 100 元，实测不足时报 BalanceNotEnough）。
#
# 缺失条件时打印 SKIP 并以 0 退出，不阻断主部署链路（AGENTS.md 铁律一：缺私有凭证/资金属客观约束）。
#
# 具备条件后的用法（认证二选一）：
#   export VE_ACCESS_KEY=... VE_SECRET_KEY=...    # CI：长期 AK/SK
#   vefaas login --sso                             # 本机：浏览器 SSO（登录态存于本机 CLI）
#   export VEFAAS_APP_ID=app-xxxxx                 # 已有应用时直接发布
#   bash deploy/vefaas/deploy.sh
#
# CLI 接口以 @volcengine/vefaas-cli 实测为准（v0.3.2）：
#   vefaas login [--accessKey <AK> --secretKey <SK> | --sso]
#   vefaas deploy --appId <ID> --yes
#   vefaas deploy --newApp <name> --gatewayName <gw> --yes   # 应用不存在时创建并部署
set -euo pipefail

APP_ID="${VEFAAS_APP_ID:-}"
APP_NAME="${VEFAAS_APP_NAME:-mim-api}"
GATEWAY="${VEFAAS_GATEWAY_NAME:-mim-gw}"

if ! command -v vefaas >/dev/null 2>&1; then
  echo "==> 安装 @volcengine/vefaas-cli"
  npm i -g @volcengine/vefaas-cli@latest >/dev/null 2>&1 || true
fi
if ! command -v vefaas >/dev/null 2>&1; then
  echo "SKIP: vefaas CLI 安装失败（command -v vefaas 无结果）"
  exit 0
fi

if [ -n "${VE_ACCESS_KEY:-}" ] && [ -n "${VE_SECRET_KEY:-}" ]; then
  echo "==> 登录火山引擎（AK/SK）"
  vefaas login --accessKey "$VE_ACCESS_KEY" --secretKey "$VE_SECRET_KEY" >/dev/null
elif vefaas whoami >/dev/null 2>&1; then
  # 本机已通过 `vefaas login --sso` 完成浏览器 OAuth，登录态由 CLI 自动刷新
  echo "==> 复用本机 veFaaS 登录态（vefaas whoami 通过）"
else
  echo "SKIP: 缺少 VE_ACCESS_KEY / VE_SECRET_KEY，且本机未登录（先执行 vefaas login --sso）"
  exit 0
fi

if [ -n "$APP_ID" ]; then
  echo "==> 发布到 veFaaS 应用 $APP_ID"
  vefaas deploy --appId "$APP_ID" --yes
  echo "==> 应用状态"
  vefaas app info --id "$APP_ID"
else
  # 无应用 ID 时走「创建并部署」：要求网关已存在且 running。
  # 网关缺失时的实测报错为 `Error: Running API Gateway not found: <gw>`；
  # 创建网关需余额 ≥ 100 元，实测报 BalanceNotEnough。
  echo "==> 未提供 VEFAAS_APP_ID，尝试创建并发布新应用 $APP_NAME（网关 $GATEWAY）"
  if ! vefaas deploy --newApp "$APP_NAME" --gatewayName "$GATEWAY" --yes; then
    echo "SKIP: veFaaS 创建/发布失败。已知客观阻塞：APIG 网关为计费资源，"
    echo "      账户余额 + 代金券合计需 ≥ 100 元（不足时 CreateGateway 报 BalanceNotEnough）；"
    echo "      无 running 网关则报 'Running API Gateway not found: $GATEWAY'。"
    exit 0
  fi
fi
