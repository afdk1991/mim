-- =============================================================================
-- 0002 Auth 桥接：注册即建 profile + 用户角色表（含首个管理员引导）
-- 依赖：gotrue 启动后自建 auth schema；本迁移对 auth schema 只在存在时挂钩，
--       因此「先跑迁移再启动 auth」也不会失败（外键与触发器在 auth 出现后补挂，
--       补挂脚本 scripts/migrate.sh 会在每次执行时重试这里面的 DO 块）。
-- =============================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id           uuid primary key,
  username     text unique,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- auth.users 存在时补建外键（首次迁移时 auth 可能还没起来）
do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'profiles_id_fkey' and conrelid = 'public.profiles'::regclass
     ) then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end $$;

alter table public.profiles enable row level security;

drop policy if exists "profiles 可读" on public.profiles;
create policy "profiles 可读" on public.profiles
  for select using (true);

drop policy if exists "profiles 本人可写" on public.profiles;
create policy "profiles 本人可写" on public.profiles
  for update to authenticated
  using (public.jwt_uid() = id)
  with check (public.jwt_uid() = id);

drop policy if exists "profiles 本人可建" on public.profiles;
create policy "profiles 本人可建" on public.profiles
  for insert to authenticated
  with check (public.jwt_uid() = id);

-- ---------- 用户角色 ----------
create table if not exists public.user_roles (
  user_id    uuid not null,
  role       text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

-- 读：本人或管理员
drop policy if exists "user_roles 本人或管理员可读" on public.user_roles;
create policy "user_roles 本人或管理员可读" on public.user_roles
  for select using (public.jwt_uid() = user_id or public.jwt_has_role('admin'));

-- 写：管理员，或「系统尚无管理员」时的首个引导（门会自动关闭）
-- 注意：这条是避免死锁的关键——若只允许管理员写入，则第一个管理员永远产生不出来
drop policy if exists "user_roles 可写" on public.user_roles;
create policy "user_roles 可写" on public.user_roles
  for all to authenticated
  using (
    public.jwt_has_role('admin')
    or not exists (select 1 from public.user_roles where role = 'admin')
  )
  with check (
    public.jwt_has_role('admin')
    or (
      not exists (select 1 from public.user_roles where role = 'admin')
      and public.jwt_uid() = user_id
      and role = 'admin'
    )
  );

-- 供前端/策略使用的判定函数
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.jwt_has_role('admin')
$$;

-- 系统里是否存在任何管理员（未登录也要能问，否则引导 UI 无从判断）
create or replace function public.has_any_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where role = 'admin')
$$;

grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.has_any_admin() to anon, authenticated, service_role;

-- ---------- 注册联动：auth.users 新增行 → 自动建 profile ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  else
    raise notice '[0002] auth.users 尚不存在，跳过触发器挂载（下次执行迁移会自动补挂）';
  end if;
end $$;
