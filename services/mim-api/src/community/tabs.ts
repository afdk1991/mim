/**
 * 社区三期：板块 Tab 栏目模块化组合。
 *
 * 每个板块的 Tab 配置 = 代码内置缺省清单 + community_board_tab_configs 持久化覆盖项。
 * 缺省清单保证新板块开箱即有一套可用 Tab；版主可调整顺序、显隐与每个 Tab 的排序口径，
 * 按板块独立持久化，互不影响。读取端点公开，写操作限版主 / 创建者 / 运营。
 */

import type { Db } from '../types.js'; // 数据库连接类型

/** 单个 Tab 配置视图（对外契约）。 */
export interface TabConfig {
  key: string; // Tab 标识：latest / hot / recommend / rating / favorites ...
  label: string; // 展示名
  sort_by: string; // 排序口径，与列表端点 sort 参数对齐
  visible: boolean; // 是否在板块页展示
  sort_order: number; // 展示顺序，数字越小越靠前
} // 代码块结束

/** 内置缺省 Tab 清单；新板块未做过任何定制时整体返回这一套。 */
export const DEFAULT_TABS: TabConfig[] = [
  { key: 'latest', label: '最新', sort_by: 'latest', visible: true, sort_order: 1 }, // 执行当前业务步骤
  { key: 'hot', label: '热门', sort_by: 'hot', visible: true, sort_order: 2 }, // 执行当前业务步骤
  { key: 'recommend', label: '推荐', sort_by: 'recommend', visible: true, sort_order: 3 }, // 执行当前业务步骤
  { key: 'rating', label: '评分', sort_by: 'rating', visible: true, sort_order: 4 }, // 执行当前业务步骤
  { key: 'favorites', label: '收藏', sort_by: 'favorites', visible: true, sort_order: 5 }, // 执行当前业务步骤
]; // 执行当前业务步骤

/** 排序口径白名单：与帖子列表端点支持的 sort 参数一一对应。 */
export const SORT_BY_KEYS = new Set(['latest', 'hot', 'views', 'replies', 'favorites', 'rating', 'recommend']);

interface PersistedTabRow { // 接口 PersistedTabRow：约束对象的字段与类型形态
  tab_key: string; // 对象字段 tab_key：记录一项配置或数据
  label: string; // 对象字段 label：记录一项配置或数据
  sort_order: number; // 对象字段 sort_order：记录一项配置或数据
  visible: number; // 对象字段 visible：记录一项配置或数据
  sort_by: string; // 对象字段 sort_by：记录一项配置或数据
} // 代码块结束

/** 读取板块 Tab 配置：缺省清单打底，持久化覆盖项按 key 合并。 */
export function loadBoardTabs(db: Db, boardId: string): TabConfig[] {
  const persisted = db // 常量 persisted：保存固定配置或一次性派生值
    .prepare('SELECT tab_key, label, sort_order, visible, sort_by FROM community_board_tab_configs WHERE board_id = ?') // 执行当前业务步骤
    .all(boardId) as PersistedTabRow[]; // 注册 ALL 路由 / 中间件处理器
  const overrides = new Map(persisted.map((row) => [row.tab_key, row])); // 常量 overrides：保存固定配置或一次性派生值
  const tabs = DEFAULT_TABS.map((def) => { // 常量 tabs：保存固定配置或一次性派生值
    const saved = overrides.get(def.key); // 常量 saved：保存固定配置或一次性派生值
    if (!saved) return def; // 条件分支：按判断结果选择后续处理路径
    return { // 返回当前函数的处理结果
      key: def.key, // 对象字段 key：记录一项配置或数据
      label: saved.label || def.label, // 对象字段 label：记录一项配置或数据
      sort_by: SORT_BY_KEYS.has(saved.sort_by) ? saved.sort_by : def.sort_by, // 对象字段 sort_by：记录一项配置或数据
      visible: saved.visible === 1, // 对象字段 visible：记录一项配置或数据
      sort_order: saved.sort_order, // 对象字段 sort_order：记录一项配置或数据
    }; // 代码块结束
  }); // 代码块结束
  // 持久化里存在、但缺省清单已下线的 key 不再带出，避免脏配置污染前端。
  return tabs.sort((a, b) => a.sort_order - b.sort_order);
} // 代码块结束

/** 保存的 Tab 入参（部分字段可选，缺省回落到缺省清单）。 */
export interface TabInput {
  key: string; // 对象字段 key：记录一项配置或数据
  label?: string; // 执行当前业务步骤
  visible?: boolean; // 执行当前业务步骤
  sort_order?: number; // 执行当前业务步骤
  sort_by?: string; // 执行当前业务步骤
} // 代码块结束

/**
 * 全量覆盖某板块的 Tab 配置：先清掉该板块旧覆盖项，再按提交清单 upsert。
 * 未出现在提交清单里的缺省 Tab 自动回落默认值，等价于版主把它重置。
 */
export function saveBoardTabs(db: Db, boardId: string, tabs: TabInput[], nowIso: string): void {
  db.prepare('DELETE FROM community_board_tab_configs WHERE board_id = ?').run(boardId); // 执行当前业务步骤
  const insert = db.prepare( // 常量 insert：保存固定配置或一次性派生值
    'INSERT INTO community_board_tab_configs (board_id, tab_key, label, sort_order, visible, sort_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', // 执行当前业务步骤
  ); // 执行当前业务步骤
  const defaults = new Map(DEFAULT_TABS.map((def) => [def.key, def])); // 常量 defaults：保存固定配置或一次性派生值
  tabs.forEach((tab, index) => { // 执行当前业务步骤
    const def = defaults.get(tab.key); // 常量 def：保存固定配置或一次性派生值
    const sortBy = tab.sort_by && SORT_BY_KEYS.has(tab.sort_by) ? tab.sort_by : (def?.sort_by ?? 'latest'); // 常量 sortBy：保存固定配置或一次性派生值
    insert.run( // 执行当前业务步骤
      boardId, // 执行当前业务步骤
      tab.key, // 执行当前业务步骤
      tab.label?.trim() || def?.label || tab.key, // 执行当前业务步骤
      tab.sort_order ?? index + 1, // 执行当前业务步骤
      tab.visible === false ? 0 : 1, // 执行当前业务步骤
      sortBy, // 执行当前业务步骤
      nowIso, // 执行当前业务步骤
    ); // 执行当前业务步骤
  }); // 代码块结束
} // 代码块结束
