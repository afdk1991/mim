-- ============================================================================
-- Mim · Phase1 迁移 0003：CloudBase ↔ Supabase 账号桥（account bridge）
-- 目标平台：supabase.com 国际版
-- 用法：Supabase Dashboard → SQL Editor → 粘贴全量执行（幂等，可重复执行）
--
-- 背景：项目双后端（Supabase 主 / CloudBase 备），两套账号体系原本互相不可见：
--   · CloudBase app_users：uid = u_xxx，密码 PBKDF2-SHA512(100k, 64B) + 独立 salt
--   · Supabase auth.users：uuid，GoTrue bcrypt，用户名映射合成邮箱 <username>@mim.app
-- 本迁移把两者在「用户名」维度桥接：
--   ① account_bridge 表：登记 CloudBase 侧已注册的用户名 + 密码哈希（仅服务端可读）
--   ② username_taken()：注册前全局查重（auth.users + bridge 合并视图）
--   ③ claim_username()：CloudBase mim-api 注册成功后把账号登记进 bridge
--   ④ bridge 登录升级由 Edge Function /auth/bridge-login 完成（验 PBKDF2 →
--      Admin API 自动落户 Supabase），见 supabase/functions/mim-api/index.ts
--
-- 安全模型：
--   · account_bridge 禁一切客户端 select（password_hash 泄漏 = 密码泄漏）；
--     anon 仅可 insert（与开放注册同暴露面：抢注用户名本就是开放注册允许的）
--   · service_role（Edge Function）绕过 RLS，是唯一读者
--   · 两个 RPC 均为 security definer，内部自行收敛权限
-- ============================================================================

-- ---------- 1. 账号桥表 ----------
create table if not exists public.account_bridge (
  username        text primary key,
  cloudbase_uid   text not null default '',
  password_hash   text not null,
  salt            text not null,
  source          text not null default 'cloudbase' check (source in ('cloudbase', 'import')),
  migrated        boolean not null default false,
  failed_attempts int     not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_account_bridge_migrated on public.account_bridge (migrated);

-- updated_at 自动维护（复用 0001 的 touch_updated_at；若 0001 未执行则补建）
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists account_bridge_touch on public.account_bridge;
create trigger account_bridge_touch
  before update on public.account_bridge
  for each row execute function public.touch_updated_at();

-- ---------- 2. RLS：禁客户端读，anon 可 insert ----------
alter table public.account_bridge enable row level security;

drop policy if exists bridge_anon_insert on public.account_bridge;
create policy bridge_anon_insert on public.account_bridge
  for insert to anon, authenticated
  with check (true);

-- 不建 select / update / delete 策略 ⇒ 客户端一律拒绝；service_role 绕过 RLS
-- （显式 revoke，防止默认 grant 把表整体敞开）
revoke all on public.account_bridge from anon, authenticated;
grant insert on public.account_bridge to anon, authenticated;

-- ---------- 3. RPC：全局用户名查重（注册前预检，anon 可调） ----------
-- 同时覆盖：GoTrue 合成邮箱账号、邮箱直通账号、CloudBase 桥接账号
create or replace function public.username_taken(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(p_username) || '@mim.app'
       or lower(email) = lower(p_username)
  )
  or exists (
    select 1
    from public.account_bridge
    where username = p_username
  );
$$;

revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- ---------- 4. RPC：用户名占用登记（CloudBase mim-api 注册成功后调用，anon 可调） ----------
-- 返回 true = 本次新占用；false = 该用户名已被占用（先到先得）
create or replace function public.claim_username(
  p_username      text,
  p_password_hash text,
  p_salt          text,
  p_uid           text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_bridge (username, cloudbase_uid, password_hash, salt, source)
  values (p_username, p_uid, p_password_hash, p_salt, 'cloudbase')
  on conflict (username) do nothing;
  return exists (
    select 1 from public.account_bridge
    where username = p_username and cloudbase_uid = p_uid
  );
end $$;

revoke all on function public.claim_username(text, text, text, text) from public;
grant execute on function public.claim_username(text, text, text, text) to anon, authenticated;
