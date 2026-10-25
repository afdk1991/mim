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
-- 本迁移补齐商品模型字段，并灌入五频道种子数据，使商城端到端可用。
--
-- 幂等：add column if not exists / DO 块约束 / create index if not exists /
--       insert ... on conflict (id) do nothing，可重复执行。
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

-- ---------- 2. 五频道商品种子（15 件，与前端演示商品一致） ----------
-- price_cents / original_price_cents 以「分」为单位（前端 price 为「元」）。
-- 全部 status='active'，使 0001 的 products_select 策略对匿名用户放行可读。

insert into public.products
  (id, title, price_cents, original_price_cents, currency, channel, emoji, description, status, stock, sales, sort)
values
  ('y1', '无线蓝牙耳机',   12900, null,  'CNY', 'youxuan', '🎧', '半入耳式 长续航',                 'active', 200, 3120, 1),
  ('y2', '电动牙刷',        8900, null,  'CNY', 'youxuan', '🪥', '声波震动 三档模式',               'active', 150, 2080, 2),
  ('y3', '保温杯',          4900, null,  'CNY', 'youxuan', '🥤', '316不锈钢 24h保温',               'active', 300, 1560, 3),
  ('y4', '桌面加湿器',      6900, null,  'CNY', 'youxuan', '💧', '静音大雾量 定时断电',             'active', 180,  940, 4),

  ('g1', '智能手环',        9900, 19900, 'CNY', 'gexm',    '⌚', '心率血氧 运动记录',               'active', 100, 4210, 1),
  ('g2', '便携榨汁杯',      5900, 12900, 'CNY', 'gexm',    '🥝', 'USB充电 六叶刀头',                'active', 120, 1870, 2),
  ('g3', '电竞鼠标',        7900, 15900, 'CNY', 'gexm',    '🖱️', '16000DPI RGB灯效',               'active',  80, 1330, 3),

  ('m1', '双人火锅套餐',   16800, null,  'CNY', 'mix',     '🍲', '招牌锅底 三荤三素',               'active',  50,  760, 1),
  ('m2', '精品洗车券',      3900, null,  'CNY', 'mix',     '🚿', '内外清洗 免费吸尘',               'active', 500, 2240, 2),
  ('m3', '影院通票',        4500, null,  'CNY', 'mix',     '🎬', '全国通用 有效期90天',             'active', 400, 1690, 3),

  ('l1', '唇釉礼盒',        9900, null,  'CNY', 'live',    '💄', '直播间专供 五色装',               'active',  90, 2510, 1),
  ('l2', '零食大礼包',      6800, null,  'CNY', 'live',    '🍫', '30包混装 追剧必备',               'active', 260, 3450, 2),
  ('l3', '露营折叠椅',     11800, null,  'CNY', 'live',    '🏕️', '铝合金骨架 承重120kg',           'active',  70,  610, 3),

  ('a1', '机场接送券',     12800, null,  'CNY', 'laal',    '🛫', '24h预约 全城可达',               'active', 300, 1180, 1),
  ('a2', '代驾畅行卡',      9800, null,  'CNY', 'laal',    '🚗', '10次抵扣 全国可用',               'active', 250, 2040, 2)
on conflict (id) do nothing;

-- ---------- 3. 校验输出（供 CI 迁移日志核对） ----------
-- select channel, count(*) from public.products where status='active' group by channel order by channel;
