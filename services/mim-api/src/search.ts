/** 统一搜索内核：把模块 / 入口 / 导航 / 社区 / 商品收斂成同一份可检索文档，并支持 Meilisearch 接管 */

import { SITE_MODULES } from '@mim/core-domain'; // 44 个入口的静态契约，直接作为入口来源，不在库里再存一份
import { jsonParse } from './utils.js'; // 解析库里的 name_i18n / summary_i18n JSON 文本
import type { Db } from './types.js'; // 数据库连接类型

/** 可检索来源：五个业务域，与前台搜索页的分组页签一一对应 */
export type SearchScope = 'module' | 'entry' | 'navigation' | 'community' | 'shop';

/** 来源全集与固定展示顺序：数组顺序即搜索页分组顺序 */
export const SEARCH_SCOPES: readonly SearchScope[] = ['module', 'entry', 'navigation', 'community', 'shop'];

/** 单个来源的中文分组名：接口直接回传，前端无需再维护一份映射 */
export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  module: '功能模块', // 模块商城的 205 条条目
  entry: '统一入口', // 44 个入口配置清单
  navigation: '导航链接', // 全站资源目录
  community: '社区帖子', // 论坛主题
  shop: '独立商城', // 实物 / 虚拟商品
}; // 代码块结束

/** 一条检索文档：统一字段是先决条件，Meilisearch 与 SQLite 共用同一结构 */
export interface SearchDocument {
  id: string; // 全局唯一键：`${scope}:${原始主键}`，跨来源不撞键
  scope: SearchScope; // 来源域
  title: string; // 主标题（命中权重最高）
  subtitle: string; // 副标题（分类 / 分组 / 作者等）
  snippet: string; // 摘要正文，用于关键词二次命中与结果片段
  href: string; // 站内路径或外部地址，点击直达
  keywords: string; // 参与匹配的全量文本（标题 + 副标题 + 摘要 + 标签）
  popularity: number; // 热度（浏览量 / Stars），仅用于同分排序
  updated_at: string; // 更新时间，仅用于同分排序
} // 代码块结束

/** 单条命中结果：在文档基础上补充分数，便于前端解释排序 */
export interface SearchHit extends SearchDocument {
  score: number; // 匹配分：标题命中高于摘要命中
} // 代码块结束

/** 搜索结果分组 */
export interface SearchGroup {
  scope: SearchScope; // 来源域
  label: string; // 中文分组名
  count: number; // 本组命中数
  items: SearchHit[]; // 本组命中条目
} // 代码块结束

/** 判断某张表是否存在：并行会话新增的表可能尚未合并到当前库，缺失时跳过该来源而不是整页报错 */
function tableExists(db: Db, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined; // 只查表名，不读数据
  return Boolean(row?.name); // 命中即存在
} // tableExists 结束

/** 取多语言字段的中文值：库里的 name_i18n 是 {"zh-CN":...,"en-US":...} 形式 */
function zhOf(value: string | null): string {
  const map = jsonParse<Record<string, string>>(value); // 脏数据解析失败时返回 null
  return map?.['zh-CN'] ?? map?.['en-US'] ?? ''; // 优先中文，其次英文，最后空串
} // zhOf 结束

/** 把多行正文压成单行，避免搜索结果卡片被换行撑开 */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim(); // 连续空白统一成一个空格
} // flatten 结束

/** 截取命中位置周围的片段：找不到关键词时回退到开头，保证摘要始终可读 */
export function excerpt(text: string, query: string, radius = 60): string {
  const flat = flatten(text); // 先压平
  if (!flat) return ''; // 空正文直接返回空串
  const lower = flat.toLowerCase(); // 统一小写做 ASCII 不区分大小写匹配
  const index = lower.indexOf(query.toLowerCase()); // 定位关键词
  if (index < 0) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? '…' : ''); // 未命中则取开头
  const start = Math.max(0, index - radius); // 命中点向前留一段上下文
  const end = Math.min(flat.length, index + query.length + radius); // 向后留一段上下文
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`; // 首尾按需加省略号
} // excerpt 结束

/** 组装一条文档：统一做去空白与长度裁剪，防止超大正文拖慢检索 */
function doc(input: Omit<SearchDocument, 'keywords'> & { keywords?: string }): SearchDocument {
  // 摘要只用于展示，不进入 keywords：模块简介含「可在商城内一次性解锁」这类模板句，若参与匹配会让一个通用词命中全部条目
  const keywords = [input.title, input.subtitle, input.keywords ?? ''].join(' '); // 全量匹配文本只取标题、副标题与显式检索字段
  return { // 返回当前函数的处理结果
    ...input, // 保留调用方给的字段
    title: flatten(input.title), // 标题压平
    subtitle: flatten(input.subtitle), // 副标题压平
    snippet: flatten(input.snippet).slice(0, 400), // 摘要最多 400 字，避免响应体膨胀
    keywords: flatten(keywords), // 关键词文本同样压平
  }; // 返回标准化文档
} // doc 结束

/** 读取模块商城：只取中文区在售模块，按 code 去重（中文区即默认展示口径） */
function moduleDocs(db: Db): SearchDocument[] {
  if (!tableExists(db, 'modules')) return []; // 老库或裁剪库没有该表时跳过
  const rows = db.prepare( // 常量 rows：保存固定配置或一次性派生值
    `SELECT code, name_i18n, summary_i18n, category_slug, license, language, stars, updated_at
       FROM modules
      WHERE region = 'cn' AND status = 'active' AND deleted_at IS NULL`,
  ).all() as Array<{ code: string; name_i18n: string; summary_i18n: string; category_slug: string | null; license: string | null; language: string | null; stars: number; updated_at: string }>; // 字段与 schema 对齐
  return rows.map((row) => doc({ // 返回当前函数的处理结果
    id: `module:${row.code}`, // 全局键带来源前缀
    scope: 'module', // 来源域
    title: zhOf(row.name_i18n) || row.code, // 多语言名称缺失时回退编码
    subtitle: [row.category_slug, row.language, row.license].filter(Boolean).join(' · '), // 分类 / 语言 / 许可
    snippet: zhOf(row.summary_i18n), // 模块简介
    href: '/marketplace', // 统一落到商城目录，详情由页面内展开
    keywords: `${row.code} ${row.category_slug ?? ''} ${row.language ?? ''} ${row.license ?? ''}`, // 编码与筛选属性也参与检索
    popularity: row.stars, // Star 数作为热度
    updated_at: row.updated_at, // 更新时间
  })); // 逐行映射
} // moduleDocs 结束

/** 读取 44 个统一入口：直接用静态契约，保证搜索口径与入口清单永远一致 */
function entryDocs(): SearchDocument[] {
  return SITE_MODULES.map((item) => doc({ // 返回当前函数的处理结果
    id: `entry:${item.entryKey}`, // 占位键作稳定主键
    scope: 'entry', // 来源域
    title: `${item.entry}（${item.entryKey}）`, // 入口描述 + 占位键，方便按关键字定位
    subtitle: `${item.domainName} · ${item.system}`, // 业务域 + 系统说明
    snippet: `${item.note} ${item.coreFunctions.join('；')}`, // 备注原文 + 核心功能
    href: '/entry-catalog', // 入口清单页
    keywords: `${item.entryKey} ${item.domain} ${item.adminRole} ${item.apiRole} ${item.note} ${item.coreFunctions.join('；')}`, // 职责、备注与核心功能参与检索
    popularity: 0, // 静态条目无热度
    updated_at: '', // 静态条目无更新时间
  })); // 逐条映射
} // entryDocs 结束

/** 读取导航站链接 */
function navigationDocs(db: Db): SearchDocument[] {
  if (!tableExists(db, 'nav_links')) return []; // 表缺失则跳过
  const rows = db.prepare('SELECT id, name, url, group_name, description, status, last_checked_at FROM nav_links').all() as Array<{ id: string; name: string; url: string; group_name: string; description: string; status: string; last_checked_at: string | null }>; // 只取检索所需列
  return rows.map((row) => doc({ // 返回当前函数的处理结果
    id: `navigation:${row.id}`, // 全局键
    scope: 'navigation', // 来源域
    title: row.name, // 链接名称
    subtitle: `${row.group_name} · ${row.status}`, // 分组 + 可达性状态
    snippet: `${row.description} ${row.url}`, // 说明 + 地址
    href: row.url, // 直接跳转目标地址
    keywords: `${row.url} ${row.description}`, // 地址与说明参与检索
    popularity: row.status === 'ok' ? 1 : 0, // 可达链接优先
    updated_at: row.last_checked_at ?? '', // 最近探测时间
  })); // 逐行映射
} // navigationDocs 结束

/** 读取社区帖子：表由社区模块维护，缺表或字段变化都不能拖垮搜索 */
function communityDocs(db: Db): SearchDocument[] {
  if (!tableExists(db, 'community_threads')) return []; // 表缺失则跳过
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const rows = db.prepare( // 常量 rows：保存固定配置或一次性派生值
      `SELECT t.id, t.title, t.summary, t.body, t.kind, t.price_cents, t.views, t.likes, t.created_at, b.name AS board_name
         FROM community_threads t
         LEFT JOIN community_boards b ON b.id = t.board_id
        WHERE t.status = 'published'`,
    ).all() as Array<{ id: string; title: string; summary: string; body: string; kind: string; price_cents: number; views: number; likes: number; created_at: string; board_name: string | null }>; // 联表取板块名
    return rows.map((row) => doc({ // 返回当前函数的处理结果
      id: `community:${row.id}`, // 全局键
      scope: 'community', // 来源域
      title: row.title, // 帖子标题
      subtitle: `${row.board_name ?? '社区'} · ${row.kind}${row.price_cents > 0 ? ' · 付费' : ''}`, // 板块 / 形态 / 付费标记
      snippet: `${row.summary} ${row.body}`, // 摘要与正文
      href: '/community', // 社区视图（上线前的未知路径由路由安全回退）
      keywords: `${row.summary} ${row.body}`, // 摘要与正文参与检索
      popularity: row.views + row.likes, // 浏览 + 点赞作为热度
      updated_at: row.created_at, // 创建时间（帖子暂无独立更新时间）
    })); // 逐行映射
  } catch { // 代码块结束
    return []; // 字段结构与预期不符时静默跳过，保证搜索整体可用
  } // try/catch 结束
} // communityDocs 结束

/** 读取独立商城商品 */
function shopDocs(db: Db): SearchDocument[] {
  if (!tableExists(db, 'shop_products')) return []; // 表缺失则跳过
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const rows = db.prepare( // 常量 rows：保存固定配置或一次性派生值
      "SELECT id, code, name, summary, kind, price_cents, stock, status, created_at FROM shop_products WHERE status = 'active'", // 执行当前业务步骤
    ).all() as Array<{ id: string; code: string; name: string; summary: string; kind: string; price_cents: number; stock: number; status: string; created_at: string }>; // 只取在售商品
    return rows.map((row) => doc({ // 返回当前函数的处理结果
      id: `shop:${row.id}`, // 全局键
      scope: 'shop', // 来源域
      title: row.name, // 商品名
      subtitle: `${row.kind} · ¥${(row.price_cents / 100).toFixed(2)}`, // 类型 + 价格
      snippet: row.summary, // 商品简介
      href: '/shop', // 商城视图（上线前的未知路径由路由安全回退）
      keywords: `${row.code} ${row.kind} ${row.summary}`, // 商品编码、类型与简介
      popularity: row.stock, // 库存仅作同分排序的稳定因子
      updated_at: row.created_at, // 创建时间
    })); // 逐行映射
  } catch { // 代码块结束
    return []; // 字段不一致时跳过
  } // try/catch 结束
} // shopDocs 结束

/** 汇总全部来源：任何单一来源异常都不应让整次搜索失败 */
export function collectDocuments(db: Db): SearchDocument[] {
  const safe = (fn: () => SearchDocument[]): SearchDocument[] => { // 小包装：统一吞掉来源级异常
    try { // 异常捕获起点：包裹可能抛出错误的操作
      return fn(); // 正常执行
    } catch { // 代码块结束
      return []; // 单来源失败降级为空集
    } // try/catch 结束
  }; // safe 结束
  return [ // 返回当前函数的处理结果
    ...safe(() => moduleDocs(db)), // 模块
    ...safe(() => entryDocs()), // 入口
    ...safe(() => navigationDocs(db)), // 导航
    ...safe(() => communityDocs(db)), // 社区
    ...safe(() => shopDocs(db)), // 商品
  ]; // 合并五类来源
} // collectDocuments 结束

/** 计算匹配分：标题 > 副标题 > 关键词正文，分数只用于排序，不对外承诺精确性 */
function scoreOf(item: SearchDocument, query: string): number {
  const q = query.toLowerCase(); // 统一小写
  const title = item.title.toLowerCase(); // 标题
  const subtitle = item.subtitle.toLowerCase(); // 副标题
  const keywords = item.keywords.toLowerCase(); // 正文与标签
  let score = 0; // 初始分
  if (title === q) score = 140; // 标题完全相等最高
  else if (title.startsWith(q)) score = 120; // 标题前缀命中
  else if (title.includes(q)) score = 95; // 标题包含
  if (subtitle.includes(q)) score += 35; // 副标题命中加权
  if (keywords.includes(q)) score += 20; // 正文命中保底
  return score; // 返回总分
} // scoreOf 结束

/** 搜索并分组：每个来源单独截断 limit 条，避免某个大来源淹没其它来源 */
export function searchDocuments(
  documents: SearchDocument[], // 对象字段 documents：记录一项配置或数据
  query: string, // 对象字段 query：记录一项配置或数据
  scopes: readonly SearchScope[], // 对象字段 scopes：记录一项配置或数据
  limit: number, // 对象字段 limit：记录一项配置或数据
): SearchGroup[] { // 执行当前业务步骤
  const q = query.trim(); // 去掉首尾空白
  if (!q) return []; // 空查询不返回任何结果
  const groups: SearchGroup[] = []; // 结果收集
  for (const scope of scopes) { // 按固定顺序逐来源处理
    const hits = documents // 常量 hits：保存固定配置或一次性派生值
      .filter((item) => item.scope === scope) // 只看本来源
      .map((item) => ({ ...item, score: scoreOf(item, q) })) // 计算分数
      .filter((item) => item.score > 0) // 丢弃未命中
      .sort((a, b) => b.score - a.score || b.popularity - a.popularity || b.updated_at.localeCompare(a.updated_at)) // 分数 → 热度 → 更新时间
      .slice(0, limit); // 本来源截断
    groups.push({ // 执行当前业务步骤
      scope, // 来源
      label: SEARCH_SCOPE_LABELS[scope], // 中文组名
      count: hits.length, // 本组条数
      items: hits.map((item) => ({ ...item, snippet: excerpt(item.snippet || item.title, q) })), // 输出前按查询截取片段
    }); // 分组结束
  } // 来源循环结束
  return groups.filter((group) => group.count > 0); // 空分组不返回，前端页签只展示有结果的来源
} // searchDocuments 结束

/** Meilisearch 连接配置：三项未配齐即视为未启用，绝不假装可用 */
export interface MeiliConfig {
  url: string; // 实例地址，去掉尾斜杠
  index: string; // 索引名
  key: string; // API Key
} // 代码块结束

/** 从环境变量解析 Meilisearch 配置：缺任一项返回 null，调用方走 SQLite */
export function meiliConfig(env: Record<string, string | undefined>): MeiliConfig | null {
  const url = (env.MIM_MEILISEARCH_URL ?? '').trim().replace(/\/+$/, ''); // 地址
  const key = (env.MIM_MEILISEARCH_KEY ?? '').trim(); // 密钥
  const index = (env.MIM_MEILISEARCH_INDEX ?? 'mim_search').trim(); // 索引名，缺省 mim_search
  if (!url || !key || !index) return null; // 缺项即未配置
  return { url, index, key }; // 返回完整配置
} // meiliConfig 结束

/** 把全部文档推送到 Meilisearch：先建索引再批量写文档，返回是否成功 */
export async function reindexMeili(config: MeiliConfig, documents: SearchDocument[]): Promise<{ pushed: number }> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${config.key}` }; // 统一请求头
  const create = await fetch(`${config.url}/indexes`, { // 建索引：已存在时 Meilisearch 返回 409，可忽略
    method: 'POST', // 创建动作
    headers, // 请求头
    body: JSON.stringify({ uid: config.index, primaryKey: 'id' }), // 主键固定为 id
  }); // 创建请求结束
  if (!create.ok && create.status !== 409) { // 409 代表索引已存在，其余错误直接抛出
    throw new Error(`meilisearch create index failed: ${create.status}`); // 交由路由转 502 语义
  } // 创建结果判定结束
  const payload = documents.map((item) => ({ ...item })); // 文档原样推送，字段名与 SearchDocument 一致
  const res = await fetch(`${config.url}/indexes/${encodeURIComponent(config.index)}/documents`, { // 批量写入
    method: 'PUT', // PUT 为增量更新，重复推送幂等
    headers, // 请求头
    body: JSON.stringify(payload), // 文档数组
  }); // 写入请求结束
  if (!res.ok) throw new Error(`meilisearch write documents failed: ${res.status}`); // 写入失败必须显式报错
  return { pushed: payload.length }; // 回传条数便于运维核对
} // reindexMeili 结束

/** 用 Meilisearch 检索：失败或未命中时返回 null，由调用方降级到本地检索 */
export async function searchMeili(
  config: MeiliConfig, // 对象字段 config：记录一项配置或数据
  query: string, // 对象字段 query：记录一项配置或数据
  scopes: readonly SearchScope[], // 对象字段 scopes：记录一项配置或数据
  limit: number, // 对象字段 limit：记录一项配置或数据
): Promise<SearchHit[] | null> { // 执行当前业务步骤
  const res = await fetch(`${config.url}/indexes/${encodeURIComponent(config.index)}/search`, { // 检索端点
    method: 'POST', // Meilisearch 统一用 POST 传查询
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` }, // 请求头
    body: JSON.stringify({ q: query, limit: limit * scopes.length, attributesToRetrieve: ['id', 'scope', 'title', 'subtitle', 'snippet', 'href', 'popularity', 'updated_at', 'keywords'] }), // 只取展示字段
  }); // 检索请求结束
  if (!res.ok) return null; // 上游异常 → 降级
  const body = (await res.json()) as { hits?: Array<Record<string, unknown>> }; // Meilisearch 返回 hits
  if (!Array.isArray(body.hits)) return null; // 结构异常 → 降级
  return body.hits.map((hit) => ({ // 返回当前函数的处理结果
    id: String(hit.id ?? ''), // 全局键
    scope: String(hit.scope ?? '') as SearchScope, // 来源
    title: String(hit.title ?? ''), // 标题
    subtitle: String(hit.subtitle ?? ''), // 副标题
    snippet: excerpt(String(hit.snippet ?? ''), query), // 片段按查询重新截取
    href: String(hit.href ?? ''), // 跳转地址
    keywords: String(hit.keywords ?? ''), // 匹配文本
    popularity: Number(hit.popularity ?? 0), // 热度
    updated_at: String(hit.updated_at ?? ''), // 更新时间
    score: 1, // Meilisearch 已排序，分数不参与二次排序
  })).filter((hit) => scopes.includes(hit.scope)); // 只保留请求的来源
} // searchMeili 结束
