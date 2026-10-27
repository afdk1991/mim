/* ============================================================================
 * 0004_business —— 商城四大业务：秒杀 / 本地生活 / 直播尖货 / 出行服务
 *
 * 整合自历史迁移 0012_mall_biz.sql，表结构与列名保持不变（前端 mapper 直接读
 * 这些 snake_case 列），仅做两处调整：
 *   ① 外键 auth.users(id) → users(id)（自托管后端没有 auth schema）。
 *   ② 补齐唯一约束（历史库靠应用层保证的那几条「闸门」下沉到库级）。
 *
 * 并发正确性不下放到应用层：库存必须是「同一事务内的行锁 + 条件更新」，
 * 由 src/rpc.js 的 seckill_grab / travel_book 实现（其行为等价历史上的
 * security definer 函数）。
 *
 * 幂等：create table if not exists / create index if not exists，可重复执行。
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 1. 秒杀特惠（gexm）
 * ------------------------------------------------------------------------ */

create table if not exists seckill_sessions (
  id             text primary key default gen_random_uuid()::text,
  goods_id       text not null,
  title          text not null,
  emoji          text not null default '⚡',
  price_cents    int not null,
  orig_cents     int,
  start_at       bigint not null,
  end_at         bigint not null,
  remaining      int not null default 0 check (remaining >= 0),
  total          int not null default 0 check (total >= 0),
  limit_per_user int not null default 1 check (limit_per_user >= 1),
  status         text not null default 'active' check (status in ('active', 'closed'))
);
create index if not exists idx_seckill_sessions_time on seckill_sessions (status, start_at, end_at);

/* 抢购锁：一人一场一行，主键即限购闸门 */
create table if not exists seckill_locks (
  session_id text not null,
  user_id    uuid not null references users (id) on delete cascade,
  qty        int not null default 1 check (qty >= 1),
  order_id   text,
  expire_at  bigint not null,
  created_at bigint not null,
  primary key (session_id, user_id)
);
create index if not exists idx_seckill_locks_expire on seckill_locks (expire_at);

/* --------------------------------------------------------------------------
 * 2. 本地生活（mix）：门店 / 套餐券 / 券码
 * ------------------------------------------------------------------------ */

create table if not exists local_merchants (
  id       text primary key default gen_random_uuid()::text,
  name     text not null,
  address  text not null default '',
  category text not null default '美食',
  emoji    text not null default '🏪',
  lng      double precision,
  lat      double precision,
  hours    text,
  phone    text
);

create table if not exists local_vouchers (
  id          text primary key default gen_random_uuid()::text,
  merchant_id text not null references local_merchants (id) on delete cascade,
  goods_id    text,
  title       text not null,
  emoji       text not null default '🎫',
  price_cents int not null,
  value_cents int not null,
  valid_until bigint not null,
  rules       jsonb not null default '[]'::jsonb,
  remaining   int not null default 0 check (remaining >= 0),
  status      text not null default 'active' check (status in ('active', 'off'))
);
create index if not exists idx_local_vouchers_merchant on local_vouchers (merchant_id, status);

/* 券码：一单一码，核销为一次性状态转移 */
create table if not exists local_voucher_codes (
  code        text primary key,
  order_id    text not null,
  voucher_id  text not null,
  merchant_id text not null,
  user_id     uuid not null references users (id) on delete cascade,
  status      text not null default 'unused'
                check (status in ('unused', 'used', 'expired', 'refunding', 'refunded')),
  expire_at   bigint not null,
  used_at     bigint,
  unique (order_id)
);
create index if not exists idx_voucher_codes_user  on local_voucher_codes (user_id, expire_at desc);
create index if not exists idx_voucher_codes_order on local_voucher_codes (order_id);

/* --------------------------------------------------------------------------
 * 3. 直播尖货（live）
 * ------------------------------------------------------------------------ */

create table if not exists live_rooms (
  id           text primary key default gen_random_uuid()::text,
  title        text not null,
  anchor_id    uuid references users (id) on delete set null,
  anchor_name  text not null default '主播',
  anchor_emoji text not null default '🎤',
  status       text not null default 'live' check (status in ('preview', 'live', 'ended')),
  started_at   bigint not null,
  viewers      int not null default 0,
  cover        text
);
create index if not exists idx_live_rooms_status on live_rooms (status, started_at desc);

create table if not exists live_shelf (
  room_id    text not null references live_rooms (id) on delete cascade,
  goods_id   text not null,
  title      text not null,
  emoji      text not null default '📦',
  live_cents int not null,
  orig_cents int,
  seq        int not null default 0,
  explaining boolean not null default false,
  primary key (room_id, goods_id)
);
create index if not exists idx_live_shelf_room on live_shelf (room_id, seq);

/* --------------------------------------------------------------------------
 * 4. 出行服务（laal）：票种 / 日期库存 / 退改规则
 * ------------------------------------------------------------------------ */

create table if not exists travel_tickets (
  id          text primary key default gen_random_uuid()::text,
  kind        text not null check (kind in ('flight', 'train', 'bus', 'hotel', 'scenic')),
  title       text not null,
  emoji       text not null default '🎫',
  from_city   text not null default '',
  to_city     text not null default '',
  price_cents int not null,
  seat_classes jsonb not null default '[]'::jsonb,
  status      text not null default 'active' check (status in ('active', 'off'))
);

/* 日期库存：(ticket_id, date) 唯一保证一天一行，扣减走条件更新防超卖 */
create table if not exists travel_date_stock (
  ticket_id   text not null references travel_tickets (id) on delete cascade,
  date        date not null,
  remaining   int not null default 0 check (remaining >= 0),
  price_cents int not null,
  primary key (ticket_id, date)
);
create index if not exists idx_travel_stock_date on travel_date_stock (date, remaining);

create table if not exists travel_rules (
  ticket_id    text primary key references travel_tickets (id) on delete cascade,
  refundable   boolean not null default true,
  changeable   boolean not null default true,
  fee_rate     numeric(4, 3) not null default 0,
  cutoff_hours int not null default 0,
  note         text not null default ''
);
