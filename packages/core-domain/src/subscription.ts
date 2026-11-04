/**
 * 订阅状态机（FR-02 / 08 §3.3）。
 * 状态只能通过追加 subscription_events 迁移，禁止直接 UPDATE 状态列（除本状态机放行的迁移）。
 */

import { AppError } from './errors.js';
import type { BillingCycle, PlanId, Region } from './plans.js';

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'expired';

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: PlanId;
  region: Region;
  status: SubscriptionStatus;
  cycle: BillingCycle;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  version: number;
}

export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  active: ['past_due', 'canceled', 'expired'],
  past_due: ['active', 'canceled', 'expired'],
  canceled: ['expired', 'active'],
  expired: [],
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

export function assertSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      'SUBSCRIPTION_INVALID_TRANSITION',
      `subscription transition ${from} -> ${to} is not allowed`,
      { from, to },
    );
  }
}

/** 权益是否生效：到期时间已过则视为 expired（读时收敛，不依赖后台任务及时性） */
export function isSubscriptionEffective(sub: SubscriptionRecord, nowIso: string): boolean {
  if (sub.status === 'active' || sub.status === 'past_due') {
    return Date.parse(sub.currentPeriodEnd) > Date.parse(nowIso);
  }
  if (sub.status === 'canceled') {
    return Date.parse(sub.currentPeriodEnd) > Date.parse(nowIso);
  }
  return false;
}

export function addCycle(isoStart: string, cycle: BillingCycle): string {
  const start = new Date(isoStart);
  const end = new Date(start);
  if (cycle === 'monthly') {
    end.setUTCMonth(end.getUTCMonth() + 1);
  } else {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  }
  return end.toISOString();
}
