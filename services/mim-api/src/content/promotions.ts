/**
 * 推广计划业务函数：公开进行中列表、点击计数（幂等键去重 + 滑动窗口频控）、管理端 CRUD 与统计读取。
 * 边界声明：本模块只统计曝光点击与预留转化计数，不记佣金、不做资金结算，与 referral_codes / referrals 解耦。
 */

import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import type { Db } from '../types.js'; // 数据库连接类型
import { envInt, isWithinWindow } from './shared.js'; // 环境变量整型读取 + 有效期判定

/** 推广计划行（库内完整字段子集） */
export interface PromotionRow {
  id: string;
  name: string;
  summary: string;
  target_url: string;
  code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  budget_cents: number;
  click_count: number;
  conversion_count: number;
  created_at: string;
  updated_at: string;
}

/** 公开列表条目（冻结契约：id / name / summary / target_url / starts_at / ends_at / status） */
export interface PublicPromotion {
  id: string;
  name: string;
  summary: string;
  target_url: string;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
}

/** 新建 / 更新入参 */
export interface PromotionInput {
  name: string;
  summary: string;
  target_url: string;
  code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  budget_cents: number;
}

export type PromotionPatch = Partial<PromotionInput>;

/** 频控违规描述：retryAfter 为建议退避秒数，路由据此写 Retry-After 头。 */
export interface ClickRateViolation {
  retryAfter: number;
}

/** 公开视图映射。 */
function toPublic(row: PromotionRow): PublicPromotion {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    target_url: row.target_url,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
  };
}

/** 公开推广计划：只回进行中且在有效期内的条目。 */
export function listPublicPromotions(db: Db, now: string): PublicPromotion[] {
  const rows = db
    .prepare(
      `SELECT * FROM promotions
        WHERE status = 'active'
          AND (starts_at IS NULL OR starts_at <= ?)
          AND (ends_at IS NULL OR ends_at > ?)
        ORDER BY created_at DESC, id DESC`,
    )
    .all(now, now) as PromotionRow[];
  return rows.map(toPublic);
}

/** 管理端列表：全量状态 + 统计计数，供后台推广页消费。 */
export function listAdminPromotions(db: Db): PromotionRow[] {
  return db.prepare('SELECT * FROM promotions ORDER BY created_at DESC, id DESC').all() as PromotionRow[];
}

/** 按主键取单行；不存在抛 NOT_FOUND。 */
export function getPromotion(db: Db, id: string): PromotionRow {
  const row = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) as PromotionRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', '推广计划不存在');
  return row;
}

/** 校验推广码未被占用；excludeId 用于更新时排除自身。 */
function assertCodeFree(db: Db, code: string | null, excludeId?: string): void {
  if (!code) return; // 空码不参与唯一约束
  const row = db.prepare('SELECT id FROM promotions WHERE code = ?').get(code) as { id: string } | undefined;
  if (row && row.id !== excludeId) throw new AppError('CONFLICT', '推广码已被占用', { code });
}

/** 校验时间区间：两端都给时截止必须晚于起始。 */
function validateWindow(startsAt: string | null, endsAt: string | null): void {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new AppError('VALIDATION_FAILED', 'ends_at 必须晚于 starts_at', { field: 'ends_at' });
  }
}

/** 新建推广计划。 */
export function createPromotion(db: Db, input: PromotionInput, now: string): PromotionRow {
  validateWindow(input.starts_at, input.ends_at);
  assertCodeFree(db, input.code);
  const id = `promo-${uuidv7()}`;
  db.prepare(
    `INSERT INTO promotions (id, name, summary, target_url, code, starts_at, ends_at, status, budget_cents, click_count, conversion_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(
    id,
    input.name,
    input.summary,
    input.target_url,
    input.code,
    input.starts_at,
    input.ends_at,
    input.status,
    input.budget_cents,
    now,
    now,
  );
  return getPromotion(db, id);
}

/** 局部更新推广计划；不直接改写 click_count / conversion_count（统计列由点击链路维护）。 */
export function updatePromotion(db: Db, id: string, patch: PromotionPatch, now: string): PromotionRow {
  const existing = getPromotion(db, id);
  const merged: PromotionRow = { ...existing, ...patch };
  validateWindow(merged.starts_at, merged.ends_at);
  if (patch.code !== undefined) assertCodeFree(db, patch.code, id);

  const fields: Array<keyof PromotionPatch> = [
    'name',
    'summary',
    'target_url',
    'code',
    'starts_at',
    'ends_at',
    'status',
    'budget_cents',
  ];
  const assignments: string[] = [];
  const params: Array<string | number | null> = [];
  for (const field of fields) {
    if (!(field in patch)) continue;
    assignments.push(`${field} = ?`);
    params.push((patch[field] as string | number | null) ?? null);
  }
  if (assignments.length === 0) return existing;
  assignments.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE promotions SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  return getPromotion(db, id);
}

/** 删除推广计划；不存在抛 NOT_FOUND。 */
export function deletePromotion(db: Db, id: string): void {
  const changed = db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
  if (changed.changes === 0) throw new AppError('NOT_FOUND', '推广计划不存在');
}

/** 点击前置校验：计划不存在 / 非进行中 / 不在有效期内一律 404，不泄漏内部状态差异。 */
export function assertClickable(row: PromotionRow, now: string): void {
  if (row.status !== 'active' || !isWithinWindow(row.starts_at, row.ends_at, now)) {
    throw new AppError('NOT_FOUND', '推广计划不存在或已结束');
  }
}

/**
 * 滑动窗口频控：同一访客在窗口秒数内对同一计划的点击数超过上限即违规。
 * 窗口长度 / 上限走 MIM_ 环境变量，缺省 600 秒内 10 次。
 */
export function checkClickRateLimit(
  db: Db,
  env: Record<string, string | undefined>,
  promotionId: string,
  visitor: string,
  now: string,
): ClickRateViolation | null {
  const windowSeconds = envInt(env, 'MIM_CONTENT_CLICK_WINDOW_SECONDS', 600);
  const max = envInt(env, 'MIM_CONTENT_CLICK_MAX', 10);
  if (max <= 0) return null; // 显式配 0 表示关闭频控（不建议生产关闭）
  const windowStart = new Date(Date.parse(now) - windowSeconds * 1000).toISOString();
  const recent = db
    .prepare('SELECT COUNT(*) AS count FROM promotion_clicks WHERE promotion_id = ? AND visitor_hash = ? AND created_at > ?')
    .get(promotionId, visitor, windowStart) as { count: number };
  if (recent.count >= max) {
    return { retryAfter: windowSeconds }; // 简化退避：一个窗口长度；审计表可按最早点击精确计算
  }
  return null;
}

/**
 * 入账一次点击：幂等键命中已有记录则回放不重复计数；否则落审计行并自增 click_count。
 * 调用方须先完成 assertClickable 与 checkClickRateLimit。
 * @returns deduped=true 表示命中幂等回放；click_count 为入账后的最新累计值。
 */
export function recordClick(
  db: Db,
  promotionId: string,
  idempotencyKey: string | null,
  visitor: string,
  now: string,
): { deduped: boolean; clickCount: number } {
  if (idempotencyKey) {
    const existing = db
      .prepare('SELECT 1 AS hit FROM promotion_clicks WHERE promotion_id = ? AND idempotency_key = ?')
      .get(promotionId, idempotencyKey);
    if (existing) {
      const row = db.prepare('SELECT click_count FROM promotions WHERE id = ?').get(promotionId) as { click_count: number };
      return { deduped: true, clickCount: row.click_count };
    }
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO promotion_clicks (id, promotion_id, idempotency_key, visitor_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`click-${uuidv7()}`, promotionId, idempotencyKey, visitor, now);
    const changed = db
      .prepare('UPDATE promotions SET click_count = click_count + 1, updated_at = ? WHERE id = ?')
      .run(now, promotionId);
    if (changed.changes === 0) throw new AppError('NOT_FOUND', '推广计划不存在');
    const row = db.prepare('SELECT click_count FROM promotions WHERE id = ?').get(promotionId) as { click_count: number };
    return row.click_count;
  });
  return { deduped: false, clickCount: tx() };
}
