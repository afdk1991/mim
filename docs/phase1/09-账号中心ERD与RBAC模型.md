# 账号中心 v1 数据模型与 RBAC 模型（09 号文）

> 责任岗位：后端 A
> 版本：v1.0（W1 评审版，M1 验收依据）
> 日期：2026-10-30
> 依据：03 号文规范一（鉴权）/规范三（RBAC）、06 号文 §3.1/§3.7、08 号文 ADR-004（订单 user_id 引用本模型）

---

## 1. ERD

```
users ──1:n── auth_identity          （手机号/微信 多登录态归一）
users ──1:n── refresh_token          （滚动轮换）
users ──1:n── device_bind            （设备绑定，见 10 号文）
admin_user ──n:n── role ──n:n── permission_point
admin_user ──1:n── audit_log         （敏感操作审计）
```

## 2. DDL（PostgreSQL 14+，snake_case，遵 03 号文规范一 §1.1）

```sql
-- C 端用户：无角色概念，会员是订阅状态不是权限（03 号文 §3.1）
create table users (
  id            text primary key,          -- u_ + ulid
  phone         text unique,               -- 注销后置空
  nickname      text not null default '',
  avatar_url    text not null default '',
  status        text not null default 'active',  -- active/banned/deleted
  member_expire_at timestamptz,            -- 会员到期（ADR-004 权益状态机写入）
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz                -- 注销软删
);

-- 登录身份：手机号、微信（mp=小程序 openid、app=unionid）
create table auth_identity (
  id            text primary key,
  user_id       text not null references users(id),
  provider      text not null,             -- phone / wx_mp / wx_app
  identifier    text not null,             -- 手机号 / openid / unionid
  created_at    timestamptz not null default now(),
  unique (provider, identifier)
);

-- refresh_token：30 天滚动轮换，旧串立即作废（03 号文 §1.3）
create table refresh_token (
  id            text primary key,
  user_id       text not null references users(id),
  token_hash    text not null unique,      -- 只存 sha256
  platform      text not null,             -- mp/ios/android（03 号文 X-Client 口径）
  expires_at    timestamptz not null,
  rotated_to    text,                      -- 轮换指向新 token id；非空即已作废
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- B 端 RBAC 三层（03 号文 §3.2）
create table admin_user (
  id            text primary key,
  username      text not null unique,
  password_hash text not null,
  name          text not null,
  status        text not null default 'active',  -- active/disabled（离职当日 disable，03 号文 §3.4.4）
  created_at    timestamptz not null default now()
);

create table role (
  code          text primary key,          -- super_admin/ops/cs/auditor/finance/readonly
  name          text not null
);

create table permission_point (
  code          text primary key,          -- {module}:{resource}:{action}
  description   text not null default ''
);

create table admin_user_role (
  admin_user_id text not null references admin_user(id),
  role_code     text not null references role(code),
  primary key (admin_user_id, role_code)
);

create table role_permission (
  role_code     text not null references role(code),
  point_code    text not null references permission_point(code),
  primary key (role_code, point_code)
);

-- 审计日志：保留 ≥3 年（03 号文 §3.4.4）
create table audit_log (
  id            text primary key,
  admin_user_id text not null references admin_user(id),
  action        text not null,             -- 权限点 code
  target        text not null,             -- 操作对象标识
  before_value  jsonb,
  after_value   jsonb,
  ip            text not null,
  created_at    timestamptz not null default now()
);
```

## 3. 权限点清单（Phase 1 登记制全集，新增先登记本文档）

| 模块 | 权限点 |
| --- | --- |
| 用户 | `user:query` / `user:ban` |
| 设备 | `device:query` / `device:unbind` / `device:ota:publish` / `device:ota:pause` |
| 内容 | `content:post:audit` / `content:post:takedown` / `content:report:handle` |
| 订单 | `order:query` / `order:refund:approve` / `order:reconcile:view` |
| 运营 | `ops:push:send` / `ops:topic:manage` / `ops:board:view` |
| 系统 | `system:role:assign` / `system:admin:manage` |

## 4. 内置角色 → 权限点映射（03 号文 §3.3 矩阵落地）

| 角色 | 权限点 | 明确禁止（不得授予） |
| --- | --- | --- |
| super_admin | 全部 | — |
| ops | `user:query` `device:query` `content:post:audit` `content:post:takedown` `content:report:handle` `ops:*` | `order:refund:*` `order:reconcile:view` `system:*` |
| cs | `user:query` `device:query` `device:unbind` `order:query` | 一切资金与内容处置 |
| auditor | `content:post:audit` `content:post:takedown` `content:report:handle` | 其余全部 |
| finance | `order:query` `order:refund:approve` `order:reconcile:view` | `system:*` |
| readonly | `user:query` `device:query` `order:query` `order:reconcile:view` `ops:board:view` | 一切写操作 |

QA 纪律（00 号文）：QA 人员账号不得授予 `device:ota:publish` 与 `system:*`。

## 5. 关键流程

### 5.1 登录与合并（06 号文 §3.1.2）
- 验证码登录：`identifier=phone` 无记录则注册新 users；微信一键登录取 unionid，**同手机号已存在则自动合并**：新建 `auth_identity` 指向老 user，禁止一手机号两账号。
- access_token：JWT 2h，claims `sub=user_id, platform`；refresh 走 §2 表滚动轮换。
- token 失效统一 20102，端上静默刷新（03 号文 §2.3.3）。

### 5.2 账号注销（06 号文 §3.1.3，合规 6.2）
`deleted` 软删 → 设备全量解绑（30103 释放）→ 内容匿名化（author 置 tombstone）→ phone/identity 清除 → 订单按财税要求留存脱敏副本。注销接口强制 Idempotency-Key。

### 5.3 权限校验中间件
网关解析 JWT → 后台路由挂载所需 point code → 查 `admin_user_role ⋈ role_permission` → 无权限返 20201（隐藏入口+toast，03 号文 §2.3.3）。敏感操作（退款/OTA 发布/权限变更/内容批量处置）写 audit_log。

## 6. M1 验收口径（02 号文 S2）

- 三端同一账号登录闭环；同手机号微信登录自动合并有测试用例
- 六角色种子数据入库；权限矩阵单测覆盖「授予/拒绝」双路径
- audit_log 对 `order:refund:approve` `device:ota:publish` 两条权限点有写入验证
