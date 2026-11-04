/** FR-02 订阅计费：套餐目录、下单、支付回调、订阅查询与取消 */

import { Router } from 'express';
import { z } from 'zod';
import {
  AppError,
  PLANS,
  PLAN_IDS,
  REGION_CURRENCY,
  addCycle,
  assertOrderTransition,
  isPlanId,
  isSubscriptionEffective,
  missingDriverEnv,
  priceOf,
  uuidv7,
} from '@mim/core-domain';
import type { BillingCycle, PaymentDriverId, PlanId } from '@mim/core-domain';
import { clockOf, effectivePlan, latestSubscription, writeAudit } from '../domain.js';
import { idempotency, requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import type { ApiDeps, Db } from '../types.js';

interface OrderRow {
  id: string;
  user_id: string;
  plan_id: string;
  region: string;
  cycle: string;
  currency: string;
  amount_minor: number;
  status: string;
  driver: string;
  provider_ref: string | null;
  version: number;
  paid_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 对外统一 snake_case 订阅视图，避免 camelCase 字段泄漏到 API 契约 */
function subscriptionPayload(subscription: ReturnType<typeof latestSubscription>) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    plan_id: subscription.planId,
    status: subscription.status,
    cycle: subscription.cycle,
    current_period_start: subscription.currentPeriodStart,
    current_period_end: subscription.currentPeriodEnd,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    version: subscription.version,
  };
}

const checkoutBody = z.object({
  plan_id: z.string(),
  cycle: z.enum(['monthly', 'yearly']).default('monthly'),
  driver: z.enum(['mock', 'wechat', 'alipay', 'stripe']).default('mock'),
});

const callbackBody = z.object({
  order_id: z.string().min(1),
  result: z.enum(['success', 'failed']).default('success'),
});

const cancelBody = z.object({}).passthrough();

/** 支付成功后激活订阅：同一事务写入订阅、事件与发票 */
function activateFromOrder(db: Db, order: OrderRow, now: string): void {
  const end = addCycle(now, order.cycle as BillingCycle);
  const existing = latestSubscription(db, order.user_id);
  if (existing) {
    const result = db
      .prepare(
        `UPDATE subscriptions
         SET plan_id = ?, region = ?, status = 'active', cycle = ?,
             current_period_start = ?, current_period_end = ?,
             cancel_at_period_end = 0, version = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        order.plan_id,
        order.region,
        order.cycle,
        now,
        end,
        existing.version + 1,
        now,
        existing.id,
        existing.version,
      );
    if (result.changes === 0) throw new AppError('CONFLICT', 'subscription was modified concurrently');
    writeSubscriptionEvent(db, existing.id, 'activated', existing.status, 'active', order, now);
    insertInvoice(db, order, now);
    return;
  }

  const id = uuidv7();
  db.prepare(
    `INSERT INTO subscriptions
       (id, user_id, plan_id, region, status, cycle, current_period_start, current_period_end,
        cancel_at_period_end, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 0, 1, ?, ?)`,
  ).run(id, order.user_id, order.plan_id, order.region, order.cycle, now, end, now, now);
  writeSubscriptionEvent(db, id, 'activated', null, 'active', order, now);
  insertInvoice(db, order, now);
}

function writeSubscriptionEvent(
  db: Db,
  subscriptionId: string,
  type: string,
  from: string | null,
  to: string | null,
  order: OrderRow,
  now: string,
): void {
  db.prepare(
    `INSERT INTO subscription_events
       (id, subscription_id, type, from_status, to_status, payload, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv7(),
    subscriptionId,
    type,
    from,
    to,
    JSON.stringify({ order_id: order.id }),
    `order:${order.id}`,
    now,
  );
}

function insertInvoice(db: Db, order: OrderRow, now: string): void {
  db.prepare(
    `INSERT INTO invoices (id, order_id, user_id, amount_minor, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(uuidv7(), order.id, order.user_id, order.amount_minor, order.currency, now);
}

function orderPayload(row: OrderRow) {
  return {
    id: row.id,
    plan_id: row.plan_id,
    region: row.region,
    cycle: row.cycle,
    currency: row.currency,
    amount_minor: row.amount_minor,
    status: row.status,
    driver: row.driver,
    paid_at: row.paid_at,
    created_at: row.created_at,
  };
}

/** 把订单置为已支付并发放权益（幂等：已支付则原样返回） */
function settleOrder(db: Db, order: OrderRow, now: string): OrderRow {
  if (order.status === 'paid') return order;
  assertOrderTransition(order.status as 'pending' | 'paid' | 'failed' | 'closed' | 'refunded', 'paid');
  const result = db
    .prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .run(now, order.version + 1, now, order.id, order.version);
  if (result.changes === 0) throw new AppError('CONFLICT', 'order was modified concurrently');
  db.prepare(
    `INSERT INTO payments (id, order_id, driver, amount_minor, currency, status, provider_txn_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?)`,
  ).run(uuidv7(), order.id, order.driver, order.amount_minor, order.currency, `${order.driver}:${order.id}`, now);
  db.prepare(
    `UPDATE orders SET provider_ref = ? WHERE id = ?`,
  ).run(`${order.driver}:${order.id}`, order.id);
  activateFromOrder(db, order, now);
  return { ...order, status: 'paid', paid_at: now, version: order.version + 1 };
}

/** 公开路由：套餐目录 + 支付回调（不经过 requireAuth） */
export function createPublicBillingRouter(deps: ApiDeps): Router {
  const router = Router();

  router.get('/plans', (req, res) => {
    const region = req.query.region === 'global' ? 'global' : 'cn';
    const items = PLAN_IDS.map((id) => {
      const plan = PLANS[id];
      const monthly = priceOf(id, region, 'monthly');
      const yearly = priceOf(id, region, 'yearly');
      return {
        id: plan.id,
        name_zh: plan.nameZh,
        name_en: plan.nameEn,
        description_zh: plan.descriptionZh,
        description_en: plan.descriptionEn,
        currency: REGION_CURRENCY[region],
        prices: { monthly, yearly },
        configured: monthly !== null || yearly !== null,
      };
    });
    res.json({ region, items });
  });

  // mock 驱动回调（真实通道接入后由 provider 签名校验替换）
  router.post('/callbacks/mock', (req, res) => {
    const body = parse(callbackBody, req.body);
    const order = deps.db.prepare('SELECT * FROM orders WHERE id = ?').get(body.order_id) as OrderRow | undefined;
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'order not found');
    if (order.driver !== 'mock') {
      throw new AppError('PAYMENT_DRIVER_UNAVAILABLE', 'callback driver mismatch', { driver: order.driver });
    }
    const now = clockOf(deps);
    if (body.result === 'failed') {
      assertOrderTransition(order.status as 'pending' | 'paid' | 'failed' | 'closed' | 'refunded', 'failed');
      deps.db
        .prepare(`UPDATE orders SET status = 'failed', closed_at = ?, updated_at = ? WHERE id = ?`)
        .run(now, now, order.id);
      res.json({ order: { ...orderPayload(order), status: 'failed' } });
      return;
    }
    const updated = deps.db.transaction(() => settleOrder(deps.db, order, now))();
    res.json({ order: orderPayload(updated) });
  });

  return router;
}

/** 受保护路由：订阅与订单 */
export function createBillingRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/subscriptions/current', (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    const plan = effectivePlan(deps.db, user.id, now);
    const subscription = latestSubscription(deps.db, user.id);
    res.json({
      plan_id: plan.planId,
      source: plan.source,
      expires_at: plan.expiresAt,
      subscription: subscriptionPayload(subscription),
    });
  });

  router.post('/subscriptions/checkout', idempotency, (req, res) => {
    const body = parse(checkoutBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);

    if (!isPlanId(body.plan_id)) throw new AppError('PLAN_NOT_FOUND', 'plan not found');
    const planId: PlanId = body.plan_id;
    if (planId === 'free') {
      throw new AppError('PLAN_NOT_FOUND', 'free plan cannot be purchased');
    }
    const cycle: BillingCycle = body.cycle;
    const amount = priceOf(planId, user.region, cycle);
    if (amount === null) {
      throw new AppError('PLAN_PRICE_NOT_CONFIGURED', 'pricing is not configured for this region', {
        plan_id: planId,
        region: user.region,
        cycle,
      });
    }

    const current = effectivePlan(deps.db, user.id, now);
    if (current.source === 'subscription' && current.planId === planId) {
      throw new AppError('SUBSCRIPTION_ALREADY_ACTIVE', 'the same plan is already active', {
        plan_id: planId,
      });
    }

    const driver: PaymentDriverId = body.driver;
    if (driver !== 'mock') {
      const missing = missingDriverEnv(driver, deps.env);
      throw new AppError('PAYMENT_DRIVER_UNAVAILABLE', 'payment driver is not available', {
        driver,
        missing_env: missing,
        reason: missing.length === 0 ? 'adapter_not_implemented_p0' : 'missing_credentials',
      });
    }

    const orderId = uuidv7();
    const created = deps.db.transaction(() => {
      deps.db
        .prepare(
          `INSERT INTO orders
             (id, user_id, plan_id, region, cycle, currency, amount_minor, status, driver,
              idempotency_key, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?)`,
        )
        .run(
          orderId,
          user.id,
          planId,
          user.region,
          cycle,
          REGION_CURRENCY[user.region],
          amount,
          driver,
          req.header('idempotency-key') ?? null,
          now,
          now,
        );
      const row = deps.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRow;
      return settleOrder(deps.db, row, now);
    })();

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'billing.checkout',
      target: created.id,
      requestId: req.requestId,
      payload: { plan_id: planId, cycle, amount_minor: amount, driver },
      createdAt: now,
    });

    res
      .status(201)
      .json({ order: orderPayload(created), subscription: subscriptionPayload(latestSubscription(deps.db, user.id)) });
  });

  router.post('/subscriptions/cancel', idempotency, (req, res) => {
    parse(cancelBody, req.body ?? {});
    const user = req.user!;
    const now = clockOf(deps);
    const subscription = latestSubscription(deps.db, user.id);
    if (!subscription || !isSubscriptionEffective(subscription, now)) {
      throw new AppError('NOT_FOUND', 'no effective subscription to cancel');
    }
    if (subscription.cancelAtPeriodEnd) {
      res.json({ subscription: subscriptionPayload(subscription) });
      return;
    }
    assertOrderTransitionless(subscription.status);
    const result = deps.db
      .prepare(
        `UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 1, version = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(subscription.version + 1, now, subscription.id, subscription.version);
    if (result.changes === 0) throw new AppError('CONFLICT', 'subscription was modified concurrently');
    deps.db
      .prepare(
        `INSERT INTO subscription_events
           (id, subscription_id, type, from_status, to_status, payload, actor, created_at)
         VALUES (?, ?, 'canceled', ?, 'canceled', ?, ?, ?)`,
      )
      .run(
        uuidv7(),
        subscription.id,
        subscription.status,
        JSON.stringify({ cancel_at_period_end: true }),
        `user:${user.id}`,
        now,
      );
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'billing.cancel',
      target: subscription.id,
      requestId: req.requestId,
      createdAt: now,
    });
    res.json({ subscription: subscriptionPayload(latestSubscription(deps.db, user.id)) });
  });

  router.get('/orders', (req, res) => {
    const rows = deps.db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user!.id) as OrderRow[];
    res.json({ items: rows.map(orderPayload) });
  });

  router.get('/invoices', (req, res) => {
    const rows = deps.db
      .prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user!.id) as Array<{
      id: string;
      order_id: string;
      amount_minor: number;
      currency: string;
      created_at: string;
    }>;
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        order_id: row.order_id,
        amount_minor: row.amount_minor,
        currency: row.currency,
        created_at: row.created_at,
      })),
    });
  });

  return router;
}

/** 取消订阅只允许从 active / past_due 发起 */
function assertOrderTransitionless(status: string): void {
  if (status !== 'active' && status !== 'past_due') {
    throw new AppError('SUBSCRIPTION_INVALID_TRANSITION', `cannot cancel subscription in status ${status}`);
  }
}
