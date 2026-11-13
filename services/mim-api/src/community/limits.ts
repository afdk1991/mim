/**
 * 社区三期：发帖频控与配额（按 用户 + 板块）。
 *
 * 三层限制，任一触发即 429 + Retry-After：
 *   1. 滑动窗口：最近 N 分钟内最多 M 帖；
 *   2. 每日配额：自然日（UTC）内最多 D 帖；
 *   3. 累计配额：历史总量最多 T 帖。
 *
 * 配额口径：板块行配置 > 环境变量全局默认 > 代码内置默认；板块列填 0 表示回落全局默认。
 * 本模块只做判定与秒数计算，不直接写响应；路由拿到违规结果后自置 Retry-After 头再抛 RATE_LIMITED。
 */

import type { Db } from '../types.js'; // 数据库连接类型

/** 板块配额解析结果 */
export interface BoardQuota {
  /** 滑动窗口长度（分钟） */
  windowMinutes: number;
  /** 滑动窗口内最大帖数 */
  windowMax: number;
  /** 每日最大帖数 */
  dailyMax: number;
  /** 累计最大帖数 */
  totalMax: number;
} // 代码块结束

/** 代码内置兜底默认值：板块未配置、环境变量也未给定时使用 */
export const DEFAULT_QUOTA = { windowMinutes: 10, windowMax: 5, dailyMax: 20, totalMax: 200 } as const;

/** 读取整型环境变量；非法 / 缺失时回落兜底值。 */
function envInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]?.trim(); // 常量 raw：保存固定配置或一次性派生值
  if (!raw) return fallback; // 条件分支：按判断结果选择后续处理路径
  const parsed = Number.parseInt(raw, 10); // 常量 parsed：保存固定配置或一次性派生值
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; // 返回当前函数的处理结果
} // 代码块结束

/** 板块行（频控相关列子集）；缺失列按 0 处理，兼容旧库补列前的读取路径。 */
export interface BoardQuotaRow {
  rate_window_minutes?: number | null; // 执行当前业务步骤
  rate_window_max?: number | null; // 执行当前业务步骤
  daily_max?: number | null; // 执行当前业务步骤
  total_max?: number | null; // 执行当前业务步骤
} // 代码块结束

/** 解析板块生效配额：板块配置优先，0 表示回落到环境变量 / 内置默认。 */
export function resolveQuota(env: Record<string, string | undefined>, board: BoardQuotaRow): BoardQuota {
  return { // 返回当前函数的处理结果
    windowMinutes: // 对象字段 windowMinutes：记录一项配置或数据
      (board.rate_window_minutes ?? 0) > 0 // 执行当前业务步骤
        ? (board.rate_window_minutes as number) // 执行当前业务步骤
        : envInt(env, 'MIM_COMMUNITY_WINDOW_MINUTES', DEFAULT_QUOTA.windowMinutes), // 执行当前业务步骤
    windowMax: // 对象字段 windowMax：记录一项配置或数据
      (board.rate_window_max ?? 0) > 0 // 执行当前业务步骤
        ? (board.rate_window_max as number) // 执行当前业务步骤
        : envInt(env, 'MIM_COMMUNITY_WINDOW_MAX', DEFAULT_QUOTA.windowMax), // 执行当前业务步骤
    dailyMax: // 对象字段 dailyMax：记录一项配置或数据
      (board.daily_max ?? 0) > 0 ? (board.daily_max as number) : envInt(env, 'MIM_COMMUNITY_DAILY_MAX', DEFAULT_QUOTA.dailyMax), // 执行当前业务步骤
    totalMax: // 对象字段 totalMax：记录一项配置或数据
      (board.total_max ?? 0) > 0 ? (board.total_max as number) : envInt(env, 'MIM_COMMUNITY_TOTAL_MAX', DEFAULT_QUOTA.totalMax), // 执行当前业务步骤
  }; // 代码块结束
} // 代码块结束

/** 频控违规描述：reason 供前端分支，retry_after 为建议退避秒数。 */
export interface RateViolation {
  reason: 'WINDOW' | 'DAILY' | 'TOTAL'; // 对象字段 reason：记录一项配置或数据
  message: string; // 对象字段 message：记录一项配置或数据
  retryAfter: number; // 对象字段 retryAfter：记录一项配置或数据
} // 代码块结束

/** 距下一个 UTC 自然日零点的秒数，用于每日配额的 Retry-After。 */
function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0); // 常量 next：保存固定配置或一次性派生值
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000)); // 返回当前函数的处理结果
} // 代码块结束

/**
 * 校验当前用户在指定板块是否还能发帖。
 * @returns null 表示放行；否则返回违规原因与 Retry-After 秒数（路由据此置头并抛 429）。
 */
export function checkPostRateLimit(
  db: Db, // 对象字段 db：记录一项配置或数据
  env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
  userId: string, // 对象字段 userId：记录一项配置或数据
  boardId: string, // 对象字段 boardId：记录一项配置或数据
  board: BoardQuotaRow, // 对象字段 board：记录一项配置或数据
): RateViolation | null { // 执行当前业务步骤
  const quota = resolveQuota(env, board); // 常量 quota：保存固定配置或一次性派生值
  const now = new Date(); // 常量 now：保存固定配置或一次性派生值
  const nowIso = now.toISOString(); // 常量 nowIso：保存固定配置或一次性派生值

  // 1) 滑动窗口：统计窗口内帖数，并取最早一条的时间戳计算精确退避。
  const windowMs = quota.windowMinutes * 60_000;
  const windowStart = new Date(now.getTime() - windowMs).toISOString(); // 常量 windowStart：保存固定配置或一次性派生值
  const recent = db // 常量 recent：保存固定配置或一次性派生值
    .prepare('SELECT COUNT(*) AS count, MIN(created_at) AS earliest FROM community_threads WHERE author_id = ? AND board_id = ? AND created_at > ?') // 执行当前业务步骤
    .get(userId, boardId, windowStart) as { count: number; earliest: string | null }; // 注册 GET 路由 / 中间件处理器
  if (quota.windowMax > 0 && recent.count >= quota.windowMax) { // 条件分支：按判断结果选择后续处理路径
    const earliest = recent.earliest ? Date.parse(recent.earliest) : NaN; // 常量 earliest：保存固定配置或一次性派生值
    const retryAfter = Number.isFinite(earliest) ? Math.max(1, Math.ceil((earliest + windowMs - now.getTime()) / 1000)) : quota.windowMinutes * 60; // 常量 retryAfter：保存固定配置或一次性派生值
    return { reason: 'WINDOW', message: `发帖过于频繁，请 ${retryAfter} 秒后再试（${quota.windowMinutes} 分钟内最多 ${quota.windowMax} 帖）`, retryAfter }; // 返回当前函数的处理结果
  } // 代码块结束

  // 2) 每日配额：按 UTC 自然日统计。
  const day = nowIso.slice(0, 10);
  const today = db // 常量 today：保存固定配置或一次性派生值
    .prepare("SELECT COUNT(*) AS count FROM community_threads WHERE author_id = ? AND board_id = ? AND substr(created_at, 1, 10) = ?") // 执行当前业务步骤
    .get(userId, boardId, day) as { count: number }; // 注册 GET 路由 / 中间件处理器
  if (quota.dailyMax > 0 && today.count >= quota.dailyMax) { // 条件分支：按判断结果选择后续处理路径
    return { reason: 'DAILY', message: `今日发帖已达上限（${quota.dailyMax} 帖），明天再来`, retryAfter: secondsToUtcMidnight(now) }; // 返回当前函数的处理结果
  } // 代码块结束

  // 3) 累计配额：历史总量。
  const total = db
    .prepare('SELECT COUNT(*) AS count FROM community_threads WHERE author_id = ? AND board_id = ?') // 执行当前业务步骤
    .get(userId, boardId) as { count: number }; // 注册 GET 路由 / 中间件处理器
  if (quota.totalMax > 0 && total.count >= quota.totalMax) { // 条件分支：按判断结果选择后续处理路径
    return { reason: 'TOTAL', message: `在本板块的累计发帖已达上限（${quota.totalMax} 帖）`, retryAfter: 86_400 }; // 返回当前函数的处理结果
  } // 代码块结束

  return null; // 放行
} // 代码块结束
