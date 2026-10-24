-- ============================================================================
-- Mim · 补齐脚本（供 Supabase Dashboard → SQL Editor 粘贴执行）
-- 生成时间：2026-10-24T12:12:13.693Z
--
-- 用途：无需数据库密码 / 无需本地 SUPABASE_DB_URL，直接在 Dashboard 补齐线上缺失内容。
--
-- 线上实测缺口（2026-10-24）：
--   ①  迁移 0001 未应用：roles / permissions / user_roles / role_permissions /
--      audit_logs / products / orders / live_rooms / devices 等 15 张表 → 全部 404
--   ②  迁移 0003 未应用：account_bridge 表 + username_taken/claim_username RPC
--      → RPC 报 PGRST202（函数不存在）
--   ③  seed.sql 未执行：topics / hot_searches 为空 → 前端只能显示内置演示热搜
--       （注：0002 存储桶大概率已应用，本脚本仍包含，幂等无害）
--
-- 影响：登录后权限判定报错（src/auth.tsx、src/lib/cloud-iam.ts 依赖 roles 系列表）；
--       跨端用户名查重失效（CloudBase 侧 fail-open，同名账号可两端重复注册）。
--
-- 执行方式（二选一）：
--   ① Dashboard：SQL Editor → 粘贴本文件全部内容 → Run（推荐，无需密码）
--   ② 命令行：设置 SUPABASE_DB_URL（Session pooler 串）后 npm run db:apply
--      （该脚本只跑 migrations/*.sql，seed.sql 需单独执行）
--
-- 安全性：全部为幂等 SQL（create table if not exists / drop policy if exists /
--   create or replace / on conflict do nothing），重复执行不报错、不清数据。
-- ============================================================================



-- ==========================================================================
-- 迁移：0001_iam_phase1.sql
-- ==========================================================================
-- ============================================================================
-- Mim · Phase1 迁移 0001：IAM 账号权限中心（L1）+ L2/L3/L4 schema 骨架
-- 依据《全栈全平台项目 Phase1 团队配置方案》4.2：
--   IAM Phase1 验收 = 统一注册登录（JWT）、RBAC（菜单+按钮级）、接口鉴权 100%、
--   设备绑定、统一审计日志。明确不做：SSO 复杂实现、行级权限、组织架构树、自建 OAuth2。
-- 用法：Supabase Dashboard → SQL Editor → 全量执行（幂等，可重复执行）
-- 范围说明（用户指令「全部并行实现」）：
--   §1 L1 IAM          —— 完整实现（四表 + 审计 + RLS + 种子角色/权限）
--   §2 L2 商城交易     —— schema 骨架（微信/支付宝商户号到位前不接支付闭环）
--   §3 L3 直播音视频   —— schema 骨架（声网/ZEGO 资源到位前不接推拉流）
--   §4 L4 IoT 设备     —— 设备绑定属 IAM 验收项，本轮完整；遥测为骨架
-- ============================================================================

-- ============================================================================
-- §1 L1 IAM：角色 / 权限 / 用户角色 / 角色权限 / 审计日志
-- ============================================================================

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  description text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- 统一审计日志：append-only，改/删不开放（审计不可篡改）
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text not null default '',
  target_id   text not null default '',
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_actor   on public.audit_logs (actor_id, created_at desc);
create index if not exists idx_user_roles_user    on public.user_roles (user_id);

-- roles.updated_at 自动维护
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists roles_touch on public.roles;
create trigger roles_touch
  before update on public.roles
  for each row execute function public.touch_updated_at();

-- 管理员判定（security definer：绕过 RLS，避免 user_roles 策略自引用递归）
create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.name = 'admin'
  );
$$;

-- 权限判定（security definer：绕过 RLS，避免 user_roles/role_permissions 策略递归）
-- 用于把后端 RLS 与前端 RBAC 的权限点（permissions.key）对齐，例如 audit:view / role:manage
create or replace function public.has_perm(perm_key text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.key = perm_key
  );
$$;

-- ---------- 种子：四角色 + 权限点（菜单+按钮级，Phase1 粒度） ----------
insert into public.roles (name, description) values
  ('admin',        '超级管理员：全部权限'),
  ('operator',     '运营：后台查看 + 审计只读'),
  ('user',         '普通注册用户（默认角色）'),
  ('device_admin', '设备管理员：IoT 设备绑定/管理')
on conflict (name) do nothing;

insert into public.permissions (key, description) values
  ('admin:access',  '进入管理后台（菜单级）'),
  ('audit:view',    '查看审计日志'),
  ('role:manage',   '角色与权限管理（按钮级）'),
  ('user:manage',   '用户管理（按钮级）'),
  ('device:bind',   '绑定/解绑本人设备'),
  ('device:manage', '管理全部设备（按钮级）')
on conflict (key) do nothing;

-- admin 授予全部权限；operator 授予后台查看+审计；device_admin 授予设备管理；
-- user 无后台权限（默认角色，仅显式登记，便于后续分配）
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on (
  (r.name = 'admin')
  or (r.name = 'operator'     and p.key in ('admin:access', 'audit:view'))
  or (r.name = 'device_admin' and p.key in ('device:bind', 'device:manage'))
)
on conflict do nothing;

-- 新注册用户自动分配默认角色 user（挂在既有 handle_new_user 之后，独立触发器互不影响）
create or replace function public.handle_new_user_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role_id)
  select new.id, r.id from public.roles r where r.name = 'user'
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists on_auth_user_created_role on auth.users;
create trigger on_auth_user_created_role
  after insert on auth.users
  for each row execute function public.handle_new_user_role();

-- ---------- RLS ----------
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.user_roles       enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_logs       enable row level security;

-- 参考数据（角色/权限/映射）：登录用户可读（RBAC 菜单渲染需要），写仅 admin
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);
drop policy if exists roles_admin_write on public.roles;
create policy roles_admin_write on public.roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select to authenticated using (true);
drop policy if exists permissions_admin_write on public.permissions;
create policy permissions_admin_write on public.permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
drop policy if exists role_permissions_admin_write on public.role_permissions;
create policy role_permissions_admin_write on public.role_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- user_roles：本人可读自己的角色（前端拉取 RBAC），写仅 admin
drop policy if exists user_roles_owner_read on public.user_roles;
create policy user_roles_owner_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists user_roles_admin_write on public.user_roles;
create policy user_roles_admin_write on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 审计日志：admin 或持有 audit:view 权限者（如 operator）可读；
-- 登录用户可写且 actor 必须是本人（记录自己的操作轨迹）
drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (public.is_admin() or public.has_perm('audit:view'));
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid());

-- ============================================================================
-- §2 L2 商城交易（schema 骨架；支付闭环待微信/支付宝商户号）
-- ============================================================================

create table if not exists public.products (
  id          text primary key default gen_random_uuid()::text,
  title       text not null,
  price_cents int  not null default 0 check (price_cents >= 0),
  currency    text not null default 'CNY',
  status      text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at  timestamptz not null default now()
);

create table if not exists public.orders (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'unpaid'
              check (status in ('unpaid', 'paid', 'shipped', 'done', 'cancelled', 'refunded')),
  total_cents int  not null default 0 check (total_cents >= 0),
  currency    text not null default 'CNY',
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

create table if not exists public.order_items (
  id          bigint generated always as identity primary key,
  order_id    text not null references public.orders(id) on delete cascade,
  product_id  text not null references public.products(id),
  quantity    int not null default 1 check (quantity > 0),
  price_cents int not null default 0 check (price_cents >= 0)
);

-- 支付流水：写路径仅 service role / RPC（骨架期不开放客户端写），channel=mock 占位
create table if not exists public.payment_records (
  id          text primary key default gen_random_uuid()::text,
  order_id    text not null references public.orders(id) on delete cascade,
  channel     text not null default 'mock' check (channel in ('mock', 'wechat', 'alipay')),
  amount_cents int not null check (amount_cents >= 0),
  status      text not null default 'pending' check (status in ('pending', 'success', 'failed', 'refunded')),
  external_id text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_orders_user_created on public.orders (user_id, created_at desc);
create index if not exists idx_order_items_order   on public.order_items (order_id);
create index if not exists idx_payment_records_order on public.payment_records (order_id);

alter table public.products        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.payment_records enable row level security;

-- 商品：上架商品公开读；写仅 admin（运营后台后续接入）
drop policy if exists products_select on public.products;
create policy products_select on public.products for select using (status = 'active' or public.is_admin());
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 订单：本人读；创建限本人（支付状态流转走后续 RPC，不开放 update/delete）
drop policy if exists orders_owner_read on public.orders;
create policy orders_owner_read on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists orders_owner_insert on public.orders;
create policy orders_owner_insert on public.orders for insert to authenticated
  with check (user_id = auth.uid());

-- 订单明细：随订单归属（本人订单的明细可读可随单写入）
drop policy if exists order_items_owner_read on public.order_items;
create policy order_items_owner_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
drop policy if exists order_items_owner_insert on public.order_items;
create policy order_items_owner_insert on public.order_items for insert to authenticated
  with check (exists (select 1 from public.orders o
                      where o.id = order_id and o.user_id = auth.uid()));

-- 支付流水：本人订单可读；写不开放（等支付回调 RPC）
drop policy if exists payment_records_owner_read on public.payment_records;
create policy payment_records_owner_read on public.payment_records for select to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));

-- ============================================================================
-- §3 L3 直播音视频（schema 骨架；推拉流待声网/ZEGO 资源）
-- ============================================================================

create table if not exists public.live_rooms (
  id          text primary key default gen_random_uuid()::text,
  host_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  status      text not null default 'idle' check (status in ('idle', 'live', 'ended')),
  provider    text not null default 'mock' check (provider in ('mock', 'agora', 'zego')),
  channel_key text,
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.live_messages (
  id         bigint generated always as identity primary key,
  room_id    text not null references public.live_rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null default 'chat' check (kind in ('chat', 'gift', 'system')),
  content    text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.gift_records (
  id          bigint generated always as identity primary key,
  room_id     text not null references public.live_rooms(id) on delete cascade,
  sender_id   uuid references auth.users(id) on delete set null,
  gift_key    text not null,
  quantity    int not null default 1 check (quantity > 0),
  cost_points int not null default 0 check (cost_points >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists idx_live_rooms_status     on public.live_rooms (status, created_at desc);
create index if not exists idx_live_messages_room    on public.live_messages (room_id, created_at);
create index if not exists idx_gift_records_room     on public.gift_records (room_id, created_at desc);

alter table public.live_rooms    enable row level security;
alter table public.live_messages enable row level security;
alter table public.gift_records  enable row level security;

-- 直播间：公开读；主播写自己的房间
drop policy if exists live_rooms_select on public.live_rooms;
create policy live_rooms_select on public.live_rooms for select using (true);
drop policy if exists live_rooms_host_insert on public.live_rooms;
create policy live_rooms_host_insert on public.live_rooms for insert to authenticated
  with check (host_id = auth.uid());
drop policy if exists live_rooms_host_update on public.live_rooms;
create policy live_rooms_host_update on public.live_rooms for update to authenticated
  using (host_id = auth.uid() or public.is_admin()) with check (host_id = auth.uid() or public.is_admin());

-- 弹幕：房间公开读；登录用户发言（user_id=本人）
drop policy if exists live_messages_select on public.live_messages;
create policy live_messages_select on public.live_messages for select using (true);
drop policy if exists live_messages_insert on public.live_messages;
create policy live_messages_insert on public.live_messages for insert to authenticated
  with check (user_id = auth.uid());

-- 礼物：房间公开读；登录用户送礼（sender=本人；积分扣减走后续 RPC）
drop policy if exists gift_records_select on public.gift_records;
create policy gift_records_select on public.gift_records for select using (true);
drop policy if exists gift_records_insert on public.gift_records;
create policy gift_records_insert on public.gift_records for insert to authenticated
  with check (sender_id = auth.uid());

-- ============================================================================
-- §4 L4 IoT：设备 / 设备绑定（IAM 验收项，完整）/ 遥测（骨架）
-- ============================================================================

create table if not exists public.devices (
  id         text primary key default gen_random_uuid()::text,
  serial     text not null unique,
  model      text not null default '',
  firmware   text not null default '',
  status     text not null default 'offline' check (status in ('offline', 'online', 'disabled')),
  created_at timestamptz not null default now()
);

-- 设备绑定：用户 ↔ 设备（unbound_at 非空 = 已解绑，保留历史）
create table if not exists public.device_bindings (
  user_id    uuid not null references auth.users(id) on delete cascade,
  device_id  text not null references public.devices(id) on delete cascade,
  bound_at   timestamptz not null default now(),
  unbound_at timestamptz,
  primary key (user_id, device_id)
);

-- 遥测：骨架（MQTT Broker 到位前写入仅 service role，不开放客户端写）
create table if not exists public.device_telemetry (
  id        bigint generated always as identity primary key,
  device_id text not null references public.devices(id) on delete cascade,
  metric    text not null,
  value     numeric not null,
  ts        timestamptz not null default now()
);

create index if not exists idx_device_telemetry_device on public.device_telemetry (device_id, ts desc);

alter table public.devices          enable row level security;
alter table public.device_bindings  enable row level security;
alter table public.device_telemetry enable row level security;

-- 设备：已绑定用户或 device_admin/admin 可读；登记/管理限 device_admin 或 admin
drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = auth.uid() and r.name = 'device_admin')
    or exists (select 1 from public.device_bindings b
               where b.device_id = id and b.user_id = auth.uid() and b.unbound_at is null)
  );
drop policy if exists devices_admin_write on public.devices;
create policy devices_admin_write on public.devices for all to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = auth.uid() and r.name = 'device_admin')
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = auth.uid() and r.name = 'device_admin')
  );

-- 绑定：本人读写自己的绑定关系（绑定/解绑 = device:bind 权限，Phase1 简化为登录即可）
drop policy if exists device_bindings_owner_read on public.device_bindings;
create policy device_bindings_owner_read on public.device_bindings for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists device_bindings_owner_insert on public.device_bindings;
create policy device_bindings_owner_insert on public.device_bindings for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists device_bindings_owner_update on public.device_bindings;
create policy device_bindings_owner_update on public.device_bindings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 遥测：已绑定用户可读自己设备的数据；写不开放（等 MQTT → service role 管道）
drop policy if exists device_telemetry_read on public.device_telemetry;
create policy device_telemetry_read on public.device_telemetry for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.device_bindings b
               where b.device_id = device_id and b.user_id = auth.uid() and b.unbound_at is null)
  );


-- ==========================================================================
-- 迁移：0002_storage_media.sql
-- ==========================================================================
-- ============================================================================
-- Mim · Phase1 迁移 0002：对象存储（私有桶 mim-media + RLS 前缀隔离）
-- 目标平台：supabase.com 国际版
-- 用法：Supabase Dashboard → SQL Editor → 粘贴全量执行（幂等，可重复执行）
--
-- 与 CloudBase 侧存储契约保持一致（前端 src/lib/cloud-storage.ts 双端通用）：
--   · 桶私有（public=false）：文件只能通过签名链接访问，不支持公开 URL
--   · 对象 key = <uid>/<yyyy-mm>/<uuid>.<ext>：首段目录即所有者 uid
--   · RLS 限定 (storage.foldername(name))[1] = auth.uid()::text ⇒ 无法读写他人文件
--   · 单文件上限 3MB（3145728 字节，与前端 MAX_UPLOAD_BYTES / 云函数一致）
--   · MIME 白名单与云函数 MIME_ALLOW 一致（显式排除 svg：可内嵌脚本，XSS 面）
-- ============================================================================

-- ---------- 1. 桶（幂等：已存在则同步限制项） ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mim-media',
  'mim-media',
  false,
  3145728,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- 2. RLS：仅本人文件夹可读 / 写 / 改 / 删 ----------
-- storage.objects 默认启用 RLS；未登录（anon）一律不可见，
-- 签名链接（createSignedUrls）由 Storage 服务签发，不受策略影响。

drop policy if exists mim_media_own_select on storage.objects;
create policy mim_media_own_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists mim_media_own_insert on storage.objects;
create policy mim_media_own_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists mim_media_own_update on storage.objects;
create policy mim_media_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists mim_media_own_delete on storage.objects;
create policy mim_media_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mim-media' and (storage.foldername(name))[1] = auth.uid()::text);


-- ==========================================================================
-- 迁移：0003_account_bridge.sql
-- ==========================================================================
-- ============================================================================
-- Mim · Phase1 迁移 0003：CloudBase ↔ Supabase 账号桥（account bridge）
-- 目标平台：supabase.com 国际版
-- 用法：Supabase Dashboard → SQL Editor → 粘贴全量执行（幂等，可重复执行）
--
-- 背景：项目双后端（Supabase 主 / CloudBase 备），两套账号体系原本互相不可见：
--   · CloudBase app_users：uid = u_xxx，密码 PBKDF2-SHA512(100k, 64B) + 独立 salt
--   · Supabase auth.users：uuid，GoTrue bcrypt，用户名映射合成邮箱 <username>@mim.app
-- 本迁移把两者在「用户名」维度桥接：
--   ① account_bridge 表：登记 CloudBase 侧已注册的用户名 + 密码哈希（仅服务端可读）
--   ② username_taken()：注册前全局查重（auth.users + bridge 合并视图）
--   ③ claim_username()：CloudBase mim-api 注册成功后把账号登记进 bridge
--   ④ bridge 登录升级由 Edge Function /auth/bridge-login 完成（验 PBKDF2 →
--      Admin API 自动落户 Supabase），见 supabase/functions/mim-api/index.ts
--
-- 安全模型：
--   · account_bridge 禁一切客户端 select（password_hash 泄漏 = 密码泄漏）；
--     anon 仅可 insert（与开放注册同暴露面：抢注用户名本就是开放注册允许的）
--   · service_role（Edge Function）绕过 RLS，是唯一读者
--   · 两个 RPC 均为 security definer，内部自行收敛权限
-- ============================================================================

-- ---------- 1. 账号桥表 ----------
create table if not exists public.account_bridge (
  username        text primary key,
  cloudbase_uid   text not null default '',
  password_hash   text not null,
  salt            text not null,
  source          text not null default 'cloudbase' check (source in ('cloudbase', 'import')),
  migrated        boolean not null default false,
  failed_attempts int     not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_account_bridge_migrated on public.account_bridge (migrated);

-- updated_at 自动维护（复用 0001 的 touch_updated_at；若 0001 未执行则补建）
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists account_bridge_touch on public.account_bridge;
create trigger account_bridge_touch
  before update on public.account_bridge
  for each row execute function public.touch_updated_at();

-- ---------- 2. RLS：禁客户端读，anon 可 insert ----------
alter table public.account_bridge enable row level security;

drop policy if exists bridge_anon_insert on public.account_bridge;
create policy bridge_anon_insert on public.account_bridge
  for insert to anon, authenticated
  with check (true);

-- 不建 select / update / delete 策略 ⇒ 客户端一律拒绝；service_role 绕过 RLS
-- （显式 revoke，防止默认 grant 把表整体敞开）
revoke all on public.account_bridge from anon, authenticated;
grant insert on public.account_bridge to anon, authenticated;

-- ---------- 3. RPC：全局用户名查重（注册前预检，anon 可调） ----------
-- 同时覆盖：GoTrue 合成邮箱账号、邮箱直通账号、CloudBase 桥接账号
create or replace function public.username_taken(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(p_username) || '@mim.app'
       or lower(email) = lower(p_username)
  )
  or exists (
    select 1
    from public.account_bridge
    where username = p_username
  );
$$;

revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- ---------- 4. RPC：用户名占用登记（CloudBase mim-api 注册成功后调用，anon 可调） ----------
-- 返回 true = 本次新占用；false = 该用户名已被占用（先到先得）
create or replace function public.claim_username(
  p_username      text,
  p_password_hash text,
  p_salt          text,
  p_uid           text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_bridge (username, cloudbase_uid, password_hash, salt, source)
  values (p_username, p_uid, p_password_hash, p_salt, 'cloudbase')
  on conflict (username) do nothing;
  return exists (
    select 1 from public.account_bridge
    where username = p_username and cloudbase_uid = p_uid
  );
end $$;

revoke all on function public.claim_username(text, text, text, text) from public;
grant execute on function public.claim_username(text, text, text, text) to anon, authenticated;


-- ==========================================================================
-- 演示数据：seed.sql（补齐 topics / hot_searches 空表）
-- ==========================================================================
-- ============================================================
-- Mim 演示数据 seed（轮 4）
--
-- 用法：Supabase Dashboard → SQL Editor 以 postgres role 执行（绕过 RLS）。
-- 范围：仅灌 resources / topics / hot_searches 三张无外键的演示表——
--       posts / articles / snippets 的演示内容由前端 src/data/seed.ts 本地提供，
--       不写云端（其 authorId 指向 me/u1..u9，云端 auth.users 无对应行，外键必炸）。
-- 幂等：全部 on conflict (id) do nothing，可重复执行。
-- ============================================================

-- ---------- 1. resources 资源库 12 条 ----------
insert into public.resources (id, title, description, category, uploader, size, downloads, type) values
  ('r1',  '2026 前端面试题大全（含答案解析）',           '覆盖 JS / CSS / 框架 / 工程化 / 浏览器原理，800+ 道题', '面试求职', '阿狸的前端笔记', '12.6 MB', 45230, 'pdf'),
  ('r2',  '算法刷题笔记：LeetCode 热题 100 详解',        '每题附思路推导与多种解法对比',                           '面试求职', '算法小白菜',     '8.9 MB',  38120, 'pdf'),
  ('r3',  'React 19 官方文档中文标注版',                 '社区协作翻译 + 重点批注，适合系统学习',                   '前端',     '阿狸的前端笔记', '5.2 MB',  21340, 'doc'),
  ('r4',  'Vue3 + Vite 企业级项目模板',                  '包含权限、国际化、主题、构建优化配置',                   '前端',     '独立开发者大熊', '2.1 MB',  15670, 'code'),
  ('r5',  'MySQL 索引与 SQL 优化实战视频课',             '16 小时录播，从执行计划到线上调优',                       '后端',     '后端老张',       '1.8 GB',   9820, 'video'),
  ('r6',  'Go 高并发实战：从 Channel 到池化',            '10 个可运行案例，附压测脚本',                             '后端',     '后端老张',       '3.4 MB',   8760, 'code'),
  ('r7',  '大模型应用开发入门指南',                      'Prompt 工程 / RAG / Agent 三大方向入门',                  '人工智能', '算法小白菜',     '6.7 MB',  26540, 'pdf'),
  ('r8',  'PyTorch 深度学习动手实验手册',                '30 个实验覆盖 CNN / RNN / Transformer',                   '人工智能', '算法小白菜',     '15.2 MB', 18230, 'pdf'),
  ('r9',  'Kubernetes 运维排查手册（速查版）',           '50 个常见故障的现象、根因与修复命令',                     '后端',     '云原生养鱼佬',   '4.1 MB',  12980, 'doc'),
  ('r10', 'Figma 设计系统模板（含组件库）',              '200+ 组件，Token 命名规范可直接套用',                     '工具效率', '设计师小鹿',     '9.8 MB',   7650, 'code'),
  ('r11', '程序员效率工具清单 2026 版',                  '终端 / 编辑器 / AI 工具 / 效率插件全收录',                '工具效率', '独立开发者大熊', '1.2 MB',  19870, 'doc'),
  ('r12', '深入理解计算机系统（CSAPP）读书笔记',         '按章节整理重点 + 习题解析',                               '电子书',   '后端老张',       '7.3 MB',  32110, 'pdf')
on conflict (id) do nothing;

-- ---------- 2. topics 超话 10 条 ----------
insert into public.topics (id, name, heat, "desc") values
  ('t1',  '前端开发', 2350000, 'HTML / CSS / JS / 框架与工程化'),
  ('t2',  '后端架构', 1980000, '服务端、数据库与分布式系统'),
  ('t3',  '人工智能', 5120000, '大模型、机器学习与 AI 应用'),
  ('t4',  '独立开发',   860000, '一个人也能做出好产品'),
  ('t5',  '云原生',     720000, 'Kubernetes、容器与微服务'),
  ('t6',  '算法',      1450000, '数据结构与刷题日常'),
  ('t7',  '设计',       530000, 'UI / UX / 设计系统'),
  ('t8',  '产品思考',   410000, '需求分析与产品方法论'),
  ('t9',  '大数据',     380000, '数仓、实时计算与 BI'),
  ('t10', '测试',       220000, '自动化测试与质量保障')
on conflict (id) do nothing;

-- ---------- 3. hot_searches 热搜 15 条（tag 允许 null） ----------
insert into public.hot_searches (id, "rank", text, heat, tag) values
  ('h1',  1,  'AI 编程助手全面接入主流 IDE',    4862310, '沸'),
  ('h2',  2,  '新款折叠屏手机正式发布',         4210980, '热'),
  ('h3',  3,  '大厂宣布试点四天工作制',         3987650, '爆'),
  ('h4',  4,  '前端框架性能天梯图更新',         3120540, null),
  ('h5',  5,  '开源大模型刷新多项纪录',         2876320, '热'),
  ('h6',  6,  '国产数据库市场份额突破 20%',     2530110, '新'),
  ('h7',  7,  '程序员平均薪资报告出炉',         2298870, null),
  ('h8',  8,  '全国大范围降温预警',             1987650, null),
  ('h9',  9,  '微信新版本支持折叠群聊',         1654320, '新'),
  ('h10', 10, '双 11 预售正式开启',             1432210, null),
  ('h11', 11, '世界杯预选赛焦点战',             1287650, '热'),
  ('h12', 12, '研究生扩招政策解读',             1098760, null),
  ('h13', 13, 'SpaceX 星舰第六次试飞',           987650, null),
  ('h14', 14, '城市马拉松赛季开启',              876540, null),
  ('h15', 15, '新一批国产游戏获批版号',          765430, '新')
on conflict (id) do nothing;

-- ============================================================================
-- 执行后自检（另起一段单独执行），四条均应有返回且不报错：
--   select count(*) from public.roles;            -- 应 > 0（种子角色）
--   select count(*) from public.topics;           -- 应 = 10
--   select count(*) from public.hot_searches;     -- 应 = 15
--   select public.username_taken('probe_name');   -- 应 true/false，不再报 PGRST202
-- 等价的 HTTP 复验：
--   curl "<SUPABASE_URL>/rest/v1/roles?select=*&limit=1" -H "apikey: <ANON_KEY>"
--   → 应由 404 变为 200
-- ============================================================================
