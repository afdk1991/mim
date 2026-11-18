#!/usr/bin/env bash
# deploy/deploy.sh — Mim 生产发布脚本（服务器侧，幂等可重放）
#
# 职责：拉取 origin/main → 安装依赖（含 dev，因 vite/esbuild 为构建期依赖）
#       → 构建前端（apps/web,vite）与管理后台（apps/admin,vite）
#       → 编译后端（esbuild → dist/index.js，并搬运 dist/schema.sql）
#       → 发布静态产物到 /opt/mim/web、管理后台到 /opt/mim/admin
#       → 幂等生成 /opt/mim/mim-api.env（MIM_JWT_SECRET / MIM_CORS_ORIGINS /
#         MIM_ADMIN_TOKEN / 可选验证码通道密钥）
#       → 执行 deploy/migrations/*.cjs（幂等可重放）→ 重启后端
#       → 确保备份 timer 不存在（§6.5；项目策略：不保留任何数据库备份）→ 健康检查
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
#   HELP_DIR    默认 /opt/mim/help（文档站静态根，nginx 的 help.<域名> 指向此处）
#   SERVICE     默认 mim-api
#   DATA_DIR    默认 /var/lib/mim（SQLite 库落盘处，必须在 APP_DIR 之外且本脚本永不清空）
#   MIM_DEPLOY_STOP_AFTER  仅演练用：data / sync 阶段完成后提前退出，生产勿设
#   MIM_API_PORT 后端回环端口（API + WS 共用），默认 8787；旧变量 PORT_ 仍兼容
#   MIM_WEB_HTTP_PORT   前端 HTTP 端口，默认 8088（同机 MixmAPP 占用 80/443）
#   MIM_WEB_HTTPS_PORT  前端 HTTPS 端口，默认 443（与 MixmAPP 共享监听，不抢 default_server）
#   MIM_TLS_CERTBOT     1=沿用 certbot --nginx 独占 80/443 的老路径；0（默认）=同机共存，
#                       证书用 DNS-01 另行签发后由本脚本只引用既有 pem，不申请、不改 80 端口
#   MIM_NGINX_TAKE_DEFAULT 1=删除 sites-enabled/default 独占机器；0（默认）=不动同机其它站点
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
HELP_DIR="${HELP_DIR:-/opt/mim/help}"
SERVICE="${SERVICE:-mim-api}"
# 数据目录：SQLite 库落盘处，必须独立于 APP_DIR。
# 背景（2026-11-15）：首次部署分支会 rm -rf "$APP_DIR" 再 clone，历史上曾把
# services/mim-api/data/mim.db 一起删掉（当时是空库才没造成损失）。现在库物理落在
# 本目录，APP 侧只保留一个符号链接，任何形式的发布清理都碰不到库文件。
DATA_DIR="${DATA_DIR:-/var/lib/mim}"
# 该断言在 die() 定义之前执行，故直接 printf + exit，不依赖函数
case "$DATA_DIR" in
  "$APP_DIR"/*|"$APP_DIR")
    printf '\033[31m[deploy]\033[0m DATA_DIR=%s 位于 APP_DIR=%s 内，会被发布清理误删；请指向 APP_DIR 之外（默认 /var/lib/mim）\n' "$DATA_DIR" "$APP_DIR" >&2
    exit 1
    ;;
esac
# 端口三件套：前端 HTTP / 前端 HTTPS / 后端回环。三者全部可配，nginx 模板与健康检查
# 统一从这三个变量渲染，禁止在配置里再写死 80/443/8787。
MIM_WEB_HTTP_PORT="${MIM_WEB_HTTP_PORT:-8088}"
MIM_WEB_HTTPS_PORT="${MIM_WEB_HTTPS_PORT:-443}"
MIM_API_PORT="${MIM_API_PORT:-${PORT_:-8787}}"
PORT_="$MIM_API_PORT"
# 同机共存默认值：不抢 default_server、不跑 certbot（80 端口归 MixmAPP）
MIM_TLS_CERTBOT="${MIM_TLS_CERTBOT:-0}"
MIM_NGINX_TAKE_DEFAULT="${MIM_NGINX_TAKE_DEFAULT:-0}"
REPO_URL="${REPO_URL:-git@github.com:afdk1991/mim.git}"
DEPLOY_KEY="${DEPLOY_KEY:-/opt/mim/.ssh/deploy_key}"
RUN_USER="${RUN_USER:-mim}"
# 站点域名：用于把仓库内 deploy/nginx-mim.conf 的 server_name 替换为实际域名，
# 并驱动 certbot 重新注入 TLS 段（与 bootstrap.sh 的 sed 规则保持一致）。
NGINX_DOMAIN="${NGINX_DOMAIN:-laal.top}"

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

# --- 0.5 git 可信目录登记 ---
# §5 会把 $APP_DIR chown 给 RUN_USER，本脚本却以 root 运行 git；Git 2.35+ 会对
# 「仓库属主 ≠ 当前用户」直接报 fatal: detected dubious ownership 并拒绝一切操作，
# 表现为发布一开始就失败（fetch / reset / clean 全挂）。写 /etc/gitconfig（--system）
# 让 root 与 workflow 里 `sudo -n git -C ... rev-parse HEAD` 校验步骤都能正常执行。
if ! git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$APP_DIR"; then
  git config --system --add safe.directory "$APP_DIR"
  log "已登记 git safe.directory: $APP_DIR"
fi

# --- 1.5 数据安全区（建库目录 / 迁移历史真实目录；全程不删数据、不生成备份） ---
# 顺序刻意放在代码同步之前：任何 git 操作之前先确保库不落在会被清理的位置。
# 本段对 $DATA_DIR 只做「创建 / 搬入 / 改属主」，任何分支都不删除它。
# 项目策略（2026-11-15 明确）：不保留任何数据库备份，本脚本不生成备份文件。
DATA_LINK="$APP_DIR/services/mim-api/data"
DB_FILE="$DATA_DIR/mim.db"

mkdir -p "$DATA_DIR" "$(dirname "$DATA_LINK")"
chmod 750 "$DATA_DIR"

# ① 历史部署留下的真实 data 目录（非符号链接）：库文件搬入 $DATA_DIR，原目录改名留档。
#    只用 mv（同文件系统内原子），不 rm；目标已存在则停下人工比对，绝不覆盖。
if [ -L "$DATA_LINK" ]; then
  LINK_TARGET="$(readlink -f "$DATA_LINK")"
  if [ "$LINK_TARGET" != "$(readlink -f "$DATA_DIR")" ]; then
    die "$DATA_LINK 已指向 $LINK_TARGET（期望 $DATA_DIR），拒绝继续，请人工确认"
  fi
elif [ -e "$DATA_LINK" ]; then
  LEGACY_DIR="${DATA_LINK}.legacy.$(date '+%Y%m%d-%H%M%S')"
  log "数据目录迁移：$DATA_LINK → $DATA_DIR（原目录留档 $(basename "$LEGACY_DIR")）"
  for f in mim.db mim.db-wal mim.db-shm; do
    if [ -e "$DATA_LINK/$f" ]; then
      if [ -e "$DATA_DIR/$f" ]; then
        die "$DATA_DIR/$f 已存在，拒绝覆盖，请人工比对后迁移"
      fi
      mv "$DATA_LINK/$f" "$DATA_DIR/$f"
    fi
  done
  mv "$DATA_LINK" "$LEGACY_DIR"
fi
if [ ! -L "$DATA_LINK" ]; then
  ln -s "$DATA_DIR" "$DATA_LINK"
fi
if id -u "$RUN_USER" >/dev/null 2>&1; then
  chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR" 2>/dev/null || true
fi

# ② 不生成任何备份（项目策略，用户明确要求）：部署失败时回退靠 git 回退代码后重跑，
#    数据文件本身在任何分支都不会被本脚本删除或复制。

# ③ 演练早退开关（仅测试用）：生产部署不要设置该变量。
if [ "${MIM_DEPLOY_STOP_AFTER:-}" = "data" ]; then
  log "MIM_DEPLOY_STOP_AFTER=data，数据阶段完成即退出（演练模式）"
  exit 0
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
  # 绝不 `rm -rf "$APP_DIR"`：2026-11-15 这里真删过一次 mim.db（靠进程句柄才捞回来）。
  # 现在改为「原地初始化」——只清理可再生的构建产物（dist / node_modules），
  # data/、.mim-dev-secret 与其它运维文件一律保留，后续 fetch + reset 覆盖代码即可。
  log "首次部署或目录不是 git 仓库：原地初始化（不清空目录）"
  mkdir -p "$(dirname "$APP_DIR")" "$APP_DIR"
  if [ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]; then
    log "目录非空，仅清理可再生构建产物（dist / node_modules），保留数据目录与其它文件"
    rm -rf "$APP_DIR"/node_modules \
           "$APP_DIR"/apps/*/node_modules "$APP_DIR"/apps/*/dist \
           "$APP_DIR"/services/*/node_modules "$APP_DIR"/services/*/dist
  fi
  if ! git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$APP_DIR" init --quiet
  fi
  git -C "$APP_DIR" remote add origin "$REPO_URL" 2>/dev/null \
    || git -C "$APP_DIR" remote set-url origin "$REPO_URL"
fi

log "拉取 origin/main"
git -C "$APP_DIR" remote set-url origin "$REPO_URL"
ok=0
for attempt in 1 2 3; do
  if git -C "$APP_DIR" fetch --prune origin main; then ok=1; break; fi
  warn "git fetch 第 $attempt 次失败，5s 后重试"
  sleep 5
done
[ "$ok" -eq 1 ] || die "git fetch 连续 3 次失败，请检查服务器到 github.com:22 的连通性"

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
# 只清理可再生的构建产物：用显式 pathspec 限定 dist，绝不对整个目录做 clean -fd。
# 2026-11-15 演练实测：不带 pathspec 时 KEEP_ME.txt、services/mim-api/data.legacy.*
# 这类运维文件会被当成 untracked 一起删掉；而 node_modules 保留可避免每次全量重装。
git -C "$APP_DIR" clean -fdx -- 'apps/*/dist' 'services/*/dist' || true

# 演练早退开关（仅测试用）：MIM_DEPLOY_STOP_AFTER=sync 在代码同步后退出，
# 用于验证「非 git 目录原地初始化」不会清掉数据与运维文件；生产部署不要设置。
if [ "${MIM_DEPLOY_STOP_AFTER:-}" = "sync" ]; then
  log "MIM_DEPLOY_STOP_AFTER=sync，代码同步完成即退出（演练模式）"
  exit 0
fi

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
# 发版瞬间旧 hash 资源 404：历史实现是「先 rm -rf 整个静态根，再整目录复制」，
# 已在浏览器里打开的页面在懒加载路由 chunk / 图片时，旧 hash 文件已经被删除 → 404。
# 现在改为增量覆盖 + 版本清单保留：新产物先就位，再按「最近 N 个版本」求并集清理，
# 保证上一版页面在新版发布后仍能加载它引用的资源。
# 清单落在静态根之外（默认 /opt/mim/.releases），避免被 nginx 当静态文件直接下载。
RELEASE_STATE_DIR="${RELEASE_STATE_DIR:-/opt/mim/.releases}"
WEB_KEEP_RELEASES="${WEB_KEEP_RELEASES:-5}"

# publish_static <源目录> <目标目录> <应用名> <保留版本数>
publish_static() {
  local src="$1" dst="$2" name="$3" keep="$4"
  local hist="$RELEASE_STATE_DIR/$name"
  local list keep_set

  mkdir -p "$dst" "$hist"

  # ① 先复制 hash 资源，再复制其它顶层文件，最后覆盖入口 HTML：
  #    入口一旦更新就会立刻引用新资源，必须确保这些资源已经落地。
  if [ -d "$src/assets" ]; then
    mkdir -p "$dst/assets"
    cp -R "$src/assets/." "$dst/assets/"
  fi
  find "$src" -mindepth 1 -maxdepth 1 ! -name assets ! -name index.html \
    -exec cp -R {} "$dst/" \;
  if [ -f "$src/index.html" ]; then
    cp -f "$src/index.html" "$dst/index.html"
  fi

  # ② 记录本次产物实际包含的 hash 资源清单（以源目录为准，不把目标里的旧文件算进来）
  list="$hist/$(date '+%Y%m%d-%H%M%S')-$$.list"
  if [ -d "$src/assets" ]; then
    (cd "$src/assets" && find . -type f -printf '%P\n' | sort) > "$list"
  else
    : > "$list"
  fi

  # ③ 只保留最近 keep 份清单（keep 至少为 1，0 会让下面把所有资源都删掉）
  case "$keep" in
    ''|*[!0-9]*|0) keep=1 ;;
  esac
  { ls -1t "$hist"/*.list 2>/dev/null || true; } \
    | tail -n +$((keep + 1)) \
    | while IFS= read -r old; do rm -f "$old"; done

  # ④ 最近 keep 份清单的并集 = 必须保留的资源；其余旧 hash 文件可以安全删除
  keep_set="$(mktemp)"
  for f in $({ ls -1t "$hist"/*.list 2>/dev/null || true; } | head -n "$keep"); do
    cat "$f"
  done | sort -u > "$keep_set"
  if [ -d "$dst/assets" ]; then
    (cd "$dst/assets" && find . -type f -printf '%P\n') \
      | while IFS= read -r rel; do
          if ! grep -qxF "$rel" "$keep_set"; then
            rm -f "$dst/assets/$rel"
          fi
        done
    find "$dst/assets" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  fi
  rm -f "$keep_set"

  log "$name 发布完成（hash 资源保留最近 $keep 个版本）"
}

log "发布用户端静态产物 → $WEB_DIR"
publish_static "$APP_DIR/apps/web/dist" "$WEB_DIR" web "$WEB_KEEP_RELEASES"

# 管理后台：独立静态根 /opt/mim/admin，由 nginx 的 /admin/ location 提供。
# 与用户端隔离的理由：① 若混入同一 root，admin/index.html 会覆盖用户端入口；
# ② 用户端 `location /` 的 SPA 回退会把 /admin/* 吞成用户端 index.html。
log "发布管理后台静态产物 → $ADMIN_DIR"
publish_static "$APP_DIR/apps/admin/dist" "$ADMIN_DIR" admin "$WEB_KEEP_RELEASES"

# 文档站：仓库 help/ 是纯静态目录（index.html + content/help.json），没有构建步骤，
# 整目录原样发布到 nginx 的 help.<域名> 静态根，与用户端 / 管理后台产物互不覆盖。
log "发布文档站静态产物 → $HELP_DIR"
mkdir -p "$HELP_DIR"
rm -rf "$HELP_DIR"/*
cp -R "$APP_DIR/help/." "$HELP_DIR/"

# --- 5. JWT 密钥与属主 ---
# 数据目录、APP 侧符号链接与历史目录迁移已在 §1.5 完成（先于任何 git 操作），
# 这里不再重复任何数据目录逻辑，也不再对该目录做删除。
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

# 后端监听端口：systemd 以 EnvironmentFile 注入 PORT（config.ts 读 process.env.PORT，缺省 8787）。
# 与 nginx 反代的 __MIM_API_PORT__ 同源，改 MIM_API_PORT 即全链路一致，不会出现「nginx 反代
# 新端口、后端仍听 8787」的半截状态。端口非机密，直接覆盖为本次解析值。
if grep -q '^PORT=' "$MIM_ENV_FILE"; then
  sed -i "s|^PORT=.*|PORT=${PORT_}|" "$MIM_ENV_FILE"
  log "同步 $MIM_ENV_FILE（PORT=${PORT_}）"
else
  printf 'PORT=%s\n' "$PORT_" >> "$MIM_ENV_FILE"
  log "补齐 $MIM_ENV_FILE（PORT=${PORT_}）"
fi

# 跨域白名单：托管平台（GitHub Pages / Cloudflare / Vercel 等）以独立域名直连本 API 所必需。
# 幂等补齐：文件已含该变量则保留运维自定义值，绝不覆盖；MIM_CORS_ORIGINS 环境变量可覆盖默认列表。
CORS_DEFAULT="${MIM_CORS_ORIGINS:-https://afdk1991.github.io,https://laal.top,https://api.laal.top,https://data.laal.top,https://data.mixm.top}"
if grep -q '^MIM_CORS_ORIGINS=' "$MIM_ENV_FILE"; then
  log "$MIM_ENV_FILE 已含 MIM_CORS_ORIGINS，保留现有值"
else
  log "补齐 $MIM_ENV_FILE（MIM_CORS_ORIGINS=$CORS_DEFAULT）"
  printf 'MIM_CORS_ORIGINS=%s\n' "$CORS_DEFAULT" >> "$MIM_ENV_FILE"
fi

# 端口化后的同源 Origin：HTTPS 端口取默认 443 时浏览器 Origin 不带端口（上面的默认列表已覆盖），
# 只有被仓库变量覆盖成非 443（如历史 8443）才会带端口，此时才需要追加，避免写入永远匹配不上的 :443。
if [ "${MIM_WEB_HTTPS_PORT}" != "443" ]; then
  for PORTED_ORIGIN in "https://laal.top:${MIM_WEB_HTTPS_PORT}" "https://api.laal.top:${MIM_WEB_HTTPS_PORT}"; do
    if grep -q '^MIM_CORS_ORIGINS=' "$MIM_ENV_FILE" && ! grep '^MIM_CORS_ORIGINS=' "$MIM_ENV_FILE" | grep -Fq "$PORTED_ORIGIN"; then
      sed -i "s|^MIM_CORS_ORIGINS=\(.*\)$|MIM_CORS_ORIGINS=\1,${PORTED_ORIGIN}|" "$MIM_ENV_FILE"
      log "追加带端口 Origin 到 MIM_CORS_ORIGINS（$PORTED_ORIGIN）"
    fi
  done
fi

# 2026-11-15 口令收敛：管理员口令只保留账号自身（credentials.kind=password 的 bcrypt 哈希）。
# 曾用的 MIM_AUTH_ADMIN_PASSWORD / MIM_AUTH_ADMIN_IDENTIFIERS 已从代码中移除，
# 这里顺手清理旧 env 文件里的残留，避免「看起来还有两份口令」的误解。
for DEPRECATED_ADMIN_VAR in MIM_AUTH_ADMIN_PASSWORD MIM_AUTH_ADMIN_IDENTIFIERS; do
  if grep -q "^${DEPRECATED_ADMIN_VAR}=" "$MIM_ENV_FILE"; then
    sed -i "/^${DEPRECATED_ADMIN_VAR}=/d" "$MIM_ENV_FILE"
    log "移除 $MIM_ENV_FILE 中已废弃的 ${DEPRECATED_ADMIN_VAR}"
  fi
done

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

# 2026-11-13 增补：本轮适配器变量家族（支付扩展五渠道 / 验证码 / 审核 / Redis / 社区 / 积分 / SSO / 实名）。
# 幂等语义：① 本次 CI 透传非空 → 覆盖 env 文件现有值（支持密钥轮换，与 MIM_AUTH_ADMIN_PASSWORD 的 CI 路径一致）；
# ② 未透传但文件已有值 → 保留运维现值，绝不覆盖；③ 文件缺失该项 → 写入空占位（适配器按缺省降级，不伪造凭证）。
# 全程不回显任何密钥值；重复执行不产生重复行（已存在的变量走替换而非追加）。
ADAPTER_VARS="MIM_HUPIJIAO_APP_ID MIM_HUPIJIAO_APP_KEY MIM_HUPIJIAO_API_BASE MIM_HUPIJIAO_NOTIFY_URL MIM_HUPIJIAO_RETURN_URL
MIM_XUNHU_APP_ID MIM_XUNHU_APP_KEY MIM_XUNHU_API_BASE MIM_XUNHU_NOTIFY_URL MIM_XUNHU_RETURN_URL
MIM_PAYPAL_CLIENT_ID MIM_PAYPAL_CLIENT_SECRET MIM_PAYPAL_WEBHOOK_ID MIM_PAYPAL_MODE MIM_PAYPAL_CURRENCY MIM_PAYPAL_RETURN_URL MIM_PAYPAL_CANCEL_URL MIM_PAYPAL_API_BASE
MIM_STRIPE_SECRET_KEY MIM_STRIPE_WEBHOOK_SECRET MIM_STRIPE_CURRENCY MIM_STRIPE_RETURN_URL MIM_STRIPE_API_BASE
MIM_ALIPAY_ENT_APP_ID MIM_ALIPAY_ENT_PRIVATE_KEY MIM_ALIPAY_ENT_PUBLIC_KEY MIM_ALIPAY_ENT_NOTIFY_URL MIM_ALIPAY_ENT_RETURN_URL MIM_ALIPAY_ENT_GATEWAY MIM_ALIPAY_ENT_SANDBOX
MIM_CAPTCHA_MODE MIM_CAPTCHA_REGISTER MIM_CAPTCHA_LOGIN MIM_CAPTCHA_REPORT MIM_CAPTCHA_POST MIM_CAPTCHA_REQUIRED
MIM_TENCENT_CAPTCHA_APP_ID MIM_TENCENT_CAPTCHA_SECRET_KEY
MIM_GEETEST4_CAPTCHA_ID MIM_GEETEST4_CAPTCHA_KEY
MIM_BAIDU_AUDIT_API_KEY MIM_BAIDU_AUDIT_SECRET_KEY MIM_AUDIT_FALLBACK
MIM_REDIS_URL MIM_REPORT_LIMIT MIM_REPORT_WINDOW_MINUTES
MIM_COMMUNITY_WINDOW_MINUTES MIM_COMMUNITY_WINDOW_MAX MIM_COMMUNITY_DAILY_MAX MIM_COMMUNITY_TOTAL_MAX MIM_COMMUNITY_BOARD_REVIEW MIM_COMMUNITY_RECOMMEND_WEIGHTS MIM_COMMUNITY_BLOCK_WORDS MIM_COMMUNITY_CREATE_MIN_LEVEL MIM_COMMUNITY_CREATE_MAX
MIM_POINTS_DEDUCTION_ENABLED MIM_POINTS_PER_YUAN MIM_POINTS_MAX_RATIO_PERCENT
MIM_SSO_SECRET MIM_SSO_ALLOWED_SITES MIM_REALNAME_PROVIDER MIM_REALNAME_SECRET MIM_REGISTER_INVITE_REQUIRED
MIM_PUBLIC_BASE_URL"
for VAR in $ADAPTER_VARS; do
  VALUE="$(eval "printf '%s' \"\${$VAR:-}\"")"
  if [ -n "$VALUE" ]; then
    if grep -q "^${VAR}=" "$MIM_ENV_FILE"; then
      sed -i "s|^${VAR}=.*|${VAR}=${VALUE}|" "$MIM_ENV_FILE"
      log "更新 $MIM_ENV_FILE（${VAR} 来自 CI Secret，值不回显）"
    else
      printf '%s=%s\n' "$VAR" "$VALUE" >> "$MIM_ENV_FILE"
      log "补齐 $MIM_ENV_FILE（${VAR} 来自 CI Secret）"
    fi
  elif ! grep -q "^${VAR}=" "$MIM_ENV_FILE"; then
    printf '%s=\n' "$VAR" >> "$MIM_ENV_FILE"
    log "补齐 $MIM_ENV_FILE（${VAR} 空占位）"
  fi
done

if id -u "$RUN_USER" >/dev/null 2>&1; then
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$WEB_DIR" "$ADMIN_DIR" 2>/dev/null || true
  chown "$RUN_USER:$RUN_USER" "$MIM_ENV_FILE" 2>/dev/null || true
else
  warn "用户 $RUN_USER 不存在，跳过 chown（请先执行 bootstrap.sh）"
fi

# --- 5.5 数据库迁移（幂等，按文件名顺序执行；首次部署无 DB 时跳过） ---
# 迁移脚本位于 deploy/migrations/*.cjs，均为幂等可重放。**本项目不创建任何数据库备份**：
# 迁移不回滚、不生成备份文件，数据丢失不可恢复，执行前须自行确认影响面。
# 任一迁移失败即中止部署（set -e），避免把半迁移的库暴露给新代码。
# $DB_FILE 已在 §1.5 定义（=$DATA_DIR/mim.db），此处直接复用，避免两处口径漂移。
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
    chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR" 2>/dev/null || true
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

# --- 6.5 备份 timer 清理（项目策略：不保留任何数据库备份） ---
# 2026-11-15 明确：本项目不做数据库备份。这里反向保证 mim-backup.timer /
# mim-backup.service 及其 drop-in 一律不存在（含历史部署装上的旧单元），
# 避免下次部署又把自动备份链路装回去。
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now mim-backup.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/mim-backup.timer \
        /etc/systemd/system/mim-backup.service
  rm -rf /etc/systemd/system/mim-backup.timer.d \
         /etc/systemd/system/mim-backup.service.d
  systemctl daemon-reload >/dev/null 2>&1 || true
  if systemctl list-unit-files 'mim-backup.*' --no-legend 2>/dev/null | grep -q .; then
    warn "mim-backup 单元仍残留，请人工检查 /etc/systemd/system"
  else
    log "已确认无 mim-backup timer / service（项目不保留备份）"
  fi
else
  warn "缺少 systemctl，跳过备份 timer 清理（非 systemd 主机）"
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

  # 有旧配置先备份：任何一步失败都用它一键回滚，保证线上 HTTPS 不中断。
  # 除本次运行用的回滚副本外，再在 /tmp 留一份「现场值」并打印回退命令，
  # 便于配置改错后在部署脚本之外立即人工还原。
  NGINX_SAFETY_BACKUP="/tmp/mim-nginx-pre-$(date '+%Y%m%d-%H%M%S').conf"
  if [ -f "$NGINX_AVAILABLE" ]; then
    cp -p "$NGINX_AVAILABLE" "$NGINX_BACKUP"
    cp -p "$NGINX_AVAILABLE" "$NGINX_SAFETY_BACKUP"
    log "已备份现有 nginx 配置 → $NGINX_BACKUP"
    log "现场配置另存 $NGINX_SAFETY_BACKUP；回退：cp -p $NGINX_SAFETY_BACKUP $NGINX_AVAILABLE && nginx -t && systemctl reload nginx"
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

  # 同机共存下的 TLS 判定：只「引用既有证书」，不申请。证书由运维用 DNS-01 单独签发
  # （80 端口与 MixmAPP 共享且默认站点不归 Mim，HTTP-01 不可靠；--webroot 需要改
  #  MixmAPP 的 nginx，跨站耦合）。
  CERT_DIR="/etc/letsencrypt/live/${NGINX_DOMAIN}"
  TLS_ENABLED=0
  if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
    TLS_ENABLED=1
    # GNU sed 替换右值用 \n 表示换行；片段直接内联，避免额外 include 文件与权限问题
    TLS_CONF="listen ${MIM_WEB_HTTPS_PORT} ssl;\n    listen [::]:${MIM_WEB_HTTPS_PORT} ssl;\n    ssl_certificate ${CERT_DIR}/fullchain.pem;\n    ssl_certificate_key ${CERT_DIR}/privkey.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;\n    ssl_session_cache shared:MimTLS:10m;\n    ssl_session_timeout 10m;"
  else
    TLS_CONF="# TLS 未启用：${CERT_DIR} 缺少 fullchain.pem / privkey.pem（同机共存请用 DNS-01 签发后重跑本脚本）"
  fi

  log "安装 nginx 站点配置 → $NGINX_AVAILABLE（server_name $NGINX_DOMAIN，HTTP ${MIM_WEB_HTTP_PORT} / HTTPS ${MIM_WEB_HTTPS_PORT} / 后端 127.0.0.1:${PORT_}）"
  # 与 bootstrap.sh 同一 sed 规则：域占位 + 端口占位 + TLS 片段三组替换。
  # 必须全量替换域：配置里还有 api / admin / center 等子域 server_name 与 301 跳转目标，
  # 只改主站会让子域仍解析到模板域，切域后子域全断。
  # 端口必须走占位符：同机 MixmAPP 占用 80/443（Mim 在 443 共享监听、不抢 default_server；
  # 80 只按 server_name 精确匹配做 HTTP → HTTPS 301），HTTP 回退口 8088，且可能因冲突再调整。
  sed -e "s/laal\.top/${NGINX_DOMAIN}/g" \
      -e "s|__MIM_WEB_HTTP_PORT__|${MIM_WEB_HTTP_PORT}|g" \
      -e "s|__MIM_WEB_HTTPS_PORT__|${MIM_WEB_HTTPS_PORT}|g" \
      -e "s|__MIM_API_PORT__|${PORT_}|g" \
      -e "s|__MIM_TLS_CONF__|${TLS_CONF}|g" \
      "$APP_DIR/deploy/nginx-mim.conf" > "$NGINX_AVAILABLE"
  chmod 644 "$NGINX_AVAILABLE"

  # 先校验纯 HTTP 配置语法，语法错误立即回滚（此时尚未动 TLS，风险最低）
  if ! nginx -t; then
    nginx_rollback
    die "nginx 配置语法校验失败，已回滚"
  fi

  # certbot 仅在同机独占模式（MIM_TLS_CERTBOT=1）下执行：它会对 80 端口做 HTTP-01 挑战
  # 并改写 server 块加 --redirect，与 MixmAPP 抢 80/443，共存模式下必须禁用。
  if [ "$MIM_TLS_CERTBOT" = "1" ]; then
    # SAN 清单 = 主站 + 本机 DNS 已可解析的绑定子域（api / admin / auth / center / dh / gy /
    # login / mall / pay / video）。新域尚未建解析时把主机名塞给 certbot 会让 HTTP-01 挑战失败、
    # 整次发布回滚，故先用 getent 探测，只把已解析的追加进 SAN；其余留 warning，DNS 就绪后
    # 重跑本脚本会自动纳入（--expand 允许在既有证书上追加域名）。
    CERT_DOMAINS=(-d "$NGINX_DOMAIN" -d "www.${NGINX_DOMAIN}")
    for CERT_SUB in api admin auth center dh gy login mall pay video; do
      if getent hosts "${CERT_SUB}.${NGINX_DOMAIN}" >/dev/null 2>&1; then
        CERT_DOMAINS+=(-d "${CERT_SUB}.${NGINX_DOMAIN}")
      else
        warn "证书跳过 ${CERT_SUB}.${NGINX_DOMAIN}（本机 DNS 无解析，解析就绪后重跑自动纳入）"
      fi
    done
    if [ -d "/etc/letsencrypt/live/${NGINX_DOMAIN}" ] && command -v certbot >/dev/null 2>&1; then
      log "certbot 注入 HTTPS（已有证书，--keep-until-expiring，SAN: ${CERT_DOMAINS[*]}）"
      if ! certbot --nginx "${CERT_DOMAINS[@]}" --redirect --non-interactive \
          --keep-until-expiring --expand --agree-tos -m "admin@${NGINX_DOMAIN}"; then
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
  else
    warn "同机共存模式（MIM_TLS_CERTBOT=0）：跳过 certbot，不触碰 80/443；HTTPS 由 ${CERT_DIR} 既有证书承载（TLS_ENABLED=${TLS_ENABLED}）"
  fi

  # 启用站点；default_server 归属同机既有站点（MixmAPP 占 80/443），共存模式不删 default
  ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  if [ "$MIM_NGINX_TAKE_DEFAULT" = "1" ]; then
    rm -f /etc/nginx/sites-enabled/default
    log "已停用 default 站点（MIM_NGINX_TAKE_DEFAULT=1，独占机器模式）"
  else
    log "保留 /etc/nginx/sites-enabled/default（同机共存，80/443 归 MixmAPP）"
  fi
  log "nginx -t && reload"
  nginx -t || { nginx_rollback; die "启用站点后 nginx 校验失败，已回滚"; }
  systemctl reload nginx || systemctl restart nginx

  # 断言 /admin/ 真实返回管理后台页面：以响应体含 noindex 为准。
  # 不可用 `curl http://127.0.0.1/admin` 的 301 作为判据：整站强制 HTTPS 时会 301，
  # 该结果无法区分「location = /admin 生效」与「整站跳转」，属假阳性。
  # 端口化后必须带新端口探测：--resolve 指回本机 ${MIM_WEB_HTTPS_PORT}（默认 443）取 HTTPS；无证书时退化为
  # Host 头直连本机 ${MIM_WEB_HTTP_PORT}（默认 8088），保证共存且未签证书的机器也能得到真实判据。
  if [ "$TLS_ENABLED" -eq 1 ]; then
    ADMIN_BODY="$(curl -k -s --max-time 5 --resolve "${NGINX_DOMAIN}:${MIM_WEB_HTTPS_PORT}:127.0.0.1" \
      "https://${NGINX_DOMAIN}:${MIM_WEB_HTTPS_PORT}/admin/" || true)"
  else
    ADMIN_BODY="$(curl -s --max-time 5 -H "Host: ${NGINX_DOMAIN}" \
      "http://127.0.0.1:${MIM_WEB_HTTP_PORT}/admin/" || true)"
  fi
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
