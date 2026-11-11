-- ============================================================
-- Mim API · SQLite 本地开发库结构
-- 忠于 08-dev-implementation §3.2/§3.3 的分域与表语义；
-- SQLite 无 schema 概念，ops 域表以 idempotency_keys 落位。
-- 时间统一 UTC ISO-8601 字符串；金额为最小货币单位整数。
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- identity 域 ----------
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  region            TEXT NOT NULL CHECK (region IN ('cn','global')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_deletion','deleted')),
  display_name      TEXT NOT NULL DEFAULT '',
  locale            TEXT NOT NULL DEFAULT 'zh-CN',
  timezone          TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  deletion_scheduled_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);

CREATE TABLE IF NOT EXISTS identities (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  region      TEXT NOT NULL,
  provider    TEXT NOT NULL CHECK (provider IN ('phone','email')),
  identifier  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (region, provider, identifier)
);

CREATE TABLE IF NOT EXISTS credentials (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL,
  secret_hash  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  device_id           TEXT,
  expires_at          TEXT NOT NULL,
  revoked_at          TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  platform      TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  last_seen_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_merges (
  id                TEXT PRIMARY KEY,
  primary_user_id   TEXT NOT NULL,
  merged_user_id    TEXT NOT NULL,
  status            TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

-- ---------- catalog 域（功能模块商城 / 解锁鉴权，07 §5.1、08 §3.2）----------
CREATE TABLE IF NOT EXISTS modules (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL,
  name_i18n             TEXT NOT NULL,
  summary_i18n          TEXT NOT NULL,
  unlock_mode           TEXT NOT NULL CHECK (unlock_mode = 'one_time'),
  entitlements_required TEXT NOT NULL DEFAULT '[]',
  region                TEXT NOT NULL CHECK (region IN ('cn','global')),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  category_slug         TEXT,
  license               TEXT,
  language              TEXT,
  stars                 INTEGER NOT NULL DEFAULT 0,
  capability            TEXT, -- 真实能力键（对应 @mim/core-domain 的 MODULE_CAPABILITIES.key）；NULL 表示该模块功能规划中
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,
  UNIQUE (region, code)
);
CREATE INDEX IF NOT EXISTS idx_modules_region_status ON modules(region, status, sort_order);

-- 模块分类树：一级分类（parent_id 为空）+ 二级条目（parent_id 指向一级），导航与过滤都读这张表
CREATE TABLE IF NOT EXISTS module_categories (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  level      INTEGER NOT NULL CHECK (level IN (1,2)),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  name_en    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES module_categories(id)
);
CREATE INDEX IF NOT EXISTS idx_module_categories_parent ON module_categories(level, sort_order);

CREATE TABLE IF NOT EXISTS module_prices (
  id              TEXT PRIMARY KEY,
  module_id       TEXT NOT NULL,
  currency        TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL CHECK (amount_minor >= 0),
  effective_from  TEXT NOT NULL,
  effective_to    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_module_prices_module ON module_prices(module_id, currency, effective_from);

-- 商城订单：付费模块必须先下单并结算，结算成功才发权益（免费模块仍走 POST /entitlements 直接解锁）
CREATE TABLE IF NOT EXISTS module_orders (
  id              TEXT PRIMARY KEY, -- 订单主键（uuidv7，时间有序便于按创建顺序排查）
  user_id         TEXT NOT NULL, -- 下单用户
  module_id       TEXT NOT NULL, -- 目标模块；金额在下单时快照，后续调价不影响已存在订单
  region          TEXT NOT NULL, -- 下单时用户所在区域，防止跨区串单
  currency        TEXT NOT NULL, -- 结算币种（下单时从当前有效价格快照）
  amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0), -- 成交金额（分）；0 元订单无意义，免费模块不走订单
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')), -- 订单状态机：待结算 / 已结算 / 已取消
  channel         TEXT NOT NULL DEFAULT 'manual' CHECK (channel IN ('manual','alipay','wechat','stripe')), -- 结算渠道；默认人工结算，接入在线渠道后在创建订单时指定
  channel_txn_id  TEXT, -- 外部渠道交易号（人工结算为 NULL）；回调幂等依据，同一交易号不得结算两张单
  entitlement_id  TEXT, -- 结算后发放的权益主键，供订单与权益双向对账
  created_at      TEXT NOT NULL, -- 下单时间
  updated_at      TEXT NOT NULL, -- 最近状态变更时间
  paid_at         TEXT, -- 结算完成时间，pending 为 NULL
  cancelled_at    TEXT -- 取消时间，仅 cancelled 填充
);
-- 同一用户同一模块同时只允许一笔待结算订单，避免重复下单产生多条待付记录
CREATE UNIQUE INDEX IF NOT EXISTS uq_module_orders_pending
  ON module_orders(user_id, module_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_module_orders_user ON module_orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_module_orders_status ON module_orders(status, created_at);
-- 注意：channel_txn_id 属「后加列」，它的唯一索引不能在 schema.sql 里建——
-- 老库此时还没有该列，全量 exec 会直接报 no such column 导致进程启动失败；
-- 该索引由 db.ts 的 ADDITIVE_INDEXES 在补列之后创建（新建库同样会走这一步）。

-- 商城购物车：每用户每模块最多一行（模块属虚拟商品、不可重复购买，故不设数量列）
CREATE TABLE IF NOT EXISTS cart_items (
  id          TEXT PRIMARY KEY, -- 购物车条目主键（uuidv7，时间有序）
  user_id     TEXT NOT NULL REFERENCES users(id), -- 归属用户；一个用户一份车
  module_id   TEXT NOT NULL, -- 目标模块主键（与 modules.id 对应，跨区同码模块是不同行）
  created_at  TEXT NOT NULL, -- 加购时间
  updated_at  TEXT NOT NULL -- 最近一次加购/更新时间（重复加购时刷新）
);
-- 同一用户同一模块只允许一条：重复加购走幂等回放，不产生重复条目
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_user_module ON cart_items(user_id, module_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id, created_at);

CREATE TABLE IF NOT EXISTS entitlements (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  module_id   TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source = 'admin'),
  source_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  expires_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlements_user_module_once
  ON entitlements(user_id, module_id) WHERE source_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlements_user_module_source
  ON entitlements(user_id, module_id, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entitlements_user_status ON entitlements(user_id, status);

CREATE TABLE IF NOT EXISTS entitlement_events (
  id              TEXT PRIMARY KEY,
  entitlement_id  TEXT NOT NULL,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  reason          TEXT,
  actor           TEXT NOT NULL CHECK (actor IN ('job','admin','system')),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entitlement_events_ent ON entitlement_events(entitlement_id, created_at);

-- ---------- comic 域（第 1 期：AI 辅助创作工作台，07 §12.1、08 §3.2）----------
CREATE TABLE IF NOT EXISTS comic_projects (
  id             TEXT PRIMARY KEY,
  owner_user_id  TEXT NOT NULL,
  region         TEXT NOT NULL CHECK (region IN ('cn','global')),
  title          TEXT NOT NULL,
  synopsis       TEXT,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','storyboarded','generating','rendered','published','archived')),
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_comic_projects_owner ON comic_projects(owner_user_id, status, created_at);

CREATE TABLE IF NOT EXISTS comic_characters (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  name                TEXT NOT NULL,
  appearance_prompt   TEXT NOT NULL,
  seed                INTEGER,
  reference_asset_ids TEXT NOT NULL DEFAULT '[]',
  voice_profile       TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_comic_characters_project_name
  ON comic_characters(project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS storyboards (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  shots         TEXT NOT NULL,
  confirmed_at  TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_storyboards_project_version ON storyboards(project_id, version_no);
CREATE INDEX IF NOT EXISTS idx_storyboards_project ON storyboards(project_id, created_at);

-- ---------- comic 域（第 2 期：生成任务编排 + 成片合成，07 §12.2、08 §3.2）----------
-- 失败重试新建 job（retry_of 指向原 job），历史 job 与产物永不覆盖；额度在 succeeded 时结算
CREATE TABLE IF NOT EXISTS generation_jobs (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  storyboard_id       TEXT,
  job_type            TEXT NOT NULL CHECK (job_type IN ('text','image','video','tts','compose')),
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  retry_of            TEXT,
  cost_estimate_minor INTEGER,
  error_code          TEXT,
  payload             TEXT NOT NULL DEFAULT '{}',
  result              TEXT,
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  started_at          TEXT,
  finished_at         TEXT,
  -- 已被「超时回收」重新入队的次数：worker 崩溃/重启会把 running 任务放回 queued 并自增该列，
  -- 超过 MIM_AI_JOB_MAX_RECLAIM 后直接判失败，防止同一个必然失败的任务无限重试
  attempts            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_project ON generation_jobs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_type ON generation_jobs(status, job_type);

-- 生成产物登记（08 §5）：媒体对象统一登记 object_key / mime / 校验和 / 保留期；
-- 产物只追加不覆盖，过期由清理任务删除对象并把 expires_at 保留为审计证据
CREATE TABLE IF NOT EXISTS generation_assets (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  asset_type    TEXT NOT NULL CHECK (asset_type IN ('text','image','video','audio','final')),
  object_key    TEXT NOT NULL,
  mime          TEXT NOT NULL,
  duration_ms   INTEGER,
  size_bytes    INTEGER,
  checksum      TEXT NOT NULL,
  expires_at    TEXT,
  created_at    TEXT NOT NULL,
  -- 对象字节被 asset-gc 定时任务清理的时间：置空表示仍占用存储，非空表示已删除但保留行作审计证据
  purged_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_generation_assets_job ON generation_assets(job_id, created_at);
-- 过期清理按 expires_at 扫描：没有该索引时 asset-gc 每轮都要全表扫，产物表一旦上万行就会拖慢库
CREATE INDEX IF NOT EXISTS idx_generation_assets_expiry ON generation_assets(expires_at);
CREATE INDEX IF NOT EXISTS idx_generation_assets_project ON generation_assets(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_assets_object ON generation_assets(object_key);

-- 成片主体；current_version_id 指向最新已发布版本；版本只追加不覆盖
CREATE TABLE IF NOT EXISTS comic_films (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','reviewing','published','archived')),
  current_version_id  TEXT,
  review_note         TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_comic_films_project ON comic_films(project_id, status, created_at);

CREATE TABLE IF NOT EXISTS film_versions (
  id            TEXT PRIMARY KEY,
  film_id       TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  object_key    TEXT,
  duration_sec  INTEGER,
  size_bytes    INTEGER,
  published_at  TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_film_versions_film_version ON film_versions(film_id, version_no);

-- ---------- 认证与会话辅助 ----------
CREATE TABLE IF NOT EXISTS verification_codes (
  id           TEXT PRIMARY KEY,
  region       TEXT NOT NULL,
  provider     TEXT NOT NULL,
  identifier   TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  consumed_at  TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codes_identifier ON verification_codes(region, provider, identifier, created_at);

CREATE TABLE IF NOT EXISTS login_failures (
  identifier    TEXT PRIMARY KEY,
  region        TEXT,
  failures      INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  updated_at    TEXT NOT NULL
);

-- ---------- ops 域 ----------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key              TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  method           TEXT NOT NULL,
  path             TEXT NOT NULL,
  request_hash     TEXT NOT NULL,
  response_status  INTEGER,
  response_body    TEXT,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (key, user_id)
);

-- ---------- rbac 域（角色-权限-用户三角色模型，08 §3.4 / 07 §2.1）----------
-- 权限点：细粒度动作标识（如 module:write），由代码侧 requirePermission 按字符串匹配；
-- 内置权限点在 db.ts seedRbac 中幂等写入，允许后台追加自定义权限点。
CREATE TABLE IF NOT EXISTS permissions (
  code              TEXT PRIMARY KEY,
  name_i18n         TEXT NOT NULL,
  description_i18n  TEXT NOT NULL DEFAULT '{}',
  builtin           INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- 角色：权限集合的可命名载体；builtin=1 的内置角色禁止删除，避免把系统锁死
CREATE TABLE IF NOT EXISTS roles (
  code              TEXT PRIMARY KEY,
  name_i18n         TEXT NOT NULL,
  description_i18n  TEXT NOT NULL DEFAULT '{}',
  builtin           INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- 角色-权限映射：多对多；删除角色或权限点时级联清理映射，杜绝悬空引用
CREATE TABLE IF NOT EXISTS role_permissions (
  role_code         TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code   TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_code);

-- 用户-角色映射：一个用户可持多个角色，权限为各角色并集；
-- granted_by 记录授予人（用户 ID 或 'bootstrap'/'system'），用于审计回溯。
-- 不对 user_id 建外键：与 entitlements 一致，用户软删除后保留授权历史便于审计。
CREATE TABLE IF NOT EXISTS user_roles (
  user_id           TEXT NOT NULL,
  role_code         TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  granted_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TEXT NOT NULL,
  PRIMARY KEY (user_id, role_code)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_code);

-- ---------- im 域（即时通讯与视频通话，07 §13）----------
-- 会话主体：direct 为 1:1 私聊（同两人只能有一个），group 为群聊；
-- 软删除保持消息历史可审计。
CREATE TABLE IF NOT EXISTS im_conversations (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('direct','group')),
  title           TEXT NOT NULL DEFAULT '',
  owner_user_id   TEXT,
  avatar_object_key TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_im_conversations_updated ON im_conversations(updated_at DESC);

-- 会话成员：direct 会话固定两人；group 会话可多人；
-- role 区分群主/管理员/普通成员；last_read_message_id 驱动未读数。
CREATE TABLE IF NOT EXISTS im_conversation_members (
  conversation_id     TEXT NOT NULL REFERENCES im_conversations(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  last_read_message_id TEXT,
  muted               INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0,1)),
  pinned              INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  joined_at           TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_im_members_user ON im_conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_im_members_conv ON im_conversation_members(conversation_id);

-- 消息主体：content_type 决定 content 字段语义；
-- image/file 类型的对象键走 media 预签名通道，消息只存 object_key 引用（避免大 payload 走 WebSocket）。
-- status 流转：sent（发送方本地）→ delivered（已投递到对方在线设备）→ read（对方已读）。
CREATE TABLE IF NOT EXISTS im_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES im_conversations(id) ON DELETE CASCADE,
  sender_user_id  TEXT NOT NULL,
  content_type    TEXT NOT NULL CHECK (content_type IN ('text','image','file','system')),
  content         TEXT NOT NULL DEFAULT '',
  object_key      TEXT,
  object_mime     TEXT,
  object_name     TEXT,
  object_size     INTEGER,
  reply_to_id     TEXT, -- 引用回复的目标消息 ID（NULL 表示普通消息，2026-11-11 新增）
  reply_excerpt   TEXT, -- 被引用消息的快照摘要（发送时固化，原消息被撤回后仍可展示引用块）
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_im_messages_conv_created ON im_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_im_messages_sender ON im_messages(sender_user_id, created_at DESC);
-- direct 会话的两人唯一性由应用层保证（按 sorted(user_id pair) 查询复用），
-- 不在 DB 层做跨成员表的唯一约束，SQLite 无法表达。

-- ---------- site 域（统一入口配置清单，备注驱动，2026-11-09）----------
-- 入口定义本身是静态契约（packages/core-domain/src/siteModules.json），不落库；
-- 本表只持久化「入口 × 能力」下的业务条目，让每个备注对应的功能可运行、可交互。
-- host 列的物理名沿用历史结构，语义自 v2 起为「可配置占位标识键」（如 BLOG），
-- 不是具体主机值；用户未提供具体主机记录值，代码不补写、不推导真实域名。
-- capability 为三类能力之一，二者共同隔离数据。
CREATE TABLE IF NOT EXISTS site_module_items (
  id            TEXT PRIMARY KEY,
  host          TEXT NOT NULL,
  capability    TEXT NOT NULL CHECK (capability IN ('catalog','manage','record')),
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'system',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_items_host_cap ON site_module_items(host, capability, status);
CREATE INDEX IF NOT EXISTS idx_site_items_created ON site_module_items(created_at DESC);

