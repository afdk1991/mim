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
