/* ============================================================================
 * 0001_iam —— 账号 / 角色权限 / 审计 / 令牌吊销
 *
 * 整合自历史迁移 0001_iam_phase1.sql（IAM 四表）与 0003_account_bridge.sql
 * （CloudBase 账号桥），并针对自托管后端做三处收敛：
 *   ① 账号真源合并为 users 一张表：不再有 auth.users 与 account_bridge 双写，
 *      历史 bridge 保留为 app_users 兼容视图（历史用户的旧 uid 可继续查到）。
 *   ② 密码哈希存 users.password_hash（scrypt$…），永不下发客户端。
 *   ③ 令牌为自签 HMAC-SHA256，需吊销能力 ⇒ 增加 token_revocations（按 jti）。
 *
 * 幂等：create table if not exists / create index if not exists / on conflict 种子，
 *      可重复执行。
 * ========================================================================== */

/* gen_random_uuid() 自 PG13 起内置，不需要 pgcrypto 扩展
 * ——刻意不建扩展：托管实例上 create extension 常因缺超级用户权限而整文件失败。 */

/* --------------------------------------------------------------------------
 * 1. 账号与资料
 * ------------------------------------------------------------------------ */

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  name          text not null default '',
  emoji         text not null default '🙂',
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_users_created on users (created_at desc);

/* 资料表与账号分离：整行可公开读，账号表永不出现在 REST 白名单里，
 * 避免 select=* 时把 password_hash 带出去。 */
create table if not exists profiles (
  id        uuid primary key references users (id) on delete cascade,
  username  text not null,
  name      text not null default '',
  emoji     text not null default '🙂',
  color     text not null default '',
  bio       text not null default '',
  followers int not null default 0,
  following int not null default 0,
  verified  boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists idx_profiles_username on profiles (username);

/* app_users：历史 CloudBase tid 体系的兼容登记表（uuid ↔ uid 对照）。
 * 新注册用户同时落一行，历史数据导入后旧端仍可按 uid 反查。 */
create table if not exists app_users (
  user_id    uuid primary key references users (id) on delete cascade,
  uid        text unique,
  username   text not null,
  source     text not null default 'self' check (source in ('self', 'cloudbase', 'import')),
  created_at timestamptz not null default now()
);
create index if not exists idx_app_users_uid on app_users (uid);

/* --------------------------------------------------------------------------
 * 2. RBAC：角色 / 权限 / 用户角色 / 角色权限
 * ------------------------------------------------------------------------ */

create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  description text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists user_roles (
  user_id    uuid not null references users (id) on delete cascade,
  role_id    uuid not null references roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists role_permissions (
  role_id       uuid not null references roles (id) on delete cascade,
  permission_id uuid not null references permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create index if not exists idx_user_roles_user on user_roles (user_id);
create index if not exists idx_user_roles_role on user_roles (role_id);

/* --------------------------------------------------------------------------
 * 3. 审计日志（append-only，应用层不开放 update/delete）与令牌吊销表
 * ------------------------------------------------------------------------ */

create table if not exists audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references users (id) on delete set null,
  action      text not null,
  target_type text not null default '',
  target_id   text not null default '',
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_logs_created on audit_logs (created_at desc);
create index if not exists idx_audit_logs_actor   on audit_logs (actor_id, created_at desc);

create table if not exists token_revocations (
  jti        text primary key,
  user_id    uuid references users (id) on delete cascade,
  revoked_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_token_revocations_expire on token_revocations (expires_at);

/* --------------------------------------------------------------------------
 * 4. 种子：四角色 + Phase1 权限点（与历史基线一致）
 * ------------------------------------------------------------------------ */

insert into roles (name, description) values
  ('admin',        '超级管理员：全部权限'),
  ('operator',     '运营：后台查看 + 审计只读'),
  ('user',         '普通注册用户（默认角色）'),
  ('device_admin', '设备管理员：IoT 设备绑定/管理')
on conflict (name) do nothing;

insert into permissions (key, description) values
  ('admin:access',  '进入管理后台（菜单级）'),
  ('audit:view',    '查看审计日志'),
  ('role:manage',   '角色与权限管理（按钮级）'),
  ('user:manage',   '用户管理（按钮级）'),
  ('device:bind',   '绑定/解绑本人设备'),
  ('device:manage', '管理全部设备（按钮级）')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on (
  (r.name = 'admin')
  or (r.name = 'operator'     and p.key in ('admin:access', 'audit:view'))
  or (r.name = 'device_admin' and p.key in ('device:bind', 'device:manage'))
)
on conflict do nothing;
