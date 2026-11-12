/**
 * 跨站 SSO 测试：票据签发 / 一次性兑换 / 过期 / 重放 / 站点白名单 / 访客拒绝 / 登出广播。
 * 测试自建 mini app，只挂载 SSO 路由；内存库 + 可注入时钟。
 */

import express from 'express'; // 组装 mini app
import { describe, expect, it } from 'vitest'; // vitest 用例编排与断言
import request from 'supertest'; // HTTP 断言
import { createHmac } from 'node:crypto'; // 测试内独立验签
import { createDatabase } from '../src/db.js'; // 内存库
import { createUser } from '../src/identity.js'; // 造正式 / 访客用户
import { issueAccessToken } from '../src/auth.js'; // 造登录态令牌
import { createSsoRouter } from '../src/routes/sso.js'; // 被测路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import type { ApiDeps } from '../src/types.js'; // 依赖容器

const SECRET = 'sso-test-secret'; // 测试 HMAC 密钥
const SITE_A = 'https://app.example.com'; // 白名单站点 A
const SITE_B = 'https://m.cn.example.com'; // 白名单站点 B
const EVIL = 'https://evil.example.org'; // 白名单外站点

/** 组装只含 SSO 路由的 mini app */
function miniApp(deps: ApiDeps) { // 依赖显式注入
  const app = express(); // 独立实例
  app.use(express.json()); // 解析 JSON
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createSsoRouter(deps)); // 挂载被测路由
  app.use(errorHandler); // 统一错误处理
  return app; // 交出实例
} // miniApp 结束

/** 独立验签并解出载荷（不依赖被测内部函数） */
function decodeSignedToken(token: string, secret: string): Record<string, unknown> { // 常量时间比对由服务端完成，测试只复核
  const [payloadB64, signature] = token.split('.'); // 拆两段
  const expected = createHmac('sha256', secret).update(payloadB64).digest('base64url'); // 重算摘要
  expect(signature).toBe(expected); // 签名一致
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>; // 解载荷
} // decodeSignedToken 结束

/** 造一套依赖：可注入时钟 + 白名单环境 */
function makeDeps() { // 工厂复用
  let nowValue = '2026-11-13T08:00:00.000Z'; // 固定起始时间，便于过期断言
  const deps: ApiDeps = { // 依赖容器
    db: createDatabase(':memory:'), // 内存库
    jwtSecret: SECRET, // 复用为 SSO 密钥回退
    env: { MIM_SSO_SECRET: SECRET, MIM_SSO_ALLOWED_SITES: `${SITE_A},${SITE_B}` }, // SSO 配置
    now: () => nowValue, // 可推进时钟
  }; // deps 结束
  return { deps, advance: (ms: number) => { nowValue = new Date(Date.parse(nowValue) + ms).toISOString(); }, nowValue: () => nowValue }; // 交出控制句柄
} // makeDeps 结束

describe('跨站 SSO 票据', () => { // 票据维度
  it('未登录签发票据返回 401', async () => { // 登录态校验
    const { deps } = makeDeps(); // 新库
    const app = miniApp(deps); // 挂载
    const res = await request(app).post('/api/v1/auth/sso/ticket').send({ site: SITE_A }); // 不带 Bearer
    expect(res.status).toBe(401); // 拒绝匿名签发
  }); // 结束 401 用例

  it('站点不在白名单时签发返回 403 AUTH_SSO_SITE_FORBIDDEN', async () => { // 白名单拦截
    const { deps } = makeDeps(); // 新库
    const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 正式用户
    const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 登录态
    const app = miniApp(deps); // 挂载
    const res = await request(app).post('/api/v1/auth/sso/ticket').set('Authorization', `Bearer ${token}`).send({ site: EVIL }); // 白名单外站点
    expect(res.status).toBe(403); // 站点拒绝
    expect(res.body.code).toBe('AUTH_SSO_SITE_FORBIDDEN'); // 明确错误码
  }); // 结束白名单用例

  it('正式用户签发票据 → 兑换得到正式会话；同一票据重放被拒绝', async () => { // 主链路 + 一次性
    const { deps } = makeDeps(); // 新库
    const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 正式用户
    const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 登录态
    const app = miniApp(deps); // 挂载

    const issue = await request(app).post('/api/v1/auth/sso/ticket').set('Authorization', `Bearer ${token}`).send({ site: SITE_A }); // 签发
    expect(issue.status).toBe(201); // 签发成功
    const ticket = issue.body.ticket as string; // 取票据
    expect(issue.body.expires_in).toBeGreaterThan(0); // 回传有效期

    const exchange = await request(app).post('/api/v1/auth/sso/exchange').send({ ticket, site: SITE_A }); // 首次兑换
    expect(exchange.status).toBe(200); // 兑换成功
    expect(exchange.body.access_token).toBeTruthy(); // 拿到会话令牌
    expect(exchange.body.user.id).toBe(user.id); // 归属同一正式用户
    expect(exchange.body.user.is_guest).toBe(false); // 会话主体是正式用户，不是访客

    const replay = await request(app).post('/api/v1/auth/sso/exchange').send({ ticket, site: SITE_A }); // 第二次兑换同一票据
    expect(replay.status).toBe(401); // 一次性消费后拒绝
    expect(replay.body.code).toBe('AUTH_SSO_TICKET_INVALID'); // 票据无效 / 已消费
  }); // 结束主链路用例

  it('票据过期后兑换返回 401', async () => { // 过期拒绝
    const { deps, advance } = makeDeps(); // 新库 + 时钟控制
    const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 正式用户
    const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 登录态
    const app = miniApp(deps); // 挂载
    const issue = await request(app).post('/api/v1/auth/sso/ticket').set('Authorization', `Bearer ${token}`).send({ site: SITE_A }); // 签发
    const ticket = issue.body.ticket as string; // 取票据
    advance(10 * 60 * 1000); // 推进 10 分钟，超过 5 分钟票据 TTL
    const exchange = await request(app).post('/api/v1/auth/sso/exchange').send({ ticket, site: SITE_A }); // 过期兑换
    expect(exchange.status).toBe(401); // 过期拒绝
    expect(exchange.body.code).toBe('AUTH_SSO_TICKET_INVALID'); // 归一票据无效码
  }); // 结束过期用例

  it('兑换时回传站点与票据站点不一致返回 403', async () => { // 站点一致性
    const { deps } = makeDeps(); // 新库
    const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 正式用户
    const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 登录态
    const app = miniApp(deps); // 挂载
    const issue = await request(app).post('/api/v1/auth/sso/ticket').set('Authorization', `Bearer ${token}`).send({ site: SITE_A }); // 票据绑定 A 站
    const ticket = issue.body.ticket as string; // 取票据
    const exchange = await request(app).post('/api/v1/auth/sso/exchange').send({ ticket, site: SITE_B }); // 却用 B 站兑换
    expect(exchange.status).toBe(403); // 站点不一致拒绝
    expect(exchange.body.code).toBe('AUTH_SSO_SITE_FORBIDDEN'); // 明确错误码
  }); // 结束站点一致用例

  it('白名单在签发后收紧，已签发票据兑换同样被 403 拒绝', async () => { // 白名单复核
    const { deps } = makeDeps(); // 新库
    const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 正式用户
    const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 登录态
    const app = miniApp(deps); // 挂载
    const issue = await request(app).post('/api/v1/auth/sso/ticket').set('Authorization', `Bearer ${token}`).send({ site: SITE_A }); // 宽松期签发
    const ticket = issue.body.ticket as string; // 取票据
    deps.env.MIM_SSO_ALLOWED_SITES = ''; // 白名单清空（模拟收紧）
    const exchange = await request(app).post('/api/v1/auth/sso/exchange').send({ ticket, site: SITE_A }); // 复核白名单
    expect(exchange.status).toBe(403); // 收紧后拒绝
  }); // 结束收紧用例

  it('访客账号持票据兑换被拒绝，不能换取正式 SSO 会话', async () => { // 访客隔离
    const { deps } = makeDeps(); // 新库
    const guest = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 先建行
    deps.db.prepare('UPDATE users SET is_guest = 1 WHERE id = ?').run(guest.id); // 标记访客
    const token = issueAccessToken(guest.id, guest.region, deps.jwtSecret); // 访客登录态
    const app = miniApp(deps); // 挂载
    const issue = await request(app).post('/api/v1/auth/sso/ticket').set('Authorization', `Bearer ${token}`).send({ site: SITE_A }); // 访客也能走签发
    const ticket = issue.body.ticket as string; // 取票据
    const exchange = await request(app).post('/api/v1/auth/sso/exchange').send({ ticket, site: SITE_A }); // 尝试兑换
    expect(exchange.status).toBe(401); // 访客不得换正式会话
    expect(exchange.body.code).toBe('AUTH_SSO_TICKET_INVALID'); // 归一拒绝码
  }); // 结束访客隔离用例

  it('登出广播返回签名载荷，载荷类型为 sso_logout 且验签通过', async () => { // 广播签名
    const { deps } = makeDeps(); // 新库
    const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 正式用户
    const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 登录态
    const app = miniApp(deps); // 挂载
    const res = await request(app).post('/api/v1/auth/sso/logout').set('Authorization', `Bearer ${token}`).send({ site: SITE_A }); // 签发广播
    expect(res.status).toBe(200); // 成功
    const payload = decodeSignedToken(res.body.logout_token, SECRET); // 独立验签解载荷
    expect(payload.typ).toBe('sso_logout'); // 类型为登出广播
    expect(payload.sub).toBe(user.id); // 归属用户正确
    expect(res.body.expires_in).toBeGreaterThan(0); // 短有效期回传
  }); // 结束广播用例
}); // 结束 describe
