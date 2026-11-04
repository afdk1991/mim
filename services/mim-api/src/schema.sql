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
  features    TEXT NOT NULL,
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

-- ---------- content 域（P0 工作区） ----------
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  region       TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, status);

CREATE TABLE IF NOT EXISTS project_members (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id, status);

CREATE TABLE IF NOT EXISTS project_invitations (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  inviter_user_id  TEXT NOT NULL,
  region           TEXT NOT NULL,
  provider         TEXT NOT NULL CHECK (provider IN ('phone','email')),
  identifier       TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('editor','viewer')),
  token            TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at       TEXT NOT NULL,
  accepted_at      TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  parent_id          TEXT,
  level              INTEGER NOT NULL CHECK (level IN (1,2)),
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done')),
  due_date           TEXT,
  priority           INTEGER NOT NULL DEFAULT 0,
  version            INTEGER NOT NULL DEFAULT 1,
  seq                INTEGER NOT NULL DEFAULT 0,
  client_updated_at  TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

CREATE TABLE IF NOT EXISTS task_tags (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL,
  tag      TEXT NOT NULL,
  UNIQUE (task_id, tag)
);

CREATE TABLE IF NOT EXISTS task_events (
  seq                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id            TEXT NOT NULL,
  project_id         TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  type               TEXT NOT NULL,
  payload            TEXT NOT NULL,
  client_updated_at  TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_project ON task_events(project_id, seq);

CREATE TABLE IF NOT EXISTS sync_cursors (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  device_id   TEXT,
  last_seq    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_exports (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  project_id  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  file_path   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
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
