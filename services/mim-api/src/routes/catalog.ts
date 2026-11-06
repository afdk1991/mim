/**
 * 功能模块商城（FR-03.1，07 §5.1 / §11.11）
 *
 * catalog 域 4 表已建：modules / module_prices / entitlements / entitlement_events；
 * 本文件补齐后端路由（此前仅有 requireEntitlement 中间件门禁，无商城侧写路径）。
 *
 * 路由一览：
 *   GET  /modules              公开 — 按 region 列出 active 模块（含当前有效价格）
 *   GET  /modules/:code        公开 — 模块详情（含前置依赖、当前有效价格）
 *   POST /entitlements         鉴权 — 请求解锁（校验前置依赖，发放 active entitlement + event）
 *   GET  /me/entitlements      鉴权 — 当前用户的有效解锁列表
 */

import { Router } from 'express'; // 路由容器，按前缀挂载到 /api/v1
import { z } from 'zod'; // 请求体校验，拦截非法模块码
import { AppError, uuidv7 } from '@mim/core-domain'; // 业务错误码 + 时间有序主键
import { clockOf } from '../domain.js'; // 可注入时钟，测试时可冻结时间
import { idempotency, requireAuth } from '../middleware.js'; // 解锁需登录 + 幂等保护，防重复发放
import { parse } from '../validate.js'; // zod 校验失败统一转 AppError
import { jsonParse } from '../utils.js'; // 安全解析 JSON 列（i18n 文案、依赖数组）
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
    const now = deps.now ? deps.now() : new Date().toISOString(); // 统一时间基准，保证价格区间判定一致

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
    const now = deps.now ? deps.now() : new Date().toISOString(); // 当前时间，用于判定生效价格
    const code = pathSafe(req.params.code); // 路径参数做安全包装，便于后续收紧校验

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
    const now = deps.now ? deps.now() : new Date().toISOString(); // 统一时间基准

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
    const now = deps.now ? deps.now() : new Date().toISOString(); // 当前时间用于过滤过期权益

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

  return router; // 交出可挂载的路由实例
} // 结束 createCatalogRouter

function pathSafe(input: string): string { // 路径参数安全包装，当前直接返回以便后续集中收紧
  return input; // 保持原值，调用方仍按模块码查询
} // 结束 pathSafe
