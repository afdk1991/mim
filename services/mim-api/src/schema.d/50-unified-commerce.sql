-- 统一交易域（2026-11-14 P0-A 第 1 步）：只新增、不修改、不删除任何既有表。
-- 背景：项目里原本有三套并行交易（modules + module_orders / shop_products + shop_orders /
-- paid_assets + asset_purchases），订单无法联合查询、退款对账要写三段、购物车只覆盖模块线。
-- 本脚本建立标准五表（products / orders / order_items / payments / fulfillments），
-- 由 src/commerce/unified.ts 在启动期回填历史数据；三套旧表与旧接口保持原样继续服务，
-- 双写与读切换放到后续提交，保证这一步可以被随时回滚（删表即回到旧路径）。

CREATE TABLE IF NOT EXISTS products ( -- 统一商品：三条商品线共用一张表，用 kind 区分
  id             TEXT PRIMARY KEY, -- 商品主键；历史回填时直接复用源表主键，避免二次映射
  kind           TEXT NOT NULL CHECK (kind IN ('module','physical','card','asset')), -- 商品类型：功能模块 / 实物 / 卡密 / 付费资产
  code           TEXT, -- 源表业务编码（模块 code / 商品 code / 资产 code），用于对外寻址
  title          TEXT NOT NULL, -- 展示名快照；多语言模块取 zh-CN 文案，取不到则回落 code
  price_cents    INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0), -- 当前售价（分）；0 表示免费
  currency       TEXT NOT NULL DEFAULT 'CNY', -- 计价币种；模块线下单快照即为该币种
  stock          INTEGER NOT NULL DEFAULT 0, -- 库存；数字模块与资产不设库存，保持 0
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','off')), -- 上架状态：off 不再对外销售
  meta_json      TEXT NOT NULL DEFAULT '{}', -- 产线私有字段（区域 / 分类 / 作者 / 交付说明等），避免为差异加宽表
  created_at     TEXT NOT NULL -- 首次落库时间（ISO 字符串，与全库时间口径一致）
); -- products 定义结束

CREATE TABLE IF NOT EXISTS orders ( -- 统一订单：三套历史订单回填后共用该表
  id             TEXT PRIMARY KEY, -- 订单主键；回填时为 uo_<source>_<源主键>，保证可追溯
  user_id        TEXT NOT NULL REFERENCES users(id), -- 下单用户
  source         TEXT NOT NULL CHECK (source IN ('module','shop','asset')), -- 来源产线，迁移期用于区分写路径
  source_id      TEXT NOT NULL, -- 源订单主键（module_orders.id / shop_orders.id / asset_purchases.id）
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','delivered','refunded','cancelled')), -- 统一状态机，兼容三条产线的最大集合
  channel        TEXT NOT NULL DEFAULT 'manual', -- 结算通道：manual / alipay / wechat / stripe / wallet
  currency       TEXT NOT NULL DEFAULT 'CNY', -- 结算币种（下单时快照）
  total_cents    INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0), -- 订单原价合计
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0), -- 优惠合计（优惠码 / 积分）
  payable_cents  INTEGER NOT NULL DEFAULT 0 CHECK (payable_cents >= 0), -- 实付金额；余额线与支付线都以此为准
  created_at     TEXT NOT NULL, -- 下单时间
  paid_at        TEXT, -- 支付完成时间；未支付为空
  UNIQUE (source, source_id) -- 同一源订单只能回填一次，保证重复启动幂等
); -- orders 定义结束

CREATE TABLE IF NOT EXISTS order_items ( -- 订单明细：一行一件商品，数量与单价在下单时快照
  id               TEXT PRIMARY KEY, -- 明细主键
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, -- 所属订单
  product_id       TEXT NOT NULL, -- 商品主键（回填时等于源商品主键，不强绑 products 外键以兼容未回填品类）
  title            TEXT NOT NULL, -- 商品名快照，源商品改名后历史订单仍显示下单时名称
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0), -- 数量；实物线才有 >1 的可能
  unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0), -- 下单时单价（分）
  meta_json        TEXT NOT NULL DEFAULT '{}' -- 交付信息（卡密 / 物流 / 权益键），避免明细表继续加列
); -- order_items 定义结束

CREATE TABLE IF NOT EXISTS payments ( -- 统一支付流水：一张订单可多次支付 / 退款
  id              TEXT PRIMARY KEY, -- 支付流水主键
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, -- 关联订单
  provider        TEXT NOT NULL DEFAULT 'wallet', -- 渠道：wallet / alipay / wechat / stripe / manual
  status          TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','failed','refunded')), -- 流水状态
  amount_cents    INTEGER NOT NULL DEFAULT 0, -- 本次支付金额；退款方向由 negative 表达
  refunded_cents  INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0), -- 本流水已退金额
  created_at      TEXT NOT NULL -- 流水发生时间
); -- payments 定义结束

CREATE TABLE IF NOT EXISTS fulfillments ( -- 统一履约：数字交付 / 发货 / 发卡密共用一张表
  id           TEXT PRIMARY KEY, -- 履约主键
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, -- 关联订单
  kind         TEXT NOT NULL CHECK (kind IN ('entitlement','shipment','card_key')), -- 履约类型
  payload_json TEXT NOT NULL DEFAULT '{}', -- 权益键 / 物流单号 / 卡密内容
  created_at   TEXT NOT NULL -- 履约时间
); -- fulfillments 定义结束

CREATE INDEX IF NOT EXISTS ix_orders_user_created ON orders (user_id, created_at DESC); -- 个人中心「我的订单」按用户倒序翻页
CREATE INDEX IF NOT EXISTS ix_orders_source ON orders (source, source_id); -- 回填与按源产线核对
CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items (order_id); -- 订单详情取明细
CREATE INDEX IF NOT EXISTS ix_payments_order ON payments (order_id, created_at); -- 订单对账
CREATE INDEX IF NOT EXISTS ix_fulfillments_order ON fulfillments (order_id); -- 订单履约查询
