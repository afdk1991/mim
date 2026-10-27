-- 0010 · 管理后台权限引导（首个管理员引导 + is_admin 修正）
--
-- 背景（实测缺陷）：
--   注册触发器 handle_new_user_role() 只分配默认角色 'user'，
--   而 public.user_roles 的写策略要求调用者已是 admin（is_admin()），
--   于是「没有任何人能成为第一个 admin」——/#/admin 对所有人恒为无权限。
--   本迁移补上两条引导通道，并保持「门自动关闭」语义：
--     · 自助通道：仅当系统尚无 admin 时，登录用户可把自己提为 admin（之后永久失效）
--     · 显式通道：SQL Editor / service_role 按用户名或邮箱授予（不开放给 authenticated）
--
-- 另修正 0008_mall.sql：is_admin(uuid) 误用 user_roles.role 列（实际为 role_id 外键），
--   运行时报 column "role" does not exist，导致商城订单核销恒失败。

-- ---------- 1. 修正 is_admin(uuid)：改为 join roles 判定 ----------
create or replace function public.is_admin(p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_uid and r.name = 'admin'
  );
$$;

-- ---------- 2. 系统是否已有管理员（前端据其决定是否显示「成为首个管理员」） ----------
create or replace function public.has_any_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.name = 'admin'
  );
$$;

revoke all on function public.has_any_admin() from public;
grant execute on function public.has_any_admin() to anon, authenticated;

-- ---------- 3. 自助引导：仅当系统尚无管理员时可调用（门自动关闭） ----------
create or replace function public.bootstrap_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role_id uuid;
begin
  if v_uid is null then
    return false; -- 未登录：RLS 下无从提升
  end if;

  if public.has_any_admin() then
    return false; -- 已有管理员：引导通道永久关闭，避免被后续注册者滥用
  end if;

  select id into v_role_id from public.roles where name = 'admin';
  if v_role_id is null then
    return false; -- admin 角色未播种（0001 未应用）
  end if;

  insert into public.user_roles (user_id, role_id)
  values (v_uid, v_role_id)
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function public.bootstrap_admin() from public;
grant execute on function public.bootstrap_admin() to authenticated;

-- ---------- 4. 显式授予：按用户名或邮箱（SQL Editor / service_role 通道） ----------
-- 入参支持两种写法（对齐「用户名映射合成邮箱 <username>@mim.app」的注册规则）：
--   p_name = 'alice'          → 匹配 alice@mim.app 或 alice
--   p_name = 'a@b.com'        → 直接按邮箱匹配（含 @ 的输入按邮箱直通注册）
-- 返回诊断串，便于执行后一眼核对结果。
create or replace function public.grant_admin_by_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role_id uuid;
begin
  select id into v_role_id from public.roles where name = 'admin';
  if v_role_id is null then
    return 'roles 表缺少 admin 角色：请确认 0001_iam_phase1.sql 已应用';
  end if;

  select u.id into v_uid
  from auth.users u
  where lower(u.email) = lower(p_name)
     or lower(u.email) = lower(p_name) || '@mim.app'
  limit 1;

  if v_uid is null then
    return '未找到账号：' || p_name || '（请先在应用内注册，再执行授权）';
  end if;

  insert into public.user_roles (user_id, role_id)
  values (v_uid, v_role_id)
  on conflict do nothing;

  return '已授予 admin：' || p_name || ' —— 刷新页面即可看到「🛡️ 管理后台」入口';
end;
$$;

-- 仅保留 service_role / postgres（SQL Editor）可执行：
-- 默认 public 可执行，此处显式回收，避免普通登录用户把自己提权。
revoke all on function public.grant_admin_by_name(text) from public;
