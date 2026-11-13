/**
 * 自研工具发布路由（2026-11-13）：工具清单 / 详情 / 版本记录 / 下载与文档链接 / 标签。
 *
 * 设计边界：
 *   - 公开浏览：GET /tools 与 GET /tools/:slug 只回 status='active'，匿名可访问；
 *   - 管理端：GET /tools/manage 全状态清单，POST /tools、PUT /tools/:slug、DELETE /tools/:slug
 *     走 requirePermission('appearance:write') 与写操作幂等；
 *   - 版本记录与标签以 JSON 字符串落库，读取时解析，脏数据回落空数组，不拖垮列表；
 *   - 统一 snake_case；/tools/manage 必须先于 /tools/:slug 注册，避免被详情路由吞掉。
 *
 * 路由一览（/api/v1 前缀由 app.ts 统一挂载；本工厂不改动 app.ts，由主控装配挂载）：
 *   GET    /tools            公开 — 上线工具清单（支持 q 关键词 / tag 标签过滤）
 *   GET    /tools/manage     管理 — 全状态工具清单（含草稿 / 归档）
 *   GET    /tools/:slug      公开 — 工具详情（版本记录 / 链接 / 标签）
 *   POST   /tools            管理 — 新建工具
 *   PUT    /tools/:slug      管理 — 更新工具信息 / 版本记录 / 状态
 *   DELETE /tools/:slug      管理 — 删除工具
 */

import { Router } from 'express'; // 路由容器，按 /api/v1 前缀挂载
import { randomUUID } from 'node:crypto'; // 主键生成兜底
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常：404 / 409 / 400 信封
import { idempotency, requirePermission } from '../middleware.js'; // 写操作幂等与权限门禁
import { parse } from '../validate.js'; // 校验错误翻译
import { jsonParse, nowIso, pathParam } from '../utils.js'; // JSON 兜底解析 / 时钟 / 路径参数收敛
import type { ApiDeps } from '../types.js'; // 依赖容器类型

/** 版本记录条目（对外契约）。 */
interface VersionNote {
  version: string; // 语义版本号，如 1.0.0
  title?: string; // 版本标题（可选）
  notes?: string; // 更新说明（可选）
  released_at?: string; // 发布时间 ISO（可选）
} // 代码块结束

/** 库行结构：version_notes / tags 为 JSON 字符串。 */
interface ToolRow {
  id: string; // 对象字段 id：记录一项配置或数据
  slug: string; // 对象字段 slug：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  summary: string; // 对象字段 summary：记录一项配置或数据
  version_notes: string; // 对象字段 version_notes：记录一项配置或数据
  download_url: string; // 对象字段 download_url：记录一项配置或数据
  doc_url: string; // 对象字段 doc_url：记录一项配置或数据
  tags: string; // 对象字段 tags：记录一项配置或数据
  status: string; // 对象字段 status：记录一项配置或数据
  sort_order: number; // 对象字段 sort_order：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  updated_at: string; // 对象字段 updated_at：记录一项配置或数据
} // 代码块结束

/** 对外视图：JSON 字段解析为数组，脏数据回落空数组。 */
function toView(row: ToolRow) {
  const notes = jsonParse<VersionNote[]>(row.version_notes); // 版本记录解析
  const tags = jsonParse<string[]>(row.tags); // 标签解析
  return { // 返回当前函数的处理结果
    id: row.id, // 对象字段 id：记录一项配置或数据
    slug: row.slug, // 对象字段 slug：记录一项配置或数据
    name: row.name, // 对象字段 name：记录一项配置或数据
    summary: row.summary, // 对象字段 summary：记录一项配置或数据
    version_notes: Array.isArray(notes) ? notes : [], // 非数组脏数据回落空清单
    download_url: row.download_url, // 对象字段 download_url：记录一项配置或数据
    doc_url: row.doc_url, // 对象字段 doc_url：记录一项配置或数据
    tags: Array.isArray(tags) ? tags : [], // 非数组脏数据回落空标签
    status: row.status, // 对象字段 status：记录一项配置或数据
    sort_order: row.sort_order, // 对象字段 sort_order：记录一项配置或数据
    created_at: row.created_at, // 对象字段 created_at：记录一项配置或数据
    updated_at: row.updated_at, // 对象字段 updated_at：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

const VERSION_NOTE_SCHEMA = z.object({ // 常量 VERSION_NOTE_SCHEMA：保存固定配置或一次性派生值
  version: z.string().min(1).max(40), // 版本号必填
  title: z.string().max(80).optional(), // 版本标题可选
  notes: z.string().max(2000).optional(), // 更新说明可选
  released_at: z.string().max(40).optional(), // 发布时间可选
}); // 代码块结束

/** 新建入参：slug 短标识，标签与版本记录限长。 */
const CREATE_SCHEMA = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'slug 需为小写字母 / 数字 / 连字符，2-40 位'), // 对象字段 slug：记录一项配置或数据
  name: z.string().min(1).max(80), // 名称必填
  summary: z.string().max(500).default(''), // 简介可选
  version_notes: z.array(VERSION_NOTE_SCHEMA).max(50).default([]), // 版本记录可选
  download_url: z.string().max(500).default(''), // 下载地址可选
  doc_url: z.string().max(500).default(''), // 文档地址可选
  tags: z.array(z.string().max(20)).max(20).default([]), // 标签可选
  status: z.enum(['draft', 'active', 'archived']).default('active'), // 状态默认上线
  sort_order: z.number().int().min(0).max(9999).default(100), // 排序默认靠后
}); // 代码块结束

/** 更新入参：字段全部可选，slug 不可改以免外链与收藏失效。 */
const UPDATE_SCHEMA = z.object({
  name: z.string().min(1).max(80).optional(), // 对象字段 name：记录一项配置或数据
  summary: z.string().max(500).optional(), // 对象字段 summary：记录一项配置或数据
  version_notes: z.array(VERSION_NOTE_SCHEMA).max(50).optional(), // 对象字段 version_notes：记录一项配置或数据
  download_url: z.string().max(500).optional(), // 对象字段 download_url：记录一项配置或数据
  doc_url: z.string().max(500).optional(), // 对象字段 doc_url：记录一项配置或数据
  tags: z.array(z.string().max(20)).max(20).optional(), // 对象字段 tags：记录一项配置或数据
  status: z.enum(['draft', 'active', 'archived']).optional(), // 对象字段 status：记录一项配置或数据
  sort_order: z.number().int().min(0).max(9999).optional(), // 对象字段 sort_order：记录一项配置或数据
}); // 代码块结束

/** 路由工厂：与其余域一致，由 createApp 注入 deps 后统一挂载。 */
export function createToolsRouter(deps: ApiDeps): Router {
  const router = Router(); // 常量 router：保存固定配置或一次性派生值

  /** 公开清单查询构造：只回上线条目，支持关键词与标签过滤。 */
  function listWhere(opts: { publicOnly: boolean; q: string; tag: string; status?: string }) {
    const conditions: string[] = []; // SQL 条件堆叠
    const params: unknown[] = []; // 绑定参数对齐占位符
    if (opts.publicOnly) conditions.push("status = 'active'"); // 公开面排除草稿 / 归档
    if (!opts.publicOnly && opts.status) conditions.push('status = ?'); // 管理端按状态过滤
    if (opts.q) { // 条件分支：按判断结果选择后续处理路径
      conditions.push('(name LIKE ? OR summary LIKE ? OR tags LIKE ?)'); // 名称 / 简介 / 标签模糊匹配
      const like = `%${opts.q}%`; // 常量 like：保存固定配置或一次性派生值
      params.push(like, like, like); // 执行当前业务步骤
    } // 代码块结束
    if (opts.tag) { // 条件分支：按判断结果选择后续处理路径
      conditions.push('tags LIKE ?'); // 标签命中
      params.push(`%"${opts.tag}"%`); // 执行当前业务步骤
    } // 代码块结束
    return { conditions, params }; // 返回当前函数的处理结果
  } // 代码块结束

  /** GET /tools/manage — 管理端全状态清单（须先于 /tools/:slug 注册）。 */
  router.get('/tools/manage', requirePermission('appearance:write'), (_req, res) => {
    const status = typeof _req.query.status === 'string' ? _req.query.status : ''; // 常量 status：保存固定配置或一次性派生值
    const { conditions, params } = listWhere({ publicOnly: false, q: '', tag: '', status }); // 执行当前业务步骤
    const sql = `SELECT * FROM mim_tools${conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY sort_order ASC, created_at DESC`; // 常量 sql：保存固定配置或一次性派生值
    const rows = deps.db.prepare(sql).all(...params) as ToolRow[]; // 常量 rows：保存固定配置或一次性派生值
    res.json({ items: rows.map(toView) }); // 执行当前业务步骤
  }); // 代码块结束

  /** GET /tools — 公开上线清单，支持 ?q= 关键词与 ?tag= 标签。 */
  router.get('/tools', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; // 常量 q：保存固定配置或一次性派生值
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : ''; // 常量 tag：保存固定配置或一次性派生值
    const { conditions, params } = listWhere({ publicOnly: true, q, tag }); // 执行当前业务步骤
    const sql = `SELECT * FROM mim_tools${conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY sort_order ASC, created_at DESC`; // 常量 sql：保存固定配置或一次性派生值
    const rows = deps.db.prepare(sql).all(...params) as ToolRow[]; // 常量 rows：保存固定配置或一次性派生值
    res.json({ items: rows.map(toView) }); // 执行当前业务步骤
  }); // 代码块结束

  /** GET /tools/:slug — 公开详情；未上线或不存在一律 404，不泄露草稿存在性。 */
  router.get('/tools/:slug', (req, res) => {
    const slug = pathParam(req, 'slug'); // 常量 slug：保存固定配置或一次性派生值
    const row = deps.db.prepare('SELECT * FROM mim_tools WHERE slug = ? AND status = ?').get(slug, 'active') as ToolRow | undefined; // 常量 row：保存固定配置或一次性派生值
    if (!row) throw new AppError('NOT_FOUND', '工具不存在或已下架'); // 条件分支：按判断结果选择后续处理路径
    res.json({ tool: toView(row) }); // 执行当前业务步骤
  }); // 代码块结束

  /** POST /tools — 管理端新建工具；slug 冲突回 409。 */
  router.post('/tools', requirePermission('appearance:write'), idempotency, (req, res) => {
    const body = parse(CREATE_SCHEMA, req.body); // 常量 body：保存固定配置或一次性派生值
    const exists = deps.db.prepare('SELECT 1 AS ok FROM mim_tools WHERE slug = ?').get(body.slug); // 常量 exists：保存固定配置或一次性派生值
    if (exists) throw new AppError('CONFLICT', '工具 slug 已存在'); // 条件分支：按判断结果选择后续处理路径
    const id = `tool-${randomUUID()}`; // 常量 id：保存固定配置或一次性派生值
    const ts = nowIso(deps.now); // 常量 ts：保存固定配置或一次性派生值
    deps.db // 执行当前业务步骤
      .prepare( // 执行当前业务步骤
        'INSERT INTO mim_tools (id, slug, name, summary, version_notes, download_url, doc_url, tags, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', // 执行当前业务步骤
      ) // 执行当前业务步骤
      .run( // 执行当前业务步骤
        id, // 执行当前业务步骤
        body.slug, // 执行当前业务步骤
        body.name, // 执行当前业务步骤
        body.summary, // 执行当前业务步骤
        JSON.stringify(body.version_notes), // 执行当前业务步骤
        body.download_url, // 执行当前业务步骤
        body.doc_url, // 执行当前业务步骤
        JSON.stringify(body.tags), // 执行当前业务步骤
        body.status, // 执行当前业务步骤
        body.sort_order, // 执行当前业务步骤
        ts, // 执行当前业务步骤
        ts, // 执行当前业务步骤
      ); // 执行当前业务步骤
    const row = deps.db.prepare('SELECT * FROM mim_tools WHERE id = ?').get(id) as ToolRow; // 常量 row：保存固定配置或一次性派生值
    res.status(201).json({ ok: true, tool: toView(row) }); // 执行当前业务步骤
  }); // 代码块结束

  /** PUT /tools/:slug — 管理端更新；只写提交了的字段，版本记录 / 标签整体覆盖。 */
  router.put('/tools/:slug', requirePermission('appearance:write'), idempotency, (req, res) => {
    const slug = pathParam(req, 'slug'); // 常量 slug：保存固定配置或一次性派生值
    const body = parse(UPDATE_SCHEMA, req.body); // 常量 body：保存固定配置或一次性派生值
    const row = deps.db.prepare('SELECT * FROM mim_tools WHERE slug = ?').get(slug) as ToolRow | undefined; // 常量 row：保存固定配置或一次性派生值
    if (!row) throw new AppError('NOT_FOUND', '工具不存在'); // 条件分支：按判断结果选择后续处理路径
    const ts = nowIso(deps.now); // 常量 ts：保存固定配置或一次性派生值
    const next: ToolRow = { // 常量 next：保存固定配置或一次性派生值
      ...row, // 执行当前业务步骤
      name: body.name ?? row.name, // 对象字段 name：记录一项配置或数据
      summary: body.summary ?? row.summary, // 对象字段 summary：记录一项配置或数据
      version_notes: body.version_notes !== undefined ? JSON.stringify(body.version_notes) : row.version_notes, // 对象字段 version_notes：记录一项配置或数据
      download_url: body.download_url ?? row.download_url, // 对象字段 download_url：记录一项配置或数据
      doc_url: body.doc_url ?? row.doc_url, // 对象字段 doc_url：记录一项配置或数据
      tags: body.tags !== undefined ? JSON.stringify(body.tags) : row.tags, // 对象字段 tags：记录一项配置或数据
      status: body.status ?? row.status, // 对象字段 status：记录一项配置或数据
      sort_order: body.sort_order ?? row.sort_order, // 对象字段 sort_order：记录一项配置或数据
      updated_at: ts, // 对象字段 updated_at：记录一项配置或数据
    }; // 代码块结束
    deps.db // 执行当前业务步骤
      .prepare( // 执行当前业务步骤
        'UPDATE mim_tools SET name = ?, summary = ?, version_notes = ?, download_url = ?, doc_url = ?, tags = ?, status = ?, sort_order = ?, updated_at = ? WHERE slug = ?', // 执行当前业务步骤
      ) // 执行当前业务步骤
      .run(next.name, next.summary, next.version_notes, next.download_url, next.doc_url, next.tags, next.status, next.sort_order, ts, slug); // 执行当前业务步骤
    res.json({ ok: true, tool: toView(next) }); // 执行当前业务步骤
  }); // 代码块结束

  /** DELETE /tools/:slug — 管理端删除工具；不存在回 404。 */
  router.delete('/tools/:slug', requirePermission('appearance:write'), idempotency, (req, res) => {
    const slug = pathParam(req, 'slug'); // 常量 slug：保存固定配置或一次性派生值
    const changed = deps.db.prepare('DELETE FROM mim_tools WHERE slug = ?').run(slug); // 常量 changed：保存固定配置或一次性派生值
    if (changed.changes === 0) throw new AppError('NOT_FOUND', '工具不存在'); // 条件分支：按判断结果选择后续处理路径
    res.json({ ok: true }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
