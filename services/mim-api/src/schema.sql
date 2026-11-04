-- ============================================================
-- Mim API · SQLite 本地开发库结构
-- 忠于 08-dev-implementation §3.2/§3.3 的分域与表语义；
-- SQLite 无 schema 概念，ops 域表以 idempotency_keys / audit_logs 落位。
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

-- ---------- billing 域 ----------
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY,
  name_zh     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_prices (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES plans(id),
  region        TEXT NOT NULL,
  currency      TEXT NOT NULL,
  cycle         TEXT NOT NULL CHECK (cycle IN ('monthly','yearly')),
  amount_minor  INTEGER NOT NULL,
  UNIQUE (plan_id, region, cycle)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id),
  plan_id               TEXT NOT NULL,
  region                TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','expired')),
  cycle                 TEXT NOT NULL CHECK (cycle IN ('monthly','yearly')),
  current_period_start  TEXT NOT NULL,
  current_period_end    TEXT NOT NULL,
  cancel_at_period_end  INTEGER NOT NULL DEFAULT 0,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS subscription_events (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL,
  type             TEXT NOT NULL,
  from_status      TEXT,
  to_status        TEXT,
  payload          TEXT,
  actor            TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  plan_id           TEXT NOT NULL,
  region            TEXT NOT NULL,
  cycle             TEXT NOT NULL CHECK (cycle IN ('monthly','yearly')),
  currency          TEXT NOT NULL,
  amount_minor      INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending','paid','failed','closed','refunded')),
  driver            TEXT NOT NULL,
  provider_ref      TEXT,
  idempotency_key   TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  paid_at           TEXT,
  closed_at         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id),
  driver            TEXT NOT NULL,
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  status            TEXT NOT NULL,
  provider_txn_id   TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL,
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ---------- catalog 域（功能模块商城 / 解锁鉴权，07 §5.1、08 §3.2）----------
CREATE TABLE IF NOT EXISTS modules (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL,
  name_i18n             TEXT NOT NULL,
  summary_i18n          TEXT NOT NULL,
  unlock_mode           TEXT NOT NULL CHECK (unlock_mode IN ('subscription','one_time')),
  entitlements_required TEXT NOT NULL DEFAULT '[]',
  region                TEXT NOT NULL CHECK (region IN ('cn','global')),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,
  UNIQUE (region, code)
);
CREATE INDEX IF NOT EXISTS idx_modules_region_status ON modules(region, status, sort_order);

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

CREATE TABLE IF NOT EXISTS entitlements (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  module_id   TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('order','subscription','admin')),
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
  actor           TEXT NOT NULL CHECK (actor IN ('order','refund','job','admin','system')),
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

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  region       TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  request_id   TEXT,
  payload      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
