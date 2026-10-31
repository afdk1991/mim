/* ============================================================================
 * 0008_iot_device —— 设备档案与指令通路（10 号文 §2 长连接网关骨架）
 *
 * 范围：devices（设备档案/在线状态/一机一密）、device_commands（下行指令单，
 * 幂等键 = 指令 id）。OTA 相关表（ota_package / ota_report）随下一轮 0009 落地。
 *
 * 幂等：create table if not exists / create index if not exists，可重复执行。
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 1. 设备档案
 *
 * id 即 device_id（Topic $dev/{device_id}/cmd|up|shadow 中的身份），
 * 出厂写入，不用自增/uuid：设备、EMQX、App 三侧直接对齐，免一层映射。
 * device_token_hash 为 sha256(Device-Token)（一机一密，ADR-002）；
 * null = 尚未激活签发，EMQX 认证钩子据此拒绝连接。
 * ------------------------------------------------------------------------ */

create table if not exists devices (
  id                text primary key,
  sn                text not null unique,
  model             text not null,                 -- mim-s1 等机型，OTA 按型号匹配
  owner_id          uuid references users (id),    -- 绑定者；null = 未绑定/未激活
  status            text not null default 'pending_activate'
                    check (status in ('pending_activate', 'offline', 'online')),
  device_token_hash text,                          -- sha256(Device-Token)，永不下发明文
  fw_version        text not null default '',
  build             int  not null default 0,       -- 当前固件 build（OTA 防降级比较基准）
  last_seen_at      timestamptz,
  activated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_devices_owner on devices (owner_id) where owner_id is not null;
create index if not exists idx_devices_status on devices (status);

/* --------------------------------------------------------------------------
 * 2. 下行指令单（App → HTTPS → 设备服务 → EMQX → 设备）
 *
 * id 由 App 侧生成（8~64 位字母数字-_），同时是幂等键：
 * 网络重发 / 用户重试撞 unique 时直接回旧单，不产生重复动作（10 号文 §2.2）。
 * 状态机：pending(已落库未下发) → sent(已投递 EMQX) → acked(设备回执成功)
 *                                                  → failed(网关失败/离线/设备回执失败)
 * timeout 由上层巡检或查询方按 sent_at 推算，不落枚举（避免幽灵任务）。
 * ------------------------------------------------------------------------ */

create table if not exists device_commands (
  id          text primary key,
  device_id   text not null references devices (id),
  action      text not null,                   -- volume.set / play.ctrl / ota.trigger …
  payload     jsonb not null default '{}',
  status      text not null default 'pending'
              check (status in ('pending', 'sent', 'acked', 'failed')),
  fail_reason text,
  created_by  uuid references users (id),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  acked_at    timestamptz
);
create index if not exists idx_device_commands_device on device_commands (device_id, created_at desc);
create index if not exists idx_device_commands_open on device_commands (status) where status in ('pending', 'sent');
