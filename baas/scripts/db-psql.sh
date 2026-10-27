#!/usr/bin/env bash
# 在 db 容器内执行 psql。宿主机无需安装 psql。
# 覆盖方式：PSQL="psql -h localhost -p 5432" bash scripts/db-psql.sh -c 'select 1'
set -euo pipefail
cd "$(dirname "$0")/.."

# 载入 .env（注意：.env 中的值不要包含空格或引号之外的特殊字符）
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DB="${POSTGRES_DB:-postgres}"

if [[ -n "${PSQL:-}" ]]; then
  exec $PSQL -U postgres -d "$DB" "$@"
fi

exec docker compose exec -T db psql -U postgres -d "$DB" "$@"
