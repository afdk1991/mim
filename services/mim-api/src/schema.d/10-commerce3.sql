-- ============================================================
-- 商业化三期（2026-11-13）：批量改价 / 积分抵扣 / 分类级权限
-- 全部语句幂等；禁止 DROP / DELETE / 无条件 UPDATE。
-- 已有表补列走 ALTER_ADD 指令行（加载器先补列再执行其余语句）。
-- ============================================================

-- ---------- 批量改价：批次头表 ----------
-- 一次调价一批：模式（fixed/percent/amount）、方向（set/increase/decrease）、
-- 筛选条件快照、命中 / 改动 / 跳过计数与回滚时间。幂等键按操作人隔离，重复提交回放同一批。
CREATE TABLE IF NOT EXISTS price_batches (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('module', 'shop_product')),
  mode            TEXT NOT NULL CHECK (mode IN ('fixed', 'percent', 'amount')),
  direction       TEXT NOT NULL CHECK (direction IN ('set', 'increase', 'decrease')),
  value           INTEGER NOT NULL,
  filter_json     TEXT NOT NULL,
  total           INTEGER NOT NULL DEFAULT 0,
  changed         INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  rolled_back_at  TEXT,
  UNIQUE (actor_id, idempotency_key)
);

-- ---------- 批量改价：改前 / 改后快照明细 ----------
-- 每条命中目标一行：before/after 快照供「回滚到上一批」与审计追溯；
-- skipped=1 表示按安全规则未改动（如 0 价免费商品不参与调价），reason 记录原因。
CREATE TABLE IF NOT EXISTS price_batch_items (
  id                  TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES price_batches(id),
  target_type         TEXT NOT NULL,
  target_id           TEXT NOT NULL,
  price_row_id        TEXT,
  target_code         TEXT,
  currency            TEXT,
  before_amount_minor INTEGER,
  after_amount_minor  INTEGER,
  skipped             INTEGER NOT NULL DEFAULT 0,
  reason              TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_batch_items_batch ON price_batch_items(batch_id);

-- ---------- 分类级权限规则 ----------
-- 在既有 RBAC 之上叠加分类维度：subject_type=role 按角色码、user 按用户 ID；
-- category_slug 命中一级 slug（前缀覆盖二级）或二级 slug（精确）；
-- effect=deny 优先于 allow；无任何规则命中时保持现网公开行为（兼容 0.0.6）。
CREATE TABLE IF NOT EXISTS category_access_rules (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('role', 'user')),
  subject_id    TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  effect        TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (subject_type, subject_id, category_slug)
);
CREATE INDEX IF NOT EXISTS idx_category_access_subject ON category_access_rules(subject_type, subject_id);

-- ---------- 模块订单补列：积分抵扣留痕 ----------
-- points_spent：本单消耗的积分；points_deduct_cents：积分折抵的金额（分）。
-- 订单原始成交价 amount_minor 不变，抵扣额单列留痕，便于对账与退款回滚。
ALTER_ADD: module_orders.points_spent INTEGER NOT NULL DEFAULT 0
ALTER_ADD: module_orders.points_deduct_cents INTEGER NOT NULL DEFAULT 0
