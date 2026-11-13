/**
 * 推广计划业务函数：公开进行中列表、点击计数（幂等键去重 + 滑动窗口频控）、管理端 CRUD 与统计读取。
 * 边界声明：本模块只统计曝光点击与预留转化计数，不记佣金、不做资金结算，与 referral_codes / referrals 解耦。
 */

import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import type { Db } from '../types.js'; // 数据库连接类型
import { envInt, isWithinWindow } from './shared.js'; // 环境变量整型读取 + 有效期判定

/** 推广计划行（库内完整字段子集） */
export interface PromotionRow {
  id: string; // 对象字段 id：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  summary: string; // 对象字段 summary：记录一项配置或数据
  target_url: string; // 对象字段 target_url：记录一项配置或数据
  code: string | null; // 对象字段 code：记录一项配置或数据
  starts_at: string | null; // 对象字段 starts_at：记录一项配置或数据
  ends_at: string | null; // 对象字段 ends_at：记录一项配置或数据
  status: 'draft' | 'active' | 'paused' | 'archived'; // 对象字段 status：记录一项配置或数据
  budget_cents: number; // 对象字段 budget_cents：记录一项配置或数据
  click_count: number; // 对象字段 click_count：记录一项配置或数据
  conversion_count: number; // 对象字段 conversion_count：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  updated_at: string; // 对象字段 updated_at：记录一项配置或数据
} // 代码块结束

/** 公开列表条目（冻结契约：id / name / summary / target_url / starts_at / ends_at / status） */
export interface PublicPromotion {
  id: string; // 对象字段 id：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  summary: string; // 对象字段 summary：记录一项配置或数据
  target_url: string; // 对象字段 target_url：记录一项配置或数据
  starts_at: string | null; // 对象字段 starts_at：记录一项配置或数据
  ends_at: string | null; // 对象字段 ends_at：记录一项配置或数据
  status: string; // 对象字段 status：记录一项配置或数据
} // 代码块结束

/** 新建 / 更新入参 */
export interface PromotionInput {
  name: string; // 对象字段 name：记录一项配置或数据
  summary: string; // 对象字段 summary：记录一项配置或数据
  target_url: string; // 对象字段 target_url：记录一项配置或数据
  code: string | null; // 对象字段 code：记录一项配置或数据
  starts_at: string | null; // 对象字段 starts_at：记录一项配置或数据
  ends_at: string | null; // 对象字段 ends_at：记录一项配置或数据
  status: 'draft' | 'active' | 'paused' | 'archived'; // 对象字段 status：记录一项配置或数据
  budget_cents: number; // 对象字段 budget_cents：记录一项配置或数据
} // 代码块结束

export type PromotionPatch = Partial<PromotionInput>; // 导出类型 PromotionPatch：跨模块共享的类型定义

/** 频控违规描述：retryAfter 为建议退避秒数，路由据此写 Retry-After 头。 */
export interface ClickRateViolation {
  retryAfter: number; // 对象字段 retryAfter：记录一项配置或数据
} // 代码块结束

/** 公开视图映射。 */
function toPublic(row: PromotionRow): PublicPromotion {
  return { // 返回当前函数的处理结果
    id: row.id, // 对象字段 id：记录一项配置或数据
    name: row.name, // 对象字段 name：记录一项配置或数据
    summary: row.summary, // 对象字段 summary：记录一项配置或数据
    target_url: row.target_url, // 对象字段 target_url：记录一项配置或数据
    starts_at: row.starts_at, // 对象字段 starts_at：记录一项配置或数据
    ends_at: row.ends_at, // 对象字段 ends_at：记录一项配置或数据
    status: row.status, // 对象字段 status：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

/** 公开推广计划：只回进行中且在有效期内的条目。 */
export function listPublicPromotions(db: Db, now: string): PublicPromotion[] {
  const rows = db // 常量 rows：保存固定配置或一次性派生值
    .prepare( // 执行当前业务步骤
      `SELECT * FROM promotions
        WHERE status = 'active'
          AND (starts_at IS NULL OR starts_at <= ?)
          AND (ends_at IS NULL OR ends_at > ?)
        ORDER BY created_at DESC, id DESC`,
    ) // 执行当前业务步骤
    .all(now, now) as PromotionRow[]; // 注册 ALL 路由 / 中间件处理器
  return rows.map(toPublic); // 返回当前函数的处理结果
} // 代码块结束

/** 管理端列表：全量状态 + 统计计数，供后台推广页消费。 */
export function listAdminPromotions(db: Db): PromotionRow[] {
  return db.prepare('SELECT * FROM promotions ORDER BY created_at DESC, id DESC').all() as PromotionRow[]; // 返回当前函数的处理结果
} // 代码块结束

/** 按主键取单行；不存在抛 NOT_FOUND。 */
export function getPromotion(db: Db, id: string): PromotionRow {
  const row = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) as PromotionRow | undefined; // 常量 row：保存固定配置或一次性派生值
  if (!row) throw new AppError('NOT_FOUND', '推广计划不存在'); // 条件分支：按判断结果选择后续处理路径
  return row; // 返回当前函数的处理结果
} // 代码块结束

/** 校验推广码未被占用；excludeId 用于更新时排除自身。 */
function assertCodeFree(db: Db, code: string | null, excludeId?: string): void {
  if (!code) return; // 空码不参与唯一约束
  const row = db.prepare('SELECT id FROM promotions WHERE code = ?').get(code) as { id: string } | undefined; // 常量 row：保存固定配置或一次性派生值
  if (row && row.id !== excludeId) throw new AppError('CONFLICT', '推广码已被占用', { code }); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

/** 校验时间区间：两端都给时截止必须晚于起始。 */
function validateWindow(startsAt: string | null, endsAt: string | null): void {
  if (startsAt && endsAt && endsAt <= startsAt) { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('VALIDATION_FAILED', 'ends_at 必须晚于 starts_at', { field: 'ends_at' }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
} // 代码块结束

/** 新建推广计划。 */
export function createPromotion(db: Db, input: PromotionInput, now: string): PromotionRow {
  validateWindow(input.starts_at, input.ends_at); // 调用 validateWindow 并处理其返回结果
  assertCodeFree(db, input.code); // 调用 assertCodeFree 并处理其返回结果
  const id = `promo-${uuidv7()}`; // 常量 id：保存固定配置或一次性派生值
  db.prepare( // 执行当前业务步骤
    `INSERT INTO promotions (id, name, summary, target_url, code, starts_at, ends_at, status, budget_cents, click_count, conversion_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run( // 执行当前业务步骤
    id, // 执行当前业务步骤
    input.name, // 执行当前业务步骤
    input.summary, // 执行当前业务步骤
    input.target_url, // 执行当前业务步骤
    input.code, // 执行当前业务步骤
    input.starts_at, // 执行当前业务步骤
    input.ends_at, // 执行当前业务步骤
    input.status, // 执行当前业务步骤
    input.budget_cents, // 执行当前业务步骤
    now, // 执行当前业务步骤
    now, // 执行当前业务步骤
  ); // 执行当前业务步骤
  return getPromotion(db, id); // 返回当前函数的处理结果
} // 代码块结束

/** 局部更新推广计划；不直接改写 click_count / conversion_count（统计列由点击链路维护）。 */
export function updatePromotion(db: Db, id: string, patch: PromotionPatch, now: string): PromotionRow {
  const existing = getPromotion(db, id); // 常量 existing：保存固定配置或一次性派生值
  const merged: PromotionRow = { ...existing, ...patch }; // 常量 merged：保存固定配置或一次性派生值
  validateWindow(merged.starts_at, merged.ends_at); // 调用 validateWindow 并处理其返回结果
  if (patch.code !== undefined) assertCodeFree(db, patch.code, id); // 条件分支：按判断结果选择后续处理路径

  const fields: Array<keyof PromotionPatch> = [ // 常量 fields：保存固定配置或一次性派生值
    'name', // 执行当前业务步骤
    'summary', // 执行当前业务步骤
    'target_url', // 执行当前业务步骤
    'code', // 执行当前业务步骤
    'starts_at', // 执行当前业务步骤
    'ends_at', // 执行当前业务步骤
    'status', // 执行当前业务步骤
    'budget_cents', // 执行当前业务步骤
  ]; // 执行当前业务步骤
  const assignments: string[] = []; // 常量 assignments：保存固定配置或一次性派生值
  const params: Array<string | number | null> = []; // 常量 params：保存固定配置或一次性派生值
  for (const field of fields) { // 循环：逐项遍历集合并执行相同处理
    if (!(field in patch)) continue; // 条件分支：按判断结果选择后续处理路径
    assignments.push(`${field} = ?`); // 执行当前业务步骤
    params.push((patch[field] as string | number | null) ?? null); // 执行当前业务步骤
  } // 代码块结束
  if (assignments.length === 0) return existing; // 条件分支：按判断结果选择后续处理路径
  assignments.push('updated_at = ?'); // 执行当前业务步骤
  params.push(now, id); // 执行当前业务步骤
  db.prepare(`UPDATE promotions SET ${assignments.join(', ')} WHERE id = ?`).run(...params); // 执行当前业务步骤
  return getPromotion(db, id); // 返回当前函数的处理结果
} // 代码块结束

/** 删除推广计划；不存在抛 NOT_FOUND。 */
export function deletePromotion(db: Db, id: string): void {
  const changed = db.prepare('DELETE FROM promotions WHERE id = ?').run(id); // 常量 changed：保存固定配置或一次性派生值
  if (changed.changes === 0) throw new AppError('NOT_FOUND', '推广计划不存在'); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

/** 点击前置校验：计划不存在 / 非进行中 / 不在有效期内一律 404，不泄漏内部状态差异。 */
export function assertClickable(row: PromotionRow, now: string): void {
  if (row.status !== 'active' || !isWithinWindow(row.starts_at, row.ends_at, now)) { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('NOT_FOUND', '推广计划不存在或已结束'); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
} // 代码块结束

/**
 * 滑动窗口频控：同一访客在窗口秒数内对同一计划的点击数超过上限即违规。
 * 窗口长度 / 上限走 MIM_ 环境变量，缺省 600 秒内 10 次。
 */
export function checkClickRateLimit(
  db: Db, // 对象字段 db：记录一项配置或数据
  env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
  promotionId: string, // 对象字段 promotionId：记录一项配置或数据
  visitor: string, // 对象字段 visitor：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): ClickRateViolation | null { // 执行当前业务步骤
  const windowSeconds = envInt(env, 'MIM_CONTENT_CLICK_WINDOW_SECONDS', 600); // 常量 windowSeconds：保存固定配置或一次性派生值
  const max = envInt(env, 'MIM_CONTENT_CLICK_MAX', 10); // 常量 max：保存固定配置或一次性派生值
  if (max <= 0) return null; // 显式配 0 表示关闭频控（不建议生产关闭）
  const windowStart = new Date(Date.parse(now) - windowSeconds * 1000).toISOString(); // 常量 windowStart：保存固定配置或一次性派生值
  const recent = db // 常量 recent：保存固定配置或一次性派生值
    .prepare('SELECT COUNT(*) AS count FROM promotion_clicks WHERE promotion_id = ? AND visitor_hash = ? AND created_at > ?') // 执行当前业务步骤
    .get(promotionId, visitor, windowStart) as { count: number }; // 注册 GET 路由 / 中间件处理器
  if (recent.count >= max) { // 条件分支：按判断结果选择后续处理路径
    return { retryAfter: windowSeconds }; // 简化退避：一个窗口长度；审计表可按最早点击精确计算
  } // 代码块结束
  return null; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 入账一次点击：幂等键命中已有记录则回放不重复计数；否则落审计行并自增 click_count。
 * 调用方须先完成 assertClickable 与 checkClickRateLimit。
 * @returns deduped=true 表示命中幂等回放；click_count 为入账后的最新累计值。
 */
export function recordClick(
  db: Db, // 对象字段 db：记录一项配置或数据
  promotionId: string, // 对象字段 promotionId：记录一项配置或数据
  idempotencyKey: string | null, // 对象字段 idempotencyKey：记录一项配置或数据
  visitor: string, // 对象字段 visitor：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): { deduped: boolean; clickCount: number } { // 执行当前业务步骤
  if (idempotencyKey) { // 条件分支：按判断结果选择后续处理路径
    const existing = db // 常量 existing：保存固定配置或一次性派生值
      .prepare('SELECT 1 AS hit FROM promotion_clicks WHERE promotion_id = ? AND idempotency_key = ?') // 执行当前业务步骤
      .get(promotionId, idempotencyKey); // 注册 GET 路由 / 中间件处理器
    if (existing) { // 条件分支：按判断结果选择后续处理路径
      const row = db.prepare('SELECT click_count FROM promotions WHERE id = ?').get(promotionId) as { click_count: number }; // 常量 row：保存固定配置或一次性派生值
      return { deduped: true, clickCount: row.click_count }; // 返回当前函数的处理结果
    } // 代码块结束
  } // 代码块结束

  const tx = db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
    db.prepare( // 执行当前业务步骤
      `INSERT INTO promotion_clicks (id, promotion_id, idempotency_key, visitor_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`click-${uuidv7()}`, promotionId, idempotencyKey, visitor, now); // 执行当前业务步骤
    const changed = db // 常量 changed：保存固定配置或一次性派生值
      .prepare('UPDATE promotions SET click_count = click_count + 1, updated_at = ? WHERE id = ?') // 执行当前业务步骤
      .run(now, promotionId); // 执行当前业务步骤
    if (changed.changes === 0) throw new AppError('NOT_FOUND', '推广计划不存在'); // 条件分支：按判断结果选择后续处理路径
    const row = db.prepare('SELECT click_count FROM promotions WHERE id = ?').get(promotionId) as { click_count: number }; // 常量 row：保存固定配置或一次性派生值
    return row.click_count; // 返回当前函数的处理结果
  }); // 代码块结束
  return { deduped: false, clickCount: tx() }; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 转化滑动窗口频控：窗口长度复用点击窗口配置，上限走 MIM_CONTENT_CONVERSION_MAX，缺省 600 秒内 10 次。
 * 审计表为 promotion_conversions，口径与点击频控一致。
 */
export function checkConversionRateLimit(
  db: Db, // 对象字段 db：记录一项配置或数据
  env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
  promotionId: string, // 对象字段 promotionId：记录一项配置或数据
  visitor: string, // 对象字段 visitor：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): ClickRateViolation | null { // 执行当前业务步骤
  const windowSeconds = envInt(env, 'MIM_CONTENT_CLICK_WINDOW_SECONDS', 600); // 常量 windowSeconds：保存固定配置或一次性派生值
  const max = envInt(env, 'MIM_CONTENT_CONVERSION_MAX', 10); // 常量 max：保存固定配置或一次性派生值
  if (max <= 0) return null; // 显式配 0 表示关闭频控（不建议生产关闭）
  const windowStart = new Date(Date.parse(now) - windowSeconds * 1000).toISOString(); // 常量 windowStart：保存固定配置或一次性派生值
  const recent = db // 常量 recent：保存固定配置或一次性派生值
    .prepare('SELECT COUNT(*) AS count FROM promotion_conversions WHERE promotion_id = ? AND visitor_hash = ? AND created_at > ?') // 执行当前业务步骤
    .get(promotionId, visitor, windowStart) as { count: number }; // 注册 GET 路由 / 中间件处理器
  if (recent.count >= max) { // 条件分支：按判断结果选择后续处理路径
    return { retryAfter: windowSeconds }; // 返回当前函数的处理结果
  } // 代码块结束
  return null; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 入账一次转化：幂等键命中已有记录则回放不重复计数；否则落审计行并自增 conversion_count。
 * 调用方须先完成 assertClickable 与 checkConversionRateLimit。
 * @returns deduped=true 表示命中幂等回放；conversionCount 为入账后的最新累计转化数。
 */
export function recordConversion(
  db: Db, // 对象字段 db：记录一项配置或数据
  promotionId: string, // 对象字段 promotionId：记录一项配置或数据
  idempotencyKey: string | null, // 对象字段 idempotencyKey：记录一项配置或数据
  visitor: string, // 对象字段 visitor：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): { deduped: boolean; conversionCount: number } { // 执行当前业务步骤
  if (idempotencyKey) { // 条件分支：按判断结果选择后续处理路径
    const existing = db // 常量 existing：保存固定配置或一次性派生值
      .prepare('SELECT 1 AS hit FROM promotion_conversions WHERE promotion_id = ? AND idempotency_key = ?') // 执行当前业务步骤
      .get(promotionId, idempotencyKey); // 注册 GET 路由 / 中间件处理器
    if (existing) { // 条件分支：按判断结果选择后续处理路径
      const row = db.prepare('SELECT conversion_count FROM promotions WHERE id = ?').get(promotionId) as { conversion_count: number }; // 常量 row：保存固定配置或一次性派生值
      return { deduped: true, conversionCount: row.conversion_count }; // 返回当前函数的处理结果
    } // 代码块结束
  } // 代码块结束

  const tx = db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
    db.prepare( // 执行当前业务步骤
      `INSERT INTO promotion_conversions (id, promotion_id, idempotency_key, visitor_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`conv-${uuidv7()}`, promotionId, idempotencyKey, visitor, now); // 执行当前业务步骤
    const changed = db // 常量 changed：保存固定配置或一次性派生值
      .prepare('UPDATE promotions SET conversion_count = conversion_count + 1, updated_at = ? WHERE id = ?') // 执行当前业务步骤
      .run(now, promotionId); // 执行当前业务步骤
    if (changed.changes === 0) throw new AppError('NOT_FOUND', '推广计划不存在'); // 条件分支：按判断结果选择后续处理路径
    const row = db.prepare('SELECT conversion_count FROM promotions WHERE id = ?').get(promotionId) as { conversion_count: number }; // 常量 row：保存固定配置或一次性派生值
    return row.conversion_count; // 返回当前函数的处理结果
  }); // 代码块结束
  return { deduped: false, conversionCount: tx() }; // 返回当前函数的处理结果
} // 代码块结束
