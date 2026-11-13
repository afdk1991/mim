/**
 * 社区三期：站点级社区设置（论坛设为首页 / 建板块审核开关）。
 *
 * 与 appearance 路由共用 site_settings 键值表，value 为 JSON 字符串。
 * 对外契约用 home=community|portal；落库沿用既有 home.view 口径（community | store），
 * portal 即既有商城门户 store，保证 /site/config 等既有消费方不受影响。
 */

import type { Db } from '../types.js'; // 数据库连接类型

/** 对外首页指向：community 论坛首页 / portal 门户（商城）首页。 */
export type HomeView = 'community' | 'portal';

const HOME_KEY = 'home'; // 与 appearance 路由同一设置键
const REVIEW_KEY = 'community_board_review'; // 建板块审核开关配置键

/** 落库 view 值 → 对外 home 值映射。 */
function toHomeView(view: unknown): HomeView {
  return view === 'community' ? 'community' : 'portal'; // 返回当前函数的处理结果
} // 代码块结束

/** 对外 home 值 → 落库 view 值映射。 */
function toStoreView(home: HomeView): 'community' | 'store' {
  return home === 'community' ? 'community' : 'store'; // 返回当前函数的处理结果
} // 代码块结束

/** 读取当前首页指向；缺省回落 portal（既有默认商城门户）。 */
export function readHomeSetting(db: Db): HomeView {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(HOME_KEY) as { value: string } | undefined; // 常量 row：保存固定配置或一次性派生值
  if (!row) return 'portal'; // 条件分支：按判断结果选择后续处理路径
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const parsed = JSON.parse(row.value) as { view?: unknown }; // 常量 parsed：保存固定配置或一次性派生值
    return toHomeView(parsed.view); // 返回当前函数的处理结果
  } catch { // 代码块结束
    return 'portal'; // 返回当前函数的处理结果
  } // 代码块结束
} // 代码块结束

/** 写入首页指向；upsert 不触碰其他设置键。 */
export function writeHomeSetting(db: Db, home: HomeView, nowIso: string): void {
  db.prepare( // 执行当前业务步骤
    'INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', // 执行当前业务步骤
  ).run(HOME_KEY, JSON.stringify({ view: toStoreView(home) }), nowIso); // 执行当前业务步骤
} // 代码块结束

/**
 * 建板块是否需要人工审核。
 * 优先级：site_settings 持久化开关 > 环境变量 MIM_COMMUNITY_BOARD_REVIEW > 默认关闭。
 */
export function boardReviewEnabled(db: Db, env: Record<string, string | undefined>): boolean {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(REVIEW_KEY) as { value: string } | undefined; // 常量 row：保存固定配置或一次性派生值
  if (row) { // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const parsed = JSON.parse(row.value) as { enabled?: unknown }; // 常量 parsed：保存固定配置或一次性派生值
      if (typeof parsed.enabled === 'boolean') return parsed.enabled; // 条件分支：按判断结果选择后续处理路径
    } catch { // 代码块结束
      // 脏数据回落环境变量判定
    }
  } // 代码块结束
  return (env.MIM_COMMUNITY_BOARD_REVIEW ?? '') === '1'; // 返回当前函数的处理结果
} // 代码块结束

/** 持久化建板块审核开关（运营端点调用）。 */
export function saveBoardReviewEnabled(db: Db, enabled: boolean, nowIso: string): void {
  db.prepare( // 执行当前业务步骤
    'INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', // 执行当前业务步骤
  ).run(REVIEW_KEY, JSON.stringify({ enabled }), nowIso); // 执行当前业务步骤
} // 代码块结束
