#!/bin/bash
# Mim 全量商城每日同步入口（生产：每日 02:30 Asia/Shanghai，无人值守累积全量）
# - 默认全量全分类覆盖（limit/pages/perCat/maxItems 均为 0 = 不限）
# - 按 source_key 幂等 upsert，已抓过的商品只更新变化字段，断点续跑不重复
# - flock 防重入；失败 30s 后 --resume 续跑一次
# - 输出追加到 $STATE_DIR/sync.log（超过 5MB 轮转一份）
# - 可选 SYNC_ALERT_WEBHOOK（企业微信/钉钉文本 webhook）失败告警
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
export LANG=C.UTF-8

APP_ROOT=${APP_ROOT:-/opt/mim/app}
export APP_ROOT
STATE_DIR=${SYNC_STATE_DIR:-/var/lib/mim/catalog-sync}
export SYNC_STATE_DIR="$STATE_DIR"
export CATALOG_IMAGE_DIR=${CATALOG_IMAGE_DIR:-/var/lib/mim/catalog-images}
LOG="$STATE_DIR/sync.log"
mkdir -p "$STATE_DIR/reports" "$CATALOG_IMAGE_DIR"

# 5MB 轮转一份，避免长期运行占满磁盘
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 5242880 ]; then
  mv -f "$LOG" "$LOG.1"
fi

exec 9>"$STATE_DIR/run.lock"
if ! flock -n 9; then
  echo "$(date '+%F %T %Z') [skip] 已有同步任务在运行" >>"$LOG"
  exit 0
fi

# 生产 API 环境变量（数据库路径等）；不存在时走 cli.mjs 默认值
if [ -f /opt/mim/mim-api.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /opt/mim/mim-api.env
  set +a
fi

CLI="$APP_ROOT/scripts/catalog/cli.mjs"

echo "$(date '+%F %T %Z') ===== [egluosi] sync start =====" >>"$LOG"
node "$CLI" sync --site egluosi --max-runtime-min 150 --no-delist >>"$LOG" 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  echo "$(date '+%F %T %Z') [retry] 首次失败 code=$code，30s 后断点续跑" >>"$LOG"
  sleep 30
  node "$CLI" sync --site egluosi --resume --max-runtime-min 150 --no-delist >>"$LOG" 2>&1
  code=$?
fi

TS=$(date '+%F %T %Z')
if [ "$code" -eq 0 ]; then
  echo "===== [$TS] catalog sync OK =====" >>"$LOG"
  exit 0
fi

echo "===== [$TS] catalog sync FAILED code=$code =====" >>"$LOG"
if [ -n "${SYNC_ALERT_WEBHOOK:-}" ]; then
  curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[mim] catalog sync 失败 code=$code，详见 $LOG\"}}" \
    "$SYNC_ALERT_WEBHOOK" >/dev/null 2>&1 || true
fi
exit 1
