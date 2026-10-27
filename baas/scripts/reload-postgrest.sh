#!/usr/bin/env bash
# 通知 PostgREST 重新加载 schema cache。
# 迁移后必须执行，否则新表/新函数会报 PGRST205「在 schema cache 中找不到」。
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/db-psql.sh -v ON_ERROR_STOP=1 -q -c "notify pgrst, 'reload schema';"
echo "已通知 PostgREST 刷新 schema cache"
