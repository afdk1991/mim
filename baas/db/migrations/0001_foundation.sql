-- =============================================================================
-- 0001 地基：迁移记录表 + JWT 提取函数 + 权限基元
-- 设计要点：
--   1) 所有身份判定只读 request.jwt.claims（PostgREST 用事务内 set_config(..., true)
--      写入），不依赖 auth schema 内部实现 → 换 Auth 组件也不改策略
--   2) 事务池安全：全文件禁止裸 SET，只允许 SET LOCAL / set_config(..., is_local=>true)
-- =============================================================================

-- ---------- 迁移记录表（由 scripts/migrate.sh 写入） ----------
create table if not exists public.schema_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);

-- 元数据表不对外暴露：开 RLS 且不建策略 → 经 API 一律不可见（psql 不受影响）
alter table public.schema_migrations enable row level security;

-- ---------- JWT 读取基元 ----------
-- request.jwt.claims：PostgREST 在事务内注入的完整 claims（jsonb）
create or replace function public.jwt_claims()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- 当前用户 id（sub）
create or replace function public.jwt_uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      public.jwt_claims() ->> 'sub'
    ), ''
  )::uuid
$$;

-- 当前 PG 角色：anon / authenticated / service_role
create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    public.jwt_claims() ->> 'role',
    current_setting('role', true)
  )
$$;

-- app_metadata.roles / role 声明的权限判定
create or replace function public.jwt_has_role(want text)
returns boolean
language sql
stable
as $$
  select want = public.jwt_role()
     or exists (
       select 1
       from jsonb_array_elements_text(
         coalesce(public.jwt_claims() -> 'app_metadata' -> 'roles', '[]'::jsonb)
       ) as r(role)
       where r.role = want
     )
$$;

comment on function public.jwt_claims() is
  '读取 PostgREST 事务内注入的 JWT claims；未登录为 null';
comment on function public.jwt_uid() is
  '当前请求的用户 id；用于 RLS 策略的 using/with check';

-- ---------- 便捷函数：当前是否通过认证 ----------
create or replace function public.is_authenticated()
returns boolean
language sql
stable
as $$
  select public.jwt_uid() is not null
$$;

-- ---------- 冒烟用 ping（ healthcheck 可直接 GET /rest/v1/rpc/ping ） ----------
create or replace function public.ping()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'role', public.jwt_role(),
    'uid', public.jwt_uid(),
    'now', now()
  )
$$;

grant execute on function public.jwt_claims() to anon, authenticated, service_role;
grant execute on function public.jwt_uid() to anon, authenticated, service_role;
grant execute on function public.jwt_role() to anon, authenticated, service_role;
grant execute on function public.jwt_has_role(text) to anon, authenticated, service_role;
grant execute on function public.is_authenticated() to anon, authenticated, service_role;
grant execute on function public.ping() to anon, authenticated, service_role;
