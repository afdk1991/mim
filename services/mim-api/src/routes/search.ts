/**
 * 统一搜索路由（SEARCH，2026-11-12）：一套接口检索模块 / 入口 / 导航 / 社区 / 商品。
 *
 * 设计边界：
 *   - 浏览公开：搜索本身不产生副作用，任何人（含匿名访客）都可调用；
 *   - 单一结果契约：五个来源统一成 SearchDocument，前端只认 scope/title/snippet/href；
 *   - 引擎可切换：配置 MIM_MEILISEARCH_URL + KEY 时优先走 Meilisearch，失败或无命中自动降级 SQLite，
 *     绝不让「搜索引擎没连上」变成「搜索不可用」；
 *   - 索引重建是运维动作：POST /search/reindex 需 module:read 权限（或超管引导令牌）。
 *
 * 路由一览（/api/v1 前缀由 app.ts 统一挂载）：
 *   GET  /search/summary    公开 — 各来源文档数
 *   GET  /search            公开 — 关键词检索，支持 scope / limit
 *   POST /search/reindex    鉴权 — 把当前库内文档全量推送到 Meilisearch
 */

import { Router } from 'express'; // Express 路由容器
import { z } from 'zod'; // 查询参数声明式校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { requireAuth, requirePermission } from '../middleware.js'; // 登录门禁 + 权限门禁（超管令牌可走引导通道）
import { parse } from '../validate.js'; // zod 失败统一转 VALIDATION_FAILED
import {
  SEARCH_SCOPES, // 五个来源
  SEARCH_SCOPE_LABELS, // 来源中文名
  collectDocuments, // 汇总全部来源文档
  meiliConfig, // Meilisearch 配置解析
  reindexMeili, // 全量重建索引
  searchDocuments, // 本地检索与分组
  searchMeili, // 远端检索
} from '../search.js'; // 搜索内核
import type { SearchGroup, SearchHit, SearchScope } from '../search.js'; // 分组 / 命中 / 来源类型
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 允许的来源取值：非法 scope 直接 400，不静默忽略 */
const SCOPE_VALUES = SEARCH_SCOPES as readonly string[]; // 供 zod 枚举使用

/** GET /search 查询参数 */
const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q is required').max(80), // 关键词必填且限长，防止超长串打爆匹配
  scope: z.string().trim().optional(), // 逗号分隔的来源；缺省为全部
  limit: z.coerce.number().int().min(1).max(30).optional(), // 每来源条数上限
}); // schema 结束

/** 把 scope 参数解析为来源数组：支持 `all`、单值、逗号多值 */
function resolveScopes(raw: string | undefined): SearchScope[] {
  if (!raw || raw === 'all') return [...SEARCH_SCOPES]; // 缺省与 all 都返回全部
  const parts = raw.split(',').map((item) => item.trim()).filter(Boolean); // 拆分并去空
  const unknown = parts.filter((item) => !SCOPE_VALUES.includes(item)); // 收集非法项
  if (unknown.length > 0) throw new AppError('VALIDATION_FAILED', `unknown scope: ${unknown.join(',')}`, { allowed: SCOPE_VALUES }); // 非法来源 400 并回显允许值
  return parts as SearchScope[]; // 转成来源类型
} // resolveScopes 结束

/** 把 Meilisearch 的平铺命中按来源重新分组，保持与本地检索一致的响应结构 */
function groupHits(hits: SearchHit[], scopes: SearchScope[], limit: number): SearchGroup[] {
  return scopes.map((scope) => {
    const items = hits.filter((hit) => hit.scope === scope).slice(0, limit); // 本来源截断
    return { scope, label: SEARCH_SCOPE_LABELS[scope], count: items.length, items }; // 组结构
  }).filter((group) => group.count > 0); // 空组不返回
} // groupHits 结束

/** 路由工厂 */
export function createSearchRouter(deps: ApiDeps): Router {
  const router = Router(); // 路由实例

  /** GET /search/summary — 各来源文档数量，便于前端展示「可搜范围」 */
  router.get('/search/summary', (_req, res) => {
    const documents = collectDocuments(deps.db); // 实时汇总
    const scopes = SEARCH_SCOPES.map((scope) => ({
      scope, // 来源
      label: SEARCH_SCOPE_LABELS[scope], // 中文名
      count: documents.filter((item) => item.scope === scope).length, // 该来源文档数
    })); // 逐来源统计
    res.json({ schema: 'mim.search.v1', total: documents.length, scopes, engine: meiliConfig(deps.env) ? 'meilisearch' : 'sqlite' }); // 回传规模与当前引擎
  }); // summary 结束

  /** GET /search — 统一检索 */
  router.get('/search', async (req, res) => {
    const query = parse(searchQuerySchema, req.query); // 校验查询参数
    const scopes = resolveScopes(query.scope); // 解析来源
    const limit = query.limit ?? 8; // 默认每来源 8 条
    const documents = collectDocuments(deps.db); // 本地文档全集：既用于 SQLite 检索，也用于 Meili 失败降级
    const started = Date.now(); // 计时起点
    const config = meiliConfig(deps.env); // 是否配置远端引擎
    if (config) { // 配置了 Meilisearch
      try {
        const hits = await searchMeili(config, query.q, scopes, limit); // 远端检索
        if (hits && hits.length > 0) { // 有命中才采用，避免索引滞后时返回空结果
          const groups = groupHits(hits, scopes, limit); // 重新分组
          res.json({
            schema: 'mim.search.v1', // 契约版本
            query: query.q, // 原查询
            scope: query.scope ?? 'all', // 原来源参数
            engine: 'meilisearch', // 实际引擎
            total: groups.reduce((sum, group) => sum + group.count, 0), // 总命中
            took_ms: Date.now() - started, // 耗时
            groups, // 分组结果
          }); // 响应结束
          return; // 已返回，不再走本地
        } // 命中判定结束
      } catch {
        // 远端超时 / 鉴权失败 / 索引不存在：一律降级，不把基础设施故障暴露给用户
      } // try/catch 结束
    } // 远端分支结束
    const groups = searchDocuments(documents, query.q, scopes, limit); // 本地检索
    res.json({
      schema: 'mim.search.v1', // 契约版本
      query: query.q, // 原查询
      scope: query.scope ?? 'all', // 原来源参数
      engine: 'sqlite', // 实际引擎
      total: groups.reduce((sum, group) => sum + group.count, 0), // 总命中
      took_ms: Date.now() - started, // 耗时
      groups, // 分组结果
    }); // 响应结束
  }); // GET /search 结束

  /** POST /search/reindex — 全量推送文档到 Meilisearch（运维动作） */
  router.post('/search/reindex', requireAuth, requirePermission('module:read'), async (_req, res) => {
    const config = meiliConfig(deps.env); // 读配置
    if (!config) throw new AppError('PROVIDER_NOT_CONFIGURED', 'Meilisearch is not configured: set MIM_MEILISEARCH_URL / MIM_MEILISEARCH_KEY', { provider: 'meilisearch' }); // 未配置显式 503 语义，不假装成功
    const documents = collectDocuments(deps.db); // 汇总当前全部文档
    const result = await reindexMeili(config, documents); // 推送
    res.json({ schema: 'mim.search.v1', engine: 'meilisearch', index: config.index, pushed: result.pushed }); // 回传条数
  }); // reindex 结束

  return router; // 返回路由
} // createSearchRouter 结束
