/** 交易履约路由：发货、物流轨迹、售后审核与商品评价 */

import { Router } from 'express'; // 路由容器
import { randomUUID } from 'node:crypto'; // 主键
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 鉴权与运营权限
import { parse } from '../validate.js'; // 校验错误翻译
import type { ApiDeps } from '../types.js'; // 依赖容器

const now = () => new Date().toISOString(); // UTC 时间
const ORDER_STATUSES = ['pending', 'paid', 'delivered', 'refunded', 'cancelled'] as const; // 订单状态全集

/** 当前用户名下订单；不存在按 404 处理，避免越权探测。 */
function ownOrder(deps: ApiDeps, userId: string, orderId: string) {
  const order = deps.db
    .prepare('SELECT id, user_id, product_id, payable_cents, status, delivery_kind FROM shop_orders WHERE id = ? AND user_id = ?')
    .get(orderId, userId) as
    | { id: string; user_id: string; product_id: string; payable_cents: number; status: string; delivery_kind: string }
    | undefined;
  if (!order) throw new AppError('NOT_FOUND', '订单不存在');
  return order;
}

/** 余额入账并写退款流水。 */
function refundToWallet(deps: ApiDeps, userId: string, amount: number, orderId: string): void {
  const wallet = deps.db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(userId) as { balance_cents: number } | undefined;
  if (!wallet) deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now());
  deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(amount, now(), userId);
  deps.db
    .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'refund', ?, 'shop_order', ?, '售后退款', ?)")
    .run(`wt-${randomUUID()}`, userId, amount, orderId, now());
}

export function createFulfillmentRouter(deps: ApiDeps): Router {
  const router = Router();

  /** 发货：运营填写承运商与单号，可带首条轨迹。 */
  router.post('/shop/orders/:id/ship', requirePermission('commerce:write'), idempotency, (req, res) => {
    const body = parse(
      z.object({
        carrier: z.string().min(1).max(40),
        tracking_no: z.string().min(3).max(60),
        status: z.enum(['pending', 'picked', 'transit', 'delivered', 'exception']).default('transit'),
        events: z.array(z.object({ text: z.string().min(1).max(120), at: z.string().max(40).optional() })).max(20).default([]),
      }),
      req.body,
    );
    const order = deps.db.prepare('SELECT id, status, delivery_kind FROM shop_orders WHERE id = ?').get(String(req.params.id)) as
      | { id: string; status: string; delivery_kind: string }
      | undefined;
    if (!order) throw new AppError('NOT_FOUND', '订单不存在');
    if (order.status === 'refunded' || order.status === 'cancelled') throw new AppError('CONFLICT', '已退款或已取消订单不可发货');
    const ts = now();
    const events = body.events.map((event) => ({ text: event.text, at: event.at ?? ts }));
    deps.db
      .prepare(
        `INSERT INTO shipments (id, order_id, carrier, tracking_no, status, events_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(order_id) DO UPDATE SET carrier = excluded.carrier, tracking_no = excluded.tracking_no,
           status = excluded.status, events_json = excluded.events_json, updated_at = excluded.updated_at`,
      )
      .run(`ship-${randomUUID()}`, order.id, body.carrier, body.tracking_no, body.status, JSON.stringify(events), ts, ts);
    if (body.status === 'delivered') deps.db.prepare("UPDATE shop_orders SET status = 'delivered', delivered_at = ? WHERE id = ?").run(ts, order.id);
    res.status(201).json({ ok: true, status: body.status });
  });

  /** 物流轨迹：本人或运营可查。 */
  router.get('/shop/orders/:id/shipment', requireAuth, (req, res) => {
    const userId = req.user!.id;
    const isOps = !!deps.db
      .prepare('SELECT 1 AS ok FROM user_roles ur JOIN role_permissions rp ON rp.role_code = ur.role_code WHERE ur.user_id = ? AND rp.permission_code = ?')
      .get(userId, 'commerce:write'); // 运营可直接按订单号查轨迹
    const order = isOps ? (deps.db.prepare('SELECT id FROM shop_orders WHERE id = ?').get(String(req.params.id)) as { id: string } | undefined) : ownOrder(deps, userId, String(req.params.id));
    if (!order) throw new AppError('NOT_FOUND', '订单不存在');
    const shipment = deps.db.prepare('SELECT carrier, tracking_no, status, events_json, updated_at FROM shipments WHERE order_id = ?').get(order.id) as
      | { carrier: string; tracking_no: string; status: string; events_json: string; updated_at: string }
      | undefined;
    if (!shipment) return res.json({ shipment: null });
    res.json({ shipment: { ...shipment, events: JSON.parse(shipment.events_json) as unknown[] } });
  });

  /** 申请售后：仅已付款 / 已发货订单，金额取订单实付。 */
  router.post('/shop/orders/:id/after-sales', requireAuth, idempotency, (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ kind: z.enum(['refund', 'return']), reason: z.string().min(4).max(300) }), req.body);
    const order = ownOrder(deps, userId, String(req.params.id));
    if (order.status === 'pending') throw new AppError('CONFLICT', '未支付订单无需售后');
    if (order.status === 'refunded') throw new AppError('CONFLICT', '订单已退款');
    const pending = deps.db.prepare("SELECT 1 AS ok FROM after_sales WHERE order_id = ? AND status = 'pending'").get(order.id);
    if (pending) throw new AppError('CONFLICT', '该订单已有待处理售后');
    const id = `as-${randomUUID()}`;
    deps.db
      .prepare("INSERT INTO after_sales (id, order_id, user_id, kind, reason, amount_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
      .run(id, order.id, userId, body.kind, body.reason, order.payable_cents, now(), now());
    res.status(201).json({ ok: true, id, amount_cents: order.payable_cents });
  });

  /** 我的售后列表。 */
  router.get('/after-sales/mine', requireAuth, (req, res) => {
    const items = deps.db
      .prepare('SELECT id, order_id, kind, reason, amount_cents, status, admin_note, created_at FROM after_sales WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(req.user!.id);
    res.json({ items });
  });

  /** 售后审核：通过即退款并关单；驳回保留原状态。 */
  router.post('/after-sales/:id/review', requirePermission('commerce:write'), idempotency, (req, res) => {
    const body = parse(z.object({ approve: z.boolean(), note: z.string().max(200).default('') }), req.body);
    const row = deps.db.prepare('SELECT id, order_id, user_id, amount_cents, status FROM after_sales WHERE id = ?').get(String(req.params.id)) as
      | { id: string; order_id: string; user_id: string; amount_cents: number; status: string }
      | undefined;
    if (!row) throw new AppError('NOT_FOUND', '售后单不存在');
    if (row.status !== 'pending') throw new AppError('CONFLICT', '售后单已处理');
    const ts = now();
    const tx = deps.db.transaction(() => {
      if (body.approve) {
        refundToWallet(deps, row.user_id, row.amount_cents, row.order_id);
        deps.db.prepare("UPDATE shop_orders SET status = 'refunded' WHERE id = ?").run(row.order_id);
        deps.db.prepare("UPDATE after_sales SET status = 'completed', admin_note = ?, updated_at = ? WHERE id = ?").run(body.note, ts, row.id);
      } else {
        deps.db.prepare("UPDATE after_sales SET status = 'rejected', admin_note = ?, updated_at = ? WHERE id = ?").run(body.note, ts, row.id);
      }
    });
    tx();
    res.json({ ok: true, status: body.approve ? 'completed' : 'rejected' });
  });

  /** 订单评价：一单一评，1–5 星。 */
  router.post('/shop/orders/:id/review', requireAuth, idempotency, (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ rating: z.number().int().min(1).max(5), content: z.string().max(500).default('') }), req.body);
    const order = ownOrder(deps, userId, String(req.params.id));
    if (!ORDER_STATUSES.includes(order.status as (typeof ORDER_STATUSES)[number])) throw new AppError('VALIDATION_FAILED', '订单状态不可评价');
    if (deps.db.prepare('SELECT 1 AS ok FROM product_reviews WHERE order_id = ?').get(order.id)) throw new AppError('CONFLICT', '该订单已评价');
    deps.db
      .prepare('INSERT INTO product_reviews (id, order_id, product_id, user_id, rating, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`rev-${randomUUID()}`, order.id, order.product_id, userId, body.rating, body.content, now());
    res.status(201).json({ ok: true });
  });

  /** 商品评价列表：按商品编码聚合。 */
  router.get('/shop/products/:code/reviews', requireAuth, (req, res) => {
    const product = deps.db.prepare('SELECT id, name FROM shop_products WHERE code = ?').get(req.params.code) as { id: string; name: string } | undefined;
    if (!product) throw new AppError('NOT_FOUND', '商品不存在');
    const items = deps.db
      .prepare(
        `SELECT r.rating, r.content, r.created_at, u.display_name AS user_name
         FROM product_reviews r LEFT JOIN users u ON u.id = r.user_id
         WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 50`,
      )
      .all(product.id);
    const summary = deps.db.prepare('SELECT COUNT(*) AS count, ROUND(AVG(rating), 2) AS avg FROM product_reviews WHERE product_id = ?').get(product.id);
    res.json({ product, items, summary });
  });

  return router;
}
