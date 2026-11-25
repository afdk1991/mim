/**
 * 统一订单只读接口（2026-11-14 P0-A 第 1 步；2026-11-25 交易透明化批次补强）
 *
 * 为什么要有这一层：项目里三套订单（module / shop / asset）此前只能由前端分别调用三个路由再手工合并，
 * 退款 / 对账 / GMV 统计同样要写三段。本路由把「统一视图」先建起来，旧路由一律保留不动，
 * 后续提交再把写路径逐条迁到这里（届时旧路由改为适配器，不再直接写订单表）。
 *
 * 透明化批次补强：订单列表 / 详情在统一视图之上追加
 *   - 金额拆解：amount_cents（原价）/ discount_cents（优惠）/ payable_cents（实付）
 *   - status_timeline：待支付 → 已支付 → 已交付 → 已退款 / 已取消，缺时间戳的节点标 null
 *   - coupon：下单使用的优惠码（code / kind / value / discount_cents）
 *   - refunds：退款记录（商城订单退款 + 扩展渠道 payment_ext_refunds）
 *
 * 借鉴来源（口径对齐，不复制其条款文本）：
 *   - Stripe 定价页：金额与附加费逐项列示（https://stripe.com/pricing ）
 *   - PayPal：买卖双方保障与争议入口公开可查（https://www.paypal.com/business ）
 *   - 有赞：交易规则与售后按品类分档公开（https://www.youzan.com/ ）
 *
 * 路由一览（全部需要登录，只读，不引入写操作）：
 *   GET /commerce/orders            我的统一订单列表（倒序，默认 50 条，可用 limit 调整）
 *   GET /commerce/orders/summary    我的订单汇总（总数 / 已支付 / 待支付 / 已退款 / 实付合计）
 *   GET /commerce/orders/:id        单笔订单详情（跨用户一律 404，不泄露存在性）
 *   GET /shop/coupons/mine          本人可核验的优惠码清单（只读本人，匿名 401）
 *
 * 注意：/commerce/orders/summary 必须先于 /commerce/orders/:id 注册，否则 summary 会被当成订单 id。
 */

import { Router } from 'express'; // 路由容器，按前缀挂到 /api/v1
import { AppError } from '@mim/core-domain'; // 统一业务异常，找不到订单回 404 信封
import { requireAuth } from '../middleware.js'; // 登录态校验：订单属于个人数据，不对外开放
import { getUnifiedOrder, listUnifiedOrders, summarizeUnifiedOrders } from '../commerce/unified.js'; // 统一交易域查询
import {
  buildStatusTimeline, // 状态时间线组装纯函数
  evaluateCoupon, // 优惠码核验纯函数
  type CouponInvalidReason, // 券失效原因联合类型
  type CouponKind, // 券型联合类型
  type CouponPolicyRow, // 优惠码核验入参形状
  type OrderRefundRecord, // 退款记录条目形状
  type OrderTimelineNode, // 时间线节点形状
} from '../commerce/policy.js'; // 退款政策口径与券核验集中模块
import type { ApiDeps, Db } from '../types.js'; // 依赖注入：只需要 db
import type { UnifiedOrder, UnifiedOrderSource } from '../commerce/unified.js'; // 来源产线枚举与统一订单视图

/** limit 解析：非法值回落到默认 50，上限 200，避免一次拉出全库订单 */
function parseLimit(raw: unknown): number {
  const value = Number(raw ?? 50); // 缺省 50
  if (!Number.isFinite(value) || value <= 0) return 50; // 非法输入用默认值，不抛错
  return Math.min(Math.floor(value), 200); // 封顶 200
}

/** source 过滤解析：缺省返回全部产线；非法产线值回 400，避免静默放宽过滤口径 */
function parseSource(raw: unknown): UnifiedOrderSource | undefined {
  if (raw === undefined || raw === '') return undefined; // 未传不过滤
  if (raw === 'shop' || raw === 'asset' || raw === 'community') return raw; // 合法产线原样返回
  throw new AppError('VALIDATION_FAILED', '来源必须为 shop、asset 或 community 之一', { source: raw }); // 非法值显式拒绝
}

/** 订单回显的优惠码信息：供前端展示券型、面值与本单实减 */
interface OrderCouponInfo {
  code: string; // 优惠码明文（大写）
  kind: CouponKind; // fixed 立减 / percent 折扣
  value: number; // 面值：fixed 为分，percent 为百分比
  discount_cents: number; // 本单实减金额（分）
}

/** 透明化订单视图：在统一订单字段之上追加金额拆解、时间线、券与退款记录 */
interface TransparentOrder extends UnifiedOrder {
  amount_cents: number; // 原价合计（分），与 total_cents 同值，按前端拆解口径命名
  status_timeline: OrderTimelineNode[]; // 状态时间线，未到达节点时间为 null
  coupon: OrderCouponInfo | null; // 下单使用的优惠码，无券为 null
  refunds: OrderRefundRecord[]; // 退款记录，无退款为空数组
}

/** 商城订单源表行：回源取交付时间与券核销信息，旧表冻结只读后可移除 */
interface ShopOrderRow {
  coupon_code: string | null; // 下单使用的优惠码
  delivered_at: string | null; // 交付 / 发货时间
  status: string; // 商城订单状态
  payable_cents: number; // 实付金额（退款金额据此回显）
}

/** 扩展渠道退款表行：payment_ext_refunds 联 payment_ext_intents 按业务单号回查 */
interface ExtRefundRow {
  amount_cents: number; // 退款金额（分）
  status: string; // 退款状态
  created_at: string; // 退款发生时间
  reason: string | null; // 退款原因
}

/** 券行：与 coupons 表字段对齐，供核验与回显 */
interface CouponRow {
  id: string; // 主键
  code: string; // 明文
  kind: CouponKind; // 券型
  value: number; // 面值
}

/** 取统一订单的履约时间：shop 产线回源 shop_orders，其余产线读统一履约表最早一条 */
function fulfillmentTime(db: Db, orderId: string, source: string, sourceId: string): string | null {
  if (source === 'shop') {
    const shop = db.prepare('SELECT delivered_at FROM shop_orders WHERE id = ?').get(sourceId) as { delivered_at: string | null } | undefined; // 实物线回源
    return shop?.delivered_at ?? null; // 未发货为 null
  }
  const fulfillment = db.prepare('SELECT created_at FROM fulfillments WHERE order_id = ? ORDER BY created_at ASC LIMIT 1').get(orderId) as { created_at: string } | undefined; // 权益 / 资产履约记录
  return fulfillment?.created_at ?? null; // 无履约记录为 null
}

/** 按商城订单与优惠码明文回查券信息；券已删除或无核销记录时按 null 处理，不阻断订单展示 */
function couponForOrder(db: Db, orderId: string, couponCode: string): OrderCouponInfo | null {
  const coupon = db.prepare('SELECT id, code, kind, value FROM coupons WHERE code = ?').get(couponCode.toUpperCase()) as CouponRow | undefined; // 明文大写匹配唯一键
  if (!coupon) return null; // 券已删除：不展示券信息
  const redemption = db.prepare('SELECT discount_cents FROM coupon_redemptions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(orderId) as { discount_cents: number } | undefined; // 本单核销记录
  return {
    code: coupon.code, // 券明文
    kind: coupon.kind, // 券型
    value: coupon.value, // 面值
    discount_cents: redemption?.discount_cents ?? 0, // 实减金额，缺核销记录回落 0
  };
}

/** 组装透明化订单：在统一视图上补金额拆解、时间线、券与退款记录；全部只读查询 */
function enrichOrder(db: Db, order: UnifiedOrder): TransparentOrder {
  const refunds: OrderRefundRecord[] = []; // 退款记录累积器
  let coupon: OrderCouponInfo | null = null; // 券信息，无券保持 null
  let deliveredAt: string | null = fulfillmentTime(db, order.id, order.source, order.source_id); // 交付时间
  let refundedAt: string | null = null; // 退款到账时间（扩展渠道有记录才填）

  // 商城产线：回源 shop_orders 取退款状态与券码；其余产线无商城订单退款记录
  if (order.source === 'shop') {
    const shop = db.prepare('SELECT coupon_code, delivered_at, status, payable_cents FROM shop_orders WHERE id = ?').get(order.source_id) as ShopOrderRow | undefined; // 旧表只读回源
    if (shop) {
      deliveredAt = shop.delivered_at; // 以商城订单交付时间为准
      if (shop.coupon_code) coupon = couponForOrder(db, order.source_id, shop.coupon_code); // 券信息回查
      if (shop.status === 'refunded') {
        refunds.push({ // 商城订单退款：金额取实付，时间无独立列标 null
          amount_cents: shop.payable_cents, // 退款金额（分）
          status: 'refunded', // 已退款
          created_at: null, // 无退款时间戳记录
          source: 'shop_order', // 来源：商城订单
          reason: null, // 售后备注不落在订单表
        });
      }
    }
  }

  // 扩展渠道退款：按业务单号（ref_id = 源订单主键）联表回查，一笔订单可多次部分退款
  const extRefunds = db
    .prepare(
      `SELECT r.amount_cents, r.status, r.created_at, r.reason
         FROM payment_ext_refunds r JOIN payment_ext_intents i ON i.id = r.intent_id
        WHERE i.ref_id = ? ORDER BY r.created_at ASC`,
    )
    .all(order.source_id) as ExtRefundRow[]; // 退款明细列表
  for (const row of extRefunds) {
    refunds.push({
      amount_cents: row.amount_cents, // 退款金额（分）
      status: row.status, // 渠道退款状态
      created_at: row.created_at, // 退款时间
      source: 'ext_refund', // 来源：扩展渠道退款表
      reason: row.reason || null, // 退款原因，空串回落 null
    });
    if (row.status === 'processed') refundedAt = row.created_at; // 已处理退款记为退款到账时间
  }

  const status_timeline = buildStatusTimeline({ // 状态时间线：缺时间戳节点统一标 null
    created_at: order.created_at, // 下单时间
    paid_at: order.paid_at, // 支付完成时间
    delivered_at: deliveredAt, // 交付 / 发货时间
    refunded_at: refundedAt, // 退款到账时间
    cancelled_at: null, // 取消时刻无独立列，标 null 不编造
  });

  return {
    ...order, // 统一视图原字段原样带出
    amount_cents: order.total_cents, // 原价合计（分）
    status_timeline, // 状态时间线
    coupon, // 券信息
    refunds, // 退款记录
  };
}

/** 我的优惠码清单条目：核验字段 + 是否本人已用 + 失效原因，供个人中心「我的优惠」展示 */
interface MyCouponItem {
  code: string; // 优惠码明文
  kind: CouponKind; // fixed 立减 / percent 折扣
  value: number; // 面值：fixed 为分，percent 为百分比
  min_amount_cents: number; // 最低消费门槛（分）
  starts_at: string | null; // 生效开始时间，null 即刻生效
  expires_at: string | null; // 过期时间，null 长期有效
  max_uses: number; // 总可用次数，0 不限
  used_count: number; // 已核销次数
  redeemed_by_me: boolean; // 本人是否已核销过
  valid: boolean; // 当前是否对本人生效（无购物车金额时跳过门槛判定）
  invalid_reason: CouponInvalidReason; // 失效原因，可用为 null
}

export function createOrdersRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立 router，便于在 app 层按前缀挂载
  router.use('/commerce/orders', requireAuth); // 统一订单全部要求登录

  router.get('/commerce/orders', (req, res) => {
    const user = req.user!; // requireAuth 已注入登录态
    const limit = parseLimit(req.query.limit); // 分页大小
    const source = parseSource(req.query.source); // 可选产线过滤：迁移期各页面保留原产线口径
    const items = listUnifiedOrders(deps.db, user.id, { source, limit }).map((order) => enrichOrder(deps.db, order)); // 统一视图逐条补透明化字段
    res.json({ items, total: items.length, limit }); // 返回列表与条数，前端不必再合并三源
  });

  router.get('/commerce/orders/summary', (req, res) => {
    const user = req.user!; // 登录用户
    res.json({ summary: summarizeUnifiedOrders(deps.db, user.id) }); // 单一口径汇总
  });

  router.get('/commerce/orders/:id', (req, res) => {
    const user = req.user!; // 登录用户
    const order = getUnifiedOrder(deps.db, req.params.id, user.id); // 越权查询在这里被 user_id 过滤
    if (!order) throw new AppError('NOT_FOUND', '订单不存在', { id: req.params.id }); // 统一 404 信封
    res.json({ order: enrichOrder(deps.db, order) }); // 详情补透明化字段后返回
  });

  /**
   * GET /shop/coupons/mine：本人优惠码清单。
   * 券为全局发放，这里按「本人是否已核销」标注；核验不绑定具体订单金额（无购物车上下文），
   * 最低消费门槛字段原样回显，由前端按结算金额比对。匿名未登录由 requireAuth 回 401。
   */
  router.get('/shop/coupons/mine', requireAuth, (req, res) => {
    const userId = req.user!.id; // 登录用户，只读本人核销记录
    const redeemedRows = deps.db.prepare('SELECT coupon_id FROM coupon_redemptions WHERE user_id = ?').all(userId) as Array<{ coupon_id: string }>; // 本人已核销券
    const redeemedByMe = new Set(redeemedRows.map((row) => row.coupon_id)); // 券主键集合，便于 O(1) 判定
    const rows = deps.db.prepare('SELECT * FROM coupons ORDER BY code').all() as CouponPolicyRow[]; // 全量券（含停用 / 已用完），失效原因逐条标注
    const items: MyCouponItem[] = rows.map((coupon) => {
      const evaluation = evaluateCoupon(coupon, null, { redeemedByMe: redeemedByMe.has(coupon.id) }); // 无订单金额，跳过门槛判定
      return {
        code: coupon.code, // 券明文
        kind: coupon.kind, // 券型
        value: coupon.value, // 面值
        min_amount_cents: coupon.min_amount_cents, // 门槛（分）
        starts_at: coupon.starts_at, // 生效开始
        expires_at: coupon.expires_at, // 过期时间
        max_uses: coupon.max_uses, // 总次数
        used_count: coupon.used_count, // 已用次数
        redeemed_by_me: redeemedByMe.has(coupon.id), // 本人是否已用
        valid: evaluation.valid, // 是否生效
        invalid_reason: evaluation.invalid_reason, // 失效原因
      };
    });
    res.json({ coupons: items }); // 返回清单与核验字段
  });

  return router; // 交回 app 装配
}
