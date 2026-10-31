/* ============================================================================
 * 0011 埋点事件落库 —— docs/specs/埋点与数据口径规范.md 的服务端承载
 *
 * 与前几轮迁移一致的约定：
 *   · 主键 text + gen_random_uuid()::text（全库统一，不用 bigserial）
 *   · 时间戳一律 bigint 毫秒（ts_ms），避免 timestamptz/bigint 混用带来的口径分裂
 *   · 幂等写入靠 eid 唯一索引：客户端批量重传不会重复计数
 *
 * 隐私约束（对应 docs/product/合规清单.md）：
 *   · 不存明文 IP，只存 HMAC 截断值（ip_hash，盐取自 JWT_SECRET）
 *   · uid 不入埋点表，user_id 仅由服务端根据令牌回填，客户端无法伪造归因
 *   · props 由服务端二次清洗后再入库，禁止出现 password/token 等敏感键
 * ========================================================================== */

create table if not exists telemetry_events (
  id           text   primary key default gen_random_uuid()::text,
  /* 客户端事件唯一 ID：同一批重传必须落同一行，保证去重可算 */
  eid          text   not null unique,
  name         text   not null,
  ts_ms        bigint not null,
  received_at  timestamptz not null default now(),
  /* 已登录用户；匿名事件为空。此列只由服务端按令牌回填 */
  user_id      uuid   references users (id) on delete set null,
  anon_id      text   not null default '',
  session_id   text   not null default '',
  app_version  text   not null default '',
  platform     text   not null default '',
  path         text   not null default '',
  referrer     text   not null default '',
  props        jsonb  not null default '{}'::jsonb,
  ip_hash      text
);

create index if not exists idx_te_name_ts      on telemetry_events (name, ts_ms desc);
create index if not exists idx_te_user_ts      on telemetry_events (user_id, ts_ms desc);
create index if not exists idx_te_received     on telemetry_events (received_at desc);
create index if not exists idx_te_anon_session on telemetry_events (anon_id, session_id);

comment on table telemetry_events is '埋点事件流水（append-only）。出入库口径见 docs/specs/埋点与数据口径规范.md；敏感键在 server/src/events.js 二次清洗。';
comment on column telemetry_events.eid is '客户端生成的事件唯一 ID，唯一索引用于重传幂等';
comment on column telemetry_events.user_id is '服务端依据令牌回填，绝不信任请求体里的 uid';
comment on column telemetry_events.ip_hash is 'IP 的 HMAC-SHA256 截断值，用于去重计数，不含明文';
