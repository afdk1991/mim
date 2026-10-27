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
