#!/usr/bin/env bash
# ==============================================================================
# Mim —— 数据库备份脚本（宿主机原生 PostgreSQL，无容器）
#
# 用法：
#   ./scripts/backup.sh                       # 默认备份到 /var/backups/mim
#   BACKUP_DIR=/data/backup KEEP_DAYS=30 ./scripts/backup.sh
#
# 建议：crontab 每天 02:00 执行一次
#   0 2 * * * /opt/mim/scripts/backup.sh >> /var/log/mim-backup.log 2>&1
#
# 环境变量：
#   BACKUP_DIR  备份目录（默认 /var/backups/mim）
#   KEEP_DAYS   本地保留天数（默认 14）
#   DB_NAME     数据库名（默认 mim，从 server/.env 的 DATABASE_URL 解析可覆盖）
#   RCLONE_DEST 可选：rclone 远端名称（如 remote:mim-backup），配置好 rclone 后启用
#
# 恢复演练（每季度一次）：
#   1. 新建临时库：sudo -u postgres createdb restore_test
#   2. 还原：zcat /var/backups/mim/mim-YYYY-MM-DD.sql.gz | sudo -u postgres psql restore_test
#   3. 抽查关键表行数：sudo -u postgres psql -d restore_test -c 'SELECT count(*) FROM posts;'
#   没演练过的备份等于没有备份。
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/mim}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_NAME="${DB_NAME:-mim}"
UPLOADS_DIR="${UPLOADS_DIR:-/opt/mim/server/data/uploads}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

command -v psql >/dev/null 2>&1 || { echo "错误：未找到 psql，请先安装 PostgreSQL" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

TS="$(date +%F-%H%M)"
SQL_FILE="$BACKUP_DIR/mim-$TS.sql.gz"

# ---------- 1. 数据库逻辑备份 ----------
log "1/3 pg_dump → $SQL_FILE"
sudo -u postgres pg_dump "$DB_NAME" | gzip > "$SQL_FILE"
ls -lh "$SQL_FILE"

# ---------- 2. 上传文件一起备份 ----------
if [ -d "$UPLOADS_DIR" ]; then
  log "2/3 上传目录备份 → $BACKUP_DIR/uploads-$TS.tar.gz"
  tar czf "$BACKUP_DIR/uploads-$TS.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
else
  warn "上传目录 $UPLOADS_DIR 不存在，跳过（首次部署可忽略）"
fi

# ---------- 3. 本地轮转 + 可选异地 ----------
log "3/3 轮转：删除本地 $KEEP_DAYS 天前的备份"
find "$BACKUP_DIR" -name 'mim-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

# 可选：异地同步（rclone 配置好后启用。R2/COS 都是 S3 兼容，rclone 配一次即可）
if [ -n "${RCLONE_DEST:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    log "异地同步到 $RCLONE_DEST"
    rclone copy "$BACKUP_DIR" "$RCLONE_DEST" --max-age 48h
  else
    warn "RCLONE_DEST 已设置但未安装 rclone，跳过异地同步"
  fi
fi

echo ""
log "备份完成：$SQL_FILE（本地保留 $KEEP_DAYS 天）"
