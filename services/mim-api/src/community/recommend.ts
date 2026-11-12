/**
 * 社区三期：推荐指数（recommend_score）。
 *
 * 口径：浏览 / 回复 / 收藏 / 评分四类互动量加权求和，再按半衰期做时间衰减。
 * 权重来源优先级：环境变量 JSON 覆盖 > site_settings 持久化配置 > 内置默认值。
 * 分数在互动事件（发帖 / 回复 / 点赞 / 收藏 / 评分 / 浏览）后回写到 community_threads.recommend_score，
 * 列表 sort=recommend 直接按该列排序，避免每次全量实时算分。
 */

import type { ApiDeps, Db } from '../types.js'; // 依赖容器与连接类型

/** 可配置权重；halfLifeDays 为分数半衰期（天），超过半衰期分数折半。 */
export interface RecommendWeights {
  views: number;
  replies: number;
  favorites: number;
  rating: number;
  halfLifeDays: number;
}

/** 内置默认权重：收藏与评分权重高于浏览，冷启动期新帖也能凭互动进入推荐位。 */
export const DEFAULT_WEIGHTS: RecommendWeights = { views: 1, replies: 3, favorites: 5, rating: 4, halfLifeDays: 7 };

const SETTINGS_KEY = 'community_recommend_weights'; // site_settings 中的权重配置键

/** 读取 site_settings 中的 JSON 对象；脏数据回落空对象。 */
function readSettingsJson(db: Db, key: string): Record<string, unknown> {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 数字字段兜底：非有限数回落默认值。 */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 解析生效权重。
 * @param env 注入环境变量；MIM_COMMUNITY_RECOMMEND_WEIGHTS 为 JSON 串，优先级最高。
 */
export function loadWeights(env: Record<string, string | undefined>, db: Db): RecommendWeights {
  const persisted = readSettingsJson(db, SETTINGS_KEY);
  const fromEnv: Record<string, unknown> = {};
  const rawEnv = env.MIM_COMMUNITY_RECOMMEND_WEIGHTS?.trim();
  if (rawEnv) {
    try {
      const parsed: unknown = JSON.parse(rawEnv);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(fromEnv, parsed);
    } catch {
      // 环境变量 JSON 脏数据：静默回落持久化配置，不阻断启动
    }
  }
  return {
    views: num(fromEnv.views ?? persisted.views, DEFAULT_WEIGHTS.views),
    replies: num(fromEnv.replies ?? persisted.replies, DEFAULT_WEIGHTS.replies),
    favorites: num(fromEnv.favorites ?? persisted.favorites, DEFAULT_WEIGHTS.favorites),
    rating: num(fromEnv.rating ?? persisted.rating, DEFAULT_WEIGHTS.rating),
    halfLifeDays: Math.max(0.5, num(fromEnv.halfLifeDays ?? persisted.halfLifeDays, DEFAULT_WEIGHTS.halfLifeDays)),
  };
}

/** 持久化权重配置（运营 / 版主调整入口；环境变量覆盖仍优先生效）。 */
export function saveWeights(db: Db, weights: RecommendWeights, nowIso: string): void {
  db.prepare(
    'INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(SETTINGS_KEY, JSON.stringify(weights), nowIso);
}

/** 算分输入：各互动量与发帖时间。 */
export interface ScoreInput {
  views: number;
  replyCount: number;
  favoriteCount: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
}

/** 纯函数算分：便于单测固定时间断言；decay 为半衰期衰减因子。 */
export function computeScore(input: ScoreInput, weights: RecommendWeights, now: Date = new Date()): number {
  const ageDays = Math.max(0, (now.getTime() - Date.parse(input.createdAt)) / 86_400_000);
  const decay = Math.pow(0.5, ageDays / weights.halfLifeDays);
  const ratingTerm = input.ratingCount > 0 ? Math.max(0, input.ratingAvg - 1) * input.ratingCount : 0;
  const raw =
    weights.views * (input.views ?? 0) +
    weights.replies * (input.replyCount ?? 0) +
    weights.favorites * (input.favoriteCount ?? 0) +
    weights.rating * ratingTerm;
  return Math.round(raw * decay * 10_000) / 10_000;
}

/** 回写指定帖子的推荐指数；互动事件后调用，保证 sort=recommend 读到的是最新分。 */
export function refreshRecommendScore(deps: ApiDeps, threadId: string): void {
  const row = deps.db
    .prepare(
      `SELECT t.views, t.reply_count, t.created_at,
              (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id) AS favorite_count,
              (SELECT ROUND(AVG(r.rating), 2) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_avg,
              (SELECT COUNT(*) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_count
         FROM community_threads t WHERE t.id = ?`,
    )
    .get(threadId) as
    | { views: number; reply_count: number; created_at: string; favorite_count: number; rating_avg: number | null; rating_count: number }
    | undefined;
  if (!row) return; // 帖子已删除：静默跳过
  const weights = loadWeights(deps.env, deps.db);
  const score = computeScore(
    {
      views: row.views,
      replyCount: row.reply_count,
      favoriteCount: row.favorite_count,
      ratingAvg: row.rating_avg ?? 0,
      ratingCount: row.rating_count,
      createdAt: row.created_at,
    },
    weights,
  );
  deps.db.prepare('UPDATE community_threads SET recommend_score = ? WHERE id = ?').run(score, threadId);
}
