-- ==============================================================================
-- Mim · 待补齐迁移一键脚本（供 Supabase Dashboard → SQL Editor 粘贴执行）
-- 生成时间：2026-10-27T16:41:41.951Z
-- 生成命令：npm run db:gen-pending -- 0008（与 CI 迁移计划同源，顺序一致）
--
-- 适用范围：线上库尚未应用「0008 及之后」的迁移时补齐。当前包含：
--   · 0008_mall.sql
--   · 0009_price_rec.sql
--   · 0010_admin_bootstrap.sql
--   · 0011_mall_ops_key.sql
--
-- 如何确认是否需要执行：
--   npm run db:probe
--   （只读探测，列出前端引用但线上缺失的表 / 函数及其所属迁移）
--
-- 执行方式：Dashboard → SQL Editor → 粘贴本文件全部内容 → Run（无需数据库密码）
--
-- 幂等：全部使用 create table if not exists / create or replace function /
--       add column if not exists / drop policy if exists + create policy，
--       可重复执行，不触碰既有数据。
-- ==============================================================================

-- ==============================================================================
-- 0008_mall.sql
-- ==============================================================================

/* ============================================================================
 * 0008_mall —— 商城订单后端化 + 支付核销口令后端化（P0 资金安全：根除欺诈漏洞）
 *
 * 现状：订单存浏览器 localStorage；管理员核销口令由前端 checkOperatorKey 比对
 * SITE_CONFIG.payConfirmKey，口令一旦配置即随 JS 包明文暴露，任何人可自确认订单、
 * 自充余额（资金欺诈）。本迁移：
 *   · mall_orders —— 订单表（真源从 localStorage 挪到数据库，按 user_id 隔离）
 *   · RLS：本人可读自己订单；核销由服务端 RPC 处理
 *   · confirm_order(p_order_id, p_key) RPC（SECURITY DEFINER）：
 *       - 仅 is_admin 用户可核销（is_admin 由 user_roles 判定）
 *       - 口令在服务端比对（来自安全配置，永不下发前端）
 *       - awaiting_confirm → paid，返 5% 积分由调用方处理
 *   注：CloudBase 备模式同名逻辑在 CloudBase 云函数 + PG 函数实现，本文件为
 *       Supabase 主模式资产。前端 supply 的口令仅透传，不存储、不比对。
 * ========================================================================== */

create table if not exists mall_orders (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  goods_id    text,
  title       text,
  emoji       text,
  amount      integer not null,           -- 元
  qty         integer not null default 1,
  channel     text,
  status      text not null default 'unpaid'
                check (status in ('unpaid', 'awaiting_confirm', 'paid', 'done')),
  pay_channel text,
  proof       jsonb,
  at          bigint not null
);
create index if not exists idx_mall_orders_user on mall_orders (user_id, at desc);

alter table mall_orders enable row level security;

drop policy if exists mall_orders_owner on mall_orders;
create policy mall_orders_owner on mall_orders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* is_admin 判定（user_roles 表，role='admin'） */
create or replace function is_admin(p_uid uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from user_roles where user_id = p_uid and role = 'admin'
  );
$$;

/* 服务端核销：口令比对在服务端进行（来自安全配置），前端只透传用户输入 */
create or replace function confirm_order(p_order_id text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  cfg text;
  o mall_orders%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  if not is_admin(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 核销口令来自服务端安全配置（vault/函数常量），此处占位由部署注入
  -- 实际比对在 Edge Function / 云函数层完成，本 RPC 仅做状态机转移。
  select * into o from mall_orders where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_order'); end if;
  if o.status <> 'awaiting_confirm' then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  update mall_orders set status = 'paid' where id = p_order_id;
  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'amount', o.amount);
end;
$$;

grant execute on function is_admin(uuid) to authenticated;
grant execute on function confirm_order(text, text) to authenticated;

-- ==============================================================================
-- 0009_price_rec.sql
-- ==============================================================================

-- P1 后端化增量迁移（Supabase 源码资产 · 与 cloudbase/migrations/20261028000000_price_rec.sql 同构）
-- 主后端为 CloudBase；本文件为 supabase 备后端的同源实现，使用 auth.uid() 取当前用户。
-- price 回源 cron 在 supabase 侧需经 pg_cron + Edge Function 实现，本 RPC 仅提供读取快照。

-- ---------------------------------------------------------------------------
-- 价格行情快照（P1-1）：服务端回源写入，前端只读
-- ---------------------------------------------------------------------------
create table if not exists price_quotes (
  coin_id    text primary key,
  price_cny  numeric(24,8) not null,
  change_24h numeric(12,4) not null default 0,
  at         bigint not null
);
create index if not exists idx_price_quotes_at on price_quotes (at desc);

-- 读取行情快照（公开读，不依赖登录）
create or replace function price_latest(p_ids text[] default null)
returns jsonb language plpgsql security definer as $$
declare
  rows record;
  out jsonb := '{}'::jsonb;
begin
  if p_ids is null then
    for rows in select coin_id, price_cny, change_24h, at from price_quotes loop
      out := jsonb_set(out, array[rows.coin_id],
        jsonb_build_object('price', rows.price_cny, 'change', rows.change_24h, 'at', rows.at));
    end loop;
  else
    for rows in select coin_id, price_cny, change_24h, at from price_quotes
               where coin_id = any(p_ids) loop
      out := jsonb_set(out, array[rows.coin_id],
        jsonb_build_object('price', rows.price_cny, 'change', rows.change_24h, 'at', rows.at));
    end loop;
  end if;
  return out;
end;
$$;
grant execute on function price_latest(text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 推荐负反馈 / 同城定位（P1-2）：云端真源，auth.uid() 隔离
-- ---------------------------------------------------------------------------
create table if not exists rec_feedback (
  user_id text primary key,
  authors jsonb not null default '[]'::jsonb,
  topics  jsonb not null default '[]'::jsonb,
  city    text   not null default '北京市',
  updated_at timestamptz not null default now()
);

create or replace function rec_feedback_get()
returns jsonb language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  fb rec_feedback%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select * into fb from rec_feedback where user_id = v_uid::text;
  if not found then
    return jsonb_build_object('ok', true, 'exists', false, 'authors', '[]'::jsonb, 'topics', '[]'::jsonb, 'city', '北京市');
  end if;
  return jsonb_build_object(
    'ok', true, 'exists', true,
    'authors', coalesce(fb.authors, '[]'::jsonb),
    'topics',  coalesce(fb.topics, '[]'::jsonb),
    'city',    fb.city
  );
end;
$$;

create or replace function rec_feedback_save(p_authors jsonb, p_topics jsonb, p_city text)
returns jsonb language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  insert into rec_feedback(user_id, authors, topics, city, updated_at)
  values (
    v_uid::text,
    coalesce(p_authors, '[]'::jsonb),
    coalesce(p_topics, '[]'::jsonb),
    coalesce(nullif(btrim(p_city), ''), '北京市'),
    now()
  )
  on conflict (user_id) do update
    set authors = excluded.authors,
        topics  = excluded.topics,
        city    = excluded.city,
        updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function rec_feedback_get() to authenticated;
grant execute on function rec_feedback_save(jsonb, jsonb, text) to authenticated;

-- ==============================================================================
-- 0010_admin_bootstrap.sql
-- ==============================================================================

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

-- ==============================================================================
-- 0011_mall_ops_key.sql
-- ==============================================================================

-- ============================================================================
-- 0011 · 商城核销口令后端化（服务端安全存储 + 真比对）
--
-- 背景（实测缺陷，与 0008 的设计承诺不符）：
--   0008 建了 mall_orders 与 confirm_order(p_order_id, p_key)，但其注释写明
--   「口令在服务端比对（来自安全配置）……实际比对在 Edge Function / 云函数层完成，
--   本 RPC 仅做状态机转移」——而 Supabase 侧的 Edge Function 并没有 /mall 路由，
--   于是主模式下口令**根本没有被任何地方比对**：
--     · confirm_order 只做 awaiting_confirm → paid 的状态转移
--     · 前端 mallVerifyKey 还用 p_order_id = '' 去「撞」confirm_order 做口令校验，
--       拿到 { ok:false, error:'no_order' } 却只看 RPC 传输错误 ⇒ 误判为校验通过
--   ⇒ 只要拥有 admin 角色，任意口令都能核销；且非 admin 也拿不到任何拒绝信号。
--
--   对照 CloudBase 备后端：口令来自云函数环境变量 MIM_PAY_CONFIRM_KEY，服务端比对，
--   未配置即拒绝 —— 两侧语义长期不一致，本迁移把 Supabase 侧补齐到同一水平。
--
-- 方案（库内实现，不依赖 Edge Function 部署）：
--   · mall_ops_config：口令安全存储。启用 RLS 且**不建任何策略** ⇒
--     anon / authenticated 一律无法通过 PostgREST 读写；仅 security definer 函数
--     （以 owner 身份执行）可访问，浏览器无任何读取通道。
--   · verify_ops_key(p_key)：仅 admin 可调，fail-closed（未配置 / 不匹配均拒绝）
--   · set_mall_ops_key(p_key)：仅 admin 可写入/轮换口令
--   · confirm_order 重定义：真正比对口令后再做状态机转移
-- ============================================================================

-- ---------- 1. 口令安全存储 ----------
create table if not exists public.mall_ops_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.mall_ops_config enable row level security;
-- 故意不建任何策略：默认拒绝一切基于 RLS 角色的访问（含 anon / authenticated）。
-- 读取只能经下方 security definer 函数完成，口令永不下发浏览器。

-- ---------- 2. 内部比对（不对外授权） ----------
create or replace function public.mall_ops_key_ok(p_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_key is not null
     and p_key <> ''
     and exists (
       select 1 from public.mall_ops_config
       where key = 'pay_confirm_key' and value = p_key
     );
$$;
-- 不 grant 给 anon / authenticated：仅供下方 definer 函数内部调用。

-- ---------- 3. 管理员校验口令（前端入口） ----------
create or replace function public.verify_ops_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_auth');
  end if;
  if not public.is_admin(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (select 1 from public.mall_ops_config where key = 'pay_confirm_key') then
    return jsonb_build_object('ok', false, 'error', 'unconfigured');
  end if;
  if not public.mall_ops_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'error', 'bad_key');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.verify_ops_key(text) to authenticated;

-- ---------- 4. 管理员写入 / 轮换口令 ----------
create or replace function public.set_mall_ops_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_auth');
  end if;
  if not public.is_admin(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(length(p_key), 0) < 6 then
    return jsonb_build_object('ok', false, 'error', 'too_short');
  end if;
  insert into public.mall_ops_config (key, value, updated_at)
  values ('pay_confirm_key', p_key, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.set_mall_ops_key(text) to authenticated;

-- ---------- 5. confirm_order 重定义：先比对口令，再做状态机转移 ----------
create or replace function public.confirm_order(p_order_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o     public.mall_orders%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_auth');
  end if;
  if not public.is_admin(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- 口令未配置 ⇒ 核销通道关闭（fail-closed，避免「无口令即任意核销」）
  if not exists (select 1 from public.mall_ops_config where key = 'pay_confirm_key') then
    return jsonb_build_object('ok', false, 'error', 'unconfigured');
  end if;
  if not public.mall_ops_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'error', 'bad_key');
  end if;

  select * into o from public.mall_orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_order');
  end if;
  if o.status <> 'awaiting_confirm' then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;

  update public.mall_orders set status = 'paid' where id = p_order_id;
  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'amount', o.amount);
end;
$$;

grant execute on function public.confirm_order(text, text) to authenticated;

-- ---------- 6. 自检入口：口令通道当前是否可用 ----------
create or replace function public.ops_key_ready()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'configured', exists (select 1 from public.mall_ops_config where key = 'pay_confirm_key')
  );
$$;

grant execute on function public.ops_key_ready() to authenticated;

-- ==============================================================================
-- 记录已应用版本（使 CI 后续自动跳过，避免重复执行）
-- ==============================================================================

insert into public.schema_migrations (version) values ('0008_mall.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0009_price_rec.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0010_admin_bootstrap.sql') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0011_mall_ops_key.sql') on conflict (version) do nothing;

-- ==============================================================================
-- 执行后自检（重跑 npm run db:probe 应全部 ✅）
-- ==============================================================================
