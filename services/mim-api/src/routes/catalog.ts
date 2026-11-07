/**
 * 功能模块商城（FR-03.1，07 §5.1 / §11.11）
 *
 * catalog 域 4 表已建：modules / module_prices / entitlements / entitlement_events；
 * 本文件补齐后端路由（此前仅有 requireEntitlement 中间件门禁，无商城侧写路径）。
 *
 * 路由一览：
 *   GET   /modules                  公开 — 按 region 列出 active 模块（含当前有效价格）
 *   GET   /modules/:code            公开 — 模块详情（含前置依赖、当前有效价格）
 *   POST  /entitlements             鉴权 — 请求解锁（校验前置依赖，发放 active entitlement + event）
 *   GET   /me/entitlements          鉴权 — 当前用户的有效解锁列表
 *   PATCH /modules/:code/status     管理 — 模块状态单向迁移 draft → active → archived
 *   POST  /entitlements/grant       管理 — 手工发放权益（已 active 未过期直接回放现有记录）
 *   POST  /entitlements/:id/revoke  管理 — 回收权益（已 revoked 直接回放当前状态）
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
    unlock_mode: string; // 解锁方式（free/paid/entitlement）
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

  /** GET /modules — 按 user.region 列出 active 模块（含当前有效价格） */
  router.get('/modules', (req, res) => { // 公开目录列表，无需登录
    const region = (req.user?.region ?? (req.headers['x-region'] as string)) ?? 'cn'; // 优先登录用户地区，其次请求头，最后兜底 cn
    const now = clockOf(deps); // 统一时间基准，保证价格区间判定一致

    const rows = resolveActiveModules(db, region).filter((m) => MODULE_VISIBLE.has(m.status)); // 仅保留 active 模块，过滤草稿与下线
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
