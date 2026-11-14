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
  views: number; // 对象字段 views：记录一项配置或数据
  replies: number; // 对象字段 replies：记录一项配置或数据
  favorites: number; // 对象字段 favorites：记录一项配置或数据
  rating: number; // 对象字段 rating：记录一项配置或数据
  halfLifeDays: number; // 对象字段 halfLifeDays：记录一项配置或数据
} // 代码块结束

/** 内置默认权重：收藏与评分权重高于浏览，冷启动期新帖也能凭互动进入推荐位。 */
export const DEFAULT_WEIGHTS: RecommendWeights = { views: 1, replies: 3, favorites: 5, rating: 4, halfLifeDays: 7 };

const SETTINGS_KEY = 'community_recommend_weights'; // site_settings 中的权重配置键

/** 读取 site_settings 中的 JSON 对象；脏数据回落空对象。 */
function readSettingsJson(db: Db, key: string): Record<string, unknown> {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key) as { value: string } | undefined; // 常量 row：保存固定配置或一次性派生值
  if (!row) return {}; // 条件分支：按判断结果选择后续处理路径
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const parsed: unknown = JSON.parse(row.value); // 常量 parsed：保存固定配置或一次性派生值
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}; // 返回当前函数的处理结果
  } catch { // 代码块结束
    return {}; // 返回当前函数的处理结果
  } // 代码块结束
} // 代码块结束

/** 数字字段兜底：非有限数回落默认值。 */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 解析生效权重。
 * @param env 注入环境变量；MIM_COMMUNITY_RECOMMEND_WEIGHTS 为 JSON 串，优先级最高。
 */
export function loadWeights(env: Record<string, string | undefined>, db: Db): RecommendWeights {
  const persisted = readSettingsJson(db, SETTINGS_KEY); // 常量 persisted：保存固定配置或一次性派生值
  const fromEnv: Record<string, unknown> = {}; // 常量 fromEnv：保存固定配置或一次性派生值
  const rawEnv = env.MIM_COMMUNITY_RECOMMEND_WEIGHTS?.trim(); // 常量 rawEnv：保存固定配置或一次性派生值
  if (rawEnv) { // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const parsed: unknown = JSON.parse(rawEnv); // 常量 parsed：保存固定配置或一次性派生值
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(fromEnv, parsed); // 条件分支：按判断结果选择后续处理路径
    } catch { // 代码块结束
      // 环境变量 JSON 脏数据：静默回落持久化配置，不阻断启动
    }
  } // 代码块结束
  return { // 返回当前函数的处理结果
    views: num(fromEnv.views ?? persisted.views, DEFAULT_WEIGHTS.views), // 对象字段 views：记录一项配置或数据
    replies: num(fromEnv.replies ?? persisted.replies, DEFAULT_WEIGHTS.replies), // 对象字段 replies：记录一项配置或数据
    favorites: num(fromEnv.favorites ?? persisted.favorites, DEFAULT_WEIGHTS.favorites), // 对象字段 favorites：记录一项配置或数据
    rating: num(fromEnv.rating ?? persisted.rating, DEFAULT_WEIGHTS.rating), // 对象字段 rating：记录一项配置或数据
    halfLifeDays: Math.max(0.5, num(fromEnv.halfLifeDays ?? persisted.halfLifeDays, DEFAULT_WEIGHTS.halfLifeDays)), // 对象字段 halfLifeDays：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

/** 持久化权重配置（运营 / 版主调整入口；环境变量覆盖仍优先生效）。 */
export function saveWeights(db: Db, weights: RecommendWeights, nowIso: string): void {
  db.prepare( // 执行当前业务步骤
    'INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', // 执行当前业务步骤
  ).run(SETTINGS_KEY, JSON.stringify(weights), nowIso); // 执行当前业务步骤
} // 代码块结束

/** 算分输入：各互动量与发帖时间。 */
export interface ScoreInput {
  views: number; // 对象字段 views：记录一项配置或数据
  replyCount: number; // 对象字段 replyCount：记录一项配置或数据
  favoriteCount: number; // 对象字段 favoriteCount：记录一项配置或数据
  ratingAvg: number; // 对象字段 ratingAvg：记录一项配置或数据
  ratingCount: number; // 对象字段 ratingCount：记录一项配置或数据
  createdAt: string; // 对象字段 createdAt：记录一项配置或数据
} // 代码块结束

/** 纯函数算分：便于单测固定时间断言；decay 为半衰期衰减因子。 */
export function computeScore(input: ScoreInput, weights: RecommendWeights, now: Date = new Date()): number {
  const ageDays = Math.max(0, (now.getTime() - Date.parse(input.createdAt)) / 86_400_000); // 常量 ageDays：保存固定配置或一次性派生值
  const decay = Math.pow(0.5, ageDays / weights.halfLifeDays); // 常量 decay：保存固定配置或一次性派生值
  const ratingTerm = input.ratingCount > 0 ? Math.max(0, input.ratingAvg - 1) * input.ratingCount : 0; // 常量 ratingTerm：保存固定配置或一次性派生值
  const raw = // 常量 raw：保存固定配置或一次性派生值
    weights.views * (input.views ?? 0) + // 执行当前业务步骤
    weights.replies * (input.replyCount ?? 0) + // 执行当前业务步骤
    weights.favorites * (input.favoriteCount ?? 0) + // 执行当前业务步骤
    weights.rating * ratingTerm; // 执行当前业务步骤
  return Math.round(raw * decay * 10_000) / 10_000; // 返回当前函数的处理结果
} // 代码块结束

/** 回写指定帖子的推荐指数；互动事件后调用，保证 sort=recommend 读到的是最新分。 */
export function refreshRecommendScore(deps: ApiDeps, threadId: string): void {
  const row = deps.db // 常量 row：保存固定配置或一次性派生值
    .prepare( // 执行当前业务步骤
      `SELECT t.views, t.reply_count, t.created_at,
              (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id) AS favorite_count,
              (SELECT ROUND(AVG(r.rating), 2) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_avg,
              (SELECT COUNT(*) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_count
         FROM community_threads t WHERE t.id = ?`,
    ) // 执行当前业务步骤
    .get(threadId) as // 注册 GET 路由 / 中间件处理器
    | { views: number; reply_count: number; created_at: string; favorite_count: number; rating_avg: number | null; rating_count: number } // 执行当前业务步骤
    | undefined; // 执行当前业务步骤
  if (!row) return; // 帖子已删除：静默跳过
  const weights = loadWeights(deps.env, deps.db); // 常量 weights：保存固定配置或一次性派生值
  const score = computeScore( // 常量 score：保存固定配置或一次性派生值
    { // 执行当前业务步骤
      views: row.views, // 对象字段 views：记录一项配置或数据
      replyCount: row.reply_count, // 对象字段 replyCount：记录一项配置或数据
      favoriteCount: row.favorite_count, // 对象字段 favoriteCount：记录一项配置或数据
      ratingAvg: row.rating_avg ?? 0, // 对象字段 ratingAvg：记录一项配置或数据
      ratingCount: row.rating_count, // 对象字段 ratingCount：记录一项配置或数据
      createdAt: row.created_at, // 对象字段 createdAt：记录一项配置或数据
    }, // 代码块结束
    weights, // 执行当前业务步骤
  ); // 执行当前业务步骤
  deps.db.prepare('UPDATE community_threads SET recommend_score = ? WHERE id = ?').run(score, threadId); // 执行当前业务步骤
} // 代码块结束

/**
 * 全量对账：按当前公式重算所有帖子的推荐指数，只写回与现值不同的行。
 * 用途：历史数据里存在「0 浏览却带着预置分数」的存量假数，启动时按公式纠正一次。
 * 幂等：结果只取决于帖子当前的真实互动量，重复执行不会二次扣减 / 二次归零。
 * @returns 本次实际修正的行数；0 表示本来就全部一致。
 */
export function reconcileRecommendScores(env: Record<string, string | undefined>, db: Db): number {
  const weights = loadWeights(env, db); // 与互动回写同一套权重口径
  const rows = db // 常量 rows：保存固定配置或一次性派生值
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `SELECT t.id, t.recommend_score, t.views, t.reply_count, t.created_at,
              (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id) AS favorite_count,
              (SELECT ROUND(AVG(r.rating), 2) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_avg,
              (SELECT COUNT(*) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_count
         FROM community_threads t`,
    ) // 调用结束：参数列表与链式调用收尾
    .all() as Array<{ // 查询多行：读取列表供批量处理
    id: string; // 对象字段：看清当前逻辑在做什么
    recommend_score: number; // 对象字段：看清当前逻辑在做什么
    views: number; // 对象字段：看清当前逻辑在做什么
    reply_count: number; // 对象字段：看清当前逻辑在做什么
    created_at: string; // 对象字段：看清当前逻辑在做什么
    favorite_count: number; // 对象字段：看清当前逻辑在做什么
    rating_avg: number | null; // 对象字段：看清当前逻辑在做什么
    rating_count: number; // 对象字段：看清当前逻辑在做什么
  }>; // 代码块结束
  const update = db.prepare('UPDATE community_threads SET recommend_score = ? WHERE id = ?'); // 预编译 SQL：固定语句结构后绑定参数执行
  let fixed = 0; // 记录修正条数，供启动日志留证
  const apply = db.transaction(() => { // 单事务批量纠正，避免半途中断留下部分不一致
    for (const row of rows) { // 逐帖重算
      const score = computeScore( // 常量 score：保存固定配置或一次性派生值
        { // 执行当前业务步骤
          views: row.views, // 对象字段 views：记录一项配置或数据
          replyCount: row.reply_count, // 对象字段 replyCount：记录一项配置或数据
          favoriteCount: row.favorite_count, // 对象字段 favoriteCount：记录一项配置或数据
          ratingAvg: row.rating_avg ?? 0, // 对象字段 ratingAvg：记录一项配置或数据
          ratingCount: row.rating_count, // 对象字段 ratingCount：记录一项配置或数据
          createdAt: row.created_at, // 对象字段 createdAt：记录一项配置或数据
        }, // 代码块结束
        weights, // 执行当前业务步骤
      ); // 执行当前业务步骤
      if (Math.abs(score - row.recommend_score) < 1e-9) continue; // 已一致则不写，保证重复执行零改动
      update.run(score, row.id); // 执行写入：把参数落库并返回影响结果
      fixed += 1; // 赋值：更新当前作用域中的状态
    } // 遍历结束
  }); // 结束函数体：本层作用域收尾
  apply(); // 执行事务
  return fixed; // 返回结果：把本步骤产物交给调用方
} // 代码块结束

/**
 * 全量对账：按真实点赞记录（community_thread_likes）重算每个帖子的 likes。
 * 用途：种子帖曾预置点赞数（0 浏览却带几十个赞），启动时按真实记录纠正一次；无记录即 0。
 * 幂等：结果只取决于点赞记录条数，重复执行不会二次扣减 / 二次累加。
 * @returns 本次实际修正的行数；0 表示本来就全部一致。
 */
export function reconcileLikeCounts(db: Db): number {
  const rows = db // 常量 rows：保存固定配置或一次性派生值
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `SELECT t.id, t.likes,
              (SELECT COUNT(*) FROM community_thread_likes l WHERE l.thread_id = t.id) AS real_likes
         FROM community_threads t`,
    ) // 调用结束：参数列表与链式调用收尾
    .all() as Array<{ id: string; likes: number; real_likes: number }>; // 查询多行：读取列表供批量处理
  const update = db.prepare('UPDATE community_threads SET likes = ? WHERE id = ?'); // 预编译 SQL：固定语句结构后绑定参数执行
  let fixed = 0; // 记录修正条数，供启动日志留证
  const apply = db.transaction(() => { // 单事务批量纠正，避免半途中断留下部分不一致
    for (const row of rows) { // 逐帖比对
      if (row.real_likes === row.likes) continue; // 已一致则不写，保证重复执行零改动
      update.run(row.real_likes, row.id); // 执行写入：把参数落库并返回影响结果
      fixed += 1; // 赋值：更新当前作用域中的状态
    } // 遍历结束
  }); // 结束函数体：本层作用域收尾
  apply(); // 执行事务
  return fixed; // 返回结果：把本步骤产物交给调用方
} // 代码块结束
