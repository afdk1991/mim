/**
 * 社区激励链服务：签到 → 积分 → 等级 → 徽章。
 *
 * 设计口径（与既有钱包复用，不另造余额）：
 *   · 积分余额 / 流水一律落到既有 wallets + wallet_transactions；
 *   · 「累计积分」单独记 user_growth.lifetime_points，只统计正向获得，消费与转账不影响等级；
 *   · 签到、发积分、加累计积分、算等级、授徽章在同一个事务内完成，避免签了没发或发了没签；
 *   · 自然日按 growth_config.timezone（默认 Asia/Shanghai）换天，而不是 UTC 0 点。
 */

import { randomUUID } from 'node:crypto'; // 钱包流水的历史写法用 wt- 前缀 + UUID
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 主键生成
import type { Db } from '../types.js'; // 数据库连接类型

/** 签到规则：基础分 + 连续加成（按天递增、封顶） */
export interface CheckinRules {
  base_points: number; // 每日基础积分
  streak_bonus_per_day: number; // 连续每多一天增加的积分
  streak_bonus_cap: number; // 连续加成最多累计多少天
}

/** 激励链完整配置 */
export interface GrowthConfig {
  timezone: string; // 换天时区（IANA 名称）
  checkin: CheckinRules; // 签到发分规则
}

/** 默认配置：与 85-growth-chain.sql 的种子保持一致 */
export const DEFAULT_GROWTH_CONFIG: GrowthConfig = {
  timezone: 'Asia/Shanghai', // 站点用户主要在东八区
  checkin: { base_points: 5, streak_bonus_per_day: 1, streak_bonus_cap: 10 },
};

/** 等级行（对外的结构化形态） */
export interface GrowthLevel {
  level: number; // 等级序号，从 1 起
  name: string; // 等级名称
  min_points: number; // 进入该等级所需累计积分
  perks: string[]; // 权益文案
}

/** 等级表原始行 */
interface LevelRow {
  level: number;
  name: string;
  min_points: number;
  perks: string;
}

/** 徽章条件类型：与表 CHECK 约束一一对应 */
export type BadgeConditionType = 'checkin_streak' | 'level' | 'post_count' | 'points';

/** 徽章定义（对外的结构化形态） */
export interface BadgeDefinition {
  code: string; // 徽章编码
  name: string; // 徽章名称
  description: string; // 说明文案
  icon: string; // 图标标识（前端映射）
  condition_type: BadgeConditionType; // 条件类型
  condition_value: number; // 条件阈值
  active: boolean; // 是否启用
  sort_order: number; // 展示排序
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
}

/** 徽章定义原始行 */
interface BadgeRow {
  code: string;
  name: string;
  description: string;
  icon: string;
  condition_type: BadgeConditionType;
  condition_value: number;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 用户成长档案 */
export interface GrowthProfile {
  lifetime_points: number; // 累计获得积分（只增不减）
  level: number; // 当前等级
}

/** 签到执行结果 */
export interface CheckinResult {
  checked_in_today: true; // 执行后必然处于「今日已签」状态
  first_today: boolean; // 是否今天第一次签（用于区分首次与重复）
  already_checked_in: boolean; // 是否重复签到
  day: string; // 本次签到所属自然日
  points_awarded: number; // 本次实际发放积分（重复签为 0）
  points_balance: number; // 发放后的积分余额
  streak: number; // 连续签到天数
  lifetime_points: number; // 累计获得积分
  level: GrowthLevel; // 当前等级
  next_level: GrowthLevel | null; // 下一级；已满级为 null
  level_up: { from: number; to: number } | null; // 本次是否升级
  badges_awarded: string[]; // 本次新授予的徽章编码
}

/** 积分流水分页结果 */
export interface PointsLedger {
  balance: number; // 当前积分余额
  earned_total: number; // 累计获得
  spent_total: number; // 累计支出（绝对值）
  total: number; // 匹配流水总条数
  limit: number; // 本次分页大小
  offset: number; // 本次偏移
  items: Array<{ id: string; points: number; note: string; ref_type: string | null; ref_id: string | null; created_at: string }>; // 流水明细
}

/** 等级进度 */
export interface LevelProgress {
  level: GrowthLevel; // 当前等级
  next_level: GrowthLevel | null; // 下一级
  lifetime_points: number; // 累计获得积分
  points_to_next: number; // 距下一级还差多少（满级为 0）
  progress_percent: number; // 当前等级内的进度百分比（满级 100）
}

/** 我的徽章视图 */
export interface MyBadge extends BadgeDefinition {
  awarded: boolean; // 是否已获得
  awarded_at: string | null; // 授予时间
  source: 'auto' | 'admin' | null; // 授予来源
  progress: { current: number; target: number }; // 条件进度
}

/** 管理端写入等级时的入参 */
export interface LevelInput {
  level: number;
  name: string;
  min_points: number;
  perks: string[];
}

/** 管理端写入徽章时的入参 */
export interface BadgeInput {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  condition_type: BadgeConditionType;
  condition_value: number;
  active?: boolean;
  sort_order?: number;
}

/** 安全的 JSON 解析：坏数据不阻断主流程，回落默认值 */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback; // 空值直接回落
  try {
    return JSON.parse(raw) as T; // 正常解析
  } catch {
    return fallback; // 坏数据不抛错
  }
}

/** 整数钳制：防止后台误配出负数或异常大值 */
function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min; // 非数字回落下限
  return Math.min(max, Math.max(min, Math.trunc(value))); // 截断并夹到区间
}

/** 校验 IANA 时区；非法时区会抛 RangeError */
export function assertTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }); // 构造成功即视为合法
    return timezone; // 合法原样返回
  } catch {
    throw new AppError('VALIDATION_FAILED', `无效的时区：${timezone}`); // 非法时区统一 400
  }
}

/** 把 ISO 时间换算成业务时区下的自然日 YYYY-MM-DD */
export function businessDay(iso: string, timezone: string): string {
  const date = new Date(iso); // 解析入参时间
  if (Number.isNaN(date.getTime())) throw new AppError('VALIDATION_FAILED', 'invalid time'); // 非法时间直接拒绝
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date); // 按目标时区拆出年月日
  const year = parts.find((part) => part.type === 'year')?.value; // 年
  const month = parts.find((part) => part.type === 'month')?.value; // 月
  const day = parts.find((part) => part.type === 'day')?.value; // 日
  if (!year || !month || !day) throw new AppError('VALIDATION_FAILED', 'invalid timezone'); // 防御性兜底
  return `${year}-${month}-${day}`; // 统一成 YYYY-MM-DD
}

/** 自然日加减：只做字符串日期运算，避免时区二次偏移 */
export function shiftDay(day: string, delta: number): string {
  const base = new Date(`${day}T00:00:00.000Z`); // 固定按 UTC 解析日期本身
  base.setUTCDate(base.getUTCDate() + delta); // 按天偏移
  return base.toISOString().slice(0, 10); // 取回 YYYY-MM-DD
}

/** 读取配置：缺行或坏数据回落默认值，保证读不到配置时接口不报错 */
export function getGrowthConfig(db: Db): GrowthConfig {
  const row = db.prepare("SELECT config FROM growth_config WHERE id = 'default'").get() as { config: string } | undefined;
  if (!row) return { ...DEFAULT_GROWTH_CONFIG, checkin: { ...DEFAULT_GROWTH_CONFIG.checkin } }; // 缺行回落
  const parsed = parseJson<Partial<GrowthConfig>>(row.config, {}); // 解析 JSON
  const checkin = (parsed.checkin ?? {}) as Partial<CheckinRules>; // 签到规则
  return {
    timezone: typeof parsed.timezone === 'string' ? parsed.timezone : DEFAULT_GROWTH_CONFIG.timezone, // 时区
    checkin: {
      base_points: clampInt(checkin.base_points ?? DEFAULT_GROWTH_CONFIG.checkin.base_points, 0, 1000), // 基础分
      streak_bonus_per_day: clampInt(
        checkin.streak_bonus_per_day ?? DEFAULT_GROWTH_CONFIG.checkin.streak_bonus_per_day,
        0,
        100,
      ), // 每日加成
      streak_bonus_cap: clampInt(checkin.streak_bonus_cap ?? DEFAULT_GROWTH_CONFIG.checkin.streak_bonus_cap, 0, 365), // 加成封顶
    },
  };
}

/** 保存配置：先校验再落库，返回落库后的规范化结果 */
export function saveGrowthConfig(
  db: Db,
  patch: { timezone?: string; checkin?: Partial<CheckinRules> },
  now: string,
): GrowthConfig {
  const current = getGrowthConfig(db); // 以现值为底合并
  const timezone = assertTimezone(patch.timezone ?? current.timezone); // 时区必须合法
  const next: GrowthConfig = {
    timezone,
    checkin: {
      base_points: clampInt(patch.checkin?.base_points ?? current.checkin.base_points, 0, 1000),
      streak_bonus_per_day: clampInt(
        patch.checkin?.streak_bonus_per_day ?? current.checkin.streak_bonus_per_day,
        0,
        100,
      ),
      streak_bonus_cap: clampInt(patch.checkin?.streak_bonus_cap ?? current.checkin.streak_bonus_cap, 0, 365),
    },
  };
  db.prepare(
    `INSERT INTO growth_config (id, config, updated_at) VALUES ('default', ?, ?)
     ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(next), now); // upsert 单行配置
  return next; // 交回规范化结果
}

/** 等级行转结构化形态（perks 做容错解析） */
function toLevel(row: LevelRow): GrowthLevel {
  const perks = parseJson<unknown>(row.perks, []); // 坏 JSON 回落空数组
  return {
    level: row.level,
    name: row.name,
    min_points: row.min_points,
    perks: Array.isArray(perks) ? perks.filter((item): item is string => typeof item === 'string') : [],
  };
}

/** 读取全部等级（按等级升序） */
export function listLevels(db: Db): GrowthLevel[] {
  const rows = db
    .prepare('SELECT level, name, min_points, perks FROM growth_levels ORDER BY level ASC')
    .all() as LevelRow[];
  return rows.map(toLevel); // 逐行结构化
}

/** 兜底等级：等级表被清空时也不能让接口白屏 */
const FALLBACK_LEVEL: GrowthLevel = { level: 1, name: '新人', min_points: 0, perks: [] };

/** 按累计积分解析当前等级与下一级 */
export function resolveLevel(levels: GrowthLevel[], lifetimePoints: number): { current: GrowthLevel; next: GrowthLevel | null } {
  if (levels.length === 0) return { current: FALLBACK_LEVEL, next: null }; // 无配置时兜底
  let current = levels[0]; // 最低等级
  for (const level of levels) {
    if (lifetimePoints >= level.min_points) current = level; // 命中更高的门槛
  }
  const next = levels.find((level) => level.min_points > lifetimePoints) ?? null; // 第一个未达门槛
  return { current, next }; // 交回当前与下一级
}

/** 计算某次签到应发积分：基础分 + 连续加成（封顶） */
export function checkinPoints(rules: CheckinRules, streak: number): number {
  const extraDays = Math.max(0, Math.min(streak - 1, rules.streak_bonus_cap)); // 连续加成天数
  return rules.base_points + extraDays * rules.streak_bonus_per_day; // 总分
}

/** 确保钱包行存在：与社区既有口径一致，新钱包开箱 100 分并写一条见面礼流水 */
function ensureWalletRow(db: Db, userId: string, now: string): number {
  const existing = db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number } | undefined;
  if (existing) return existing.points; // 已有钱包直接返回余额
  const insertWallet = db.transaction(() => {
    db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now);
    db.prepare(
      `INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', 100, '新用户见面礼', ?)`,
    ).run(`wt-${randomUUID()}`, userId, now);
  });
  insertWallet(); // 与现有 ensureWallet 行为保持一致
  return 100; // 见面礼积分
}

/** 确保成长档案存在；缺失时按历史正向流水回填累计积分，避免老用户等级从 0 重来 */
export function ensureGrowthProfile(db: Db, userId: string, now: string): GrowthProfile {
  const existing = db
    .prepare('SELECT lifetime_points, level FROM user_growth WHERE user_id = ?')
    .get(userId) as GrowthProfile | undefined;
  if (existing) return existing; // 已有档案直接返回
  const earned = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS total FROM wallet_transactions WHERE user_id = ? AND points > 0')
    .get(userId) as { total: number }; // 历史正向积分
  const levels = listLevels(db); // 当前等级门槛
  const level = resolveLevel(levels, earned.total).current.level; // 按门槛算出等级
  db.prepare('INSERT OR IGNORE INTO user_growth (user_id, lifetime_points, level, updated_at) VALUES (?, ?, ?, ?)').run(
    userId,
    earned.total,
    level,
    now,
  ); // 幂等插入
  return { lifetime_points: earned.total, level }; // 交回新档案
}

/** 把档案等级校准到累计积分对应的门槛；返回校准前后等级 */
function syncLevel(db: Db, userId: string, now: string): { from: number; to: number; lifetime: number } {
  const profile = ensureGrowthProfile(db, userId, now); // 先确保档案
  const { current } = resolveLevel(listLevels(db), profile.lifetime_points); // 按当前门槛算
  if (current.level !== profile.level) {
    db.prepare('UPDATE user_growth SET level = ?, updated_at = ? WHERE user_id = ?').run(current.level, now, userId); // 只在变化时写
  }
  return { from: profile.level, to: current.level, lifetime: profile.lifetime_points }; // 交回变化信息
}

/** 发放积分：写钱包余额 + 流水 + 累计积分 + 等级；调用方负责事务边界 */
export function grantPoints(
  db: Db,
  input: { userId: string; points: number; note: string; refType?: string | null; refId?: string | null; now: string },
): { balance: number; lifetime: number; level: number } {
  if (!Number.isInteger(input.points) || input.points <= 0) {
    throw new AppError('VALIDATION_FAILED', '发放积分必须为正整数'); // 只允许正向发放
  }
  ensureWalletRow(db, input.userId, input.now); // 钱包不存在时补行
  db.prepare('UPDATE wallets SET points = points + ?, updated_at = ? WHERE user_id = ?').run(
    input.points,
    input.now,
    input.userId,
  ); // 余额入账
  db.prepare(
    `INSERT INTO wallet_transactions (id, user_id, kind, points, ref_type, ref_id, note, created_at)
     VALUES (?, ?, 'points', ?, ?, ?, ?, ?)`,
  ).run(uuidv7(), input.userId, input.points, input.refType ?? null, input.refId ?? null, input.note, input.now); // 记流水，可追溯到来源
  ensureGrowthProfile(db, input.userId, input.now); // 确保累计积分有档案行
  db.prepare('UPDATE user_growth SET lifetime_points = lifetime_points + ?, updated_at = ? WHERE user_id = ?').run(
    input.points,
    input.now,
    input.userId,
  ); // 累计积分只增不减
  const synced = syncLevel(db, input.userId, input.now); // 顺手校准等级
  const balance = db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(input.userId) as { points: number };
  return { balance: balance.points, lifetime: synced.lifetime, level: synced.to }; // 交回入账结果
}

/** 读取用户钱包余额；无钱包按 0 返回（只读，不建档） */
function walletBalance(db: Db, userId: string): number {
  const row = db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number } | undefined;
  return row?.points ?? 0; // 没有钱包视为 0
}

/** 统计截至某天（含）的连续签到天数；逐日回溯，兼容旧数据没有 streak 快照的情况 */
export function streakEndingAt(db: Db, userId: string, day: string): number {
  let cursor = day; // 从指定日往前
  let count = 0; // 连续天数
  const stmt = db.prepare('SELECT streak FROM checkins WHERE user_id = ? AND day = ?');
  while (count < 4000) {
    const row = stmt.get(userId, cursor) as { streak: number } | undefined;
    if (!row) break; // 断签即停
    count += 1; // 命中一天
    cursor = shiftDay(cursor, -1); // 继续看前一天
  }
  return count; // 交回连续天数
}

/** 最近一次签到的自然日；从未签到返回 null */
function latestCheckinDay(db: Db, userId: string): string | null {
  const row = db.prepare('SELECT MAX(day) AS day FROM checkins WHERE user_id = ?').get(userId) as { day: string | null };
  return row.day; // 无记录自然为 null
}

/**
 * 当前连续签到天数：只有「今天」或「昨天」签过才算连续存活，否则视为已断签归零。
 * 断签后再签到时 performCheckin 会从 1 重新累计。
 */
export function currentStreak(db: Db, userId: string, today: string): number {
  const latest = latestCheckinDay(db, userId);
  if (!latest) return 0; // 从未签到
  if (latest !== today && latest !== shiftDay(today, -1)) return 0; // 最近一次既非今天也非昨天 = 已断签
  return streakEndingAt(db, userId, latest); // 以最近一次为终点回溯连续天数
}

/** 统计已发布主题数（徽章条件用） */
function publishedThreadCount(db: Db, userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM community_threads WHERE author_id = ? AND status = 'published'")
    .get(userId) as { count: number };
  return row.count; // 主题数
}

/** 徽章条件进度：统一算一次，供批量授予与展示复用 */
function badgeProgress(
  db: Db,
  userId: string,
  lifetimePoints: number,
  level: number,
  today: string,
  streak?: number,
): Record<BadgeConditionType, number> {
  const threadCount = publishedThreadCount(db, userId); // 发帖数
  return {
    checkin_streak: streak ?? currentStreak(db, userId, today), // 连续签到
    level, // 等级
    post_count: threadCount, // 发帖数
    points: lifetimePoints, // 累计积分
  };
}

/** 按当前条件评估并授予徽章；返回本次新授予的编码（幂等，重复不重复发） */
export function evaluateBadges(
  db: Db,
  userId: string,
  opts: { now: string; day?: string; streak?: number },
): string[] {
  const profile = ensureGrowthProfile(db, userId, opts.now); // 累计积分与等级
  const day = opts.day ?? businessDay(opts.now, getGrowthConfig(db).timezone); // 业务自然日
  const progress = badgeProgress(db, userId, profile.lifetime_points, profile.level, day, opts.streak); // 条件进度
  const badges = db
    .prepare(
      `SELECT code, condition_type, condition_value FROM growth_badges WHERE active = 1`,
    )
    .all() as Array<{ code: string; condition_type: BadgeConditionType; condition_value: number }>;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user_badges (id, user_id, badge_code, source, awarded_at) VALUES (?, ?, ?, 'auto', ?)`,
  );
  const awarded: string[] = []; // 本次新授予
  for (const badge of badges) {
    if (progress[badge.condition_type] < badge.condition_value) continue; // 未达条件跳过
    const result = insert.run(uuidv7(), userId, badge.code, opts.now); // 幂等授予
    if (result.changes > 0) awarded.push(badge.code); // 只有真正插入才算新授予
  }
  return awarded; // 交回新授予编码
}

/** 签到状态：今日是否已签、连续天数、今日/下次可得分、余额与规则 */
export function getCheckinStatus(db: Db, userId: string, now: string): {
  day: string;
  timezone: string;
  checked_in_today: boolean;
  today_points: number;
  streak: number;
  next_checkin_points: number;
  points_balance: number;
  rules: CheckinRules;
} {
  const config = getGrowthConfig(db); // 规则
  const day = businessDay(now, config.timezone); // 业务自然日
  const today = db.prepare('SELECT points, streak FROM checkins WHERE user_id = ? AND day = ?').get(userId, day) as
    | { points: number; streak: number }
    | undefined; // 今日签到行
  const streak = currentStreak(db, userId, day); // 当前连续天数（断签归零）
  return {
    day,
    timezone: config.timezone,
    checked_in_today: Boolean(today), // 今日是否已签
    today_points: today?.points ?? 0, // 今日已发积分
    streak,
    next_checkin_points: checkinPoints(config.checkin, streak + 1), // 下一次签到（今天没签即今天）可得分
    points_balance: walletBalance(db, userId), // 积分余额
    rules: config.checkin, // 规则回显，便于前端展示
  };
}

/**
 * 执行签到：签到记录 + 发积分 + 累计积分 + 等级 + 徽章在同一个事务内完成。
 * 重复签到不报错，返回 already_checked_in=true 且 points_awarded=0，便于前端区分首次与重复。
 */
export function performCheckin(db: Db, userId: string, now: string): CheckinResult {
  const config = getGrowthConfig(db); // 规则
  const day = businessDay(now, config.timezone); // 业务自然日
  const run = db.transaction((): CheckinResult => {
    const existing = db.prepare('SELECT points, streak FROM checkins WHERE user_id = ? AND day = ?').get(userId, day) as
      | { points: number; streak: number }
      | undefined;
    const levelNow = resolveLevel(listLevels(db), ensureGrowthProfile(db, userId, now).lifetime_points); // 当前等级（发分前）
    if (existing) {
      // 重复签到：只回显状态，绝不重复发分；连续天数按实际记录回溯，避免旧 streak 快照失真
      const streak = streakEndingAt(db, userId, day);
      const profile = ensureGrowthProfile(db, userId, now);
      return {
        checked_in_today: true,
        first_today: false,
        already_checked_in: true,
        day,
        points_awarded: 0,
        points_balance: walletBalance(db, userId),
        streak,
        lifetime_points: profile.lifetime_points,
        level: levelNow.current,
        next_level: levelNow.next,
        level_up: null,
        badges_awarded: [],
      };
    }
    const streak = streakEndingAt(db, userId, shiftDay(day, -1)) + 1; // 昨天有签到则累加，否则从 1 重来
    const points = checkinPoints(config.checkin, streak); // 本次应发积分
    const checkinId = uuidv7(); // 签到主键
    db.prepare('INSERT INTO checkins (id, user_id, day, points, streak, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      checkinId,
      userId,
      day,
      points,
      streak,
      now,
    ); // 先落签到记录
    const granted = grantPoints(db, {
      userId,
      points,
      note: `每日签到 · 连续 ${streak} 天`,
      refType: 'checkin',
      refId: checkinId,
      now,
    }); // 同一事务内发分并入账
    const levelAfter = resolveLevel(listLevels(db), granted.lifetime); // 发分后的等级
    const badges = evaluateBadges(db, userId, { now, day, streak }); // 条件满足自动授予
    return {
      checked_in_today: true,
      first_today: true,
      already_checked_in: false,
      day,
      points_awarded: points,
      points_balance: granted.balance,
      streak,
      lifetime_points: granted.lifetime,
      level: levelAfter.current,
      next_level: levelAfter.next,
      level_up: levelAfter.current.level > levelNow.current.level ? { from: levelNow.current.level, to: levelAfter.current.level } : null,
      badges_awarded: badges,
    }; // 交回完整结果
  });
  return run(); // 事务提交
}

/** 积分流水：只取积分变动行，按时间倒序分页，并给出余额与收支合计 */
export function listPointsLedger(db: Db, userId: string, limit: number, offset: number): PointsLedger {
  const safeLimit = clampInt(limit, 1, 100); // 分页大小上限
  const safeOffset = clampInt(offset, 0, 1_000_000); // 偏移上限
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 0 END), 0) AS earned,
              COALESCE(SUM(CASE WHEN points < 0 THEN -points ELSE 0 END), 0) AS spent,
              COUNT(*) AS total
       FROM wallet_transactions WHERE user_id = ? AND points <> 0`,
    )
    .get(userId) as { earned: number; spent: number; total: number }; // 汇总
  const items = db
    .prepare(
      `SELECT id, points, note, ref_type, ref_id, created_at
       FROM wallet_transactions
       WHERE user_id = ? AND points <> 0
       ORDER BY created_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, safeLimit, safeOffset) as PointsLedger['items']; // 明细分页
  return {
    balance: walletBalance(db, userId),
    earned_total: totals.earned,
    spent_total: totals.spent,
    total: totals.total,
    limit: safeLimit,
    offset: safeOffset,
    items,
  }; // 交回流水视图
}

/** 等级进度：当前等级、下一级、差多少分、等级内进度百分比 */
export function getLevelProgress(db: Db, userId: string, now: string): LevelProgress {
  const profile = ensureGrowthProfile(db, userId, now); // 档案
  const synced = syncLevel(db, userId, now); // 顺手校准（兼顾后台改门槛）
  const levels = listLevels(db); // 全部等级
  const { current, next } = resolveLevel(levels, profile.lifetime_points); // 当前与下一级
  const pointsToNext = next ? Math.max(0, next.min_points - profile.lifetime_points) : 0; // 距下一级差值
  const span = next ? next.min_points - current.min_points : 0; // 当前等级跨度
  const progress = next && span > 0
    ? Math.min(100, Math.floor(((profile.lifetime_points - current.min_points) / span) * 100))
    : 100; // 满级或零跨度直接 100
  return {
    level: current,
    next_level: next,
    lifetime_points: synced.lifetime,
    points_to_next: pointsToNext,
    progress_percent: progress,
  }; // 交回进度
}

/** 我的徽章：启用中的徽章全部列出，标记已获得与条件进度 */
export function listMyBadges(db: Db, userId: string, now: string): MyBadge[] {
  const profile = ensureGrowthProfile(db, userId, now); // 累计积分与等级
  const day = businessDay(now, getGrowthConfig(db).timezone); // 业务自然日
  const progress = badgeProgress(db, userId, profile.lifetime_points, profile.level, day); // 条件进度
  const rows = db
    .prepare(
      `SELECT b.code, b.name, b.description, b.icon, b.condition_type, b.condition_value,
              b.active, b.sort_order, b.created_at, b.updated_at,
              ub.awarded_at, ub.source
       FROM growth_badges b
       LEFT JOIN user_badges ub ON ub.badge_code = b.code AND ub.user_id = ?
       WHERE b.active = 1
       ORDER BY (ub.awarded_at IS NULL) ASC, b.sort_order ASC, b.code ASC`,
    )
    .all(userId) as Array<BadgeRow & { awarded_at: string | null; source: 'auto' | 'admin' | null }>;
  return rows.map((row) => ({
    ...toBadge(row),
    awarded: Boolean(row.awarded_at),
    awarded_at: row.awarded_at,
    source: row.source,
    progress: { current: progress[row.condition_type], target: row.condition_value },
  })); // 逐行组装视图
}

/** 徽章行转结构化形态 */
function toBadge(row: BadgeRow): BadgeDefinition {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    icon: row.icon,
    condition_type: row.condition_type,
    condition_value: row.condition_value,
    active: row.active === 1,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 管理端：全部徽章定义（含停用） */
export function listBadgeDefinitions(db: Db): BadgeDefinition[] {
  const rows = db
    .prepare(
      `SELECT code, name, description, icon, condition_type, condition_value, active, sort_order, created_at, updated_at
       FROM growth_badges ORDER BY sort_order ASC, code ASC`,
    )
    .all() as BadgeRow[];
  return rows.map(toBadge); // 结构化
}

/** 管理端：整表替换等级配置；要求 level 从 1 连续、min_points 严格升序且首级为 0 */
export function replaceLevels(db: Db, levels: LevelInput[], now: string): GrowthLevel[] {
  if (levels.length === 0 || levels.length > 20) {
    throw new AppError('VALIDATION_FAILED', '等级数量需在 1-20 之间'); // 数量约束
  }
  const ordered = [...levels].sort((a, b) => a.level - b.level); // 按等级排序
  ordered.forEach((item, index) => {
    if (item.level !== index + 1) throw new AppError('VALIDATION_FAILED', '等级序号必须从 1 开始连续递增'); // 连续性
    if (index === 0 && item.min_points !== 0) throw new AppError('VALIDATION_FAILED', '最低等级门槛必须为 0'); // 首级
    if (index > 0 && item.min_points <= ordered[index - 1].min_points) {
      throw new AppError('VALIDATION_FAILED', '等级门槛必须严格递增'); // 门槛递增
    }
  });
  const run = db.transaction(() => {
    db.prepare('DELETE FROM growth_levels').run(); // 整表替换，配置量小且语义明确
    const insert = db.prepare(
      'INSERT INTO growth_levels (level, name, min_points, perks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const item of ordered) {
      insert.run(item.level, item.name, item.min_points, JSON.stringify(item.perks), now, now); // 写入
    }
    // 门槛变了，所有用户等级立即重算，避免接口显示与门槛脱节
    db.prepare(
      `UPDATE user_growth
       SET level = COALESCE((SELECT MAX(level) FROM growth_levels l WHERE l.min_points <= user_growth.lifetime_points), 1),
           updated_at = ?
       WHERE level <> COALESCE((SELECT MAX(level) FROM growth_levels l WHERE l.min_points <= user_growth.lifetime_points), 1)`,
    ).run(now);
  });
  run(); // 事务提交
  return listLevels(db); // 交回落库结果
}

/** 管理端：创建徽章定义 */
export function createBadge(db: Db, input: BadgeInput, now: string): BadgeDefinition {
  const exists = db.prepare('SELECT code FROM growth_badges WHERE code = ?').get(input.code); // 编码唯一
  if (exists) throw new AppError('CONFLICT', '徽章编码已存在', { code: input.code }); // 冲突 409
  db.prepare(
    `INSERT INTO growth_badges (code, name, description, icon, condition_type, condition_value, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.code,
    input.name,
    input.description ?? '',
    input.icon ?? '',
    input.condition_type,
    input.condition_value,
    input.active === false ? 0 : 1,
    input.sort_order ?? 100,
    now,
    now,
  ); // 写入定义
  const row = db.prepare('SELECT * FROM growth_badges WHERE code = ?').get(input.code) as BadgeRow; // 回读
  return toBadge(row); // 结构化返回
}

/** 管理端：更新徽章定义（编码不可改） */
export function updateBadge(db: Db, code: string, input: Partial<BadgeInput>, now: string): BadgeDefinition {
  const current = db.prepare('SELECT * FROM growth_badges WHERE code = ?').get(code) as BadgeRow | undefined;
  if (!current) throw new AppError('NOT_FOUND', '徽章不存在', { code }); // 不存在 404
  db.prepare(
    `UPDATE growth_badges
     SET name = ?, description = ?, icon = ?, condition_type = ?, condition_value = ?, active = ?, sort_order = ?, updated_at = ?
     WHERE code = ?`,
  ).run(
    input.name ?? current.name,
    input.description ?? current.description,
    input.icon ?? current.icon,
    input.condition_type ?? current.condition_type,
    input.condition_value ?? current.condition_value,
    input.active === undefined ? current.active : input.active ? 1 : 0,
    input.sort_order ?? current.sort_order,
    now,
    code,
  ); // 合并写入
  const row = db.prepare('SELECT * FROM growth_badges WHERE code = ?').get(code) as BadgeRow; // 回读
  return toBadge(row); // 结构化返回
}

/** 管理端：停用徽章（保留已授予记录，不物理删除） */
export function disableBadge(db: Db, code: string, now: string): BadgeDefinition {
  const current = db.prepare('SELECT * FROM growth_badges WHERE code = ?').get(code) as BadgeRow | undefined;
  if (!current) throw new AppError('NOT_FOUND', '徽章不存在', { code }); // 不存在 404
  db.prepare('UPDATE growth_badges SET active = 0, updated_at = ? WHERE code = ?').run(now, code); // 软停用
  return toBadge({ ...current, active: 0, updated_at: now }); // 交回停用后的定义
}

/** 管理端：手动授予徽章；重复授予返回 granted=false，不报错 */
export function grantBadgeManually(db: Db, userId: string, code: string, now: string): { granted: boolean; badge: BadgeDefinition } {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined;
  if (!user) throw new AppError('NOT_FOUND', '用户不存在', { user_id: userId }); // 用户不存在 404
  const badge = db.prepare('SELECT * FROM growth_badges WHERE code = ?').get(code) as BadgeRow | undefined;
  if (!badge) throw new AppError('NOT_FOUND', '徽章不存在', { code }); // 徽章不存在 404
  const result = db
    .prepare(`INSERT OR IGNORE INTO user_badges (id, user_id, badge_code, source, awarded_at) VALUES (?, ?, ?, 'admin', ?)`)
    .run(uuidv7(), userId, code, now); // 幂等授予
  return { granted: result.changes > 0, badge: toBadge(badge) }; // 交回是否新授予
}
