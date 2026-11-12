/**
 * 全站资源导航站路由（NAVIGATION，2026-11-12）：把入口清单里的「导航」模块落成可运行功能。
 *
 * 闭环：收录入口 → 目录检索/推荐位 → 服务端可达性探测 → 失效标记 → 点击跳转（浏览器直达）→ 状态回写取证。
 *
 * 设计边界（与 siteModules.json 中 NAVIGATION 的职责一致）：
 *   - 只维护链接目录、可达性状态与检索推荐位，不承载被链系统的内容；
 *   - 不负责 DNS 解析与跳转决策：跳转由浏览器直接发起，本模块只记录可达性与探测取证；
 *   - 浏览类端点公开（与商城 / 站点矩阵一致的按需登录模型），写操作与探测统一 requireAuth + idempotency。
 *
 * 路由一览（/api/v1 前缀由 app.ts 统一挂载）：
 *   GET   /navigation/summary            公开 — 三态计数 / 分组计数 / 最近探测时间
 *   GET   /navigation/links              公开 — 链接目录，支持 q / group / status / recommended 过滤
 *   POST  /navigation/links              鉴权 — 新增链接
 *   PATCH /navigation/links/:id          鉴权 — 改名 / 分组 / 说明 / 推荐位 / 地址
 *   POST  /navigation/links/:id/check    鉴权 — 单条可达性探测
 *   POST  /navigation/check              鉴权 — 全目录可达性探测
 */

import { Router } from 'express'; // Express 路由容器
import { z } from 'zod'; // 声明式请求校验
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一异常 + 时间有序主键
import {
  NAV_LINK_STATUSES, // 三态枚举，供查询参数校验
  normalizeNavUrl, // 地址归一化：http(s) 或站内相对路径
  resolveProbeTarget, // 相对路径按 origin 补齐
  summarizeNavLinks, // 目录汇总口径
} from '@mim/core-domain'; // 共享契约，前后端同一判定
import type { NavLinkStatus, NavLinkView } from '@mim/core-domain'; // 状态与视图类型
import { requireAuth, idempotency } from '../middleware.js'; // 登录门禁 + 幂等回放
import { parse } from '../validate.js'; // zod 失败统一转 VALIDATION_FAILED
import { nowIso, pathParam } from '../utils.js'; // 可注入时钟 + 严格路径参数
import { probeOutbound } from '../navigationProbe.js'; // 出站探测：先过 SSRF 校验再发起 fetch
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与库类型

/** nav_links 表行结构 */
interface NavLinkRow {
  // 主键
  id: string;
  // 名称
  name: string;
  // 地址
  url: string;
  // 分组
  group_name: string;
  // 说明
  description: string;
  // 推荐位：0 / 1
  recommended: number;
  // 三态
  status: NavLinkStatus;
  // 最近 HTTP 状态码
  http_status: number | null;
  // 最近耗时
  latency_ms: number | null;
  // 最近探测时间
  last_checked_at: string | null;
  // 创建者
  created_by: string;
  // 创建时间
  created_at: string;
  // 更新时间
  updated_at: string;
}

/** 行 → 对外视图：数值位宽与布尔语义在这里收口 */
function linkView(row: NavLinkRow): NavLinkView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    group: row.group_name,
    description: row.description,
    recommended: row.recommended === 1,
    status: row.status,
    http_status: row.http_status,
    latency_ms: row.latency_ms,
    last_checked_at: row.last_checked_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
} // linkView 结束

/** 新增链接请求体 */
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2048),
  group: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(200).optional(),
  recommended: z.boolean().optional(),
});

/** 修改链接请求体：至少给一个字段，避免空更新 */
const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  group: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(200).optional(),
  recommended: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

/** 单次全目录探测上限：避免一次请求把大量外部调用串起来 */
const BATCH_LIMIT = 50;

/** 路由工厂：由 createApp 注入依赖后挂载 */
export function createNavigationRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例
  const db: Db = deps.db; // 数据库句柄

  /** 探测目标 origin：优先取运行环境配置，缺省落生产域名（仅用于补齐站内相对路径） */
  function origin(): string {
    return (deps.env?.MIM_PUBLIC_ORIGIN ?? 'https://mim.mixm.top').replace(/\/+$/, ''); // 去尾斜杠，避免拼出双斜杠
  } // origin 结束

  /** 受信 origin 的 host:port：站内相对路径补齐后的自指目标据此跳过私网/环回复核 */
  function trustedHost(): string {
    try {
      return new URL(origin()).host;
    } catch {
      return '';
    }
  } // trustedHost 结束

  /** 按主键取行，不存在直接 404 */
  function requireLink(id: string): NavLinkRow {
    const row = db.prepare('SELECT * FROM nav_links WHERE id = ?').get(id) as NavLinkRow | undefined; // 单行查询
    if (!row) throw new AppError('NOT_FOUND', `link not found: ${id}`, { id }); // 未命中回 404
    return row; // 返回行
  } // requireLink 结束

  /** 读取全目录（供汇总使用） */
  function allLinks(): NavLinkView[] {
    return (db.prepare('SELECT * FROM nav_links ORDER BY group_name, recommended DESC, name').all() as NavLinkRow[]).map(linkView); // 排序后映射
  } // allLinks 结束

  // ---------- 公开：目录汇总 ----------

  /** GET /navigation/summary — 三态计数 / 分组计数 / 最近探测时间 */
  router.get('/navigation/summary', (_req, res) => { // 公开只读
    res.json({ schema: 'mim.navigation.v1', summary: summarizeNavLinks(allLinks()) }); // 统一汇总口径
  }); // GET /navigation/summary 结束

  // ---------- 公开：链接目录 ----------

  /** GET /navigation/links — 支持 q（名称/地址/说明）、group、status、recommended 过滤 */
  router.get('/navigation/links', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''; // 关键词
    const group = typeof req.query.group === 'string' ? req.query.group.trim() : ''; // 分组
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : ''; // 状态
    const recommended = typeof req.query.recommended === 'string' ? req.query.recommended.trim() : ''; // 推荐位
    if (status && !NAV_LINK_STATUSES.includes(status as NavLinkStatus)) { // 状态必须落在三态内
      throw new AppError('VALIDATION_FAILED', `unknown status: ${status}`, { status, allowed: NAV_LINK_STATUSES }); // 400 并回显允许值
    } // 状态校验结束
    let items = allLinks(); // 先取全量
    if (q) items = items.filter((item) => `${item.name} ${item.url} ${item.description}`.toLowerCase().includes(q)); // 关键词过滤
    if (group) items = items.filter((item) => item.group === group); // 分组过滤
    if (status) items = items.filter((item) => item.status === status); // 状态过滤
    if (recommended === '1' || recommended === 'true') items = items.filter((item) => item.recommended); // 只看推荐位
    res.json({ schema: 'mim.navigation.v1', total: items.length, items, summary: summarizeNavLinks(items) }); // 回显过滤后集合与汇总
  }); // GET /navigation/links 结束

  // ---------- 鉴权：新增链接 ----------

  /** POST /navigation/links — 收录一条入口 */
  router.post('/navigation/links', requireAuth, idempotency, (req, res) => {
    const body = parse(createSchema, req.body); // 校验并剥离多余字段
    const url = normalizeNavUrl(body.url); // 地址归一化
    if (!url) throw new AppError('VALIDATION_FAILED', 'invalid url: only http(s) or site-relative path is allowed', { url: body.url }); // 非法地址 400
    const now = nowIso(deps.now); // 可注入时钟
    const id = uuidv7(); // 时间有序主键
    const group = body.group ?? '其他'; // 缺省分组
    db.prepare( // 插入新行
      `INSERT INTO nav_links (id, name, url, group_name, description, recommended, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?)`,
    ).run(id, body.name, url, group, body.description ?? '', body.recommended ? 1 : 0, req.user!.id, now, now); // 创建者取鉴权注入的用户
    res.status(201).json({ item: linkView(requireLink(id)) }); // 201 返回完整视图
  }); // POST /navigation/links 结束

  // ---------- 鉴权：修改链接 ----------

  /** PATCH /navigation/links/:id — 改名 / 分组 / 说明 / 推荐位 / 地址 */
  router.patch('/navigation/links/:id', requireAuth, idempotency, (req, res) => {
    const id = pathParam(req, 'id'); // 严格路径参数
    const row = requireLink(id); // 不存在 404
    const body = parse(updateSchema, req.body); // 至少一个字段
    const nextUrl = body.url === undefined ? row.url : normalizeNavUrl(body.url); // 地址变更同样要归一化
    if (nextUrl === null) throw new AppError('VALIDATION_FAILED', 'invalid url', { url: body.url }); // 非法地址 400
    const now = nowIso(deps.now); // 更新时间
    db.prepare( // 逐字段落库，未传字段保持原值
      `UPDATE nav_links SET name = ?, url = ?, group_name = ?, description = ?, recommended = ?, updated_at = ? WHERE id = ?`,
    ).run(
      body.name ?? row.name, // 名称
      nextUrl, // 地址
      body.group ?? row.group_name, // 分组
      body.description ?? row.description, // 说明
      (body.recommended === undefined ? row.recommended === 1 : body.recommended) ? 1 : 0, // 推荐位
      now, // 更新时间
      id, // 主键
    ); // run 结束
    res.json({ item: linkView(requireLink(id)) }); // 返回更新后视图
  }); // PATCH /navigation/links/:id 结束

  // ---------- 鉴权：可达性探测 ----------

  /** POST /navigation/links/:id/check — 单条探测并回写状态 */
  router.post('/navigation/links/:id/check', requireAuth, idempotency, async (req, res) => {
    const id = pathParam(req, 'id'); // 严格路径参数
    const row = requireLink(id); // 不存在 404
    const result = await probeOutbound(resolveProbeTarget(row.url, origin()), trustedHost()); // 探测：先过 SSRF 校验，相对路径按 origin 补齐
    const now = nowIso(deps.now); // 探测时间
    db.prepare( // 回写状态、HTTP 码、耗时与时间
      'UPDATE nav_links SET status = ?, http_status = ?, latency_ms = ?, last_checked_at = ?, updated_at = ? WHERE id = ?',
    ).run(result.status, result.httpStatus, result.latencyMs, now, now, id); // 单行更新
    res.json({ item: linkView(requireLink(id)) }); // 返回含最新状态的行
  }); // POST /navigation/links/:id/check 结束

  /** POST /navigation/check — 全目录探测（上限 BATCH_LIMIT，逐条串行避免打爆外部站点） */
  router.post('/navigation/check', requireAuth, idempotency, async (_req, res) => {
    const rows = db.prepare('SELECT * FROM nav_links ORDER BY group_name, name LIMIT ?').all(BATCH_LIMIT) as NavLinkRow[]; // 取前 N 条
    const now = nowIso(deps.now); // 本次批次时间
    const update = db.prepare( // 逐条回写
      'UPDATE nav_links SET status = ?, http_status = ?, latency_ms = ?, last_checked_at = ?, updated_at = ? WHERE id = ?',
    ); // prepare 结束
    const results: NavLinkView[] = []; // 探测结果
    for (const row of rows) { // 串行探测：外部站点不宜并发轰炸
      const result = await probeOutbound(resolveProbeTarget(row.url, origin()), trustedHost()); // 单条探测（SSRF 校验在探针内完成）
      update.run(result.status, result.httpStatus, result.latencyMs, now, now, row.id); // 回写
      results.push(linkView(requireLink(row.id))); // 收集最新视图
    } // 循环结束
    const summary = summarizeNavLinks(allLinks()); // 全目录汇总（含未探测条目）
    res.json({ schema: 'mim.navigation.v1', checked: results.length, items: results, summary }); // 回显本批结果与全量汇总
  }); // POST /navigation/check 结束

  return router; // 返回路由实例
} // createNavigationRouter 结束
