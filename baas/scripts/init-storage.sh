#!/usr/bin/env bash
# 初始化默认 bucket（幂等：已存在返回 409 视为成功）
# 需要 SERVICE_ROLE_KEY，走网关 /storage/v1/bucket
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BASE="${SITE_URL:-http://localhost:8000}"
KEY="${SERVICE_ROLE_KEY:-}"

if [[ -z "$KEY" ]]; then
  echo "缺少 SERVICE_ROLE_KEY：请先 make keys -- --write 生成，或手工填入 .env"
  exit 1
fi

create_bucket() {
  local id="$1" public="$2"
  local code
  code="$(curl -s -o /tmp/baas-bucket.json -w '%{http_code}' \
    -X POST "$BASE/storage/v1/bucket" \
    -H "Authorization: Bearer $KEY" \
    -H "apikey: $KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"id\":\"$id\",\"name\":\"$id\",\"public\":$public}")"
  case "$code" in
    200|201) echo "  ✅ bucket 已创建：$id (public=$public)" ;;
    409)     echo "  ✅ bucket 已存在：$id" ;;
    *)       echo "  ❌ bucket 创建失败：$id  HTTP $code  $(cat /tmp/baas-bucket.json)"; return 1 ;;
  esac
}

echo "== 初始化 Storage bucket =="
create_bucket avatars   true
create_bucket documents false
echo "完成"
