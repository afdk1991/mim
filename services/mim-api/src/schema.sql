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
  finished_at         TEXT
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
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_assets_job ON generation_assets(job_id, created_at);
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

