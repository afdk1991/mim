-- worker/migrations/0001_init.sql
-- Mim 可选边缘层 D1 只读副本初始化。
--
-- 【重要】这不是 Mim 主库：主库是服务器宿主机上的 PostgreSQL
-- （见 deploy/README.md，迁移在 server/db/migrations/）。
-- 本文件只创建边缘侧只读副本表，由 worker/src/index.ts 的 Cron
-- 调用主站 /api/sync/posts 幂等写入（INSERT ... ON CONFLICT(id) DO UPDATE）。
-- 仅在启用 Cloudflare Workers 边缘层时执行：
--   wrangler d1 migrations apply mim-readonly --local
--   wrangler d1 migrations apply mim-readonly --remote

CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  content     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,           -- 毫秒时间戳，与主站同步端点一致
  updated_at  INTEGER NOT NULL             -- 水位列：Cron 按此增量拉取
);

-- 按水位倒序，边缘侧列表查询的主索引
CREATE INDEX IF NOT EXISTS idx_posts_updated_at ON posts (updated_at DESC);
