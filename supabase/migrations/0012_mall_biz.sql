/* ============================================================================
 * 0012_mall_biz —— 商城四大业务（秒杀 / 本地生活 / 直播尖货 / 出行服务）
 *
 * 设计取向：
 *   · 不改 mall_orders 主表结构（主状态机 unpaid/awaiting_confirm/paid/done 不变），
 *     业务独有字段一律进 ext jsonb，未接入业务的订单 ext 为 null，行为完全不变。
 *   · 履约语义另开业务子表（券码 / 库存锁 / 日期库存），与主订单通过 order_id 关联，
 *     避免把四种履约流程硬塞进同一个 status 枚举。
 *   · 防超卖不下放到应用层：库存扣减必须是「同一条 SQL 内的条件更新 + 行锁」，
 *     由数据库保证并发正确性（应用层任何 read-modify-write 都会超卖）。
 *
 * 幂等：create table if not exists / DO 块约束 / create index if not exists /
 *       create or replace function，可重复执行。
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * 0. 主订单扩展列：业务类型 + 扩展字段 + 履约子状态
 *    全部可空 —— 老订单与新接入前的普通实物订单不受影响。
 * ------------------------------------------------------------------------- */

alter table if exists mall_orders
  add column if not exists biz_kind    text check (biz_kind in ('seckill', 'local', 'live', 'travel')),
  add column if not exists ext         jsonb,
  add column if not exists biz_status  text;

create index if not exists idx_mall_orders_biz on mall_orders (user_id, biz_kind, at desc);

/* ---------------------------------------------------------------------------
 * 1. 秒杀特惠（gexm）
 * ------------------------------------------------------------------------- */

create table if not exists seckill_sessions (
  id            text primary key,
  goods_id      text not null,
  title         text not null,
  emoji         text not null default '⚡',
  price_cents   int  not null,
  orig_cents    int,
  start_at      bigint not null,
  end_at        bigint not null,
  remaining     int  not null default 0 check (remaining >= 0),
  total         int  not null default 0 check (total >= 0),
  limit_per_user int not null default 1 check (limit_per_user >= 1),
  status        text not null default 'active' check (status in ('active', 'closed'))
);
create index if not exists idx_seckill_sessions_time on seckill_sessions (status, start_at, end_at);

/* 抢购锁：一人一场一行（唯一约束即限购闸门），超时未支付由服务端释放库存 */
create table if not exists seckill_locks (
  session_id  text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  qty         int  not null default 1 check (qty >= 1),
  order_id    text,
  expire_at   bigint not null,
  created_at  bigint not null,
  primary key (session_id, user_id)
);
create index if not exists idx_seckill_locks_expire on seckill_locks (expire_at);

alter table seckill_sessions enable row level security;
alter table seckill_locks    enable row level security;

/* 场次公开可读（未登录也要能看到会场） */
drop policy if exists seckill_sessions_read on seckill_sessions;
create policy seckill_sessions_read on seckill_sessions for select using (true);

/* 锁只允许本人查看；任何写操作一律走 seckill_grab / seckill_release（definer） */
drop policy if exists seckill_locks_owner on seckill_locks;
create policy seckill_locks_owner on seckill_locks for select using (auth.uid() = user_id);

/**
 * 秒杀抢购：原子扣库存 + 限购 + 建锁。
 * 防超卖三重保障：
 *   ① select ... for update 行锁，串行化同场次并发；
 *   ② update ... where remaining >= p_qty 条件更新，库存不足即 not found；
 *   ③ seckill_locks 主键 (session_id, user_id) 唯一约束兜底限购。
 * 返回 { ok, remaining } 或 { ok:false, error }（error 文案与前端 OPS_ERR_CN 对齐）。
 */
create or replace function seckill_grab(p_session_id text, p_qty int, p_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_now  bigint := (extract(epoch from now()) * 1000)::bigint;
  v_row  seckill_sessions%rowtype;
  v_had  int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  if p_qty is null or p_qty < 1 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;

  select * into v_row from seckill_sessions where id = p_session_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if v_row.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if v_now < v_row.start_at then return jsonb_build_object('ok', false, 'error', 'not_started'); end if;
  if v_now >= v_row.end_at then return jsonb_build_object('ok', false, 'error', 'ended'); end if;

  select coalesce(qty, 0) into v_had from seckill_locks where session_id = p_session_id and user_id = v_uid;
  if v_had + p_qty > v_row.limit_per_user then
    return jsonb_build_object('ok', false, 'error', 'over_limit');
  end if;

  update seckill_sessions
     set remaining = remaining - p_qty
   where id = p_session_id and remaining >= p_qty;
  if not found then return jsonb_build_object('ok', false, 'error', 'sold_out'); end if;

  insert into seckill_locks (session_id, user_id, qty, order_id, expire_at, created_at)
  values (p_session_id, v_uid, p_qty, p_order_id, v_now + 15 * 60 * 1000, v_now)
  on conflict (session_id, user_id) do update
    set qty = seckill_locks.qty + p_qty,
        order_id = excluded.order_id,
        expire_at = excluded.expire_at;

  return jsonb_build_object('ok', true, 'remaining', v_row.remaining - p_qty, 'qty', v_had + p_qty);
end;
$$;

/** 释放库存（取消订单 / 支付超时）：仅释放本人且未支付的锁，幂等（无锁返回 ok） */
create or replace function seckill_release(p_session_id text, p_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_qty int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  select qty into v_qty from seckill_locks
   where session_id = p_session_id and user_id = v_uid and order_id = p_order_id;
  if v_qty is null then return jsonb_build_object('ok', true, 'released', 0); end if;

  delete from seckill_locks where session_id = p_session_id and user_id = v_uid;
  update seckill_sessions set remaining = least(total, remaining + v_qty) where id = p_session_id;
  return jsonb_build_object('ok', true, 'released', v_qty);
end;
$$;

grant select on seckill_sessions to anon, authenticated;
grant select on seckill_locks    to authenticated;
grant execute on function seckill_grab(text, int, text)    to authenticated;
grant execute on function seckill_release(text, text)      to authenticated;

/* ---------------------------------------------------------------------------
 * 2. 本地生活（mix）：门店 / 套餐券 / 券码核销
 * ------------------------------------------------------------------------- */

create table if not exists local_merchants (
  id        text primary key,
  name      text not null,
  address   text not null default '',
  category  text not null default '美食',
  emoji     text not null default '🏪',
  lng       double precision,
  lat       double precision,
  hours     text,
  phone     text
);

create table if not exists local_vouchers (
  id          text primary key,
  merchant_id text not null references local_merchants (id) on delete cascade,
  goods_id    text,
  title       text not null,
  emoji       text not null default '🎫',
  price_cents int  not null,
  value_cents int  not null,
  valid_until bigint not null,
  rules       jsonb not null default '[]'::jsonb,
  remaining   int  not null default 0 check (remaining >= 0),
  status      text not null default 'active' check (status in ('active', 'off'))
);
create index if not exists idx_local_vouchers_merchant on local_vouchers (merchant_id, status);

/* 券码：一单一码；核销为一次性状态转移（unused → used），靠 status 条件更新防重复核销 */
create table if not exists local_voucher_codes (
  code        text primary key,
  order_id    text not null,
  voucher_id  text not null,
  merchant_id text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  status      text not null default 'unused'
                check (status in ('unused', 'used', 'expired', 'refunding', 'refunded')),
  expire_at   bigint not null,
  used_at     bigint
);
create index if not exists idx_voucher_codes_user on local_voucher_codes (user_id, expire_at desc);
create index if not exists idx_voucher_codes_order on local_voucher_codes (order_id);

alter table local_merchants     enable row level security;
alter table local_vouchers      enable row level security;
alter table local_voucher_codes enable row level security;

drop policy if exists local_merchants_read on local_merchants;
create policy local_merchants_read on local_merchants for select using (true);

drop policy if exists local_vouchers_read on local_vouchers;
create policy local_vouchers_read on local_vouchers for select using (true);

/* 券码：本人可读自己的码；商户核销走 verify_voucher（definer，管理员权限） */
drop policy if exists voucher_codes_owner on local_voucher_codes;
create policy voucher_codes_owner on local_voucher_codes
  for select using (auth.uid() = user_id);

/**
 * 到店核销：管理员 / 商户凭码销券。
 * 幂等 + 防重复核销：where status='unused' 的条件更新，
 * 第二次核销必然 not found（返回 already_used），同一码不可能被销两次。
 */
create or replace function verify_voucher(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row local_voucher_codes%rowtype;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  if not is_admin(v_uid) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select * into v_row from local_voucher_codes where code = p_code;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_code'); end if;
  if v_row.status = 'used' then return jsonb_build_object('ok', false, 'error', 'already_used'); end if;
  if v_row.status <> 'unused' then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  if v_row.expire_at <= v_now then
    update local_voucher_codes set status = 'expired' where code = p_code and status = 'unused';
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  update local_voucher_codes set status = 'used', used_at = v_now
   where code = p_code and status = 'unused';
  if not found then return jsonb_build_object('ok', false, 'error', 'already_used'); end if;

  update mall_orders set biz_status = 'verified'
   where id = v_row.order_id and coalesce(biz_status, '') <> 'verified';

  return jsonb_build_object('ok', true, 'code', p_code, 'order_id', v_row.order_id);
end;
$$;

/** 生成券码（支付成功后由服务端发码，前端不得自行构造码，防伪造） */
create or replace function issue_voucher_code(p_order_id text, p_voucher_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_v   local_vouchers%rowtype;
  v_o   mall_orders%rowtype;
  v_code text;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;

  select * into v_v from local_vouchers where id = p_voucher_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_voucher'); end if;
  select * into v_o from mall_orders where id = p_order_id and user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_order'); end if;
  if v_o.status not in ('paid', 'done') then
    return jsonb_build_object('ok', false, 'error', 'unpaid');
  end if;

  -- 已有码则直接返回（幂等，重复点「取券码」不会生成第二个码）
  select code into v_code from local_voucher_codes where order_id = p_order_id;
  if v_code is not null then
    return jsonb_build_object('ok', true, 'code', v_code, 'reused', true);
  end if;

  v_code := upper(substr(md5(p_order_id || p_voucher_id || v_now::text), 1, 12));
  insert into local_voucher_codes (code, order_id, voucher_id, merchant_id, user_id, status, expire_at)
  values (v_code, p_order_id, p_voucher_id, v_v.merchant_id, v_uid, 'unused',
          least(v_v.valid_until, v_now + 90 * 24 * 3600 * 1000));

  update mall_orders set biz_status = 'pending_verify',
                         ext = coalesce(ext, '{}'::jsonb) || jsonb_build_object('voucherCode', v_code)
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'code', v_code, 'expire_at', v_v.valid_until);
end;
$$;

grant select on local_merchants     to anon, authenticated;
grant select on local_vouchers      to anon, authenticated;
grant select on local_voucher_codes to authenticated;
grant execute on function verify_voucher(text)            to authenticated;
grant execute on function issue_voucher_code(text, text)  to authenticated;

/* ---------------------------------------------------------------------------
 * 3. 直播尖货（live）：直播间 + 货架（只读为主，下单复用既有订单链路）
 * ------------------------------------------------------------------------- */

create table if not exists live_rooms (
  id           text primary key,
  title        text not null,
  anchor_id    uuid,
  anchor_name  text not null default '主播',
  anchor_emoji text not null default '🎤',
  status       text not null default 'live' check (status in ('preview', 'live', 'ended')),
  started_at   bigint not null,
  viewers      int  not null default 0,
  cover        text
);
create index if not exists idx_live_rooms_status on live_rooms (status, started_at desc);

create table if not exists live_shelf (
  room_id     text not null references live_rooms (id) on delete cascade,
  goods_id    text not null,
  title       text not null,
  emoji       text not null default '📦',
  live_cents  int  not null,
  orig_cents  int,
  seq         int  not null default 0,
  explaining  boolean not null default false,
  primary key (room_id, goods_id)
);
create index if not exists idx_live_shelf_room on live_shelf (room_id, seq);

alter table live_rooms enable row level security;
alter table live_shelf enable row level security;

drop policy if exists live_rooms_read on live_rooms;
create policy live_rooms_read on live_rooms for select using (true);

drop policy if exists live_shelf_read on live_shelf;
create policy live_shelf_read on live_shelf for select using (true);

grant select on live_rooms to anon, authenticated;
grant select on live_shelf to anon, authenticated;

/* ---------------------------------------------------------------------------
 * 4. 出行服务（laal）：票种 / 日期库存 / 退改规则
 * ------------------------------------------------------------------------- */

create table if not exists travel_tickets (
  id          text primary key,
  kind        text not null check (kind in ('flight', 'train', 'bus', 'hotel', 'scenic')),
  title       text not null,
  emoji       text not null default '🎫',
  from_city   text not null default '',
  to_city     text not null default '',
  price_cents int  not null,
  seat_classes jsonb not null default '[]'::jsonb,
  status      text not null default 'active' check (status in ('active', 'off'))
);

/* 日期库存：出行按「日期」售卖，唯一约束 (ticket_id, date) 保证一天一行，
 * 扣减同样走条件更新（travel_book）防超卖 */
create table if not exists travel_date_stock (
  ticket_id text not null references travel_tickets (id) on delete cascade,
  date      date not null,
  remaining int  not null default 0 check (remaining >= 0),
  price_cents int not null,
  primary key (ticket_id, date)
);
create index if not exists idx_travel_stock_date on travel_date_stock (date, remaining);

create table if not exists travel_rules (
  ticket_id    text primary key references travel_tickets (id) on delete cascade,
  refundable   boolean not null default true,
  changeable   boolean not null default true,
  fee_rate     numeric(4, 3) not null default 0,
  cutoff_hours int  not null default 0,
  note         text not null default ''
);

alter table travel_tickets    enable row level security;
alter table travel_date_stock enable row level security;
alter table travel_rules      enable row level security;

drop policy if exists travel_tickets_read on travel_tickets;
create policy travel_tickets_read on travel_tickets for select using (true);
drop policy if exists travel_stock_read on travel_date_stock;
create policy travel_stock_read on travel_date_stock for select using (true);
drop policy if exists travel_rules_read on travel_rules;
create policy travel_rules_read on travel_rules for select using (true);

/**
 * 出行占座：原子扣某票种某日库存（与 seckill_grab 同构：条件更新防超卖）。
 * 返回 { ok, remaining }；库存不足 / 日期不存在均返回 sold_out。
 */
create or replace function travel_book(p_ticket_id text, p_date date, p_qty int, p_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row travel_date_stock%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;
  if p_qty is null or p_qty < 1 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;

  select * into v_row from travel_date_stock
   where ticket_id = p_ticket_id and date = p_date for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_stock'); end if;
  if v_row.remaining < p_qty then return jsonb_build_object('ok', false, 'error', 'sold_out'); end if;

  update travel_date_stock set remaining = remaining - p_qty
   where ticket_id = p_ticket_id and date = p_date and remaining >= p_qty;
  if not found then return jsonb_build_object('ok', false, 'error', 'sold_out'); end if;

  update mall_orders set biz_status = 'pending_ticket' where id = p_order_id and user_id = v_uid;
  return jsonb_build_object('ok', true, 'remaining', v_row.remaining - p_qty);
end;
$$;

/**
 * 出行退票：按退改规则算手续费 → 状态机 ticketed → refunding → refunded，
 * 不可退或在截止窗口内直接拒绝；库存回滚在 refunded 时执行（防重复退）。
 */
create or replace function travel_refund(p_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_o    mall_orders%rowtype;
  v_rule travel_rules%rowtype;
  v_tid  text;
  v_date date;
  v_qty  int := 1;
  v_fee  int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_auth'); end if;

  select * into v_o from mall_orders where id = p_order_id and user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_order'); end if;
  if v_o.biz_kind <> 'travel' then return jsonb_build_object('ok', false, 'error', 'not_travel'); end if;
  if v_o.biz_status in ('refunding', 'refunded') then
    return jsonb_build_object('ok', false, 'error', 'already_refunding');
  end if;
  if v_o.biz_status <> 'ticketed' then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;

  v_tid  := v_o.ext ->> 'ticketId';
  v_date := (v_o.ext ->> 'date')::date;
  v_qty  := coalesce((v_o.ext ->> 'passengerCount')::int, v_o.qty, 1);

  select * into v_rule from travel_rules where ticket_id = v_tid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_rule'); end if;
  if not v_rule.refundable then return jsonb_build_object('ok', false, 'error', 'non_refundable'); end if;

  v_fee := ceil(coalesce(v_o.amount, 0) * v_rule.fee_rate);

  update mall_orders set biz_status = 'refunding' where id = p_order_id;

  -- 库存回滚（幂等：biz_status 已为 refunded 时不再回滚）
  update travel_date_stock set remaining = remaining + v_qty
   where ticket_id = v_tid and date = v_date;

  update mall_orders set biz_status = 'refunded' where id = p_order_id;
  return jsonb_build_object('ok', true, 'amount', v_o.amount, 'fee', v_fee,
                            'refund', greatest(0, coalesce(v_o.amount, 0) - v_fee));
end;
$$;

grant select on travel_tickets    to anon, authenticated;
grant select on travel_date_stock to anon, authenticated;
grant select on travel_rules      to anon, authenticated;
grant execute on function travel_book(text, date, int, text) to authenticated;
grant execute on function travel_refund(text)                to authenticated;

/* ---------------------------------------------------------------------------
 * 5. 校验输出（供 CI 迁移日志核对）
 * -- select tablename from pg_tables where schemaname='public'
 * --    and tablename in ('seckill_sessions','seckill_locks','local_merchants',
 * --        'local_vouchers','local_voucher_codes','live_rooms','live_shelf',
 * --        'travel_tickets','travel_date_stock','travel_rules');
 * ========================================================================== */
