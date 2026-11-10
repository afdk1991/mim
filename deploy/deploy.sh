#!/usr/bin/env bash
# deploy/deploy.sh — Mim 生产发布脚本（服务器侧，幂等可重放）
#
# 职责：拉取 origin/main → 安装依赖（含 dev，因 vite/esbuild 为构建期依赖）
#       → 构建前端（apps/web,vite）与管理后台（apps/admin,vite）
#       → 编译后端（esbuild → dist/index.js，并搬运 dist/schema.sql）
#       → 发布静态产物到 /opt/mim/web、管理后台到 /opt/mim/admin
#       → 幂等生成 /opt/mim/mim-api.env（MIM_JWT_SECRET / MIM_CORS_ORIGINS /
#         MIM_AUTH_ADMIN_PASSWORD / MIM_ADMIN_TOKEN / 可选验证码通道密钥）
#       → 执行 deploy/migrations/*.cjs（先备份、幂等可重放）→ 重启后端
#       → 安装并启用每日备份 timer（§6.5，MIM_ENABLE_BACKUP_TIMER=0 可关闭）→ 健康检查
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
#   ADMIN_DIR   默认 /opt/mim/admin（管理后台静态根，nginx 的 /admin/ 指向此处）
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
ADMIN_DIR="${ADMIN_DIR:-/opt/mim/admin}"
SERVICE="${SERVICE:-mim-api}"
PORT_="${PORT_:-8787}"
REPO_URL="${REPO_URL:-git@github.com:afdk1991/mim.git}"
DEPLOY_KEY="${DEPLOY_KEY:-/opt/mim/.ssh/deploy_key}"
RUN_USER="${RUN_USER:-mim}"
# 站点域名：用于把仓库内 deploy/nginx-mim.conf 的 server_name 替换为实际域名，
# 并驱动 certbot 重新注入 TLS 段（与 bootstrap.sh 的 sed 规则保持一致）。
NGINX_DOMAIN="${NGINX_DOMAIN:-mim.mixm.top}"

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

# --- 3. 前端构建（用户端 + 管理后台）+ 后端编译 ---
# 2026-11-11 修复：生产主机为 2C2G（另有 4G swap），Node 22 默认堆上限按物理内存推导后不足 1G，
# CI 触发远程 build 时 `tsc --noEmit` 直接 OOM（FATAL ERROR: Reached heap limit，exit 134）。
# 这里显式抬高 V8 老生代上限到 1536MB（配合 swap 足够完成 tsc + vite），仅影响本脚本内的构建进程。
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=1536"
log "构建内存参数：NODE_OPTIONS=$NODE_OPTIONS；可用内存 $(free -m | awk '/Mem:/{print $7"MB"}')，swap $(free -m | awk '/Swap:/{print $2"MB"}')"
log "构建 apps/web（tsc --noEmit + vite build）"
pnpm --filter @mim/web build
log "构建 apps/admin（tsc --noEmit + vite build）"
pnpm --filter @mim/admin build
log "编译 services/mim-api（esbuild → dist/index.js）"
pnpm --filter @mim/api build

# db.ts 以 new URL('./schema.sql', import.meta.url) 读取建表脚本；build.mjs 已负责搬运，
# 此处再加一道兜底：生产 git clean 带 -e dist，旧产物目录可能残留历史版本，
# 若缺该文件则宿主直部署启动即 ENOENT 崩溃（Dockerfile 链路另已有显式 COPY）。
SCHEMA_SRC="$APP_DIR/services/mim-api/src/schema.sql"
SCHEMA_DST="$APP_DIR/services/mim-api/dist/schema.sql"
if [ -f "$SCHEMA_DST" ]; then
  log "dist/schema.sql 已随构建产物落地"
else
  [ -f "$SCHEMA_SRC" ] || die "缺少 $SCHEMA_SRC，无法补齐 dist/schema.sql"
  cp "$SCHEMA_SRC" "$SCHEMA_DST"
  log "已补齐 $SCHEMA_DST（构建产物搬运兜底）"
fi

# --- 4. 发布静态产物 ---
log "发布用户端静态产物 → $WEB_DIR"
mkdir -p "$WEB_DIR"
rm -rf "$WEB_DIR"/*
cp -R "$APP_DIR/apps/web/dist/." "$WEB_DIR/"

# 管理后台：独立静态根 /opt/mim/admin，由 nginx 的 /admin/ location 提供。
# 与用户端隔离的理由：① 若混入同一 root，admin/index.html 会覆盖用户端入口；
# ② 用户端 `location /` 的 SPA 回退会把 /admin/* 吞成用户端 index.html。
log "发布管理后台静态产物 → $ADMIN_DIR"
mkdir -p "$ADMIN_DIR"
rm -rf "$ADMIN_DIR"/*
cp -R "$APP_DIR/apps/admin/dist/." "$ADMIN_DIR/"

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

# 跨域白名单：托管平台（GitHub Pages / Cloudflare / Vercel 等）以独立域名直连本 API 所必需。
# 幂等补齐：文件已含该变量则保留运维自定义值，绝不覆盖；MIM_CORS_ORIGINS 环境变量可覆盖默认列表。
CORS_DEFAULT="${MIM_CORS_ORIGINS:-https://afdk1991.github.io,https://mim.mixm.top,https://data.mixm.top}"
if grep -q '^MIM_CORS_ORIGINS=' "$MIM_ENV_FILE"; then
  log "$MIM_ENV_FILE 已含 MIM_CORS_ORIGINS，保留现有值"
else
  log "补齐 $MIM_ENV_FILE（MIM_CORS_ORIGINS=$CORS_DEFAULT）"
  printf 'MIM_CORS_ORIGINS=%s\n' "$CORS_DEFAULT" >> "$MIM_ENV_FILE"
fi

# 管理员密码登录口令：生产短信/邮件通道未接入时，POST /api/v1/auth/password 是唯一可用登录入口。
# 安全修复（2026-11-07）：禁止再写入仓库内可查的固定默认口令（原字面值已从全仓移除）。
# 幂等优先级：① CI/运维透传同名变量非空 → 采用（覆盖现有值，支持口令轮换）；
# ② env 文件已有值 → 保留；③ 两者皆无 → 现场生成随机口令写入 chmod 600 的 env 文件，且绝不回显到 CI 公开日志。
if [ -n "${MIM_AUTH_ADMIN_PASSWORD:-}" ]; then
  # CI Secret 透传路径：值来自 GitHub Actions secret，覆盖现有值以支持口令轮换
  if grep -q '^MIM_AUTH_ADMIN_PASSWORD=' "$MIM_ENV_FILE"; then
    sed -i "s|^MIM_AUTH_ADMIN_PASSWORD=.*|MIM_AUTH_ADMIN_PASSWORD=${MIM_AUTH_ADMIN_PASSWORD}|" "$MIM_ENV_FILE"
    log "更新 $MIM_ENV_FILE（MIM_AUTH_ADMIN_PASSWORD 来自 CI Secret，值不回显）"
  else
    printf 'MIM_AUTH_ADMIN_PASSWORD=%s\n' "$MIM_AUTH_ADMIN_PASSWORD" >> "$MIM_ENV_FILE"
    log "补齐 $MIM_ENV_FILE（MIM_AUTH_ADMIN_PASSWORD 来自 CI Secret，值不回显）"
  fi
elif grep -q '^MIM_AUTH_ADMIN_PASSWORD=' "$MIM_ENV_FILE"; then
  log "$MIM_ENV_FILE 已含 MIM_AUTH_ADMIN_PASSWORD，保留现有值"
else
  # 兜底路径：base64 随机串去掉 /+= 特殊字符，避免 env 解析与 sed 替换歧义
  AUTH_PASSWORD_GENERATED="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-24)"
  printf 'MIM_AUTH_ADMIN_PASSWORD=%s\n' "$AUTH_PASSWORD_GENERATED" >> "$MIM_ENV_FILE"
  log "补齐 $MIM_ENV_FILE（MIM_AUTH_ADMIN_PASSWORD 为现场随机值，请从该文件读取，日志不回显）"
fi

# 超管引导令牌（RBAC bootstrap）：/api/v1/admin/* 与 catalog 管理写路由的双通道鉴权之一。
# 缺失时这些端点会返回 403 FEATURE_NOT_AVAILABLE 'admin API is not enabled'，
# 导致独立后台 /admin/ 只能打开静态页却无法完成任何写操作。
# 幂等规则与上面一致：文件已含该变量则保留运维自定义值，绝不覆盖；
# 仅当本次由 CI 透传了非空 MIM_ADMIN_TOKEN 且文件缺失该变量时才写入。
if grep -q '^MIM_ADMIN_TOKEN=' "$MIM_ENV_FILE"; then
  log "$MIM_ENV_FILE 已含 MIM_ADMIN_TOKEN，保留现有值"
elif [ -n "${MIM_ADMIN_TOKEN:-}" ]; then
  log "补齐 $MIM_ENV_FILE（MIM_ADMIN_TOKEN 来自 CI Secret）"
  printf 'MIM_ADMIN_TOKEN=%s\n' "$MIM_ADMIN_TOKEN" >> "$MIM_ENV_FILE"
else
  warn "跳过 MIM_ADMIN_TOKEN（CI Secret 未配置）：管理写路由将返回 403 FEATURE_NOT_AVAILABLE"
fi

# 验证码通道（阿里云短信 / AWS SES）：deploy.yml 通过 sudo env 透传 CI Secret。
# 幂等规则：已有非空值 → 保留；已有空占位且本次传来非空值 → 回填；缺失 → 写入（可能为空占位，
# 生产保持 503 AUTH_CHANNEL_NOT_CONFIGURED，与代码优雅降级语义一致）。
for VAR in MIM_SMS_ALIYUN_ACCESS_KEY_ID MIM_SMS_ALIYUN_ACCESS_KEY_SECRET MIM_SMS_ALIYUN_SIGN_NAME MIM_SMS_ALIYUN_TEMPLATE_CODE \
           MIM_EMAIL_SES_ACCESS_KEY_ID MIM_EMAIL_SES_SECRET_ACCESS_KEY MIM_EMAIL_SES_REGION MIM_EMAIL_SES_FROM_ADDRESS; do
  VALUE="$(eval "printf '%s' \"\${$VAR:-}\"")"
  if grep -q "^${VAR}=" "$MIM_ENV_FILE"; then
    CURRENT="$(grep "^${VAR}=" "$MIM_ENV_FILE" | head -n1 | cut -d= -f2-)"
    if [ -n "$VALUE" ] && [ -z "$CURRENT" ]; then
      sed -i "s|^${VAR}=.*|${VAR}=${VALUE}|" "$MIM_ENV_FILE"
      log "回填 $MIM_ENV_FILE（${VAR} 空占位 → CI Secret）"
    else
      log "$MIM_ENV_FILE 已含 ${VAR}，保留现有值"
    fi
  else
    printf '%s=%s\n' "$VAR" "$VALUE" >> "$MIM_ENV_FILE"
    log "补齐 $MIM_ENV_FILE（${VAR}，$([ -n "$VALUE" ] && echo '来自 CI Secret' || echo '空占位')）"
  fi
done

if id -u "$RUN_USER" >/dev/null 2>&1; then
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$WEB_DIR" "$ADMIN_DIR" 2>/dev/null || true
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

# --- 6.5 每日数据库备份 timer（幂等安装；MIM_ENABLE_BACKUP_TIMER=0 可显式关闭） ---
# 修复（2026-11-07）：backup-db.sh 虽已入库，但只写了「建议 cron」注释、从未被任何调度引用，
# 备份链路等于不存在；这里把 service + timer 作为部署工件安装并 enable --now。
# 备份脚本已改为复用项目自带 better-sqlite3，不再要求服务器安装 sqlite3 CLI。
if [ "${MIM_ENABLE_BACKUP_TIMER:-1}" = "0" ]; then
  log "MIM_ENABLE_BACKUP_TIMER=0，跳过备份 timer 安装"
elif command -v systemctl >/dev/null 2>&1; then
  # 先安装单元文件再 reload，保证每次部署都同步仓库内最新定义
  cp "$APP_DIR/deploy/mim-backup.service" /etc/systemd/system/mim-backup.service
  cp "$APP_DIR/deploy/mim-backup.timer" /etc/systemd/system/mim-backup.timer
  systemctl daemon-reload
  # timer 属辅助能力，启用失败只告警、不阻断主服务发布（set -e 下必须显式兜住）
  if systemctl enable --now mim-backup.timer >/dev/null 2>&1; then
    log "已启用 mim-backup.timer（每日 03:00，随机延迟 ≤5 分钟）"
  else
    warn "mim-backup.timer 启用失败，请检查 systemd；主服务发布不受影响"
  fi
else
  warn "缺少 systemctl，跳过备份 timer 安装（非 systemd 主机）"
fi

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

# --- 8. nginx 配置安装与热加载 ---
# 根因修复（2026-11-07）：此前本脚本只执行 `nginx -t && reload`，从不把仓库内的
# deploy/nginx-mim.conf 安装到 /etc/nginx/sites-available/，导致仓库里新增的
# `/admin/`、`/admin/assets/`、`location = /admin` 三个 block 从未生效——生产
# `/admin/` 被 `location /` 的 SPA 回退吞成用户端 index.html（实测 `/admin`
# 无斜杠返回 200 而非配置应有的 301，即为「服务器配置不是仓库版本」的铁证）。
# 关键约束：bootstrap.sh 的 `certbot --nginx` 会把 TLS 段写进同一文件，
# 故同步时必须保留 443/证书段，不得裸覆盖——做法是先装 HTTP 配置，再由 certbot
# 以 --keep-until-expiring 重新注入 TLS（不重复签发证书）。
if command -v nginx >/dev/null 2>&1; then
  NGINX_AVAILABLE="/etc/nginx/sites-available/mim.conf"
  NGINX_ENABLED="/etc/nginx/sites-enabled/mim.conf"
  NGINX_BACKUP="${NGINX_AVAILABLE}.bak.$$"

  # 有旧配置先备份：任何一步失败都用它一键回滚，保证线上 HTTPS 不中断
  if [ -f "$NGINX_AVAILABLE" ]; then
    cp -p "$NGINX_AVAILABLE" "$NGINX_BACKUP"
    log "已备份现有 nginx 配置 → $NGINX_BACKUP"
  fi

  # 回滚函数：恢复备份与软链并 reload；无备份时只告警
  nginx_rollback() {
    if [ -f "$NGINX_BACKUP" ]; then
      cp -p "$NGINX_BACKUP" "$NGINX_AVAILABLE"
      ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
      warn "已回滚 nginx 配置至部署前版本"
    else
      warn "无 nginx 配置备份，跳过回滚"
    fi
  }

  log "安装 nginx 站点配置 → $NGINX_AVAILABLE（server_name $NGINX_DOMAIN）"
  # 与 bootstrap.sh 同一 sed 规则：把仓库里的默认域名替换为实际域名
  sed "s/server_name mim.mixm.top;/server_name ${NGINX_DOMAIN} www.${NGINX_DOMAIN};/" \
    "$APP_DIR/deploy/nginx-mim.conf" > "$NGINX_AVAILABLE"
  chmod 644 "$NGINX_AVAILABLE"

  # 先校验纯 HTTP 配置语法，语法错误立即回滚（此时尚未动 TLS，风险最低）
  if ! nginx -t; then
    nginx_rollback
    die "nginx 配置语法校验失败，已回滚"
  fi

  # 重新注入 TLS：证书已存在时 certbot 仅改写配置而不重新签发
  if [ -d "/etc/letsencrypt/live/${NGINX_DOMAIN}" ] && command -v certbot >/dev/null 2>&1; then
    log "certbot 注入 HTTPS（已有证书，--keep-until-expiring）"
    if ! certbot --nginx -d "$NGINX_DOMAIN" --redirect --non-interactive \
        --keep-until-expiring --agree-tos -m "admin@${NGINX_DOMAIN}"; then
      nginx_rollback
      die "certbot 配置 HTTPS 失败，已回滚（线上 HTTPS 保持可用）"
    fi
    # certbot 改写后的配置必须再次校验
    if ! nginx -t; then
      nginx_rollback
      die "certbot 改写后 nginx 校验失败，已回滚"
    fi
  else
    warn "未找到 ${NGINX_DOMAIN} 证书或 certbot，跳过 HTTPS 注入（仅 HTTP 生效）"
  fi

  # 启用站点并停用默认站点，然后热加载
  ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  rm -f /etc/nginx/sites-enabled/default
  log "nginx -t && reload"
  nginx -t || { nginx_rollback; die "启用站点后 nginx 校验失败，已回滚"; }
  systemctl reload nginx || systemctl restart nginx

  # 断言 /admin/ 真实返回管理后台页面：以响应体含 noindex 为准。
  # 不可用 `curl http://127.0.0.1/admin` 的 301 作为判据：certbot --redirect 会新增一个
  # 80 端口 server 块，把任何 HTTP 请求都 301 到 HTTPS，该结果无法区分
  # 「location = /admin 生效」与「整站强制 HTTPS」，属假阳性。
  # 故用 --resolve 把域名指回本机 443 直取 HTTPS 内容（-k 忽略本机回环证书名差异）。
  ADMIN_BODY="$(curl -k -s --max-time 5 --resolve "${NGINX_DOMAIN}:443:127.0.0.1" \
    "https://${NGINX_DOMAIN}/admin/" || true)"
  if printf '%s' "$ADMIN_BODY" | grep -q 'noindex'; then
    log "/admin/ 返回管理后台页面（noindex 命中），nginx 站点配置已生效"
  else
    warn "/admin/ 未命中 noindex（可能仍落回用户端页面），请检查 nginx 配置安装"
  fi

  # 成功后清理备份，避免残留
  rm -f "$NGINX_BACKUP"
fi

log "部署完成：$(git -C "$APP_DIR" rev-parse --short HEAD) $(date -u +%FT%TZ)"
curl -fsS "http://127.0.0.1:$PORT_/health" && echo
