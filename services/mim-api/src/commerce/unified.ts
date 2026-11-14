/**
 * 统一交易域（2026-11-14 P0-A 第 1 步）：启动期把三套并行订单回填成一套，并提供统一只读查询。
 *
 * 现状（诊断文档 §1.1）：
 *   - 数字模块：module_orders + cart_items + entitlements
 *   - 实物 / 卡密：shop_products + shop_orders + shipments
 *   - 付费资产：paid_assets + asset_purchases
 * 三套订单表导致「我的订单 / 退款 / 对账 / GMV」都要写三段并手工合并。
 *
 * 本文件边界（有意做小）：
 *   1. 只做回填（幂等，UNIQUE(source, source_id) 保证重复启动不加行）与只读查询；
 *   2. 三套旧表与旧接口原样服务，不做双写、不做读切换——后续提交再逐条搬写路径；
 *   3. 任何时刻删掉 50-unified-commerce.sql 建的五张表即可回到旧路径，回滚成本为零。
 */

import type { Db } from '../types.js'; // 数据库类型（better-sqlite3 同步句柄）

/** 统一订单来源产线：迁移期用于区分历史来源与后续写路径 */
export type UnifiedOrderSource = 'module' | 'shop' | 'asset';

/** 统一订单明细行 */
export interface UnifiedOrderItem {
  id: string; // 明细主键
  product_id: string; // 商品主键（回填时等于源商品主键）
  product_code: string | null; // 商品业务编码（取自统一 products.code），前端寻址与回退展示用
  title: string; // 下单时商品名快照
  quantity: number; // 数量
  unit_price_cents: number; // 下单时单价（分）
}

/** 统一订单视图：对外 /api/v1/commerce/orders 直接返回该结构 */
export interface UnifiedOrder {
  id: string; // 统一订单主键
  user_id: string; // 下单用户
  source: UnifiedOrderSource; // 来源产线
  source_id: string; // 源订单主键，便于回查旧表；旧履约 / 写路径仍按它定位源订单
  status: string; // 统一状态机取值
  channel: string; // 结算通道
  currency: string; // 结算币种
  total_cents: number; // 原价合计
  discount_cents: number; // 优惠合计
  payable_cents: number; // 实付金额
  created_at: string; // 下单时间
  paid_at: string | null; // 支付完成时间
  product_code: string | null; // 首件商品编码，与明细同源，供模块 / 商品列表回退展示
  delivery_kind: string | null; // 实物线发货方式（旧 shop_orders.delivery_kind），仅 shop 来源有值，其余为 null
  delivered_content: string | null; // 卡密 / 人工说明（旧 shop_orders.delivered_content），仅 shop 来源有值，其余为 null
  items: UnifiedOrderItem[]; // 订单明细
}

/** 统一订单列表查询选项：source 缺省返回三源全部，指定后只回该产线（迁移期保留各页面原口径） */
export interface UnifiedOrderQuery {
  source?: UnifiedOrderSource; // 来源产线过滤
  limit?: number; // 分页大小，缺省由路由层解析
}

/** 回填结果计数：启动日志与测试断言共用 */
export interface BackfillResult {
  products: number; // 新写入的商品行数
  orders: number; // 新写入的订单行数
  items: number; // 新写入的明细行数
}

/** 从多语言 JSON 列取展示名：解析失败或取不到 zh-CN 时回落到业务编码，绝不抛错中断回填 */
function titleOf(json: string | null | undefined, fallback: string): string {
  if (!json) return fallback; // 空列直接回落
  try {
    const parsed = JSON.parse(json) as Record<string, string>; // 多语言对象形如 { "zh-CN": "...", "en-US": "..." }
    return parsed['zh-CN'] || parsed['en-US'] || fallback; // 优先中文，其次英文，最后编码
  } catch {
    return fallback; // 历史脏数据不阻断回填
  }
}

/** 源表行在回填中用到的最小字段集（三张源表各自 SELECT 出来后映射到该形状） */
interface SourceOrderRow {
  id: string; // 源订单主键
  user_id: string; // 用户
  product_id: string; // 源商品主键
  product_code: string | null; // 源商品编码
  product_title: string; // 源商品名
  amount_cents: number; // 原价
  discount_cents: number; // 优惠
  payable_cents: number; // 实付
  status: string; // 源状态
  channel: string; // 渠道
  currency: string; // 币种
  created_at: string; // 下单时间
  paid_at: string | null; // 支付时间
}

/** 三条产线的状态归一：资产线没有状态列，直接视为已支付 */
function normalizeStatus(raw: string): string {
  if (['pending', 'paid', 'delivered', 'refunded', 'cancelled'].includes(raw)) return raw; // 已在统一集合内
  return 'paid'; // 其余（含资产线空状态）一律按已支付，避免出现无法归类的新状态
}

/**
 * 启动期回填：把三套历史订单写进统一五表。
 * 幂等依据是 orders 的 UNIQUE(source, source_id)，以及 products / order_items 的固定主键；
 * 因此每次进程启动都跑一遍也只会写入缺失行，不会重复也不会覆盖用户后续修改。
 */
export function backfillUnifiedCommerce(db: Db, now: string = new Date().toISOString()): BackfillResult {
  const result: BackfillResult = { products: 0, orders: 0, items: 0 }; // 计数器
  const insertProduct = db.prepare(
    `INSERT OR IGNORE INTO products (id, kind, code, title, price_cents, currency, stock, status, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
  ); // 商品行插入：kind 由调用方决定，meta_json 携带产线私有信息
  const insertOrder = db.prepare(
    `INSERT OR IGNORE INTO orders (id, user_id, source, source_id, status, channel, currency, total_cents, discount_cents, payable_cents, created_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ); // 订单行插入：唯一键 (source, source_id) 保证幂等
  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO order_items (id, order_id, product_id, title, quantity, unit_price_cents, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ); // 明细行插入：主键固定为 uoi_<source>_<源主键>，重复启动不会加行

  // ---- 产线一：数字功能模块（module_orders 联 modules 取编码与多语言名） ----
  const moduleRows = db
    .prepare(
      `SELECT o.id AS id, o.user_id AS user_id, o.module_id AS product_id, m.code AS product_code,
              m.name_i18n AS product_name, o.amount_minor AS amount_cents, 0 AS discount_cents,
              o.amount_minor AS payable_cents, o.status AS status, o.channel AS channel,
              o.currency AS currency, o.created_at AS created_at, o.paid_at AS paid_at
         FROM module_orders o LEFT JOIN modules m ON m.id = o.module_id`,
    )
    .all() as Array<SourceOrderRow & { product_name: string | null }>; // 模块线：金额字段为 amount_minor
  for (const row of moduleRows) { // 逐行回填
    const source: UnifiedOrderSource = 'module'; // 标记来源产线
    const status = normalizeStatus(row.status); // 状态归一
    const productTitle = titleOf(row.product_name, row.product_code ?? row.product_id); // 多语言名 → 编码 → 主键
    const productRun = insertProduct.run(row.product_id, 'module', row.product_code, productTitle, row.amount_cents, row.currency, '{}', row.created_at); // 商品行
    result.products += productRun.changes; // 统计新写入
    const orderRun = insertOrder.run(`uo_${source}_${row.id}`, row.user_id, source, row.id, status, row.channel, row.currency, row.amount_cents, 0, row.payable_cents, row.created_at, row.paid_at); // 订单行
    result.orders += orderRun.changes; // 统计新写入
    const itemRun = insertItem.run(`uoi_${source}_${row.id}`, `uo_${source}_${row.id}`, row.product_id, productTitle, 1, row.amount_cents, '{"delivery":"entitlement"}'); // 明细行
    result.items += itemRun.changes; // 统计新写入
  }

  // ---- 产线二：实物 / 卡密（shop_orders 联 shop_products 取名与类型） ----
  const shopRows = db
    .prepare(
      `SELECT o.id AS id, o.user_id AS user_id, o.product_id AS product_id, p.code AS product_code,
              p.name AS product_name, o.amount_cents AS amount_cents, o.discount_cents AS discount_cents,
              o.payable_cents AS payable_cents, o.status AS status, 'wallet' AS channel,
              'CNY' AS currency, o.created_at AS created_at, o.paid_at AS paid_at
         FROM shop_orders o LEFT JOIN shop_products p ON p.id = o.product_id`,
    )
    .all() as Array<SourceOrderRow & { product_name: string | null }>; // 实物线：余额结算，币种固定 CNY
  for (const row of shopRows) { // 逐行回填
    const source: UnifiedOrderSource = 'shop'; // 标记来源产线
    const status = normalizeStatus(row.status); // 状态归一
    const productTitle = row.product_name ?? row.product_code ?? row.product_id; // 商品名直接取快照
    const kind = 'physical'; // 实物线与卡密线在统一商品表里都归 physical，具体交付由 fulfillment 表达
    const productRun = insertProduct.run(row.product_id, kind, row.product_code, productTitle, row.amount_cents, 'CNY', '{}', row.created_at); // 商品行
    result.products += productRun.changes; // 统计新写入
    const orderRun = insertOrder.run(`uo_${source}_${row.id}`, row.user_id, source, row.id, status, 'wallet', 'CNY', row.amount_cents, row.discount_cents, row.payable_cents, row.created_at, row.paid_at); // 订单行
    result.orders += orderRun.changes; // 统计新写入
    const itemRun = insertItem.run(`uoi_${source}_${row.id}`, `uo_${source}_${row.id}`, row.product_id, productTitle, 1, row.amount_cents - row.discount_cents, '{"delivery":"shipment"}'); // 明细行（单价取优惠后）
    result.items += itemRun.changes; // 统计新写入
  }

  // ---- 产线三：付费资产（asset_purchases 联 paid_assets，无状态列视为已支付） ----
  const assetRows = db
    .prepare(
      `SELECT o.id AS id, o.user_id AS user_id, o.asset_id AS product_id, a.code AS product_code,
              a.title AS product_name, o.amount_cents AS amount_cents, 0 AS discount_cents,
              o.amount_cents AS payable_cents, 'paid' AS status, 'wallet' AS channel,
              'CNY' AS currency, o.created_at AS created_at, o.created_at AS paid_at
         FROM asset_purchases o LEFT JOIN paid_assets a ON a.id = o.asset_id`,
    )
    .all() as Array<SourceOrderRow & { product_name: string | null }>; // 资产线：一次性买断，无折扣无状态机
  for (const row of assetRows) { // 逐行回填
    const source: UnifiedOrderSource = 'asset'; // 标记来源产线
    const productTitle = row.product_name ?? row.product_code ?? row.product_id; // 资产标题
    const productRun = insertProduct.run(row.product_id, 'asset', row.product_code, productTitle, row.amount_cents, 'CNY', '{}', row.created_at); // 商品行
    result.products += productRun.changes; // 统计新写入
    const orderRun = insertOrder.run(`uo_${source}_${row.id}`, row.user_id, source, row.id, 'paid', 'wallet', 'CNY', row.amount_cents, 0, row.amount_cents, row.created_at, row.created_at); // 订单行
    result.orders += orderRun.changes; // 统计新写入
    const itemRun = insertItem.run(`uoi_${source}_${row.id}`, `uo_${source}_${row.id}`, row.product_id, productTitle, 1, row.amount_cents, '{"delivery":"content"}'); // 明细行
    result.items += itemRun.changes; // 统计新写入
  }

  void now; // 回填不依赖当前时间（各行用源表自己的 created_at），保留参数只为将来按时间窗迁移
  return result; // 返回计数，调用方打印日志
}

/** 订单主体原始行：不含明细与派生展示字段，组装视图前的最小字段集 */
type RawOrderRow = Pick<UnifiedOrder, 'id' | 'user_id' | 'source' | 'source_id' | 'status' | 'channel' | 'currency' | 'total_cents' | 'discount_cents' | 'payable_cents' | 'created_at' | 'paid_at'>;

/** 实物线履约展示字段：迁移期只读回源 shop_orders 取发货方式与卡密说明；旧表冻结只读后该回源可移除 */
function shopFulfillment(db: Db, sourceId: string): { delivery_kind: string | null; delivered_content: string | null } {
  const row = db
    .prepare('SELECT delivery_kind, delivered_content FROM shop_orders WHERE id = ?') // 只读查询，不改动旧表
    .get(sourceId) as { delivery_kind: string | null; delivered_content: string | null } | undefined; // 命中行或空
  return row ?? { delivery_kind: null, delivered_content: null }; // 回源落空时两个展示字段均为 null
}

/** 组装一条统一订单视图：挂明细、首件商品编码与实物线履约展示字段 */
function assembleOrder(db: Db, row: RawOrderRow): UnifiedOrder {
  const items = db
    .prepare(
      `SELECT i.id, i.product_id, p.code AS product_code, i.title, i.quantity, i.unit_price_cents
         FROM order_items i LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = ? ORDER BY i.id`,
    ) // 联统一商品表带出业务编码，供前端寻址与回退展示
    .all(row.id) as UnifiedOrderItem[]; // 明细行
  const fulfillment = row.source === 'shop' ? shopFulfillment(db, row.source_id) : { delivery_kind: null, delivered_content: null }; // 仅实物线回源取履约展示字段
  return { // 统一订单视图
    ...row, // 主体字段原样带出
    product_code: items[0]?.product_code ?? null, // 首件商品编码，缺省 null
    delivery_kind: fulfillment.delivery_kind, // 发货方式（shop 来源）
    delivered_content: fulfillment.delivered_content, // 卡密 / 人工说明（shop 来源）
    items, // 明细列表
  };
}

/** 统一订单只读查询：按用户倒序取最近 N 条，并附带明细；source 缺省返回三源全部 */
export function listUnifiedOrders(db: Db, userId: string, query: UnifiedOrderQuery = {}): UnifiedOrder[] {
  const limit = query.limit ?? 50; // 分页大小缺省 50
  const where: string[] = ['o.user_id = ?']; // 归属过滤为必填条件
  const params: unknown[] = [userId]; // 与 where 占位符顺序一致的绑定参数
  if (query.source) { where.push('o.source = ?'); params.push(query.source); } // 指定产线时追加过滤，保留各页面原口径
  const rows = db
    .prepare(
      `SELECT o.id, o.user_id, o.source, o.source_id, o.status, o.channel, o.currency, o.total_cents, o.discount_cents,
              o.payable_cents, o.created_at, o.paid_at
         FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT ?`,
    )
    .all(...params, limit) as RawOrderRow[]; // 先取订单主体
  return rows.map((row) => assembleOrder(db, row)); // 逐条组装视图
}

/** 单笔统一订单：找不到或不属于当前用户时返回 null，路由据此回 404（不泄露他人订单是否存在） */
export function getUnifiedOrder(db: Db, orderId: string, userId: string): UnifiedOrder | null {
  const row = db
    .prepare(
      `SELECT o.id, o.user_id, o.source, o.source_id, o.status, o.channel, o.currency, o.total_cents, o.discount_cents,
              o.payable_cents, o.created_at, o.paid_at
         FROM orders o WHERE o.id = ? AND o.user_id = ?`,
    )
    .get(orderId, userId) as RawOrderRow | undefined; // 主体行
  if (!row) return null; // 不存在或越权
  return assembleOrder(db, row); // 合并明细与履约展示字段
}

/** 统一订单汇总：给「个人中心 / 商业化中台」提供一条口径，不再让前端自己合并三源 */
export function summarizeUnifiedOrders(db: Db, userId: string): { total: number; paid: number; pending: number; refunded: number; payable_cents: number } {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n, SUM(payable_cents) AS amount FROM orders WHERE user_id = ? GROUP BY status`)
    .all(userId) as Array<{ status: string; n: number; amount: number }>; // 按状态分组
  const summary = { total: 0, paid: 0, pending: 0, refunded: 0, payable_cents: 0 }; // 初始化，保证空库也返回完整形状
  for (const row of rows) { // 累加各状态
    summary.total += row.n; // 订单总数
    if (row.status === 'paid' || row.status === 'delivered') summary.paid += row.n; // 已支付口径包含已发货
    else if (row.status === 'pending') summary.pending += row.n; // 待支付
    else if (row.status === 'refunded') summary.refunded += row.n; // 已退款
    summary.payable_cents += row.amount ?? 0; // 实付合计（退款仍计入总额，便于对账口径统一）
  }
  return summary; // 返回固定字段集
}
