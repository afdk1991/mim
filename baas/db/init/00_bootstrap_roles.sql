-- =============================================================================
-- 容器首次启动时执行（docker-entrypoint-initdb.d），必须幂等
-- 职责：补齐 BaaS 依赖的 4 个 PG 角色 + 可选扩展 + public schema 授权
-- 说明：这里不设置任何密码。若你换成官方 postgres 镜像，需手工执行：
--   alter role authenticator login password '<POSTGRES_PASSWORD>';
-- =============================================================================

-- ---------- 角色 ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login superuser;
  end if;
end $$;

-- authenticator 是 PostgREST 的登录角色，运行时由它切换成 anon / authenticated
grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;

-- ---------- 可选扩展（缺失只告警，不阻断启动） ----------
-- 必装
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- 可选：能力与缺失后果见 README「扩展矩阵」
do $$ begin create extension if not exists vector;
  exception when others then raise notice '[bootstrap] pgvector 不可用，向量检索不可用：%', sqlerrm; end $$;
do $$ begin create extension if not exists pg_graphql;
  exception when others then raise notice '[bootstrap] pg_graphql 不可用，GraphQL 不可用：%', sqlerrm; end $$;
do $$ begin create extension if not exists pgjwt;
  exception when others then raise notice '[bootstrap] pgjwt 不可用（仅影响库内签 JWT 的场景）：%', sqlerrm; end $$;
do $$ begin create extension if not exists pg_stat_statements;
  exception when others then raise notice '[bootstrap] pg_stat_statements 不可用：%', sqlerrm; end $$;

-- ---------- public schema 授权 ----------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- 未来新建对象自动继承（避免每次迁移后手工 grant）
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;

-- ---------- 逻辑复制（Realtime 的前置条件） ----------
-- wal_level=logical 由镜像/命令参数设置；这里只做可见性提示
do $$
begin
  if current_setting('wal_level') <> 'logical' then
    raise notice '[bootstrap] wal_level=% ，Realtime 需要 logical（官方 postgres 镜像请在 command 里加 -c wal_level=logical）',
      current_setting('wal_level');
  end if;
end $$;
