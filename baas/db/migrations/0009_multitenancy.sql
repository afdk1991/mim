-- =============================================================================
-- 0009 多租户（行级，可选启用）
-- 设计原则：**向后兼容**——tenant_id 为 NULL 时表示单租户，
--   所有既有策略语义完全不变；只有显式带上 tenant_id 的行才受租户隔离约束。
-- 粒度选型对比（三种方案的取舍见 README §多租户）：
--   库级    ：隔离最强、成本最高（N 套实例/备份）；租户数 < 50 且合规要求高时选
--   schema 级：隔离与成本折中，但迁移要按 schema 重放、连接池与 RLS 要按 schema 配
--   行级 ✅  ：成本最低、一套迁移，依赖 RLS 正确性（本文件采用）
-- =============================================================================

-- ---------- 租户读取基元 ----------
-- 租户 id 来自 JWT：优先顶层 claim `tenant_id`，其次 app_metadata.tenant_id
create or replace function public.current_tenant()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.tenant_id', true),
      public.jwt_claims() ->> 'tenant_id',
      public.jwt_claims() -> 'app_metadata' ->> 'tenant_id'
    ), ''
  )::uuid
$$;

-- ---------- 租户与成员 ----------
create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_members_user_idx on public.tenant_members (user_id);

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;

-- 成员判定（函数本身只查表，RLS 由调用者的策略控制；用 security definer 打破循环依赖）
create or replace function public.is_tenant_member(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select t is not null and exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = public.jwt_uid()
  )
$$;

drop policy if exists "tenants 成员可读" on public.tenants;
create policy "tenants 成员可读" on public.tenants
  for select using (public.is_tenant_member(id));

drop policy if exists "tenant_members 同租户可读" on public.tenant_members;
create policy "tenant_members 同租户可读" on public.tenant_members
  for select using (public.is_tenant_member(tenant_id));

drop policy if exists "tenant_members 管理员可改" on public.tenant_members;
create policy "tenant_members 管理员可改" on public.tenant_members
  for all to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.tenant_members m
      where m.tenant_id = tenant_members.tenant_id
        and m.user_id = public.jwt_uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.tenant_members m
      where m.tenant_id = tenant_members.tenant_id
        and m.user_id = public.jwt_uid()
        and m.role in ('owner', 'admin')
    )
  );

-- 建租户：必须是登录用户，且自动成为 owner（security definer 打破“先有成员才能建成员”的死锁）
create or replace function public.create_tenant(name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.jwt_uid() is null then
    raise exception '未登录，不能创建租户';
  end if;

  insert into public.tenants (name) values (name) returning id into v_id;
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_id, public.jwt_uid(), 'owner');
  return v_id;
end $$;

grant execute on function public.create_tenant(text) to authenticated, service_role;
grant execute on function public.current_tenant() to anon, authenticated, service_role;
grant execute on function public.is_tenant_member(uuid) to anon, authenticated, service_role;

-- ---------- 业务表加租户列（可空 = 单租户数据，行为不变） ----------
alter table public.todos add column if not exists tenant_id uuid references public.tenants (id) on delete cascade;
alter table public.documents add column if not exists tenant_id uuid references public.tenants (id) on delete cascade;
alter table public.file_refs add column if not exists tenant_id uuid references public.tenants (id) on delete cascade;

create index if not exists todos_tenant_idx on public.todos (tenant_id);
create index if not exists documents_tenant_idx on public.documents (tenant_id);
create index if not exists file_refs_tenant_idx on public.file_refs (tenant_id);

-- ---------- 策略重放：在原条件之上叠加租户约束 ----------
-- 约定：tenant_id IS NULL → 不过滤租户；tenant_id 有值 → 必须是该租户成员
drop policy if exists "todos 本人可读" on public.todos;
create policy "todos 本人可读" on public.todos
  for select to authenticated
  using (
    public.jwt_uid() = user_id
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "todos 本人可建" on public.todos;
create policy "todos 本人可建" on public.todos
  for insert to authenticated
  with check (
    public.jwt_uid() = user_id
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "todos 本人可改" on public.todos;
create policy "todos 本人可改" on public.todos
  for update to authenticated
  using (
    public.jwt_uid() = user_id
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  )
  with check (
    public.jwt_uid() = user_id
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "todos 本人可删" on public.todos;
create policy "todos 本人可删" on public.todos
  for delete to authenticated
  using (
    public.jwt_uid() = user_id
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "documents 公开或本人可读" on public.documents;
create policy "documents 公开或本人可读" on public.documents
  for select using (
    (is_public or public.jwt_uid() = owner)
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "documents 登录可建" on public.documents;
create policy "documents 登录可建" on public.documents
  for insert to authenticated
  with check (
    public.jwt_uid() = owner
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "documents 本人可改" on public.documents;
create policy "documents 本人可改" on public.documents
  for update to authenticated
  using (
    public.jwt_uid() = owner
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  )
  with check (
    public.jwt_uid() = owner
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "documents 本人可删" on public.documents;
create policy "documents 本人可删" on public.documents
  for delete to authenticated
  using (
    public.jwt_uid() = owner
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "file_refs 本人可读" on public.file_refs;
create policy "file_refs 本人可读" on public.file_refs
  for select to authenticated
  using (
    public.jwt_uid() = owner
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

drop policy if exists "file_refs 本人可写" on public.file_refs;
create policy "file_refs 本人可写" on public.file_refs
  for all to authenticated
  using (
    public.jwt_uid() = owner
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  )
  with check (
    public.jwt_uid() = owner
    and (tenant_id is null or public.is_tenant_member(tenant_id))
  );

comment on function public.current_tenant() is
  '当前请求的租户 id（来自 JWT 的 tenant_id claim）；NULL 表示单租户模式';
