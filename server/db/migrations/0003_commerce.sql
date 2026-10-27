/* ============================================================================
 * 0003_commerce —— 商品目录 / 商城订单 / 钱包
 *
 * 金额单位铁律（重建重点，根除历史 100 倍错位）：
 *   · mall_orders.amount_fen 为 bigint「分」整数 —— 历史库是 amount int「元」，
 *     曾在退票链路把 ¥189 算成 ¥1.89。重建后全库不再存在任何「元」金额列，
 *     也不建 amount 兼容列，避免新旧两套单位并存再次错算。
 *   · wallet_balances.balance_fen / wallet_txns.fen 同为「分」整数。
 *   · 商品目录沿用历史 *_cents 列名（= 分），与前端 mapProduct(r.price_cents) 对齐。
 *
 * 幂等：create table if not exists / create index if not exists，可重复执行。
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 1. 商品目录（沿用历史列：price_cents = 分）
 * ------------------------------------------------------------------------ */

create table if not exists products (
  id                   text primary key default gen_random_uuid()::text,
  title                text not null default '',
  price_cents          int not null default 0 check (price_cents >= 0),
  original_price_cents int,
  currency             text not null default 'CNY',
  channel              text not null default 'youxuan'
                         check (channel in ('youxuan', 'gexm', 'mix', 'live', 'laal')),
  emoji                text not null default '📦',
  description          text,
  status               text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  stock                int not null default 0 check (stock >= 0),
  sales                int not null default 0 check (sales >= 0),
  sort                 int not null default 0,
  created_by  uuid references users (id) on delete set null,
  created_at           timestamptz not null default now()
);
create index if not exists products_channel_status_idx on products (channel, status, sort);

/* --------------------------------------------------------------------------
 * 2. 商城订单（金额列 amount_fen = 分）
 * ------------------------------------------------------------------------ */

create table if not exists mall_orders (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references users (id) on delete cascade,
  goods_id    text,
  title       text,
  emoji       text,
  amount_fen  bigint not null default 0 check (amount_fen >= 0),
  qty         int not null default 1 check (qty > 0),
  channel     text,
  status      text not null default 'unpaid'
                check (status in ('unpaid', 'awaiting_confirm', 'paid', 'done')),
  pay_channel text,
  proof       jsonb,
  biz_kind    text check (biz_kind in ('seckill', 'local', 'live', 'travel')),
  ext         jsonb,
  biz_status  text,
  at          bigint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_mall_orders_user on mall_orders (user_id, at desc);
create index if not exists idx_mall_orders_biz  on mall_orders (user_id, biz_kind, at desc);

/* --------------------------------------------------------------------------
 * 3. 钱包：余额行 + 流水账本（同样只用「分」）
 * ------------------------------------------------------------------------ */

create table if not exists wallet_balances (
  user_id     uuid primary key references users (id) on delete cascade,
  balance_fen bigint not null default 0 check (balance_fen >= 0),
  plan        text not null default 'BASIC',
  updated_at  timestamptz not null default now()
);

create table if not exists wallet_txs (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references users (id) on delete cascade,
  kind     text not null check (kind in ('recharge', 'consume', 'income')),
  fen      bigint not null check (fen > 0),
  note     text not null default '',
  snapshot jsonb,
  at       bigint not null
);
create index if not exists idx_wallet_txs_user on wallet_txs (user_id, at desc);
