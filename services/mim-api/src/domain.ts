/** 跨路由复用的领域读取：生效套餐、项目权限、审计与订阅事件 */

import {
  AppError,
  PLANS,
  assertCan,
  isPlanId,
  isSubscriptionEffective,
  uuidv7,
} from '@mim/core-domain';
import type {
  Action,
  PlanFeatures,
  PlanId,
  ProjectRole,
  SubscriptionRecord,
  SubscriptionStatus,
} from '@mim/core-domain';
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

interface ProjectRow {
  id: string;
  user_id: string;
  region: string;
  name: string;
  description: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EffectivePlan {
  planId: PlanId;
  features: PlanFeatures;
  expiresAt: string | null;
  source: 'subscription' | 'free';
  subscription: SubscriptionRecord | null;
}

export interface ProjectAccess {
  project: ProjectRow;
  role: ProjectRole;
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
      features: PLANS[subscription.planId].features,
      expiresAt: subscription.currentPeriodEnd,
      source: 'subscription',
      subscription,
    };
  }
  return {
    planId: 'free',
    features: PLANS.free.features,
    expiresAt: null,
    source: 'free',
    subscription: subscription && isSubscriptionEffective(subscription, nowIso) ? subscription : null,
  };
}

export function getProjectRow(db: Db, projectId: string): ProjectRow | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!row || row.status === 'deleted') return null;
  return row;
}

export function getProjectRole(db: Db, projectId: string, userId: string): ProjectRole | null {
  const row = db
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'active'`)
    .get(projectId, userId) as { role: ProjectRole } | undefined;
  return row ? row.role : null;
}

/** 一次取齐项目 + 角色 + 动作鉴权；归档项目只允许读 */
export function assertProjectAccess(
  db: Db,
  projectId: string,
  userId: string,
  action: Action,
): ProjectAccess {
  const project = getProjectRow(db, projectId);
  if (!project) throw new AppError('PROJECT_NOT_FOUND', 'project not found', { project_id: projectId });
  const role = getProjectRole(db, projectId, userId);
  if (!role) throw new AppError('FORBIDDEN', 'you are not a member of this project');
  if (project.status === 'archived' && action !== 'project:read') {
    throw new AppError('PROJECT_ARCHIVED', 'archived project is read-only');
  }
  assertCan(role, action);
  return { project, role };
}

export function countOwnedProjects(db: Db, userId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM projects
       WHERE user_id = ? AND status IN ('active','archived')`,
    )
    .get(userId) as { n: number };
  return row.n;
}

export function countActiveCollaborators(db: Db, projectId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM project_members
       WHERE project_id = ? AND status = 'active' AND role <> 'owner'`,
    )
    .get(projectId) as { n: number };
  return row.n;
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
