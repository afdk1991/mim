/** 请求 ID、鉴权、幂等回放与统一错误信封 */

import { randomUUID, timingSafeEqual, createHash } from 'node:crypto'; // 引入 UUID 生成器与常量时间比较，后者防止令牌比较被计时侧信道猜解；createHash 用于 ETag 摘要
import { verifyCaptcha, type CaptchaScene } from './security.js'; // 验证码统一校验适配器（按场景强制）
import type { NextFunction, Request, Response } from 'express'; // 仅引入 Express 中间件类型，编译期擦除
import { AppError, isAppError } from '@mim/core-domain'; // 引入统一业务异常与类型守卫，错误信封集中管理
import { ADMIN_TOKEN_ENV_KEY, REQUIRE_IDEMPOTENCY, isForceLoginEnabled, isRegistrationEnabled } from './config.js'; // 引入幂等强制开关、管理令牌键名、强制登录开关与注册开关
import { sha256, verifyAccessToken } from './auth.js'; // 引入请求指纹哈希与访问令牌校验
import type { RbacPermissionCode } from './db.js'; // 权限点联合类型，保证 requirePermission 调用处拼写错误在编译期暴露
import type { Db } from './types.js'; // 数据库句柄类型，供 loadPermissions 声明参数

interface AuthRow { // 鉴权从库中读出的用户行结构
  id: string; // 用户唯一 ID
  member_no: string | null; // 对外 Mim ID 号码；历史库补列前可能为 NULL
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

const DELETION_WHITELIST = new Set(['GET /api/v1/me', 'GET /api/v1/me/export', 'POST /api/v1/me/deletion', 'POST /api/v1/me/cancel-deletion']); // 待删除账号仍可访问的白名单：查资料、导出数据、重复申请回显与撤销注销

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
    throw new AppError('AUTH_UNAUTHORIZED', '缺少访问令牌'); // 统一 401，不区分「没带」与「格式错」以免暴露协议细节
  } // 头格式校验结束
  const payload = verifyAccessToken(match[1], req.deps.jwtSecret); // 校验签名与过期时间，失败抛 AUTH_UNAUTHORIZED
  const row = req.deps.db // 从库中加载最新用户行，使注销等状态变更即时生效（不信任令牌内快照）
    .prepare('SELECT id, member_no, region, status, display_name, locale, timezone, is_guest FROM users WHERE id = ?') // 只选鉴权与展示所需字段（is_guest 为历史兼容列）
    .get(payload.sub) as AuthRow | undefined; // 按令牌 sub 精确查询单行，查不到为 undefined
  if (!row || row.status === 'deleted') { // 用户不存在或已软删除时令牌即失效
    throw new AppError('AUTH_UNAUTHORIZED', '账号不可用'); // 统一 401，避免区分「不存在」与「已删除」
  } // 用户有效性校验结束
  const pathname = req.originalUrl.split('?')[0] ?? ''; // 去掉查询串，仅用路径参与白名单匹配
  if (row.status === 'pending_deletion' && !DELETION_WHITELIST.has(`${req.method} ${pathname}`)) { // 待删除账号除查资料与撤销外一律拒绝
    throw new AppError('ACCOUNT_DELETION_PENDING', '账号处于待注销状态'); // 专用错误码，前端据此引导撤销注销
  } // 待删除门禁结束
  return row; // 交出已校验用户行，由调用方决定是否写入 req.user
} // resolveBearerUser 结束

export function requireAuth(req: Request, _res: Response, next: NextFunction): void { // 中间件：解析 Bearer 令牌并加载当前用户
  req.user = resolveBearerUser(req); // 复用统一解析逻辑，保持与 requirePermission 同一安全水位
  next(); // 通过鉴权，进入业务处理
} // requireAuth 结束

/** 安全方法集合：读语义方法默认匿名放行，只对个人数据与资金路径例外拦截 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 可选鉴权：有有效 Bearer 令牌就解析出用户，无令牌 / 令牌失效一律按匿名继续。
 * 只挂载在「匿名可读」的公开接口上，让 `liked` / `favorited` / `joined` 等个人化字段
 * 在登录后仍然生效；公开读不能因为本地令牌过期就变成 401。
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void { // 中间件：身份可有可无
  const header = req.header('authorization') ?? ''; // 先看是否携带 Authorization，避免无谓解析
  if (!header) { next(); return; } // 匿名请求直接放行
  try { // 令牌无效不应打断公开读
    req.user = resolveBearerUser(req); // 复用统一校验：签名 / 过期 / 用户有效性 / 注销冷静期
  } catch { // 过期、伪造或用户已删除
    /* 公开接口按匿名处理，个人化字段回落为 false */
  } // try/catch 结束
  next(); // 继续业务处理
} // optionalAuth 结束

/**
 * 门禁口径（2026-11-16 调整）：匿名默认可读，只拦「个人数据」与「钱」。
 * 默认放行安全方法（GET / HEAD / OPTIONS），只对下方 AUTH_REQUIRED_READ_* 显式拦截；
 * 写方法默认拦截，只放行下方 ANONYMOUS_WRITE_EXCEPTIONS 的匿名例外。
 * 开关只有一个：MIM_FORCE_LOGIN（默认开启，显式 0/false/off 关闭）。
 */
const FORCE_LOGIN_PUBLIC_PATHS = new Set<string>([ // 精确匹配的公开路径
  '/api/v1/healthz', // 监控探活别名
  '/api/v1/site/config', // 登录页渲染所需的站点名称 / 主题等公开元数据
  '/api/v1/security/status', // 登录页据此决定是否渲染验证码
]); // 公开路径集合结束

const FORCE_LOGIN_PUBLIC_PREFIXES = [ // 前缀匹配：整条登录链路保持公开
  '/api/v1/auth/', // 登录 / 注册（开关见 MIM_REGISTRATION_ENABLED）/ 验证码 / OAuth 与 OIDC 回调 / SSO 兑换
  // 后台管理接口不走「全站强制登录」这道门，改由每个路由自己的 requirePermission 单独校验
  // （Bearer JWT + RBAC 权限点，或 x-admin-token 超管引导通道）。
  // 这样后台在冷启动、只有一个账号时仍可进入；未认证访问仍由 requirePermission 返回 401。
  '/api/v1/admin/',
]; // 公开前缀结束

/**
 * 写方法默认拦截，这里只登记确实无法要求登录的匿名例外：
 * 渠道回调靠签名验真，签名媒体靠预签名 URL 验真，二者都没有用户令牌可用；
 * 推广点击 / 转化是匿名访客的统计上报（访问者指纹 + 幂等键去重，不记佣金、不做资金结算），
 * 与 content-ops.ts 路由注释口径一致，故按精确后缀放行，其它 /promotions 写仍走登录与 RBAC。
 */
const ANONYMOUS_WRITE_EXCEPTIONS: Array<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/v1\/payments\/[a-z0-9_]+\/notify$/ }, // 微信 / 支付宝 / 沙箱 / 虎皮椒 / 讯虎等渠道异步通知
  { method: 'PUT', pattern: /^\/api\/v1\/media\/objects\/.+$/ }, // 签名媒体上传
  { method: 'DELETE', pattern: /^\/api\/v1\/media\/objects\/.+$/ }, // 签名媒体删除
  { method: 'POST', pattern: /^\/api\/v1\/promotions\/[a-z0-9_-]+\/click$/ }, // 推广点击计数：匿名访客上报，指纹频控 + 幂等键去重
  { method: 'POST', pattern: /^\/api\/v1\/promotions\/[a-z0-9_-]+\/conversion$/ }, // 推广转化回写：匿名访客上报，只累计 conversion_count
]; // 匿名写例外结束

/**
 * 需要登录的读路径（个人数据 + 资金 / 交易）。
 * 安全方法默认放行，只有命中这里的路径才要求有效凭证；新增个人中心 / 订单类接口时必须登记在此。
 */
const AUTH_REQUIRED_READ_PATHS = new Set<string>([ // 精确匹配
  '/api/v1/me', // 个人中心
  '/api/v1/me/oauth', // 第三方账号绑定列表
  '/api/v1/wallet', // 钱包余额
  '/api/v1/wallet/withdrawals', // 提现记录
  '/api/v1/shop/orders', // 商城订单
  '/api/v1/after-sales', // 售后单
  '/api/v1/referral', // 推广中心
  '/api/v1/reports/mine', // 我的举报
  '/api/v1/community/reports/mine', // 本人提交的社区举报单
  '/api/v1/assets/mine/list', // 我拥有的资产（列表与详情匿名可读，仅此项需登录）
  '/api/v1/community/favorites', // 我的收藏
  '/api/v1/community/notifications', // 通知
  '/api/v1/community/appeals/mine', // 我的申诉：本人申诉记录，匿名不可读
  '/api/v1/community/follows/boards', // 我关注的板块：关注关系私密，只有本人可见
  '/api/v1/commerce/orders', // 统一订单
  '/api/v1/commerce/orders/summary', // 订单角标
  '/api/v1/im/conversations', // 私信会话
  '/api/v1/im/users', // 可私信用户
]); // 需要登录的精确读路径结束

const AUTH_REQUIRED_READ_PREFIXES = [ // 带路径参数的需登录读接口
  /^\/api\/v1\/me\//, // 个人中心子资源（含 oauth 绑定）
  /^\/api\/v1\/wallet\//, // 钱包 / 提现子资源
  /^\/api\/v1\/shop\/orders\//, // 订单详情 / 售后
  /^\/api\/v1\/after-sales\//, // 售后详情
  /^\/api\/v1\/referral\//, // 推广佣金明细
  /^\/api\/v1\/reports\//, // 举报详情 / 运营列表
  // 付费资产列表 / 详情匿名可读（与社区付费帖、图库同一套付费墙，未解锁不下发正文与文件地址）；
  // 「我的资产」/assets/mine/list 由上方精确清单拦截，购买为写方法默认拦截。
  /^\/api\/v1\/community\/favorites/, // 收藏列表与取消收藏
  /^\/api\/v1\/community\/notifications/, // 通知列表与已读
  /^\/api\/v1\/community\/boards\/[^/]+\/reports$/, // 板块举报（运营审阅）
  /^\/api\/v1\/commerce\/orders\//, // 统一订单详情 / 支付 / 取消
  /^\/api\/v1\/payments\//, // 支付渠道、支付意图、对账（钱相关）
  /^\/api\/v1\/im\//, // 私信
  /^\/api\/v1\/messaging\//, // 统一消息
]; // 需要登录的读路径正则结束

/** 判定请求是否命中门禁公开清单（登录链路 / 后台 / 健康检查 / 匿名写例外） */
export function isPublicUnderForceLogin(method: string, pathname: string): boolean {
  if (FORCE_LOGIN_PUBLIC_PATHS.has(pathname)) return true; // 健康检查与必要公开元数据
  if (FORCE_LOGIN_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true; // 登录链路与后台
  const upper = method.toUpperCase(); // 例外按方法精确匹配，避免把写方法整体放开
  return ANONYMOUS_WRITE_EXCEPTIONS.some((item) => item.method === upper && item.pattern.test(pathname)); // 渠道回调 / 签名媒体
} // isPublicUnderForceLogin 结束

/** 判定读路径是否需要登录（个人数据 / 资金）；新增此类接口必须登记在唯一清单里 */
export function isAuthRequiredRead(pathname: string): boolean {
  if (AUTH_REQUIRED_READ_PATHS.has(pathname)) return true; // 精确路径
  return AUTH_REQUIRED_READ_PREFIXES.some((pattern) => pattern.test(pathname)); // 带参数路径
} // isAuthRequiredRead 结束

/** 判定是否为「匿名可读」：安全方法默认放行，只有个人 / 资金读路径例外 */
export function isAnonymousRead(method: string, pathname: string): boolean {
  if (!SAFE_METHODS.has(method.toUpperCase())) return false; // 写方法默认拦截，例外在上方的匿名写清单
  return !isAuthRequiredRead(pathname); // 默认允许读，只拦个人数据与钱
} // isAnonymousRead 结束

/** 门禁中间件：匿名可读放行，其余接口未认证一律 401，不签发任何临时身份 */
export function createForceLoginMiddleware() { // 工厂：便于测试挂载与替换
  return (req: Request, res: Response, next: NextFunction): void => { // 返回实际中间件
    if (!isForceLoginEnabled(req.deps.env)) { // 开关关闭时恢复旧的按路由鉴权模型
      next(); // 直接放行
      return; // 提前返回
    } // 开关判定结束
    const pathname = req.originalUrl.split('?')[0] ?? ''; // 去掉查询串，仅按路径匹配
    if (isPublicUnderForceLogin(req.method, pathname)) { // 登录链路 / 支付回调 / 健康检查 / 公开元数据
      next(); // 公开接口不要求凭证
      return; // 提前返回
    } // 公开白名单判定结束
    if (isAnonymousRead(req.method, pathname)) { // 匿名可读：GET 列表 / 详情放行，写方法在上一行已被排除
      optionalAuth(req, res, next); // 带令牌时解析身份，保持个人化字段可用
      return; // 提前返回
    } // 匿名可读判定结束
    if (adminTokenMatches(req)) { // 超管引导令牌等同有效认证，保住冷启动通道
      req.adminBootstrap = true; // 标记来源，下游审计可区分
      next(); // 放行
      return; // 提前返回
    } // 引导通道结束
    req.user = resolveBearerUser(req); // 无令牌 / 令牌无效 → AUTH_UNAUTHORIZED(401)
    next(); // 通过门禁
  }; // 中间件结束
} // createForceLoginMiddleware 结束

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
      throw new AppError('VALIDATION_FAILED', '写操作必须携带 Idempotency-Key 请求头', { // 400 并明确缺失的请求头
        field: 'Idempotency-Key', // 便于前端统一提示与自动补头
      }); // 异常构造结束
    } // 强制开关分支结束
    next(); // 非强制模式下降级为普通请求
    return; // 提前返回
  } // 缺失键分支结束
  const userId = req.user?.id ?? (req.adminBootstrap ? 'admin-bootstrap' : undefined); // 引导令牌无用户主体，用固定作用域承载运营幂等
  if (!userId) throw new AppError('AUTH_UNAUTHORIZED', '幂等操作需要登录态'); // 未鉴权无法确定作用域，直接 401

  const db = req.deps.db; // 复用请求上已注入的数据库连接
  const requestHash = sha256(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`); // 对方法+路径+请求体取指纹，用于判定「同键不同参」
  const existing = db // 查询该用户下是否已经存在同键记录
    .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND user_id = ?') // 键 + 用户双条件，保证作用域隔离
    .get(key, userId) as IdempotencyRow | undefined; // 取单行或 undefined

  if (existing) { // 已存在记录：进入回放或冲突判定
    if (existing.request_hash !== requestHash) { // 同键但请求体不同，属客户端误用
      throw new AppError('IDEMPOTENCY_CONFLICT', '同一 Idempotency-Key 被用于不同请求内容'); // 409 语义，提示换键重试
    } // 指纹比对结束
    if (existing.response_status === null || existing.response_body === null) { // 首次请求尚未完成（响应未落库）
      throw new AppError('CONFLICT', '相同请求仍在处理中'); // 并发重复提交，提示稍后重试
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
    throw new AppError('AUTH_UNAUTHORIZED', '管理员令牌无效'); // 401，与普通鉴权失败共用错误码
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
    throw new AppError('FEATURE_NOT_AVAILABLE', '管理接口未启用'); // 403，且不暴露「缺令牌」与「令牌错」的差别
  } // 配置缺失分支结束
  const provided = (req.header('x-admin-token') ?? '').trim(); // 取客户端管理令牌，缺失时为空串统一后续判断
  const providedDigest = Buffer.from(sha256(provided), 'hex'); // 对实际令牌取定长摘要，消除长度差异
  const expectedDigest = Buffer.from(sha256(expected), 'hex'); // 对期望令牌取同样长度的摘要
  if (!provided || !timingSafeEqual(providedDigest, expectedDigest)) { // 常量时间比较，防止逐字节试探
    throw new AppError('AUTH_UNAUTHORIZED', '管理员令牌无效'); // 401，与普通鉴权失败共用错误码
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
      throw new AppError('FORBIDDEN', '无操作权限', { permission }); // 403 并回显缺失的权限码
    } // 权限判定结束
    next(); // 权限满足，进入业务处理
  }; // 中间件函数结束
} // requirePermission 结束

export function notFound(req: Request, res: Response): void { // 兜底 404：所有未匹配路由统一信封
  res.status(404).json({ // 直接以 JSON 返回，保持与业务错误一致的响应形态
    code: 'NOT_FOUND', // 机器可读错误码
    message: `路由不存在：${req.method} ${req.originalUrl}`, // 回显方法与路径，便于联调定位
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
      message: '请求体不是合法 JSON', // 明确提示请求体非法
      request_id: requestId, // 附带请求 ID
    }); // 响应体结束
    return; // 处理完毕
  } // 解析错误分支结束
  console.error(`[${requestId}] unhandled error`, err); // 未知异常必须留痕，便于定位真实故障
  res.status(500).json({ // 对外只暴露通用信息，不泄漏堆栈或内部实现
    code: 'INTERNAL_ERROR', // 机器可读错误码
    message: '服务器内部错误', // 通用提示
    request_id: requestId, // 附带请求 ID 供排查
  }); // 响应体结束
} // errorHandler 结束

/**
 * 验证码场景门禁工厂（安全加固包）：
 *   - 按场景（register / login / report / post）读取配置，未强制或模式 off 时直接放行；
 *   - 强制场景下从请求体提取验证码字段，交 verifyCaptcha 统一校验；
 *   - 第三方模式缺凭证 / 上游不可用抛 503，答案错误 / 过期抛 400，由全局错误信封收口。
 *
 * 用法（由主控在对应路由前挂载，本包不改 app.ts）：
 *   router.post('/auth/register', createCaptchaMiddleware('register'), handler);
 *
 * 注册场景特例：注册开关关闭时直接放行本中间件，让注册路由稳定返回
 * 403 AUTH_REGISTER_DISABLED；否则会先被验证码拦成「图形验证码错误」，
 * 让用户与运维误判成验证码故障，也与「关闭态 403」契约不符。
 */
export function createCaptchaMiddleware(scene: CaptchaScene) { // 高阶工厂：按场景生成门禁
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => { // 返回当前函数的处理结果
    if (scene === 'register' && !isRegistrationEnabled(req.deps.env)) { next(); return; } // 注册已关闭：跳过验证码，交由注册路由给出 403 开关错误码
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await verifyCaptcha(req.deps.db, req.deps.env, scene, (req.body ?? {}) as Record<string, unknown>); // 异步等待：挂起至 Promise 落定后再继续
      next(); // 校验通过，进入业务处理
    } catch (err) { // 代码块结束
      next(err); // 交给全局错误处理器归一为标准信封
    } // 代码块结束
  }; // 代码块结束
} // createCaptchaMiddleware 结束

/** 公共 GET 缓存头选项：maxAge 控制 Cache-Control，scope 区分 public / private */
export interface CacheHeaderOptions {
  /** 浏览器 / CDN 缓存秒数，缺省 60s */
  maxAgeSeconds?: number;
  /** public 可被 CDN 缓存，private 仅浏览器缓存；缺省 public */
  scope?: 'public' | 'private';
  /** 生效方法集合，缺省 GET / HEAD */
  methods?: string[];
} // 代码块结束

/**
 * ETag / Cache-Control 中间件工厂（安全加固包，性能项）：
 *   - 只对只读方法生效；响应体序列化后取 sha256 前 32 位生成弱 ETag；
 *   - 命中 If-None-Match 时回 304（不发响应体）；
 *   - 工厂导出，不在 app.ts 内默认挂载；主控按公开只读路由选择性启用。
 *
 * 挂载顺序：必须挂在业务路由之前（与其他全局中间件同层，先于 router.use 业务路由）。
 */
export function createCacheHeaderMiddleware(options: CacheHeaderOptions = {}) {
  const maxAgeSeconds = options.maxAgeSeconds ?? 60; // 缺省缓存 60 秒
  const scope = options.scope ?? 'public'; // 缺省公开可缓存
  const methods = new Set(options.methods ?? ['GET', 'HEAD']); // 只处理只读方法
  return (req: Request, res: Response, next: NextFunction): void => { // 返回当前函数的处理结果
    if (!methods.has(req.method)) { // 写方法不打缓存头
      next(); // 调用 next 并处理其返回结果
      return; // 返回当前函数的处理结果
    } // 代码块结束
    // 携带 Authorization 的请求是「当前登录用户的私有数据」：既不进共享缓存，也不允许浏览器复用旧响应。
    // 否则 max-age=60 会让刚发出的消息在刷新后消失、未读角标不更新、断线重连补拉拿到旧列表。
    if (req.header('authorization')) { // 已认证请求一律不缓存
      res.setHeader('Cache-Control', 'private, no-store'); // 私有且禁止落盘缓存
      next(); // 跳过 ETag / 304 逻辑，直接进入业务路由
      return; // 返回当前函数的处理结果
    } // 代码块结束
    const originalJson = res.json.bind(res); // 保留原始 json 输出方法
    res.json = ((body: unknown) => { // 包装响应：算摘要 → 打 ETag / Cache-Control → 判 304
      const payload = JSON.stringify(body ?? null); // 响应体序列化（与实际下发内容一致）
      const etag = `W/"${createHash('sha256').update(payload).digest('hex').slice(0, 32)}"`; // 弱 ETag，取摘要前 32 位
      res.setHeader('ETag', etag); // 回写摘要，供下次请求做条件请求
      res.setHeader('Cache-Control', `${scope}, max-age=${maxAgeSeconds}`); // 缓存时效与可见性
      const incoming = req.header('if-none-match'); // 读取客户端条件请求头
      if (incoming && (incoming === etag || incoming === '*')) { // 摘要一致或客户端要求校验
        res.status(304); // 资源未变更
        res.removeHeader('Content-Type'); // 304 不携带响应体
        res.end(); // 执行当前业务步骤
        return body; // 保持 json 签名兼容，实际不再序列化下发
      } // 代码块结束
      return originalJson(body); // 正常下发响应体
    }) as Response['json']; // 代码块结束
    next(); // 进入业务路由
  }; // 代码块结束
} // createCacheHeaderMiddleware 结束
