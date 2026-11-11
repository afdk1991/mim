/**
 * 第三方登录路由。
 *
 * 端点一览：
 *   GET    /api/v1/auth/oauth/providers            可用提供方与配置状态（公开）
 *   POST   /api/v1/auth/oauth/:provider/authorize  生成授权跳转地址（登录可匿名 / 绑定需登录）
 *   GET    /api/v1/auth/oauth/:provider/callback   提供方回调，302 回前端（登录带票据 / 绑定带标记）
 *   POST   /api/v1/auth/oauth/:provider/callback   Apple form_post 回调
 *   POST   /api/v1/auth/oauth/exchange             一次性票据换正式会话
 *   GET    /api/v1/me/oauth                        已绑定的第三方身份
 *   DELETE /api/v1/me/oauth/:provider              解绑（保留至少一种登录方式）
 *
 * 安全约定：
 *   - state 只存摘要、10 分钟过期、回调即删，回调必须与发起记录逐字段匹配；
 *   - 正式令牌从不出现在浏览器地址栏：回调只带一次性票据，前端再 POST 兑换；
 *   - 回跳路径只接受同源相对路径，杜绝开放重定向。
 */

import { Router, urlencoded } from 'express'; // 路由容器 + Apple form_post 需要的表单解析
import type { NextFunction, Request, Response } from 'express'; // 回调处理函数需要显式类型
import { z } from 'zod'; // 请求体校验
import * as oauth from 'oauth4webapi'; // 仅用其高熵 state 生成函数
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { OAUTH_STATE_TTL_SECONDS } from '../config.js'; // 授权状态有效期
import { clockOf } from '../domain.js'; // 可注入时钟
import { sha256 } from '../auth.js'; // state 只存摘要
import { parse } from '../validate.js'; // zod 校验包装
import { requireAuth } from '../middleware.js'; // 绑定/解绑需要登录态
import { finishLogin } from './auth.js'; // 复用统一会话签发
import { buildAuthorizeUrl, exchangeOAuthCode } from '../oauth/client.js'; // 授权链接与令牌交换
import { findProvider, publicProviders, resolveCredentials } from '../oauth/providers.js'; // provider 注册表
import {
  consumeLoginTicket, // 票据兑换
  createUserFromOAuth, // 首次第三方登录建号
  findOAuthAccount, // 按提供方身份查绑定
  findOAuthAccountByUnion, // 按 unionid 查绑定
  issueLoginTicket, // 签发一次性票据
  listOAuthAccounts, // 已绑定列表
  unlinkOAuthAccount, // 解绑
  upsertOAuthAccount, // 绑定 / 刷新资料
} from '../oauth/accounts.js'; // 绑定与票据数据层
import { readUser } from '../identity.js'; // 读用户行（含 Mim ID）
import type { ApiDeps, Region, UserRow } from '../types.js'; // 依赖与用户类型

/** 发起授权请求体：区域与模式都可省略，默认沿用登录用户 / cn */
const authorizeBody = z.object({ // 只声明真正需要的字段
  region: z.enum(['cn', 'global']).optional(), // 新账号归属区域
  mode: z.enum(['login', 'bind']).optional(), // 登录（可建号）或绑定（须已登录）
  return_to: z.string().max(200).optional(), // 完成后回跳路径（同源相对路径）
}); // authorizeBody 结束

/** 票据兑换请求体 */
const exchangeBody = z.object({ // 只接受票据与可选设备信息
  ticket: z.string().min(10).max(200), // 一次性登录票据
  device: z // 设备信息，与账号口令登录保持同一契约
    .object({ platform: z.string().min(1).max(32), name: z.string().max(64).optional() }) // 平台与设备名
    .optional(), // 允许不传
}); // exchangeBody 结束

/** 由请求推断后端对外基址：优先反向代理头，兼容 nginx 与本地直连 */
function backendBaseOf(req: { header: (name: string) => string | undefined; protocol: string }): string { // 只依赖两个成员，便于复用
  const proto = (req.header('x-forwarded-proto') ?? req.protocol ?? 'http').split(',')[0]?.trim() || 'http'; // 只取第一个代理值
  const host = (req.header('x-forwarded-host') ?? req.header('host') ?? 'localhost').split(',')[0]?.trim() || 'localhost'; // 同理
  return `${proto}://${host}`; // 拼成绝对基址
} // backendBaseOf 结束

/** 前端基址：用于回调完成后 302 回 SPA；缺省与后端同源 */
function webBaseOf(deps: ApiDeps, req: { header: (name: string) => string | undefined; protocol: string }): string { // 托管平台分域时由 MIM_WEB_BASE_URL 指定
  const configured = (deps.env.MIM_WEB_BASE_URL ?? '').trim(); // 显式配置优先
  if (configured) return configured.replace(/\/+$/, ''); // 去尾斜杠后使用
  return backendBaseOf(req).replace(/\/+$/, ''); // 同源部署直接复用后端基址
} // webBaseOf 结束

/** 校验回跳路径：只允许同源相对路径，挡住 //evil.com 这类开放重定向 */
function safeReturnTo(value: string | undefined): string | null { // 非法值一律丢弃
  if (!value) return null; // 未传
  if (!value.startsWith('/') || value.startsWith('//')) return null; // 绝对地址或协议相对地址都不接受
  return value.slice(0, 200); // 限幅，避免超长 query
} // safeReturnTo 结束

/** 把查询参数与表单体合并成纯字符串表，回调处统一读取 */
function stringParams(req: { query: unknown; body: unknown }): Record<string, string> { // GET 用 query，form_post 用 body
  const out: Record<string, string> = {}; // 收集结果
  for (const source of [req.query, req.body]) { // 两个来源都扫一遍
    if (!source || typeof source !== 'object') continue; // 非对象跳过
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) { // 逐字段
      if (typeof value === 'string') out[key] = value; // 只接受字符串，数组等一律忽略
    } // 内层循环结束
  } // 外层循环结束
  return out; // 返回扁平参数表
} // stringParams 结束

/** 回调失败统一 302 回登录页并带错误码，避免浏览器停在 API 的 JSON 错误信封上 */
function redirectError(res: { redirect: (status: number, url: string) => void }, webBase: string, code: string, returnTo: string | null): void { // 只依赖 redirect
  const url = new URL(`${webBase}/signin`); // 固定回登录页
  url.searchParams.set('oauth_error', code); // 错误码供前端翻译
  if (returnTo) url.searchParams.set('return_to', returnTo); // 保留原回跳意图
  res.redirect(302, url.toString()); // 302 让浏览器立即换页
} // redirectError 结束

/** 解析某 provider 的运行配置；未配置抛 503，未登记抛 400 */
function resolveProviderOrThrow(deps: ApiDeps, req: { header: (name: string) => string | undefined; protocol: string }, id: string) { // 路由内多处需要
  const spec = findProvider(id); // 查注册表
  if (!spec) throw new AppError('VALIDATION_FAILED', 'unknown oauth provider', { provider: id }); // 未知提供方属参数错误
  const creds = resolveCredentials(spec, deps.env, backendBaseOf(req)); // 解析凭证
  if (!creds) throw new AppError('AUTH_OAUTH_NOT_CONFIGURED', 'oauth provider is not configured', { provider: id }); // 未配置返回 503
  return { spec, creds }; // 交出定义与凭证
} // resolveProviderOrThrow 结束

export function createOAuthRouter(deps: ApiDeps): Router { // 组装第三方登录路由
  const router = Router(); // 独立路由实例

  router.get('/auth/oauth/providers', (req, res) => { // 公开能力查询：前端据此渲染按钮
    const region = req.query.region === 'cn' || req.query.region === 'global' ? (req.query.region as Region) : undefined; // 可选区域过滤
    res.json({ providers: publicProviders(deps.env, backendBaseOf(req), region) }); // 只返回 id/名称/区域/是否已配置
  }); // 结束 GET /auth/oauth/providers

  router.post('/auth/oauth/:provider/authorize', async (req, res) => { // 发起授权：登录可匿名，绑定必须已登录
    const body = parse(authorizeBody, req.body ?? {}); // 校验请求体
    const mode = body.mode ?? 'login'; // 缺省为登录
    const { spec, creds } = resolveProviderOrThrow(deps, req, req.params.provider); // 解析定义与凭证
    // 绑定模式必须已登录：此处按需解析 Bearer，未带令牌直接 401，不影响登录模式匿名使用
    let linkUserId: string | null = null; // 绑定的目标用户
    if (mode === 'bind') { // 绑定分支
      requireAuth(req, res, () => undefined); // 同步校验 Bearer 并写入 req.user
      linkUserId = req.user!.id; // 目标用户即当前登录用户
    } // 绑定分支结束
    const region = body.region ?? req.user?.region ?? 'cn'; // 新账号归属：请求体 > 登录用户 > 默认 cn
    if (spec.region !== 'both' && spec.region !== region) { // 提供方区域与请求区域不匹配
      throw new AppError('VALIDATION_FAILED', 'oauth provider is not available in this region', { provider: spec.id, region }); // 参数错误
    } // 区域校验结束
    const now = clockOf(deps); // 统一取时
    const state = oauth.generateRandomState(); // 高熵 state
    // 先构造授权地址：标准提供方会生成 PKCE verifier，需要一并落库
    const auth = await buildAuthorizeUrl(spec, creds, state); // 异步：PKCE 挑战值需要计算
    deps.db // state 写入起点
      .prepare( // 预编译插入
        `INSERT INTO oauth_states
         (state_hash, provider, region, mode, link_user_id, code_verifier, redirect_uri, return_to, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ) // 结束预编译
      .run( // 绑定参数
        sha256(state), // 只存摘要
        spec.id, // 提供方
        region, // 新账号区域
        mode, // 登录 / 绑定
        linkUserId, // 绑定目标（登录模式为 NULL）
        auth.codeVerifier, // PKCE 校验码
        creds.redirectUri, // 固化的回调地址
        safeReturnTo(body.return_to), // 只保留安全相对路径
        now, // 创建时间
        new Date(Date.parse(now) + OAUTH_STATE_TTL_SECONDS * 1000).toISOString(), // 过期时间
      ); // 结束执行
    res.status(201).json({ // 返回前端需要的信息
      provider: spec.id, // 提供方标识
      authorization_url: auth.url, // 浏览器跳转地址
      state, // 便于前端排障（不含敏感信息）
      expires_in: OAUTH_STATE_TTL_SECONDS, // 有效期
      mode, // 回显模式
    }); // 结束响应
  }); // 结束 POST /auth/oauth/:provider/authorize

  /** 回调处理：GET（标准）与 POST（Apple form_post）共用一个实现 */
  const handleCallback = (req: Request, res: Response, _next: NextFunction): void => { // 参数类型由 Express 给定
    void (async () => { // 用 IIFE 让异步流程可 await 且统一 catch
      const providerId = String(req.params.provider ?? ''); // 路径参数
      const webBase = webBaseOf(deps, req); // 前端基址，用于失败重定向
      const params = stringParams(req); // 合并 query 与 body
      const rawReturnTo = safeReturnTo(params.return_to); // 仅在显式回跳时使用（一般由 state 记录带出）
      try { // 整个回调过程统一兜底
        if (!findProvider(providerId)) throw new AppError('VALIDATION_FAILED', 'unknown oauth provider'); // 未知提供方
        if (params.error) throw new AppError('AUTH_OAUTH_DENIED', 'user denied the authorization', { error: params.error }); // 用户取消或提供方拒绝
        const state = params.state ?? ''; // 回调 state
        if (!state) throw new AppError('AUTH_OAUTH_STATE_INVALID', 'missing state'); // 缺 state 直接拒绝
        const now = clockOf(deps); // 统一取时
        const record = deps.db // 状态查询起点
          .prepare('SELECT provider, region, mode, link_user_id, code_verifier, redirect_uri, return_to, expires_at FROM oauth_states WHERE state_hash = ?') // 按摘要查
          .get(sha256(state)) as // 行结构
          | { provider: string; region: Region; mode: 'login' | 'bind'; link_user_id: string | null; code_verifier: string | null; redirect_uri: string; return_to: string | null; expires_at: string } // 命中
          | undefined; // 未命中
        if (!record || record.provider !== providerId || Date.parse(record.expires_at) <= Date.parse(now)) { // 三重校验
          throw new AppError('AUTH_OAUTH_STATE_INVALID', 'state is invalid or expired', { provider: providerId }); // 400 后由外层重定向
        } // 校验结束
        deps.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(sha256(state)); // state 一次性：无论后续成败都删除
        const code = params.code ?? ''; // 授权码
        if (!code) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'authorization code is missing'); // 缺 code
        const { spec, creds } = resolveProviderOrThrow(deps, req, providerId); // 凭证（Apple 需要现场签 client_secret）
        const profile = await exchangeOAuthCode(spec, creds, deps.env, { // 换令牌并取统一资料
          code, // 授权码
          state, // 协议层再次校验
          codeVerifier: record.code_verifier, // PKCE 校验码
          redirectUri: record.redirect_uri, // 与发起时逐字一致
          rawParams: params, // Apple form_post 的 user 字段等
        }); // 交换结束
        if (!profile.providerUserId) throw new AppError('AUTH_OAUTH_EXCHANGE_FAILED', 'provider did not return a stable user id', { provider: spec.id }); // 没有稳定 ID 无法绑定
        if (record.mode === 'bind') { // 绑定模式：挂到当前账号
          const target = record.link_user_id ? readUser(deps.db, record.link_user_id) : undefined; // 目标用户
          if (!target || target.status === 'deleted') throw new AppError('AUTH_UNAUTHORIZED', 'account is not available'); // 目标不存在或已删除
          upsertOAuthAccount(deps.db, target.id, spec, profile, now); // 写入绑定（已绑定则刷新资料）
          const targetUrl = new URL(`${webBase}${record.return_to ?? '/account'}`); // 回到个人中心或指定页
          targetUrl.searchParams.set('oauth_bound', spec.id); // 前端据此提示绑定成功
          res.redirect(302, targetUrl.toString()); // 绑定不需要令牌，直接回跳
          return; // 绑定分支结束
        } // 绑定模式结束
        // 登录模式：已有绑定直接登录；否则建号并自动分配 Mim ID
        const existing = findOAuthAccount(deps.db, spec.id, profile.providerUserId) // 主键身份
          ?? (profile.unionId ? findOAuthAccountByUnion(deps.db, spec.id, profile.unionId) : undefined); // unionid 兜底
        let user: UserRow | undefined; // 最终登录用户
        if (existing) { // 已绑定分支
          user = readUser(deps.db, existing.user_id); // 读用户行
          if (!user || user.status === 'deleted') throw new AppError('AUTH_UNAUTHORIZED', 'account is not available'); // 已注销不允许登录
          upsertOAuthAccount(deps.db, user.id, spec, profile, now); // 刷新昵称 / 头像
        } else { // 首次第三方登录
          user = createUserFromOAuth(deps.db, spec, profile, record.region, now); // 建号 + 绑定（自动分配号码）
        } // 分支结束
        const ticket = issueLoginTicket(deps.db, user.id, now); // 一次性票据
        const targetUrl = new URL(`${webBase}/signin`); // 回前端登录页完成兑换
        targetUrl.searchParams.set('oauth_ticket', ticket); // 只带票据，不带正式令牌
        if (record.return_to) targetUrl.searchParams.set('return_to', record.return_to); // 保留回跳意图
        if (rawReturnTo) targetUrl.searchParams.set('return_to', rawReturnTo); // 显式回跳优先
        res.redirect(302, targetUrl.toString()); // 302 回 SPA
      } catch (error) { // 任意失败都重定向回登录页
        const code = error instanceof AppError ? error.code : 'AUTH_OAUTH_EXCHANGE_FAILED'; // 业务码原样透出
        redirectError(res, webBase, code, rawReturnTo); // 302 而不是 JSON
      } // try/catch 结束
    })(); // 立即执行异步流程
  }; // handleCallback 结束

  router.get('/auth/oauth/:provider/callback', handleCallback); // 标准回调
  router.post('/auth/oauth/:provider/callback', urlencoded({ extended: false }), handleCallback); // Apple form_post 回调

  router.post('/auth/oauth/exchange', (req, res) => { // 票据换正式会话
    const body = parse(exchangeBody, req.body ?? {}); // 校验请求体
    const now = clockOf(deps); // 统一取时
    const userId = consumeLoginTicket(deps.db, body.ticket, now); // 一次性消费
    if (!userId) throw new AppError('AUTH_OAUTH_TICKET_INVALID', 'login ticket is invalid or expired'); // 401
    const user = readUser(deps.db, userId); // 读用户行
    if (!user || user.status === 'deleted') throw new AppError('AUTH_OAUTH_TICKET_INVALID', 'account is not available'); // 用户不可用
    res.json(finishLogin(deps, user, body.device)); // 与账号登录完全一致的响应形状
  }); // 结束 POST /auth/oauth/exchange

  router.get('/me/oauth', requireAuth, (req, res) => { // 已绑定第三方列表
    const accounts = listOAuthAccounts(deps.db, req.user!.id); // 按绑定时间排序
    res.json({ accounts }); // 只返回展示字段
  }); // 结束 GET /me/oauth

  router.delete('/me/oauth/:provider', requireAuth, (req, res) => { // 解绑
    const providerId = String(req.params.provider ?? ''); // Express 5 的路径参数可能是数组，统一转字符串
    if (!findProvider(providerId)) throw new AppError('VALIDATION_FAILED', 'unknown oauth provider'); // 未知提供方
    const removed = unlinkOAuthAccount(deps.db, req.user!.id, providerId); // 至少保留一种登录方式
    res.json({ ok: true, removed }); // 幂等返回
  }); // 结束 DELETE /me/oauth/:provider

  return router; // 交出可挂载路由
} // createOAuthRouter 结束
