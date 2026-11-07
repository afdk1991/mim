/**
 * 功能模块商城（FR-03.1，07 §5.1 / §11.11）
 *
 * catalog 域 4 表已建：modules / module_prices / entitlements / entitlement_events；
 * 本文件补齐后端路由（此前仅有 requireEntitlement 中间件门禁，无商城侧写路径）。
 *
 * 路由一览：
 *   GET    /modules                 公开 — 按 region 列出 active 模块（含当前有效价格，支持 q 搜索）
 *   GET    /modules/manage          管理 — 模块全量列表（含 draft/archived，支持 q/status 过滤；须先于 /modules/:code 注册）
 *   GET    /modules/:code           公开 — 模块详情（含前置依赖、当前有效价格、历史价格）
 *   POST   /entitlements            鉴权 — 请求解锁（校验前置依赖，发放 active entitlement + event）
 *   GET    /me/entitlements         鉴权 — 当前用户的有效解锁列表
 *   POST   /modules                 管理 — 新建模块（默认 draft，code 区域内唯一）
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

import { Router } from 'express'; // 路由容器，按前缀挂载到 /api/v1
import { z } from 'zod'; // 请求体校验，拦截非法模块码
import { AppError, uuidv7 } from '@mim/core-domain'; // 业务错误码 + 时间有序主键
import { clockOf } from '../domain.js'; // 可注入时钟，测试时可冻结时间
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 解锁需登录 + 幂等；管理写路径走 RBAC 权限点校验
import { parse } from '../validate.js'; // zod 校验失败统一转 AppError
import { jsonParse, pathParam } from '../utils.js'; // 安全解析 JSON 列 + 严格路径参数提取
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
      `SELECT currency, amount_minor, effective_from, effective_to
       FROM module_prices
       WHERE module_id = ?
       ORDER BY effective_from DESC`,
    ) // 结束预编译
    .all(moduleId) as Array<{ // 取回全部行并声明结果类型
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
              region, status, sort_order
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
  }>; // 结束结果类型声明
  return rows; // 交由调用方做状态过滤，保持查询职责单一
} // 结束 resolveActiveModules

export function createCatalogRouter(deps: ApiDeps): Router { // 组装目录路由
  const router = Router(); // 独立路由实例
  const db = deps.db; // 缓存数据库句柄，减少重复解构

  // ---------- 公开：模块目录与详情 ----------

  /** GET /modules — 按 user.region 列出 active 模块（含当前有效价格，支持 q 搜索编码/名称） */
  router.get('/modules', (req, res) => { // 公开目录列表，无需登录
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn'; // 优先登录用户地区，其次请求头，最后兜底 cn
    const now = clockOf(deps); // 统一时间基准，保证价格区间判定一致
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''; // 搜索关键词小写化，空串视为未传

    const visible = resolveActiveModules(db, region).filter((m) => MODULE_VISIBLE.has(m.status)); // 仅保留 active 模块，过滤草稿与下线
    const rows = q // 有搜索词才过滤，避免空词触发无谓遍历
      ? visible.filter((m) => m.code.toLowerCase().includes(q) || m.name_i18n.toLowerCase().includes(q)) // 编码或多语言名称 JSON 文本命中即可
      : visible; // 无搜索词保持原列表
    const modules = rows.map((m) => { // 将数据库行转换为对外视图
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
        current_price: price // 当前价格分支
          ? { currency: price.currency, amount_minor: price.amount_minor } // 只透出当前价格关键字段
          : null, // 无有效价格则为 null，前端可显示「免费/待定价」
      }; // 结束单模块视图
    }); // 结束映射，得到模块数组
    res.json({ modules }); // 统一包裹在 modules 字段下，便于后续扩展分页
  }); // 结束 GET /modules 处理

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
                region, status, sort_order, created_at, updated_at
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
                region, status
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
      current_price: price // 当前价格分支
        ? { currency: price.currency, amount_minor: price.amount_minor } // 当前价格
        : null, // 无有效价格
      price_history: prices, // 历史价格列表，便于展示调价记录
    }); // 结束详情响应
  }); // 结束 GET /modules/:code 处理

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

    // 3. 前置依赖：每个 required 模块必须有 active entitlement
    const requiredCodes = jsonParse<string[]>(moduleRow.entitlements_required) ?? []; // 解析依赖码
    if (requiredCodes.length > 0) { // 无依赖则跳过整段校验
      const placeholders = requiredCodes.map(() => '?').join(','); // 动态占位符，避免把用户输入拼进 SQL
      const depRows = db // 依赖满足情况查询起点
        .prepare( // 预编译：内连接权益表，一次查出已满足依赖
          `SELECT m.code FROM modules m
           INNER JOIN entitlements e ON e.module_id = m.id
           WHERE m.region = ? AND m.code IN (${placeholders}) AND m.deleted_at IS NULL
             AND e.user_id = ? AND e.status = 'active'
             AND (e.expires_at IS NULL OR e.expires_at > ?)`,
        ) // 结束预编译
        .all(user.region, ...requiredCodes, user.id, now) as Array<{ code: string }>; // 参数顺序与占位符一致
      const satisfied = new Set(depRows.map((d) => d.code)); // 转集合便于 O(1) 判断
      const missing = requiredCodes.filter((c) => !satisfied.has(c)); // 计算缺失依赖
      if (missing.length > 0) { // 存在缺失依赖时拒绝
        throw new AppError('FEATURE_NOT_AVAILABLE', 'module dependency not met', { // 明确依赖未满足
          required: missing, // 精确回传缺失项，前端可引导先解锁
        }); // 结束错误构造
      } // 结束缺失判断
    } // 结束依赖校验

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
