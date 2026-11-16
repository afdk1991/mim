-- ============================================================
-- 发货闭环与售后（2026-11-15）
-- 全部语句幂等；禁止 DROP / DELETE / 无条件 UPDATE。
-- shipments 表已在主 schema.sql 中定义，这里只补索引。
-- ============================================================

-- 物流状态查询：后台待发货 / 在途筛选与用户订单详情
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);

-- ---------- 售后申请 ----------
-- 用户对已支付订单发起售后；后台审核。approved 只表示同意，实际退款仍走既有退款接口。
CREATE TABLE IF NOT EXISTS after_sales_requests (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES shop_orders(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('refund_only', 'return_refund', 'repair')),
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note  TEXT,
  handled_by  TEXT,
  handled_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_after_sales_status ON after_sales_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_after_sales_requests_user ON after_sales_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_after_sales_order ON after_sales_requests(order_id);
