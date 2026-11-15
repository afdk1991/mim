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
  -- 对外可见的 Mim ID 号码（纯数字，如 10000001；2026-11-12 起改为 QQ 号样式）：
  -- 注册时由序号表原子分配，与内部 uuidv7 主键解耦——主键不对外暴露、可迁移，号码供用户识别与客服引用。
  member_no         TEXT,
  region            TEXT NOT NULL CHECK (region IN ('cn','global')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_deletion','deleted')),
  display_name      TEXT NOT NULL DEFAULT '',
  locale            TEXT NOT NULL DEFAULT 'zh-CN',
  timezone          TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  -- 历史兼容列：2026-11-15 起项目已移除免登录身份，建号不再写入该列，
  -- 新账号恒为默认值 0。列本身保留（读取它的鉴权/展示代码仍有引用），不参与任何业务判断。
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
-- 首个号码从 1 开始：号码空间是个位数起步的纯数字序列，靓号（豹子 / 顺子 / 回文等）由发号器跳过。
INSERT OR IGNORE INTO member_no_sequence (id, next_no) VALUES (1, 1);

-- Mim ID 号码迁移状态：一次性重排的开关，避免每次启动都重写全表号码。
CREATE TABLE IF NOT EXISTS member_no_meta (
  key   TEXT PRIMARY KEY, -- 迁移键，如 renumber_v1
  value TEXT NOT NULL     -- 迁移状态值，done 表示已完成
);

-- Mim ID 改号审计：记录每轮重排的旧号 → 新号，供客服追溯与必要回滚（旧号可能已被用户对外告知）。
CREATE TABLE IF NOT EXISTS member_no_history (
  id         TEXT PRIMARY KEY, -- 审计行主键（uuidv7）
  user_id    TEXT NOT NULL REFERENCES users(id), -- 归属用户
  old_no     TEXT,             -- 重排前的旧号（首次发号可能为 NULL）
  new_no     TEXT NOT NULL,    -- 重排后的新号
  created_at TEXT NOT NULL     -- 重排时间
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
-- 权限点：细粒度动作标识（如 commerce:write），由代码侧 requirePermission 按字符串匹配；
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
-- 不对 user_id 建外键：与用户授权记录一致，用户软删除后保留授权历史便于审计。
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
  -- public：所有人可读；followers：关注板块后才可读。版主与运营始终可读。
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers')),
  -- 发帖最低等级（1 起）；0 表示不限制。
  post_min_level INTEGER NOT NULL DEFAULT 0,
  -- 用户自建板块的创建者与版主；官方种子板块两者均为 NULL。
  created_by    TEXT REFERENCES users(id),
  moderator_id  TEXT REFERENCES users(id),
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
  -- 问答帖被提问者采纳的回复 ID；NULL 表示尚未采纳。
  accepted_post_id TEXT,
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

-- 帖子媒体：图集多图与视频地址，按 sort_order 顺序展示。
CREATE TABLE IF NOT EXISTS community_thread_media (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('image','video')),
  url        TEXT NOT NULL,
  poster_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_thread_media ON community_thread_media(thread_id, sort_order);

-- 帖子附件：正文之外的可下载文件，复用媒体对象存储；url 列存对象键（不是公开直链），
-- 下载一律由服务端按帖子权限签发短时地址。与 community_thread_media（图片/视频）分开存放。
CREATE TABLE IF NOT EXISTS community_thread_attachments (
  id         TEXT PRIMARY KEY,                                       -- 附件主键
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE, -- 归属帖子，删帖时附件一并清理
  name       TEXT NOT NULL,                                          -- 展示文件名（浏览器另存为默认名）
  url        TEXT NOT NULL,                                          -- 对象存储键（签名下载时使用，绝不直接下发）
  mime       TEXT NOT NULL DEFAULT '',                               -- 文件 MIME，展示与下载提示用
  size_bytes INTEGER NOT NULL DEFAULT 0,                             -- 文件大小（字节），0 表示未知
  sort_order INTEGER NOT NULL DEFAULT 0,                             -- 展示顺序
  created_at TEXT NOT NULL                                           -- 上传时间
);
CREATE INDEX IF NOT EXISTS ix_community_attachments_thread ON community_thread_attachments(thread_id, sort_order);

-- 投票选项与投票记录：一人一票，可改投；结果实时按选项聚合。
CREATE TABLE IF NOT EXISTS community_poll_options (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS community_poll_votes (
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL REFERENCES community_poll_options(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- 收藏：复合主键防重复；列表按收藏时间倒序。
CREATE TABLE IF NOT EXISTS community_favorites (
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- 评分：1–5 星，一人一帖一评，可修改。
CREATE TABLE IF NOT EXISTS community_ratings (
  thread_id TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id),
  rating    INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- 付费板块加入记录：price_cents > 0 的板块需先加入才能查看与发帖。
CREATE TABLE IF NOT EXISTS community_board_memberships (
  board_id   TEXT NOT NULL REFERENCES community_boards(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_id)
);

-- 板块关注：followers 可见板块的准入记录；关注免费，取消关注立即失去可见性。
CREATE TABLE IF NOT EXISTS community_board_follows (
  board_id   TEXT NOT NULL REFERENCES community_boards(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_id)
);

-- 剧集目录：series 帖的每一集独立存媒体与标题，按 sort_order 播放。
CREATE TABLE IF NOT EXISTS community_series_episodes (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  media_url  TEXT NOT NULL,
  poster_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_series_episodes ON community_series_episodes(thread_id, sort_order);

-- 内容举报：限流按 user_id + created_at 在路由层统计；status 供运营处理。
CREATE TABLE IF NOT EXISTS content_reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('thread','post','asset','product','user')),
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','rejected')),
  admin_note  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporter_id, created_at DESC);

-- 图形验证码：存答案摘要，10 分钟过期，一次性使用。
CREATE TABLE IF NOT EXISTS captchas (
  id          TEXT PRIMARY KEY,
  answer_hash TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captchas_expiry ON captchas(expires_at);

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

-- ===== 商业化二期：数字资产 / 支付 / 物流售后 / 资金 / 外观 / 成长 / 国际化 =====

-- 付费数字资产：article 付费阅读、download 付费下载、gallery 付费图库、video 付费视频。
CREATE TABLE IF NOT EXISTS paid_assets (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('article','download','gallery','video')),
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  cover_url   TEXT,
  file_url    TEXT,
  -- 图库 / 视频资产的媒体数组：[{kind,url,poster_url}]，旧行空数组。
  media_json  TEXT NOT NULL DEFAULT '[]',
  price_cents INTEGER NOT NULL DEFAULT 0,
  vip_free    INTEGER NOT NULL DEFAULT 0,
  author_id   TEXT REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','off')),
  views       INTEGER NOT NULL DEFAULT 0,
  sales       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paid_assets_kind ON paid_assets(kind, status, created_at DESC);

-- 资产购买记录：同一用户同一资产只记一次，重复购买直接复用。
CREATE TABLE IF NOT EXISTS asset_purchases (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  asset_id     TEXT NOT NULL REFERENCES paid_assets(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_purchases_user ON asset_purchases(user_id, created_at DESC);

-- 支付意图：一个订单 / 会员 / 资产 / 充值对应一条，金额由服务端按商品价格计算。
CREATE TABLE IF NOT EXISTS payment_intents (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  purpose        TEXT NOT NULL CHECK (purpose IN ('shop_order','vip','asset','recharge')),
  ref_id         TEXT NOT NULL,
  provider       TEXT NOT NULL CHECK (provider IN ('alipay','wechat','manual','sandbox')),
  amount_cents   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  pay_url        TEXT,
  qr_text        TEXT,
  provider_txn_id TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL,
  paid_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_ref ON payment_intents(purpose, ref_id);

-- 支付回调审计：每次第三方回调都落一条，便于对账与排查重复通知。
CREATE TABLE IF NOT EXISTS payment_events (
  id         TEXT PRIMARY KEY,
  intent_id  TEXT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  event      TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- 物流发货单：一个订单一条，events_json 存轨迹节点数组。
CREATE TABLE IF NOT EXISTS shipments (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL UNIQUE REFERENCES shop_orders(id) ON DELETE CASCADE,
  carrier     TEXT NOT NULL,
  tracking_no TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picked','transit','delivered','exception')),
  events_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 创作者收益：资产 / 付费帖售出后按比例记账，settled 表示已进入可提现余额。
CREATE TABLE IF NOT EXISTS creator_earnings (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  source_type        TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  gross_cents        INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  net_cents          INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled')),
  created_at         TEXT NOT NULL,
  settled_at         TEXT,
  UNIQUE (source_type, source_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_user ON creator_earnings(user_id, created_at DESC);

-- 站点设置：主题、导航、配色、前后台语言等键值配置，value 为 JSON 字符串。
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 页面区块：page 为 forum 等前台页面标识，config_json 由前端渲染器消费。
CREATE TABLE IF NOT EXISTS page_blocks (
  id          TEXT PRIMARY KEY,
  page        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_page_blocks_page ON page_blocks(page, enabled, sort_order);

-- 站内私信：只存文本，read_at 为空表示未读。
CREATE TABLE IF NOT EXISTS direct_messages (
  id           TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id),
  to_user_id   TEXT NOT NULL REFERENCES users(id),
  content      TEXT NOT NULL,
  read_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_direct_messages_to ON direct_messages(to_user_id, read_at, created_at DESC);