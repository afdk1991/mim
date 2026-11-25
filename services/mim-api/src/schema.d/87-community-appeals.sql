-- 87-community-appeals.sql —— 社区申诉：被处置内容的 7 天内一次申诉通道
-- 只做增量：新表 / 幂等索引；不 DROP、不覆盖既有表与既有数据。
-- 执行顺序：schema.sql → 本目录脚本（升序）。脚本每次启动都会重跑，所有写入必须幂等。
--
-- 口径（2026-11-25 申诉与成长公开批次）：
--   · 申诉人 = 内容作者本人；处置事实由既有帖子 / 回复表判定（帖子 status='hidden'，回复 deleted_at 非空）；
--   · 同一用户对同一目标只允许一条申诉；7 天受理窗口在路由层按处置时间裁剪；
--   · 申诉期间不恢复内容（保守口径）；处理结果经站内通知回执申诉人；
--   · 受理顺序：板块版主先行，超管兜底；本轮后台处理接口先落 RBAC content:write 队列。

-- ===== 一、申诉单 =====
-- target_type 只接纳被处置的两类社区内容；target_id 为对应表主键（与 community_reports 同口径，不单设外键约束到两张目标表）。
CREATE TABLE IF NOT EXISTS community_appeals (
  id           TEXT PRIMARY KEY, -- 申诉主键（uuidv7）
  user_id      TEXT NOT NULL REFERENCES users(id), -- 申诉人：必须是被处置内容的作者本人
  target_type  TEXT NOT NULL CHECK (target_type IN ('thread','reply')), -- 申诉对象：帖子 / 回复
  target_id    TEXT NOT NULL, -- 对象主键：community_threads.id 或 community_posts.id
  reason       TEXT NOT NULL, -- 申诉理由（作者自述，路由层限长）
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')), -- 受理状态：待处理 / 受理成立 / 驳回
  handled_by   TEXT, -- 处理人用户主键；超管引导通道记 admin-bootstrap
  handled_note TEXT NOT NULL DEFAULT '', -- 处理说明：随受理 / 驳回回执给申诉人
  created_at   TEXT NOT NULL, -- 提交时间（ISO-8601）
  handled_at   TEXT -- 处理时间；未处理为 NULL
);

-- 本人申诉列表：按人过滤后按提交时间倒序，覆盖 GET /community/appeals/mine 的读取路径。
CREATE INDEX IF NOT EXISTS idx_community_appeals_user ON community_appeals(user_id, created_at DESC);
-- 后台待处理队列：按状态过滤后按提交时间正序（先申诉先受理），覆盖 GET /admin/appeals 的读取路径。
CREATE INDEX IF NOT EXISTS idx_community_appeals_status ON community_appeals(status, created_at DESC);
