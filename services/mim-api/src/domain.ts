/** 跨路由复用的领域读取：生效套餐、审计与订阅事件 */

import { isPlanId, isSubscriptionEffective, uuidv7 } from '@mim/core-domain';
import type { PlanId, SubscriptionRecord, SubscriptionStatus } from '@mim/core-domain';
import type { ApiDeps, Db } from './types.js';

export function clockOf(deps: ApiDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  region: string;
  status: string;
  cycle: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: number;
  version: number;
}

export interface EffectivePlan {
  planId: PlanId;
  expiresAt: string | null;
  source: 'subscription' | 'free';
  subscription: SubscriptionRecord | null;
}

export function mapSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id as PlanId,
    region: row.region as 'cn' | 'global',
    status: row.status as SubscriptionStatus,
    cycle: row.cycle as 'monthly' | 'yearly',
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    version: row.version,
  };
}

export function latestSubscription(db: Db, userId: string): SubscriptionRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
    )
    .get(userId) as SubscriptionRow | undefined;
  return row ? mapSubscription(row) : null;
}

/** 权益判定：无有效订阅（含到期未续费）一律回落 free */
export function effectivePlan(db: Db, userId: string, nowIso: string): EffectivePlan {
  const subscription = latestSubscription(db, userId);
  if (subscription && isSubscriptionEffective(subscription, nowIso) && isPlanId(subscription.planId)) {
    return {
      planId: subscription.planId,
      expiresAt: subscription.currentPeriodEnd,
      source: 'subscription',
      subscription,
    };
  }
  return {
    planId: 'free',
    expiresAt: null,
    source: 'free',
    subscription: subscription && isSubscriptionEffective(subscription, nowIso) ? subscription : null,
  };
}

export interface AuditEntry {
  userId: string | null;
  region: string | null;
  action: string;
  target?: string | null;
  requestId: string | null;
  payload?: unknown;
  createdAt: string;
}

export function writeAudit(db: Db, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, region, action, target, request_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv7(),
    entry.userId,
    entry.region,
    entry.action,
    entry.target ?? null,
    entry.requestId,
    entry.payload === undefined ? null : JSON.stringify(entry.payload),
    entry.createdAt,
  );
}

export function appendSubscriptionEvent(
  db: Db,
  subscriptionId: string,
  type: string,
  fromStatus: SubscriptionStatus | null,
  toStatus: SubscriptionStatus | null,
  actor: string,
  payload: unknown,
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO subscription_events (id, subscription_id, type, from_status, to_status, payload, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv7(),
    subscriptionId,
    type,
    fromStatus,
    toStatus,
    payload === undefined ? null : JSON.stringify(payload),
    actor,
    createdAt,
  );
}
