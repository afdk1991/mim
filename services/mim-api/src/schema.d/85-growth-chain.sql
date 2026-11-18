-- 85-growth-chain.sql —— 社区激励链：签到 → 积分 → 等级 → 徽章
-- 只做增量：新表 / 幂等索引 / 幂等种子；不 DROP、不覆盖既有数据。
-- 执行顺序：schema.sql → 本目录脚本（升序）。脚本每次启动都会重跑，所有写入必须幂等。
--
-- 复用点（不另造余额体系）：
--   · 签到发的积分写既有 wallets.points 与 wallet_transactions（kind='points'）；
--   · 等级按「累计获得积分」计算，数据源是 wallet_transactions 里 points > 0 的正向流水；
--   · 徽章条件读既有 checkins（连续签到）、community_threads（发帖数）与用户等级 / 累计积分。

-- ===== 一、签到连续天数 =====
-- 既有 checkins 已带 UNIQUE(user_id, day)，day 为自然日字符串；这里只补连续天数快照列。
-- 旧数据该列由 DEFAULT 1 填充，读取时仍会用逐日回溯校正，避免存量断签被误判为连续。
ALTER_ADD: checkins.streak INTEGER NOT NULL DEFAULT 1
CREATE INDEX IF NOT EXISTS idx_checkins_user_day ON checkins(user_id, day DESC);

-- ===== 二、等级门槛与权益 =====
-- level 从 1 起，min_points 为进入该等级所需累计积分；perks 为权益文案数组 JSON。
-- 管理端整表替换写入，路由层保证 level 连续、min_points 升序且首级为 0。
CREATE TABLE IF NOT EXISTS growth_levels (
  level      INTEGER PRIMARY KEY CHECK (level >= 1),
  name       TEXT NOT NULL,
  min_points INTEGER NOT NULL UNIQUE CHECK (min_points >= 0),
  perks      TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== 三、徽章定义（条件可配置） =====
-- condition_type 决定条件取值口径：
--   checkin_streak → 连续签到天数；level → 用户等级；
--   post_count     → 已发布主题数；points → 累计获得积分。
-- active=0 表示停用：不再自动授予，但已授予记录保留。
CREATE TABLE IF NOT EXISTS growth_badges (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  icon            TEXT NOT NULL DEFAULT '',
  condition_type  TEXT NOT NULL CHECK (condition_type IN ('checkin_streak', 'level', 'post_count', 'points')),
  condition_value INTEGER NOT NULL CHECK (condition_value >= 0),
  active          INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_badges_active ON growth_badges(active, sort_order);

-- ===== 四、徽章授予记录 =====
-- UNIQUE(user_id, badge_code) 保证同一徽章只授予一次；重复授予走 INSERT OR IGNORE。
CREATE TABLE IF NOT EXISTS user_badges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  badge_code TEXT NOT NULL REFERENCES growth_badges(code),
  source     TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'admin')),
  awarded_at TEXT NOT NULL,
  UNIQUE (user_id, badge_code)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, awarded_at DESC);

-- ===== 五、用户成长档案 =====
-- lifetime_points 为累计获得积分（只增不减，消费不扣），level 为按门槛算出的当前等级。
-- 累计积分不能直接用 wallets.points（会因消费/转账减少），必须独立记账。
CREATE TABLE IF NOT EXISTS user_growth (
  user_id         TEXT PRIMARY KEY REFERENCES users(id),
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  level           INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL
);

-- ===== 六、签到规则配置（单行） =====
-- 换天时区默认 Asia/Shanghai，保证「自然日」按站点用户体感划分，而不是 UTC 0 点。
-- 签到积分 = base_points + min(连续天数 - 1, streak_bonus_cap) × streak_bonus_per_day。
CREATE TABLE IF NOT EXISTS growth_config (
  id         TEXT PRIMARY KEY CHECK (id = 'default'),
  config     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== 七、幂等种子 =====
-- 默认五级门槛；已存在则不覆盖，避免每次启动重置运营配置。
INSERT OR IGNORE INTO growth_levels (level, name, min_points, perks, created_at, updated_at) VALUES
  (1, '新人', 0, '["社区基础功能"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, '活跃', 300, '["专属等级标识"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (3, '常驻', 1000, '["专属等级标识","优先参与社区活动"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (4, '资深', 3000, '["专属等级标识","优先参与社区活动","内容优先推荐"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (5, '元老', 8000, '["专属等级标识","优先参与社区活动","内容优先推荐","社区荣誉展示"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 默认徽章：覆盖连续签到、等级、发帖、累计积分四类条件，运营可在后台改阈值或停用。
INSERT OR IGNORE INTO growth_badges (code, name, description, icon, condition_type, condition_value, active, sort_order, created_at, updated_at) VALUES
  ('checkin-7', '七日不辍', '连续签到 7 天', 'calendar', 'checkin_streak', 7, 1, 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('checkin-30', '月满勤', '连续签到 30 天', 'calendar-check', 'checkin_streak', 30, 1, 20, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('level-3', '常驻成员', '达到等级 3', 'level', 'level', 3, 1, 30, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('post-10', '初露锋芒', '发布 10 篇主题', 'post', 'post_count', 10, 1, 40, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 默认签到规则：基础 5 分，连续每天 +1，加成封顶 +10。
INSERT OR IGNORE INTO growth_config (id, config, updated_at)
VALUES ('default', '{"timezone":"Asia/Shanghai","checkin":{"base_points":5,"streak_bonus_per_day":1,"streak_bonus_cap":10}}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ===== 八、存量用户成长档案回填（幂等） =====
-- 只给还没有档案的用户回填：累计积分 = 钱包流水里所有正向积分之和。
-- 新用户见面礼 100 分属于正向流水，会计入累计积分，符合既有「开箱 100 分」口径。
INSERT OR IGNORE INTO user_growth (user_id, lifetime_points, level, updated_at)
SELECT user_id, SUM(points), 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM wallet_transactions
WHERE points > 0
GROUP BY user_id;

-- 按最新等级门槛校准所有档案等级；只在等级不一致时更新，重复执行无副作用。
UPDATE user_growth
SET level = COALESCE((SELECT MAX(level) FROM growth_levels l WHERE l.min_points <= user_growth.lifetime_points), 1),
    updated_at = user_growth.updated_at
WHERE level <> COALESCE((SELECT MAX(level) FROM growth_levels l WHERE l.min_points <= user_growth.lifetime_points), 1);
