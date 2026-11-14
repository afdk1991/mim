-- ---------- VIP 分级定价规则 + 返佣佣金状态机（2026-11-14）----------
-- 本文件只做增量：新表 / 幂等索引；不 DROP、不覆盖既有数据。
-- 执行顺序：schema.sql → 本目录脚本（升序）→ 存量补列迁移 → 业务种子。
-- 两张表均为全新表：CREATE TABLE IF NOT EXISTS 同时覆盖全新库与存量库升级路径；
-- upgrade-path 测试会先 DROP 这两张表再重开 createDatabase，断言被自动重建。

-- ===== 一、VIP 按模块 / 分类 / 资产类型单独定价规则 =====
-- 优先级（代码侧 resolveVipPrice 固定）：module > category > asset_kind > 原价。
-- level_min 为可享受该规则的最低 VIP 等级；等级不足回落原价，不享受折扣。
-- mode=fixed：price_cents 为固定价（分）；mode=discount：discount_percent 为折扣百分比（1–100）。
CREATE TABLE IF NOT EXISTS vip_price_rules (
  id               TEXT PRIMARY KEY,
  dimension        TEXT NOT NULL CHECK (dimension IN ('module','category','asset_kind')),
  dimension_value  TEXT NOT NULL,
  level_min        INTEGER NOT NULL DEFAULT 1,
  mode             TEXT NOT NULL CHECK (mode IN ('fixed','discount')),
  price_cents      INTEGER,
  discount_percent INTEGER,
  currency         TEXT NOT NULL DEFAULT 'CNY',
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vip_price_rules_dim
  ON vip_price_rules(dimension, dimension_value, enabled);

-- ===== 二、返佣佣金明细（pending / settled / reversed 三态状态机）=====
-- 下单先记 pending，保护期（MIM_REFERRAL_PROTECT_DAYS，缺省 7 天）内不可结算；
-- 到期由 settleDueCommissions 批量转 settled 并并入钱包余额（写 commission 流水）；
-- 退款时 reverseCommission 冲正：未结算置 reversed，已结算从余额扣回并写负向流水。
-- level=1 直邀人，level=2 二级（MIM_REFERRAL_L2_RATE，缺省 0 关闭）。
-- referrals 原表 status 语义保持兼容（bound → settled），本表承担完整状态机与对账明细。
CREATE TABLE IF NOT EXISTS referral_commissions (
  id           TEXT PRIMARY KEY,
  referral_id  TEXT NOT NULL REFERENCES referrals(id),
  inviter_id   TEXT NOT NULL REFERENCES users(id),
  invitee_id   TEXT NOT NULL REFERENCES users(id),
  order_id     TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  rate         REAL NOT NULL,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','reversed')),
  settle_at    TEXT NOT NULL,
  settled_at   TEXT,
  reversed_at  TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  UNIQUE (order_id, inviter_id, level)
);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_inviter
  ON referral_commissions(inviter_id, status, settle_at);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_order
  ON referral_commissions(order_id);
