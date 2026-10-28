#!/usr/bin/env bash
# ==============================================================================
# Mim —— 宿主机一键部署脚本（无 Docker）
#
# 覆盖完整链路：系统依赖安装 → 前端构建 → 后端依赖安装 → 数据库初始化 → 迁移
#             → systemd 进程守护（开机自启 + 崩溃重启）→ nginx 静态资源与反向代理
#             → 日志轮转 → 健康检查
#
# 用法：
#   sudo MIM_DIR=/opt/mim DOMAIN=example.com ./deploy/install.sh
#
# 可选环境变量：
#   MIM_DIR        安装目录（默认 /opt/mim）
#   DOMAIN         写入 nginx 配置的域名（默认 _，即兜底站点）
#   SKIP_PKGS=1    跳过系统包安装（宿主机已装好 node/postgresql/nginx 时使用）
#   SKIP_BUILD=1   跳过前端构建（只想重启后端时用）
#
# 设计约束：
#   1. 幂等 —— 重复执行安全，不会删除已有数据或数据库
#   2. 不使用容器 —— PostgreSQL / nginx / node 全部是宿主机原生进程
#   3. 失败即停（set -euo pipefail），每一步都打印明确提示
# ==============================================================================
set -euo pipefail

MIM_DIR="${MIM_DIR:-/opt/mim}"
DOMAIN="${DOMAIN:-_}"
SKIP_PKGS="${SKIP_PKGS:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="mim"
PORT="${PORT:-8787}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. 前置检查 ----------
log "1/10 前置检查"
[ "$(id -u)" -eq 0 ] || die "请以 root 或 sudo 执行：sudo ./deploy/install.sh"
command -v node >/dev/null 2>&1 || die "未找到 node。请先安装 Node.js >= 20（见 docs/deploy 部署运维手册）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 版本过低（当前 $NODE_MAJOR），本项目要求 >= 20"

# ---------- 2. 系统依赖（宿主机原生，不用容器） ----------
log "2/10 系统依赖：PostgreSQL / nginx"
if [ "$SKIP_PKGS" = "1" ]; then
  warn "SKIP_PKGS=1，跳过系统包安装"
else
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    command -v psql      >/dev/null 2>&1 || apt-get install -y postgresql
    command -v nginx     >/dev/null 2>&1 || apt-get install -y nginx
    command -v rsync     >/dev/null 2>&1 || apt-get install -y rsync
  elif command -v dnf >/dev/null 2>&1; then
    command -v psql  >/dev/null 2>&1 || { dnf install -y postgresql-server && postgresql-setup --initdb; }
    command -v nginx >/dev/null 2>&1 || dnf install -y nginx
    command -v rsync >/dev/null 2>&1 || dnf install -y rsync
  else
    warn "未识别的包管理器，请手动安装 postgresql / nginx / rsync 后重跑（或加 SKIP_PKGS=1）"
  fi
fi
systemctl enable --now postgresql 2>/dev/null || warn "无法 systemctl 启动 postgresql（可能非 systemd 环境），请手动启动数据库"

# ---------- 3. 部署源码到安装目录 ----------
log "3/10 同步源码 → $MIM_DIR"
mkdir -p "$MIM_DIR"
if command -v rsync >/dev/null 2>&1; then
  # 不用 --delete：保留安装目录里已有的数据与配置文件
  # 排除开发环境的配置与上传数据（模式锚定 SRC_DIR 根）：开发机的 server/.env（开发口令）
  # 与 server/data/uploads 不能进生产。.env.example 不排除——install.sh 靠它生成模板
  rsync -a \
    --exclude node_modules --exclude dist --exclude .git \
    --exclude '/.env' --exclude '/server/.env' --exclude '/server/data/' \
    "$SRC_DIR"/ "$MIM_DIR"/
else
  warn "没有 rsync，改用 cp（会覆盖同名文件，但不会删除目标目录里的其他文件）"
  warn "cp 无法排除开发配置：若 SRC_DIR 内含 /.env 或 /server/.env 或 /server/data/，请改用 rsync 路径执行"
  cp -a "$SRC_DIR"/. "$MIM_DIR"/
fi
# 不清理目标目录已有内容：重复部署时保留数据与已有 node_modules，避免误删

# ---------- 4. 运行账号 ----------
log "4/10 运行账号：$APP_USER"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$MIM_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# ---------- 5. 环境变量配置文件 ----------
log "5/10 生成配置文件 $MIM_DIR/server/.env"
ENV_FILE="$MIM_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$MIM_DIR/server/.env.example" "$ENV_FILE"
  # 用 node 生成随机串，避免依赖 openssl 是否存在，
  # 也避免 `tr … | head -c` 这类管道在 set -o pipefail 下因 SIGPIPE 让脚本中断
  DB_PASS="$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"
  JWT="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  # 库名与账号保持默认，口令随机生成后写回 .env
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://mim:${DB_PASS}@127.0.0.1:5432/mim#" "$ENV_FILE"
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=${JWT}#" "$ENV_FILE"
  sed -i "s#^PORT=.*#PORT=${PORT}#" "$ENV_FILE"
  # 生产只监听回环，由 nginx 对外：把模板里注释掉的 HOST 打开（后端 main.js 支持该变量）
  sed -i 's/^# *HOST=/HOST=/' "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  export PGUSER=mim PGPASSWORD="$DB_PASS" PGDATABASE=mim
else
  warn ".env 已存在，保持不变（不会覆盖你的配置）"
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
chown root:root "$ENV_FILE"; chmod 600 "$ENV_FILE"

# ---------- 6. 数据库初始化 ----------
log "6/10 初始化数据库（宿主机 PostgreSQL）"
if [ -n "${DATABASE_URL:-}" ]; then
  # 从 .env 解析账号/库名/口令交给 init-db.sh
  _rest="${DATABASE_URL#postgres://}"
  _cred="${_rest%@*}"; _tail="${_rest##*@}"
  export PGUSER="${_cred%%:*}"
  export PGPASSWORD="${_cred#*:}"
  export PGDATABASE="${_tail#*/}"
fi
bash "$MIM_DIR/deploy/init-db.sh"

# ---------- 7. 安装依赖与构建 ----------
log "7/10 安装依赖"
cd "$MIM_DIR"
npm install --no-audit --no-fund
npm --prefix server install --omit=dev --no-audit --no-fund

if [ "$SKIP_BUILD" = "1" ]; then
  warn "SKIP_BUILD=1，跳过前端构建（dist 不会被更新）"
else
  log "构建前端静态资源 → $MIM_DIR/dist"
  # 不在这里写死 VITE_MIM_API_BASE：未设置时前端会回退同源 /api（正是 nginx 反代的场景），
  # 而运维若需要覆盖（如跨域直连或纯本地 off），可以自己 export 后再跑本脚本。
  npm run build
fi

# 上传目录属主给运行账号。注意 systemd 单元里 ProtectSystem=full 会把磁盘变为只读，
# 只有 ReadWritePaths 指向的这一个目录可写，必须是它在内的上传根目录。
mkdir -p "$MIM_DIR/server/data/uploads"
chown -R "$APP_USER":"$APP_USER" "$MIM_DIR/server/data"

# ---------- 8. 应用迁移 ----------
log "8/10 应用数据库迁移（幂等，可重复执行）"
cd "$MIM_DIR/server"
if [ -f .env ]; then
  set -a; . ./.env; set +a
else
  die "缺少 $MIM_DIR/server/.env，无法执行迁移"
fi
npm run migrate

# ---------- 9. systemd 守护 + nginx + 日志轮转 ----------
log "9/10 安装 systemd 单元 / nginx 站点 / 日志轮转"
sed -e "s#^WorkingDirectory=.*#WorkingDirectory=$MIM_DIR/server#" \
    -e "s#^EnvironmentFile=.*#EnvironmentFile=$MIM_DIR/server/.env#" \
    -e "s#^ReadWritePaths=.*#ReadWritePaths=$MIM_DIR/server/data#" \
    "$MIM_DIR/deploy/mim-server.service" > /etc/systemd/system/mim-server.service

sed -e "s#^ *root /opt/mim/dist;#    root $MIM_DIR/dist;#" \
    -e "s#^ *server_name _;#    server_name $DOMAIN;#" \
    -e "s#http://127.0.0.1:8787;#http://127.0.0.1:$PORT;#" \
    "$MIM_DIR/deploy/nginx-mim.conf" > /etc/nginx/sites-available/mim
mkdir -p /etc/nginx/sites-enabled
ln -sf /etc/nginx/sites-available/mim /etc/nginx/sites-enabled/mim
cp "$MIM_DIR/deploy/logrotate-mim.conf" /etc/logrotate.d/mim

systemctl daemon-reload
systemctl enable mim-server          # 开机自启
systemctl restart mim-server         # 崩溃重启策略由单元文件 Restart=always 提供

if command -v nginx >/dev/null 2>&1; then
  # Debian 系自带的默认站点也监听 80 且 server_name 为 _，会与本站冲突
  # （nginx -t 会报 conflicting server name）。这里只提示、不擅自删除发行版默认配置。
  if [ -e /etc/nginx/sites-enabled/default ]; then
    warn "检测到发行版默认站点 /etc/nginx/sites-enabled/default 仍在，可能与本站抢占 80 端口。"
    warn "确认无其他站点在用后执行：sudo rm /etc/nginx/sites-enabled/default && sudo systemctl reload nginx"
  fi
  nginx -t && systemctl enable --now nginx
else
  warn "未安装 nginx，跳过站点启用；前端 dist 可直接由任意静态服务器承载"
fi

# ---------- 10. 健康检查 ----------
log "10/10 健康检查"
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" ; then
  printf '\n'
else
  warn "健康检查未通过，看日志：sudo journalctl -u mim-server -n 100 --no-pager"
fi

cat <<EOF

------------------------------------------------------------------------------
部署完成

  安装目录   $MIM_DIR
  静态资源   $MIM_DIR/dist            （由 nginx 直出）
  后端       127.0.0.1:$PORT           （nginx /api/ 反代）
  配置文件   $MIM_DIR/server/.env
  数据库     宿主机 PostgreSQL:5432/$PGDATABASE

常用运维命令：
  sudo systemctl status  mim-server
  sudo journalctl -u mim-server -f
  sudo systemctl restart mim-server          # 改完 .env 后执行
  sudo systemctl disable --now mim-server    # 停服并取消开机自启

日志体积控制：
  sudo journalctl --vacuum-size=500M
------------------------------------------------------------------------------
EOF
