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
}

/** 代码内置兜底默认值：板块未配置、环境变量也未给定时使用 */
export const DEFAULT_QUOTA = { windowMinutes: 10, windowMax: 5, dailyMax: 20, totalMax: 200 } as const;

/** 读取整型环境变量；非法 / 缺失时回落兜底值。 */
function envInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** 板块行（频控相关列子集）；缺失列按 0 处理，兼容旧库补列前的读取路径。 */
export interface BoardQuotaRow {
  rate_window_minutes?: number | null;
  rate_window_max?: number | null;
  daily_max?: number | null;
  total_max?: number | null;
}

/** 解析板块生效配额：板块配置优先，0 表示回落到环境变量 / 内置默认。 */
export function resolveQuota(env: Record<string, string | undefined>, board: BoardQuotaRow): BoardQuota {
  return {
    windowMinutes:
      (board.rate_window_minutes ?? 0) > 0
        ? (board.rate_window_minutes as number)
        : envInt(env, 'MIM_COMMUNITY_WINDOW_MINUTES', DEFAULT_QUOTA.windowMinutes),
    windowMax:
      (board.rate_window_max ?? 0) > 0
        ? (board.rate_window_max as number)
        : envInt(env, 'MIM_COMMUNITY_WINDOW_MAX', DEFAULT_QUOTA.windowMax),
    dailyMax:
      (board.daily_max ?? 0) > 0 ? (board.daily_max as number) : envInt(env, 'MIM_COMMUNITY_DAILY_MAX', DEFAULT_QUOTA.dailyMax),
    totalMax:
      (board.total_max ?? 0) > 0 ? (board.total_max as number) : envInt(env, 'MIM_COMMUNITY_TOTAL_MAX', DEFAULT_QUOTA.totalMax),
  };
}

/** 频控违规描述：reason 供前端分支，retry_after 为建议退避秒数。 */
export interface RateViolation {
  reason: 'WINDOW' | 'DAILY' | 'TOTAL';
  message: string;
  retryAfter: number;
}

/** 距下一个 UTC 自然日零点的秒数，用于每日配额的 Retry-After。 */
function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * 校验当前用户在指定板块是否还能发帖。
 * @returns null 表示放行；否则返回违规原因与 Retry-After 秒数（路由据此置头并抛 429）。
 */
export function checkPostRateLimit(
  db: Db,
  env: Record<string, string | undefined>,
  userId: string,
  boardId: string,
  board: BoardQuotaRow,
): RateViolation | null {
  const quota = resolveQuota(env, board);
  const now = new Date();
  const nowIso = now.toISOString();

  // 1) 滑动窗口：统计窗口内帖数，并取最早一条的时间戳计算精确退避。
  const windowMs = quota.windowMinutes * 60_000;
  const windowStart = new Date(now.getTime() - windowMs).toISOString();
  const recent = db
    .prepare('SELECT COUNT(*) AS count, MIN(created_at) AS earliest FROM community_threads WHERE author_id = ? AND board_id = ? AND created_at > ?')
    .get(userId, boardId, windowStart) as { count: number; earliest: string | null };
  if (quota.windowMax > 0 && recent.count >= quota.windowMax) {
    const earliest = recent.earliest ? Date.parse(recent.earliest) : NaN;
    const retryAfter = Number.isFinite(earliest) ? Math.max(1, Math.ceil((earliest + windowMs - now.getTime()) / 1000)) : quota.windowMinutes * 60;
    return { reason: 'WINDOW', message: `发帖过于频繁，请 ${retryAfter} 秒后再试（${quota.windowMinutes} 分钟内最多 ${quota.windowMax} 帖）`, retryAfter };
  }

  // 2) 每日配额：按 UTC 自然日统计。
  const day = nowIso.slice(0, 10);
  const today = db
    .prepare("SELECT COUNT(*) AS count FROM community_threads WHERE author_id = ? AND board_id = ? AND substr(created_at, 1, 10) = ?")
    .get(userId, boardId, day) as { count: number };
  if (quota.dailyMax > 0 && today.count >= quota.dailyMax) {
    return { reason: 'DAILY', message: `今日发帖已达上限（${quota.dailyMax} 帖），明天再来`, retryAfter: secondsToUtcMidnight(now) };
  }

  // 3) 累计配额：历史总量。
  const total = db
    .prepare('SELECT COUNT(*) AS count FROM community_threads WHERE author_id = ? AND board_id = ?')
    .get(userId, boardId) as { count: number };
  if (quota.totalMax > 0 && total.count >= quota.totalMax) {
    return { reason: 'TOTAL', message: `在本板块的累计发帖已达上限（${quota.totalMax} 帖）`, retryAfter: 86_400 };
  }

  return null; // 放行
}
