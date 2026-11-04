/** FR-01 个人中心：资料、套餐权益、注销与撤销 */

import { Router } from 'express';
import { z } from 'zod';
import { PLANS } from '@mim/core-domain';
import { DELETION_GRACE_DAYS } from '../config.js';
import {
  clockOf,
  effectivePlan,
  latestSubscription,
  writeAudit,
} from '../domain.js';
import { idempotency, requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import { addDays } from '../utils.js';
import type { ApiDeps } from '../types.js';

const profileBody = z
  .object({
    display_name: z.string().max(60).optional(),
    locale: z.enum(['zh-CN', 'en-US']).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export function createMeRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/me', (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    const plan = effectivePlan(deps.db, user.id, now);
    const subscription = latestSubscription(deps.db, user.id);
    res.json({
      user: {
        id: user.id,
        region: user.region,
        status: user.status,
        display_name: user.display_name,
        locale: user.locale,
        timezone: user.timezone,
      },
      plan: {
        id: plan.planId,
        name_zh: PLANS[plan.planId].nameZh,
        name_en: PLANS[plan.planId].nameEn,
        source: plan.source,
        expires_at: plan.expiresAt,
      },
      subscription: subscription
        ? {
            plan_id: subscription.planId,
            status: subscription.status,
            cycle: subscription.cycle,
            current_period_start: subscription.currentPeriodStart,
            current_period_end: subscription.currentPeriodEnd,
            cancel_at_period_end: subscription.cancelAtPeriodEnd,
          }
        : null,
    });
  });

  router.patch('/me', idempotency, (req, res) => {
    const body = parse(profileBody, req.body);
    const now = clockOf(deps);
    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.display_name !== undefined) {
      sets.push('display_name = ?');
      values.push(body.display_name);
    }
    if (body.locale !== undefined) {
      sets.push('locale = ?');
      values.push(body.locale);
    }
    if (body.timezone !== undefined) {
      sets.push('timezone = ?');
      values.push(body.timezone);
    }
    sets.push('updated_at = ?');
    values.push(now, req.user!.id);
    deps.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    writeAudit(deps.db, {
      userId: req.user!.id,
      region: req.user!.region,
      action: 'account.profile_update',
      target: req.user!.id,
      requestId: req.requestId,
      payload: body,
      createdAt: now,
    });

    const row = deps.db
      .prepare('SELECT id, region, status, display_name, locale, timezone FROM users WHERE id = ?')
      .get(req.user!.id);
    res.json({ user: row });
  });

  router.post('/me/deletion', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    if (user.status === 'pending_deletion') {
      res.json({ status: user.status, deletion_scheduled_at: null });
      return;
    }
    const scheduledAt = addDays(now, DELETION_GRACE_DAYS);
    deps.db
      .prepare(
        `UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(scheduledAt, now, user.id);
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'account.deletion_requested',
      target: user.id,
      requestId: req.requestId,
      payload: { deletion_scheduled_at: scheduledAt },
      createdAt: now,
    });
    res.json({ status: 'pending_deletion', deletion_scheduled_at: scheduledAt });
  });

  router.post('/me/cancel-deletion', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    if (user.status !== 'pending_deletion') {
      res.json({ status: user.status });
      return;
    }
    deps.db
      .prepare(
        `UPDATE users SET status = 'active', deletion_scheduled_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(now, user.id);
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'account.deletion_canceled',
      target: user.id,
      requestId: req.requestId,
      createdAt: now,
    });
    res.json({ status: 'active' });
  });

  return router;
}
