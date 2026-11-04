#!/usr/bin/env bash
# deploy/deploy.sh — Mim 生产发布脚本（服务器侧，幂等可重放）
#
# 职责：拉取 origin/main → 安装依赖（含 dev，因 tsx 是运行时依赖）
#       → 构建前端 → 发布静态产物到 /opt/mim/web → 重启后端 → 健康检查
#
# 用法（服务器上）：
#   sudo bash /opt/mim/app/deploy/deploy.sh
#
# 环境变量（可选）：
#   APP_DIR  默认 /opt/mim/app
#   WEB_DIR  默认 /opt/mim/web
#   SERVICE  默认 mim-api
#   PORT_    默认 8787
#
# 注意：本脚本对 /opt/mim/app 执行 git reset --hard origin/main，
#       该目录是纯发布目录、不承载任何人工修改；本地开发请勿在此目录工作。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mim/app}"
WEB_DIR="${WEB_DIR:-/opt/mim/web}"
SERVICE="${SERVICE:-mim-api}"
PORT_="${PORT_:-8787}"
REPO_URL="${REPO_URL:-https://github.com/afdk1991/mim.git}"
RUN_USER="${RUN_USER:-mim}"

log()  { printf '\033[32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. root 检查（非 root 自动用 sudo 重入） ---
if [ "$(id -u)" -ne 0 ]; then
  warn "非 root，尝试 sudo -n 重入"
  exec sudo -n bash "$0" "$@"
fi

# --- 1. 代码同步 ---
if [ ! -d "$APP_DIR/.git" ]; then
  log "首次部署：克隆 $REPO_URL"
  mkdir -p "$(dirname "$APP_DIR")"
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
else
  log "拉取 origin/main"
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  git -C "$APP_DIR" fetch --prune origin main
  git -C "$APP_DIR" reset --hard origin/main
  git -C "$APP_DIR" clean -fd -e node_modules -e .mim-dev-secret -e 'services/*/data' -e dist
fi

cd "$APP_DIR"

# --- 2. 依赖安装（必须含 devDependencies：tsx 是 start 的运行依赖） ---
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请先运行 deploy/bootstrap.sh"
log "pnpm install（含 dev，保证 tsx / vite 可用）"
if ! pnpm install --frozen-lockfile --prod=false; then
  warn "--frozen-lockfile 失败，退化为普通 install（锁文件可能与 package.json 不同步）"
  pnpm install --prod=false
fi

# --- 3. 前端构建 ---
log "构建 apps/web（tsc --noEmit + vite build）"
pnpm --filter @mim/web build

# --- 4. 发布静态产物 ---
log "发布静态产物 → $WEB_DIR"
mkdir -p "$WEB_DIR"
rm -rf "$WEB_DIR"/*
cp -R "$APP_DIR/apps/web/dist/." "$WEB_DIR/"

# --- 5. 数据目录与属主 ---
mkdir -p "$APP_DIR/services/mim-api/data"
mkdir -p "$APP_DIR/.mim-dev-secret"
if id -u "$RUN_USER" >/dev/null 2>&1; then
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$WEB_DIR" 2>/dev/null || true
else
  warn "用户 $RUN_USER 不存在，跳过 chown（请先执行 bootstrap.sh）"
fi

# --- 6. 重启后端 ---
log "重启 $SERVICE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"

# --- 7. 健康检查（最多等 20s） ---
log "健康检查 http://127.0.0.1:$PORT_/health"
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT_/health" >/dev/null 2>&1; then
    log "后端健康检查通过"
    break
  fi
  [ "$i" -eq 20 ] && { journalctl -u "$SERVICE" -n 40 --no-pager || true; die "健康检查失败"; }
  sleep 1
done

# --- 8. nginx 校验与热加载 ---
if command -v nginx >/dev/null 2>&1; then
  log "nginx -t && reload"
  nginx -t
  systemctl reload nginx || systemctl restart nginx
fi

log "部署完成：$(git -C "$APP_DIR" rev-parse --short HEAD) $(date -u +%FT%TZ)"
curl -fsS "http://127.0.0.1:$PORT_/health" && echo
