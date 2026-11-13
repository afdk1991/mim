-- ---------- 圈子（circles）域（2026-11-13）----------
-- 概念边界：圈子 circle 是以「人 / 兴趣 / 组织」为中心的成员制社群，与论坛板块 board 是两个概念：
--   - 板块 board 隶属站点，是内容分区，有 Tab 与帖子流（community_boards / community_threads）；
--   - 圈子 circle 以成员关系为核心，有圈主、加入审核、成员上限、圈内专属动态流与公告；
--     一个圈子可跨多个板块聚合内容，也可以只有圈内动态。本域不写 boards 表，也不借用板块表冒充圈子。
-- 本文件只做增量：新表 + 幂等索引；不 DROP、不 DELETE、不无覆盖既有数据。
-- 执行顺序：schema.sql → 本目录脚本（升序）→ 存量补列迁移 → 业务种子。

-- ===== 一、圈子主表 =====
CREATE TABLE IF NOT EXISTS circles (
  id            TEXT PRIMARY KEY,                       -- 内部主键（uuidv7），不对外暴露
  slug          TEXT NOT NULL UNIQUE,                  -- 对外可读标识，小写字母 / 数字 / 连字符，全局唯一
  name          TEXT NOT NULL,                         -- 圈子名称（2~40 字）
  intro         TEXT NOT NULL DEFAULT '',              -- 圈子简介
  cover_url     TEXT,                                  -- 封面图地址，可空
  owner_id      TEXT NOT NULL REFERENCES users(id),   -- 圈主（成员角色 owner）
  visibility    TEXT NOT NULL DEFAULT 'public'         -- 可见性：public 公开可浏览 / private 仅成员可见
                CHECK (visibility IN ('public','private')),
  join_mode     TEXT NOT NULL DEFAULT 'open'           -- 加入方式：open 直接加入 / approve 待审核 / invite 凭邀请码
                CHECK (join_mode IN ('open','approve','invite')),
  member_limit  INTEGER NOT NULL DEFAULT 0,            -- 成员上限；0 表示不限
  category      TEXT,                                  -- 圈子分类（兴趣 / 组织 / 地域等自由标签）
  status        TEXT NOT NULL DEFAULT 'active'        -- 状态：active 正常 / archived 归档
                CHECK (status IN ('active','archived')),
  invite_code   TEXT,                                  -- invite 模式邀请码；仅 owner/admin 可见，加入时校验
  created_at    TEXT NOT NULL                          -- 创建时间（UTC ISO-8601）
);

-- 圈主反查索引：「我创建的圈子」与按 owner 统计配额使用。
CREATE INDEX IF NOT EXISTS idx_circles_owner ON circles(owner_id);
-- 列表过滤索引：可见性 + 分类 + 状态，配合关键词模糊检索。
CREATE INDEX IF NOT EXISTS idx_circles_list ON circles(visibility, category, status);

-- ===== 二、圈子成员关系表 =====
-- 唯一键 (circle_id, user_id)：同一用户在一个圈子内只有一条关系行，
-- 重复加入 / 退出 / 审核都在该行上流转状态，避免重复行导致成员计数翻倍。
CREATE TABLE IF NOT EXISTS circle_members (
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'             -- 角色：owner 圈主 / admin 管理员 / member 普通成员
             CHECK (role IN ('owner','admin','member')),
  status     TEXT NOT NULL DEFAULT 'active'            -- 状态：pending 待审核 / active 已加入 / left 已退出或被拒
             CHECK (status IN ('pending','active','left')),
  joined_at  TEXT NOT NULL,                             -- 最近一次加入 / 审核通过时间（UTC ISO-8601）
  PRIMARY KEY (circle_id, user_id)
);

-- 成员组合键索引：按圈子统计 active 成员数、拉成员名单命中主键前缀；
-- 按用户反查「我加入的圈子」走 user_id 二级索引。
CREATE INDEX IF NOT EXISTS idx_circle_members_circle ON circle_members(circle_id, status);
CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id, status);

-- ===== 三、圈内动态（圈子专属帖子流）=====
-- thread_id 可空：圈子可跨板块聚合既有板块帖（回填 thread_id），也可以只有纯圈内动态（thread_id 为 NULL）。
CREATE TABLE IF NOT EXISTS circle_posts (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  thread_id  TEXT,                                     -- 关联板块帖（可空；纯圈内动态为 NULL）
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 圈内动态流：按圈子倒序拉取最新动态。
CREATE INDEX IF NOT EXISTS idx_circle_posts_circle ON circle_posts(circle_id, created_at DESC);

-- ===== 四、圈内公告 =====
CREATE TABLE IF NOT EXISTS circle_notices (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),       -- 公告发布者（owner / admin）
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 公告流：按圈子倒序拉取最新公告。
CREATE INDEX IF NOT EXISTS idx_circle_notices_circle ON circle_notices(circle_id, created_at DESC);
