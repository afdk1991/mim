/* ============================================================================
 * 0009_ota —— OTA 升级与设备影子（补齐 0008 注释里承诺的「下一轮」欠账）
 *
 * 负责人：后端 B（设备接入 + 实时链路 + OTA 服务端）
 * 对应交付物：OTA 服务端（版本与包管理 / 分批灰度 / 前置校验 / 失败率熔断
 *             / 进度上报 / 回滚支持）+ 设备影子（期望状态 / 实际状态）
 *
 * 设计要点：
 *   1. 线性升级路径：同一 model 的 (model, build) 唯一，杜绝「两个包同 build」导致的
 *      升级不可比较。防降级由 ota_check 用 build 单调性裁定，不靠应用层自觉。
 *   2. 灰度不是「能不能拿」，而是「按比例 randomly 放行」：rollout 命中判定放在服务端，
 *      设备无法通过反复轮询把自己刷进灰度名单（命中结果随 Device 维度稳定）。
 *   3. 失败率熔断：max_fail_rate + min_samples 双阈值 —— 样本不足时不熔断
 *      （否则第 1 台失败就误杀全量），样本足够后按百分比熔断 → 自动 paused。
 *   4. 影子是「期望/实际」两份 JSON：下行控制（App → 设备）写 desired，
 *      设备上行（固件 API）写 reported，两者永不互相覆盖，冲突由上层仲裁。
 *
 * 幂等：create table if not exists / create index if not exists，可重复执行。
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 1. OTA 升级包
 *
 * status 状态机：draft(编排中) → published(对设备可见)
 *                → paused(熔断或人工暂停，对设备不可见)
 *                → revoked(废弃/有缺陷，永不再下发)
 * 只有 published 且 build 高于设备当前 build 的包才会出现在 ota_check 结果里。
 * ------------------------------------------------------------------------ */

create table if not exists ota_package (
  id             text primary key default gen_random_uuid()::text,
  model          text not null,                    -- 适配机型（mim-s1 等），与 devices.model 对齐
  version        text not null,                    -- 语义化版本 1.2.3，仅用于展示
  build          int  not null check (build > 0),  -- 单调 build，升级/防降级唯一比较基准
  channel        text not null default 'release'
                 check (channel in ('release', 'gray', 'beta')),
  rollout        int  not null default 100 check (rollout >= 0 and rollout <= 100),
  status         text not null default 'draft'
                 check (status in ('draft', 'published', 'paused', 'revoked')),
  url            text not null,                    -- 固件包下载地址（HTTPS）
  sha256         text not null check (length(sha256) = 64),
  size           bigint not null check (size > 0),
  /* 升级前置条件：不满足则设备侧不得启动下载（防止升级中断成砖） */
  min_battery    int  not null default 30 check (min_battery >= 0 and min_battery <= 100),
  require_wifi   boolean not null default true,
  /* 熔断阈值：样本数不足 min_samples 时不判定，避免小样本误杀 */
  max_fail_rate  int  not null default 20 check (max_fail_rate >= 1 and max_fail_rate <= 100),
  min_samples    int  not null default 20 check (min_samples >= 1),
  note           text not null default '',
  created_by     uuid references users (id),       -- 发行责任人，便于追溯谁发的版本
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

/* 同一机型同一 build 只能有一个包：这是「线性升级路径」的强制保障 */
create unique index if not exists uq_ota_package_model_build on ota_package (model, build);
create index if not exists idx_ota_package_lookup on ota_package (model, status, channel, build desc);

/* --------------------------------------------------------------------------
 * 2. OTA 进度与结果上报
 *
 * 追加写（append-only）：同设备同包的多次尝试各自留痕，便于定位「第 2 次重试才成功」。
 * 代价是不能 unique(device,package)，因此统计口径一律用 count(distinct device_id)，
 * 否则同一台反复失败的设备会被重复计数、把失败率算高（误熔断）。
 * ------------------------------------------------------------------------ */

create table if not exists ota_report (
  id          text primary key default gen_random_uuid()::text,
  package_id  text not null references ota_package (id) on delete cascade,
  device_id   text not null references devices (id) on delete cascade,
  user_id     uuid references users (id),
  stage       text not null
              check (stage in ('download', 'download_ok', 'install', 'success', 'failed', 'rollback')),
  progress    int  not null default 0 check (progress >= 0 and progress <= 100),
  from_build  int  not null default 0,
  to_build    int  not null default 0,
  message     text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_ota_report_package on ota_report (package_id, created_at desc);
create index if not exists idx_ota_report_device on ota_report (device_id, created_at desc);

/* --------------------------------------------------------------------------
 * 3. 设备影子（期望状态 / 实际状态）
 *
 * desired 由 App 或运营下发意图；reported 由设备上行写入。
 * 两者分列存放 —— 一旦合并成单列，「谁覆盖了谁」就再也查不出来。
 * version 为乐观并发号：下发期望时 +1，设备回执携带 version，
 * 版本落后说明中间已有新意图，旧回执作废（避免乱序回执把新状态冲掉）。
 * ------------------------------------------------------------------------ */

create table if not exists device_shadow (
  device_id  text primary key references devices (id) on delete cascade,
  desired    jsonb not null default '{}'::jsonb,
  reported   jsonb not null default '{}'::jsonb,
  version    int   not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);
