/**
 * 功能模块商城（FR-03.1，07 §5.1 / §11.11）
 *
 * catalog 域 5 表已建：modules / module_prices / entitlements / entitlement_events / module_orders；
 * 本文件补齐后端路由（此前仅有 requireEntitlement 中间件门禁，无商城侧写路径）。
 *
 * 路由一览：
 *   GET    /taxonomy                公开 — 分类导航树（19 个一级分类 → 205 个二级条目，含每条目模块数）
 *   GET    /modules                 公开 — 按 region 列出 active 模块（支持 q / category / sort / licenses / languages / page 分页）
 *   GET    /modules/hot             公开 — 当前分类下的热门模块（range=today|week，热度=Stars+窗口内新建加权；须先于 /modules/:code 注册）
 *   GET    /modules/manage          管理 — 模块全量列表（含 draft/archived，支持 q/status 过滤；须先于 /modules/:code 注册）
 *   GET    /categories/manage       管理 — 分类树全量视图（两级 + 模块计数 + 英文名；须先于 /categories/:slug 注册）
 *   POST   /categories              管理 — 新建分类（带 parent_slug 建二级，否则建一级；二级 slug 必须以「父 slug-」开头）
 *   PATCH  /categories/:slug        管理 — 改名 / 改英文名 / 改排序（slug 与父级不可改）
 *   DELETE /categories/:slug        管理 — 删除分类（有子级或有模块引用时 409 拒绝）
 *   GET    /modules/:code           公开 — 模块详情（含前置依赖、当前有效价格、历史价格）
 *   POST   /entitlements            鉴权 — 请求解锁（免费模块直接发放；付费模块 402 引导下单）
 *   GET    /me/entitlements         鉴权 — 当前用户的有效解锁列表
 *   POST   /orders                  鉴权 — 下单（金额服务端快照；已有待付单回放）
 *   GET    /orders                  鉴权 — 我的订单列表（status 过滤 + 分页）
 *   POST   /orders/:id/cancel       鉴权 — 取消待结算订单
 *   GET    /orders/manage           管理 — 跨用户订单列表（人工结算视图）
 *   POST   /orders/:id/settle       管理 — 人工结算（订单置 paid + 发放权益 + 审计事件，同事务）
 *   POST   /orders/:id/payment-notify 公开（签名）— 渠道支付回调（HMAC 校验 + 交易号幂等 + 同事务结算）
 *   POST   /modules                 管理 — 新建模块（默认 draft，code 区域内唯一，写入前做依赖环检测）
 *   PATCH  /modules/:code           管理 — 编辑模块文案/排序/前置依赖（状态变更走 /status 路由）
 *   PATCH  /modules/:code/status    管理 — 模块状态单向迁移 draft → active → archived
 *   DELETE /modules/:code           管理 — 软删除模块（active 须先归档；重复删除回放）
 *   POST   /modules/:code/prices    管理 — 新增价格行（按时间窗口生效，支持多币种）
 *   PUT    /modules/prices/:id      管理 — 更新价格行（金额、币种、生效窗口）
 *   DELETE /modules/prices/:id      管理 — 使价格行立即失效（effective_to = now，保留历史留痕）
 *   GET    /entitlements            管理 — 权益全量列表（q/status/region 过滤 + limit/offset 分页）
 *   GET    /entitlements/:id/events 管理 — 权益状态流转审计事件（按写入顺序升序）
 *   POST   /entitlements/grant      管理 — 手工发放权益（已 active 未过期直接回放现有记录）
 *   POST   /entitlements/:id/revoke 管理 — 回收权益（已 revoked 直接回放当前状态）
 *
 * 管理写路径统一走 requirePermission（RBAC：module:write / entitlement:grant / entitlement:revoke），
 * 兼容 `x-admin-token` 超管引导通道：命中 MIM_ADMIN_TOKEN 即视为拥有全部权限，用于首个超管冷启动；
 * 不挂 idempotency 中间件：该中间件依赖 req.user，而管理端只有管理令牌；
 * 三条路径均按「当前已有状态」实现天然幂等，重复提交不会产生重复权益或重复事件。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'; // 支付回调签名校验：HMAC-SHA256 + 定长时间比较
import { Router } from 'express'; // 路由容器，按前缀挂载到 /api/v1
import ExcelJS from 'exceljs'; // 订单清单导出：服务端生成 xlsx，供管理端离线对账
import { z } from 'zod'; // 请求体校验，拦截非法模块码
import { AppError, CATALOG_SORT_MODES, uuidv7 } from '@mim/core-domain'; // 业务错误码 + 时间有序主键 + 排序枚举（与前端共用一份定义）
import { clockOf } from '../domain.js'; // 可注入时钟，测试时可冻结时间
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 解锁需登录 + 幂等；管理写路径走 RBAC 权限点校验
import { parse } from '../validate.js'; // zod 校验失败统一转 AppError
import { jsonParse, pathParam } from '../utils.js'; // 安全解析 JSON 列 + 严格路径参数提取
import { handlerOfCapability } from '../capabilities.js'; // 模块真实能力执行层（Markdown / 二维码 / cron / JSON / 摘要 / 编解码）
import type { ApiDeps, Db } from '../types.js'; // 路由依赖与数据库抽象类型

const MODULE_VISIBLE = new Set(['active']); // 对外可见状态白名单，隐藏 draft/offline 模块

function escapeLike(value: string): string { // LIKE 模式转义：防止搜索词里的 % / _ / \ 被当作通配符
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`); // 先转义反斜杠自身，再转义两个通配符
} // 结束 escapeLike

function activePrice(db: Db, moduleId: string, now: string) { // 查询模块在指定时刻生效的价格
  return db // 直接返回链式查询，调用处无需再包一层
    .prepare( // 预编译 SQL，重复调用可复用语句缓存
      `SELECT currency, amount_minor, effective_from, effective_to
       FROM module_prices
       WHERE module_id = ? AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC
       LIMIT 1`,
    ) // 结束预编译，参数在执行时绑定
    .get(moduleId, now, now) as // 三个参数分别对应模块、区间起点与区间终点
    | { currency: string; amount_minor: number; effective_from: string; effective_to: string | null } // 命中时的价格行结构
    | undefined; // 无生效价格时返回 undefined，由调用方渲染 null
} // 结束 activePrice，返回当前有效价格或空

function listPrices(db: Db, moduleId: string) { // 列出模块全部历史价格，供详情页展示调价轨迹
  return db // 链式查询起点
    .prepare( // 预编译查询，按生效时间倒序
      `SELECT id, currency, amount_minor, effective_from, effective_to
       FROM module_prices
       WHERE module_id = ?
       ORDER BY effective_from DESC`,
    ) // 结束预编译
    .all(moduleId) as Array<{ // 取回全部行并声明结果类型
    id: string; // 价格行主键，管理端调价（PUT/DELETE /modules/prices/:id）必须携带
    currency: string; // 币种（CNY/USD）
    amount_minor: number; // 金额最小单位，避免浮点误差
    effective_from: string; // 生效起始时间
    effective_to: string | null; // 生效结束时间，null 表示长期有效
  }>; // 结束数组类型声明，带出历史价格列表
} // 结束 listPrices

function resolveActiveModules(db: Db, region: string) { // 按地区取未删除的模块，排序稳定便于前端渲染
  const rows = db // 查询结果暂存
    .prepare( // 预编译：仅过滤地区与软删除，状态由调用方再筛
      `SELECT id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
              region, status, sort_order, category_slug, license, language, stars, capability, created_at
       FROM modules
       WHERE region = ? AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
    ) // 结束预编译
    .all(region) as Array<{ // 取回全部模块行
    id: string; // 模块主键，用于关联价格与权益
    code: string; // 模块编码，对外唯一标识
    name_i18n: string; // 多语言名称 JSON
    summary_i18n: string; // 多语言简介 JSON
    unlock_mode: string; // 解锁方式（当前仅 one_time，见 schema.sql 的 CHECK 约束）
    entitlements_required: string; // 前置依赖模块码 JSON 数组
    region: string; // 所属地区
    status: string; // 模块状态
    sort_order: number; // 展示排序权重
    category_slug: string | null; // 所属二级分类标识（分类树改造后新增，老数据为 null）
    license: string | null; // 开源许可（筛选维度）
    language: string | null; // 编程语言（筛选维度）
    stars: number; // Star 数（Stars 排序依据）
    capability: string | null; // 真实能力键；null 表示该模块功能规划中
    created_at: string; // 创建时间（「最近更新」排序依据）
  }>; // 结束结果类型声明
  return rows; // 交由调用方做状态过滤，保持查询职责单一
} // 结束 resolveActiveModules

/** 解析逗号分隔的筛选参数：去空、去重、保持输入顺序，非法值不做静默丢弃（交由上层判断是否命中零结果） */
function parseMultiValue(raw: unknown): string[] { // 许可/语言筛选共用
  if (typeof raw !== 'string') return []; // 非字符串视为未传
  return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))]; // 去空白、去空项并按原顺序去重
} // 结束 parseMultiValue

/** 取模块当前生效价格的公开视图；无价格行时返回 null（视图层显示「免费/待定价」） */
export function currentPrice(db: Db, moduleId: string, now: string): { currency: string; amount_minor: number } | null { // 统一价格视图口径，列表/详情/订单/购物车共用
  const price = activePrice(db, moduleId, now); // 复用既有的生效价格查询
  return price ? { currency: price.currency, amount_minor: price.amount_minor } : null; // 只透出币种与金额
} // 结束 currentPrice

/**
 * 校验前置依赖是否全部满足：每个 required 模块必须有该用户的 active 且未过期权益。
 * 解锁与下单两条写路径共用同一校验，避免两处口径漂移。
 */
export function assertDependenciesMet(db: Db, params: { region: string; requiredCodes: string[]; userId: string; now: string }): void { // 依赖校验抽成公共实现（解锁 / 下单 / 购物车结算共用）
  const { region, requiredCodes, userId, now } = params; // 解构入参便于下方拼接
  if (requiredCodes.length === 0) return; // 无依赖直接放行，避免无谓查询
  const placeholders = requiredCodes.map(() => '?').join(','); // 动态占位符，模块码走参数绑定不拼 SQL
  const depRows = db // 依赖满足情况查询
    .prepare( // 预编译：内连接权益表，一次查出已满足的依赖
      `SELECT m.code FROM modules m
       INNER JOIN entitlements e ON e.module_id = m.id
       WHERE m.region = ? AND m.code IN (${placeholders}) AND m.deleted_at IS NULL
         AND e.user_id = ? AND e.status = 'active'
         AND (e.expires_at IS NULL OR e.expires_at > ?)`, // 三个时间/身份条件与解锁口径一致
    ) // 结束预编译
    .all(region, ...requiredCodes, userId, now) as Array<{ code: string }>; // 参数顺序与占位符一致
  const satisfied = new Set(depRows.map((d) => d.code)); // 转集合便于 O(1) 判断
  const missing = requiredCodes.filter((c) => !satisfied.has(c)); // 计算缺失依赖
  if (missing.length > 0) { // 存在缺失依赖时拒绝
    throw new AppError('FEATURE_NOT_AVAILABLE', 'module dependency not met', { required: missing }); // 回传缺失清单，前端可精确引导
  } // 结束缺失判断
} // 结束 assertDependenciesMet

/**
 * 依赖环检测：若「本模块 → 新依赖链」能走回本模块自身，则该模块将永远无法解锁，必须拒绝写入。
 * 依赖只在同一区域内生效，故按 region 构图；缺失的下游模块（如已软删）不参与遍历。
 */
function assertNoDependencyCycle(db: Db, region: string, code: string, requires: string[]): void { // 写入前置依赖前的环检测
  if (requires.length === 0) return; // 无依赖不可能成环
  const rows = db // 取同区域全部未删除模块的依赖边
    .prepare(`SELECT code, entitlements_required FROM modules WHERE region = ? AND deleted_at IS NULL`) // 只读构图所需两列
    .all(region) as Array<{ code: string; entitlements_required: string }>; // 全部节点与出边
  const graph = new Map<string, string[]>(); // 邻接表：模块码 → 依赖模块码数组
  for (const row of rows) graph.set(row.code, jsonParse<string[]>(row.entitlements_required) ?? []); // 坏数据降级为空依赖
  graph.set(code, requires); // 用「本次待写入的依赖」覆盖该节点出边，模拟写入后的图
  const stack = [...requires]; // 从新依赖出发做深度优先遍历
  const seen = new Set<string>(); // 已访问集合，防止在既有图中原地打转
  while (stack.length > 0) { // 迭代式 DFS，避免深链递归爆栈
    const current = stack.pop() as string; // 取一个待访问节点
    if (current === code) { // 走回起点即说明成环
      throw new AppError('VALIDATION_FAILED', 'module dependency cycle detected', { module_code: code, cycle_at: current }); // 400 且回传成环点
    } // 结束成环判断
    if (seen.has(current)) continue; // 已访问节点跳过，避免重复遍历
    seen.add(current); // 标记为已访问
    for (const next of graph.get(current) ?? []) stack.push(next); // 继续沿依赖边下探
  } // 遍历结束
} // 结束 assertNoDependencyCycle

/** 订单行结构：数据库行 + 联表查询时可选带出的模块信息 */
export interface OrderRow { // 统一类型，避免各处 Record<string, unknown> 强转导致字段丢失
  id: string; // 订单主键
  user_id: string; // 下单用户
  region: string; // 下单区域
  currency: string; // 币种
  amount_minor: number; // 金额（分）
  status: string; // 订单状态
  channel: string; // 结算渠道
  channel_txn_id: string | null; // 外部渠道交易号（人工结算为 NULL）
  entitlement_id: string | null; // 结算后权益主键
  created_at: string; // 下单时间
  updated_at: string; // 最近更新时间
  paid_at: string | null; // 结算时间
  cancelled_at: string | null; // 取消时间
  module_code?: string; // 联表带出的模块编码
  module_name?: string; // 联表带出的模块多语言名称 JSON
} // 结束 OrderRow

/** 订单对外视图：只透出对账与展示所需字段，不暴露内部 module_id */
export function orderView(row: OrderRow) { // 入参为数据库行（可含模块信息）；购物车结算复用同一视图
  const nameMap = row.module_name ? jsonParse<Record<string, string>>(row.module_name) ?? { 'zh-CN': row.module_code ?? '' } : undefined; // 名称缺失时回落编码
  return { // 统一订单视图
    id: row.id, // 订单主键
    user_id: row.user_id, // 下单用户
    region: row.region, // 下单区域
    currency: row.currency, // 币种
    amount_minor: row.amount_minor, // 金额（分）
    status: row.status, // 状态
    channel: row.channel, // 渠道
    channel_txn_id: row.channel_txn_id, // 渠道交易号（回调幂等依据，人工结算为空）
    entitlement_id: row.entitlement_id, // 结算后权益主键
    created_at: row.created_at, // 下单时间
    updated_at: row.updated_at, // 最近更新时间
    paid_at: row.paid_at, // 结算时间
    cancelled_at: row.cancelled_at, // 取消时间
    ...(row.module_code === undefined ? {} : { module_code: row.module_code, module_name: nameMap }), // 列表场景补上模块信息
  }; // 结束订单视图
} // 结束 orderView

/** 结算入参：人工结算与渠道回调共用的最小字段集 */
interface SettleInput {
  orderId: string; // 订单主键（同时作为权益 source_id）
  userId: string; // 下单用户
  moduleId: string; // 目标模块
  now: string; // 统一时间基准
  reason: string; // 写入审计事件的原因
  channelTxnId: string | null; // 渠道交易号（人工结算为 null）
} // 结束 SettleInput

/**
 * 订单结算事务：订单置 paid、发放订单来源权益、追加 entitlement_events 三写同事务。
 * 人工结算（POST /orders/:id/settle）与渠道回调（POST /orders/:id/payment-notify）共用同一实现，
 * 保证两条入口的落库结构与审计口径完全一致。
 * @returns 新发放的权益主键
 */
function settleOrderTx(db: Db, input: SettleInput): string {
  const entId = uuidv7(); // 权益主键预生成
  const evtId = uuidv7(); // 事件主键预生成
  const tx = db.transaction(() => { // 三写同事务，任一步失败整体回滚
    db.prepare( // 发放订单来源权益：source_id 取订单主键，天然一单一权益
      `INSERT INTO entitlements (id, user_id, module_id, source, source_id, status, version, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, 'active', 1, ?, ?)`,
    ).run(entId, input.userId, input.moduleId, input.orderId, input.now, input.now); // 绑定权益字段
    db.prepare( // 追加状态流转事件，供审计追溯
      `INSERT INTO entitlement_events (id, entitlement_id, from_status, to_status, reason, actor, created_at)
       VALUES (?, ?, NULL, 'active', ?, 'admin', ?)`,
    ).run(evtId, entId, input.reason, input.now); // 记录「由哪张订单结算而来」
    db.prepare( // 订单置为已结算，并记录渠道交易号（人工结算写 NULL）
      `UPDATE module_orders SET status = 'paid', entitlement_id = ?, channel_txn_id = ?, paid_at = ?, updated_at = ? WHERE id = ?`,
    ).run(entId, input.channelTxnId, input.now, input.now, input.orderId); // 绑定权益主键、交易号、时间与订单主键
  }); // 结束事务定义
  tx(); // 执行事务
  return entId; // 返回权益主键供响应与对账
} // 结束 settleOrderTx

export function createCatalogRouter(deps: ApiDeps): Router { // 组装目录路由
  const router = Router(); // 独立路由实例
  const db = deps.db; // 缓存数据库句柄，减少重复解构

  // ---------- 公开：模块目录与详情 ----------

  /** GET /taxonomy — 分类导航树（一级分类 → 二级条目，带每个条目的模块数量） */
  router.get('/taxonomy', (req, res) => { // 公开接口：导航与计数不需要登录
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn'; // 与 /modules 一致的地区解析策略
    const groups = db // 一级分类
      .prepare('SELECT slug, name, name_en, sort_order FROM module_categories WHERE level = 1 ORDER BY sort_order ASC') // 按权重升序
      .all() as Array<{ slug: string; name: string; name_en: string | null; sort_order: number }>; // 结果结构
    const items = db // 二级条目
      .prepare('SELECT slug, name, name_en, parent_id, sort_order FROM module_categories WHERE level = 2 ORDER BY sort_order ASC') // 全量二级条目
      .all() as Array<{ slug: string; name: string; name_en: string | null; parent_id: string | null; sort_order: number }>; // 结果结构
    const counters = db // 每个二级分类下的可见模块数量
      .prepare(
        `SELECT category_slug AS slug, COUNT(*) AS total
         FROM modules
         WHERE region = ? AND deleted_at IS NULL AND status = 'active' AND category_slug IS NOT NULL
         GROUP BY category_slug`,
      ) // 按分类聚合计数
      .all(region) as Array<{ slug: string; total: number }>; // 结果结构
    const countMap = new Map(counters.map((row) => [row.slug, row.total])); // 转 Map，组装时 O(1) 取数

    const tree = groups.map((group) => { // 逐一级分类组装
      const children = items // 归属该一级分类的二级条目：slug 形如 `<group>-<序号>`
        .filter((item) => item.slug.startsWith(`${group.slug}-`)) // 前缀匹配即归属
        .map((item) => ({ slug: item.slug, name: item.name, name_en: item.name_en, count: countMap.get(item.slug) ?? 0 })); // 带上模块数量与英文名
      return { slug: group.slug, name: group.name, name_en: group.name_en, count: children.reduce((sum, child) => sum + child.count, 0), items: children }; // 一级带自身汇总数与英文名
    }); // 组装结束

    res.json({ groups: tree, total_items: items.length, total_modules: tree.reduce((sum, group) => sum + group.count, 0) }); // 返回树与总计数
  }); // 结束 GET /taxonomy

  /**
   * GET /modules — 按 user.region 列出 active 模块。
   * 支持 q（编码/名称模糊）、category（一级 slug 或二级 slug）、sort（stars/recommended/updated）、
   * licenses / languages（逗号分隔多选）与 page / pageSize 分页；响应带 total 便于前端算页数。
   */
  router.get('/modules', (req, res) => { // 公开目录列表，无需登录
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn'; // 优先登录用户地区，其次请求头，最后兜底 cn
    const now = clockOf(deps); // 统一时间基准，保证价格区间判定一致
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''; // 搜索关键词小写化，空串视为未传
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : ''; // 分类过滤：一级 slug 或二级 slug
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort.trim() : 'recommended'; // 排序方式，默认「最新推荐」
    if (!CATALOG_SORT_MODES.includes(sortRaw as (typeof CATALOG_SORT_MODES)[number])) { // 与 core-domain 枚举对齐，非法值直接 400
      throw new AppError('VALIDATION_FAILED', 'sort must be one of stars/recommended/updated'); // 不静默回退，避免前端以为筛选生效
    } // 排序校验结束
    const licenses = parseMultiValue(req.query.licenses); // 许可多选（空数组表示不过滤）
    const languages = parseMultiValue(req.query.languages); // 语言多选（空数组表示不过滤）
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1); // 页码从 1 起，非法值回落首页
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20)); // 每页 1–100 条，默认 20

    const visible = resolveActiveModules(db, region).filter((m) => MODULE_VISIBLE.has(m.status)); // 仅保留 active 模块，过滤草稿与归档
    const filtered = visible.filter((m) => { // 叠加关键词、分类、许可、语言四类过滤
      if (q && !m.code.toLowerCase().includes(q) && !m.name_i18n.toLowerCase().includes(q)) return false; // 编码与名称都不命中即剔除
      if (category && category !== 'all') { // 分类过滤：'all' 等价于不过滤
        const slug = m.category_slug ?? ''; // 老数据可能为空
        if (!slug || (slug !== category && !slug.startsWith(`${category}-`))) return false; // 精确命中二级或前缀命中一级
      } // 分类过滤结束
      if (licenses.length > 0 && !licenses.includes(m.license ?? '')) return false; // 许可不在所选集合即剔除
      if (languages.length > 0 && !languages.includes(m.language ?? '')) return false; // 语言不在所选集合即剔除
      return true; // 通过全部条件
    }); // 过滤结束

    const sorted = [...filtered].sort((a, b) => { // 按所选维度排序；各维度都追加 sort_order 兜底，保证结果稳定
      if (sortRaw === 'stars') return b.stars - a.stars || a.sort_order - b.sort_order; // Star 数从高到低
      if (sortRaw === 'updated') return b.created_at.localeCompare(a.created_at) || a.sort_order - b.sort_order; // 创建时间倒序（本轮种子同刻写入，靠权重兜底）
      return a.sort_order - b.sort_order; // 最新推荐：沿用人工权重
    }); // 排序结束

    const total = sorted.length; // 过滤后的总条数
    const offset = (page - 1) * pageSize; // 本页起始偏移
    const pageRows = sorted.slice(offset, offset + pageSize); // 仅映射本页数据，避免为整批算价格
    const modules = pageRows.map((m) => { // 将数据库行转换为对外视图
      const price = activePrice(db, m.id, now); // 取当前有效价格，无则返回 undefined
      const requiredCodes = jsonParse<string[]>(m.entitlements_required) ?? []; // 解析前置依赖，坏数据降级为空数组
      const nameMap = jsonParse<Record<string, string>>(m.name_i18n) ?? { 'zh-CN': m.code }; // 名称缺省回落到模块码，避免空标题
      const summaryMap = jsonParse<Record<string, string>>(m.summary_i18n) ?? { 'zh-CN': '' }; // 简介缺省为空串占位
      return { // 单模块视图
        code: m.code, // 模块编码
        name: nameMap, // 多语言名称
        summary: summaryMap, // 多语言简介
        unlock_mode: m.unlock_mode, // 解锁方式
        region: m.region, // 地区
        status: m.status, // 状态
        requires: requiredCodes, // 前置依赖码列表
        category_slug: m.category_slug, // 所属二级分类
        license: m.license, // 开源许可
        language: m.language, // 编程语言
        stars: m.stars, // Star 数
        capability: m.capability, // 真实能力键；前端据此决定给「使用」面板还是「规划中」标记
        current_price: price // 当前价格分支
          ? { currency: price.currency, amount_minor: price.amount_minor } // 只透出当前价格关键字段
          : null, // 无有效价格则为 null，前端可显示「免费/待定价」
      }; // 结束单模块视图
    }); // 结束映射，得到模块数组
    res.json({ modules, total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) }); // 分页元信息与前缀列表一起返回
  }); // 结束 GET /modules 处理

  /**
   * GET /modules/hot — 当前分类下的热门模块（右侧「热门项目」卡片）。
   * 参数：range=today|week（窗口 24h / 168h，非法值 400）、category（一级前缀或二级精确，all 等价不过滤）、limit（1–20，默认 5）。
   * 口径：hotness = stars + 时间窗内新建加权（1000），完全由库内真实字段计算，不插入任何虚构热度。
   */
  router.get('/modules/hot', (req, res) => { // 必须注册在 /modules/:code 之前，否则 hot 被详情路由吞掉
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn'; // 地区解析策略与列表一致
    const now = clockOf(deps); // 统一时间基准（ISO 字符串），窗口按它回溯
    const rangeRaw = typeof req.query.range === 'string' ? req.query.range.trim() : 'today'; // 默认「今日」
    if (!['today', 'week'].includes(rangeRaw)) { // 只允许两档，避免前端传错后静默降级
      throw new AppError('VALIDATION_FAILED', 'range must be one of today/week'); // 明确 400
    } // 档位校验结束
    const windowHours = rangeRaw === 'today' ? 24 : 168; // 今日 24 小时 / 本周 168 小时
    const since = new Date(new Date(now).getTime() - windowHours * 3600 * 1000).toISOString(); // 窗口起点（clockOf 返回 ISO 字符串，先转 Date 再回溯）
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : ''; // 分类过滤，与 /modules 同语义
    const limit = Math.min(20, Math.max(1, Number.parseInt(String(req.query.limit ?? '5'), 10) || 5)); // 条数 1–20，默认 5

    const visible = resolveActiveModules(db, region).filter((m) => MODULE_VISIBLE.has(m.status)); // 只统计上架模块
    const scoped = visible.filter((m) => { // 先按分类收敛
      if (!category || category === 'all') return true; // 未传或 all 表示当前全站
      const slug = m.category_slug ?? ''; // 老数据可能没有分类
      return Boolean(slug) && (slug === category || slug.startsWith(`${category}-`)); // 二级精确或一级前缀
    }); // 分类收敛结束

    const scored = scoped.map((m) => { // 逐条算热度
      const recent = m.created_at >= since ? 1000 : 0; // 窗口内新建加权，窗口外不加权
      return { module: m, score: m.stars + recent }; // 热度 = Stars + 新建加权
    }); // 计算结束
    scored.sort((a, b) => b.score - a.score || b.module.stars - a.module.stars || a.module.sort_order - b.module.sort_order); // 热度→Stars→权重三级稳定排序
    const top = scored.slice(0, limit); // 取前 N 条
    const items = top.map((row) => ({ // 精简视图：热门卡片只需要名称、Stars、归属
      code: row.module.code, // 模块编码
      name: jsonParse<Record<string, string>>(row.module.name_i18n) ?? { 'zh-CN': row.module.code }, // 多语言名称
      stars: row.module.stars, // Star 数
      category_slug: row.module.category_slug, // 归属二级分类
      license: row.module.license, // 开源许可
      language: row.module.language, // 编程语言
      created_at: row.module.created_at, // 创建时间，前端可显示「新」
      hotness: row.score, // 热度分值，便于页面展示与排查
    })); // 映射结束
    res.json({ range: rangeRaw, window_hours: windowHours, category: category || 'all', total: scoped.length, items }); // 回显窗口口径与结果
  }); // 结束 GET /modules/hot

  // ---------- 管理端：分类树 CRUD（一级 / 二级共用同一张表，按 parent_id 区分层级） ----------

  /**
   * GET /categories/manage — 管理端分类树全量视图（含模块计数）。
   * 与公开 /taxonomy 的差别：不按「仅 active」过滤之外再加任何收敛，且带 id / parent / 英文名，
   * 便于管理前端直接渲染可编辑的两级列表。
   */
  router.get('/categories/manage', requirePermission('module:read'), (req, res) => { // RBAC：读模块权限即可看分类树
    const region = req.header('x-region')?.trim() || 'cn'; // 与管理端其他接口一致：区域走请求头，缺省 cn
    const rows = db // 分类行：两级一起取，前端自行按 parent_id 组装
      .prepare('SELECT id, parent_id, level, slug, name, name_en, sort_order FROM module_categories ORDER BY level ASC, sort_order ASC, slug ASC') // 一级在前，同级按权重
      .all() as Array<{ // 行结构
      id: string; // 分类主键
      parent_id: string | null; // 父分类主键，一级为 null
      level: number; // 层级 1 / 2
      slug: string; // 分类标识（全局唯一）
      name: string; // 中文名
      name_en: string | null; // 英文名
      sort_order: number; // 展示权重
    }>; // 类型结束
    const counters = db // 每个二级分类下的 active 模块数（与公开树同口径，保证两处计数一致）
      .prepare(
        `SELECT category_slug AS slug, COUNT(*) AS total
         FROM modules
         WHERE region = ? AND deleted_at IS NULL AND status = 'active' AND category_slug IS NOT NULL
         GROUP BY category_slug`,
      )
      .all(region) as Array<{ slug: string; total: number }>; // 聚合结果
    const countMap = new Map(counters.map((row) => [row.slug, row.total])); // 转 Map，组装时 O(1)
    const groups = rows // 一级分类
      .filter((row) => row.level === 1) // 只取一级
      .map((group) => { // 逐个一级分类组装其二级条目
        const items = rows // 归属该一级的二级条目：按「前缀 slug-」判定归属，与公开树同规则
          .filter((row) => row.parent_id === group.id) // parent_id 精确匹配优先（存在外键，最可靠）
          .map((item) => ({ // 单条二级条目视图
            id: item.id, // 主键
            slug: item.slug, // 标识
            name: item.name, // 中文名
            name_en: item.name_en, // 英文名
            sort_order: item.sort_order, // 权重
            module_count: countMap.get(item.slug) ?? 0, // 该条目模块数
          })); // 二级映射结束
        return { // 一级分类视图
          id: group.id, // 主键
          slug: group.slug, // 标识
          name: group.name, // 中文名
          name_en: group.name_en, // 英文名
          sort_order: group.sort_order, // 权重
          module_count: items.reduce((sum, item) => sum + item.module_count, 0), // 组内模块数汇总
          items, // 二级条目列表
        }; // 一级视图结束
      }); // 组装结束
    res.json({ region, groups, total_groups: groups.length, total_items: groups.reduce((sum, group) => sum + group.items.length, 0) }); // 回显区域与总量
  }); // 结束 GET /categories/manage

  /** POST /categories — 新建分类：给 parent_slug 即二级条目，不给即一级分类 */
  router.post('/categories', requirePermission('module:write'), (req, res) => { // RBAC：写模块权限即可改分类树
    const body = parse( // 校验入参
      z.object({ // 新建分类的字段
        slug: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, 'slug must be lowercase letters/digits/hyphen and start with a letter'), // 归一化标识，参与模块编码与前缀判定
        name: z.string().min(1).max(64), // 中文名，必填
        name_en: z.string().min(1).max(96).optional(), // 英文名，选填（缺省 null，英文站点回落中文）
        parent_slug: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/).optional(), // 父分类标识，缺省表示建一级分类
        sort_order: z.number().int().min(0).max(99999).optional(), // 权重，缺省排在同级末尾
      }), // schema 结束
      req.body, // 原始请求体
    ); // 解析结束
    const now = clockOf(deps); // 统一时间基准
    const existing = db.prepare('SELECT id FROM module_categories WHERE slug = ?').get(body.slug) as { id: string } | undefined; // 查重
    if (existing) { // 已存在同名 slug
      throw new AppError('CONFLICT', 'category slug already exists', { slug: body.slug }); // 409，避免静默覆盖既有分类
    } // 查重结束

    let level = 1; // 默认一级分类
    let parentId: string | null = null; // 一级分类没有父键
    if (body.parent_slug) { // 指定父分类 → 二级条目
      const parent = db // 定位父分类
        .prepare('SELECT id, slug, level FROM module_categories WHERE slug = ?') // 按 slug 唯一命中
        .get(body.parent_slug) as { id: string; slug: string; level: number } | undefined; // 命中行
      if (!parent || parent.level !== 1) { // 父分类必须存在且是一级
        throw new AppError('NOT_FOUND', 'parent category not found', { parent_slug: body.parent_slug }); // 404 便于前端定位
      } // 父分类校验结束
      // 二级 slug 必须以「父 slug-」开头：公开树与前缀过滤都靠这条约定组装子节点，破坏即导致条目挂不上父级
      if (!body.slug.startsWith(`${parent.slug}-`)) { // 前缀不符直接拒绝
        throw new AppError('VALIDATION_FAILED', `child slug must start with "${parent.slug}-"`, { slug: body.slug, parent_slug: parent.slug }); // 400 并回传期望前缀
      } // 前缀校验结束
      level = 2; // 层级下标
      parentId = parent.id; // 父键指向一级分类主键
    } else if (body.slug.includes('-')) { // 一级分类带上连字符会与二级前缀规则混淆
      throw new AppError('VALIDATION_FAILED', 'top-level slug must not contain hyphen', { slug: body.slug }); // 400，提示改用纯字母/数字
    } // 一级分类命名校验结束

    const maxOrder = db // 同级末尾权重
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM module_categories WHERE level = ? AND parent_id IS ?') // 一级传 NULL，二级传父键
      .get(level, parentId) as { max_order: number }; // 聚合结果（无行时 COALESCE 给 0）
    const sortOrder = body.sort_order ?? maxOrder.max_order + 1; // 缺省追加到同级末尾，保持「新增排在最后」
    db.prepare( // 写入分类行
      `INSERT INTO module_categories (id, parent_id, level, slug, name, name_en, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, // 字段与 schema.sql 一一对应
    ).run(`cat:${body.slug}`, parentId, level, body.slug, body.name, body.name_en ?? null, sortOrder, now, now); // 绑定全部字段

    res.status(201).json({ // 201 表示新分类已创建
      category: { id: `cat:${body.slug}`, parent_id: parentId, level, slug: body.slug, name: body.name, name_en: body.name_en ?? null, sort_order: sortOrder }, // 回显创建结果
    }); // 响应体结束
  }); // 结束 POST /categories

  /** PATCH /categories/:slug — 改名 / 改英文名 / 改排序；slug 与父级不可改，避免模块归属断链 */
  router.patch('/categories/:slug', requirePermission('module:write'), (req, res) => { // RBAC：写模块权限
    const body = parse( // 校验入参
      z.object({ // 仅允许三个字段
        name: z.string().min(1).max(64).optional(), // 中文名
        name_en: z.string().min(1).max(96).nullable().optional(), // 英文名，传 null 表示清空
        sort_order: z.number().int().min(0).max(99999).optional(), // 权重
      }).refine((value) => value.name !== undefined || value.name_en !== undefined || value.sort_order !== undefined, { message: 'at least one of name / name_en / sort_order is required' }), // 至少改一项
      req.body, // 原始请求体
    ); // 解析结束
    const slug = pathParam(req, 'slug'); // 分类标识路径参数
    const now = clockOf(deps); // 统一时间基准
    const row = db // 定位待更新分类
      .prepare('SELECT id, level, slug, name, name_en, sort_order FROM module_categories WHERE slug = ?') // 取可更新字段
      .get(slug) as { id: string; level: number; slug: string; name: string; name_en: string | null; sort_order: number } | undefined; // 命中行
    if (!row) { // 分类不存在
      throw new AppError('NOT_FOUND', 'category not found', { slug }); // 404
    } // 存在性判断结束

    const name = body.name ?? row.name; // 中文名缺省沿用旧值
    const nameEn = body.name_en === undefined ? row.name_en : body.name_en; // 显式传 null 才清空英文名
    const sortOrder = body.sort_order ?? row.sort_order; // 权重缺省沿用旧值
    db.prepare('UPDATE module_categories SET name = ?, name_en = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(name, nameEn, sortOrder, now, row.id); // 只改文案与权重
    res.json({ category: { id: row.id, level: row.level, slug: row.slug, name, name_en: nameEn, sort_order: sortOrder } }); // 回显更新结果
  }); // 结束 PATCH /categories/:slug

  /** DELETE /categories/:slug — 删除分类：有子级或有模块引用时拒绝，避免留下悬空归属 */
  router.delete('/categories/:slug', requirePermission('module:write'), (req, res) => { // RBAC：写模块权限
    const slug = pathParam(req, 'slug'); // 分类标识路径参数
    const row = db // 定位待删分类
      .prepare('SELECT id, level, slug FROM module_categories WHERE slug = ?') // 仅取判定所需字段
      .get(slug) as { id: string; level: number; slug: string } | undefined; // 命中行
    if (!row) { // 分类不存在
      throw new AppError('NOT_FOUND', 'category not found', { slug }); // 404
    } // 存在性判断结束
    if (row.level === 1) { // 一级分类：必须先删光二级
      const children = db.prepare('SELECT COUNT(*) AS total FROM module_categories WHERE parent_id = ?').get(row.id) as { total: number }; // 子级计数
      if (children.total > 0) { // 仍有二级条目
        throw new AppError('CONFLICT', 'category still has child items', { slug, children: children.total }); // 409，提示先删子级
      } // 子级判断结束
    } // 一级分支结束
    const refs = row.level === 2 // 模块引用检查：二级精确匹配，一级按前缀归组（与公开树同一规则）
      ? (db.prepare('SELECT COUNT(*) AS total FROM modules WHERE category_slug = ? AND deleted_at IS NULL').get(slug) as { total: number }) // 二级：精确
      : (db.prepare('SELECT COUNT(*) AS total FROM modules WHERE category_slug LIKE ? AND deleted_at IS NULL').get(`${escapeLike(slug)}-%`) as { total: number }); // 一级：前缀
    if (refs.total > 0) { // 仍有模块挂在该分类下
      throw new AppError('CONFLICT', 'category still has modules', { slug, modules: refs.total }); // 409，避免模块失去归属
    } // 引用判断结束
    db.prepare('DELETE FROM module_categories WHERE id = ?').run(row.id); // 物理删除：分类是配置数据，无审计诉求
    res.json({ category: { slug: row.slug, level: row.level, deleted: true } }); // 回执删除结果
  }); // 结束 DELETE /categories/:slug

  /** GET /modules/manage — 管理端模块全量列表（含 draft/archived，支持 q/status 过滤） */
  router.get('/modules/manage', requirePermission('module:read'), (req, res) => { // 必须注册在 /modules/:code 之前，否则 manage 被详情路由吞掉
    const region = req.header('x-region')?.trim() || 'cn'; // 与管理端惯例一致：请求头优先，缺省 cn
    const now = clockOf(deps); // 统一时间基准，用于当前价格判定
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''; // 搜索关键词（编码/名称包含匹配）
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : ''; // 状态过滤，空串表示不过滤
    if (statusFilter && !['draft', 'active', 'archived'].includes(statusFilter)) { // 非法状态值直接 400，避免静默返回空集
      throw new AppError('VALIDATION_FAILED', 'status must be one of draft/active/archived'); // 与 modules.status 的 CHECK 约束保持一致
    } // 结束状态过滤校验

    const rows = db // 管理视图查询起点
      .prepare( // 预编译：取未删除模块全字段，排序与公开列表一致
        `SELECT id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
                region, status, sort_order, category_slug, license, language, stars, created_at, updated_at
         FROM modules
         WHERE region = ? AND deleted_at IS NULL
         ORDER BY sort_order ASC, created_at ASC`,
      ) // 结束预编译
      .all(region) as Array<{ // 取回全部未删除模块行
      id: string; // 模块主键
      code: string; // 模块编码
      name_i18n: string; // 多语言名称 JSON
      summary_i18n: string; // 多语言简介 JSON
      unlock_mode: string; // 解锁方式（当前仅 one_time）
      entitlements_required: string; // 前置依赖 JSON 数组
      region: string; // 所属地区
      status: string; // 模块状态
      sort_order: number; // 展示排序权重
      category_slug: string | null; // 所属二级分类
      license: string | null; // 开源许可
      language: string | null; // 编程语言
      stars: number; // Star 数
      created_at: string; // 创建时间
      updated_at: string; // 更新时间
    }>; // 结束结果类型声明

    const filtered = rows.filter((m) => { // 在内存中叠加 q 与 status 过滤，模块量级小无需下推 SQL
      if (statusFilter && m.status !== statusFilter) return false; // 状态不匹配即剔除
      if (q && !m.code.toLowerCase().includes(q) && !m.name_i18n.toLowerCase().includes(q)) return false; // 编码与名称都不命中即剔除
      return true; // 通过全部过滤条件
    }); // 结束过滤

    const modules = filtered.map((m) => { // 转换为管理视图
      const price = activePrice(db, m.id, now); // 当前有效价格
      const nameMap = jsonParse<Record<string, string>>(m.name_i18n) ?? { 'zh-CN': m.code }; // 名称缺省回落模块码
      const summaryMap = jsonParse<Record<string, string>>(m.summary_i18n) ?? { 'zh-CN': '' }; // 简介缺省为空串
      return { // 单模块管理视图
        code: m.code, // 模块编码
        name: nameMap, // 多语言名称
        summary: summaryMap, // 多语言简介
        unlock_mode: m.unlock_mode, // 解锁方式
        region: m.region, // 地区
        status: m.status, // 状态（含 draft/archived）
        sort_order: m.sort_order, // 排序权重
        requires: jsonParse<string[]>(m.entitlements_required) ?? [], // 前置依赖码列表
        category_slug: m.category_slug, // 所属二级分类（分类树改造新增）
        license: m.license, // 开源许可
        language: m.language, // 编程语言
        stars: m.stars, // Star 数
        current_price: price ? { currency: price.currency, amount_minor: price.amount_minor } : null, // 当前价格或 null
        created_at: m.created_at, // 创建时间
        updated_at: m.updated_at, // 更新时间
      }; // 结束单模块管理视图
    }); // 结束映射
    res.json({ modules, total: modules.length }); // 返回列表与总数，便于管理端展示计数
  }); // 结束 GET /modules/manage 处理

  /** GET /modules/:code — 模块详情（含全部历史价格、前置依赖解析为模块码列表） */
  router.get('/modules/:code', (req, res) => { // 公开模块详情
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn'; // 与列表保持一致的地区解析策略
    const now = clockOf(deps); // 当前时间，用于判定生效价格
    const code = pathParam(req, 'code'); // 严格提取路径参数，非字符串直接 400 而非静默透传

    const row = db // 详情查询起点
      .prepare( // 预编译：按编码 + 地区 + 未删除定位唯一模块
        `SELECT id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required,
                region, status, category_slug, license, language, stars, capability
         FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL`,
      ) // 结束预编译
      .get(code, region) as // 绑定编码与地区参数
      | { // 命中时的模块行结构
          id: string; // 模块主键
          code: string; // 模块编码
          name_i18n: string; // 多语言名称
          summary_i18n: string; // 多语言简介
          unlock_mode: string; // 解锁方式
          entitlements_required: string; // 前置依赖 JSON
          region: string; // 地区
          status: string; // 状态
          category_slug: string | null; // 所属二级分类（老数据可能为空）
          license: string | null; // 开源许可
          language: string | null; // 编程语言
          stars: number; // Star 数
          capability: string | null; // 真实能力键（null = 功能规划中）
        } // 结束模块行结构
      | undefined; // 未命中即 undefined
    if (!row) { // 模块不存在时
      throw new AppError('NOT_FOUND', 'module not found', { module_code: code, region }); // 明确 404 而非空对象
    } // 结束存在性判断

    const price = activePrice(db, row.id, now); // 当前有效价格
    const prices = listPrices(db, row.id); // 全部历史价格
    const requires = jsonParse<string[]>(row.entitlements_required) ?? []; // 前置依赖数组
    const nameMap = jsonParse<Record<string, string>>(row.name_i18n) ?? { 'zh-CN': row.code }; // 名称缺省回落
    const summaryMap = jsonParse<Record<string, string>>(row.summary_i18n) ?? { 'zh-CN': '' }; // 简介缺省为空

    res.json({ // 详情响应体
      code: row.code, // 模块编码
      name: nameMap, // 多语言名称
      summary: summaryMap, // 多语言简介
      unlock_mode: row.unlock_mode, // 解锁方式
      region: row.region, // 地区
      status: row.status, // 状态
      requires, // 前置依赖
      category_slug: row.category_slug, // 所属二级分类，供详情页显示归属
      license: row.license, // 开源许可，与列表页徽标一致
      language: row.language, // 编程语言，与列表页徽标一致
      stars: row.stars, // Star 数，详情页可复用同一排序口径
      capability: row.capability, // 真实能力键；前端据此渲染「工具」区块或「规划中」标记
      current_price: price // 当前价格分支
        ? { currency: price.currency, amount_minor: price.amount_minor } // 当前价格
        : null, // 无有效价格
      price_history: prices, // 历史价格列表，便于展示调价记录
    }); // 结束详情响应
  }); // 结束 GET /modules/:code 处理

  /**
   * POST /modules/:code/invoke — 调用模块绑定的真实能力。
   * 门禁三连：① 登录；② 模块存在且已上架；③ 该模块在 core-domain 登记了能力键；
   * ④ 该用户对该模块有 active 且未过期权益。任一不满足即按语义返回 4xx，不做静默降级。
   */
  router.post('/modules/:code/invoke', requireAuth, async (req, res) => { // 登录 + 异步能力执行（Express 5 自动接住 Promise 拒绝）
    const code = pathParam(req, 'code'); // 严格提取模块码，非字符串直接 400
    const user = req.user!; // requireAuth 已保证存在
    const now = clockOf(deps); // 统一时间基准，用于权益到期判断
    const body = parse( // 校验请求体
      z.object({ // 仅接受文本与扁平选项
        text: z.string().min(1).max(20000), // 输入文本限长 20000 字符，避免超大输入拖垮进程
        options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), // 能力私有选项，扁平键值
      }), // 结束 schema
      req.body, // 原始请求体
    ); // 结束解析

    const row = db // 模块查询起点
      .prepare( // 预编译：按编码 + 用户地区 + 未删除定位
        `SELECT id, code, status, capability FROM modules
         WHERE code = ? AND region = ? AND deleted_at IS NULL`,
      ) // 结束预编译
      .get(code, user.region) as // 绑定模块码与地区
      | { id: string; code: string; status: string; capability: string | null } // 命中行结构
      | undefined; // 未命中
    if (!row) { // 模块不存在
      throw new AppError('NOT_FOUND', 'module not found', { module_code: code, region: user.region }); // 404
    } // 存在性判断结束
    if (!MODULE_VISIBLE.has(row.status)) { // 未上架模块不提供调用
      throw new AppError('FEATURE_NOT_AVAILABLE', 'module is not available in store', { module_code: code, status: row.status }); // 明确不可用
    } // 状态判断结束
    if (!row.capability) { // 无能力键即「规划中」
      throw new AppError('FEATURE_NOT_AVAILABLE', 'module capability is planned, not implemented yet', { module_code: code, planned: true }); // 501/400 语义明确
    } // 能力判断结束
    const handler = handlerOfCapability(row.capability); // 取能力实现
    if (!handler) { // 注册表缺项说明清单与实现不一致
      throw new AppError('FEATURE_NOT_AVAILABLE', 'capability handler is not registered', { module_code: code, capability: row.capability }); // 明确报不可用
    } // handler 判断结束

    const entitlement = db // 权益查询起点
      .prepare( // 预编译：同一模块 + 同一用户 + active + 未过期
        `SELECT id FROM entitlements
         WHERE module_id = ? AND user_id = ? AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`,
      ) // 结束预编译
      .get(row.id, user.id, now) as { id: string } | undefined; // 命中即已解锁
    if (!entitlement) { // 未解锁
      throw new AppError('FORBIDDEN', 'module is not unlocked for current user', { module_code: code }); // 403，前端引导去解锁
    } // 权益判断结束

    const started = Date.now(); // 记录开始时间，回传耗时便于前端展示
    const result = await handler({ text: body.text, options: { ...(body.options ?? {}), module_code: row.code } }); // 执行真实能力：模块码随选项下发，蓝图类能力据此产出该条目专属文档
    res.json({ // 调用结果
      module_code: row.code, // 回显模块码，便于前端对账
      capability: row.capability, // 回显能力键
      output: result.output, // 结果正文
      output_kind: result.output_kind, // 输出形态
      meta: result.meta, // 附加信息
      elapsed_ms: Date.now() - started, // 执行耗时（毫秒）
    }); // 响应结束
  }); // 结束 POST /modules/:code/invoke 处理

  // ---------- 鉴权：解锁与查询 ----------

  /** POST /entitlements — 请求解锁，校验前置依赖后发放 */
  router.post('/entitlements', requireAuth, idempotency, (req, res) => { // 登录 + 幂等，避免重复点击产生多条权益
    const body = parse( // 校验并解析请求体
      z.object({ // 仅接受模块码字段
        module_code: z.string().min(1).max(64), // 限定长度，避免超长输入进入 SQL 参数
      }), // 结束请求体 schema
      req.body, // 原始请求体
    ); // 结束解析，得到类型安全的 body

    const user = req.user!; // requireAuth 已保证存在
    const now = clockOf(deps); // 统一时间基准

    // 1. 模块存在且 active
    const moduleRow = db // 模块查询起点
      .prepare( // 预编译：按编码 + 地区 + 未删除定位
        `SELECT id, code, name_i18n, entitlements_required, unlock_mode, region, status
         FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL`,
      ) // 结束预编译
      .get(body.module_code, user.region) as // 绑定模块码与用户地区
      | { // 命中时的模块行结构
          id: string; // 模块主键
          code: string; // 模块编码
          name_i18n: string; // 多语言名称
          entitlements_required: string; // 前置依赖 JSON
          unlock_mode: string; // 解锁方式
          region: string; // 地区
          status: string; // 状态
        } // 结束模块行结构
      | undefined; // 未命中即 undefined
    if (!moduleRow) { // 模块不存在时
      throw new AppError('NOT_FOUND', 'module not found', { module_code: body.module_code }); // 模块不存在
    } // 结束存在性判断
    if (moduleRow.status !== 'active') { // 非 active 模块不允许解锁
      throw new AppError('FEATURE_NOT_AVAILABLE', 'module is not available for unlock', { // 明确不可用
        module_code: body.module_code, // 回传模块码便于前端提示
      }); // 结束错误构造
    } // 结束状态判断

    // 2. 重复解锁（已 active 且未过期）→ 409
    const existing = db // 已有权益查询起点
      .prepare( // 预编译：取最新一条未过期权益
        `SELECT id, status, expires_at FROM entitlements
         WHERE user_id = ? AND module_id = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
      ) // 结束预编译
      .get(user.id, moduleRow.id, now) as // 绑定用户、模块与当前时间
      | { id: string; status: string; expires_at: string | null } // 命中已有权益
      | undefined; // 无记录
    if (existing?.status === 'active') { // 已激活即视为重复解锁
      throw new AppError('CONFLICT', 'module already unlocked', { // 返回冲突而非错误
        module_code: body.module_code, // 便于前端定位
        entitlement_id: existing.id, // 回传已有权益 ID，前端可直接复用
      }); // 结束错误构造
    } // 结束重复解锁判断

    // 2.5 付费模块不可凭本接口免费取得：当前有效价格大于 0 时，必须先下单结算（402）
    const price = currentPrice(db, moduleRow.id, now); // 取当前生效价格作为成交价快照
    if (price && price.amount_minor > 0) { // 有价格且金额非 0 即视为付费商品
      throw new AppError('PAYMENT_REQUIRED', 'paid module requires a settled order', { // 402：引导改走下单流程
        module_code: moduleRow.code, // 回传模块码便于前端定位
        price, // 回传成交价，前端可直接用于展示订单金额
        order_required: true, // 显式标记：本次失败应改为 POST /orders
      }); // 结束付费拦截
    } // 结束付费判断

    // 3. 前置依赖：每个 required 模块必须有 active entitlement（与下单路径共用同一实现，避免口径漂移）
    const requiredCodes = jsonParse<string[]>(moduleRow.entitlements_required) ?? []; // 解析依赖码，坏数据降级为空数组
    assertDependenciesMet(db, { region: user.region, requiredCodes, userId: user.id, now }); // 缺失依赖即抛 FEATURE_NOT_AVAILABLE + required 清单

    // 4. 发放 entitlement + event（source CHECK 仅允许 'admin'，解锁请求走此通道）
    const entId = uuidv7(); // 权益主键预生成
    const evtId = uuidv7(); // 事件主键预生成
    const tx = db.transaction(() => { // 权益与事件同事务，保证审计链完整
      db.prepare( // 插入权益
        `INSERT INTO entitlements (id, user_id, module_id, source, source_id, status, version, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', NULL, 'active', 1, ?, ?)`,
      ).run(entId, user.id, moduleRow.id, now, now); // 直接发放 active 权益，version 从 1 开始
      db.prepare( // 插入状态流转事件
        `INSERT INTO entitlement_events (id, entitlement_id, from_status, to_status, reason, actor, created_at)
         VALUES (?, ?, NULL, 'active', 'unlock_request', 'system', ?)`,
      ).run(evtId, entId, now); // 记录状态流转事件，供审计追溯
    }); // 结束事务定义
    tx(); // 执行事务

    const ent = db // 回读权益结果
      .prepare( // 预编译：按主键取刚写入的行
        `SELECT id, status, expires_at, version, created_at, updated_at FROM entitlements WHERE id = ?`,
      ) // 结束预编译
      .get(entId) as { // 绑定权益主键
      id: string; // 权益主键
      status: string; // 权益状态
      expires_at: string | null; // 过期时间
      version: number; // 版本号，并发更新时做乐观锁
      created_at: string; // 创建时间
      updated_at: string; // 更新时间
    }; // 结束权益行类型
      const nameMap = jsonParse<Record<string, string>>(moduleRow.name_i18n) ?? { 'zh-CN': moduleRow.code }; // 名称缺省回落模块码
      res.status(201).json({ // 返回 201 表示新建权益
        entitlement: { // 权益视图
          id: ent.id, // 权益 ID
          module_code: moduleRow.code, // 模块编码
          module_name: nameMap, // 多语言名称
          status: ent.status, // 状态
          expires_at: ent.expires_at, // 过期时间
          version: ent.version, // 版本号
          created_at: ent.created_at, // 创建时间
        }, // 结束权益视图
      }); // 结束响应
  }); // 结束 POST /entitlements 处理

  /** GET /me/entitlements — 当前用户的有效解锁列表 */
  router.get('/me/entitlements', requireAuth, (req, res) => { // 需登录才能查看自己的权益
    const user = req.user!; // 登录态用户
    const now = clockOf(deps); // 当前时间用于过滤过期权益

    const rows = db // 权益列表查询起点
      .prepare( // 预编译：联表过滤未删除模块与未过期权益
        `SELECT e.id, e.status, e.expires_at, e.created_at, m.code AS module_code, m.name_i18n AS module_name
         FROM entitlements e
         INNER JOIN modules m ON m.id = e.module_id
         WHERE e.user_id = ? AND m.region = ? AND m.deleted_at IS NULL
           AND (e.expires_at IS NULL OR e.expires_at > ?)
         ORDER BY e.created_at DESC`,
      ) // 结束预编译
      .all(user.id, user.region, now) as Array<{ // 取回该用户全部有效权益
      id: string; // 权益 ID
      status: string; // 权益状态
      expires_at: string | null; // 过期时间
      created_at: string; // 创建时间
      module_code: string; // 模块编码
      module_name: string; // 模块多语言名称 JSON
    }>; // 过滤掉已删除模块与已过期权益

    res.json({ // 列表响应体
      entitlements: rows.map((r) => { // 逐条转换为对外视图
        const nameMap = jsonParse<Record<string, string>>(r.module_name) ?? { 'zh-CN': r.module_code }; // 名称缺省回落编码
        return { // 单条权益视图
          id: r.id, // 权益 ID
          module_code: r.module_code, // 模块编码
          module_name: nameMap, // 多语言名称
          status: r.status, // 状态
          expires_at: r.expires_at, // 过期时间
          created_at: r.created_at, // 创建时间
        }; // 结束单条视图
      }), // 结束映射
    }); // 结束响应
  }); // 结束 GET /me/entitlements 处理

  // ---------- 商城订单：付费模块下单 → 结算 → 发权益 ----------

  /** POST /orders — 为付费模块创建待结算订单（同用户同模块已有 pending 订单时直接回放） */
  router.post('/orders', requireAuth, idempotency, (req, res) => { // 下单需登录 + 幂等键，避免重复点击产生多张单
    const body = parse( // 校验请求体
      z.object({ // 仅接受模块码与可选渠道：金额一律由服务端按当前价快照
        module_code: z.string().min(1).max(64), // 目标模块编码
        channel: z.enum(['manual', 'alipay', 'wechat', 'stripe']).optional(), // 结算渠道：缺省 manual（人工）；接渠道时由客户端指定
      }), // 结束 schema
      req.body, // 原始请求体
    ); // 结束解析
    const user = req.user!; // requireAuth 已保证存在
    const now = clockOf(deps); // 统一时间基准，同时用于价格窗口判定与订单时间戳

    const moduleRow = db // 定位目标模块
      .prepare( // 预编译：按编码 + 用户区域 + 未删除定位
        `SELECT id, code, name_i18n, entitlements_required, region, status
         FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL`,
      ) // 结束预编译
      .get(body.module_code, user.region) as // 绑定模块码与用户区域
      | { id: string; code: string; name_i18n: string; entitlements_required: string; region: string; status: string }
      | undefined; // 未命中即 undefined
    if (!moduleRow) { // 模块不存在
      throw new AppError('NOT_FOUND', 'module not found', { module_code: body.module_code }); // 404
    } // 结束存在性判断
    if (moduleRow.status !== 'active') { // 仅供上架模块下单，草稿/下架不允许成交
      throw new AppError('FEATURE_NOT_AVAILABLE', 'module is not available for purchase', { module_code: body.module_code }); // 403
    } // 结束状态判断

    const owned = db // 是否已持有有效权益：已拥有者无需再下单
      .prepare( // 预编译：取最新一条未过期权益
        `SELECT id, status FROM entitlements
         WHERE user_id = ? AND module_id = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
      ) // 结束预编译
      .get(user.id, moduleRow.id, now) as { id: string; status: string } | undefined; // 命中已有权益
    if (owned?.status === 'active') { // 已解锁：下单无意义
      throw new AppError('CONFLICT', 'module already unlocked', { module_code: body.module_code, entitlement_id: owned.id }); // 409 回传已有权益，前端可直接复用
    } // 结束已拥有判断

    const price = currentPrice(db, moduleRow.id, now); // 下单金额一律取当前生效价格，不接受客户端传入
    if (!price || price.amount_minor <= 0) { // 免费或未定价模块不走订单
      throw new AppError('VALIDATION_FAILED', 'module is free, unlock it directly', { module_code: body.module_code }); // 400 引导调用 POST /entitlements
    } // 结束免费判断

    assertDependenciesMet(db, { // 前置依赖与直接解锁同一口径：未买前置不能买后续
      region: user.region, // 依赖只在同区域生效
      requiredCodes: jsonParse<string[]>(moduleRow.entitlements_required) ?? [], // 解析模块依赖
      userId: user.id, // 当前用户
      now, // 统一时间基准
    }); // 缺失即抛 FEATURE_NOT_AVAILABLE + required 清单

    const pending = db // 是否已有待结算订单：命中即回放，实现「点两次只生成一张单」
      .prepare( // 预编译：同一用户 + 同一模块 + pending
        `SELECT * FROM module_orders WHERE user_id = ? AND module_id = ? AND status = 'pending'`,
      ) // 结束预编译
      .get(user.id, moduleRow.id) as OrderRow | undefined; // 命中行
    if (pending) { // 已有待结算订单直接回放
      res.json({ // 200 表示复用既有订单，而非新建
        order: orderView({ ...pending, module_code: moduleRow.code, module_name: moduleRow.name_i18n }), // 补上模块信息供前端展示
      }); // 结束回放响应
      return; // 提前返回，不重复写库
    } // 结束回放分支

    const id = uuidv7(); // 订单主键，时间有序便于按创建顺序排查
    const channel = body.channel ?? 'manual'; // 渠道缺省 manual：未接在线网关时按人工结算处理
    db.prepare( // 落库：金额与币种在此刻快照，后续调价不影响本单
      `INSERT INTO module_orders
         (id, user_id, module_id, region, currency, amount_minor, status, channel, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(id, user.id, moduleRow.id, user.region, price.currency, price.amount_minor, channel, now, now); // 渠道随订单落地，回调时按渠道校验

    res.status(201).json({ // 201 表示新订单已创建
      order: orderView({ // 订单视图
        id, // 订单主键
        user_id: user.id, // 下单用户
        region: user.region, // 下单区域
        currency: price.currency, // 币种
        amount_minor: price.amount_minor, // 成交金额
        status: 'pending', // 初始状态
        channel, // 结算渠道（请求指定或 manual）
        channel_txn_id: null, // 尚未收到渠道交易号
        entitlement_id: null, // 尚未发放权益
        created_at: now, // 下单时间
        updated_at: now, // 更新时间
        paid_at: null, // 未结算
        cancelled_at: null, // 未取消
        module_code: moduleRow.code, // 模块编码
        module_name: moduleRow.name_i18n, // 模块多语言名称
      }), // 结束订单视图
    }); // 结束响应
  }); // 结束 POST /orders 处理

  /**
   * GET /orders/manage — 管理端订单列表（跨用户）
   * 人工结算场景需要先看到「谁的、哪个模块、多少钱、什么状态」的单子，用户态 GET /orders 只返回本人订单，
   * 故另开管理端只读端点，复用 module_orders 与模块/用户联表。必须注册在 GET /orders 之前以免被前缀吞掉。
   */
  router.get('/orders/manage', requirePermission('entitlement:read'), (req, res) => { // RBAC：需 entitlement:read
    const statusQuery = typeof req.query.status === 'string' ? req.query.status.trim() : ''; // 状态过滤，空串不过滤
    if (statusQuery && !['pending', 'paid', 'cancelled'].includes(statusQuery)) { // 非法状态值直接 400
      throw new AppError('VALIDATION_FAILED', 'status must be one of pending/paid/cancelled'); // 与表 CHECK 约束一致
    } // 结束状态校验
    const regionQuery = typeof req.query.region === 'string' ? req.query.region.trim() : ''; // 区域过滤：cn / global
    if (regionQuery && !['cn', 'global'].includes(regionQuery)) { // 非法区域直接 400，避免静默返回空集
      throw new AppError('VALIDATION_FAILED', 'region must be one of cn/global'); // 400
    } // 结束区域校验
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; // 关键字：模块编码或用户 ID 片段
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100); // 分页大小默认 20，范围 1-100
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0); // 分页偏移，不为负

    const whereParts: string[] = []; // 条件片段（占位符仍走绑定，不拼用户输入）
    const params: unknown[] = []; // 与片段顺序一致的参数
    if (statusQuery) { // 状态条件
      whereParts.push('o.status = ?'); // 状态占位符
      params.push(statusQuery); // 绑定状态值
    } // 结束状态条件
    if (regionQuery) { // 区域条件
      whereParts.push('o.region = ?'); // 区域占位符
      params.push(regionQuery); // 绑定区域值
    } // 结束区域条件
    if (q) { // 关键字条件：模块编码模糊 + 用户 ID 模糊
      whereParts.push('(m.code LIKE ? OR o.user_id LIKE ?)'); // 两列各一个占位符
      params.push(`%${q}%`, `%${q}%`); // LIKE 通配由服务端补，仅作检索提示
    } // 结束关键字条件
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''; // 空条件时不带 WHERE

    const totalRow = db // 总数：必须联模块表，因为关键字会用到 m.code
      .prepare(`SELECT COUNT(*) AS c FROM module_orders o INNER JOIN modules m ON m.id = o.module_id ${where}`) // 计数查询
      .get(...(params as never[])) as { c: number }; // 命中计数
    const rows = db // 列表：再联用户表带出展示名，便于运营核对身份
      .prepare( // 预编译：按创建时间倒序分页
        `SELECT o.*, m.code AS module_code, m.name_i18n AS module_name, u.display_name AS user_display_name
         FROM module_orders o
         INNER JOIN modules m ON m.id = o.module_id
         LEFT JOIN users u ON u.id = o.user_id
         ${where}
         ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      ) // 结束预编译
      .all(...(params as never[]), limit, offset) as Array<OrderRow & { user_display_name: string | null }>; // 行含模块与用户展示名

    res.json({ // 列表响应
      orders: rows.map((row) => ({ ...orderView(row), user_display_name: row.user_display_name })), // 视图 + 用户展示名
      total: totalRow.c, // 满足条件的总数
      limit, // 本页大小
      offset, // 本页偏移
    }); // 结束响应
  }); // 结束 GET /orders/manage 处理

  /**
   * GET /orders/export — 管理端订单清单导出 xlsx（RBAC entitlement:read）
   * 与 /orders/manage 同一套状态 / 区域 / 关键字过滤，但不分页，导出命中全量（上限 5000 行）供离线对账。
   * 必须注册在 GET /orders 与 /orders/:id 之前，避免被前缀路由吞掉。
   */
  router.get('/orders/export', requirePermission('entitlement:read'), async (req, res) => { // 导出需读权益权限；异步写 xlsx 流
    const statusQuery = typeof req.query.status === 'string' ? req.query.status.trim() : ''; // 状态过滤，空串不过滤
    if (statusQuery && !['pending', 'paid', 'cancelled'].includes(statusQuery)) { // 复用与 manage 一致的状态白名单
      throw new AppError('VALIDATION_FAILED', 'status must be one of pending/paid/cancelled'); // 非法状态 400
    } // 结束状态校验
    const regionQuery = typeof req.query.region === 'string' ? req.query.region.trim() : ''; // 区域过滤：cn / global
    if (regionQuery && !['cn', 'global'].includes(regionQuery)) { // 非法区域直接 400
      throw new AppError('VALIDATION_FAILED', 'region must be one of cn/global'); // 400
    } // 结束区域校验
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; // 关键字：模块编码或用户 ID 片段

    const whereParts: string[] = []; // 条件片段（占位符仍走绑定，不拼用户输入）
    const params: unknown[] = []; // 与片段顺序一致的参数
    if (statusQuery) { // 状态条件
      whereParts.push('o.status = ?'); // 状态占位符
      params.push(statusQuery); // 绑定状态值
    } // 结束状态条件
    if (regionQuery) { // 区域条件
      whereParts.push('o.region = ?'); // 区域占位符
      params.push(regionQuery); // 绑定区域值
    } // 结束区域条件
    if (q) { // 关键字条件：模块编码模糊 + 用户 ID 模糊
      whereParts.push('(m.code LIKE ? OR o.user_id LIKE ?)'); // 两列各一个占位符
      params.push(`%${q}%`, `%${q}%`); // LIKE 通配由服务端补，仅作检索提示
    } // 结束关键字条件
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''; // 空条件时不带 WHERE

    const rows = db // 导出全量命中，联模块与用户表带出编码、名称与展示名
      .prepare( // 预编译：按创建时间倒序，硬上限 5000 行防止超大导出打爆内存
        `SELECT o.*, m.code AS module_code, m.name_i18n AS module_name, u.display_name AS user_display_name
         FROM module_orders o
         INNER JOIN modules m ON m.id = o.module_id
         LEFT JOIN users u ON u.id = o.user_id
         ${where}
         ORDER BY o.created_at DESC LIMIT 5000`,
      ) // 结束预编译
      .all(...(params as never[])) as Array<OrderRow & { user_display_name: string | null }>; // 行含模块与用户展示名

    const workbook = new ExcelJS.Workbook(); // 新建工作簿
    const sheet = workbook.addWorksheet('orders'); // 单工作表承载订单清单
    sheet.columns = [ // 列定义：表头 + 字段键 + 列宽，对齐对账阅读习惯
      { header: '订单号', key: 'id', width: 28 }, // 订单主键
      { header: '用户ID', key: 'user_id', width: 28 }, // 下单用户
      { header: '用户展示名', key: 'user_display_name', width: 18 }, // 用户展示名（可能为空）
      { header: '区域', key: 'region', width: 8 }, // 下单区域
      { header: '模块编码', key: 'module_code', width: 24 }, // 模块编码
      { header: '模块名称', key: 'module_name', width: 28 }, // 模块多语言名（取中文，回落英文/编码）
      { header: '金额', key: 'amount', width: 12 }, // 分转元后的可读金额
      { header: '币种', key: 'currency', width: 8 }, // 结算币种
      { header: '状态', key: 'status', width: 12 }, // 订单状态原值
      { header: '渠道', key: 'channel', width: 12 }, // 结算渠道
      { header: '渠道交易号', key: 'channel_txn_id', width: 28 }, // 外部渠道交易号（人工结算为空）
      { header: '下单时间', key: 'created_at', width: 22 }, // 下单时间
      { header: '结算时间', key: 'paid_at', width: 22 }, // 结算时间（未结算为空）
      { header: '取消时间', key: 'cancelled_at', width: 22 }, // 取消时间（未取消为空）
    ]; // 列定义结束

    for (const row of rows) { // 逐行写入，避免一次性构造大数组
      const nameMap = row.module_name ? jsonParse<Record<string, string>>(row.module_name) ?? {} : {}; // 解析多语言名称 JSON，脏数据回落空对象
      sheet.addRow({ // 追加一行订单记录
        id: row.id, // 订单号
        user_id: row.user_id, // 用户 ID
        user_display_name: row.user_display_name ?? '', // 展示名缺失留空
        region: row.region, // 区域
        module_code: row.module_code ?? '', // 模块编码
        module_name: nameMap['zh-CN'] ?? nameMap['en-US'] ?? row.module_code ?? '', // 名称按中→英→编码回落
        amount: (row.amount_minor / 100).toFixed(2), // 分转元，保留两位小数
        currency: row.currency, // 币种
        status: row.status, // 状态
        channel: row.channel, // 渠道
        channel_txn_id: row.channel_txn_id ?? '', // 交易号缺失留空
        created_at: row.created_at, // 下单时间
        paid_at: row.paid_at ?? '', // 结算时间
        cancelled_at: row.cancelled_at ?? '', // 取消时间
      }); // 单行结束
    } // 逐行写入结束

    sheet.getRow(1).font = { bold: true }; // 表头加粗，便于在表格软件中区分标题行

    const stamp = clockOf(deps).replace(/[-:T.Z]/g, '').slice(0, 12); // 统一时间源生成文件名时间戳（年月日时分）
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); // xlsx MIME，浏览器据此触发下载
    res.setHeader('Content-Disposition', `attachment; filename="orders-${stamp}.xlsx"`); // 附件下载文件名
    await workbook.xlsx.write(res); // 把工作簿直接写入响应流，不落临时文件
    res.end(); // 显式结束响应，避免 keep-alive 悬挂
  }); // 结束 GET /orders/export 处理

  /** GET /orders — 当前用户的订单列表（支持 status 过滤 + limit/offset 分页） */
  router.get('/orders', requireAuth, (req, res) => { // 只读，无需幂等键
    const statusQuery = typeof req.query.status === 'string' ? req.query.status.trim() : ''; // 状态过滤，空串不过滤
    if (statusQuery && !['pending', 'paid', 'cancelled'].includes(statusQuery)) { // 非法状态值直接 400
      throw new AppError('VALIDATION_FAILED', 'status must be one of pending/paid/cancelled'); // 与 module_orders.status 的 CHECK 约束一致
    } // 结束状态校验
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100); // 分页大小默认 20，范围 1-100
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0); // 分页偏移，不为负
    const user = req.user!; // 登录态用户

    const where = statusQuery ? 'WHERE o.user_id = ? AND o.status = ?' : 'WHERE o.user_id = ?'; // 条件按是否过滤状态拼接（占位符仍走绑定）
    const params: unknown[] = statusQuery ? [user.id, statusQuery] : [user.id]; // 与 where 顺序一致的参数

    const totalRow = db // 总数查询：与列表同条件
      .prepare(`SELECT COUNT(*) AS c FROM module_orders o ${where}`) // 不联表，计数只依赖订单表
      .get(...(params as never[])) as { c: number }; // 命中计数
    const rows = db // 列表查询：联模块表带出编码与名称
      .prepare( // 预编译：按创建时间倒序分页
        `SELECT o.*, m.code AS module_code, m.name_i18n AS module_name
         FROM module_orders o
         INNER JOIN modules m ON m.id = o.module_id
         ${where}
         ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      ) // 结束预编译
      .all(...(params as never[]), limit, offset) as OrderRow[]; // 行含模块信息

    res.json({ // 列表响应
      orders: rows.map((row) => orderView(row)), // 逐条转视图
      total: totalRow.c, // 满足条件的总数
      limit, // 本页大小
      offset, // 本页偏移
    }); // 结束响应
  }); // 结束 GET /orders 处理

  /** POST /orders/:id/cancel — 取消自己的待结算订单（已取消直接回放，已结算不可取消） */
  router.post('/orders/:id/cancel', requireAuth, idempotency, (req, res) => { // 写操作需幂等键
    const id = pathParam(req, 'id'); // 严格提取订单主键
    const user = req.user!; // 当前用户
    const now = clockOf(deps); // 统一时间基准

    const row = db // 定位订单
      .prepare('SELECT id, user_id, status, cancelled_at FROM module_orders WHERE id = ?') // 只取判定所需字段
      .get(id) as { id: string; user_id: string; status: string; cancelled_at: string | null } | undefined; // 命中行
    if (!row || row.user_id !== user.id) { // 不存在或不属于本人：统一 404 不泄漏他人订单
      throw new AppError('NOT_FOUND', 'order not found', { order_id: id }); // 404
    } // 结束归属判断
    if (row.status === 'paid') { // 已结算订单不可取消，避免「付款后又退单」的账实不一致
      throw new AppError('CONFLICT', 'paid order cannot be cancelled', { order_id: id, status: row.status }); // 409
    } // 结束已结算判断
    if (row.status === 'cancelled') { // 已取消：天然幂等，直接回放
      res.json({ order: { id, status: 'cancelled', cancelled_at: row.cancelled_at } }); // 回显既有取消时间
      return; // 提前返回
    } // 结束回放分支

    db.prepare(`UPDATE module_orders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`) // 置为已取消
      .run(now, now, id); // 绑定两个时间与主键
    res.json({ order: { id, status: 'cancelled', cancelled_at: now } }); // 返回取消结果
  }); // 结束 POST /orders/:id/cancel 处理

  /**
   * POST /orders/:id/settle — 管理端结算订单（当前无在线支付网关，由人工/离线渠道对账后调用）
   * 结算与发放权益在同一事务内完成：订单置 paid、写入订单来源权益、追加审计事件，三件事要么全成要么全废。
   */
  router.post('/orders/:id/settle', requirePermission('entitlement:grant'), (req, res) => { // RBAC：需 entitlement:grant
    const id = pathParam(req, 'id'); // 严格提取订单主键
    const now = clockOf(deps); // 统一时间基准
    const body = parse( // 结算可选备注，仅用于事件原因
      z.object({ reason: z.string().max(200).optional() }), // 超长原因直接 400
      req.body ?? {}, // 允许空 body
    ); // 结束解析

    const row = db // 定位订单（跨用户，管理端视角）
      .prepare( // 预编译：联模块表取编码与主键
        `SELECT o.id, o.user_id, o.module_id, o.region, o.currency, o.amount_minor,
                o.status, o.channel, o.entitlement_id, m.code AS module_code
         FROM module_orders o INNER JOIN modules m ON m.id = o.module_id
         WHERE o.id = ?`,
      ) // 结束预编译
      .get(id) as // 命中行
      | { id: string; user_id: string; module_id: string; region: string; currency: string; amount_minor: number;
          status: string; channel: string; entitlement_id: string | null; module_code: string }
      | undefined; // 未命中
    if (!row) { // 订单不存在
      throw new AppError('NOT_FOUND', 'order not found', { order_id: id }); // 404
    } // 结束存在性判断
    if (row.status === 'cancelled') { // 已取消订单不可结算
      throw new AppError('CONFLICT', 'cancelled order cannot be settled', { order_id: id, status: row.status }); // 409
    } // 结束已取消判断
    if (row.status === 'paid') { // 已结算：幂等回放，不重复发权益
      res.json({ // 200 回放
        order: { id, status: 'paid', entitlement_id: row.entitlement_id, channel: row.channel, channel_txn_id: null }, // 回显既有结算结果（人工通道无交易号）
      }); // 结束回放响应
      return; // 提前返回，避免二次发放
    } // 结束回放分支

    const entId = settleOrderTx(db, { // 三写同事务：订单 paid + 权益 + 事件
      orderId: id, // 订单主键
      userId: row.user_id, // 下单用户
      moduleId: row.module_id, // 目标模块
      now, // 统一时间
      reason: (body.reason ?? '').trim() || 'order_settled', // 空原因回落默认值，保证事件可读
      channelTxnId: null, // 人工结算没有渠道交易号
    }); // 事务执行完毕

    res.json({ // 返回结算结果，前端可据此刷新权益
      order: { id, status: 'paid', entitlement_id: entId, paid_at: now, channel: row.channel, channel_txn_id: null }, // 订单摘要（人工结算无渠道交易号）
      entitlement: { id: entId, user_id: row.user_id, module_code: row.module_code, status: 'active', created_at: now }, // 发放的权益摘要
    }); // 结束响应
  }); // 结束 POST /orders/:id/settle 处理

  /**
   * POST /orders/:id/payment-notify — 外部支付渠道回调（公开端点，靠 HMAC 签名认证）
   *
   * 设计口径：不内置任何具体渠道 SDK（无商户凭证就无法真实验证），而是定义一条可被
   * 支付宝/微信/Stripe 的「支付成功回调」直接对接的标准入口：
   *   - 认证：`x-payment-timestamp`（unix 秒）+ `x-payment-signature` = hex(HMAC-SHA256(secret, canonical))，
   *           canonical = `${orderId}.${channel}.${channel_txn_id}.${amount_minor}.${timestamp}`，
   *           密钥来自 MIM_PAYMENT_NOTIFY_SECRET；时间戳超出 ±300s 视为过期，防重放。
   *   - 幂等：同一 channel_txn_id 只能结算一次（DB 唯一索引兜底）；已结算订单收到同一交易号回调直接 200 回放。
   *   - 金额与渠道必须与下单时快照一致，否则拒绝，避免「改价后补差价」类错账。
   *   - 结算落库与人工结算共用 settleOrderTx，保证权益与审计结构一致。
   */
  router.post('/orders/:id/payment-notify', (req, res) => { // 不挂 requireAuth：渠道服务端没有用户令牌
    const secret = (deps.env.MIM_PAYMENT_NOTIFY_SECRET ?? '').trim(); // 回调密钥
    if (!secret) { // 未配置密钥
      throw new AppError('PAYMENT_NOTIFY_NOT_CONFIGURED', 'payment notify is not configured', { env: 'MIM_PAYMENT_NOTIFY_SECRET' }); // 503，明确缺失项
    } // 结束配置检查

    const id = pathParam(req, 'id'); // 严格提取订单主键
    const now = clockOf(deps); // 统一时间基准
    const body = parse( // 回调报文：渠道、交易号、实付金额
      z.object({
        channel: z.enum(['alipay', 'wechat', 'stripe']), // 在线渠道（manual 不走回调）
        channel_txn_id: z.string().min(1).max(128), // 渠道交易号，幂等依据
        amount_minor: z.number().int().positive(), // 实付金额（分）
      }), // 结束 schema
      req.body, // 原始报文
    ); // 结束解析

    const timestampRaw = (req.header('x-payment-timestamp') ?? '').trim(); // 时间戳头
    const timestamp = Number(timestampRaw); // 转为秒级时间戳
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) { // 缺失或超出 ±5 分钟
      throw new AppError('AUTH_UNAUTHORIZED', 'payment signature expired', { header: 'x-payment-timestamp' }); // 401，拒绝重放
    } // 结束时间戳校验

    const canonical = `${id}.${body.channel}.${body.channel_txn_id}.${body.amount_minor}.${timestamp}`; // 待签名串：全部关键字段参与
    const expected = createHmac('sha256', secret).update(canonical).digest('hex'); // 服务端计算签名
    const provided = (req.header('x-payment-signature') ?? '').trim().toLowerCase(); // 客户端签名
    const expectedBuf = Buffer.from(expected, 'utf8'); // 定长比较前先转 Buffer
    const providedBuf = Buffer.from(provided, 'utf8'); // 同上
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) { // 长度或内容任一不符
      throw new AppError('AUTH_UNAUTHORIZED', 'invalid payment signature', { header: 'x-payment-signature' }); // 401
    } // 结束签名校验

    const row = db // 定位订单
      .prepare( // 只取结算判定所需字段
        `SELECT id, user_id, module_id, status, channel, amount_minor, entitlement_id, channel_txn_id
         FROM module_orders WHERE id = ?`,
      ) // 结束预编译
      .get(id) as // 命中行
      | { id: string; user_id: string; module_id: string; status: string; channel: string; amount_minor: number;
          entitlement_id: string | null; channel_txn_id: string | null }
      | undefined; // 未命中
    if (!row) { // 订单不存在
      throw new AppError('NOT_FOUND', 'order not found', { order_id: id }); // 404
    } // 结束存在性判断

    if (row.status === 'paid') { // 已结算：同一交易号回放，不同交易号视为二次扣款
      if (row.channel_txn_id === body.channel_txn_id) { // 同一笔渠道交易重复通知
        res.json({ order: { id, status: 'paid', entitlement_id: row.entitlement_id, channel_txn_id: row.channel_txn_id }, replayed: true }); // 200 幂等回放
        return; // 提前返回，不重复发放
      } // 结束同交易号分支
      throw new AppError('CONFLICT', 'order already settled by another transaction', { order_id: id, settled_txn_id: row.channel_txn_id }); // 409，人工介入对账
    } // 结束已结算判断

    if (row.status === 'cancelled') { // 已取消订单不接受支付回调
      throw new AppError('CONFLICT', 'cancelled order cannot be settled', { order_id: id, status: row.status }); // 409
    } // 结束已取消判断

    if (row.channel !== body.channel) { // 渠道必须与下单时一致
      throw new AppError('VALIDATION_FAILED', 'channel mismatch', { expected: row.channel, received: body.channel }); // 400
    } // 结束渠道校验

    if (row.amount_minor !== body.amount_minor) { // 金额必须与快照一致
      throw new AppError('VALIDATION_FAILED', 'amount mismatch', { expected: row.amount_minor, received: body.amount_minor }); // 400
    } // 结束金额校验

    const usedTxn = db // 交易号是否已被其它订单占用（唯一索引兜底前的可读校验）
      .prepare('SELECT id FROM module_orders WHERE channel_txn_id = ?') // 全局查交易号
      .get(body.channel_txn_id) as { id: string } | undefined; // 命中行
    if (usedTxn) { // 同一交易号已结算过其它订单
      throw new AppError('CONFLICT', 'transaction already used', { channel_txn_id: body.channel_txn_id, order_id: usedTxn.id }); // 409
    } // 结束交易号占用判断

    const entId = settleOrderTx(db, { // 与人工结算同一事务实现
      orderId: id, // 订单主键
      userId: row.user_id, // 下单用户
      moduleId: row.module_id, // 目标模块
      now, // 统一时间
      reason: `payment_notify:${body.channel}`, // 审计原因标明渠道回调来源
      channelTxnId: body.channel_txn_id, // 记录渠道交易号，供对账与幂等
    }); // 事务执行完毕

    res.json({ order: { id, status: 'paid', entitlement_id: entId, channel: body.channel, channel_txn_id: body.channel_txn_id, paid_at: now }, replayed: false }); // 200 结算成功
  }); // 结束 POST /orders/:id/payment-notify 处理

  // ---------- 管理：模块状态迁移与权益发放 / 回收 ----------

  /** PATCH /modules/:code/status — 模块状态单向迁移：draft → active → archived */
  router.patch('/modules/:code/status', requirePermission('module:write'), (req, res) => { // RBAC：需 module:write；x-admin-token 引导通道同样放行
    const body = parse( // 校验并解析请求体
      z.object({ // 仅接受状态与可选地区
        status: z.enum(['draft', 'active', 'archived']), // 与 modules.status 的 CHECK 约束保持一致
        region: z.string().min(1).max(16).optional(), // 可选地区覆盖，缺省走请求头或 cn
      }), // 结束请求体 schema
      req.body, // 原始请求体
    ); // 结束解析，得到类型安全的 body
    const code = pathParam(req, 'code'); // 严格提取路径参数，非字符串直接 400
    const region = body.region ?? (req.header('x-region')?.trim() || 'cn'); // 与管理端惯例一致：body > 请求头 > cn
    const now = clockOf(deps); // 统一时间基准，写入 updated_at

    const row = db // 定位目标模块
      .prepare( // 预编译：按编码 + 地区 + 未删除定位唯一模块
        'SELECT id, status FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL', // 只取迁移所需字段
      ) // 结束预编译
      .get(code, region) as { id: string; status: string } | undefined; // 命中行为模块主键与当前状态
    if (!row) { // 模块不存在时
      throw new AppError('NOT_FOUND', 'module not found', { module_code: code, region }); // 404 而非空对象，避免误判成功
    } // 结束存在性判断

    const ALLOWED: Record<string, string> = { draft: 'active', active: 'archived' }; // 单向迁移白名单，禁止回退与跨级
    if (row.status === body.status) { // 请求状态与当前一致
      throw new AppError('CONFLICT', 'module is already in the requested status', { // 409：无状态变化即视为冲突
        module_code: code, // 回传模块码便于前端定位
        status: row.status, // 回传当前状态
      }); // 结束错误构造
    } // 结束同状态判断
    if (ALLOWED[row.status] !== body.status) { // 不在白名单内的迁移一律拒绝
      throw new AppError('CONFLICT', 'illegal module status transition', { // 409：状态机不允许该跃迁
        module_code: code, // 回传模块码
        from: row.status, // 当前状态
        to: body.status, // 目标状态
      }); // 结束错误构造
    } // 结束非法迁移判断

    db.prepare('UPDATE modules SET status = ?, updated_at = ? WHERE id = ?') // 落库：状态与更新时间同一次更新
      .run(body.status, now, row.id); // 绑定目标状态、时间与主键
    res.json({ module: { code, region, status: body.status, updated_at: now } }); // 返回迁移后的模块摘要
  }); // 结束 PATCH /modules/:code/status 处理

  /** POST /modules — 新建模块（默认 draft，code 区域内唯一，含已软删行） */
  router.post('/modules', requirePermission('module:write'), (req, res) => { // RBAC：需 module:write
    const body = parse( // 校验并解析请求体
      z.object({ // 新建模块的最小字段集
        code: z // 模块编码
          .string().min(1).max(64) // 长度约束与既有路由一致
          .regex(/^[a-z0-9][a-z0-9._-]*$/, 'code must be lowercase alphanumeric with ._-'), // 放行点号：种子码 comic.workbench 即含点号
        name: z // 多语言名称：语言键 → 文案
          .record(z.string(), z.string().min(1).max(120)) // 文案非空且限长，避免脏数据
          .refine((m) => Object.keys(m).length > 0, { message: 'name must have at least one locale' }), // 至少一个语言键
        summary: z.record(z.string(), z.string().max(500)).optional(), // 多语言简介可缺省为空对象
        region: z.string().min(1).max(16).optional(), // 可选地区覆盖，缺省走请求头或 cn
        sort_order: z.number().int().min(0).max(100000).optional(), // 展示排序权重，缺省 0
        entitlements_required: z.array(z.string().min(1).max(64)).max(32).optional(), // 前置依赖模块码，缺省空数组
      }), // 结束请求体 schema
      req.body, // 原始请求体
    ); // 结束解析
    const region = body.region ?? (req.header('x-region')?.trim() || 'cn'); // 与状态迁移路由保持同一地区解析策略
    const now = clockOf(deps); // 统一时间基准

    const required = body.entitlements_required ?? []; // 归一化前置依赖，缺省为空数组
    if (required.length > 0) { // 有依赖才校验，避免无谓查询
      const placeholders = required.map(() => '?').join(','); // 动态占位符，依赖码走参数绑定
      const found = db // 查询同区域内已存在（未删除）的依赖模块
        .prepare(`SELECT code FROM modules WHERE region = ? AND code IN (${placeholders}) AND deleted_at IS NULL`) // 只取编码列
        .all(region, ...required) as Array<{ code: string }>; // 参数顺序与占位符一致
      const foundSet = new Set(found.map((f) => f.code)); // 转集合便于 O(1) 判断
      const missing = required.filter((c) => !foundSet.has(c)); // 计算缺失依赖
      if (missing.length > 0) { // 存在缺失依赖时拒绝创建
        throw new AppError('VALIDATION_FAILED', 'required modules not found', { required: missing }); // 400 并回传缺失项
      } // 结束缺失判断
    } // 结束依赖校验

    // 依赖环检测：本模块 → 新依赖链若走回自身，则该模块永远无法解锁，必须在写入前拒绝
    assertNoDependencyCycle(db, region, body.code, required); // 成环即 400 并回传成环点

    const dup = db // 唯一性预检：UNIQUE(region, code) 含软删行，提前拦截避免数据库约束报 500
      .prepare('SELECT id FROM modules WHERE region = ? AND code = ?') // 不滤 deleted_at，软删行同样占用编码
      .get(region, body.code) as { id: string } | undefined; // 命中即冲突
    if (dup) { // 编码已被占用（含软删）
      throw new AppError('CONFLICT', 'module code already exists', { module_code: body.code, region }); // 409 提示换码
    } // 结束唯一性判断

    const id = uuidv7(); // 模块主键预生成
    db.prepare( // 插入模块行：unlock_mode 固定 one_time，status 默认 draft
      `INSERT INTO modules (id, code, name_i18n, summary_i18n, unlock_mode, entitlements_required, region, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'one_time', ?, ?, 'draft', ?, ?, ?)`, // 与 schema.sql 列一一对应
    ).run(id, body.code, JSON.stringify(body.name), JSON.stringify(body.summary ?? {}), JSON.stringify(required), region, body.sort_order ?? 0, now, now); // 绑定全部列值

    res.status(201).json({ // 201 表示新模块已创建
      module: { // 回显管理视图
        code: body.code, // 模块编码
        name: body.name, // 多语言名称
        summary: body.summary ?? {}, // 多语言简介
        unlock_mode: 'one_time', // 解锁方式固定值
        region, // 地区
        status: 'draft', // 初始状态固定 draft
        sort_order: body.sort_order ?? 0, // 排序权重
        requires: required, // 前置依赖码列表
        created_at: now, // 创建时间
        updated_at: now, // 更新时间
      }, // 结束模块视图
    }); // 结束响应
  }); // 结束 POST /modules 处理

  /** PATCH /modules/:code — 编辑模块文案/排序/前置依赖（状态变更走 /status 路由） */
  router.patch('/modules/:code', requirePermission('module:write'), (req, res) => { // RBAC：需 module:write
    const body = parse( // 校验并解析请求体
      z.object({ // 全部字段可选，但至少提供一项
        name: z.record(z.string(), z.string().min(1).max(120)) // 多语言名称可改
          .refine((m) => Object.keys(m).length > 0, { message: 'name must have at least one locale' }).optional(),
        summary: z.record(z.string(), z.string().max(500)).optional(), // 多语言简介可改
        sort_order: z.number().int().min(0).max(100000).optional(), // 排序权重可改
        entitlements_required: z.array(z.string().min(1).max(64)).max(32).optional(), // 前置依赖可改
        region: z.string().min(1).max(16).optional(), // 可选地区覆盖，仅用于定位，不参与更新
      }).refine( // 至少一个可编辑字段
        (v) => v.name !== undefined || v.summary !== undefined || v.sort_order !== undefined || v.entitlements_required !== undefined,
        { message: 'at least one editable field must be provided' }, // 空更新直接 400，避免无意义写库
      ), // 结束请求体 schema
      req.body, // 原始请求体
    ); // 结束解析
    const code = pathParam(req, 'code'); // 严格提取路径参数
    const region = body.region ?? (req.header('x-region')?.trim() || 'cn'); // 与其他管理路由同一地区解析策略
    const now = clockOf(deps); // 统一时间基准，写入 updated_at

    const row = db // 定位目标模块
      .prepare('SELECT id FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL') // 只取主键
      .get(code, region) as { id: string } | undefined; // 命中行
    if (!row) { // 模块不存在
      throw new AppError('NOT_FOUND', 'module not found', { module_code: code, region }); // 404 便于前端定位
    } // 结束存在性判断

    if (body.entitlements_required) { // 传入依赖时才校验存在性
      const placeholders = body.entitlements_required.map(() => '?').join(','); // 动态占位符
      const found = db // 查询同区域已存在依赖
        .prepare(`SELECT code FROM modules WHERE region = ? AND code IN (${placeholders}) AND deleted_at IS NULL`)
        .all(region, ...body.entitlements_required) as Array<{ code: string }>; // 命中依赖码
      const foundSet = new Set(found.map((f) => f.code)); // 转集合
      const missing = body.entitlements_required.filter((c) => !foundSet.has(c)); // 缺失项
      if (missing.length > 0) { // 存在缺失依赖时拒绝更新
        throw new AppError('VALIDATION_FAILED', 'required modules not found', { required: missing }); // 400 并回传缺失项
      } // 结束缺失判断
    } // 结束依赖校验

    if (body.entitlements_required) { // 只有改动依赖时才需要重算环
      assertNoDependencyCycle(db, region, code, body.entitlements_required); // 成环即 400 并回传成环点
    } // 结束环检测

    const sets: string[] = []; // 动态 SET 子句片段
    const params: unknown[] = []; // 与 SET 顺序一致的参数
    if (body.name !== undefined) { sets.push('name_i18n = ?'); params.push(JSON.stringify(body.name)); } // 更新名称
    if (body.summary !== undefined) { sets.push('summary_i18n = ?'); params.push(JSON.stringify(body.summary)); } // 更新简介
    if (body.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(body.sort_order); } // 更新排序
    if (body.entitlements_required !== undefined) { sets.push('entitlements_required = ?'); params.push(JSON.stringify(body.entitlements_required)); } // 更新依赖
    sets.push('updated_at = ?'); params.push(now); // 任何编辑都刷新更新时间
    params.push(row.id); // WHERE 参数放最后
    db.prepare(`UPDATE modules SET ${sets.join(', ')} WHERE id = ?`).run(...(params as never[])); // 动态字段全部来自白名单分支，无注入面

    const updated = db // 回读更新后的模块，保证响应与落库一致
      .prepare('SELECT code, name_i18n, summary_i18n, unlock_mode, entitlements_required, region, status, sort_order, updated_at FROM modules WHERE id = ?')
      .get(row.id) as { // 命中行类型
        code: string; name_i18n: string; summary_i18n: string; unlock_mode: string; // 编码与文案
        entitlements_required: string; region: string; status: string; sort_order: number; updated_at: string; // 依赖、地区、状态、排序、更新时间
      }; // 结束类型声明
    res.json({ // 200 返回更新后的管理视图
      module: { // 模块视图
        code: updated.code, // 模块编码
        name: jsonParse<Record<string, string>>(updated.name_i18n) ?? {}, // 名称 JSON 解析
        summary: jsonParse<Record<string, string>>(updated.summary_i18n) ?? {}, // 简介 JSON 解析
        unlock_mode: updated.unlock_mode, // 解锁方式
        region: updated.region, // 地区
        status: updated.status, // 状态（本路由不改状态）
        sort_order: updated.sort_order, // 排序权重
        requires: jsonParse<string[]>(updated.entitlements_required) ?? [], // 前置依赖码列表
        updated_at: updated.updated_at, // 更新时间
      }, // 结束模块视图
    }); // 结束响应
  }); // 结束 PATCH /modules/:code 处理

  /** DELETE /modules/:code — 软删除模块（active 须先归档；重复删除回放 200） */
  router.delete('/modules/:code', requirePermission('module:write'), (req, res) => { // RBAC：需 module:write
    const code = pathParam(req, 'code'); // 严格提取路径参数
    const regionQuery = typeof req.query.region === 'string' ? req.query.region.trim() : ''; // DELETE 通常无 body，region 允许走 query
    const region = regionQuery || req.header('x-region')?.trim() || 'cn'; // query > 请求头 > cn
    const now = clockOf(deps); // 统一时间基准，写入 deleted_at

    const row = db // 定位目标模块（含已软删行，用于幂等回放）
      .prepare('SELECT id, status, deleted_at FROM modules WHERE code = ? AND region = ?') // 不滤 deleted_at
      .get(code, region) as { id: string; status: string; deleted_at: string | null } | undefined; // 命中行
    if (!row) { // 模块不存在
      throw new AppError('NOT_FOUND', 'module not found', { module_code: code, region }); // 404
    } // 结束存在性判断
    if (row.deleted_at) { // 已软删：天然幂等，直接回放
      res.json({ module: { code, region, deleted: true, deleted_at: row.deleted_at } }); // 回显既有删除时间
      return; // 提前返回，不重复写库
    } // 结束幂等回放分支
    if (row.status === 'active') { // active 模块必须先归档，避免在售模块被直接删除
      throw new AppError('CONFLICT', 'module must be archived before deletion', { module_code: code, status: row.status }); // 409 提示先走 /status 归档
    } // 结束状态前置判断

    db.prepare('UPDATE modules SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id); // 软删除：只置 deleted_at，数据保留供审计
    res.json({ module: { code, region, deleted: true, deleted_at: now } }); // 回显删除结果
  }); // 结束 DELETE /modules/:code 处理

  /** POST /modules/:code/prices — 新增模块价格行（按时间窗口生效，支持多币种） */
  router.post('/modules/:code/prices', requirePermission('module:write'), (req, res) => { // RBAC：需 module:write
    const body = parse( // 校验并解析价格入参
      z.object({ // 价格行字段：币种、金额、生效窗口
        currency: z.string().min(1).max(16), // 币种代码，如 CNY / USD
        amount_minor: z.number().int().min(0), // 最小货币单位金额（分），0 表示免费
        effective_from: z // 生效起始时间
          .string() // ISO 字符串传入
          .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'effective_from must be a datetime string' }) // 拒绝非法日期
          .optional(), // 缺省取当前时间，立即生效
        effective_to: z // 生效结束时间
          .string() // ISO 字符串传入
          .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'effective_to must be a datetime string' }) // 拒绝非法日期
          .optional(), // 缺省 null，表示长期有效
      }), // 结束价格行 schema
      req.body, // 原始请求体
    ); // 结束解析
    const code = pathParam(req, 'code'); // 模块编码路径参数
    const region = req.header('x-region')?.trim() || 'cn'; // 地区取请求头，缺省 cn
    const now = clockOf(deps); // 统一时间基准

    const moduleRow = db // 定位目标模块
      .prepare('SELECT id FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL') // 按编码+地区+未删除定位
      .get(code, region) as { id: string } | undefined; // 命中行仅取主键
    if (!moduleRow) { // 模块不存在
      throw new AppError('NOT_FOUND', 'module not found', { module_code: code, region }); // 404 便于前端定位
    } // 存在性判断结束
    if (body.effective_to && body.effective_from && body.effective_to <= body.effective_from) { // 结束时间不早于起始时间
      throw new AppError('VALIDATION_FAILED', 'effective_to must be later than effective_from'); // 400 拒绝倒序窗口
    } // 时间窗口合法性判断结束

    const priceId = uuidv7(); // 价格行主键
    const effectiveFrom = body.effective_from ?? now; // 缺省立即生效
    db.prepare( // 插入价格行
      `INSERT INTO module_prices (id, module_id, currency, amount_minor, effective_from, effective_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, // 与 schema.sql 字段一一对应
    ).run(priceId, moduleRow.id, body.currency, body.amount_minor, effectiveFrom, body.effective_to ?? null, now); // 绑定全部字段

    res.status(201).json({ // 201 表示新价格行已创建
      price: { // 回显已创建的价格行
        id: priceId, // 价格行主键
        module_code: code, // 模块编码
        currency: body.currency, // 币种
        amount_minor: body.amount_minor, // 金额（分）
        effective_from: effectiveFrom, // 生效起始
        effective_to: body.effective_to ?? null, // 生效结束
      }, // 价格行回显结束
    }); // 响应体结束
  }); // 结束 POST /modules/:code/prices 处理

  /** PUT /modules/prices/:id — 更新已有价格行（金额、币种、生效窗口） */
  router.put('/modules/prices/:id', requirePermission('module:write'), (req, res) => { // RBAC：需 module:write
    const body = parse( // 校验并解析更新入参（全部可选，只更新传入字段）
      z.object({ // 可更新字段：币种、金额、生效窗口
        currency: z.string().min(1).max(16).optional(), // 币种可改
        amount_minor: z.number().int().min(0).optional(), // 金额可改
        effective_from: z // 生效起始可改
          .string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'effective_from must be a datetime string' }).optional(),
        effective_to: z // 生效结束可改
          .string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'effective_to must be a datetime string' }).optional(),
      }), // 结束更新入参 schema
      req.body, // 原始请求体
    ); // 结束解析
    const priceId = pathParam(req, 'id'); // 价格行主键路径参数
    const now = clockOf(deps); // 统一时间基准

    const existing = db // 定位待更新的价格行
      .prepare('SELECT id, module_id, currency, amount_minor, effective_from, effective_to FROM module_prices WHERE id = ?') // 仅取可更新字段
      .get(priceId) as // 命中行类型
      | { id: string; module_id: string; currency: string; amount_minor: number; effective_from: string; effective_to: string | null }
      | undefined; // 未命中
    if (!existing) { // 价格行不存在
      throw new AppError('NOT_FOUND', 'module price not found', { price_id: priceId }); // 404 便于定位
    } // 存在性判断结束

    const currency = body.currency ?? existing.currency; // 币种缺省沿用旧值
    const amountMinor = body.amount_minor ?? existing.amount_minor; // 金额缺省沿用旧值
    const effectiveFrom = body.effective_from ?? existing.effective_from; // 起始时间缺省沿用旧值
    const effectiveTo = body.effective_to !== undefined ? body.effective_to : existing.effective_to; // 结束时间允许显式设为 null（永久有效）
    if (effectiveTo && effectiveTo <= effectiveFrom) { // 结束时间不早于起始时间
      throw new AppError('VALIDATION_FAILED', 'effective_to must be later than effective_from'); // 400 拒绝倒序窗口
    } // 时间窗口合法性判断结束

    db.prepare( // 落库更新
      `UPDATE module_prices
       SET currency = ?, amount_minor = ?, effective_from = ?, effective_to = ?
       WHERE id = ?`, // 只更新业务字段，不碰 created_at
    ).run(currency, amountMinor, effectiveFrom, effectiveTo, priceId); // 绑定更新后的值

    res.json({ // 200 返回更新后的价格行
      price: {
        id: priceId, // 价格行主键
        module_id: existing.module_id, // 所属模块主键
        currency, // 更新后币种
        amount_minor: amountMinor, // 更新后金额
        effective_from: effectiveFrom, // 更新后起始
        effective_to: effectiveTo, // 更新后结束
      }, // 价格行回显结束
    }); // 响应体结束
  }); // 结束 PUT /modules/prices/:id 处理

  /** DELETE /modules/prices/:id — 使价格行立即失效（设置 effective_to = now），保留历史留痕 */
  router.delete('/modules/prices/:id', requirePermission('module:write'), (req, res) => { // RBAC：需 module:write
    const priceId = pathParam(req, 'id'); // 价格行主键路径参数
    const now = clockOf(deps); // 统一时间基准，即生效结束时间

    const result = db // 软失效：把 effective_to 设为当前时间，价格行从有效集中移除但保留历史
      .prepare('UPDATE module_prices SET effective_to = ? WHERE id = ? AND (effective_to IS NULL OR effective_to > ?)') // 仅当当前仍有效时才更新
      .run(now, priceId, now); // 绑定结束时间与主键
    if (result.changes === 0) { // 未更新到任何行：价格行不存在或已失效
      throw new AppError('NOT_FOUND', 'module price not found or already expired', { price_id: priceId }); // 404 区分「不存在」与「已过期」
    } // 更新影响行数判断结束

    res.json({ price: { id: priceId, effective_to: now, expired: true } }); // 回显已失效的价格行
  }); // 结束 DELETE /modules/prices/:id 处理

  /** GET /entitlements — 管理端权益全量列表（q/status/region 过滤 + limit/offset 分页） */
  router.get('/entitlements', requirePermission('entitlement:read'), (req, res) => { // RBAC：需 entitlement:read
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; // 搜索词：命中用户 ID 或模块编码
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : ''; // 状态过滤，空串不过滤
    if (status && !['active', 'expired', 'revoked'].includes(status)) { // 非法状态值直接 400
      throw new AppError('VALIDATION_FAILED', 'status must be one of active/expired/revoked'); // 与 entitlements.status 的 CHECK 约束保持一致
    } // 结束状态校验
    const regionQuery = typeof req.query.region === 'string' ? req.query.region.trim() : ''; // query 显式传地区
    const region = regionQuery || req.header('x-region')?.trim() || ''; // region 为空表示跨区域全量（审计场景需要）
    if (region && !['cn', 'global'].includes(region)) { // 显式传了非法地区时拦截
      throw new AppError('VALIDATION_FAILED', 'region must be cn or global'); // 与 modules.region 的 CHECK 约束保持一致
    } // 结束地区校验
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100); // 分页大小：默认 20，范围 1-100
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0); // 分页偏移：默认 0，不为负

    const conds: string[] = []; // 动态 WHERE 条件片段
    const params: unknown[] = []; // 与条件顺序一致的参数
    if (q) { // 有搜索词时同时匹配用户 ID 与模块编码
      conds.push(`(e.user_id LIKE ? ESCAPE '\\' OR m.code LIKE ? ESCAPE '\\')`); // ESCAPE 声明配合 escapeLike 防通配符注入
      const like = `%${escapeLike(q)}%`; // 两侧模糊匹配
      params.push(like, like); // 两个字段共用同一模式
    } // 结束搜索条件
    if (status) { conds.push('e.status = ?'); params.push(status); } // 状态精确匹配
    if (region) { conds.push('m.region = ?'); params.push(region); } // 地区精确匹配（不传则跨区域）
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''; // 无条件时省略 WHERE

    const totalRow = db // 总数查询：与列表同条件，供前端分页器
      .prepare(`SELECT COUNT(*) AS c FROM entitlements e INNER JOIN modules m ON m.id = e.module_id ${where}`) // 不滤 deleted 模块，保证审计真实性
      .get(...(params as never[])) as { c: number }; // 命中计数行
    const rows = db // 列表查询：按创建时间倒序分页
      .prepare( // 预编译：联表取模块编码/名称/地区
        `SELECT e.id, e.user_id, e.status, e.expires_at, e.version, e.created_at, e.updated_at,
                m.code AS module_code, m.name_i18n AS module_name, m.region AS region
         FROM entitlements e
         INNER JOIN modules m ON m.id = e.module_id
         ${where}
         ORDER BY e.created_at DESC LIMIT ? OFFSET ?`, // 最新发放在前
      ) // 结束预编译
      .all(...(params as never[]), limit, offset) as Array<{ // 绑定条件参数与分页参数
      id: string; // 权益主键
      user_id: string; // 用户主键
      status: string; // 权益状态
      expires_at: string | null; // 到期时间
      version: number; // 乐观锁版本
      created_at: string; // 创建时间
      updated_at: string; // 更新时间
      module_code: string; // 模块编码
      module_name: string; // 模块多语言名称 JSON
      region: string; // 模块地区
    }>; // 结束结果类型声明

    res.json({ // 列表响应体
      entitlements: rows.map((r) => ({ // 逐条转换为对外视图
        id: r.id, // 权益 ID
        user_id: r.user_id, // 用户 ID
        module_code: r.module_code, // 模块编码
        module_name: jsonParse<Record<string, string>>(r.module_name) ?? { 'zh-CN': r.module_code }, // 名称缺省回落编码
        region: r.region, // 地区
        status: r.status, // 状态
        expires_at: r.expires_at, // 到期时间
        version: r.version, // 版本号
        created_at: r.created_at, // 创建时间
        updated_at: r.updated_at, // 更新时间
      })), // 结束映射
      total: totalRow.c, // 满足条件的总数
      limit, // 本页大小
      offset, // 本页偏移
    }); // 结束响应
  }); // 结束 GET /entitlements 处理

  /** GET /entitlements/:id/events — 权益状态流转审计事件（按写入顺序升序） */
  router.get('/entitlements/:id/events', requirePermission('entitlement:read'), (req, res) => { // RBAC：需 entitlement:read
    const id = pathParam(req, 'id'); // 严格提取权益主键
    const ent = db // 权益存在性校验
      .prepare('SELECT id FROM entitlements WHERE id = ?') // 只取主键
      .get(id) as { id: string } | undefined; // 命中行
    if (!ent) { // 权益不存在
      throw new AppError('NOT_FOUND', 'entitlement not found', { entitlement_id: id }); // 404
    } // 结束存在性判断

    const events = db // 事件查询：按写入顺序返回完整审计链
      .prepare( // 预编译：同一权益的全部事件
        `SELECT id, from_status, to_status, reason, actor, created_at
         FROM entitlement_events WHERE entitlement_id = ?
         ORDER BY created_at ASC, rowid ASC`, // rowid 兜底同一毫秒内的写入顺序
      ) // 结束预编译
      .all(id) as Array<{ // 取回全部事件
      id: string; // 事件主键
      from_status: string | null; // 起始状态（首次发放为 null）
      to_status: string; // 目标状态
      reason: string | null; // 触发原因
      actor: string; // 操作者（job/admin/system）
      created_at: string; // 事件时间
    }>; // 结束结果类型声明
    res.json({ events }); // 返回事件列表
  }); // 结束 GET /entitlements/:id/events 处理

  /** POST /entitlements/grant — 管理端发放权益（自然幂等：已 active 未过期直接回放现有记录） */
  router.post('/entitlements/grant', requirePermission('entitlement:grant'), (req, res) => { // RBAC：需 entitlement:grant
    const body = parse( // 校验并解析请求体
      z.object({ // 发放所需的最小字段集
        user_id: z.string().min(1).max(64), // 目标用户主键
        module_code: z.string().min(1).max(64), // 目标模块编码
        region: z.string().min(1).max(16).optional(), // 可选地区覆盖，缺省走请求头或 cn
        expires_at: z // 可选到期时间
          .string() // 以 ISO 字符串传入，避免时区歧义
          .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'expires_at must be a datetime string' }) // 拒绝非法日期，防止写入脏值
          .optional(), // 不传即永久有效
      }), // 结束请求体 schema
      req.body, // 原始请求体
    ); // 结束解析，得到类型安全的 body
    const region = body.region ?? (req.header('x-region')?.trim() || 'cn'); // 与状态迁移路由保持同一地区解析策略
    const now = clockOf(deps); // 统一时间基准

    const userRow = db // 校验目标用户
      .prepare('SELECT id, status FROM users WHERE id = ?') // 只取状态用于判定是否已注销
      .get(body.user_id) as { id: string; status: string } | undefined; // 命中行
    if (!userRow || userRow.status === 'deleted') { // 用户不存在或已删除
      throw new AppError('NOT_FOUND', 'user not found', { user_id: body.user_id }); // 404：不给已删除账号发权益
    } // 结束用户校验

    const moduleRow = db // 校验目标模块
      .prepare('SELECT id, code FROM modules WHERE code = ? AND region = ? AND deleted_at IS NULL') // 按编码 + 地区 + 未删除定位
      .get(body.module_code, region) as { id: string; code: string } | undefined; // 命中行
    if (!moduleRow) { // 模块不存在
      throw new AppError('NOT_FOUND', 'module not found', { module_code: body.module_code, region }); // 404
    } // 结束模块校验

    // 唯一索引 uq_entitlements_user_module_once 保证「每用户每模块仅一条手工权益（source_id IS NULL）」
    const existing = db // 查已有手工权益
      .prepare( // 预编译：只认 source_id IS NULL 的手工发放记录
        `SELECT id, status, expires_at, version, created_at FROM entitlements
         WHERE user_id = ? AND module_id = ? AND source_id IS NULL
         ORDER BY created_at DESC LIMIT 1`, // 理论上唯一，ORDER BY 仅为兜底
      ) // 结束预编译
      .get(userRow.id, moduleRow.id) as // 绑定用户与模块
      | { id: string; status: string; expires_at: string | null; version: number; created_at: string } // 命中行
      | undefined; // 无记录
    const stillValid = existing ? existing.expires_at === null || existing.expires_at > now : false; // 现有权益是否仍有效
    if (existing && existing.status === 'active' && stillValid) { // 已激活且未过期：直接回放，保证重复发放幂等
      res.json({ // 200 回放现有记录
        entitlement: { // 权益视图
          id: existing.id, // 权益主键
          user_id: userRow.id, // 目标用户
          module_code: moduleRow.code, // 模块编码
          status: existing.status, // 当前状态
          expires_at: existing.expires_at, // 到期时间
          version: existing.version, // 乐观锁版本
          created_at: existing.created_at, // 首次发放时间
        }, // 结束权益视图
      }); // 结束响应
      return; // 提前返回，不再写入任何行
    } // 结束幂等回放分支

    const entId = existing?.id ?? uuidv7(); // 复用已有主键，不存在才生成新主键
    const evtId = uuidv7(); // 事件主键预生成
    const fromStatus = existing?.status ?? null; // 事件起点：新建为 null，重新激活则为 expired/revoked
    const tx = db.transaction(() => { // 权益与事件同事务，保证审计链完整
      if (existing) { // 已有记录：重新激活并刷新到期时间
        db.prepare( // 更新已有权益
          `UPDATE entitlements SET status = 'active', expires_at = ?, version = version + 1, updated_at = ?
           WHERE id = ?`, // 版本自增，便于前端做乐观并发判断
        ).run(body.expires_at ?? null, now, entId); // 绑定新到期时间、更新时间与主键
      } else { // 无记录：插入新权益
        db.prepare( // 插入手工发放权益
          `INSERT INTO entitlements (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
           VALUES (?, ?, ?, 'admin', NULL, 'active', ?, 1, ?, ?)`, // source 固定 admin，source_id 为 NULL 落到手工唯一索引
        ).run(entId, userRow.id, moduleRow.id, body.expires_at ?? null, now, now); // 绑定全部列值
      } // 结束分支
      db.prepare( // 追加状态流转事件
        `INSERT INTO entitlement_events (id, entitlement_id, from_status, to_status, reason, actor, created_at)
         VALUES (?, ?, ?, 'active', 'admin_grant', 'admin', ?)`, // actor 固定 admin，reason 便于审计追溯
      ).run(evtId, entId, fromStatus, now); // 绑定事件字段
    }); // 结束事务定义
    tx(); // 执行事务

    res.status(existing ? 200 : 201).json({ // 新建 201，重新激活 200
      entitlement: { // 权益视图
        id: entId, // 权益主键
        user_id: userRow.id, // 目标用户
        module_code: moduleRow.code, // 模块编码
        status: 'active', // 发放后状态
        expires_at: body.expires_at ?? null, // 到期时间，null 表示永久
        version: (existing?.version ?? 0) + 1, // 与落库后的版本号一致
        created_at: existing?.created_at ?? now, // 保留首次发放时间
      }, // 结束权益视图
    }); // 结束响应
  }); // 结束 POST /entitlements/grant 处理

  /** POST /entitlements/:id/revoke — 管理端回收权益（已 revoked 直接回放当前状态） */
  router.post('/entitlements/:id/revoke', requirePermission('entitlement:revoke'), (req, res) => { // RBAC：需 entitlement:revoke
    const body = parse( // 校验并解析请求体
      z.object({ // 回收仅需可选原因
        reason: z.string().max(200).optional(), // 审计原因，超长直接 400
      }), // 结束请求体 schema
      req.body ?? {}, // 允许空 body，避免无 Content-Type 时报未定义
    ); // 结束解析
    const id = pathParam(req, 'id'); // 严格提取权益主键
    const now = clockOf(deps); // 统一时间基准

    const row = db // 定位权益
      .prepare('SELECT id, user_id, status, version FROM entitlements WHERE id = ?') // 只取回收所需字段
      .get(id) as { id: string; user_id: string; status: string; version: number } | undefined; // 命中行
    if (!row) { // 权益不存在
      throw new AppError('NOT_FOUND', 'entitlement not found', { entitlement_id: id }); // 404
    } // 结束存在性判断

    if (row.status === 'revoked') { // 已回收：天然幂等，直接回放当前状态
      res.json({ // 200 回放
        entitlement: { id: row.id, user_id: row.user_id, status: row.status, version: row.version, updated_at: now }, // 当前状态
      }); // 结束响应
      return; // 提前返回，不再追加事件
    } // 结束幂等回放分支

    const reason = (body.reason ?? '').trim() || 'admin_revoke'; // 空原因回落默认值，保证事件可读
    const fromStatus = row.status; // 事件起点固定为当前状态（active 或 expired）
    const tx = db.transaction(() => { // 状态更新与事件同事务
      db.prepare('UPDATE entitlements SET status = ?, version = version + 1, updated_at = ? WHERE id = ?') // 置为 revoked 并自增版本
        .run('revoked', now, row.id); // 绑定状态、时间与主键
      db.prepare( // 追加回收事件
        `INSERT INTO entitlement_events (id, entitlement_id, from_status, to_status, reason, actor, created_at)
         VALUES (?, ?, ?, 'revoked', ?, 'admin', ?)`, // actor 固定 admin
      ).run(uuidv7(), row.id, fromStatus, reason, now); // 绑定事件字段
    }); // 结束事务定义
    tx(); // 执行事务

    res.json({ // 返回回收后的权益摘要
      entitlement: { id: row.id, user_id: row.user_id, status: 'revoked', version: row.version + 1, updated_at: now }, // 与落库一致
    }); // 结束响应
  }); // 结束 POST /entitlements/:id/revoke 处理

  return router; // 交出可挂载的路由实例
} // 结束 createCatalogRouter
