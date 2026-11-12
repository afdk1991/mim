/**
 * 跨站 SSO 路由：票据签发 / 他站兑换会话 / 登出广播。
 *
 * 端点一览（统一挂在 /api/v1 下，必须在全局 requireAuth 之前挂载）：
 *   POST /auth/sso/ticket    登录态签发一次性 SSO 票据（需登录）
 *   POST /auth/sso/exchange   他站凭票据换取正式会话（公开，票据本身承担鉴权）
 *   POST /auth/sso/logout     登录态签发登出广播签名载荷（需登录）
 *
 * 说明：票据兑换出的会话走 finishLogin，与账号口令 / OAuth 登录同一契约；访客账号不可兑换。
 */

import { Router } from 'express'; // 独立路由实例
import { z } from 'zod'; // 请求体校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { parse } from '../validate.js'; // zod 校验包装
import { requireAuth } from '../middleware.js'; // 票据签发与登出需要登录态
import { finishLogin } from './auth.js'; // 统一会话签发
import {
  SSO_TICKET_TTL_SECONDS, // 票据有效期常量
  consumeSsoTicket, // 票据兑换
  isSiteAllowed, // 白名单判定
  issueSsoTicket, // 票据签发
  signLogoutBroadcast, // 登出广播签名
} from '../sso.js'; // SSO 数据与签名层
import { clockOf } from '../domain.js'; // 可注入时钟
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 设备信息：与账号登录保持同一契约，可选 */
const deviceSchema = z.object({ // 设备对象结构
  platform: z.string().min(1).max(32), // 平台标识
  name: z.string().max(64).optional(), // 设备名可选
}); // deviceSchema 结束

/** 签发票据请求体：目标站点必填，设备信息可选 */
const ticketBody = z.object({ // 只接受必要字段
  site: z.string().min(1).max(200), // 目标站点 origin 或站点键
  device: deviceSchema.optional(), // 兑换端可回传设备
}); // ticketBody 结束

/** 兑换请求体：票据必填，站点与设备可选 */
const exchangeBody = z.object({ // 只接受必要字段
  ticket: z.string().min(10).max(500), // 签名票据
  site: z.string().min(1).max(200).optional(), // 回传站点用于一致性校验
  device: deviceSchema.optional(), // 设备信息
}); // exchangeBody 结束

/** 登出广播请求体：站点可选（空表示全站广播） */
const logoutBody = z.object({ // 只接受必要字段
  site: z.string().min(1).max(200).optional(), // 发起站点
}); // logoutBody 结束

/** 组装 SSO 路由工厂：测试自建 mini app 时直接挂载本路由 */
export function createSsoRouter(deps: ApiDeps): Router { // 依赖显式注入
  const router = Router(); // 独立路由实例

  router.post('/auth/sso/ticket', requireAuth, (req, res) => { // 登录态签发票据
    const body = parse(ticketBody, req.body ?? {}); // 校验请求体
    if (!isSiteAllowed(deps.env, body.site)) { // 白名单前置校验，给出明确 403
      throw new AppError('AUTH_SSO_SITE_FORBIDDEN', 'sso site is not allowed', { site: body.site }); // 拒绝并回显站点
    } // 白名单结束
    const now = clockOf(deps); // 统一取时
    const ticket = issueSsoTicket(deps, req.user!.id, body.site, now); // 签发一次性票据
    res.status(201).json({ ticket, site: body.site, expires_in: SSO_TICKET_TTL_SECONDS }); // 回传票据与有效期
  }); // 结束 POST /auth/sso/ticket

  router.post('/auth/sso/exchange', (req, res) => { // 他站兑换正式会话
    const body = parse(exchangeBody, req.body ?? {}); // 校验请求体
    const now = clockOf(deps); // 统一取时
    const user = consumeSsoTicket(deps, body.ticket, body.site, now); // 验签 + 一次性消费 + 正式用户校验
    res.json(finishLogin(deps, user, body.device)); // 与普通登录同一响应形状
  }); // 结束 POST /auth/sso/exchange

  router.post('/auth/sso/logout', requireAuth, (req, res) => { // 签发登出广播载荷
    const body = parse(logoutBody, req.body ?? {}); // 校验请求体
    const now = clockOf(deps); // 统一取时
    const broadcast = signLogoutBroadcast(deps, req.user!.id, body.site, now); // 签名 stateless 载荷
    res.json({ ...broadcast, site: body.site ?? '' }); // 回传广播令牌、有效期与站点
  }); // 结束 POST /auth/sso/logout

  return router; // 交出可挂载路由
} // createSsoRouter 结束
