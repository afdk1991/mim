-- 内容运营：公告 announcements / 更新日志 changelog_entries / 推广计划 promotions（2026-11-13）
-- 约束：仅 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / 幂等 INSERT OR IGNORE；
--       无 DROP / DELETE / 无条件 UPDATE；种子按稳定主键幂等，重复启动不覆盖运营已编辑内容。
-- 边界：推广计划只做曝光点击统计，不记佣金、不做资金结算，与 referral_codes / referrals 邀请体系完全解耦。

-- ===== 一、公告 announcements =====
-- 存量库兼容：announcements 早于本轮已存在于生产库，CREATE TABLE IF NOT EXISTS 不会补列，
-- 而下方种子 INSERT 显式写入 published_at；缺这段必在「升级已有库」时启动即失败（线上 502 根因）。
ALTER_ADD: announcements.published_at TEXT
-- 公开列表只回 status='published' 且在 [starts_at, ends_at) 有效期内的条目；置顶优先、发布时间倒序。
CREATE TABLE IF NOT EXISTS announcements (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','success','danger')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at TEXT, -- 首次发布时间（ISO 时间戳）；发布端点仅在首次发布时写入，重发不覆盖
  starts_at   TEXT, -- 生效起始（ISO 时间戳）；NULL 表示立即生效
  ends_at     TEXT, -- 生效截止（ISO 时间戳，开区间）；NULL 表示长期有效
  pinned      INTEGER NOT NULL DEFAULT 0, -- 1 置顶，公开列表置顶在前
  author_id   TEXT, -- 发布人（管理端记录）；系统种子为 'system'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_public ON announcements(status, pinned DESC, created_at DESC);

-- ===== 二、更新日志 changelog_entries =====
-- 公开列表只回 status='published'；按语义版本倒序，同版本内按发布时间倒序。
CREATE TABLE IF NOT EXISTS changelog_entries (
  id           TEXT PRIMARY KEY,
  version      TEXT NOT NULL UNIQUE, -- 语义版本号（如 0.0.8），唯一约束防止重复发版
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  changes      TEXT NOT NULL DEFAULT '[]', -- 变更清单：JSON 字符串数组
  published_at TEXT, -- 发布时间（ISO 时间戳）；NULL 表示尚未发布
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changelog_public ON changelog_entries(status, published_at DESC);

-- ===== 三、推广计划 promotions =====
-- 公开列表只回 status='active' 且在有效期内的计划；点击计数与转化计数仅作运营统计，不参与结算。
CREATE TABLE IF NOT EXISTS promotions (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  target_url       TEXT NOT NULL DEFAULT '', -- 落地页（站内相对路径或外链）
  code             TEXT, -- 推广码；NULL 不参与唯一约束
  starts_at        TEXT, -- 活动起始（ISO 时间戳）；NULL 表示立即生效
  ends_at          TEXT, -- 活动截止（ISO 时间戳，开区间）；NULL 表示长期有效
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  budget_cents     INTEGER NOT NULL DEFAULT 0, -- 预算（最小货币单位，仅统计口径，不做扣款）
  click_count      INTEGER NOT NULL DEFAULT 0, -- 累计点击（去重 + 频控后入账）
  conversion_count INTEGER NOT NULL DEFAULT 0, -- 累计转化（本包不写转化回写，预留统计列）
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_promotions_code ON promotions(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_public ON promotions(status, starts_at, ends_at);

-- 点击审计：幂等键去重 + 访客频控留痕；不关联 referrals，不记佣金。
CREATE TABLE IF NOT EXISTS promotion_clicks (
  id               TEXT PRIMARY KEY,
  promotion_id     TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  idempotency_key  TEXT, -- 客户端幂等键；NULL 表示未携带（仅受频控约束）
  visitor_hash     TEXT NOT NULL, -- 访客指纹哈希（登录用户取用户 ID，匿名取 IP+UA 加盐哈希）
  created_at       TEXT NOT NULL
);

-- 同一推广计划 + 幂等键只入账一次：重复点击回放首次结果，不重复计数。
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_clicks_key ON promotion_clicks(promotion_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_clicks_visitor ON promotion_clicks(promotion_id, visitor_hash, created_at);

-- 转化审计：与点击同口径的幂等去重 + 访客频控留痕；只统计转化次数，不记佣金、不做结算。
CREATE TABLE IF NOT EXISTS promotion_conversions (
  id               TEXT PRIMARY KEY,
  promotion_id     TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  idempotency_key  TEXT, -- 客户端幂等键；NULL 表示未携带（仅受频控约束）
  visitor_hash     TEXT NOT NULL, -- 访客指纹哈希（口径同 promotion_clicks）
  created_at       TEXT NOT NULL
);

-- 同一推广计划 + 幂等键只入账一次：重复转化回放首次结果，不重复计数。
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_conversions_key ON promotion_conversions(promotion_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_conversions_visitor ON promotion_conversions(promotion_id, visitor_hash, created_at);

-- ===== 四、幂等种子（INSERT OR IGNORE：重复启动不覆盖运营已编辑内容）=====
-- 公告三条：一条置顶已发布、一条普通已发布、一条草稿（公开列表不可见）；文案只面向普通用户。
INSERT OR IGNORE INTO announcements (id, title, body, level, status, published_at, starts_at, ends_at, pinned, author_id, created_at, updated_at)
VALUES
  ('ann-seed-welcome', 'Mim 社区使用指南', '欢迎来到 Mim。商城、社区与创作工具均已开放；如需帮助，可在社区「求助答疑」板块发帖。', 'info', 'published', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z', 1, 'system', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ann-seed-release', '内容与公告能力上线', '公告、更新日志与推广计划已开放：访客可浏览公开内容，运营团队在后台维护更新。', 'success', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('ann-seed-draft', '【草稿】待发布公告', '本条为草稿种子，公开列表不可见；运营在后台编辑发布后才会展示。', 'warning', 'draft', NULL, NULL, NULL, 0, 'system', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');

-- 存量库公告校正：仅当标题仍是旧种子文案时替换为面向用户的版本，运营已编辑的条目保持原样。
UPDATE announcements
SET title = 'Mim 社区使用指南', body = '欢迎来到 Mim。商城、社区与创作工具均已开放；如需帮助，可在社区「求助答疑」板块发帖。', updated_at = '2026-11-15T00:00:00.000Z'
WHERE id = 'ann-seed-welcome' AND title = '欢迎使用 Mim';
UPDATE announcements
SET title = '内容与公告能力上线', body = '公告、更新日志与推广计划已开放：访客可浏览公开内容，运营团队在后台维护更新。', updated_at = '2026-11-15T00:00:00.000Z'
WHERE id = 'ann-seed-release' AND title = '0.0.8 版本已上线';

-- 更新日志十一条：0.0.0 → 0.0.10 全量版本，均已发布；INSERT OR IGNORE 保证重复启动不覆盖运营已编辑内容。
-- 文案只保留用户能感知的功能变化，不写包版本、提交号、内部表名、开关名与测试数量。
INSERT OR IGNORE INTO changelog_entries (id, version, title, body, changes, published_at, status, created_at, updated_at)
VALUES
  ('cl-seed-000', '0.0.0', 'Mim 正式上线', '账号与权限、管理后台、商城付费、作品导出与统一入口在这一版本完成搭建。', '["账号与权限体系", "商城与付费流程", "作品导出与统一入口"]', '2026-11-03T00:00:00.000Z', 'published', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z'),
  ('cl-seed-001', '0.0.1', '漫剧放映厅', '支持匿名看片与登录后「我的作品」播放，可切换集数并断点续播。', '["匿名看片", "我的作品", "集数切换与断点续播"]', '2026-11-12T00:00:00.000Z', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('cl-seed-002', '0.0.2', '统一入口状态标注', '统一入口新增状态徽标，可直观看到各项功能是否已可用。', '["功能状态徽标", "可用功能清单"]', '2026-11-12T00:00:00.000Z', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('cl-seed-003', '0.0.3', '链接导航', '新增链接目录、可达性探测、失效标记、推荐位与检索。', '["链接目录与可达性探测", "失效标记与推荐位", "导航检索"]', '2026-11-12T00:00:00.000Z', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('cl-seed-004', '0.0.4', '统一搜索', '模块、入口、导航、社区与商城内容可统一检索。', '["统一搜索入口", "多来源聚合结果"]', '2026-11-12T00:00:00.000Z', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('cl-seed-005', '0.0.5', '付费内容与创作收益', '新增付费阅读、下载、图库与视频；支持支付、发货物流、售后、创作收益与成长徽章。', '["四类付费内容", "支付与发货售后", "创作收益与成长徽章"]', '2026-11-12T00:00:00.000Z', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('cl-seed-006', '0.0.6', 'Mim ID 数字号与物流追踪', 'Mim ID 改为纯数字号；新增快递轨迹查询，未接入快递服务时展示本地轨迹。', '["Mim ID 纯数字号", "快递轨迹查询"]', '2026-11-12T00:00:00.000Z', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('cl-seed-007', '0.0.7', 'Mim ID 靓号规则优化', '预留 1–99 号段，调整靓号判定规则并扩充靓号类型；存量账号按新规则重排。', '["预留小号段", "靓号类型扩充", "存量账号重排"]', '2026-11-13T00:00:00.000Z', 'published', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z'),
  ('cl-seed-008', '0.0.8', '付费内容前台与社区完善', '付费图库与视频可前台直接浏览；社区板块权限与公共内容区块同步完善。', '["付费图库与视频前台", "社区板块权限", "公共内容区块"]', '2026-11-13T00:00:00.000Z', 'published', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z'),
  ('cl-seed-009', '0.0.9', '支付、邀请与实名能力接入', '商城资金、支付通道、邀请码、实名认证与跨站登录接入主应用，相关入口同步开放。', '["支付与资金", "邀请码与实名认证", "跨站登录"]', '2026-11-13T06:00:00.000Z', 'published', '2026-11-13T06:00:00.000Z', '2026-11-13T06:00:00.000Z'),
  ('cl-seed-010', '0.0.10', '圈子、积分抵扣与工具升级', '新增独立圈子与商城积分抵扣，自研工具可直接运行；验证码与内容权限同步加强。', '["独立圈子", "积分抵扣", "工具中心与安全加固"]', '2026-11-13T09:00:00.000Z', 'published', '2026-11-13T09:00:00.000Z', '2026-11-13T09:00:00.000Z');

-- 存量库更新日志校正：仅当标题仍是旧种子文案时替换，运营已改过标题的条目保持原样。
UPDATE changelog_entries SET title = 'Mim 正式上线', body = '账号与权限、管理后台、商城付费、作品导出与统一入口在这一版本完成搭建。', changes = '["账号与权限体系", "商城与付费流程", "作品导出与统一入口"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-000' AND title = '项目初始化与早期能力累积';
UPDATE changelog_entries SET title = '漫剧放映厅', body = '支持匿名看片与登录后「我的作品」播放，可切换集数并断点续播。', changes = '["匿名看片", "我的作品", "集数切换与断点续播"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-001' AND title = '漫剧 / AI 剧放映厅';
UPDATE changelog_entries SET title = '统一入口状态标注', body = '统一入口新增状态徽标，可直观看到各项功能是否已可用。', changes = '["功能状态徽标", "可用功能清单"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-002' AND title = '统一入口落地状态四态对齐';
UPDATE changelog_entries SET title = '链接导航', body = '新增链接目录、可达性探测、失效标记、推荐位与检索。', changes = '["链接目录与可达性探测", "失效标记与推荐位", "导航检索"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-003' AND title = '导航站业务模块';
UPDATE changelog_entries SET title = '统一搜索', body = '模块、入口、导航、社区与商城内容可统一检索。', changes = '["统一搜索入口", "多来源聚合结果"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-004' AND title = '统一搜索上线';
UPDATE changelog_entries SET title = '付费内容与创作收益', body = '新增付费阅读、下载、图库与视频；支持支付、发货物流、售后、创作收益与成长徽章。', changes = '["四类付费内容", "支付与发货售后", "创作收益与成长徽章"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-005' AND title = '商业化二期';
UPDATE changelog_entries SET title = 'Mim ID 数字号与物流追踪', body = 'Mim ID 改为纯数字号；新增快递轨迹查询，未接入快递服务时展示本地轨迹。', changes = '["Mim ID 纯数字号", "快递轨迹查询"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-006' AND title = 'Mim ID 纯数字号与物流查询';
UPDATE changelog_entries SET title = 'Mim ID 靓号规则优化', body = '预留 1–99 号段，调整靓号判定规则并扩充靓号类型；存量账号按新规则重排。', changes = '["预留小号段", "靓号类型扩充", "存量账号重排"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-007' AND title = 'Mim ID 靓号规则二次收紧';
UPDATE changelog_entries SET title = '付费内容前台与社区完善', body = '付费图库与视频可前台直接浏览；社区板块权限与公共内容区块同步完善。', changes = '["付费图库与视频前台", "社区板块权限", "公共内容区块"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-008' AND title = 'P1 社区闭环与付费资产前台';
UPDATE changelog_entries SET title = '支付、邀请与实名能力接入', body = '商城资金、支付通道、邀请码、实名认证与跨站登录接入主应用，相关入口同步开放。', changes = '["支付与资金", "邀请码与实名认证", "跨站登录"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-009' AND title = 'P2 主体接入';
UPDATE changelog_entries SET title = '圈子、积分抵扣与工具升级', body = '新增独立圈子与商城积分抵扣，自研工具可直接运行；验证码与内容权限同步加强。', changes = '["独立圈子", "积分抵扣", "工具中心与安全加固"]', updated_at = '2026-11-15T00:00:00.000Z' WHERE id = 'cl-seed-010' AND title = '全项目缺口收口与当前线上版本';

-- 推广计划一条：进行中，长期有效；预算仅作统计，不产生扣款。
INSERT OR IGNORE INTO promotions (id, name, summary, target_url, code, starts_at, ends_at, status, budget_cents, click_count, conversion_count, created_at, updated_at)
VALUES
  ('promo-seed-launch', '上线首月推广', '新用户首月体验引导：浏览模块商城与社区内容，解锁免费模块。', '/marketplace', 'MIM-LAUNCH', '2026-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z', 'active', 500000, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ===== 五、RBAC 权限点注册（幂等 INSERT OR IGNORE；只补不删）=====
-- 表与列对齐 db.ts seedRbac：
--   permissions(code PK, name_i18n, description_i18n, builtin, created_at, updated_at)
--   roles(code PK, name_i18n, description_i18n, builtin, created_at, updated_at)
--   role_permissions(role_code, permission_code, created_at, PK(role_code, permission_code))
-- 说明：域脚本先于 seedRbac 执行，此处先占位内置 superadmin 角色行以解除 role_permissions 外键依赖；
--       seedRbac 随后按基线 upsert 刷新角色名称与描述，不删除本包登记的授权关系。
INSERT OR IGNORE INTO roles (code, name_i18n, description_i18n, builtin, created_at, updated_at)
VALUES (
  'superadmin',
  '{"zh-CN":"超级管理员","en-US":"Super Admin"}',
  '{"zh-CN":"拥有全部权限，可管理角色与用户授权","en-US":"Full access"}',
  1,
  '2026-11-13T00:00:00.000Z',
  '2026-11-13T00:00:00.000Z'
);

INSERT OR IGNORE INTO permissions (code, name_i18n, description_i18n, builtin, created_at, updated_at)
VALUES (
  'content:write',
  '{"zh-CN":"维护内容运营","en-US":"Manage content operations"}',
  '{"zh-CN":"公告 / 更新日志 / 推广计划的维护、发布归档与转化回写","en-US":"Maintain announcements, changelog and promotions"}',
  1,
  '2026-11-13T00:00:00.000Z',
  '2026-11-13T00:00:00.000Z'
);

-- 授予内置超管：重复启动不删除后台已回收的授权（OR IGNORE 只补不删）。
INSERT OR IGNORE INTO role_permissions (role_code, permission_code, created_at)
VALUES ('superadmin', 'content:write', '2026-11-13T00:00:00.000Z');
