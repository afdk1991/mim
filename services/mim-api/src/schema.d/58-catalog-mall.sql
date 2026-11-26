-- 全量商城目录（2026-11-26）：源站 egluosi（鹏驰五金）全量商品落库。
-- 设计原则：只新增表，不改动既有 products / shop_products，旧商城链路零影响；
-- 目录数据与订单/库存解耦，源站下架只置 listed=0，不物理删除，保证历史可追溯。
-- 幂等：全部 CREATE ... IF NOT EXISTS，可重复执行。

-- 三级类目树：level 1/2/3 自关联，path_names 保存从一级到本级的名称数组。
CREATE TABLE IF NOT EXISTS catalog_categories ( -- 目录类目表
  id            TEXT PRIMARY KEY, -- 类目主键：<source>-<level>-<code>，跨库稳定
  source        TEXT NOT NULL DEFAULT 'egluosi', -- 货源站标识，预留多源并存
  level         INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3), -- 层级：1 一级 / 2 二级 / 3 三级叶子
  code          TEXT NOT NULL, -- 源站类目编码（ctg.value）
  name          TEXT NOT NULL, -- 类目中文名
  parent_id     TEXT, -- 上级类目主键；一级为 NULL
  path_names    TEXT NOT NULL DEFAULT '[]', -- 从一级到本级的名称数组（JSON）
  sort_no       INTEGER NOT NULL DEFAULT 0, -- 同级展示顺序，取源站目录顺序
  product_count INTEGER NOT NULL DEFAULT 0, -- 本级及下级商品总数缓存，同步后回填
  is_active     INTEGER NOT NULL DEFAULT 1, -- 1 在售类目 / 0 源站已移除
  first_seen_at TEXT NOT NULL, -- 首次入库时间（ISO 字符串）
  synced_at     TEXT NOT NULL -- 最近一次同步时间
); -- 类目表定义结束
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_categories_level_code ON catalog_categories(source, level, code); -- 同源同层编码唯一
CREATE INDEX IF NOT EXISTS ix_catalog_categories_parent ON catalog_categories(parent_id); -- 按父类目取子级
CREATE INDEX IF NOT EXISTS ix_catalog_categories_level ON catalog_categories(level, is_active); -- 一级/二级类目清单

-- 商品主档：一个 source_key 一行，字段映射见 scripts/catalog/mapping.mjs。
CREATE TABLE IF NOT EXISTS catalog_products ( -- 目录商品表
  id                TEXT PRIMARY KEY, -- 商品主键：eg-<源站货号>，重跑不变
  source            TEXT NOT NULL DEFAULT 'egluosi', -- 货源站标识
  source_key        TEXT NOT NULL, -- 幂等稳定键：sku:<code> 或 url:<详情地址>
  source_id         TEXT, -- 源站货号原文
  source_url        TEXT NOT NULL, -- 源站详情页地址（可追溯）
  item_no           TEXT NOT NULL, -- 源站商品编号（itemNo）
  title             TEXT NOT NULL, -- 展示标题（品牌 + 品名 + 规格组合）
  subtitle          TEXT NOT NULL DEFAULT '', -- 副标题（规格 / 材质 / 等级摘要）
  brand             TEXT, -- 归一化品牌
  c1_id             TEXT, -- 一级类目主键（聚合筛选用）
  c2_id             TEXT, -- 二级类目主键
  c3_id             TEXT, -- 三级叶子类目主键
  category_path     TEXT NOT NULL DEFAULT '[]', -- 完整类目路径数组（JSON）
  specs             TEXT NOT NULL DEFAULT '{}', -- 规格键值（JSON），与详情页规格页对齐
  attributes        TEXT NOT NULL DEFAULT '{}', -- 属性键值（JSON），品牌/标准/材质等
  promotions        TEXT NOT NULL DEFAULT '[]', -- 活动 / 满减提示（JSON）
  price_li          INTEGER, -- 源站面价（厘/支），无公开价时为 NULL
  price_fen         INTEGER NOT NULL DEFAULT 0, -- 面价折算分/支，便于统一结算口径
  discount_pct      REAL, -- 源站折扣百分比，100 表示无折扣
  sale_price_li     INTEGER, -- 折后价（厘/支）
  tejia_discount_pct REAL, -- 特价折扣百分比，仅透传展示
  price_source      TEXT NOT NULL DEFAULT 'inquiry', -- anonymous 有公开价 / inquiry 需询价
  price_captured_at TEXT, -- 价格抓取时间
  stock             INTEGER NOT NULL DEFAULT 0, -- 估算库存（箱规 × 10），仅作展示上限
  stock_source      TEXT NOT NULL DEFAULT 'unknown', -- 库存来源：assumed-box10 / unknown
  source_inv_status TEXT, -- 源站库存状态原文（缺货 / 下架等）
  source_on_sale    INTEGER NOT NULL DEFAULT 1, -- 源站是否在售（1/0）
  listed            INTEGER NOT NULL DEFAULT 1, -- 本地是否可售（1/0）；源站消失置 0
  source_status     TEXT NOT NULL DEFAULT 'active', -- 本地目录状态：active / off-sale / delisted
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','off')), -- 运营上下架开关
  unit              TEXT, -- 主销售单位
  pack_qty          INTEGER, -- 包装量（箱规/盒规）
  description       TEXT NOT NULL DEFAULT '', -- 详情描述文本
  images            TEXT NOT NULL DEFAULT '[]', -- 图片数组（JSON）：file/url/role/width/height/bytes
  cover_url         TEXT, -- 封面图地址（images 第一张）
  spec_image_url    TEXT, -- 规格图地址
  synced_at         TEXT NOT NULL, -- 最近同步时间
  created_at        TEXT NOT NULL, -- 首次入库时间
  updated_at        TEXT NOT NULL -- 本地最近更新时间
); -- 商品表定义结束
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_products_source_key ON catalog_products(source_key); -- 幂等键唯一
CREATE INDEX IF NOT EXISTS ix_catalog_products_c1 ON catalog_products(c1_id, listed, status); -- 一级类目筛选
CREATE INDEX IF NOT EXISTS ix_catalog_products_c3 ON catalog_products(c3_id, listed, status); -- 三级类目筛选
CREATE INDEX IF NOT EXISTS ix_catalog_products_listed ON catalog_products(listed, status, updated_at DESC); -- 全量列表按更新时间倒序
CREATE INDEX IF NOT EXISTS ix_catalog_products_price ON catalog_products(price_fen); -- 价格排序
CREATE INDEX IF NOT EXISTS ix_catalog_products_title ON catalog_products(title); -- 关键词检索（前缀/包含）

-- 字段级变更流水：每次同步只记录真正变化的字段，便于对账与回溯。
CREATE TABLE IF NOT EXISTS catalog_change_log ( -- 商品变更流水
  id          INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键
  run_id      TEXT NOT NULL, -- 所属同步批次
  product_id  TEXT, -- 本地商品主键
  source_key  TEXT NOT NULL, -- 源站幂等键
  field       TEXT NOT NULL, -- 变更字段名
  old_value   TEXT, -- 旧值（JSON 文本）
  new_value   TEXT, -- 新值（JSON 文本）
  changed_at  TEXT NOT NULL -- 变更时间
); -- 流水表定义结束
CREATE INDEX IF NOT EXISTS ix_catalog_change_log_key ON catalog_change_log(source_key, changed_at DESC); -- 单商品变更历史
CREATE INDEX IF NOT EXISTS ix_catalog_change_log_run ON catalog_change_log(run_id); -- 按批次对账

-- 同步运行记录：健康检查与运营面板读取「上次结果 / 下次时间」。
CREATE TABLE IF NOT EXISTS catalog_sync_runs ( -- 同步批次表
  run_id      TEXT PRIMARY KEY, -- 批次号：YYYYMMDDHHmmss
  source      TEXT NOT NULL DEFAULT 'egluosi', -- 货源站标识
  started_at  TEXT NOT NULL, -- 开始时间
  finished_at TEXT, -- 结束时间；运行中为 NULL
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')), -- 批次状态
  phase       TEXT, -- 当前阶段：catalog / detail / apply / done
  stats       TEXT NOT NULL DEFAULT '{}', -- 汇总统计（JSON）：类目数/商品数/图片数等
  report_path TEXT, -- 报告文件路径
  error       TEXT -- 失败摘要（单行截断）
); -- 批次表定义结束
CREATE INDEX IF NOT EXISTS ix_catalog_sync_runs_started ON catalog_sync_runs(started_at DESC); -- 最近批次查询
