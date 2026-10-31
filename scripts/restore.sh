#!/usr/bin/env bash
# ==============================================================================
# Mim —— 数据库恢复脚本（与 scripts/backup.sh 配对）
#
# 安全策略：**先恢复到临时库验证，确认无误后才切正式**——绝不在生产库上直接
#          灌备份，一次误操作把好数据覆盖成旧备份就没了。
#
# 用法：
#   # 1) 只做恢复演练（默认，不动生产库）：
#   RESTORE_FILE=/var/backups/mim/mim-2026-11-01-0200.sql.gz ./scripts/restore.sh
#
#   # 2) 真要切回这个备份（校验通过后才切，且会先停服提醒）：
#   DO_CUTOVER=1 RESTORE_FILE=/var/backups/mim/mim-....sql.gz ./scripts/restore.sh
#
# 环境变量：
#   RESTORE_FILE  必填，backup.sh 产出的 mim-*.sql.gz（或 .dump/.dump.gz custom 格式）
#   PROD_DB      正式库名（默认 mim，可从 server/.env 的 DATABASE_URL 解析覆盖）
#   TEMP_DB      验证用临时库名（默认 mim_restore_test，可重复跑）
#   UPLOADS_TAR  可选，backup.sh 产出的 uploads-*.tar.gz；只解到临时目录供人工核对，
#                不会自动覆盖线上 server/data/uploads
#   DO_CUTOVER   =1 时校验通过后做库名切换；缺省只演练
#
# 退出码：0=恢复+校验（演练）成功；1=任一步失败。
# ==============================================================================
set -euo pipefail

: "${RESTORE_FILE:?请指定 RESTORE_FILE=/path/to/mim-YYYY-MM-DD.sql.gz}"
PROD_DB="${PROD_DB:-mim}"
TEMP_DB="${TEMP_DB:-mim_restore_test}"
UPLOADS_TAR="${UPLOADS_TAR:-}"
DO_CUTOVER="${DO_CUTOVER:-0}"

PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1)

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$RESTORE_FILE" ] || die "备份文件不存在：$RESTORE_FILE"
command -v psql >/dev/null 2>&1 || die "未找到 psql"

# ---------- 1. 清空并重建临时库 ----------
log "1/4 重建临时库 $TEMP_DB（可重复跑）"
# 临时库可能存在活动连接（上次演练没退干净），先强制断开
"${PSQL[@]}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TEMP_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
sudo -u postgres dropdb --if-exists "$TEMP_DB"
sudo -u postgres createdb "$TEMP_DB"

# ---------- 2. 导入备份 ----------
log "2/4 导入 $RESTORE_FILE → $TEMP_DB"
case "$RESTORE_FILE" in
  *.sql.gz)
    zcat "$RESTORE_FILE" | sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$TEMP_DB" >/dev/null
    ;;
  *.dump.gz)
    gunzip -c "$RESTORE_FILE" > /tmp/mim-restore-$$.dump
    sudo -u postgres pg_restore -d "$TEMP_DB" --no-owner --no-privileges /tmp/mim-restore-$$.dump
    rm -f /tmp/mim-restore-$$.dump
    ;;
  *.dump)
    sudo -u postgres pg_restore -d "$TEMP_DB" --no-owner --no-privileges "$RESTORE_FILE"
    ;;
  *)
    die "不认识的备份后缀（期望 .sql.gz / .dump / .dump.gz）：$RESTORE_FILE"
    ;;
esac

# ---------- 3. 校验：关键表存在且有行数 ----------
log "3/4 校验关键表（临时库）"
# 这些是 Mim 的核心表；行数 > 0 说明数据真的回来了（空库也能导入成功但没意义）
CHECKS=(
  "users:用户"
  "posts:动态"
  "mall_orders:订单"
)
VERIFY_FAIL=0
for pair in "${CHECKS[@]}"; do
  table="${pair%%:*}"; label="${pair##*:}"
  cnt="$("${PSQL[@]}" -d "$TEMP_DB" -tAc "SELECT count(*) FROM $table;" 2>/dev/null || echo "ERR")"
  if [ "$cnt" = "ERR" ]; then
    printf '  [FAIL] %s（%s）表不存在或查询失败\n' "$label" "$table"
    VERIFY_FAIL=1
  elif [ "$cnt" -lt 1 ] 2>/dev/null; then
    printf '  [FAIL] %s（%s）行数为 0，备份疑似空\n' "$label" "$table"
    VERIFY_FAIL=1
  else
    printf '  [OK]   %s（%s）行数 %s\n' "$label" "$table" "$cnt"
  fi
done

# migrations 是否全部应用到位
MIGS="$("${PSQL[@]}" -d "$TEMP_DB" -tAc "SELECT count(*) FROM schema_migrations;" 2>/dev/null || echo "?")"
printf '  [OK]   已记录迁移 %s 个\n' "$MIGS"

[ "$VERIFY_FAIL" -eq 0 ] || die "校验未通过，已中止（临时库 $TEMP_DB 保留供排查，正式库未动）"

# 上传包（若提供）只解到临时目录，不碰线上
if [ -n "$UPLOADS_TAR" ] && [ -f "$UPLOADS_TAR" ]; then
  UP_DIR="/tmp/mim-uploads-$$"
  mkdir -p "$UP_DIR"
  tar xzf "$UPLOADS_TAR" -C "$UP_DIR"
  log "上传备份已解到 $UP_DIR（人工核对后再 rsync 到 server/data/uploads，本脚本不自动覆盖）"
fi

# ---------- 4.（可选）切正式 ----------
if [ "$DO_CUTOVER" != "1" ]; then
  log "演练完成（DO_CUTOVER≠1，未切正式）。临时库 $TEMP_DB 保留。"
  echo "    确认无误后：先 sudo systemctl stop mim-server，再 DO_CUTOVER=1 重跑本脚本切库。"
  exit 0
fi

log "4/4 切正式：$PROD_DB → 改名备份，$TEMP_DB → 改名为 $PROD_DB"
echo "!! 即将切换生产库。请确认后端已停：sudo systemctl stop mim-server"
NEW_NAME="${PROD_DB}_bak_$(date +%Y%m%d-%H%M%S)"
"${PSQL[@]}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$PROD_DB' AND pid <> pg_backend_pid();" >/dev/null
sudo -u postgres psql -c "ALTER DATABASE \"$PROD_DB\" RENAME TO \"$NEW_NAME\";"
sudo -u postgres psql -c "ALTER DATABASE \"$TEMP_DB\" RENAME TO \"$PROD_DB\";"
# 库名切了但属主还是 postgres，App 连接角色是 mim，改回属主
APP_USER="${PGUSER:-mim}"
sudo -u postgres psql -c "ALTER DATABASE \"$PROD_DB\" OWNER TO \"$APP_USER\";"

log "切库完成。旧库备份名 $NEW_NAME（核对无误后可 dropdb）。"
echo "    下一步：sudo systemctl start mim-server && ./scripts/monitor.sh"
echo "    确认一切正常后清理旧库：sudo -u postgres dropdb $NEW_NAME"
