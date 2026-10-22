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

-- 审计日志：admin 可读；登录用户可写且 actor 必须是本人（记录自己的操作轨迹）
drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (public.is_admin());
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
