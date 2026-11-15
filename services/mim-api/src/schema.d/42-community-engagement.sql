-- 社区互动补齐（2026-11-15）：
--   1) 帖子治理列：置顶 / 锁定（锁定后禁止继续回复）；
--   2) 回复软删列：保留审计痕迹，列表与计数按 deleted_at IS NULL 过滤；
--   3) 附件位：与媒体（image/video）分开，挂文件下载；
--   4) 站内通知：回复 / 采纳 / 点赞 / 收藏事件投递；
--   5) 举报：用户提交 + 版主处理工作台。
-- 只做加列与新建表，不改任何既有列，老库启动即可平滑补齐。

ALTER_ADD: community_threads.pinned INTEGER NOT NULL DEFAULT 0
ALTER_ADD: community_threads.locked INTEGER NOT NULL DEFAULT 0
ALTER_ADD: community_posts.deleted_at TEXT

-- 附件位：帖子里可挂文件（zip / pdf / 文档等），与图片视频媒体分开存。
-- url 列存对象存储键（不是公开直链），下载由社区路由按帖子权限签发短时地址。
CREATE TABLE IF NOT EXISTS community_thread_attachments (
  id         TEXT PRIMARY KEY, -- 附件主键
  thread_id  TEXT NOT NULL, -- 所属帖子
  name       TEXT NOT NULL, -- 展示文件名
  url        TEXT NOT NULL, -- 对象存储键（签名下载时使用，绝不直接下发）
  mime       TEXT NOT NULL DEFAULT '', -- 文件 MIME
  size_bytes INTEGER NOT NULL DEFAULT 0, -- 文件大小（字节），0 表示未知
  sort_order INTEGER NOT NULL DEFAULT 0, -- 展示顺序
  created_at TEXT NOT NULL -- 上传时间
);
CREATE INDEX IF NOT EXISTS ix_community_attachments_thread ON community_thread_attachments(thread_id, sort_order);
-- 存量库补列：附件位最初没有 MIME 列，老库执行本脚本时补上；新库由上面的建表语句自带。
ALTER_ADD: community_thread_attachments.mime TEXT NOT NULL DEFAULT ''

-- 站内通知：写操作触发，收件人读取后置 read_at。
CREATE TABLE IF NOT EXISTS community_notifications (
  id         TEXT PRIMARY KEY, -- 通知主键
  user_id    TEXT NOT NULL, -- 收件人
  kind       TEXT NOT NULL, -- 事件类型：reply / accept / like / favorite / report
  thread_id  TEXT, -- 关联帖子
  post_id    TEXT, -- 关联回复（回复 / 采纳事件）
  actor_id   TEXT, -- 触发者
  content    TEXT NOT NULL DEFAULT '', -- 摘要文案（原文截断）
  read_at    TEXT, -- 已读时间；NULL 表示未读
  created_at TEXT NOT NULL -- 产生时间
);
CREATE INDEX IF NOT EXISTS ix_community_notifications_user ON community_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_community_notifications_unread ON community_notifications(user_id, read_at);

-- 举报：用户对帖子 / 回复提交，版主按板块处理。
CREATE TABLE IF NOT EXISTS community_reports (
  id          TEXT PRIMARY KEY, -- 举报主键
  reporter_id TEXT NOT NULL, -- 举报人
  target_type TEXT NOT NULL CHECK (target_type IN ('thread','post')), -- 举报对象类型
  target_id   TEXT NOT NULL, -- 对象主键
  thread_id   TEXT, -- 归属帖子（回复举报时便于版主定位）
  board_id    TEXT, -- 归属板块（版主工作台按板块过滤）
  reason      TEXT NOT NULL, -- 举报原因枚举键
  detail      TEXT NOT NULL DEFAULT '', -- 补充说明
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')), -- 处理状态
  resolved_by TEXT, -- 处理人
  resolution  TEXT, -- 处理动作：dismiss / hide_thread / delete_post
  created_at  TEXT NOT NULL, -- 提交时间
  resolved_at TEXT -- 处理时间
);
CREATE INDEX IF NOT EXISTS ix_community_reports_status ON community_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_community_reports_board ON community_reports(board_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_community_reports_target ON community_reports(target_type, target_id);
