/** 请求 ID、鉴权、幂等回放与统一错误信封 */

import { randomUUID, timingSafeEqual } from 'node:crypto'; // 引入 UUID 生成器与常量时间比较，后者防止令牌比较被计时侧信道猜解
import type { NextFunction, Request, Response } from 'express'; // 仅引入 Express 中间件类型，编译期擦除
import { AppError, isAppError } from '@mim/core-domain'; // 引入统一业务异常与类型守卫，错误信封集中管理
import { ADMIN_TOKEN_ENV_KEY, REQUIRE_IDEMPOTENCY } from './config.js'; // 引入幂等强制开关与管理令牌环境变量键名
import { sha256, verifyAccessToken } from './auth.js'; // 引入请求指纹哈希与访问令牌校验
import type { RbacPermissionCode } from './db.js'; // 权限点联合类型，保证 requirePermission 调用处拼写错误在编译期暴露
import type { Db } from './types.js'; // 数据库句柄类型，供 loadPermissions 声明参数

interface AuthRow { // 鉴权从库中读出的用户行结构
  id: string; // 用户唯一 ID
  region: 'cn' | 'global'; // 区域，决定可用模块与身份类型
  status: 'active' | 'pending_deletion' | 'deleted'; // 账号状态，注销宽限期内限制大部分接口
  display_name: string; // 昵称，供路由直接返回
  locale: string; // 语言偏好
  timezone: string; // 时区偏好
} // AuthRow 结束

interface IdempotencyRow { // 幂等表行结构
  key: string; // 客户端提供的幂等键
  user_id: string; // 幂等作用域所属用户，避免跨用户撞键
  request_hash: string; // 方法+路径+请求体的指纹，用于识别「同键不同参」
  response_status: number | null; // 首次响应状态码；null 表示仍在处理中
  response_body: string | null; // 首次响应体 JSON 文本；null 表示仍在处理中
} // IdempotencyRow 结束

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']); // 会产生副作用的写方法集合，幂等中间件只对它们生效

const DELETION_WHITELIST = new Set(['GET /api/v1/me', 'POST /api/v1/me/cancel-deletion']); // 待删除账号仍可访问的白名单：查资料与撤销注销

export function requestId(req: Request, res: Response, next: NextFunction): void { // 中间件：为每个请求分配可追踪 ID
  req.requestId = req.header('x-request-id') ?? randomUUID(); // 优先复用上游传入的 ID（网关已生成），否则本地生成 UUID
  res.setHeader('x-request-id', req.requestId); // 回写响应头，便于前端与日志按同一 ID 关联排查
  next(); // 继续后续中间件链
} // requestId 结束

/**
 * 解析 Bearer 令牌并加载当前用户（不挂载到 req，由调用方决定）。
 * 抽出为独立函数是为了让 requireAuth 与 requirePermission 共用同一套
 * 「签名校验 + 用户有效性 + 注销冷静期」逻辑，避免两处实现漂移到不同安全水位。
 */
function resolveBearerUser(req: Request): AuthRow { // 内部辅助：令牌 → 用户行，失败一律抛 AppError
  const header = req.header('authorization') ?? ''; // 取 Authorization 头，缺失时用空串统一后续判断
  const match = /^Bearer\s+(.+)$/i.exec(header); // 严格匹配 Bearer 方案（大小写不敏感）并捕获令牌本体
  if (!match || !match[1]) { // 头缺失或格式不符
    throw new AppError('AUTH_UNAUTHORIZED', 'missing bearer token'); // 统一 401，不区分「没带」与「格式错」以免暴露协议细节
  } // 头格式校验结束
  const payload = verifyAccessToken(match[1], req.deps.jwtSecret); // 校验签名与过期时间，失败抛 AUTH_UNAUTHORIZED
  const row = req.deps.db // 从库中加载最新用户行，使注销等状态变更即时生效（不信任令牌内快照）
    .prepare('SELECT id, region, status, display_name, locale, timezone FROM users WHERE id = ?') // 只选鉴权与展示所需字段
    .get(payload.sub) as AuthRow | undefined; // 按令牌 sub 精确查询单行，查不到为 undefined
  if (!row || row.status === 'deleted') { // 用户不存在或已软删除时令牌即失效
    throw new AppError('AUTH_UNAUTHORIZED', 'account is not available'); // 统一 401，避免区分「不存在」与「已删除」
  } // 用户有效性校验结束
  const pathname = req.originalUrl.split('?')[0] ?? ''; // 去掉查询串，仅用路径参与白名单匹配
  if (row.status === 'pending_deletion' && !DELETION_WHITELIST.has(`${req.method} ${pathname}`)) { // 待删除账号除查资料与撤销外一律拒绝
    throw new AppError('ACCOUNT_DELETION_PENDING', 'account is pending deletion'); // 专用错误码，前端据此引导撤销注销
  } // 待删除门禁结束
  return row; // 交出已校验用户行，由调用方决定是否写入 req.user
} // resolveBearerUser 结束

export function requireAuth(req: Request, _res: Response, next: NextFunction): void { // 中间件：解析 Bearer 令牌并加载当前用户
  req.user = resolveBearerUser(req); // 复用统一解析逻辑，保持与 requirePermission 同一安全水位
  next(); // 通过鉴权，进入业务处理
} // requireAuth 结束

/**
 * 写操作幂等：同 Key 同请求体回放首次响应；同 Key 不同请求体 409；
 * 失败响应不落库，允许修正后重试。
 */
export function idempotency(req: Request, res: Response, next: NextFunction): void { // 中间件：保证同一次写操作重复提交得到同一结果
  if (!MUTATING_METHODS.has(req.method)) { // 只对可能产生副作用的写方法生效
    next(); // 读请求直接放行，不占用幂等表
    return; // 提前返回，跳过后续全部逻辑
  } // 方法过滤结束
  const key = req.header('idempotency-key') ?? ''; // 取客户端幂等键
  if (!key) { // 未提供幂等键
    if (REQUIRE_IDEMPOTENCY) { // 生产环境可强制要求，避免重复扣费或重复创建
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header is required for write operations', { // 400 并明确缺失的请求头
        field: 'Idempotency-Key', // 便于前端统一提示与自动补头
      }); // 异常构造结束
    } // 强制开关分支结束
    next(); // 非强制模式下降级为普通请求
    return; // 提前返回
  } // 缺失键分支结束
  const userId = req.user?.id; // 幂等作用域绑定到用户，避免不同用户使用相同键互相干扰
  if (!userId) throw new AppError('AUTH_UNAUTHORIZED', 'idempotency requires an authenticated user'); // 未鉴权无法确定作用域，直接 401

  const db = req.deps.db; // 复用请求上已注入的数据库连接
  const requestHash = sha256(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`); // 对方法+路径+请求体取指纹，用于判定「同键不同参」
  const existing = db // 查询该用户下是否已经存在同键记录
    .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND user_id = ?') // 键 + 用户双条件，保证作用域隔离
    .get(key, userId) as IdempotencyRow | undefined; // 取单行或 undefined

  if (existing) { // 已存在记录：进入回放或冲突判定
    if (existing.request_hash !== requestHash) { // 同键但请求体不同，属客户端误用
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was reused with a different payload'); // 409 语义，提示换键重试
    } // 指纹比对结束
    if (existing.response_status === null || existing.response_body === null) { // 首次请求尚未完成（响应未落库）
      throw new AppError('CONFLICT', 'an identical request is still in progress'); // 并发重复提交，提示稍后重试
    } // 进行中判定结束
    res.status(existing.response_status).json(JSON.parse(existing.response_body)); // 回放首次成功响应，保证客户端拿到同一结果
    return; // 回放后终止，不再执行业务逻辑
  } // 已存在分支结束

  db.prepare( // 预占幂等键：先落一条无响应记录，标记「处理中」
    // 说明：插入占位行，response_status / response_body 留空表示尚未完成
    `INSERT INTO idempotency_keys (key, user_id, method, path, request_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`, // 六个占位符依次为键、用户 ID、方法、路径、请求指纹、创建时间
  ).run(key, userId, req.method, req.originalUrl, requestHash, new Date().toISOString()); // 绑定实参并写入占位行

  const originalJson = res.json.bind(res); // 保存原始 json 方法，包装后仍需调用它输出真实响应
  res.json = ((body: unknown) => { // 重写 res.json：在响应发出前把结果回写幂等表
    const status = res.statusCode; // 取业务层设置的状态码，用于区分成功与失败
    try { // 幂等落库失败不能影响正常响应，故整体 try 包裹
      if (status < 400) { // 仅成功响应可回放，失败响应不落库以便客户端修正后重试
        db.prepare( // 成功：把状态码与响应体写回占位行
          // 说明：按键 + 用户精确定位占位行，写入可回放的响应
          `UPDATE idempotency_keys SET response_status = ?, response_body = ?
           WHERE key = ? AND user_id = ?`, // 占位符依次为状态码、响应体 JSON、键、用户 ID
        ).run(status, JSON.stringify(body), key, userId); // 序列化响应体后落库
      } else { // 失败响应分支
        db.prepare('DELETE FROM idempotency_keys WHERE key = ? AND user_id = ?').run(key, userId); // 删除占位行，允许修正后同键重试
      } // 成功/失败分支结束
    } catch { // 落库异常（如磁盘满）时静默忽略
      // 幂等落库失败不应影响业务响应
    } // try/catch 结束
    return originalJson(body); // 调用原始 json 输出真实响应
  }) as Response['json']; // 类型断言与 Express 的 json 签名对齐

  next(); // 占位成功，进入业务处理
} // idempotency 结束

interface ModuleRow { // 模块查询结果结构
  id: string; // 模块主键，权益表按此关联
  code: string; // 模块业务编码，如 comic.workbench
  status: 'draft' | 'active' | 'archived'; // 模块状态，仅 active 可售卖与解锁
} // ModuleRow 结束

interface EntitlementRow { // 权益查询结果结构
  id: string; // 权益主键
  status: string; // 权益状态，当前已过滤为 active
  expires_at: string | null; // 过期时间；null 表示长期有效
} // EntitlementRow 结束

/**
 * 功能模块解锁门禁（07 §12.1）：用户须在所属区域持有该模块的有效权益。
 * 模块缺失 / 非 active / 无有效权益统一返回 FEATURE_NOT_AVAILABLE(403)，
 * 不泄漏「模块存在但未购买」与「模块不存在」的差异。
 */
export function requireEntitlement(moduleCode: string) { // 高阶中间件工厂：按模块编码生成门禁
  return (req: Request, _res: Response, next: NextFunction): void => { // 返回实际执行的中间件
    const user = req.user; // 依赖前置 requireAuth 注入的用户
    if (!user) throw new AppError('AUTH_UNAUTHORIZED', 'entitlement check requires an authenticated user'); // 未登录无法判定权益，直接 401
    const now = req.deps.now ? req.deps.now() : new Date().toISOString(); // 取当前时间（可注入时钟），用于权益过期判断

    const moduleRow = req.deps.db // 在本区查找该模块
      .prepare( // 准备查询语句
        // 说明：按「编码 + 区域」定位未删除的模块，避免跨区误放行
        `SELECT id, code, status FROM modules
         WHERE code = ? AND region = ? AND deleted_at IS NULL`, // 条件：编码匹配、区域匹配、未被软删除
      ) // prepare 调用结束
      .get(moduleCode, user.region) as ModuleRow | undefined; // 绑定编码与用户区域
    if (!moduleRow || moduleRow.status !== 'active') { // 模块不存在或未上架
      throw new AppError('FEATURE_NOT_AVAILABLE', 'feature module is not available', { // 403 且不区分「不存在」与「未购买」
        module_code: moduleCode, // 回传模块编码，便于前端提示
        region: user.region, // 回传区域，便于排查是否跨区访问
      }); // 异常构造结束
    } // 模块可用性校验结束

    const entitlement = req.deps.db // 查询该用户对该模块的有效权益
      .prepare( // 准备查询语句
        // 说明：只取未过期的 active 权益，并取最新一条
        `SELECT id, status, expires_at FROM entitlements
         WHERE user_id = ? AND module_id = ? AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC
         LIMIT 1`, // 条件：本人 + 该模块 + 已生效未过期；按创建时间倒序取最近一条
      ) // prepare 调用结束
      .get(user.id, moduleRow.id, now) as EntitlementRow | undefined; // 绑定用户 ID、模块主键与当前时间
    if (!entitlement) { // 无有效权益即拒绝
      throw new AppError('FEATURE_NOT_AVAILABLE', 'feature module is not unlocked', { // 与模块缺失使用同一错误码，避免信息泄露
        module_code: moduleCode, // 回传模块编码
        region: user.region, // 回传区域
      }); // 异常构造结束
    } // 权益校验结束

    next(); // 校验通过，进入业务处理
  }; // 中间件函数结束
} // requireEntitlement 结束

/**
 * 超管引导令牌校验（`x-admin-token` vs `MIM_ADMIN_TOKEN`）。
 * 该通道存在的唯一目的是解决「第一个超管从哪来」的冷启动问题：
 * 库里还没有任何 user_roles 记录时，运营须先用环境变量令牌进入后台，
 * 再把 `rbac:write` 授予真实账号；之后日常操作一律走 JWT + requirePermission。
 *
 * 返回语义（刻意区分三种情形）：
 *   - 环境变量未配置 → false（引导通道关闭，但仍可凭 JWT 权限进入，不算失败）；
 *   - 请求未带该头   → false（走 JWT 分支）；
 *   - 带了但不匹配   → 抛 401，避免「带错令牌」被静默降级成「没带令牌」而难以排查。
 * 比较时先 sha256 归一长度再 timingSafeEqual，既避免长度差异导致的提前返回，也防计时侧信道。
 */
function adminTokenMatches(req: Request): boolean { // 内部辅助：判断请求是否命中超管引导通道
  const expected = (req.deps.env[ADMIN_TOKEN_ENV_KEY] ?? '').trim(); // 从注入的 env 读取期望令牌；测试可直传替身环境
  if (!expected) return false; // 未配置即引导通道关闭，交由 JWT 分支处理
  const provided = (req.header('x-admin-token') ?? '').trim(); // 取客户端管理令牌，缺失时为空串
  if (!provided) return false; // 未带该头，说明调用方走的是用户令牌路径
  const providedDigest = Buffer.from(sha256(provided), 'hex'); // 对实际令牌取定长摘要，消除长度差异
  const expectedDigest = Buffer.from(sha256(expected), 'hex'); // 对期望令牌取同样长度的摘要
  if (!timingSafeEqual(providedDigest, expectedDigest)) { // 常量时间比较，防止逐字节试探
    throw new AppError('AUTH_UNAUTHORIZED', 'invalid admin token'); // 401，与普通鉴权失败共用错误码
  } // 令牌比对结束
  return true; // 引导令牌有效
} // adminTokenMatches 结束

/**
 * 管理面鉴权（引导通道专用）。
 * 保留给 `MIM_ADMIN_TOKEN` 场景；业务路由主链路已改用 requirePermission，
 * 仅在「尚无任何 RBAC 授权」的冷启动场景下由后台登录接口调用。
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void { // 管理端点专用门禁
  const expected = (req.deps.env[ADMIN_TOKEN_ENV_KEY] ?? '').trim(); // 从注入的 env 读取期望令牌；测试可直传替身环境
  if (!expected) { // 未配置即视为管理面未启用
    throw new AppError('FEATURE_NOT_AVAILABLE', 'admin API is not enabled'); // 403，且不暴露「缺令牌」与「令牌错」的差别
  } // 配置缺失分支结束
  const provided = (req.header('x-admin-token') ?? '').trim(); // 取客户端管理令牌，缺失时为空串统一后续判断
  const providedDigest = Buffer.from(sha256(provided), 'hex'); // 对实际令牌取定长摘要，消除长度差异
  const expectedDigest = Buffer.from(sha256(expected), 'hex'); // 对期望令牌取同样长度的摘要
  if (!provided || !timingSafeEqual(providedDigest, expectedDigest)) { // 常量时间比较，防止逐字节试探
    throw new AppError('AUTH_UNAUTHORIZED', 'invalid admin token'); // 401，与普通鉴权失败共用错误码
  } // 令牌比对结束
  next(); // 通过管理鉴权，进入业务处理
} // requireAdmin 结束

/**
 * 读取某个用户经由角色继承到的全部权限码。
 * 权限刻意不写进 JWT：令牌一旦签发就难以撤销，而 RBAC 要求「收回角色即刻失效」，
 * 因此每次请求都实时 join 两张关系表（本地 SQLite + 主键索引，成本可忽略）。
 */
export function loadPermissions(db: Db, userId: string): Set<string> { // 导出便于测试与后台 /admin/me 复用
  const rows = db // 查询该用户全部权限码
    .prepare( // 预编译：用户角色 ⋈ 角色权限
      // 说明：DISTINCT 去重——多角色可能授予同一权限，调用方只关心「有没有」
      `SELECT DISTINCT rp.permission_code AS code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_code = ur.role_code
        WHERE ur.user_id = ?`, // 单一条件即可命中 user_roles 主键前缀
    ) // 结束预编译
    .all(userId) as Array<{ code: string }>; // 取回权限码列表
  return new Set(rows.map((r) => r.code)); // 转为 Set 便于 O(1) 判存在
} // loadPermissions 结束

/**
 * RBAC 权限门禁：请求方须拥有指定权限码。
 * 两条通道（满足其一即放行）：
 *   1. 超管引导通道 —— 携带正确的 `x-admin-token`，视同拥有全部权限，并打上 req.adminBootstrap 标记；
 *   2. 正常用户通道 —— Bearer JWT 有效且其角色集合覆盖该权限。
 * 失败语义：
 *   - 未登录 / 令牌无效 → 401（交给 resolveBearerUser 抛）；
 *   - 已登录但权限不足 → 403 FORBIDDEN，携带 permission 字段便于前端提示。
 */
export function requirePermission(permission: RbacPermissionCode | string) { // 高阶中间件工厂：按权限码生成门禁
  return (req: Request, _res: Response, next: NextFunction): void => { // 返回实际执行的中间件
    if (adminTokenMatches(req)) { // 先试引导通道：冷启动阶段库里还没有任何角色授权
      req.adminBootstrap = true; // 标记本次请求来自超管令牌，供审计或后续逻辑区分
      next(); // 引导令牌等同全权限，直接放行
      return; // 提前返回，不再查库
    } // 引导通道分支结束
    const user = resolveBearerUser(req); // 走正常用户通道：校验 JWT 与账号状态
    req.user = user; // 挂载用户，供下游路由读取 user.id / region
    const granted = loadPermissions(req.deps.db, user.id); // 实时查库取权限，保证角色回收即时生效
    if (!granted.has(permission)) { // 权限不覆盖即拒绝
      throw new AppError('FORBIDDEN', 'permission denied', { permission }); // 403 并回显缺失的权限码
    } // 权限判定结束
    next(); // 权限满足，进入业务处理
  }; // 中间件函数结束
} // requirePermission 结束

export function notFound(req: Request, res: Response): void { // 兜底 404：所有未匹配路由统一信封
  res.status(404).json({ // 直接以 JSON 返回，保持与业务错误一致的响应形态
    code: 'NOT_FOUND', // 机器可读错误码
    message: `route ${req.method} ${req.originalUrl} not found`, // 回显方法与方法路径，便于联调定位
    request_id: req.requestId, // 附带请求 ID，便于与日志串联
  }); // 响应体结束
} // notFound 结束

/** body-parser 对非法 JSON 抛 SyntaxError 并打上 type=entity.parse.failed / status=400 */
function isBodyParseError(err: unknown): boolean { // 类型守卫：判断是否为请求体解析错误
  if (!err || typeof err !== 'object') return false; // 非对象一律不是解析错误
  return (err as { type?: string }).type === 'entity.parse.failed'; // body-parser 用该 type 标记解析失败
} // isBodyParseError 结束

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void { // 全局错误处理：所有异常统一为错误信封
  if (res.headersSent) return; // 响应已开始发送时无法改写状态码，直接放弃避免二次写入报错
  const requestId = req.requestId ?? ''; // 取请求 ID，缺失时给空串保证信封字段存在
  if (isAppError(err)) { // 业务异常：状态码与错误码由异常自身携带
    res.status(err.status).json(err.toEnvelope(requestId)); // 直接输出标准信封
    return; // 处理完毕
  } // 业务异常分支结束
  // 请求体非法 JSON 属客户端错误，必须归一为 400，不得按未处理异常回 500
  if (isBodyParseError(err)) { // 解析错误分支
    res.status(400).json({ // 归一为 400，避免把客户端问题记成服务端故障
      code: 'VALIDATION_FAILED', // 与参数校验失败共用错误码
      message: 'request body is not valid JSON', // 明确提示请求体非法
      request_id: requestId, // 附带请求 ID
    }); // 响应体结束
    return; // 处理完毕
  } // 解析错误分支结束
  console.error(`[${requestId}] unhandled error`, err); // 未知异常必须留痕，便于定位真实故障
  res.status(500).json({ // 对外只暴露通用信息，不泄漏堆栈或内部实现
    code: 'INTERNAL_ERROR', // 机器可读错误码
    message: 'internal server error', // 通用提示
    request_id: requestId, // 附带请求 ID 供排查
  }); // 响应体结束
} // errorHandler 结束
