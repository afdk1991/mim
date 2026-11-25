-- 86-community-tags.sql —— 社区标签：作者发帖时自建，每帖 1–3 个，按 slug 去重
-- 只做增量：新表 / 幂等索引；不 DROP、不覆盖既有数据。
-- 执行顺序：schema.sql → 本目录脚本（升序）。脚本每次启动都会重跑，所有写入必须幂等。
--
-- 口径（2026-11-25 内容结构批次）：
--   · community_tags 存标签字典；slug 为去重键（归一化后的名称，唯一），name 为展示名；
--   · community_thread_tags 为帖子 ↔ 标签多对多关系，复合主键天然防重复挂载；
--   · 本轮不做后台治理（驳回 / 合并 / 隐藏调整），status 预留 active / hidden 两态，
--     治理接口后续批次再补；新建标签一律 active。

-- ===== 一、标签字典 =====
-- slug UNIQUE：同一归一化名只落一行，重复发帖复用既有标签，不产生同义重复行。
CREATE TABLE IF NOT EXISTS community_tags (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE, -- 去重键：名称去空白、折叠空格、小写后的归一化形态
  name        TEXT NOT NULL, -- 展示名：作者提交的原始文案（2–12 字，校验在路由层）
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')), -- 预留治理态：本轮新建恒为 active
  created_by  TEXT REFERENCES users(id), -- 首个创建者；匿名 / 系统建号可为 NULL
  created_at  TEXT NOT NULL
);
-- 热门标签列表按状态过滤后按创建时间兜底排序，status 前缀覆盖活跃标签检索路径。
CREATE INDEX IF NOT EXISTS idx_community_tags_status ON community_tags(status, created_at);

-- ===== 二、帖子 ↔ 标签关系 =====
-- 复合主键 (thread_id, tag_id) 保证同一帖同一标签只挂一次；外键随帖子删除级联清理。
CREATE TABLE IF NOT EXISTS community_thread_tags (
  thread_id TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES community_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, tag_id)
);
-- 反向检索：按标签查关联帖子（列表 tag 过滤 / 标签页计数）走 tag_id 前缀索引。
CREATE INDEX IF NOT EXISTS idx_community_thread_tags_tag ON community_thread_tags(tag_id);
-- 正向检索：按帖子回读标签（详情 / 列表批量回带）走 thread_id 前缀索引。
CREATE INDEX IF NOT EXISTS idx_community_thread_tags_thread ON community_thread_tags(thread_id);
