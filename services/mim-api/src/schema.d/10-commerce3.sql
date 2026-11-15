-- ============================================================
-- 商业化三期（2026-11-13）：批量改价 / 积分抵扣
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
  target_type     TEXT NOT NULL CHECK (target_type = 'shop_product'),
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
