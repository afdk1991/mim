/** FR-01 账号身份：验证码登录、密码登录、刷新令牌轮换、登出 */

import { Router } from 'express'; // 路由容器，按前缀挂载到 /api/v1
import { z } from 'zod'; // 请求体校验，统一挡掉非法输入
import { AppError, uuidv7 } from '@mim/core-domain'; // 业务错误码 + 时间有序主键
import {
  ACCESS_TTL_SECONDS, // 访问令牌有效期，用于返回 expires_in
  CODE_MAX_ATTEMPTS, // 单个验证码允许的错误尝试次数
  CODE_RATE_LIMIT, // 滑动窗口内允许的验证码申请次数
  CODE_RATE_WINDOW_MINUTES, // 限流窗口长度（分钟）
  CODE_TTL_SECONDS, // 验证码有效期
  LOGIN_LOCK_AFTER_FAILURES, // 连续失败多少次后锁定账号
  LOGIN_LOCK_MINUTES, // 锁定时长（分钟）
  REFRESH_TTL_SECONDS, // 刷新令牌有效期
} from '../config.js'; // 集中式认证参数，避免散落魔法数字
import {
  generateCode, // 生成数字验证码
  hashCode, // 验证码摘要，库内不存明文
  hashPassword, // 账号密码哈希，自建账号注册时写入
  issueAccessToken, // 签发 JWT 访问令牌
  newOpaqueToken, // 生成不可预测的刷新令牌
  normalizeIdentity, // 手机号/邮箱归一化
  secureEqual, // 定长时间比较，抵御计时攻击
  sha256, // 刷新令牌摘要
  verifyCode, // 校验验证码摘要
  verifyPassword, // 账号密码校验，自建账号登录时使用
} from '../auth.js'; // 认证基础能力集中在此模块
import { clockOf } from '../domain.js'; // 可注入时钟，测试时可冻结时间
import { requireAuth } from '../middleware.js'; // 登出接口需要已登录身份
import { parse } from '../validate.js'; // zod 校验失败时统一转换为 AppError
import { addSeconds } from '../utils.js'; // ISO 时间字符串加减秒
import type { ApiDeps, Region } from '../types.js'; // 路由依赖与地区枚举类型

export interface UserRow { // users 表在鉴权流程中使用的字段子集
  id: string; // 用户主键
  region: Region; // 所属地区（cn/global），影响默认语言与时区
  status: string; // active/deleted 等，决定能否登录
  display_name: string; // 展示名
  locale: string; // 语言偏好
  timezone: string; // 时区偏好
  deletion_scheduled_at: string | null; // 注销预约时间，供前端提示
  created_at: string; // 注册时间
} // 结束 UserRow，覆盖登录响应所需字段

interface CodeRow { // verification_codes 表在校验时用到的字段
  id: string; // 验证码记录主键
  code_hash: string; // 摘要值，用于常数时间比对
  attempts: number; // 已失败次数，超过上限即失效
  expires_at: string; // 过期时间
} // 结束 CodeRow

interface SessionRow { // sessions 表在刷新/登出时用到的字段
  id: string; // 会话主键
  user_id: string; // 归属用户
  device_id: string | null; // 绑定设备，刷新时沿用
  expires_at: string; // 会话过期时间
  revoked_at: string | null; // 吊销时间，非空即已失效
} // 结束 SessionRow

const codeBody = z.object({ // 申请验证码的请求体
  region: z.enum(['cn', 'global']), // 地区决定短信/邮件通道与默认语言
  provider: z.enum(['phone', 'email']), // 通道类型
  identifier: z.string().min(1), // 手机号或邮箱，后续会归一化
}); // 结束 codeBody schema

const loginBody = codeBody.extend({ // 验证码登录在申请体基础上追加字段
  code: z.string().regex(/^\d{6}$/), // 固定 6 位数字，避免把其他格式写进库
  device: z // 设备信息（可选）
    .object({ // 设备对象结构
      platform: z.string().min(1).max(32), // 设备平台（ios/android/web），长度限幅防滥用
      name: z.string().max(64).optional(), // 设备名可选，仅用于用户识别
    }) // 结束设备对象
    .optional(), // 设备信息整体可选，旧客户端不传也能登录
}); // 结束 loginBody schema

/** 密码登录：短信/邮件通道未接入时的可用入口，口令来自 MIM_AUTH_ADMIN_PASSWORD */
const passwordBody = z.object({ // 密码登录请求体
  region: z.enum(['cn', 'global']), // 地区
  provider: z.enum(['phone', 'email']).optional(), // 通道可选，缺省按地区推断
  identifier: z.string().min(1), // 账号标识
  password: z.string().min(1).max(200), // 口令长度限幅，避免超长输入拖慢比较
  device: z // 设备信息（可选）
    .object({ // 设备对象结构
      platform: z.string().min(1).max(32), // 平台标识
      name: z.string().max(64).optional(), // 设备名
    }) // 结束设备对象
    .optional(), // 同样允许不传
}); // 结束 passwordBody schema

/** 自助注册：短信/邮件通道不可用时的可用入口，账号 + 口令即注册并直接拿到会话 */
const registerBody = z.object({ // 注册请求体
  region: z.enum(['cn', 'global']), // 地区决定默认语言与身份通道
  provider: z.enum(['phone', 'email']).optional(), // 通道可选，缺省按地区推断
  identifier: z.string().min(1), // 手机号或邮箱，注册前统一归一化
  password: z.string().min(8).max(200), // 口令至少 8 位，长度上限避免超长输入拖慢哈希
  display_name: z.string().max(64).optional(), // 展示名可选，缺省沿用空串由用户后续完善
  device: z // 设备信息（可选），与登录一致的契约
    .object({ // 设备对象结构
      platform: z.string().min(1).max(32), // 平台标识
      name: z.string().max(64).optional(), // 设备名
    }) // 结束设备对象
    .optional(), // 允许不传
}); // 结束 registerBody schema

function userPayload(row: UserRow) { // 对外输出的用户视图，剔除内部字段
  return { // 用户视图对象
    id: row.id, // 用户 ID
    region: row.region, // 地区
    status: row.status, // 账号状态
    display_name: row.display_name, // 展示名
    locale: row.locale, // 语言偏好
    timezone: row.timezone, // 时区偏好
    deletion_scheduled_at: row.deletion_scheduled_at, // 注销预约时间
  }; // 结束用户视图
} // 结束 userPayload

function createSession(deps: ApiDeps, user: UserRow, deviceId: string | null) { // 创建会话并签发双令牌
  const now = clockOf(deps); // 统一取时，保证落库与返回一致
  const refreshToken = newOpaqueToken(); // 刷新令牌只在响应中出现一次，库内仅存摘要
  deps.db // 会话写入起点
    .prepare( // 预编译插入语句
      `INSERT INTO sessions (id, user_id, refresh_token_hash, device_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ) // 结束预编译
    .run( // 绑定参数并执行
      uuidv7(), // 会话主键
      user.id, // 归属用户
      sha256(refreshToken), // 存摘要而非明文，降低库泄露风险
      deviceId, // 绑定设备（可空）
      addSeconds(now, REFRESH_TTL_SECONDS), // 计算会话过期时间
      now, // 创建时间
    ); // 结束执行
  return { // 令牌响应体
    token_type: 'Bearer', // 固定 Bearer 方案，前端直接拼 Authorization
    access_token: issueAccessToken(user.id, user.region, deps.jwtSecret), // 访问令牌携带用户与地区声明
    refresh_token: refreshToken, // 明文仅此一次返回
    expires_in: ACCESS_TTL_SECONDS, // 访问令牌剩余秒数，供前端定时刷新
  }; // 结束令牌响应
} // 结束 createSession

function failureKey(region: string, identifier: string): string { // 失败计数的主键：地区 + 标识
  return `${region}:${identifier}`; // 用冒号拼接，避免不同地区同号相互影响
} // 结束 failureKey

function assertNotLocked(deps: ApiDeps, key: string, now: string): void { // 登录前检查是否处于锁定期
  const row = deps.db // 锁定状态查询起点
    .prepare('SELECT locked_until FROM login_failures WHERE identifier = ?') // 按失败键读取锁定截止时间
    .get(key) as { locked_until: string | null } | undefined; // 无记录即未锁定
  if (row?.locked_until && Date.parse(row.locked_until) > Date.parse(now)) { // 截止时间晚于当前即仍锁定
    throw new AppError('AUTH_ACCOUNT_LOCKED', 'too many failed attempts, try again later', { // 返回锁定错误
      locked_until: row.locked_until, // 回传解锁时间，前端可展示倒计时
    }); // 结束错误构造
  } // 结束锁定判断
} // 结束 assertNotLocked

function recordFailure(deps: ApiDeps, key: string, region: string, now: string): void { // 记录一次登录失败并判断是否触发锁定
  const row = deps.db // 历史失败次数查询起点
    .prepare('SELECT failures FROM login_failures WHERE identifier = ?') // 按失败键读取计数
    .get(key) as { failures: number } | undefined; // 无记录即首次失败
  const failures = (row?.failures ?? 0) + 1; // 累加本次失败
  const lockedUntil = // 锁定截止时间
    failures >= LOGIN_LOCK_AFTER_FAILURES ? addSeconds(now, LOGIN_LOCK_MINUTES * 60) : null; // 达到阈值则写入锁定截止时间
  deps.db // 失败记录写入起点
    .prepare( // 预编译 upsert 语句
      `INSERT INTO login_failures (identifier, region, failures, locked_until, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET
         failures = excluded.failures,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`,
    ) // 结束预编译
    .run(key, region, failures, lockedUntil, now); // upsert：首次插入，后续只更新计数与锁定状态
} // 结束 recordFailure

function findOrCreateUser(deps: ApiDeps, region: Region, provider: string, identifier: string): UserRow { // 按身份查找用户，不存在则注册
  const identity = deps.db // 身份查询起点
    .prepare('SELECT user_id FROM identities WHERE region = ? AND provider = ? AND identifier = ?') // 三元组唯一确定一个身份
    .get(region, provider, identifier) as { user_id: string } | undefined; // 未命中即需要注册

  if (identity) { // 身份已存在分支
    const row = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(identity.user_id) as // 读取用户详情
      | UserRow // 命中用户
      | undefined; // 用户缺失
    if (!row) throw new AppError('ACCOUNT_NOT_FOUND', 'account not found'); // 身份存在但用户缺失，属数据不一致
    if (row.status === 'deleted') throw new AppError('AUTH_UNAUTHORIZED', 'account has been deleted'); // 已注销账号禁止登录
    return row; // 返回现有用户
  } // 结束身份已存在分支

  const now = clockOf(deps); // 新用户创建时间
  const userId = uuidv7(); // 预生成用户主键供两表共用
  const insertUser = deps.db.prepare( // 预编译用户插入
    `INSERT INTO users (id, region, status, display_name, locale, timezone, created_at, updated_at)
     VALUES (?, ?, 'active', '', ?, ?, ?, ?)`,
  ); // 状态固定 active，展示名留空待用户完善
  const insertIdentity = deps.db.prepare( // 预编译身份插入
    `INSERT INTO identities (id, user_id, region, provider, identifier, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ); // 写入登录身份
  deps.db.transaction(() => { // 用户与身份必须同时创建，避免产生孤立身份
    insertUser.run( // 写入用户
      userId, // 用户主键
      region, // 地区
      region === 'cn' ? 'zh-CN' : 'en-US', // 按地区给默认语言
      region === 'cn' ? 'Asia/Shanghai' : 'UTC', // 按地区给默认时区
      now, // 创建时间
      now, // 更新时间
    ); // 结束用户写入
    insertIdentity.run(uuidv7(), userId, region, provider, identifier, now); // 绑定身份到新用户
  })(); // 执行事务

  const row = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow; // 回读落库结果，确保返回真实数据
  return row; // 返回新用户
} // 结束 findOrCreateUser

function finishLogin( // 登录收尾：记录设备并签发双令牌，供各登录分支复用
  deps: ApiDeps, // 依赖容器
  user: UserRow, // 已确认可用的用户
  device: { platform: string; name?: string } | undefined, // 客户端上报的设备信息（可空）
) { // 返回与各登录端点一致的响应体
  const now = clockOf(deps); // 统一取时，保证设备与令牌时间一致
  let deviceId: string | null = null; // 未传设备信息时保持为空
  if (device) { // 客户端上报了设备信息
    deviceId = uuidv7(); // 预生成设备主键
    deps.db // 设备写入起点
      .prepare( // 预编译插入语句
        `INSERT INTO devices (id, user_id, platform, name, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ) // 结束预编译
      .run(deviceId, user.id, device.platform, device.name ?? '', now, now); // 记录设备，便于多端会话管理
  } // 结束设备记录
  const tokens = createSession(deps, user, deviceId); // 创建会话
  return { ...tokens, user: userPayload(user) }; // 令牌 + 用户视图
} // 结束 finishLogin

export function createAuthRouter(deps: ApiDeps): Router { // 组装认证路由
  const router = Router(); // 独立的 express 路由实例

  router.post('/auth/code', async (req, res) => { // 申请验证码
    const body = parse(codeBody, req.body); // 校验请求体形状
    const identity = normalizeIdentity(body.region, body.provider, body.identifier); // 归一化号码/邮箱，避免同号多形态
    const now = clockOf(deps); // 当前时间
    const windowStart = addSeconds(now, -CODE_RATE_WINDOW_MINUTES * 60); // 滑动窗口起点
    const recent = deps.db // 限流统计查询起点
      .prepare( // 预编译计数语句
        `SELECT COUNT(*) AS n FROM verification_codes
         WHERE region = ? AND provider = ? AND identifier = ? AND created_at >= ?`,
      ) // 结束预编译
      .get(body.region, identity.provider, identity.identifier, windowStart) as { n: number }; // 统计窗口内申请次数
    if (recent.n >= CODE_RATE_LIMIT) { // 超过窗口配额时拒绝
      throw new AppError('AUTH_CODE_RATE_LIMITED', 'too many code requests, try again later', { // 返回限流错误
        retry_after_seconds: CODE_RATE_WINDOW_MINUTES * 60, // 告知多久后可重试
      }); // 结束错误构造
    } // 结束限流判断

    // 通道选择：phone → 短信（阿里云 SMS），email → 邮件（AWS SES）。
    // 生产环境通道未配置时直接拒绝，避免 dev_code 明文出现在生产响应中（安全审计项）；
    // 开发/测试环境未配置通道时保持 dev_code 直发，便于本地联调。
    const channel = identity.provider === 'phone' ? deps.notify?.sms : deps.notify?.email; // 按通道类型取已装配的通知器
    if (!channel && deps.env.NODE_ENV === 'production') { // 生产环境缺通道必须失败
      throw new AppError( // 抛出配置错误
        'AUTH_CHANNEL_NOT_CONFIGURED', // 生产缺通道属配置错误，而非业务失败
        'verification channel is not configured in production', // 明确提示原因
        { identifier: identity.identifier, provider: identity.provider }, // 回传上下文便于排查
      ); // 结束错误构造
    } // 结束通道检查

    const code = generateCode(); // 生成一次性数字验证码
    // 先落库后发送：若供应商已实际送达但响应超时/异常，用户仍可用该码登录
    deps.db // 验证码写入起点
      .prepare( // 预编译插入语句
        `INSERT INTO verification_codes
         (id, region, provider, identifier, code_hash, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      ) // 结束预编译
      .run( // 绑定参数
        uuidv7(), // 记录主键
        body.region, // 地区
        identity.provider, // 通道类型
        identity.identifier, // 归一化后的标识
        hashCode(code), // 只存摘要
        addSeconds(now, CODE_TTL_SECONDS), // 过期时间
        now, // 创建时间
      ); // 结束执行

    if (!channel) { // 非生产且无通道：开发模式直发
      res.status(201).json({ // 201 表示已创建验证码记录
        delivery: 'dev', // 标识为开发模式直发
        dev_code: code, // 仅在非生产环境返回明文，便于本地联调
        identifier: identity.identifier, // 回显归一化标识
        provider: identity.provider, // 回显通道
        expires_in: CODE_TTL_SECONDS, // 有效期
        note: '开发模式：真实短信/邮件通道未配置，验证码直接下发；生产须配置第三方通道', // 显式提示降级行为
      }); // 结束响应
      return; // 开发分支到此结束
    } // 结束开发模式分支

    try { // 真实通道可能抛错，需转换为业务错误
      await channel.send(identity.identifier, code); // 调用第三方通道真实下发
    } catch { // 供应商失败分支
      throw new AppError('AUTH_CODE_DELIVERY_FAILED', 'failed to deliver verification code', { // 返回投递失败
        provider: identity.provider, // 回传通道便于定位供应商问题
      }); // 结束错误构造
    } // 结束下发

    res.status(201).json({ // 投递成功响应
      delivery: identity.provider, // 生产环境回显真实通道
      identifier: identity.identifier, // 归一化标识
      provider: identity.provider, // 通道类型
      expires_in: CODE_TTL_SECONDS, // 有效期
    }); // 结束响应
  }); // 结束 POST /auth/code 处理

  router.post('/auth/login', (req, res) => { // 验证码登录
    const body = parse(loginBody, req.body); // 校验请求体
    const identity = normalizeIdentity(body.region, body.provider, body.identifier); // 归一化标识
    const now = clockOf(deps); // 当前时间
    const key = failureKey(body.region, identity.identifier); // 失败计数键
    assertNotLocked(deps, key, now); // 锁定期内直接拒绝

    const codeRow = deps.db // 验证码查询起点
      .prepare( // 预编译：取最新一条未消费验证码
        `SELECT id, code_hash, attempts, expires_at FROM verification_codes
         WHERE region = ? AND provider = ? AND identifier = ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      ) // 结束预编译
      .get(body.region, identity.provider, identity.identifier) as CodeRow | undefined; // 无记录即无可用验证码

    if (!codeRow) throw new AppError('AUTH_CODE_INVALID', 'verification code is invalid'); // 无可用验证码
    if (Date.parse(codeRow.expires_at) <= Date.parse(now)) { // 过期判定
      throw new AppError('AUTH_CODE_EXPIRED', 'verification code has expired'); // 过期与无效分开报，便于前端引导重发
    } // 结束过期判断
    if (codeRow.attempts >= CODE_MAX_ATTEMPTS) { // 尝试次数耗尽
      throw new AppError('AUTH_CODE_RATE_LIMITED', 'verification code attempts exhausted'); // 需重新申请验证码
    } // 结束尝试次数判断
    if (!verifyCode(body.code, codeRow.code_hash)) { // 摘要比对失败
      deps.db // 失败计数更新起点
        .prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?') // 原子自增，避免并发覆盖
        .run(codeRow.id); // 绑定记录主键
      recordFailure(deps, key, body.region, now); // 同时计入登录失败，触达阈值则锁定
      throw new AppError('AUTH_CODE_INVALID', 'verification code is invalid'); // 统一返回无效，避免泄露细节
    } // 结束码校验

    deps.db // 消费验证码
      .prepare('UPDATE verification_codes SET consumed_at = ? WHERE id = ?') // 标记消费时间
      .run(now, codeRow.id); // 保证一次性使用
    deps.db.prepare('DELETE FROM login_failures WHERE identifier = ?').run(key); // 成功后清零失败计数

    const user = findOrCreateUser(deps, body.region, identity.provider, identity.identifier); // 首次登录自动注册

    let deviceId: string | null = null; // 未传设备信息时保持为空
    if (body.device) { // 客户端上报了设备信息
      deviceId = uuidv7(); // 预生成设备主键
      deps.db // 设备写入起点
        .prepare( // 预编译插入语句
          `INSERT INTO devices (id, user_id, platform, name, last_seen_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ) // 结束预编译
        .run(deviceId, user.id, body.device.platform, body.device.name ?? '', now, now); // 记录设备，便于多端会话管理
    } // 结束设备记录

    const tokens = createSession(deps, user, deviceId); // 创建会话
    res.json({ ...tokens, user: userPayload(user) }); // 返回令牌与用户视图
  }); // 结束 POST /auth/login 处理

  router.get('/auth/channels', (_req, res) => { // 公开能力查询：前端据此隐藏不可用的登录方式
    res.json({ // 只暴露「是否可用」布尔值，不泄露任何凭证内容
      sms: Boolean(deps.notify?.sms), // 国内短信通道是否已装配凭证
      email: Boolean(deps.notify?.email), // 海外邮件通道是否已装配凭证
      password: Boolean((deps.env.MIM_AUTH_ADMIN_PASSWORD ?? '').trim()), // 管理员口令入口是否可用
      register: true, // 自助账号注册恒可用：不依赖任何外部通道
    }); // 响应结束
  }); // 结束 GET /auth/channels 处理

  router.post('/auth/register', (req, res) => { // 自助注册：账号 + 口令一次完成注册与登录
    const body = parse(registerBody, req.body); // 校验请求体
    const provider = body.provider ?? (body.region === 'cn' ? 'phone' : 'email'); // 未指定通道时按地区推断
    const identity = normalizeIdentity(body.region, provider, body.identifier); // 归一化标识，非法格式直接 400
    if (!/[A-Za-z]/.test(body.password) || !/\d/.test(body.password)) { // 基本强度：至少含一个字母与一个数字
      throw new AppError('VALIDATION_FAILED', 'password must contain both letters and digits', { field: 'password' }); // 提示具体字段
    } // 强度校验结束

    const exists = deps.db // 身份占用检查起点
      .prepare('SELECT user_id FROM identities WHERE region = ? AND provider = ? AND identifier = ?') // 唯一三元组
      .get(body.region, identity.provider, identity.identifier) as { user_id: string } | undefined; // 已存在则返回归属
    if (exists) { // 账号已被注册分支
      throw new AppError('AUTH_IDENTITY_EXISTS', 'account already registered', { field: 'identifier' }); // 409 让前端提示改用登录
    } // 结束占用检查

    const now = clockOf(deps); // 注册时间
    const userId = uuidv7(); // 预生成用户主键供两表共用
    const displayName = (body.display_name ?? '').trim().slice(0, 64); // 展示名可选，限幅避免超长
    deps.db.transaction(() => { // 用户 / 身份 / 口令三表必须同时写入
      deps.db // 用户写入起点
        .prepare( // 预编译用户插入
          `INSERT INTO users (id, region, status, display_name, locale, timezone, created_at, updated_at)
           VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`,
        ) // 结束预编译
        .run( // 绑定参数
          userId, // 用户主键
          body.region, // 地区
          displayName, // 展示名
          body.region === 'cn' ? 'zh-CN' : 'en-US', // 默认语言随地区
          body.region === 'cn' ? 'Asia/Shanghai' : 'UTC', // 默认时区随地区
          now, // 创建时间
          now, // 更新时间
        ); // 结束用户写入
      deps.db // 身份写入起点
        .prepare( // 预编译身份插入
          `INSERT INTO identities (id, user_id, region, provider, identifier, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ) // 结束预编译
        .run(uuidv7(), userId, body.region, identity.provider, identity.identifier, now); // 绑定唯一身份
      deps.db // 口令写入起点：credentials 表已存在，kind=password 区分于其他凭据
        .prepare('INSERT INTO credentials (id, user_id, kind, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)') // 预编译凭据插入
        .run(uuidv7(), userId, 'password', hashPassword(body.password), now); // 只存 bcrypt 摘要，绝不留明文
    })(); // 执行事务，任一失败即整体回滚

    const user = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow; // 回读落库结果
    res.status(201).json(finishLogin(deps, user, body.device)); // 注册即登录：直接下发令牌，省一次往返
  }); // 结束 POST /auth/register 处理

  router.post('/auth/password', (req, res) => { // 密码登录：先比管理员口令，再比账号自身口令
    const body = parse(passwordBody, req.body); // 校验请求体
    const provider = body.provider ?? (body.region === 'cn' ? 'phone' : 'email'); // 未指定通道时按地区推断
    const identity = normalizeIdentity(body.region, provider, body.identifier); // 归一化标识
    const now = clockOf(deps); // 当前时间
    const key = failureKey(body.region, identity.identifier); // 失败计数键
    assertNotLocked(deps, key, now); // 先检查锁定状态

    // 生产环境短信/邮件通道未接入时，管理员口令与自建账号口令共同构成最小可行登录入口（见 05-runbook §7.1）。
    const expected = (deps.env.MIM_AUTH_ADMIN_PASSWORD ?? '').trim(); // 读取并裁剪配置口令
    const adminOk = expected.length > 0 && secureEqual(body.password, expected); // 管理员口令命中

    const account = deps.db // 自建账号查询起点
      .prepare('SELECT user_id FROM identities WHERE region = ? AND provider = ? AND identifier = ?') // 唯一三元组
      .get(body.region, identity.provider, identity.identifier) as { user_id: string } | undefined; // 命中即已有身份
    const credential = account // 口令凭据查询起点：只取 kind=password 的记录
      ? (deps.db.prepare("SELECT secret_hash FROM credentials WHERE user_id = ? AND kind = 'password'").get(account.user_id) as { secret_hash: string } | undefined) // 命中即有自建口令
      : undefined; // 无身份则无凭据
    const accountOk = Boolean(credential) && verifyPassword(body.password, credential!.secret_hash); // 账号口令命中

    if (!adminOk && !accountOk) { // 两种口令都未命中
      if (!expected && !credential) { // 完全没有可用口令入口
        throw new AppError( // 抛出配置错误
          'AUTH_PASSWORD_NOT_CONFIGURED', // 未配置即功能不可用
          'password sign-in is not configured', // 明确提示
          { env: 'MIM_AUTH_ADMIN_PASSWORD' }, // 指出缺失的环境变量
        ); // 结束错误构造
      } // 结束配置检查
      recordFailure(deps, key, body.region, now); // 口令错误同样计入锁定策略
      throw new AppError('AUTH_PASSWORD_INVALID', 'password is incorrect'); // 不回显正确口令线索
    } // 结束口令校验

    deps.db.prepare('DELETE FROM login_failures WHERE identifier = ?').run(key); // 成功后清零失败计数

    const user = findOrCreateUser(deps, body.region, identity.provider, identity.identifier); // 按身份查找或创建用户（自建账号已存在）
    res.json(finishLogin(deps, user, body.device)); // 统一收尾：设备 + 双令牌 + 用户视图
  }); // 结束 POST /auth/password 处理

  router.post('/auth/refresh', (req, res) => { // 刷新令牌轮换
    const body = parse(z.object({ refresh_token: z.string().min(1) }), req.body); // 只接受刷新令牌字段
    const now = clockOf(deps); // 当前时间
    const session = deps.db // 会话查询起点
      .prepare('SELECT * FROM sessions WHERE refresh_token_hash = ?') // 用摘要查找会话，库内不存明文
      .get(sha256(body.refresh_token)) as SessionRow | undefined; // 无记录即令牌无效
    if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.parse(now)) { // 三重失效判定
      throw new AppError('AUTH_REFRESH_INVALID', 'refresh token is invalid or expired'); // 已吊销/过期/不存在统一拒绝
    } // 结束有效性判断
    const user = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as // 读取会话归属用户
      | UserRow // 命中用户
      | undefined; // 用户缺失
    if (!user || user.status === 'deleted') { // 用户不可用分支
      throw new AppError('AUTH_REFRESH_INVALID', 'account is not available'); // 用户缺失或已注销不允许续期
    } // 结束用户可用性判断

    deps.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now, session.id); // 轮换：旧会话立即吊销，防重放
    const tokens = createSession(deps, user, session.device_id); // 用同一设备信息签发新会话
    res.json({ ...tokens, user: userPayload(user) }); // 返回新令牌
  }); // 结束 POST /auth/refresh 处理

  router.post('/auth/logout', requireAuth, (req, res) => { // 登出：仅需登录态即可吊销指定刷新令牌
    const body = parse(z.object({ refresh_token: z.string().min(1) }), req.body); // 要求明确指定要吊销的令牌
    deps.db // 会话吊销起点
      .prepare('UPDATE sessions SET revoked_at = ? WHERE refresh_token_hash = ? AND user_id = ?') // 同时校验归属，避免越权
      .run(clockOf(deps), sha256(body.refresh_token), req.user!.id); // 绑定当前时间、令牌摘要与用户
    res.json({ ok: true }); // 幂等返回成功，不泄露令牌是否存在
  }); // 结束 POST /auth/logout 处理

  return router; // 交出可挂载的路由实例
} // 结束 createAuthRouter
