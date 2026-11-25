-- ============================================================
-- Mim API · PostgreSQL 17 冷启动 DDL
-- 来源：services/mim-api/src/schema.sql + src/schema.d/*.sql（按文件名升序）
-- 口径（与 SQLite 版保持一致，不做类型"优化"）：
--   · 时间列一律 text，存 UTC ISO-8601 字符串
--   · 布尔列一律 integer/smallint，存 0/1
--   · JSON 一律 text
--   · 金额一律 integer（最小货币单位）
-- 全部语句幂等；种子数据用 ON CONFLICT DO NOTHING。
-- ============================================================

BEGIN;

-- ---------- identity 域 ----------
CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  -- 对外可见的 Mim ID 号码（纯数字）；与内部 uuidv7 主键解耦
  member_no              TEXT,
  region                 TEXT NOT NULL CHECK (region IN ('cn','global')),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_deletion','deleted')),
  display_name           TEXT NOT NULL DEFAULT '',
  locale                 TEXT NOT NULL DEFAULT 'zh-CN',
  timezone               TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  -- 历史兼容列：免登录身份已移除，新账号恒为 0，列保留供旧代码读取
  is_guest               INTEGER NOT NULL DEFAULT 0,
  deletion_scheduled_at  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  deleted_at             TEXT
);
-- member_no 部分唯一索引（原由 db.ts ADDITIVE_INDEXES 在补列后创建，此处并入冷启动 DDL）
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_member_no ON users(member_no) WHERE member_no IS NOT NULL;

-- Mim ID 号码发号器：固定单行，事务内「读 + 自增」保证不重号
CREATE TABLE IF NOT EXISTS member_no_sequence (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  next_no  INTEGER NOT NULL
);
INSERT INTO member_no_sequence (id, next_no) VALUES (1, 1) ON CONFLICT DO NOTHING;

-- Mim ID 号码迁移状态（一次性重排开关）
CREATE TABLE IF NOT EXISTS member_no_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Mim ID 改号审计：旧号 → 新号，供客服追溯与回滚
CREATE TABLE IF NOT EXISTS member_no_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  old_no     TEXT,
  new_no     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  region      TEXT NOT NULL,
  provider    TEXT NOT NULL CHECK (provider IN ('phone','email','username')),
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

-- ---------- OAuth 第三方身份 ----------
-- 一个 Mim 账号可绑定多个第三方身份；同一第三方身份全局只归属一个账号
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  union_id          TEXT,
  nickname          TEXT NOT NULL DEFAULT '',
  avatar_url        TEXT,
  email             TEXT,
  raw_profile       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_accounts_union
  ON oauth_accounts(provider, union_id) WHERE union_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id, provider);

-- OAuth 临时状态：state 只存摘要，防止库泄露后被复用发起 CSRF
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash    TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  region        TEXT NOT NULL CHECK (region IN ('cn','global')),
  mode          TEXT NOT NULL CHECK (mode IN ('login','bind')),
  link_user_id  TEXT,
  code_verifier TEXT,
  redirect_uri  TEXT NOT NULL,
  return_to     TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);

-- 一次性登录票据：明文只在 302 地址中出现一次
CREATE TABLE IF NOT EXISTS oauth_login_tickets (
  ticket_hash  TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT
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

-- ---------- rbac 域 ----------
CREATE TABLE IF NOT EXISTS permissions (
  code              TEXT PRIMARY KEY,
  name_i18n         TEXT NOT NULL,
  description_i18n  TEXT NOT NULL DEFAULT '{}',
  builtin           INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  code              TEXT PRIMARY KEY,
  name_i18n         TEXT NOT NULL,
  description_i18n  TEXT NOT NULL DEFAULT '{}',
  builtin           INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code         TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code   TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_code);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id           TEXT NOT NULL,
  role_code         TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  granted_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TEXT NOT NULL,
  PRIMARY KEY (user_id, role_code)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_code);

-- ---------- im 域（即时通讯与视频通话） ----------
CREATE TABLE IF NOT EXISTS im_conversations (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('direct','group')),
  title              TEXT NOT NULL DEFAULT '',
  owner_user_id      TEXT,
  avatar_object_key  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  -- 系统会话标记（普通私聊为 NULL，成长私信为 growth）
  system_kind        TEXT
);
CREATE INDEX IF NOT EXISTS idx_im_conversations_updated ON im_conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS im_conversation_members (
  conversation_id      TEXT NOT NULL REFERENCES im_conversations(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  last_read_message_id TEXT,
  muted                INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0,1)),
  pinned               INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  joined_at            TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_im_members_user ON im_conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_im_members_conv ON im_conversation_members(conversation_id);

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
  reply_to_id     TEXT,
  reply_excerpt   TEXT,
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  -- 系统私信附带的跳转地址与按钮文案（普通消息为 NULL）
  link_url        TEXT,
  link_label      TEXT
);
CREATE INDEX IF NOT EXISTS idx_im_messages_conv_created ON im_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_im_messages_sender ON im_messages(sender_user_id, created_at DESC);

-- ---------- community 域 ----------
CREATE TABLE IF NOT EXISTS community_boards (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  icon                   TEXT NOT NULL DEFAULT '',
  sort_order             INTEGER NOT NULL DEFAULT 0,
  price_cents            INTEGER NOT NULL DEFAULT 0,
  visibility             TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers')),
  post_min_level         INTEGER NOT NULL DEFAULT 0,
  created_by             TEXT REFERENCES users(id),
  moderator_id           TEXT REFERENCES users(id),
  created_at             TEXT NOT NULL,
  -- 板块审核状态：active / pending / rejected
  status                 TEXT NOT NULL DEFAULT 'active',
  review_note            TEXT,
  reviewed_at            TEXT,
  -- 发帖频控与建板块门槛（0 表示回落到全局默认）
  rate_window_minutes    INTEGER NOT NULL DEFAULT 0,
  rate_window_max        INTEGER NOT NULL DEFAULT 0,
  daily_max              INTEGER NOT NULL DEFAULT 0,
  total_max              INTEGER NOT NULL DEFAULT 0,
  create_min_level       INTEGER NOT NULL DEFAULT 0,
  create_max_per_user    INTEGER NOT NULL DEFAULT 0
);

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
  accepted_post_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  -- 推荐指数（浏览/回复/收藏/评分 + 时间衰减），sort=recommend 依此排序
  recommend_score  REAL NOT NULL DEFAULT 0,
  -- 置顶 / 锁定（锁定后禁止继续回复）
  pinned           INTEGER NOT NULL DEFAULT 0,
  locked           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_community_threads_board ON community_threads(board_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_threads_hot ON community_threads(status, likes DESC, views DESC);

CREATE TABLE IF NOT EXISTS community_posts (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id),
  parent_id  TEXT,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- 回复软删留痕：列表与计数按 deleted_at IS NULL 过滤
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_community_posts_thread ON community_posts(thread_id, created_at);

CREATE TABLE IF NOT EXISTS community_thread_likes (
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_purchases (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  thread_id    TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, thread_id)
);

CREATE TABLE IF NOT EXISTS community_thread_media (
  id               TEXT PRIMARY KEY,
  thread_id        TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('image','video')),
  url              TEXT NOT NULL,
  poster_url       TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  -- 图库 / 视频元数据：对象键、封面键、MIME、体积、时长与分辨率
  storage_key      TEXT,
  poster_key       TEXT,
  mime             TEXT NOT NULL DEFAULT '',
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  width            INTEGER NOT NULL DEFAULT 0,
  height           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_community_thread_media ON community_thread_media(thread_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_thread_media_kind ON community_thread_media(kind, thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_media_created ON community_thread_media(created_at DESC);

-- 帖子附件：url 存对象存储键，下载由服务端按帖子权限签发短时地址
CREATE TABLE IF NOT EXISTS community_thread_attachments (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  mime       TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_community_attachments_thread ON community_thread_attachments(thread_id, sort_order);

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

CREATE TABLE IF NOT EXISTS community_favorites (
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_ratings (
  thread_id  TEXT NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_board_memberships (
  board_id     TEXT NOT NULL REFERENCES community_boards(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_board_follows (
  board_id   TEXT NOT NULL REFERENCES community_boards(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_id)
);

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

CREATE TABLE IF NOT EXISTS captchas (
  id          TEXT PRIMARY KEY,
  answer_hash TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captchas_expiry ON captchas(expires_at);

-- VIP 套餐与会员
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

-- 钱包：金额单位为分，积分为整数；一个用户一行
CREATE TABLE IF NOT EXISTS wallets (
  user_id            TEXT PRIMARY KEY REFERENCES users(id),
  balance_cents      INTEGER NOT NULL DEFAULT 0,
  points             INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  -- 可提现余额（与充值余额分开核算）
  withdrawable_cents INTEGER NOT NULL DEFAULT 0
);

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

-- 签到：同一用户同一天只能签一次；day 为 YYYY-MM-DD（UTC）
CREATE TABLE IF NOT EXISTS checkins (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  day        TEXT NOT NULL,
  points     INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  -- 连续签到天数快照
  streak     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_checkins_user_day ON checkins(user_id, day DESC);

-- 充值卡：一码一用
CREATE TABLE IF NOT EXISTS wallet_cards (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used')),
  used_by      TEXT,
  used_at      TEXT,
  created_at   TEXT NOT NULL,
  -- 卡密作废留痕
  voided_at    TEXT
);

-- 独立商城商品
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

CREATE TABLE IF NOT EXISTS shop_card_keys (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES shop_products(id),
  code       TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used')),
  used_by    TEXT,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

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
  delivered_at      TEXT,
  -- 积分抵扣留痕：消耗积分与折抵金额，原 amount/discount 不变
  points_spent      INTEGER NOT NULL DEFAULT 0,
  points_deduct_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shop_orders_user ON shop_orders(user_id, created_at DESC);

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

-- 推广：每个用户一个邀请码；被邀请人只可绑定一次
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

-- 付费数字资产
CREATE TABLE IF NOT EXISTS paid_assets (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('article','download','gallery','video')),
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  cover_url   TEXT,
  file_url    TEXT,
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

CREATE TABLE IF NOT EXISTS asset_purchases (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  asset_id     TEXT NOT NULL REFERENCES paid_assets(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_purchases_user ON asset_purchases(user_id, created_at DESC);

-- 支付意图
CREATE TABLE IF NOT EXISTS payment_intents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  purpose         TEXT NOT NULL CHECK (purpose IN ('shop_order','vip','asset','recharge')),
  ref_id          TEXT NOT NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('alipay','wechat','manual','sandbox')),
  amount_cents    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  pay_url         TEXT,
  qr_text         TEXT,
  provider_txn_id TEXT,
  expires_at      TEXT,
  created_at      TEXT NOT NULL,
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_ref ON payment_intents(purpose, ref_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id         TEXT PRIMARY KEY,
  intent_id  TEXT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  event      TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- 物流发货单：一个订单一条
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

-- 创作者收益
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

-- 站点设置：value 为 JSON 字符串
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

-- 站内私信：只存文本，read_at 为空表示未读
CREATE TABLE IF NOT EXISTS direct_messages (
  id           TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id),
  to_user_id   TEXT NOT NULL REFERENCES users(id),
  content      TEXT NOT NULL,
  read_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_direct_messages_to ON direct_messages(to_user_id, read_at, created_at DESC);

-- ============================================================
-- schema.d/01-identity.sql —— 登录与身份包
-- ============================================================
CREATE TABLE IF NOT EXISTS sso_tickets (
  ticket_hash  TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  site         TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sso_tickets_expiry ON sso_tickets(expires_at);

CREATE TABLE IF NOT EXISTS realname_records (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id),
  id_type       TEXT NOT NULL CHECK (id_type IN ('id_card','passport','other')),
  name_hash     TEXT NOT NULL,
  name_masked   TEXT NOT NULL DEFAULT '',
  id_hash       TEXT NOT NULL,
  id_last4      TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','third_party')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_realname_records_status ON realname_records(status);

CREATE TABLE IF NOT EXISTS invitations (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  created_by       TEXT REFERENCES users(id),
  max_uses         INTEGER NOT NULL DEFAULT 1,
  used_count       INTEGER NOT NULL DEFAULT 0,
  expires_at       TEXT,
  bound_identifier TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','exhausted')),
  note             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status, expires_at);

CREATE TABLE IF NOT EXISTS invitation_redemptions (
  id            TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitations(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  identifier    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_invite ON invitation_redemptions(invitation_id);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_user ON invitation_redemptions(user_id);

-- ============================================================
-- schema.d/07-content.sql —— 公告 / 更新日志 / 推广计划
-- ============================================================
CREATE TABLE IF NOT EXISTS announcements (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  level        TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','success','danger')),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at TEXT, -- 首次发布时间；发布端点仅首次写入
  starts_at    TEXT, -- NULL 表示立即生效
  ends_at      TEXT, -- 开区间；NULL 表示长期有效
  pinned       INTEGER NOT NULL DEFAULT 0,
  author_id    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_public ON announcements(status, pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS changelog_entries (
  id           TEXT PRIMARY KEY,
  version      TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  changes      TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changelog_public ON changelog_entries(status, published_at DESC);

CREATE TABLE IF NOT EXISTS promotions (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  target_url       TEXT NOT NULL DEFAULT '',
  code             TEXT,
  starts_at        TEXT,
  ends_at          TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  budget_cents     INTEGER NOT NULL DEFAULT 0,
  click_count      INTEGER NOT NULL DEFAULT 0,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotions_code ON promotions(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_public ON promotions(status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS promotion_clicks (
  id              TEXT PRIMARY KEY,
  promotion_id    TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  visitor_hash    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_clicks_key ON promotion_clicks(promotion_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_clicks_visitor ON promotion_clicks(promotion_id, visitor_hash, created_at);

CREATE TABLE IF NOT EXISTS promotion_conversions (
  id              TEXT PRIMARY KEY,
  promotion_id    TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  visitor_hash    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_conversions_key ON promotion_conversions(promotion_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_conversions_visitor ON promotion_conversions(promotion_id, visitor_hash, created_at);

-- ---------- 幂等种子（原 INSERT OR IGNORE → ON CONFLICT DO NOTHING） ----------
INSERT INTO announcements (id, title, body, level, status, published_at, starts_at, ends_at, pinned, author_id, created_at, updated_at)
VALUES
  ('ann-seed-welcome', 'Mim 社区使用指南', '欢迎来到 Mim。商城、社区与创作工具均已开放；如需帮助，可在社区「求助答疑」板块发帖。', 'info', 'published', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z', 1, 'system', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ann-seed-release', '内容与公告能力上线', '公告、更新日志与推广计划已开放：访客可浏览公开内容，运营团队在后台维护更新。', 'success', 'published', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('ann-seed-draft', '【草稿】待发布公告', '本条为草稿种子，公开列表不可见；运营在后台编辑发布后才会展示。', 'warning', 'draft', NULL, NULL, NULL, 0, 'system', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO changelog_entries (id, version, title, body, changes, published_at, status, created_at, updated_at)
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
  ('cl-seed-010', '0.0.10', '圈子、积分抵扣与工具升级', '新增独立圈子与商城积分抵扣，自研工具可直接运行；验证码与内容权限同步加强。', '["独立圈子", "积分抵扣", "工具中心与安全加固"]', '2026-11-13T09:00:00.000Z', 'published', '2026-11-13T09:00:00.000Z', '2026-11-13T09:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO promotions (id, name, summary, target_url, code, starts_at, ends_at, status, budget_cents, click_count, conversion_count, created_at, updated_at)
VALUES
  ('promo-seed-launch', '上线首月推广', '新用户首月体验引导：浏览社区动态与使用指南，了解 Mim 功能。', '/community', 'MIM-LAUNCH', '2026-01-01T00:00:00.000Z', '2099-12-31T23:59:59.000Z', 'active', 500000, 0, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
ON CONFLICT DO NOTHING;

-- RBAC 权限点注册：域脚本先于 seedRbac 执行，这里先占位内置 superadmin 角色
INSERT INTO roles (code, name_i18n, description_i18n, builtin, created_at, updated_at)
VALUES (
  'superadmin',
  '{"zh-CN":"超级管理员","en-US":"Super Admin"}',
  '{"zh-CN":"拥有全部权限，可管理角色与用户授权","en-US":"Full access"}',
  1,
  '2026-11-13T00:00:00.000Z',
  '2026-11-13T00:00:00.000Z'
) ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, name_i18n, description_i18n, builtin, created_at, updated_at)
VALUES (
  'content:write',
  '{"zh-CN":"维护内容运营","en-US":"Manage content operations"}',
  '{"zh-CN":"公告 / 更新日志 / 推广计划的维护、发布归档与转化回写","en-US":"Maintain announcements, changelog and promotions"}',
  1,
  '2026-11-13T00:00:00.000Z',
  '2026-11-13T00:00:00.000Z'
) ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, created_at)
VALUES ('superadmin', 'content:write', '2026-11-13T00:00:00.000Z')
ON CONFLICT DO NOTHING;

-- ============================================================
-- schema.d/08-announcements-project-content.sql —— 公告种子（面向普通用户）
-- ============================================================
INSERT INTO announcements (id, title, body, level, status, published_at, starts_at, ends_at, pinned, author_id, created_at, updated_at)
VALUES
  ('ann-seed-project-map', 'Mim 功能总览', 'Mim 提供账号、社区、商城、付费内容、搜索与创作工具等服务。你可以通过顶部导航或统一搜索快速找到需要的功能；具体使用方式见各功能页说明。', 'success', 'published', '2026-11-13T12:00:00.000Z', '2026-11-13T12:00:00.000Z', '2099-12-31T23:59:59.000Z', 1, 'system', '2026-11-13T12:00:00.000Z', '2026-11-13T12:00:00.000Z'),
  ('ann-seed-account', '账号注册与登录', '账号暂不开放自助注册，如需开通请联系管理员。用户名不得冒用官方或他人身份。开通后可使用账号口令登录，也可在个人中心绑定第三方账号、手机或邮箱；部分登录方式需先完成绑定后使用。', 'info', 'published', '2026-11-13T11:50:00.000Z', '2026-11-13T11:50:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T11:50:00.000Z', '2026-11-13T11:50:00.000Z'),
  ('ann-seed-community', '社区与圈子使用说明', '社区分为板块与圈子：板块是公开内容分区，圈子是成员制社群。支持发帖、问答采纳、投票、图集与视频；加入圈子后可查看成员动态。请遵守社区规范，违规内容会被处理。', 'info', 'published', '2026-11-13T11:40:00.000Z', '2026-11-13T11:40:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T11:40:00.000Z', '2026-11-13T11:40:00.000Z'),
  ('ann-seed-shop', '商城购买与发货说明', '商城支持实物快递、卡密自动发货、网盘自动发货与人工发货。结算时可按顺序使用优惠码、积分抵扣与余额。购买后可申请售后并对商品进行评价。', 'success', 'published', '2026-11-13T11:30:00.000Z', '2026-11-13T11:30:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T11:30:00.000Z', '2026-11-13T11:30:00.000Z'),
  ('ann-seed-paid-content', '付费内容与会员权益', '付费内容包括阅读、下载、图库与视频；购买后按权益解锁，也可通过会员权益查看。创作者可在创作中心查看收益并申请结算，平台会进行人工审核。', 'info', 'published', '2026-11-13T11:20:00.000Z', '2026-11-13T11:20:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T11:20:00.000Z', '2026-11-13T11:20:00.000Z'),
  ('ann-seed-payments', '支付方式说明', '下单时可选择当前可用的支付方式。若某渠道暂不可用，页面会明确提示，不会生成虚假订单。支付完成后可在个人中心查看订单状态与售后入口。', 'info', 'published', '2026-11-13T11:10:00.000Z', '2026-11-13T11:10:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T11:10:00.000Z', '2026-11-13T11:10:00.000Z'),
  ('ann-seed-security', '账号安全提醒', '登录环节可能要求完成验证码。请勿向他人透露口令或验证码；发现异常登录请及时修改口令并联系管理员。', 'info', 'published', '2026-11-13T11:00:00.000Z', '2026-11-13T11:00:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T11:00:00.000Z', '2026-11-13T11:00:00.000Z'),
  ('ann-seed-search-i18n', '搜索与语言设置', '统一搜索可检索模块、入口、导航、社区与商城内容。界面支持中英文切换，语言设置会保存在个人偏好中。', 'info', 'published', '2026-11-13T10:50:00.000Z', '2026-11-13T10:50:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T10:50:00.000Z', '2026-11-13T10:50:00.000Z'),
  ('ann-seed-appearance', '界面与页面设置', '支持导航项、背景、配色与列表样式设置；活动页与说明页可通过页面区块搭建。设置保存后即时生效。', 'info', 'published', '2026-11-13T10:40:00.000Z', '2026-11-13T10:40:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T10:40:00.000Z', '2026-11-13T10:40:00.000Z'),
  ('ann-seed-tools', '自研工具使用说明', '工具中心提供建站脚本生成、数据库换域名与站点防护配置三类工具。执行前请先备份数据，并建议在测试环境验证后再用于生产。', 'success', 'published', '2026-11-13T10:30:00.000Z', '2026-11-13T10:30:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T10:30:00.000Z', '2026-11-13T10:30:00.000Z'),
  ('ann-seed-ops', '服务维护与公告', '系统维护或升级期间，部分功能可能短暂不可用。维护完成后会在公告栏说明；如遇问题可通过社区反馈。', 'info', 'published', '2026-11-13T10:20:00.000Z', '2026-11-13T10:20:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T10:20:00.000Z', '2026-11-13T10:20:00.000Z'),
  ('ann-seed-boundaries', '功能说明与使用边界', '部分功能需在配置相应服务后启用，页面会如实提示不可用状态。若某项功能入口暂未开放，请关注后续公告。', 'info', 'published', '2026-11-13T10:10:00.000Z', '2026-11-13T10:10:00.000Z', '2099-12-31T23:59:59.000Z', 0, 'system', '2026-11-13T10:10:00.000Z', '2026-11-13T10:10:00.000Z')
ON CONFLICT DO NOTHING;

-- ============================================================
-- schema.d/10-commerce3.sql —— 批量改价 / 积分抵扣
-- ============================================================
CREATE TABLE IF NOT EXISTS price_batches (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type = 'shop_product'),
  mode            TEXT NOT NULL CHECK (mode IN ('fixed', 'percent', 'amount')),
  direction       TEXT NOT NULL CHECK (direction IN ('set', 'increase', 'decrease')),
  value           INTEGER NOT NULL,
  filter_json     TEXT NOT NULL,
  total           INTEGER NOT NULL DEFAULT 0,
  changed         INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  rolled_back_at  TEXT,
  UNIQUE (actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS price_batch_items (
  id                  TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES price_batches(id),
  target_type         TEXT NOT NULL,
  target_id           TEXT NOT NULL,
  price_row_id        TEXT,
  target_code         TEXT,
  currency            TEXT,
  before_amount_minor INTEGER,
  after_amount_minor  INTEGER,
  skipped             INTEGER NOT NULL DEFAULT 0,
  reason              TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_batch_items_batch ON price_batch_items(batch_id);

-- ============================================================
-- schema.d/10-payments-ext.sql —— 扩展支付渠道
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_ext_intents (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  purpose          TEXT NOT NULL CHECK (purpose IN ('shop_order','vip','asset','recharge')),
  ref_id           TEXT NOT NULL,
  provider         TEXT NOT NULL CHECK (provider IN ('hupijiao','xunhu','paypal','stripe','alipay_ent')),
  amount_cents     INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'CNY',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  pay_url          TEXT,
  qr_text          TEXT,
  provider_txn_id  TEXT,
  client_secret    TEXT,
  expires_at       TEXT,
  created_at       TEXT NOT NULL,
  paid_at          TEXT,
  refund_status    TEXT,
  refunded_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_ext_intents_user ON payment_ext_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_ext_intents_ref ON payment_ext_intents(purpose, ref_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_ext_txn ON payment_ext_intents(provider_txn_id) WHERE provider_txn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_ext_events (
  id         TEXT PRIMARY KEY,
  intent_id  TEXT NOT NULL REFERENCES payment_ext_intents(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  event      TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_ext_refunds (
  id                 TEXT PRIMARY KEY,
  intent_id          TEXT NOT NULL REFERENCES payment_ext_intents(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  provider_refund_id TEXT,
  reason             TEXT NOT NULL DEFAULT '',
  payload            TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_ext_refund_txn ON payment_ext_refunds(provider_refund_id) WHERE provider_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_ext_refunds_intent ON payment_ext_refunds(intent_id, created_at DESC);

-- ============================================================
-- schema.d/10-community-phase3.sql —— 板块 Tab 配置与付费板块种子
-- ============================================================
CREATE TABLE IF NOT EXISTS community_board_tab_configs (
  board_id   TEXT NOT NULL REFERENCES community_boards(id) ON DELETE CASCADE,
  tab_key    TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1,
  sort_by    TEXT NOT NULL DEFAULT 'latest',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (board_id, tab_key)
);
CREATE INDEX IF NOT EXISTS idx_community_board_tabs ON community_board_tab_configs(board_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_community_threads_recommend ON community_threads(status, recommend_score DESC);

INSERT INTO community_boards (id, slug, name, description, icon, sort_order, price_cents, created_at)
VALUES (
  'board-paid',
  'paid',
  '知识付费',
  '付费板块：付费阅读、资源下载、图库与视频，加入后可见完整正文与媒体。',
  '🔖',
  4,
  1900,
  to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD HH24:MI:SS')
) ON CONFLICT DO NOTHING;

-- ============================================================
-- schema.d/10-shipments-aftersales.sql —— 发货闭环与售后
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);

CREATE TABLE IF NOT EXISTS after_sales_requests (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES shop_orders(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('refund_only', 'return_refund', 'repair')),
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note  TEXT,
  handled_by  TEXT,
  handled_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_after_sales_status ON after_sales_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_after_sales_requests_user ON after_sales_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_after_sales_order ON after_sales_requests(order_id);

-- ============================================================
-- schema.d/20-appearance.sql —— 外观兜底默认值
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_page_blocks_page_sort ON page_blocks(page, enabled, sort_order ASC);

INSERT INTO site_settings (key, value, updated_at)
VALUES (
  'theme',
  '{"accent":"#3b6ef5","background":"#f5f6f7","nav_layout":"top","list_style":"card","radius":12,"font":"system-ui","mode":"light"}',
  '2026-11-13T00:00:00.000Z'
) ON CONFLICT DO NOTHING;

INSERT INTO site_settings (key, value, updated_at)
VALUES (
  'site',
  '{"title":"Mim","subtitle":"跨平台商业级项目","footer":"Mim · 开源与商业化并行"}',
  '2026-11-13T00:00:00.000Z'
) ON CONFLICT DO NOTHING;

-- ============================================================
-- schema.d/30-security.sql —— 安全加固索引 + CDN 刷新审计
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_content_reports_scope
  ON content_reports(reporter_id, target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_captchas_created
  ON captchas(created_at);

CREATE TABLE IF NOT EXISTS cdn_purge_audit (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  provider    TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  configured  INTEGER NOT NULL,
  purged_json TEXT NOT NULL DEFAULT '[]',
  error       TEXT,
  status      INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cdn_purge_created
  ON cdn_purge_audit(created_at);

-- ============================================================
-- schema.d/40-circles.sql —— 圈子域
-- ============================================================
CREATE TABLE IF NOT EXISTS circles (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  intro        TEXT NOT NULL DEFAULT '',
  cover_url    TEXT,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  visibility   TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  join_mode    TEXT NOT NULL DEFAULT 'open' CHECK (join_mode IN ('open','approve','invite')),
  member_limit INTEGER NOT NULL DEFAULT 0,
  category     TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  invite_code  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_circles_owner ON circles(owner_id);
CREATE INDEX IF NOT EXISTS idx_circles_list ON circles(visibility, category, status);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','left')),
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_circle_members_circle ON circle_members(circle_id, status);
CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id, status);

CREATE TABLE IF NOT EXISTS circle_posts (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  thread_id  TEXT,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_circle_posts_circle ON circle_posts(circle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS circle_notices (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_circle_notices_circle ON circle_notices(circle_id, created_at DESC);

-- ============================================================
-- schema.d/41-community-view-dedup.sql —— 浏览计数去重
-- ============================================================
CREATE TABLE IF NOT EXISTS data_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_thread_views (
  thread_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_thread_views_user ON community_thread_views (user_id);

-- 历史浏览数清零：只在标记不存在时执行
UPDATE community_threads
SET views = 0
WHERE NOT EXISTS (
  SELECT 1 FROM data_migrations WHERE id = '2026-11-15-reset-community-views'
);

INSERT INTO data_migrations (id, applied_at)
VALUES ('2026-11-15-reset-community-views', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING;

-- ============================================================
-- schema.d/42-community-engagement.sql —— 站内通知 / 社区举报
-- ============================================================
-- 注：community_thread_attachments 与 ix_community_attachments_thread 已在主 schema.sql 建出
CREATE TABLE IF NOT EXISTS community_notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  thread_id  TEXT,
  post_id    TEXT,
  actor_id   TEXT,
  content    TEXT NOT NULL DEFAULT '',
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_community_notifications_user ON community_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_community_notifications_unread ON community_notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS community_reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('thread','post')),
  target_id   TEXT NOT NULL,
  thread_id   TEXT,
  board_id    TEXT,
  reason      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by TEXT,
  resolution  TEXT,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_community_reports_status ON community_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_community_reports_board ON community_reports(board_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_community_reports_target ON community_reports(target_type, target_id);

-- ============================================================
-- schema.d/50-unified-commerce.sql —— 统一交易域（只新增）
-- ============================================================
-- 统一商品：三条商品线共用一张表，用 kind 区分
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('physical','card','asset')),
  code        TEXT,
  title       TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency    TEXT NOT NULL DEFAULT 'CNY',
  stock       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','off')),
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

-- 统一订单：各产线历史订单回填后共用该表；UNIQUE 保证回填幂等
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  source         TEXT NOT NULL CHECK (source IN ('shop','asset','community')),
  source_id      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','delivered','refunded','cancelled')),
  channel        TEXT NOT NULL DEFAULT 'manual',
  currency       TEXT NOT NULL DEFAULT 'CNY',
  total_cents    INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  payable_cents  INTEGER NOT NULL DEFAULT 0 CHECK (payable_cents >= 0),
  created_at     TEXT NOT NULL,
  paid_at        TEXT,
  UNIQUE (source, source_id)
);

-- 订单明细：数量与单价在下单时快照；product_id 不强绑外键（兼容未回填品类）
CREATE TABLE IF NOT EXISTS order_items (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL,
  title            TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  meta_json        TEXT NOT NULL DEFAULT '{}'
);

-- 统一支付流水：一张订单可多次支付 / 退款，退款方向由负金额表达
CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL DEFAULT 'wallet',
  status         TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','failed','refunded')),
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  created_at     TEXT NOT NULL
);

-- 统一履约：数字交付 / 发货 / 发卡密共用一张表
CREATE TABLE IF NOT EXISTS fulfillments (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('entitlement','shipment','card_key')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_source ON orders(source, source_id);
CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_payments_order ON payments(order_id, created_at);
CREATE INDEX IF NOT EXISTS ix_fulfillments_order ON fulfillments(order_id);

-- ============================================================
-- schema.d/55-unified-content-messaging.sql —— 统一内容与消息域（只新增）
-- ============================================================
-- 统一内容条目：论坛主题 / 圈内动态 / 圈内公告共用一张
CREATE TABLE IF NOT EXISTS content_items (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL CHECK (source IN ('community_thread','circle_post','circle_notice')),
  source_id      TEXT NOT NULL,
  container_kind TEXT NOT NULL CHECK (container_kind IN ('board','circle')),
  container_id   TEXT NOT NULL,
  author_id      TEXT,
  kind           TEXT NOT NULL DEFAULT 'text',
  title          TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden','archived')),
  metrics_json   TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (source, source_id)
);

-- 统一会话：IM 会话与裸私信共用一张
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL CHECK (source IN ('im','dm')),
  source_id     TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('direct','group')),
  title         TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  members_json  TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (source, source_id)
);

-- 统一消息：IM 消息与裸私信共用一张
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('im','dm')),
  source_id       TEXT NOT NULL,
  sender_user_id  TEXT NOT NULL,
  content_type    TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text','image','file','system')),
  content         TEXT NOT NULL DEFAULT '',
  object_key      TEXT,
  object_mime     TEXT,
  object_name     TEXT,
  object_size     INTEGER,
  reply_to_id     TEXT,
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read')),
  created_at      TEXT NOT NULL,
  deleted_at      TEXT,
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS ix_content_items_container ON content_items(container_kind, container_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_content_items_created ON content_items(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_messages_conversation ON messages(conversation_id, created_at);

-- ============================================================
-- schema.d/60-vip-pricing-referral.sql —— VIP 定价规则 / 返佣佣金
-- ============================================================
-- 优先级（代码侧固定）：module > category > asset_kind > 原价
CREATE TABLE IF NOT EXISTS vip_price_rules (
  id               TEXT PRIMARY KEY,
  dimension        TEXT NOT NULL CHECK (dimension IN ('module','category','asset_kind')),
  dimension_value  TEXT NOT NULL,
  level_min        INTEGER NOT NULL DEFAULT 1,
  mode             TEXT NOT NULL CHECK (mode IN ('fixed','discount')),
  price_cents      INTEGER,
  discount_percent INTEGER,
  currency         TEXT NOT NULL DEFAULT 'CNY',
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vip_price_rules_dim
  ON vip_price_rules(dimension, dimension_value, enabled);

-- 返佣明细：pending / settled / reversed 三态；UNIQUE 防重复计佣
CREATE TABLE IF NOT EXISTS referral_commissions (
  id           TEXT PRIMARY KEY,
  referral_id  TEXT NOT NULL REFERENCES referrals(id),
  inviter_id   TEXT NOT NULL REFERENCES users(id),
  invitee_id   TEXT NOT NULL REFERENCES users(id),
  order_id     TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  rate         REAL NOT NULL,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','reversed')),
  settle_at    TEXT NOT NULL,
  settled_at   TEXT,
  reversed_at  TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  UNIQUE (order_id, inviter_id, level)
);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_inviter
  ON referral_commissions(inviter_id, status, settle_at);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_order
  ON referral_commissions(order_id);

-- ============================================================
-- schema.d/65-growth-dm.sql —— 成长私信（复用 IM 会话/消息表）
-- im_conversations.system_kind / im_messages.link_url / link_label 已合并进主 schema.sql
-- ============================================================
-- 群发批次台账：dedupe_key 唯一约束承担重复提交的幂等语义
CREATE TABLE IF NOT EXISTS growth_dm_campaigns (
  id            TEXT PRIMARY KEY,
  dedupe_key    TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  link_url      TEXT,
  link_label    TEXT,
  audience_json TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  target_count  INTEGER NOT NULL DEFAULT 0,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  operator_id   TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL,
  sent_at       TEXT
);

-- 逐用户投递台账：主键保证同一批次对同一用户最多一条
CREATE TABLE IF NOT EXISTS growth_dm_deliveries (
  campaign_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_growth_dm_deliveries_user ON growth_dm_deliveries(user_id);

-- ============================================================
-- schema.d/70-withdrawals.sql —— 提现申请（钱包可提现余额见 wallets.withdrawable_cents）
-- ============================================================
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid','cancelled')),
  method      TEXT NOT NULL CHECK (method IN ('alipay','wechat','bank')),
  account_name TEXT NOT NULL,
  account_no   TEXT NOT NULL,
  review_note  TEXT NOT NULL DEFAULT '',
  reviewer     TEXT,
  payout_ref   TEXT,
  created_at   TEXT NOT NULL,
  reviewed_at  TEXT,
  paid_at      TEXT,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id, created_at DESC);
-- 处理中申请唯一：pending / approved 同时只允许一笔
CREATE UNIQUE INDEX IF NOT EXISTS ux_withdrawal_requests_open
  ON withdrawal_requests(user_id) WHERE status IN ('pending','approved');

-- ============================================================
-- schema.d/75-gallery-video.sql —— 图库 / 视频收藏
-- 媒体元数据列已合并进 community_thread_media（主 schema.sql），
-- idx_thread_media_kind / idx_thread_media_created 亦已在上文创建
-- ============================================================
CREATE TABLE IF NOT EXISTS gallery_favorites (
  user_id    TEXT NOT NULL REFERENCES users(id),
  media_id   TEXT NOT NULL REFERENCES community_thread_media(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_gallery_favorites_user ON gallery_favorites(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_favorites_media ON gallery_favorites(media_id);

-- ============================================================
-- schema.d/80-audit.sql —— 管理端审计留痕
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  region     TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  request_id TEXT,
  payload    TEXT,
  created_at TEXT NOT NULL,
  result     TEXT NOT NULL DEFAULT 'success'
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============================================================
-- schema.d/85-growth-chain.sql —— 社区激励链：签到 → 积分 → 等级 → 徽章
-- 注意：checkins.streak 已合并进主 schema.sql；idx_checkins_user_day 已在上面创建
-- ============================================================
-- level 从 1 起，min_points 为进入该等级所需累计积分；perks 为权益文案 JSON 数组
CREATE TABLE IF NOT EXISTS growth_levels (
  level      INTEGER PRIMARY KEY CHECK (level >= 1),
  name       TEXT NOT NULL,
  min_points INTEGER NOT NULL UNIQUE CHECK (min_points >= 0),
  perks      TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- condition_type 决定条件口径：checkin_streak / level / post_count / points
CREATE TABLE IF NOT EXISTS growth_badges (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  icon            TEXT NOT NULL DEFAULT '',
  condition_type  TEXT NOT NULL CHECK (condition_type IN ('checkin_streak', 'level', 'post_count', 'points')),
  condition_value INTEGER NOT NULL CHECK (condition_value >= 0),
  active          INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_badges_active ON growth_badges(active, sort_order);

-- 同一徽章只授予一次；重复授予走 ON CONFLICT DO NOTHING
CREATE TABLE IF NOT EXISTS user_badges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  badge_code TEXT NOT NULL REFERENCES growth_badges(code),
  source     TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'admin')),
  awarded_at TEXT NOT NULL,
  UNIQUE (user_id, badge_code)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, awarded_at DESC);

-- lifetime_points 为累计获得积分（只增不减，消费不扣）
CREATE TABLE IF NOT EXISTS user_growth (
  user_id         TEXT PRIMARY KEY REFERENCES users(id),
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  level           INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL
);

-- 签到规则配置（单行）。签到积分 = base + min(streak-1, cap) * per_day
CREATE TABLE IF NOT EXISTS growth_config (
  id         TEXT PRIMARY KEY CHECK (id = 'default'),
  config     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------- 幂等种子 ----------
INSERT INTO growth_levels (level, name, min_points, perks, created_at, updated_at) VALUES
  (1, '新人', 0, '["社区基础功能"]', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  (2, '活跃', 300, '["专属等级标识"]', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  (3, '常驻', 1000, '["专属等级标识","优先参与社区活动"]', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  (4, '资深', 3000, '["专属等级标识","优先参与社区活动","内容优先推荐"]', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  (5, '元老', 8000, '["专属等级标识","优先参与社区活动","内容优先推荐","社区荣誉展示"]', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT DO NOTHING;

INSERT INTO growth_badges (code, name, description, icon, condition_type, condition_value, active, sort_order, created_at, updated_at) VALUES
  ('checkin-7', '七日不辍', '连续签到 7 天', 'calendar', 'checkin_streak', 7, 1, 10, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  ('checkin-30', '月满勤', '连续签到 30 天', 'calendar-check', 'checkin_streak', 30, 1, 20, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  ('level-3', '常驻成员', '达到等级 3', 'level', 'level', 3, 1, 30, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  ('post-10', '初露锋芒', '发布 10 篇主题', 'post', 'post_count', 10, 1, 40, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT DO NOTHING;

INSERT INTO growth_config (id, config, updated_at)
VALUES ('default', '{"timezone":"Asia/Shanghai","checkin":{"base_points":5,"streak_bonus_per_day":1,"streak_bonus_cap":10}}', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT DO NOTHING;

-- 存量用户成长档案回填：累计积分 = 钱包流水里所有正向积分之和
INSERT INTO user_growth (user_id, lifetime_points, level, updated_at)
SELECT user_id, SUM(points)::integer, 1, to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM wallet_transactions
WHERE points > 0
GROUP BY user_id
ON CONFLICT (user_id) DO NOTHING;

-- 按最新等级门槛校准档案等级；仅在不一致时更新，可重复执行
UPDATE user_growth
SET level = COALESCE((SELECT MAX(l.level) FROM growth_levels l WHERE l.min_points <= user_growth.lifetime_points), 1)
WHERE level <> COALESCE((SELECT MAX(l.level) FROM growth_levels l WHERE l.min_points <= user_growth.lifetime_points), 1);

COMMIT;
