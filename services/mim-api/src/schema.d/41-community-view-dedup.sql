-- 社区浏览计数去重（2026-11-15）
-- 口径：同一账号对同一帖子只计一次，避免刷新 / 反复进入 / 爬取把浏览量刷高。
-- 说明：全站注册已关闭、访客不再自动建号，登录用户 id 是稳定的访客标识，因此不再另设设备指纹。

-- 一次性数据变更标记：记录已经执行过的重置，防止每次启动都把新累计清零
CREATE TABLE IF NOT EXISTS data_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 浏览去重账本：主键即「一个账号对一篇帖子只记一行」
CREATE TABLE IF NOT EXISTS community_thread_views (
  thread_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- 反查某账号看过哪些帖子（用于后续可能的「看过」列表）
CREATE INDEX IF NOT EXISTS idx_community_thread_views_user ON community_thread_views (user_id);

-- 历史浏览数清零：只在标记不存在时执行，后续启动不会重复清零
UPDATE community_threads
SET views = 0
WHERE NOT EXISTS (
  SELECT 1 FROM data_migrations WHERE id = '2026-11-15-reset-community-views'
);

-- 写入标记：本条之后再次启动时上面的 UPDATE 不再命中
INSERT OR IGNORE INTO data_migrations (id, applied_at)
VALUES ('2026-11-15-reset-community-views', datetime('now'));
