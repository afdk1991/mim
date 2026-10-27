#!/usr/bin/env bash
# 新建迁移文件：bash scripts/new-migration.sh 名称
#   例：bash scripts/new-migration.sh add_orders_table
#   → db/migrations/0009_add_orders_table.sql
set -euo pipefail
cd "$(dirname "$0")/.."

name="${1:-}"
if [[ -z "$name" ]]; then
  echo "用法：bash scripts/new-migration.sh <名称>"
  exit 1
fi

last="$(ls db/migrations 2>/dev/null | grep -E '^[0-9]{4}_.*\.sql$' | tail -n 1 | cut -d_ -f1)"
next="$(printf '%04d' $(( ${last:-0} + 1 )))"
file="db/migrations/${next}_${name}.sql"

cat > "$file" <<EOF
-- =============================================================================
-- ${next} ${name}
-- 编写约定：
--   1) 必须幂等（if not exists / drop ... if exists / DO 块判断）
--   2) 禁止裸 SET —— 事务连接池下会跨请求残留导致串号；只允许 SET LOCAL 或
--      set_config(..., is_local => true)
--   3) 新增 public 表必须同时 alter table ... enable row level security 并建策略
--   4) 函数默认 SECURITY INVOKER；确需 definer 时必须 set search_path
-- =============================================================================

EOF

echo "已创建：$file"
