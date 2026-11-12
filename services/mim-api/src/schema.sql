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
  -- 对外可见的 Mim ID 号码（如 MIM-10000001）：注册时由序号表原子分配，
  -- 与内部 uuidv7 主键解耦——主键不对外暴露、可迁移，号码供用户识别与客服引用。
  member_no         TEXT,
  region            TEXT NOT NULL CHECK (region IN ('cn','global')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_deletion','deleted')),
  display_name      TEXT NOT NULL DEFAULT '',
  locale            TEXT NOT NULL DEFAULT 'zh-CN',
  timezone          TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  -- 匿名访客标记：1 = 免登录自动建立的访客账号（未绑定任何登录身份），
  -- 0 = 真实账号。访客可正常使用全部功能，登录后由真实账号接管同一份数据。
  is_guest          INTEGER NOT NULL DEFAULT 0,
  deletion_scheduled_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
-- 注意：member_no 的唯一索引不写在这里。存量库执行本脚本时该列尚未补出，
-- 直接建索引会报 no such column 导致启动失败；索引由 db.ts 的 ADDITIVE_INDEXES 在补列后创建。

-- Mim ID 号码发号器：单行表保存下一个可分配序号，事务内「读 + 自增」保证不重号。
CREATE TABLE IF NOT EXISTS member_no_sequence (
  id       INTEGER PRIMARY KEY CHECK (id = 1), -- 固定单行，避免多行发号导致号段分叉
  next_no  INTEGER NOT NULL                    -- 下一个待分配序号（落库只存数字，展示时加前缀）
);
-- 首个号码从 10000001 开始：八位、无前导零，肉眼即可与内部主键区分。
INSERT OR IGNORE INTO member_no_sequence (id, next_no) VALUES (1, 10000001);

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

-- ---------- OAuth 第三方身份（GitHub / Gitee / GitLab / Google / Apple / Microsoft / 微信 / QQ / 抖音）----------
-- 独立于 identities 表：后者的 provider 约束只放行 phone/email，而 SQLite 无法修改既有 CHECK 约束。
-- 一个 Mim 账号可绑定多个第三方身份，一个第三方身份全局只能归属一个账号（UNIQUE 保证）。
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                TEXT PRIMARY KEY,                 -- 绑定记录主键（uuidv7）
  user_id           TEXT NOT NULL REFERENCES users(id), -- 归属的 Mim 用户
  provider          TEXT NOT NULL,                    -- 提供方标识，与后端注册表同名
  provider_user_id  TEXT NOT NULL,                    -- 提供方侧稳定用户 ID（GitHub id / 微信 openid / 抖音 open_id）
  union_id          TEXT,                             -- 提供方跨应用统一 ID（微信 unionid 等），可空
  nickname          TEXT NOT NULL DEFAULT '',         -- 首次授权时抓取的昵称，仅作展示兜底
  avatar_url        TEXT,                             -- 头像地址，仅作展示
  email             TEXT,                             -- 提供方返回的邮箱（可能未验证，不用于自动合并）
  raw_profile       TEXT NOT NULL DEFAULT '{}',       -- 提供方原始资料快照，便于排障与后续补字段
  created_at        TEXT NOT NULL,                    -- 首次绑定时间
  updated_at        TEXT NOT NULL,                    -- 最近一次授权刷新资料时间
  UNIQUE (provider, provider_user_id)                 -- 同一提供方同一用户只能绑定一次
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_accounts_union
  ON oauth_accounts(provider, union_id) WHERE union_id IS NOT NULL; -- unionid 唯一，避免同人开出第二个账号
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id, provider); -- 个人中心按用户查已绑定列表

-- OAuth 授权过程中的临时状态：state 诚实存摘要，防止库泄露后直接被复用发起 CSRF。
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash    TEXT PRIMARY KEY,                     -- sha256(state)，回传时按摘要查找
  provider      TEXT NOT NULL,                        -- 发起授权的提供方
  region        TEXT NOT NULL CHECK (region IN ('cn','global')), -- 新账号归属区域
  mode          TEXT NOT NULL CHECK (mode IN ('login','bind')),  -- 登录（可建号）或绑定（须已登录）
  link_user_id  TEXT,                                 -- 绑定模式下要挂载的目标用户
  code_verifier TEXT,                                 -- PKCE verifier，仅标准 OAuth2/OIDC 提供方使用
  redirect_uri  TEXT NOT NULL,                        -- 发起时固化的回调地址，换 token 必须逐字一致
  return_to     TEXT,                                 -- 前端完成后的回跳路径（同源相对路径）
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at); -- 过期清理扫描

-- 一次性登录票据：后端回调完成后 302 回前端，前端凭票据换正式令牌，
-- 避免把 access/refresh token 直接暴露在浏览器地址栏与日志里。
CREATE TABLE IF NOT EXISTS oauth_login_tickets (
  ticket_hash  TEXT PRIMARY KEY,                      -- sha256(ticket)，明文只在 302 地址中出现一次
  user_id      TEXT NOT NULL,                         -- 票据兑换的账号
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT                                   -- 消费后置时间，保证一次性
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


-- 全站资源导航站（NAVIGATION）：链接目录 + 可达性状态 + 最近一次探测取证。
-- status 三态：ok 可达 / broken 失效 / unknown 未探测；探测结果与判定口径见 core-domain/src/navigation.ts。
CREATE TABLE IF NOT EXISTS nav_links (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  group_name    TEXT NOT NULL DEFAULT '其他',
  description   TEXT NOT NULL DEFAULT '',
  recommended   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('ok','broken','unknown')),
  http_status   INTEGER,
  latency_ms    INTEGER,
  last_checked_at TEXT,
  created_by    TEXT NOT NULL DEFAULT 'system',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nav_links_group ON nav_links(group_name, recommended, name);
CREATE INDEX IF NOT EXISTS idx_nav_links_status ON nav_links(status, last_checked_at DESC);

-- ---------- community 域（社区论坛 / 会员 / 钱包 / 独立商城，2026-11-12）----------
-- 板块：论坛首页的栏目与圈子入口；付费板块通过 price_cents > 0 表达。
CREATE TABLE IF NOT EXISTS community_boards (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  icon          TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- 帖子：kind 覆盖普通帖 / 视频 / 图集 / 剧集 / 问答 / 投票；
-- price_cents > 0 表示付费阅读，未购买且非 VIP 时正文与回复不返回。
CREATE TABLE IF NOT EXISTS community_threads (
  id               TEXT PRIMARY KEY,
  board_id         TEXT NOT NULL REFERENCES community_boards(id),
  author_id        TEXT REFERENCES users(id),
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','video','gallery','series','qa','poll')),
  cover_url        TEXT,
  price_cents      INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  views            INTEGER NOT NULL DEFAULT 0,
  likes            INTEGER NOT NULL DEFAULT 0,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_threads_board ON community_threads(board_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_threads_hot ON community_threads(status, likes DESC, views DESC);

-- 回复：parent_id 支持楼中楼；按时间正序展示。
CREATE TABLE IF NOT EXISTS community_posts (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id),
  parent_id  TEXT,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_posts_thread ON community_posts(thread_id, created_at);

-- 点赞：复合主键天然防重复。
CREATE TABLE IF NOT EXISTS community_thread_likes (
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- 付费内容购买记录：同一用户同一帖只允许一条。
CREATE TABLE IF NOT EXISTS community_purchases (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  thread_id    TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, thread_id)
);

-- VIP 套餐：多级会员，duration_days 表示单次购买有效期。
CREATE TABLE IF NOT EXISTS vip_plans (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1,
  price_cents   INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  perks         TEXT NOT NULL DEFAULT '[]',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vip_memberships (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  plan_id    TEXT NOT NULL REFERENCES vip_plans(id),
  level      INTEGER NOT NULL,
  starts_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','refunded')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vip_memberships_user ON vip_memberships(user_id, status, expires_at DESC);

-- 钱包：金额单位为分，积分为整数；一个用户一行。
CREATE TABLE IF NOT EXISTS wallets (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  balance_cents INTEGER NOT NULL DEFAULT 0,
  points       INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

-- 钱包流水：kind 覆盖充值 / 消费 / 退款 / 分成 / 提现 / 签到积分。
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL CHECK (kind IN ('recharge','consume','refund','commission','withdraw','points')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  points       INTEGER NOT NULL DEFAULT 0,
  ref_type     TEXT,
  ref_id       TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, created_at DESC);

-- 签到：同一用户同一天只能签一次；day 为 YYYY-MM-DD（UTC）。
CREATE TABLE IF NOT EXISTS checkins (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  day        TEXT NOT NULL,
  points     INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, day)
);

-- 充值卡：演示与运营发放两用；一码一用。
CREATE TABLE IF NOT EXISTS wallet_cards (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used')),
  used_by      TEXT,
  used_at      TEXT,
  created_at   TEXT NOT NULL
);

-- 独立商城商品：physical 实物快递；virtual_auto 自动发卡密；virtual_manual 人工发货。
CREATE TABLE IF NOT EXISTS shop_products (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL CHECK (kind IN ('physical','virtual_auto','virtual_manual')),
  price_cents   INTEGER NOT NULL,
  cover_url     TEXT,
  stock         INTEGER NOT NULL DEFAULT 0,
  delivery_note TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','off')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- 自动发货卡密库存：一个商品可有多条，售出即 used。
CREATE TABLE IF NOT EXISTS shop_card_keys (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES shop_products(id),
  code       TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used')),
  used_by    TEXT,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

-- 订单：金额字段全部为分；delivery_kind 记录实际发货方式。
CREATE TABLE IF NOT EXISTS shop_orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  product_id        TEXT NOT NULL REFERENCES shop_products(id),
  quantity          INTEGER NOT NULL DEFAULT 1,
  amount_cents      INTEGER NOT NULL,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  payable_cents     INTEGER NOT NULL,
  coupon_code       TEXT,
  status            TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','delivered','refunded','cancelled')),
  delivery_kind     TEXT NOT NULL DEFAULT '',
  delivered_content TEXT,
  shipping_json     TEXT,
  created_at        TEXT NOT NULL,
  paid_at           TEXT,
  delivered_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_shop_orders_user ON shop_orders(user_id, created_at DESC);

-- 优惠码：fixed 固定立减 / percent 百分比折扣（value 为 1-100）。
CREATE TABLE IF NOT EXISTS coupons (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
  value             INTEGER NOT NULL,
  min_amount_cents  INTEGER NOT NULL DEFAULT 0,
  max_uses          INTEGER NOT NULL DEFAULT 0,
  used_count        INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  starts_at         TEXT,
  expires_at        TEXT
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id             TEXT PRIMARY KEY,
  coupon_id      TEXT NOT NULL REFERENCES coupons(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  order_id       TEXT NOT NULL REFERENCES shop_orders(id),
  discount_cents INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);

-- 推广：每个用户一个邀请码；被邀请人只可绑定一次；首单按比例记佣金。
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  code       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referrals (
  id               TEXT PRIMARY KEY,
  inviter_id       TEXT NOT NULL REFERENCES users(id),
  invitee_id       TEXT NOT NULL UNIQUE REFERENCES users(id),
  code             TEXT NOT NULL,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'bound' CHECK (status IN ('bound','settled')),
  created_at       TEXT NOT NULL
);