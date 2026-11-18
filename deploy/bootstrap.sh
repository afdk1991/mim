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
#   DOMAIN   默认 laal.top（证书目录 live/laal.top，*.laal.top 泛域名覆盖 zy.laal.top）
#   APP_DIR  默认 /opt/mim/app
#   WEB_DIR  默认 /opt/mim/web
#   RUN_USER 默认 mim
#   MIM_WEB_HTTP_PORT  前端 HTTP 端口，默认 8088
#   MIM_WEB_HTTPS_PORT 前端 HTTPS 端口，默认 443（与 MixmAPP 共享监听，不抢 default_server）
#   MIM_API_PORT       后端回环端口（API + WS 共用），默认 8787
#   MIM_TLS_CERTBOT    1=本脚本用 certbot --nginx 签证书（需独占 80/443）；0（默认）=同机共存，不签
#   MIM_NGINX_TAKE_DEFAULT 1=删除 sites-enabled/default 独占机器；0（默认）=与 MixmAPP 共存

set -euo pipefail

DOMAIN="${DOMAIN:-laal.top}"
APP_DIR="${APP_DIR:-/opt/mim/app}"
WEB_DIR="${WEB_DIR:-/opt/mim/web}"
RUN_USER="${RUN_USER:-mim}"
# 端口三件套与 deploy.sh 同名同默认值：两个脚本渲染同一份 nginx 模板，改一处口径即全链路一致
MIM_WEB_HTTP_PORT="${MIM_WEB_HTTP_PORT:-8088}"
MIM_WEB_HTTPS_PORT="${MIM_WEB_HTTPS_PORT:-443}"
MIM_API_PORT="${MIM_API_PORT:-8787}"
MIM_TLS_CERTBOT="${MIM_TLS_CERTBOT:-0}"
MIM_NGINX_TAKE_DEFAULT="${MIM_NGINX_TAKE_DEFAULT:-0}"
# 第 6 步以子进程调用 deploy.sh，端口口径必须显式导出，避免子进程回落到默认值
export MIM_WEB_HTTP_PORT MIM_WEB_HTTPS_PORT MIM_API_PORT MIM_TLS_CERTBOT MIM_NGINX_TAKE_DEFAULT
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
log "安装 nginx 站点 $DOMAIN（HTTP ${MIM_WEB_HTTP_PORT} / HTTPS ${MIM_WEB_HTTPS_PORT} / 后端 127.0.0.1:${MIM_API_PORT}）"
# 全量替换模板域：主站、api 子域与功能子域的 server_name / 跳转目标都跟随 DOMAIN
# 端口与 TLS 片段同样走占位符：80 归同机 MixmAPP，Mim 监听 8088；HTTPS 在 443 上与 MixmAPP
# 共享监听（靠 server_name/SNI 区分），本脚本任何 server 块都不写 default_server
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
  TLS_CONF="listen ${MIM_WEB_HTTPS_PORT} ssl;\n    listen [::]:${MIM_WEB_HTTPS_PORT} ssl;\n    ssl_certificate ${CERT_DIR}/fullchain.pem;\n    ssl_certificate_key ${CERT_DIR}/privkey.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;\n    ssl_session_cache shared:MimTLS:10m;\n    ssl_session_timeout 10m;"
else
  TLS_CONF="# TLS 未启用：${CERT_DIR} 缺少 fullchain.pem / privkey.pem（同机共存用 DNS-01 签发后重跑）"
fi
sed -e "s/laal\.top/${DOMAIN}/g" \
    -e "s|__MIM_WEB_HTTP_PORT__|${MIM_WEB_HTTP_PORT}|g" \
    -e "s|__MIM_WEB_HTTPS_PORT__|${MIM_WEB_HTTPS_PORT}|g" \
    -e "s|__MIM_API_PORT__|${MIM_API_PORT}|g" \
    -e "s|__MIM_TLS_CONF__|${TLS_CONF}|g" \
    "$APP_DIR/deploy/nginx-mim.conf" > /etc/nginx/sites-available/mim.conf
ln -sf /etc/nginx/sites-available/mim.conf /etc/nginx/sites-enabled/mim.conf
# default_server 归属：80/443 由同机既有站点（MixmAPP）持有，共存模式不得删除其 default 站点
if [ "$MIM_NGINX_TAKE_DEFAULT" = "1" ]; then
  rm -f /etc/nginx/sites-enabled/default
  log "已停用 default 站点（独占机器模式）"
else
  log "保留 /etc/nginx/sites-enabled/default（同机共存）"
fi
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
# 同机共存（MIM_TLS_CERTBOT=0，默认）下 80 端口归 MixmAPP，HTTP-01 与 --webroot 都无法由
# 本机独立完成（webroot 需改 MixmAPP 的 nginx，跨站耦合且易被其重载覆盖），因此这里不签证书。
# 证书结论：用 DNS-01（DNSPod API 或手动 TXT）为 zy.laal.top / *.laal.top 签发，落位到
# /etc/letsencrypt/live/${DOMAIN}/ 后重跑 deploy.sh，TLS 片段会自动挂到 443。
if [ "$MIM_TLS_CERTBOT" != "1" ]; then
  warn "同机共存模式：跳过证书签发（结论见上，DNS-01 签发后重跑 deploy.sh 即可启用 ${MIM_WEB_HTTPS_PORT}）"
elif [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  # 只申请已解析到本机的域名：www 子域若未建 A 记录，一并申请会让整张证书失败（NXDOMAIN）
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

log "引导完成 → https://${DOMAIN}:${MIM_WEB_HTTPS_PORT}（HTTP :${MIM_WEB_HTTP_PORT}）"
