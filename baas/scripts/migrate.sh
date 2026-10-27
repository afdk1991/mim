#!/usr/bin/env bash
# 应用 db/migrations 下尚未执行的迁移；幂等，可反复执行。
#   每个迁移在单个事务内执行（-1），失败即整体回滚，不会产生半截状态。
#   结束后自动 notify PostgREST 刷新 schema cache（避免“表不存在”的假故障）。
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL_CMD=(bash scripts/db-psql.sh)

echo "== 迁移记录表自检 =="
"${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -q -c "
  create table if not exists public.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );
"

shopt -s nullglob
files=(db/migrations/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "没有迁移文件"
  exit 0
fi

applied=0
for f in "${files[@]}"; do
  name="$(basename "$f")"
  exists="$("${PSQL_CMD[@]}" -tAc "select count(*) from public.schema_migrations where name = '$name'" | tr -d '[:space:]')"
  if [[ "$exists" != "0" ]]; then
    echo "  - 跳过（已应用）: $name"
    continue
  fi
  echo "  ▶ 应用: $name"
  "${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -1 -q -f "/db/migrations/$name"
  "${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -q -c \
    "insert into public.schema_migrations(name) values ('$name') on conflict do nothing"
  applied=$((applied + 1))
done

echo "== 刷新 PostgREST schema cache =="
bash scripts/reload-postgrest.sh

echo "完成：本次应用 $applied 个迁移"
