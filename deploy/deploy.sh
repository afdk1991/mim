#!/usr/bin/env bash
# deploy/deploy.sh — Mim 生产发布脚本（服务器侧，幂等可重放）
#
# 职责：拉取 origin/main → 安装依赖（含 dev，因 vite/esbuild 为构建期依赖）
#       → 构建前端（vite）→ 编译后端（esbuild → dist/index.js）
#       → 发布静态产物到 /opt/mim/web
#       → 幂等生成 /opt/mim/mim-api.env（MIM_JWT_SECRET）
#       → 执行 deploy/migrations/*.cjs（先备份、幂等可重放）→ 重启后端 → 健康检查
#
# 用法（服务器上）：
#   sudo bash /opt/mim/app/deploy/deploy.sh [目标提交]
#     不传目标提交时发布 origin/main 最新；CI 传 $GITHUB_SHA 保证「发布的提交
#     与本次 Run 的提交一致」——否则连续两次 push 时，先跑的 Run 会部署到后推的
#     提交，导致版本校验误判失败。
#
# 环境变量（可选）：
#   APP_DIR     默认 /opt/mim/app
#   WEB_DIR     默认 /opt/mim/web
#   SERVICE     默认 mim-api
#   PORT_       默认 8787
#   REPO_URL    默认 git@github.com:afdk1991/mim.git（SSH，见下方说明）
#   DEPLOY_KEY  默认 /opt/mim/.ssh/deploy_key（只读 deploy key 私钥）
#
# 网络说明：生产服务器访问 github.com 的 HTTPS 被阻断（SSL timeout），
#           仅 github.com:22（SSH）可达，故代码同步走 SSH deploy key。
#
# 注意：本脚本对 /opt/mim/app 执行 git reset --hard origin/main，
#       该目录是纯发布目录、不承载任何人工修改；本地开发请勿在此目录工作。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mim/app}"
WEB_DIR="${WEB_DIR:-/opt/mim/web}"
SERVICE="${SERVICE:-mim-api}"
PORT_="${PORT_:-8787}"
REPO_URL="${REPO_URL:-git@github.com:afdk1991/mim.git}"
DEPLOY_KEY="${DEPLOY_KEY:-/opt/mim/.ssh/deploy_key}"
RUN_USER="${RUN_USER:-mim}"

# 目标提交：CI 传入 $GITHUB_SHA；为空则跟随 origin/main
TARGET_REF="${1:-}"

log()  { printf '\033[32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. root 检查（非 root 自动用 sudo 重入） ---
if [ "$(id -u)" -ne 0 ]; then
  warn "非 root，尝试 sudo -n 重入"
  exec sudo -n bash "$0" "$@"
fi

# --- 1. 代码同步 ---
# 生产服务器到 github.com 的 HTTPS 被网络策略阻断（SSL timeout），
# 因此统一走 SSH（22 端口可达），使用只读 deploy key。
case "$REPO_URL" in
  git@*|ssh://*)
    if [ -f "$DEPLOY_KEY" ]; then
      export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
      log "git 使用 SSH 部署密钥 $DEPLOY_KEY"
    else
      die "缺少部署密钥 $DEPLOY_KEY（请在服务器生成 ed25519 密钥并注册为仓库 Deploy Key，参见 deploy/bootstrap.sh 第 3 步）"
    fi
    ;;
  *)
    warn "REPO_URL 非 SSH 形式，走 HTTPS（服务器出网可能被阻断）"
    ;;
esac

if [ ! -d "$APP_DIR/.git" ]; then
  log "首次部署：克隆 $REPO_URL"
  mkdir -p "$(dirname "$APP_DIR")"
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
else
  log "拉取 origin/main"
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  ok=0
  for attempt in 1 2 3; do
    if git -C "$APP_DIR" fetch --prune origin main; then ok=1; break; fi
    warn "git fetch 第 $attempt 次失败，5s 后重试"
    sleep 5
  done
  [ "$ok" -eq 1 ] || die "git fetch 连续 3 次失败，请检查服务器到 github.com:22 的连通性"
fi

# 精确检出目标提交（不留 origin/main 漂移）；目标提交缺失时单独按 SHA 获取
if [ -n "$TARGET_REF" ]; then
  if ! git -C "$APP_DIR" cat-file -e "${TARGET_REF}^{commit}" 2>/dev/null; then
    log "目标提交 $TARGET_REF 不在本地，按 SHA 单独获取"
    git -C "$APP_DIR" fetch --depth 1 origin "$TARGET_REF" || die "无法获取目标提交 $TARGET_REF"
  fi
  log "检出目标提交 $TARGET_REF"
  git -C "$APP_DIR" reset --hard "$TARGET_REF"
else
  warn "未指定目标提交，发布 origin/main 最新"
  git -C "$APP_DIR" reset --hard origin/main
fi
git -C "$APP_DIR" clean -fd -e node_modules -e .mim-dev-secret -e 'services/*/data' -e dist

cd "$APP_DIR"

# --- 2. 依赖安装（含 devDependencies：vite/esbuild 是构建期依赖） ---
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请先运行 deploy/bootstrap.sh"
log "pnpm install（含 dev，保证 vite / esbuild 可用）"
if ! pnpm install --frozen-lockfile --prod=false; then
  warn "--frozen-lockfile 失败，退化为普通 install（锁文件可能与 package.json 不同步）"
  pnpm install --prod=false
fi

# --- 3. 前端构建 + 后端编译 ---
log "构建 apps/web（tsc --noEmit + vite build）"
pnpm --filter @mim/web build
log "编译 services/mim-api（esbuild → dist/index.js）"
pnpm --filter @mim/api build

# --- 4. 发布静态产物 ---
log "发布静态产物 → $WEB_DIR"
mkdir -p "$WEB_DIR"
rm -rf "$WEB_DIR"/*
cp -R "$APP_DIR/apps/web/dist/." "$WEB_DIR/"

# --- 5. 数据目录、JWT 密钥与属主 ---
mkdir -p "$APP_DIR/services/mim-api/data"
mkdir -p "$APP_DIR/.mim-dev-secret"

# JWT 密钥（生产必配）：systemd unit 以 EnvironmentFile=/opt/mim/mim-api.env 注入
# MIM_JWT_SECRET；首次部署幂等生成 64 位十六进制随机密钥，已存在则保留
# （避免每次部署轮换密钥导致在线会话全部失效）。
MIM_ENV_FILE="${MIM_ENV_FILE:-/opt/mim/mim-api.env}"
if [ ! -f "$MIM_ENV_FILE" ]; then
  log "生成 $MIM_ENV_FILE（MIM_JWT_SECRET 随机密钥）"
  printf 'MIM_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" > "$MIM_ENV_FILE"
else
  log "$MIM_ENV_FILE 已存在，保留现有 MIM_JWT_SECRET"
fi
chmod 600 "$MIM_ENV_FILE"

if id -u "$RUN_USER" >/dev/null 2>&1; then
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$WEB_DIR" 2>/dev/null || true
  chown "$RUN_USER:$RUN_USER" "$MIM_ENV_FILE" 2>/dev/null || true
else
  warn "用户 $RUN_USER 不存在，跳过 chown（请先执行 bootstrap.sh）"
fi

# --- 5.5 数据库迁移（幂等，按文件名顺序执行；首次部署无 DB 时跳过） ---
# 迁移脚本位于 deploy/migrations/*.cjs，均以 better-sqlite3 backup API 先备份再 DROP/重建，
# 可反复重放。任一迁移失败即中止部署（set -e），避免把半迁移的库暴露给新代码。
DB_FILE="$APP_DIR/services/mim-api/data/mim.db"
if [ -f "$DB_FILE" ]; then
  log "执行数据库迁移（$APP_DIR/deploy/migrations）"
  shopt -s nullglob
  for m in "$APP_DIR"/deploy/migrations/*.cjs; do
    log "migration: $(basename "$m")"
    node "$m" --apply
  done
  shopt -u nullglob
  # 迁移以 root 运行，可能产生 root 属主的 -wal/-shm，重启前归还给运行用户
  if id -u "$RUN_USER" >/dev/null 2>&1; then
    chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/services/mim-api/data" 2>/dev/null || true
  fi
else
  warn "数据库文件尚不存在（首次部署），跳过迁移；应用启动时将按 schema.sql 建库"
fi

# --- 6. 重启后端 ---
# node 绝对路径检测：bootstrap.sh 不固定 node 安装位置（可能是 /usr/bin/node
# 或 nvm 管理的版本路径），以实际 PATH 中的 node 为准生成 systemd override；
# unit 文件默认 ExecStart=/usr/bin/node，路径不一致时由 override 覆盖。
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || die "未找到 node，请先运行 deploy/bootstrap.sh"
if [ "$NODE_BIN" != "/usr/bin/node" ]; then
  log "node 实际路径为 $NODE_BIN，生成 systemd override"
  mkdir -p /etc/systemd/system/mim-api.service.d
  printf '[Service]\nExecStart=\nExecStart=%s dist/index.js\n' "$NODE_BIN" \
    > /etc/systemd/system/mim-api.service.d/override.conf
fi

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
