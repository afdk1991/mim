-- ============================================================================
-- Mim · 迁移 0005：商城目录（products 商品模型扩展 + 五频道商品种子）
--
-- 背景（前后端数据模型断点）：
--   前端 src/mall/store.tsx 的 MallGoods = { id, channel, emoji, title, price,
--   origPrice?, desc }，五个频道（youxuan / gexm / mix / live / laal）；
--   而 0001 建的 public.products 仅有 (id, title, price_cents, currency,
--   status, created_at) 六个字段，缺 channel / emoji / description / 原价，
--   导致商城在云端模式下无法承载任何商品（MALL_GOODS 恒为 [] → 商城为空态，
--   前端只能显示「发布自己的商品」引导）。
--
-- 本迁移仅补齐商品模型字段；不写入任何商品数据（商品唯一来源为用户/运营上架）。
--
-- 幂等：add column if not exists / DO 块约束 / create index if not exists，可重复执行。
-- ============================================================================

-- ---------- 1. 商品模型字段扩展 ----------

alter table if exists public.products
  add column if not exists channel              text not null default 'youxuan',
  add column if not exists emoji                text not null default '📦',
  add column if not exists description          text,
  add column if not exists original_price_cents int,
  add column if not exists stock                int  not null default 0,
  add column if not exists sales                int  not null default 0,
  add column if not exists sort                 int  not null default 0;

-- 频道取值约束（与前端 MallChannel 联合类型对齐；
-- 0001 建表后从未写入数据，故历史行不会违反该约束）
-- 注意：PostgreSQL 的 ADD CONSTRAINT 不支持 IF NOT EXISTS，用 DO 块实现幂等。
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'products') then
    begin
      alter table public.products
        add constraint products_channel_check
        check (channel in ('youxuan', 'gexm', 'mix', 'live', 'laal'));
    exception
      when duplicate_object then null;  -- 约束已存在，跳过
    end;
  end if;
end $$;

-- 频道 + 上架状态联合索引：商城按频道筛选商品的主查询路径
create index if not exists products_channel_status_idx
  on public.products (channel, status, sort);

-- ---------- 2. 校验输出（供 CI 迁移日志核对） ----------
-- select channel, count(*) from public.products where status='active' group by channel order by channel;
