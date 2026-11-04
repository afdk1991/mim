#!/usr/bin/env bash
# deploy/bootstrap.sh — Mim 生产服务器一次性引导（幂等，可重复执行）
#
# 职责：装基础软件 → 启用 pnpm → 建运行用户与目录 → 安装 nginx 站点
#       → 安装 systemd 服务 → 首次发布 → 尝试签发 HTTPS 证书
#
# 用法（服务器上，root）：
#   curl -fsSL https://raw.githubusercontent.com/afdk1991/mim/main/deploy/bootstrap.sh | bash
#   或先克隆仓库后：sudo bash /opt/mim/app/deploy/bootstrap.sh
#
# 环境变量（可选）：
#   DOMAIN   默认 mim.mixm.top
#   APP_DIR  默认 /opt/mim/app
#   WEB_DIR  默认 /opt/mim/web
#   RUN_USER 默认 mim

set -euo pipefail

DOMAIN="${DOMAIN:-mim.mixm.top}"
APP_DIR="${APP_DIR:-/opt/mim/app}"
WEB_DIR="${WEB_DIR:-/opt/mim/web}"
RUN_USER="${RUN_USER:-mim}"
REPO_URL="${REPO_URL:-git@github.com:afdk1991/mim.git}"
DEPLOY_KEY="${DEPLOY_KEY:-/opt/mim/.ssh/deploy_key}"
PNPM_VERSION="9.12.0"

log()  { printf '\033[32m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[bootstrap]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || exec sudo -n bash "$0" "$@"

# --- 1. 基础软件 ---
log "安装基础软件（git / nginx / rsync / curl / certbot）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git nginx rsync curl ca-certificates certbot python3-certbot-nginx || \
  warn "部分软件安装失败，请检查 apt 源"

# --- 2. Node / pnpm ---
command -v node >/dev/null 2>&1 || die "未找到 node（需要 Node >= 18，建议 22）"
log "node $(node -v) / npm $(npm -v)"
if ! command -v pnpm >/dev/null 2>&1; then
  log "启用 corepack 并激活 pnpm@$PNPM_VERSION"
  corepack enable || warn "corepack enable 失败"
  corepack prepare "pnpm@${PNPM_VERSION}" --activate || npm install -g "pnpm@${PNPM_VERSION}"
fi
pnpm -v

# --- 3. 运行用户与目录 ---
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  log "创建运行用户 $RUN_USER"
  useradd --system --home-dir /opt/mim --shell /usr/sbin/nologin "$RUN_USER"
else
  log "用户 $RUN_USER 已存在"
fi
mkdir -p /opt/mim "$WEB_DIR"
chown -R "$RUN_USER:$RUN_USER" /opt/mim

# --- 3.1 SSH deploy key（服务器 HTTPS 到 github.com 被阻断，仅 22 端口可达） ---
mkdir -p /opt/mim/.ssh
chmod 700 /opt/mim/.ssh
if [ ! -f "$DEPLOY_KEY" ]; then
  log "生成只读部署密钥 $DEPLOY_KEY"
  ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N '' -C "mim-deploy@$(hostname)" >/dev/null
else
  log "部署密钥已存在，复用"
fi
chmod 600 "$DEPLOY_KEY"
export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
if ! git ls-remote "$REPO_URL" HEAD >/dev/null 2>&1; then
  warn "仓库不可读：请把下面的公钥添加为仓库 Deploy Key（只读）后重跑本脚本"
  cat "$DEPLOY_KEY.pub"
  die "deploy key 未授权"
fi
log "deploy key 验证通过"

# 首次克隆（后续由 deploy.sh 更新）
if [ ! -d "$APP_DIR/.git" ]; then
  log "克隆仓库 → $APP_DIR"
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
# git 操作以 root 执行，避免运行用户持有 .git 权限
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

# --- 4. nginx 站点 ---
log "安装 nginx 站点 $DOMAIN"
sed "s/server_name mim.mixm.top;/server_name ${DOMAIN} www.${DOMAIN};/" \
  "$APP_DIR/deploy/nginx-mim.conf" > /etc/nginx/sites-available/mim.conf
ln -sf /etc/nginx/sites-available/mim.conf /etc/nginx/sites-enabled/mim.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t || die "nginx 配置校验失败"
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

# --- 5. systemd 服务 ---
log "安装 systemd 服务 mim-api"
cp "$APP_DIR/deploy/mim-api.service" /etc/systemd/system/mim-api.service
systemctl daemon-reload
systemctl enable mim-api

# --- 6. 首次发布 ---
log "执行首次发布"
bash "$APP_DIR/deploy/deploy.sh"

# --- 7. HTTPS（失败不阻断） ---
# 只申请已解析到本机的域名：www 子域若未建 A 记录，一并申请会让整张证书失败（NXDOMAIN）
if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  CERT_ARGS=(-d "$DOMAIN")
  if getent hosts "www.${DOMAIN}" >/dev/null 2>&1; then
    CERT_ARGS+=(-d "www.${DOMAIN}")
    log "检测到 www.${DOMAIN} 已解析，一并申请"
  else
    warn "www.${DOMAIN} 未解析，仅申请 ${DOMAIN}"
  fi
  log "尝试签发 Let's Encrypt 证书（${CERT_ARGS[*]}）"
  certbot --nginx "${CERT_ARGS[@]}" \
    --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect || \
    warn "证书签发失败（域名解析未就绪 / 80 端口不可达），可稍后重试: certbot --nginx -d $DOMAIN"
else
  log "证书已存在，跳过签发"
fi

log "引导完成 → https://${DOMAIN}"
