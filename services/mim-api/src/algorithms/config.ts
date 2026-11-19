/**
 * 自研算法参数配置层（零第三方依赖）。
 *
 * 优先级与既有推荐权重保持一致：环境变量 JSON 覆盖 > site_settings 持久化 > 内置默认值。
 * 所有数值在合并时做区间夹取，坏配置不会把排序打成极值；调用方拿到的永远是完整参数。
 */

import type { Db } from '../types.js'; // 数据库连接类型（只做读 / 写 site_settings）

/** BM25 参数与字段权重。 */
export interface AlgorithmBm25Weights {
  k1: number; // 词频饱和参数
  b: number; // 长度归一强度
  title: number; // 标题字段权重
  summary: number; // 摘要字段权重
  body: number; // 正文字段权重
} // AlgorithmBm25Weights 结束

/** 综合排序参数。 */
export interface AlgorithmRankWeights {
  halfLifeDays: number; // 相关性半衰期（天）
  engagementWeight: number; // 互动对数项权重
} // AlgorithmRankWeights 结束

/** 热度参数。 */
export interface AlgorithmHeatWeights {
  likes: number; // 点赞权重
  replies: number; // 回复权重
  views: number; // 浏览权重
  favorites: number; // 收藏权重
  gravity: number; // 年龄重力指数
} // AlgorithmHeatWeights 结束

/** 候选窗口：搜索 / 热榜各自的最大参与排序条数。 */
export interface AlgorithmWindow {
  search: number; // 搜索候选窗口
  trending: number; // 热榜候选窗口
} // AlgorithmWindow 结束

/** 算法全量参数。 */
export interface AlgorithmWeights {
  bm25: AlgorithmBm25Weights; // 相关性
  rank: AlgorithmRankWeights; // 综合分
  heat: AlgorithmHeatWeights; // 热度
  window: AlgorithmWindow; // 窗口
} // AlgorithmWeights 结束

/** 内置默认值：与接入时写入文档的口径一致。 */
export const DEFAULT_ALGORITHM_WEIGHTS: AlgorithmWeights = { // 默认参数
  bm25: { k1: 1.2, b: 0.75, title: 3, summary: 2, body: 1 }, // 标题权重最高
  rank: { halfLifeDays: 7, engagementWeight: 0.02 }, // 一周半衰期
  heat: { likes: 3, replies: 5, views: 0.3, favorites: 6, gravity: 1.5 }, // 创作成本越高权重越大
  window: { search: 5000, trending: 500 }, // 窗口上限：搜索全量可翻页，热榜取较大样本
}; // 默认值结束

/** site_settings 中保存算法参数的键。 */
export const ALGORITHM_WEIGHTS_KEY = 'community_algorithm_weights'; // 与推荐权重键并列，互不覆盖

/** 数值夹取：非有限值直接回落默认，越界夹到区间。 */
function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number.NaN; // 只接受数字，字符串不隐式转换
  if (!Number.isFinite(num)) return fallback; // 非法值回落默认
  return Math.min(max, Math.max(min, num)); // 夹到区间
} // clamp 结束

/** 深合并并夹取全部字段；patch 缺项保持 base 原值。 */
export function mergeAlgorithmWeights(base: AlgorithmWeights, patch: unknown): AlgorithmWeights {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof AlgorithmWeights, unknown>>; // 只接受对象
  const bm25 = (p.bm25 && typeof p.bm25 === 'object' ? p.bm25 : {}) as Partial<AlgorithmBm25Weights>; // BM25 段
  const rank = (p.rank && typeof p.rank === 'object' ? p.rank : {}) as Partial<AlgorithmRankWeights>; // 综合分 段
  const heat = (p.heat && typeof p.heat === 'object' ? p.heat : {}) as Partial<AlgorithmHeatWeights>; // 热度段
  const windowCfg = (p.window && typeof p.window === 'object' ? p.window : {}) as Partial<AlgorithmWindow>; // 窗口段
  return {
    bm25: {
      k1: clamp(bm25.k1, base.bm25.k1, 0.1, 3), // k1 区间
      b: clamp(bm25.b, base.bm25.b, 0, 1), // b 区间
      title: clamp(bm25.title, base.bm25.title, 0, 10), // 标题权重区间
      summary: clamp(bm25.summary, base.bm25.summary, 0, 10), // 摘要权重区间
      body: clamp(bm25.body, base.bm25.body, 0, 10), // 正文权重区间
    }, // BM25 合并结束
    rank: {
      halfLifeDays: clamp(rank.halfLifeDays, base.rank.halfLifeDays, 0.5, 365), // 半衰期区间
      engagementWeight: clamp(rank.engagementWeight, base.rank.engagementWeight, 0, 1), // 互动权重区间
    }, // 综合分合并结束
    heat: {
      likes: clamp(heat.likes, base.heat.likes, 0, 50), // 点赞权重区间
      replies: clamp(heat.replies, base.heat.replies, 0, 50), // 回复权重区间
      views: clamp(heat.views, base.heat.views, 0, 50), // 浏览权重区间
      favorites: clamp(heat.favorites, base.heat.favorites, 0, 50), // 收藏权重区间
      gravity: clamp(heat.gravity, base.heat.gravity, 0.5, 3), // 重力区间
    }, // 热度合并结束
    window: {
      search: Math.round(clamp(windowCfg.search, base.window.search, 50, 20000)), // 搜索窗口：至少 50 条
      trending: Math.round(clamp(windowCfg.trending, base.window.trending, 10, 5000)), // 热榜窗口：至少 10 条
    }, // 窗口合并结束
  }; // 返回完整参数
} // mergeAlgorithmWeights 结束

/** 读取 site_settings 里的 JSON；缺失或脏数据返回 null。 */
function readSettings(db: Db): unknown {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(ALGORITHM_WEIGHTS_KEY) as { value: string } | undefined; // 查配置行
  if (!row?.value) return null; // 无配置
  try { return JSON.parse(row.value); } catch { return null; } // 脏 JSON 视为未配置
} // readSettings 结束

/** 读取环境变量 JSON；缺失或脏数据返回 null。 */
function readEnv(env: Record<string, string | undefined>): unknown {
  const raw = env.MIM_ALGORITHM_WEIGHTS; // 环境变量覆盖
  if (!raw) return null; // 未配置
  try { return JSON.parse(raw); } catch { return null; } // 脏 JSON 视为未配置
} // readEnv 结束

/** 参数来源：便于接口回显与线上对账。 */
export type AlgorithmWeightSource = 'env' | 'settings' | 'default'; // 三种来源

/**
 * 读取生效参数与来源。
 * 合并顺序：默认 → 持久化 → 环境变量，后者覆盖前者；任一层非法只回落该层。
 */
export function loadAlgorithmWeights(
  env: Record<string, string | undefined>, // 进程环境
  db: Db, // 数据库
): { weights: AlgorithmWeights; source: AlgorithmWeightSource } {
  const settings = readSettings(db); // 持久化层
  const fromEnv = readEnv(env); // 环境层
  let weights = mergeAlgorithmWeights(DEFAULT_ALGORITHM_WEIGHTS, settings); // 默认 + 持久化
  let source: AlgorithmWeightSource = settings ? 'settings' : 'default'; // 记录来源
  if (fromEnv) { weights = mergeAlgorithmWeights(weights, fromEnv); source = 'env'; } // 环境变量优先
  return { weights, source }; // 返回参数与来源
} // loadAlgorithmWeights 结束

/** 持久化参数：只写 site_settings，与环境变量覆盖互不冲突。 */
export function saveAlgorithmWeights(db: Db, patch: unknown, nowIso: string): AlgorithmWeights {
  const current = mergeAlgorithmWeights(DEFAULT_ALGORITHM_WEIGHTS, readSettings(db)); // 以持久化层为基线
  const next = mergeAlgorithmWeights(current, patch); // 合并补丁并夹取
  db.prepare( // 幂等 upsert
    'INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', // 同键覆盖
  ).run(ALGORITHM_WEIGHTS_KEY, JSON.stringify(next), nowIso); // 写入 JSON
  return next; // 返回落库后的完整参数
} // saveAlgorithmWeights 结束
