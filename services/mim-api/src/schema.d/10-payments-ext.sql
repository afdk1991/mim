-- 支付渠道全量接入（2026-11-13）：扩展渠道（虎皮椒 / 讯虎 / PayPal / Stripe / 支付宝企业支付）专用表。
-- 说明：主库 payment_intents.provider 带四渠道 CHECK 约束且本包不得修改 schema.sql，
--       新增五渠道的意图 / 回调审计 / 退款记录落在本目录独立表，全部语句幂等。
-- 约束：仅 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS；无 DROP / DELETE / 无条件 UPDATE。

-- 扩展渠道支付意图：与 payment_intents 字段对齐，额外记录币种、渠道交易号、客户端密钥与退款状态。
CREATE TABLE IF NOT EXISTS payment_ext_intents (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  purpose          TEXT NOT NULL CHECK (purpose IN ('shop_order','vip','asset','recharge')),
  ref_id           TEXT NOT NULL,
  provider         TEXT NOT NULL CHECK (provider IN ('hupijiao','xunhu','paypal','stripe','alipay_ent')),
  amount_cents     INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'CNY',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  pay_url          TEXT,
  qr_text          TEXT,
  provider_txn_id  TEXT,
  client_secret    TEXT,
  expires_at       TEXT,
  created_at       TEXT NOT NULL,
  paid_at          TEXT,
  refund_status    TEXT,
  refunded_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_ext_intents_user ON payment_ext_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_ext_intents_ref ON payment_ext_intents(purpose, ref_id);

-- 同一渠道交易号全局唯一（NULL 不参与）：回调重放不能结算出第二笔权益，最后一道防线。
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_ext_txn ON payment_ext_intents(provider_txn_id) WHERE provider_txn_id IS NOT NULL;

-- 扩展渠道回调审计：每次第三方回调落一条，便于对账与排查重复通知。
CREATE TABLE IF NOT EXISTS payment_ext_events (
  id         TEXT PRIMARY KEY,
  intent_id  TEXT NOT NULL REFERENCES payment_ext_intents(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  event      TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- 扩展渠道退款记录：一笔意图可多次部分退款，但同一渠道退款单号唯一。
CREATE TABLE IF NOT EXISTS payment_ext_refunds (
  id                TEXT PRIMARY KEY,
  intent_id         TEXT NOT NULL REFERENCES payment_ext_intents(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  provider_refund_id TEXT,
  reason            TEXT NOT NULL DEFAULT '',
  payload           TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_ext_refund_txn ON payment_ext_refunds(provider_refund_id) WHERE provider_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_ext_refunds_intent ON payment_ext_refunds(intent_id, created_at DESC);
