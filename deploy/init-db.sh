#!/usr/bin/env bash
# ==============================================================================
# 初始化宿主机 PostgreSQL：创建专用角色与数据库（幂等，可重复执行）
#
# 本项目不使用容器 —— PostgreSQL 直接装在宿主机上（apt/yum 安装的系统服务）。
#
# 用法（用有 sudo 权限的账号执行，不要直接 sudo bash 本脚本）：
#   PGUSER=mim PGPASSWORD='强口令' PGDATABASE=mim ./deploy/init-db.sh
#
# 说明：
#   - 口令通过 psql 变量 :'pw' 传入，由 psql 负责转义，避免拼 SQL 时被特殊字符打断
#   - 角色缺失则建，已存在则只改口令（不删库、不动数据）
# ==============================================================================
set -euo pipefail

DB_USER="${PGUSER:-mim}"
DB_NAME="${PGDATABASE:-mim}"
DB_PASS="${PGPASSWORD:-}"

if [ -z "$DB_PASS" ]; then
  echo "错误：请通过环境变量指定数据库口令，例如："
  echo "  PGUSER=mim PGPASSWORD='your-strong-password' PGDATABASE=mim $0"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "错误：未找到 psql。请先在宿主机安装 PostgreSQL，例如："
  echo "  Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y postgresql"
  echo "  RHEL/CentOS  : sudo dnf install -y postgresql-server && sudo postgresql-setup --initdb"
  exit 1
fi

PSQL_AS_POSTGRES=(sudo -u postgres psql -v ON_ERROR_STOP=1)

echo "==> 创建/更新数据库角色：$DB_USER"
"${PSQL_AS_POSTGRES[@]}" -v user="$DB_USER" -v pw="$DB_PASS" <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'user') THEN
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'user', :'pw');
    RAISE NOTICE '角色已存在，已更新口令';
  ELSE
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'user', :'pw');
    RAISE NOTICE '已创建角色';
  END IF;
END
$$;
SQL

# SD-014：库名同样走 psql 变量 :'db' 传参（与上面角色块同款），
# 不再把 $DB_NAME 直接 shell 插值进 SQL，避免口令/库名含单引号时语句被打断。
DB_EXISTS="$(
  sudo -u postgres psql -tAc -v db="$DB_NAME" "SELECT 1 FROM pg_database WHERE datname = :'db'"
)"

if [ "$DB_EXISTS" = "1" ]; then
  echo "==> 数据库 $DB_NAME 已存在，跳过创建（不会动里面已有的数据）"
else
  echo "==> 创建数据库：$DB_NAME（属主 $DB_USER）"
  sudo -u postgres createdb --owner="$DB_USER" "$DB_NAME"
fi

echo "==> 完成。对应的连接串："
echo "    DATABASE_URL=postgres://$DB_USER:<口令>@127.0.0.1:5432/$DB_NAME"
echo "==> 下一步：cd ../../server && npm run migrate"
