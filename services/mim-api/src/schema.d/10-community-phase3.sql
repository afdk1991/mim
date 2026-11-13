-- ---------- 社区论坛三期（2026-11-13）----------
-- 本文件只做增量：新表 / 补列 / 幂等种子；不 DROP、不 DELETE、不无覆盖既有板块。
-- 执行顺序：schema.sql → 本目录脚本（升序）→ 存量补列迁移 → 业务种子。
-- 因此本文件内的 INSERT OR IGNORE 先于 db.ts 的 seedCommunity 执行，
-- 重复主键时 seedCommunity 的 INSERT OR IGNORE 自动跳过，不会覆盖本文件写入的定价。

-- ===== 一、既有表补列（ALTER_ADD: 表.列 <定义>，列已存在则跳过）=====

-- 板块审核状态：active 已上架 / pending 待审核 / rejected 审核驳回。
ALTER_ADD: community_boards.status TEXT NOT NULL DEFAULT 'active'
-- 审核备注（驳回原因 / 运营留痕）。
ALTER_ADD: community_boards.review_note TEXT
-- 审核时间（ISO 时间戳；NULL 表示尚未审核）。
ALTER_ADD: community_boards.reviewed_at TEXT
-- 发帖频控：滑动窗口长度（分钟）；0 表示回落到全局默认。
ALTER_ADD: community_boards.rate_window_minutes INTEGER NOT NULL DEFAULT 0
-- 发帖频控：滑动窗口内最大帖数；0 表示回落到全局默认。
ALTER_ADD: community_boards.rate_window_max INTEGER NOT NULL DEFAULT 0
-- 每日发帖上限（按用户 + 板块）；0 表示回落到全局默认。
ALTER_ADD: community_boards.daily_max INTEGER NOT NULL DEFAULT 0
-- 累计发帖上限（按用户 + 板块）；0 表示回落到全局默认。
ALTER_ADD: community_boards.total_max INTEGER NOT NULL DEFAULT 0
-- 建板块门槛：最低等级（1 起）；0 表示回落到全局默认。
ALTER_ADD: community_boards.create_min_level INTEGER NOT NULL DEFAULT 0
-- 每人可创建板块数上限；0 表示回落到全局默认。
ALTER_ADD: community_boards.create_max_per_user INTEGER NOT NULL DEFAULT 0

-- 推荐指数：由浏览 / 回复 / 收藏 / 评分 + 时间衰减加权计算后回写；sort=recommend 按此列排序。
ALTER_ADD: community_threads.recommend_score REAL NOT NULL DEFAULT 0

-- 独立商城订单积分抵扣留痕（三期收口）：points_spent 本单消耗积分；points_deduct_cents 折抵金额（分）。
-- 原始成交价 amount_cents 与优惠扣减 discount_cents 不变，抵扣额单列留痕，便于对账与退款回滚。
ALTER_ADD: shop_orders.points_spent INTEGER NOT NULL DEFAULT 0
ALTER_ADD: shop_orders.points_deduct_cents INTEGER NOT NULL DEFAULT 0

-- ===== 二、新表：板块 Tab 栏目配置（按板块持久化的模块化组合）=====
-- 缺省 Tab 由代码侧默认清单给出；本表只存被版主改动过的覆盖项，主键 (board_id, tab_key)。
CREATE TABLE IF NOT EXISTS community_board_tab_configs (
  board_id   TEXT NOT NULL REFERENCES community_boards(id) ON DELETE CASCADE,
  tab_key    TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1,
  sort_by    TEXT NOT NULL DEFAULT 'latest',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (board_id, tab_key)
);
CREATE INDEX IF NOT EXISTS idx_community_board_tabs ON community_board_tab_configs(board_id, sort_order);

-- 推荐指数排序索引：状态 + 分数倒序，配合最后活跃时间兜底。
CREATE INDEX IF NOT EXISTS idx_community_threads_recommend ON community_threads(status, recommend_score DESC);

-- ===== 三、付费板块种子（幂等，不覆盖既有板块）=====
-- 1) 全新库路径：先于 seedCommunity 写入 board-paid，带上真实价格与说明；
--    seedCommunity 随后的 INSERT OR IGNORE 命中主键冲突自动跳过，保留这里的定价。
INSERT OR IGNORE INTO community_boards (id, slug, name, description, icon, sort_order, price_cents, created_at)
VALUES (
  'board-paid',
  'paid',
  '知识付费',
  '付费板块：付费阅读、资源下载、图库与视频，加入后可见完整正文与媒体。',
  '🔖',
  4,
  1900,
  CURRENT_TIMESTAMP
);

-- 2) 存量库路径：老库 seedCommunity 已把 board-paid 写成价格 0；此处只在价格仍为 0 时补定价，
--    运营已经手动改过价格（price_cents > 0）的板块保持不动。条件 UPDATE，不无条件覆盖。
UPDATE community_boards
   SET price_cents = 1900
 WHERE slug = 'paid'
   AND price_cents = 0;
