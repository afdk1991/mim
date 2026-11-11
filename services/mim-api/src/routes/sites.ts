/**
 * 站点模块运行时路由（2026-11-09）：把去重后的 44 个入口落成可运行模块。
 *
 * 设计边界：
 *   - 模块 / 业务域 / 能力点为静态契约（packages/core-domain/src/siteModules.json），不在库里复制一份；
 *   - 入口一律用可配置占位标识寻址，不绑定任何具体主机值；:host 路径参数保留只为兼容既有调用，
 *     其取值现在是占位键（如 BLOG），不是 DNS 主机记录；
 *   - 业务条目落在 site_module_items 表，按「占位键 + capability」隔离；
 *   - 浏览类端点全部公开（与商城一致的按需登录模型），写操作统一 requireAuth + idempotency；
 *   - 备注本身只有「入口描述｜业务系统说明」，无功能规格，故只做最小可运行功能，不臆造业务流程；
 *   - 清单 / 职责 / 关联 / 占位配置由 createEntriesRouter 单独提供，本路由只负责运行时能力。
 *
 * 路由一览（/api/v1 前缀由 app.ts 统一挂载）：
 *   GET    /sites/overview                公开 — 全站汇总（入口/能力/业务域/条目/占位状态）
 *   GET    /sites                         公开 — 44 个入口列表，支持 q / domain（兼容 group）过滤
 *   GET    /sites/:host                   公开 — 单入口详情（备注原文、行号、能力点、条目统计）
 *   GET    /sites/:host/capabilities      公开 — 单入口能力点清单
 *   GET    /sites/:host/items             公开 — 业务条目列表，支持 capability / status 过滤
 *   POST   /sites/:host/items             鉴权 — 新建业务条目（写操作带幂等键）
 *   POST   /sites/:host/items/:id/transition 鉴权 — 状态流转（写操作带幂等键）
 *
 * 注意：/sites/overview 必须注册在 /sites/:host 之前，否则会被详情路由当作占位键吞掉。
 */

import { Router } from 'express'; // Express 路由容器，按 /api/v1 前缀挂载
import { z } from 'zod'; // 请求体声明式校验，与 catalog / comic 域保持一致
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import {
  SITE_CAPABILITY_KINDS, // 三类能力的状态机字典（catalog / manage / record）
  SITE_DOMAINS, // 19 个业务域，供前端筛选与后端汇总
  SITE_MODULES, // 44 个去重入口静态契约
  defaultSiteState, // 取能力默认状态（states 首项）
  findSiteCapability, // 按占位键 + 能力编码查功能点
  findSiteModule, // 按占位键查入口
  implementationSummary, // 落地状态四态计数
  isSiteState, // 判断状态是否属于能力合法集合
  resolveEntryHost, // 解析入口占位标识的配置状态
  siteModulesRegistry, // 顶层元信息：去重口径 / 主机配置策略
  siteModulesSummary, // 注册表规模汇总
} from '@mim/core-domain'; // 共享包单一数据源，前后端共用同一份清单
import { requireAuth, idempotency } from '../middleware.js'; // 登录门禁 + 写操作幂等回放
import { parse } from '../validate.js'; // zod 校验失败统一转 VALIDATION_FAILED
import { nowIso, pathParam } from '../utils.js'; // 可注入时钟 + 严格路径参数提取
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与数据库抽象类型

// 业务条目数据库行结构，与 schema.sql 的 site_module_items 一一对应。
interface SiteItemRow {
  // 条目主键（uuidv7 或稳定的演示数据主键）。
  id: string;
  // 短主机记录，作为模块级隔离键。
  host: string;
  // 能力编码：catalog / manage / record。
  capability: string;
  // 条目标题。
  title: string;
  // 条目说明，演示数据会明确标注非真实业务数据。
  detail: string;
  // 当前状态，取值落在该能力 states 内。
  status: string;
  // 创建者：演示数据为 system，用户新建为登录用户 id。
  created_by: string;
  // 创建时间（ISO-8601 UTC）。
  created_at: string;
  // 最近更新时间（ISO-8601 UTC）。
  updated_at: string;
} // SiteItemRow 结束

// 新建条目请求体：标题必填且限长，说明可选，状态可省略走能力默认态。
const createItemSchema = z.object({
  // 能力编码必填，后续再按模块契约校验其存在性。
  capability: z.string().min(1),
  // 标题 1–120 字，去掉首尾空白后仍不得为空。
  title: z.string().trim().min(1).max(120),
  // 说明可选，最长 500 字，缺省为空串。
  detail: z.string().max(500).optional().default(''),
  // 状态可选；给了也必须落在该能力 states 内，否则 400。
  status: z.string().optional(),
}); // createItemSchema 结束

// 状态流转请求体：目标状态必填，由路由按能力 states 二次校验。
const transitionSchema = z.object({
  // 目标状态，例如 active / archived / done。
  status: z.string().min(1),
}); // transitionSchema 结束

// 按 host 解析模块，未登记时抛 404，避免把非法主机记录当作空模块返回。
function requireModule(host: string) {
  // 复用共享包索引，保证前后端对「哪些主机存在」的判定完全一致。
  const module = findSiteModule(host);
  // 未命中统一 NOT_FOUND，并在 details 回显 host 便于排查。
  if (!module) throw new AppError('NOT_FOUND', `site module not found: ${host}`, { host });
  // 返回非空模块，后续代码无需再做空值判断。
  return module;
} // requireModule 结束

// 把数据库行映射为对外视图；字段逐个显式列出，避免把内部列意外透出。
function itemView(row: SiteItemRow) {
  // 保持与前端 SiteModuleItem 类型一一对应的九个字段。
  return {
    // 条目主键。
    id: row.id,
    // 所属模块短主机记录。
    host: row.host,
    // 所属能力编码。
    capability: row.capability,
    // 条目标题。
    title: row.title,
    // 条目说明。
    detail: row.detail,
    // 当前状态。
    status: row.status,
    // 创建者标识。
    created_by: row.created_by,
    // 创建时间。
    created_at: row.created_at,
    // 最近更新时间。
    updated_at: row.updated_at,
  };
} // itemView 结束

// 读取某模块下的条目：支持按能力与状态过滤，按创建时间倒序，保证列表稳定。
function listItems(db: Db, host: string, capability?: string, status?: string): SiteItemRow[] {
  // 动态拼条件但值全部走参数绑定，杜绝 SQL 注入。
  const clauses = ['host = ?']; // 恒定条件：按模块隔离
  const params: string[] = [host]; // 恒定参数：短主机记录
  if (capability) { // 有能力过滤才追加条件，避免空串误筛
    clauses.push('capability = ?'); // 能力编码精确匹配
    params.push(capability); // 绑定能力编码
  } // 能力过滤分支结束
  if (status) { // 有状态过滤才追加条件
    clauses.push('status = ?'); // 状态精确匹配
    params.push(status); // 绑定状态值
  } // 状态过滤分支结束
  return db // 直接返回查询结果，调用方再做视图映射
    .prepare( // 预编译查询，条件由白名单字段拼装
      `SELECT id, host, capability, title, detail, status, created_by, created_at, updated_at
         FROM site_module_items
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, id DESC`, // 同毫秒写入用 id 兜底排序
    ) // prepare 结束
    .all(...params) as SiteItemRow[]; // 参数展开绑定，结果断言为行数组
} // listItems 结束

// 统计某模块各能力的条目数与状态分布，供详情面板与汇总接口复用。
function itemStats(db: Db, host: string) {
  const rows = db // 一次聚合查询拿到全部计数，避免 N+1
    .prepare( // 预编译：按能力 + 状态分组
      `SELECT capability, status, COUNT(*) AS total
         FROM site_module_items
        WHERE host = ?
        GROUP BY capability, status`, // 仅按所属模块过滤
    ) // prepare 结束
    .all(host) as Array<{ capability: string; status: string; total: number }>; // 聚合结果结构
  const byCapability: Record<string, number> = {}; // 每能力条目总数
  const byStatus: Record<string, number> = {}; // 每状态条目总数
  let total = 0; // 模块条目总数
  for (const row of rows) { // 逐个聚合桶累加
    byCapability[row.capability] = (byCapability[row.capability] ?? 0) + row.total; // 累加到能力维度
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.total; // 累加到状态维度
    total += row.total; // 累加总数
  } // 聚合循环结束
  return { total, byCapability, byStatus }; // 三份统计一并返回
} // itemStats 结束

// 路由工厂：与其余域一致，由 createApp 注入 deps 后统一挂载。
export function createSitesRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例
  const db = deps.db; // 缓存数据库句柄，减少重复解构

  // ---------- 公开：全站汇总 ----------

  /** GET /sites/overview — 注册表规模 + 全库条目总数与状态分布（须先于 /sites/:host 注册） */
  router.get('/sites/overview', (_req, res) => { // 公开只读，匿名可访问
    const summary = siteModulesSummary(); // 从静态契约取模块/能力/分组/空备注数量
    const row = db // 一次查询全库条目总数，避免逐模块累加
      .prepare('SELECT COUNT(*) AS total FROM site_module_items') // 全表计数，数据量小可忽略成本
      .get() as { total: number }; // 单行聚合结果
    const statusRows = db // 按状态聚合，供前端分布卡片使用
      .prepare('SELECT status, COUNT(*) AS total FROM site_module_items GROUP BY status') // 状态分组
      .all() as Array<{ status: string; total: number }>; // 聚合行结构
    const byStatus: Record<string, number> = {}; // 状态 → 条数映射
    for (const item of statusRows) byStatus[item.status] = item.total; // 逐桶写入映射
    const configured = SITE_MODULES.filter((m) => resolveEntryHost(m.entryKey).configured).length; // 已注入实际主机值的入口数
    res.json({ // 统一响应体：注册表元信息 + 规模 + 库内统计
      schema: siteModulesRegistry.schema, // 契约版本 v2，前端可据此拒绝未知格式
      title: siteModulesRegistry.title, // 清单标题
      source: siteModulesRegistry.source, // 依据说明
      scope: siteModulesRegistry.scope, // 本轮取证范围
      moduleBasis: siteModulesRegistry.moduleBasis, // 模块划分依据
      note_format: siteModulesRegistry.noteFormat, // 备注格式说明
      derivation: siteModulesRegistry.derivation, // 明确哪些内容属于实现推导
      ...summary, // 字段：modules / capabilities / groups / blankRows / domains
      placeholders: SITE_MODULES.length + 2, // 44 入口 + @ 根域名占位 + 空白占位
      configured, // 已由外部配置注入实际主机值的入口数，默认 0
      unconfigured: SITE_MODULES.length - configured, // 仍为占位状态的入口数
      implementation: implementationSummary(SITE_MODULES), // 落地状态四态计数
      hostConfig: siteModulesRegistry.hostConfig, // 不补写具体主机值的策略
      items: row.total, // 库内业务条目总数
      by_status: byStatus, // 按状态分布
    }); // 响应结束
  }); // GET /sites/overview 结束

  // ---------- 公开：模块列表 ----------

  /** GET /sites — 44 个入口清单，支持 q（占位键/系统名/备注/职责）与 domain（兼容 group）过滤 */
  router.get('/sites', (req, res) => { // 公开只读，与商城目录同一访问模型
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''; // 搜索词小写化
    // 业务域编码优先取 domain，兼容旧调用仍传 group；两者都给时以 domain 为准。
    const domain = typeof req.query.domain === 'string' && req.query.domain.trim()
      ? req.query.domain.trim() // 新口径：19 个业务域
      : (typeof req.query.group === 'string' ? req.query.group.trim() : ''); // 兼容口径：旧分组参数
    const modules = SITE_MODULES // 从静态契约出发，不查库，保证列表完整
      .filter((m) => !domain || m.domain === domain || m.group === domain) // 业务域过滤，空串表示不过滤
      .filter((m) => !q || [ // 多字段包含匹配，覆盖占位标识与职责字段
        m.entryKey, m.placeholder, m.system, m.entry, m.note, m.domainName,
        ...m.coreFunctions, ...m.responsibility.inScope, ...m.responsibility.outOfScope,
      ].some((v) => String(v).toLowerCase().includes(q))) // 任一字段命中即保留
      .map((m) => ({ // 列表视图：入口定义 + 职责摘要 + 条目数，避免传输全部演示数据
        id: m.id, // 两位序号
        host: m.host, // 兼容字段：等于占位键，不是具体主机值
        entryKey: m.entryKey, // 稳定入口标识（占位键）
        placeholder: m.placeholder, // 可配置占位标识
        envKey: m.envKey, // 运行期配置注入键
        configured: resolveEntryHost(m.entryKey).configured, // 是否已配置实际主机值
        entry: m.entry, // 入口描述
        system: m.system, // 业务系统/模块说明
        note: m.note, // 备注原文（唯一比对基准）
        sheet: m.sheet, // 来源工作表
        rows: m.rows, // 表内行号
        group: m.group, // 兼容字段：等于业务域编码
        domain: m.domain, // 业务域编码
        domainName: m.domainName, // 业务域中文名
        coreFunctions: m.coreFunctions, // 核心功能清单
        responsibility: m.responsibility, // 职责边界
        adminRole: m.adminRole, // 后台管理职责
        apiRole: m.apiRole, // 接口职责
        related: m.related, // 相似模块关联与区分
        implementation: m.implementation, // 落地状态映射（真实模块 / 视图 / 边界）
        capability_count: m.capabilities.length, // 功能点数量（恒为 3）
        item_count: itemStats(db, m.host).total, // 该入口当前业务条目数
      })); // 列表映射结束
    res.json({ // 统一响应体：业务域 + 兼容分组 + 入口 + 总数
      domains: SITE_DOMAINS, // 19 个业务域，供前端渲染筛选控件
      groups: SITE_DOMAINS, // 兼容旧字段名，内容已是业务域
      total: modules.length, // 过滤后的入口数
      modules, // 入口数组
    }); // 响应结束
  }); // GET /sites 结束

  // ---------- 公开：单模块详情与能力点 ----------

  /** GET /sites/:host — 模块详情（备注原文、行号、能力点、演示数据、条目统计） */
  router.get('/sites/:host', (req, res) => { // 公开只读
    const host = pathParam(req, 'host'); // 严格取路径参数，非字符串一律 400
    const module = requireModule(host); // 未登记主机记录直接 404
    res.json({ // 统一响应体：模块契约 + 能力字典 + 实时统计
      module, // 完整模块定义（含 capabilities 与 seed）
      capability_kinds: SITE_CAPABILITY_KINDS, // 三类能力的状态机说明
      stats: itemStats(db, host), // 该模块条目数与状态分布
    }); // 响应结束
  }); // GET /sites/:host 结束

  /** GET /sites/:host/capabilities — 单模块能力点清单（供前端单独拉取） */
  router.get('/sites/:host/capabilities', (req, res) => { // 公开只读
    const host = pathParam(req, 'host'); // 严格取路径参数
    const module = requireModule(host); // 未登记主机记录直接 404
    res.json({ // 统一响应体：能力点 + 状态机字典
      host, // 回显主机记录
      capabilities: module.capabilities, // 能力点数组
      kinds: SITE_CAPABILITY_KINDS, // 各能力允许的状态
    }); // 响应结束
  }); // GET /sites/:host/capabilities 结束

  // ---------- 公开：业务条目列表 ----------

  /** GET /sites/:host/items — 条目列表，支持 capability / status 精确过滤 */
  router.get('/sites/:host/items', (req, res) => { // 公开只读：浏览匿名可访问
    const host = pathParam(req, 'host'); // 严格取路径参数
    requireModule(host); // 先确认模块存在，避免返回孤儿数据
    const capability = typeof req.query.capability === 'string' ? req.query.capability.trim() : ''; // 能力过滤
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : ''; // 状态过滤
    if (capability && !findSiteCapability(host, capability)) { // 能力编码必须属于该模块
      throw new AppError('VALIDATION_FAILED', `unknown capability: ${capability}`, { host, capability }); // 400 并回显上下文
    } // 能力校验结束
    const items = listItems(db, host, capability || undefined, status || undefined).map(itemView); // 查询并映射为对外视图
    res.json({ host, items, total: items.length }); // 回显过滤条件所属模块与总数
  }); // GET /sites/:host/items 结束

  // ---------- 鉴权：新建业务条目 ----------

  /** POST /sites/:host/items — 在指定模块能力下新增条目（登录 + 幂等） */
  router.post('/sites/:host/items', requireAuth, idempotency, (req, res) => { // 写操作：鉴权在前，幂等在后
    const host = pathParam(req, 'host'); // 严格取路径参数
    requireModule(host); // 未登记主机记录直接 404
    const body = parse(createItemSchema, req.body); // zod 校验并剥离多余字段
    const capability = findSiteCapability(host, body.capability); // 能力必须属于该模块
    if (!capability) { // 能力不存在或跨模块引用
      throw new AppError('VALIDATION_FAILED', `unknown capability: ${body.capability}`, { host, capability: body.capability }); // 400
    } // 能力校验结束
    const status = body.status ?? defaultSiteState(capability); // 省略状态时使用能力默认态
    if (!isSiteState(capability, status)) { // 显式传入的状态也必须在合法集合内
      throw new AppError('VALIDATION_FAILED', `invalid status: ${status}`, { host, capability: capability.code, allowed: capability.states }); // 400 并回显允许值
    } // 状态校验结束
    const now = nowIso(deps.now); // 可注入时钟，测试可冻结时间
    const id = uuidv7(); // 时间有序主键，便于按创建顺序排列
    db.prepare( // 预编译插入，参数全部绑定
      `INSERT INTO site_module_items
         (id, host, capability, title, detail, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, // 九个占位符与列一一对应
    ).run(id, host, capability.code, body.title, body.detail, status, req.user!.id, now, now); // 创建者取鉴权中间件注入的用户 id
    res.status(201).json({ item: itemView({ // 201 并返回新建条目完整视图
      id, // 主键
      host, // 模块
      capability: capability.code, // 能力
      title: body.title, // 标题
      detail: body.detail, // 说明
      status, // 状态
      created_by: req.user!.id, // 创建者
      created_at: now, // 创建时间
      updated_at: now, // 更新时间
    }) }); // 响应结束
  }); // POST /sites/:host/items 结束

  // ---------- 鉴权：状态流转 ----------

  /** POST /sites/:host/items/:id/transition — 推进条目状态（登录 + 幂等） */
  router.post('/sites/:host/items/:id/transition', requireAuth, idempotency, (req, res) => { // 写操作：鉴权在前，幂等在后
    const host = pathParam(req, 'host'); // 严格取路径参数
    const id = pathParam(req, 'id'); // 条目主键，禁止数组型参数
    requireModule(host); // 未登记主机记录直接 404
    const body = parse(transitionSchema, req.body); // 目标状态必填
    const row = db.prepare( // 按「主键 + 模块」查询，杜绝跨模块操作他人条目
      'SELECT * FROM site_module_items WHERE id = ? AND host = ?', // 双条件限定作用域
    ).get(id, host) as SiteItemRow | undefined; // 未命中为 undefined
    if (!row) throw new AppError('NOT_FOUND', `site item not found: ${id}`, { host, id }); // 404 且不区分「不存在」与「不属于该模块」
    const capability = findSiteCapability(host, row.capability); // 取该条目所属能力的状态机
    if (!capability) throw new AppError('CONFLICT', `capability drifted: ${row.capability}`, { host, id }); // 契约漂移属数据异常，409
    if (!isSiteState(capability, body.status)) { // 目标状态必须在能力允许集合内
      throw new AppError('VALIDATION_FAILED', `invalid status: ${body.status}`, { host, id, allowed: capability.states }); // 400 并回显允许值
    } // 目标状态校验结束
    if (row.status === body.status) { // 同态重复提交无副作用
      throw new AppError('CONFLICT', `item already in status: ${body.status}`, { host, id }); // 409 提示调用方
    } // 同态判定结束
    if (row.status === 'archived') { // 归档为终态，禁止再流转，避免演示数据被意外复活
      throw new AppError('CONFLICT', 'archived item is terminal', { host, id }); // 409 并说明终态语义
    } // 终态判定结束
    const now = nowIso(deps.now); // 可注入时钟
    db.prepare( // 预编译更新，仅改状态与更新时间
      'UPDATE site_module_items SET status = ?, updated_at = ? WHERE id = ? AND host = ?', // 双条件限定作用域
    ).run(body.status, now, id, host); // 绑定目标状态、时间与作用域
    res.json({ item: itemView({ ...row, status: body.status, updated_at: now }) }); // 返回流转后的完整视图
  }); // POST /sites/:host/items/:id/transition 结束

  return router; // 返回装配完成的路由
} // createSitesRouter 结束
