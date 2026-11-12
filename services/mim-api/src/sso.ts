/**
 * 跨站 SSO：票据签发 / 一次性兑换 / 登出广播签名。
 *
 * 安全约定：
 *   - 票据与广播载荷都用 HMAC-SHA256 签名（`base64url(payload).base64url(signature)`），
 *     密钥优先取 MIM_SSO_SECRET，非生产回退 JWT 密钥；不与访客会话混用；
 *   - 站点必须命中 MIM_SSO_ALLOWED_SITES 白名单（origin 或站点键，逗号分隔）；
 *   - 票据落库只存 sha256 摘要，兑换时同事务标记 consumed_at，保证一次性、防重放；
 *   - 兑换出会话的必须是正式用户：访客账号（is_guest=1）票据直接拒绝。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'; // HMAC 签名、随机票据、常数时间比较
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { clockOf } from './domain.js'; // 可注入时钟
import { sha256 } from './auth.js'; // 票据摘要只入库
import { readUser } from './identity.js'; // 读用户行（含访客标记）
import type { ApiDeps, UserRow } from './types.js'; // 依赖容器与用户类型

/** SSO 票据有效期：5 分钟，覆盖站点间跳转与一次兑换 */
export const SSO_TICKET_TTL_SECONDS = 300;
/** 登出广播载荷有效期：60 秒，足够各站点验签后本地吊销 */
export const SSO_LOGOUT_TTL_SECONDS = 60;

/** 取 HMAC 密钥：环境变量优先，缺省回退注入的 JWT 密钥（仅开发态允许） */
function ssoSecret(deps: ApiDeps): string { // 路由与数据层共用
  const fromEnv = (deps.env.MIM_SSO_SECRET ?? '').trim(); // 显式配置优先
  return fromEnv || deps.jwtSecret; // 回退 JWT 密钥，测试可直接注入
} // ssoSecret 结束

/** base64url 编码（无填充、URL 安全），与 JWT 编码口径一致 */
function b64url(input: Buffer | string): string { // 入参支持字符串或字节
  return Buffer.from(input).toString('base64url'); // Node 原生 base64url
} // b64url 结束

/** HMAC-SHA256 签名：输出 base64url 摘要 */
function hmacSign(data: string, secret: string): string { // 载荷与密钥分离
  return b64url(createHmac('sha256', secret).update(data).digest()); // 摘要字节编码
} // hmacSign 结束

/** 解析并验签一枚签名令牌；任意失败统一抛 SSO 票据无效 */
function verifySignedToken(token: string, secret: string, expectedTyp: string): Record<string, unknown> { // 限定令牌类型
  const parts = token.split('.'); // 结构 payload.signature
  if (parts.length !== 2) throw new AppError('AUTH_SSO_TICKET_INVALID', 'malformed sso token'); // 结构非法
  const [payloadB64, signature] = parts as [string, string]; // 解构两段
  const expected = hmacSign(payloadB64, secret); // 重算摘要
  const left = Buffer.from(signature); // 提供方摘要
  const right = Buffer.from(expected); // 期望摘要
  if (left.length !== right.length || !timingSafeEqual(left, right)) { // 长度先比，再常数时间比较
    throw new AppError('AUTH_SSO_TICKET_INVALID', 'sso token signature mismatch'); // 签名不符
  } // 验签结束
  let payload: Record<string, unknown>; // 解析后的载荷
  try { // base64url 解码 + JSON 解析都可能失败
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>; // 还原对象
  } catch { // 非法编码 / 非法 JSON
    throw new AppError('AUTH_SSO_TICKET_INVALID', 'sso token payload is not valid'); // 归一拒绝
  } // try/catch 结束
  if (payload.typ !== expectedTyp) throw new AppError('AUTH_SSO_TICKET_INVALID', 'unexpected sso token type'); // 类型串用拒绝
  return payload; // 交出载荷
} // verifySignedToken 结束

/** 白名单站点清单：去空白、去尾斜杠；未配置时返回空数组（全部拒绝） */
export function allowedSites(env: Record<string, string | undefined>): string[] { // 供路由回显与校验复用
  return (env.MIM_SSO_ALLOWED_SITES ?? '') // 逗号分隔
    .split(',') // 逐项拆分
    .map((site) => site.trim().replace(/\/+$/, '')) // 去空白与尾斜杠
    .filter(Boolean); // 丢弃空项
} // allowedSites 结束

/** 站点是否在白名单内；大小写与协议归一后精确匹配 */
export function isSiteAllowed(env: Record<string, string | undefined>, site: string): boolean { // 白名单判定
  const normalized = site.trim().replace(/\/+$/, '').toLowerCase(); // 归一化入参
  return allowedSites(env).some((allowed) => allowed.toLowerCase() === normalized); // 精确匹配
} // isSiteAllowed 结束

/** 签发一枚 SSO 票据：写库只存摘要，明文票据返回给发起站点 */
export function issueSsoTicket(deps: ApiDeps, userId: string, site: string, now: string): string { // 返回明文票据（仅此一次）
  if (!isSiteAllowed(deps.env, site)) { // 站点不在白名单直接拒绝
    throw new AppError('AUTH_SSO_SITE_FORBIDDEN', 'sso site is not allowed', { site }); // 403 并回显站点
  } // 白名单校验结束
  const secret = ssoSecret(deps); // 取签名密钥
  const jti = randomBytes(16).toString('base64url'); // 票据随机标识
  const issuedAt = Math.floor(Date.parse(now) / 1000); // 秒级签发时间
  const payload = { // 载荷只放必要声明
    typ: 'sso_ticket', // 令牌类型，兑换时校验防串用
    jti, // 随机标识
    sub: userId, // 归属用户
    site, // 目标站点
    iat: issuedAt, // 签发秒级时间
    exp: issuedAt + SSO_TICKET_TTL_SECONDS, // 过期秒级时间
  }; // 载荷结束
  const payloadB64 = b64url(JSON.stringify(payload)); // 编码载荷
  const ticket = `${payloadB64}.${hmacSign(payloadB64, secret)}`; // 拼成签名令牌
  const expiresAt = new Date(issuedAt * 1000 + SSO_TICKET_TTL_SECONDS * 1000).toISOString(); // 库内 ISO 过期时间
  deps.db // 票据落库起点
    .prepare('INSERT INTO sso_tickets (ticket_hash, user_id, site, expires_at, created_at) VALUES (?, ?, ?, ?, ?)') // 只存摘要
    .run(sha256(ticket), userId, site, expiresAt, now); // 绑定参数
  return ticket; // 明文交出
} // issueSsoTicket 结束

/**
 * 兑换 SSO 票据：验签 → 过期 → 站点一致 → 一次性消费 → 正式用户校验。
 * 消费用条件 UPDATE 保证并发下同一票据只被兑换一次。
 */
export function consumeSsoTicket(deps: ApiDeps, ticket: string, site: string | undefined, now: string): UserRow { // 成功返回用户行
  const secret = ssoSecret(deps); // 取签名密钥
  const payload = verifySignedToken(ticket, secret, 'sso_ticket'); // 验签 + 类型校验
  const exp = Number(payload.exp); // 过期秒级时间
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.parse(now) / 1000)) { // 过期判定
    throw new AppError('AUTH_SSO_TICKET_INVALID', 'sso ticket is expired'); // 过期统一拒绝
  } // 过期判断结束
  const payloadSite = String(payload.site ?? ''); // 载荷内站点
  if (site && site.trim() !== payloadSite) { // 调用方带回站点时必须与载荷一致
    throw new AppError('AUTH_SSO_SITE_FORBIDDEN', 'sso site does not match ticket', { site }); // 防跨站挪用
  } // 站点一致性结束
  if (!isSiteAllowed(deps.env, payloadSite)) { // 白名单可能在签发后收紧，兑换时再判一次
    throw new AppError('AUTH_SSO_SITE_FORBIDDEN', 'sso site is not allowed', { site: payloadSite }); // 拒绝
  } // 白名单复核结束

  const consumed = deps.db // 条件消费：未消费且未过期才置位
    .prepare( // 预编译原子消费语句
      'UPDATE sso_tickets SET consumed_at = ? WHERE ticket_hash = ? AND consumed_at IS NULL AND expires_at > ?', // 三重条件
    ) // prepare 结束
    .run(now, sha256(ticket), now); // 绑定时间、摘要、当前时间
  if (consumed.changes !== 1) { // 无命中：不存在 / 已消费 / 已过期
    throw new AppError('AUTH_SSO_TICKET_INVALID', 'sso ticket is invalid, consumed or expired'); // 401
  } // 一次性消费校验结束

  const user = readUser(deps.db, String(payload.sub ?? '')); // 读归属用户行
  if (!user || user.status === 'deleted') throw new AppError('AUTH_SSO_TICKET_INVALID', 'account is not available'); // 不可用
  if (user.is_guest === 1) throw new AppError('AUTH_SSO_TICKET_INVALID', 'guest account cannot exchange an sso session'); // 访客不得换正式 SSO 会话
  return user; // 交出正式用户
} // consumeSsoTicket 结束

/** 签发登出广播载荷：其他站点验签后本地吊销对应用户会话，stateless 不落库 */
export function signLogoutBroadcast(deps: ApiDeps, userId: string, site: string | undefined, now: string): { logout_token: string; expires_in: number } { // 返回签名令牌与有效期
  const secret = ssoSecret(deps); // 取签名密钥
  const issuedAt = Math.floor(Date.parse(now) / 1000); // 秒级时间
  const payload = { // 广播载荷
    typ: 'sso_logout', // 类型与票据区分
    sub: userId, // 被登出用户
    site: site ?? '', // 发起站点（可空表示全站广播）
    iat: issuedAt, // 签发时间
    exp: issuedAt + SSO_LOGOUT_TTL_SECONDS, // 短有效期
  }; // 载荷结束
  const payloadB64 = b64url(JSON.stringify(payload)); // 编码
  return { logout_token: `${payloadB64}.${hmacSign(payloadB64, secret)}`, expires_in: SSO_LOGOUT_TTL_SECONDS }; // 令牌 + 有效期
} // signLogoutBroadcast 结束
