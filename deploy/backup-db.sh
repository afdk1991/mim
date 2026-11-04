#!/usr/bin/env bash
# SQLite 生产库一致性备份（铁律八：备份脚本随部署工件入库）
#
# 用法：
#   bash deploy/backup-db.sh              # 备份到默认目录
#   BACKUP_DIR=/var/backups/mim bash deploy/backup-db.sh
#
# 说明：
#   - 使用 sqlite3 .backup（在线热备份），WAL 模式下也可得到一致快照；
#   - 备份文件按时间戳命名，保留最近 KEEP 份；
#   - 建议由 systemd timer / cron 每日调用，例如：
#       0 3 * * * bash /opt/mim/app/deploy/backup-db.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mim/app}"
DB_PATH="${DB_PATH:-$APP_DIR/services/mim-api/data/mim.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mim}"
KEEP="${KEEP:-14}"

log() { printf '[backup %s] %s\n' "$(date '+%F %T')" "$*"; }

if [ ! -f "$DB_PATH" ]; then
  log "❌ 数据库不存在: $DB_PATH"
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  log "❌ 缺少 sqlite3，请先安装: apt-get install -y sqlite3"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date '+%Y%m%d-%H%M%S')"
TARGET="$BACKUP_DIR/mim-$STAMP.db"

# .backup 在线热备份：不锁库、不受 WAL 影响
sqlite3 "$DB_PATH" ".backup '$TARGET'"
log "✅ 已备份: $TARGET ($(du -h "$TARGET" | cut -f1))"

# 轮转：仅保留最近 KEEP 份
COUNT="$(ls -1 "$BACKUP_DIR"/mim-*.db 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$BACKUP_DIR"/mim-*.db | tail -n "$((COUNT - KEEP))" | xargs -r rm -f
  log "🧹 轮转完成，保留最近 $KEEP 份"
fi
