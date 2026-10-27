-- =============================================================================
-- 0003 RLS 基线：两张示例业务表 + RLS 漏开自检视图
-- 这两张表同时充当 Realtime / Storage / Vector 三个模块的演示载体：
--   todos      → Realtime 变更推送
--   documents  → Vector 检索 + 文件引用
-- =============================================================================

-- ---------- todos ----------
create table if not exists public.todos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default public.jwt_uid(),
  title      text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists todos_user_id_idx on public.todos (user_id, created_at desc);

alter table public.todos enable row level security;

drop policy if exists "todos 本人可读" on public.todos;
create policy "todos 本人可读" on public.todos
  for select to authenticated
  using (public.jwt_uid() = user_id);

drop policy if exists "todos 本人可建" on public.todos;
create policy "todos 本人可建" on public.todos
  for insert to authenticated
  with check (public.jwt_uid() = user_id);

drop policy if exists "todos 本人可改" on public.todos;
create policy "todos 本人可改" on public.todos
  for update to authenticated
  using (public.jwt_uid() = user_id)
  with check (public.jwt_uid() = user_id);

drop policy if exists "todos 本人可删" on public.todos;
create policy "todos 本人可删" on public.todos
  for delete to authenticated
  using (public.jwt_uid() = user_id);

-- ---------- documents ----------
create table if not exists public.documents (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default public.jwt_uid(),
  title      text not null,
  content    text,
  is_public  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_owner_idx on public.documents (owner, created_at desc);

alter table public.documents enable row level security;

drop policy if exists "documents 公开或本人可读" on public.documents;
create policy "documents 公开或本人可读" on public.documents
  for select using (is_public or public.jwt_uid() = owner);

drop policy if exists "documents 登录可建" on public.documents;
create policy "documents 登录可建" on public.documents
  for insert to authenticated
  with check (public.jwt_uid() = owner);

drop policy if exists "documents 本人可改" on public.documents;
create policy "documents 本人可改" on public.documents
  for update to authenticated
  using (public.jwt_uid() = owner)
  with check (public.jwt_uid() = owner);

drop policy if exists "documents 本人可删" on public.documents;
create policy "documents 本人可删" on public.documents
  for delete to authenticated
  using (public.jwt_uid() = owner);

-- ---------- RLS 漏开自检 ----------
-- 交付前必查：任何一行都是「裸奔表」
create or replace view public.rls_missing as
select c.relname as table_name,
       pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by 1;

comment on view public.rls_missing is
  'public schema 中未启用 RLS 的表；上线前必须为空集';

grant select on public.rls_missing to authenticated, service_role;
