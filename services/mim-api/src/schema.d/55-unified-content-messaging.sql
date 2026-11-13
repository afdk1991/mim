-- 统一内容与消息域（2026-11-14 P0-B 第 1 步）：只新增，不改既有表。
-- 现状：内容侧 community_boards/threads/posts（论坛）与 circles/circle_posts/circle_notices（圈子）两套同构；
--       消息侧 im_conversations/im_messages（会话式）与 direct_messages（裸私信）两套。
-- 后果：点赞/举报/收藏/评分只覆盖论坛，搜索要分两路查；私信缺会话模型，做已读回执、撤回、引用都得再写一套。
-- 本脚本建立 content_items / conversations / messages 三张统一表，由 src/content/unified.ts 启动期回填，
-- 旧表与旧接口原样继续服务；删表并移除一次回填调用即可回滚。

CREATE TABLE IF NOT EXISTS content_items ( -- 统一内容条目：论坛主题 / 圈内动态 / 圈内公告共用一张
  id            TEXT PRIMARY KEY, -- 统一主键；回填时为 ci_<source>_<源主键>
  source        TEXT NOT NULL CHECK (source IN ('community_thread','circle_post','circle_notice')), -- 来源，迁移期区分写路径
  source_id     TEXT NOT NULL, -- 源表主键
  container_kind TEXT NOT NULL CHECK (container_kind IN ('board','circle')), -- 所属容器类型：板块 / 圈子
  container_id  TEXT NOT NULL, -- 容器主键（board_id / circle_id）
  author_id     TEXT, -- 作者；公告与系统帖可能为空
  kind          TEXT NOT NULL DEFAULT 'text', -- 内容形态：text / video / gallery / series / qa / poll / notice
  title         TEXT NOT NULL DEFAULT '', -- 标题；圈子动态与公告没有标题，留空
  summary       TEXT NOT NULL DEFAULT '', -- 摘要
  body          TEXT NOT NULL DEFAULT '', -- 正文
  status        TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden','archived')), -- 统一状态机
  metrics_json  TEXT NOT NULL DEFAULT '{}', -- 计数与附属信息（浏览 / 点赞 / 回复 / 价格），避免为差异加宽表
  created_at    TEXT NOT NULL, -- 发布时间
  updated_at    TEXT NOT NULL, -- 最近更新时间
  UNIQUE (source, source_id) -- 同一条源内容只能回填一次
); -- content_items 定义结束

CREATE TABLE IF NOT EXISTS conversations ( -- 统一会话：IM 会话与裸私信共用一张
  id             TEXT PRIMARY KEY, -- 统一主键；IM 为 uc_im_<源主键>，私信为 uc_dm_<用户A>__<用户B>
  source         TEXT NOT NULL CHECK (source IN ('im','dm')), -- 来源，迁移期区分写路径
  source_id      TEXT NOT NULL, -- 源主键；私信没有源会话，存排序后的用户对
  type           TEXT NOT NULL CHECK (type IN ('direct','group')), -- 会话类型
  title          TEXT NOT NULL DEFAULT '', -- 会话标题；私信留空，由前端按对方昵称渲染
  owner_user_id  TEXT, -- 群主
  members_json   TEXT NOT NULL DEFAULT '[]', -- 成员 id 数组：让「我的会话」不再需要 join 两套成员表
  created_at     TEXT NOT NULL, -- 创建时间
  updated_at     TEXT NOT NULL, -- 最近消息时间
  UNIQUE (source, source_id) -- 同一源会话只能回填一次
); -- conversations 定义结束

CREATE TABLE IF NOT EXISTS messages ( -- 统一消息：IM 消息与裸私信共用一张
  id              TEXT PRIMARY KEY, -- 统一主键；um_im_<源主键> / um_dm_<源主键>
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, -- 所属统一会话
  source          TEXT NOT NULL CHECK (source IN ('im','dm')), -- 来源
  source_id       TEXT NOT NULL, -- 源主键
  sender_user_id  TEXT NOT NULL, -- 发送者
  content_type    TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text','image','file','system')), -- 消息类型
  content         TEXT NOT NULL DEFAULT '', -- 正文
  object_key      TEXT, -- 附件对象键
  object_mime     TEXT, -- 附件 MIME
  object_name     TEXT, -- 附件原名
  object_size     INTEGER, -- 附件字节数
  reply_to_id     TEXT, -- 引用回复目标（统一主键）
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read')), -- 送达状态
  created_at      TEXT NOT NULL, -- 发送时间
  deleted_at      TEXT, -- 撤回时间
  UNIQUE (source, source_id) -- 同一条源消息只能回填一次
); -- messages 定义结束

CREATE INDEX IF NOT EXISTS ix_content_items_container ON content_items (container_kind, container_id, created_at DESC); -- 板块 / 圈子的内容流
CREATE INDEX IF NOT EXISTS ix_content_items_created ON content_items (created_at DESC); -- 全站最新内容
CREATE INDEX IF NOT EXISTS ix_conversations_updated ON conversations (updated_at DESC); -- 「我的会话」按活跃倒序
CREATE INDEX IF NOT EXISTS ix_messages_conversation ON messages (conversation_id, created_at); -- 会话内消息翻页
