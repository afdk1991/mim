/**
 * 契约测试：Mim ID 自动分配 + 第三方 OAuth 全流程。
 *
 * 覆盖点：
 *   1. 注册 / 第三方首登都会拿到连续且唯一的 MIM-xxxxxxxx 号码，/me 能读到；
 *   2. 存量用户回填号码幂等；
 *   3. 9 家 provider 的授权地址参数形状正确（含微信锚点、抖音 client_key、QQ fmt=json）；
 *   4. GitHub（标准 OAuth2）与微信（自定义协议）用本地假服务端跑通
 *      「授权 → 回调 → 一次性票据 → 正式会话」全链路，且二次登录复用同一账号；
 *   5. 绑定冲突与「最后一个登录方式不允许解绑」两条安全规则。
 */

import { createServer, type Server } from 'node:http'; // 本地假提供方服务端
import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 测试编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 应用装配入口
import { createDatabase } from '../src/db.js'; // 内存库
import { allocateMemberNo, backfillMemberNos } from '../src/identity.js'; // 发号与回填
import { OAUTH_PROVIDERS, resolveCredentials } from '../src/oauth/providers.js'; // provider 注册表
import { buildAuthorizeUrl } from '../src/oauth/client.js'; // 授权地址构造

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定密钥
const CALLBACK_BASE = 'http://127.0.0.1:5999'; // 假回调基址，只用于拼 redirect_uri

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 数据库句柄
let fake: Server | null = null; // 假提供方服务端
let fakeBase = ''; // 假服务端基址

/** 启动假提供方：按路径返回 OAuth 令牌与用户资料 */
async function startFakeProvider(): Promise<void> {
  fake = createServer((req, res) => { // 所有请求都落在同一个 handler 里
    const url = new URL(req.url ?? '/', 'http://localhost'); // 解析路径与 query
    res.setHeader('Content-Type', 'application/json'); // 统一 JSON
    if (url.pathname === '/github/token') { // GitHub 令牌端点
      res.end(JSON.stringify({ access_token: 'gh-token', token_type: 'Bearer', scope: 'read:user' })); // 返回标准令牌
      return; // 结束分支
    } // GitHub token 结束
    if (url.pathname === '/github/user') { // GitHub 资料端点
      res.end(JSON.stringify({ id: 4242, login: 'octocat', name: 'Octo Cat', avatar_url: 'https://example.com/a.png', email: 'octo@example.com' })); // 完整资料
      return; // 结束分支
    } // GitHub user 结束
    if (url.pathname === '/wechat/token') { // 微信令牌端点
      res.end(JSON.stringify({ access_token: 'wx-token', openid: 'wx-openid-1', unionid: 'wx-union-1' })); // 微信字段
      return; // 结束分支
    } // 微信 token 结束
    if (url.pathname === '/wechat/profile') { // 微信资料端点
      res.end(JSON.stringify({ openid: 'wx-openid-1', unionid: 'wx-union-1', nickname: '微信用户', headimgurl: 'https://example.com/wx.png' })); // 微信资料
      return; // 结束分支
    } // 微信 profile 结束
    res.statusCode = 404; // 未命中路径
    res.end(JSON.stringify({ error: 'not_found' })); // 明确失败
  }); // handler 结束
  await new Promise<void>((resolve) => { // 等待监听完成
    fake!.listen(0, '127.0.0.1', () => resolve()); // 随机端口避免冲突
  }); // Promise 结束
  const address = fake.address(); // 取监听地址
  fakeBase = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''; // 拼基址
} // startFakeProvider 结束

/** 关闭假服务端，避免测试进程悬挂 */
async function stopFakeProvider(): Promise<void> {
  if (!fake) return; // 未启动
  await new Promise<void>((resolve, reject) => fake!.close((error) => (error ? reject(error) : resolve()))); // 关闭并等待
  fake = null; // 复位
  fakeBase = ''; // 复位
} // stopFakeProvider 结束

beforeEach(async () => { // 每例：全新库 + 全新应用 + 假提供方
  db = createDatabase(':memory:'); // 独立内存库
  await startFakeProvider(); // 启动假提供方
  const env = { // 注入两份凭证，端点全部指向假服务端
    MIM_OAUTH_CALLBACK_BASE: CALLBACK_BASE, // 回调基址
    MIM_WEB_BASE_URL: 'http://127.0.0.1:5999', // 前端基址
    MIM_AUTH_GITHUB_CLIENT_ID: 'gh-client', // GitHub 客户端 ID
    MIM_AUTH_GITHUB_CLIENT_SECRET: 'gh-secret', // GitHub 密钥
    MIM_AUTH_GITHUB_AUTHORIZE_URL: `${fakeBase}/github/authorize`, // 授权端点
    MIM_AUTH_GITHUB_TOKEN_URL: `${fakeBase}/github/token`, // 令牌端点
    MIM_AUTH_GITHUB_PROFILE_URL: `${fakeBase}/github/user`, // 资料端点
    MIM_AUTH_WECHAT_APP_ID: 'wx-app', // 微信应用 ID
    MIM_AUTH_WECHAT_APP_SECRET: 'wx-secret', // 微信密钥
    MIM_AUTH_WECHAT_AUTHORIZE_URL: `${fakeBase}/wechat/authorize`, // 微信授权端点
    MIM_AUTH_WECHAT_TOKEN_URL: `${fakeBase}/wechat/token`, // 微信令牌端点
    MIM_AUTH_WECHAT_PROFILE_URL: `${fakeBase}/wechat/profile`, // 微信资料端点
  }; // env 结束
  app = createApp({ db, jwtSecret: JWT_SECRET, env }); // 装配应用
}); // beforeEach 结束

afterEach(async () => { // 每例后清理
  await stopFakeProvider(); // 关闭假服务端
}); // afterEach 结束

describe('Mim ID 自动分配', () => { // 号码唯一性与连续性
  it('连续发号不重复且格式固定', () => { // 直接测发号器
    const numbers = Array.from({ length: 20 }, () => allocateMemberNo(db)); // 连续发 20 个
    expect(new Set(numbers).size).toBe(20); // 无重号
    expect(numbers[0]).toBe('102'); // 1～99 短号段整段预留，100 整百、101 回文，首个可发号是 102
  }); // 结束用例

  it('注册即分配号码，/me 可读回', async () => { // 端到端
    const first = await request(app).post('/api/v1/auth/register').send({ region: 'cn', identifier: '13900000010', password: 'mim-pass-123' }); // 首个注册
    expect(first.status).toBe(201); // 注册成功
    expect(first.body.user.member_no).toBe('102'); // 首个号码（跳过 1～99 与 100/101）
    const token = first.body.access_token as string; // 取令牌
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`); // 读个人资料
    expect(me.body.user.member_no).toBe('102'); // /me 同号
    const second = await request(app).post('/api/v1/auth/register').send({ region: 'cn', identifier: '13900000011', password: 'mim-pass-123' }); // 第二个注册
    expect(second.body.user.member_no).toBe('103'); // 连续递增
  }); // 结束用例

  it('存量无号用户回填且幂等', () => { // 模拟历史库
    const now = '2026-11-12T00:00:00.000Z'; // 固定时间
    db.prepare("INSERT INTO users (id, region, status, display_name, locale, timezone, created_at, updated_at) VALUES ('u-old', 'cn', 'active', '旧用户', 'zh-CN', 'Asia/Shanghai', ?, ?)").run(now, now); // 不带 member_no 的历史行
    expect(backfillMemberNos(db)).toBe(1); // 首次补 1 个
    const row = db.prepare("SELECT member_no FROM users WHERE id = 'u-old'").get() as { member_no: string }; // 读回
    expect(row.member_no).toBe('102'); // 已拿到纯数字号码（短号段已预留）
    expect(backfillMemberNos(db)).toBe(0); // 再次调用不再补号
  }); // 结束用例
}); // describe 结束

describe('provider 授权地址', () => { // 参数形状
  it('9 家 provider 全部登记且区域正确', () => { // 注册表完整性
    expect(OAUTH_PROVIDERS.map((provider) => provider.id)).toEqual(['github', 'gitee', 'gitlab', 'google', 'microsoft', 'apple', 'wechat', 'qq', 'douyin', 'weibo', 'baidu', 'alipay', 'facebook', 'twitter']); // 清单与需求一致（顺序按注册表）
    expect(OAUTH_PROVIDERS.find((provider) => provider.id === 'wechat')?.region).toBe('cn'); // 微信仅国内
    expect(OAUTH_PROVIDERS.find((provider) => provider.id === 'google')?.region).toBe('global'); // Google 仅海外
  }); // 结束用例

  it('微信带 #wechat_redirect，抖音用 client_key，QQ 带 scope', async () => { // 三家非标准协议
    const wechat = OAUTH_PROVIDERS.find((provider) => provider.id === 'wechat')!; // 微信定义
    const wechatCreds = resolveCredentials(wechat, { MIM_AUTH_WECHAT_APP_ID: 'a', MIM_AUTH_WECHAT_APP_SECRET: 'b', MIM_OAUTH_CALLBACK_BASE: CALLBACK_BASE }, CALLBACK_BASE)!; // 解析凭证
    const wechatUrl = await buildAuthorizeUrl(wechat, wechatCreds, 'state-1'); // 构造授权地址
    expect(wechatUrl.url).toContain('appid=a'); // 微信参数名
    expect(wechatUrl.url.endsWith('#wechat_redirect')).toBe(true); // 锚点必须保留
    const douyin = OAUTH_PROVIDERS.find((provider) => provider.id === 'douyin')!; // 抖音定义
    const douyinCreds = resolveCredentials(douyin, { MIM_AUTH_DOUYIN_CLIENT_KEY: 'k', MIM_AUTH_DOUYIN_CLIENT_SECRET: 's', MIM_OAUTH_CALLBACK_BASE: CALLBACK_BASE }, CALLBACK_BASE)!; // 凭证
    const douyinUrl = await buildAuthorizeUrl(douyin, douyinCreds, 'state-2'); // 授权地址
    expect(douyinUrl.url).toContain('client_key=k'); // 抖音参数名
    const qq = OAUTH_PROVIDERS.find((provider) => provider.id === 'qq')!; // QQ 定义
    const qqCreds = resolveCredentials(qq, { MIM_AUTH_QQ_APP_ID: 'q', MIM_AUTH_QQ_APP_KEY: 's', MIM_OAUTH_CALLBACK_BASE: CALLBACK_BASE }, CALLBACK_BASE)!; // 凭证
    const qqUrl = await buildAuthorizeUrl(qq, qqCreds, 'state-3'); // 授权地址
    expect(qqUrl.url).toContain('scope=get_user_info'); // QQ 需显式 scope
  }); // 结束用例

  it('未配置凭证的 provider 在清单里标记 configured=false', async () => { // 能力查询
    const res = await request(app).get('/api/v1/auth/oauth/providers'); // 公开清单
    expect(res.status).toBe(200); // 恒可访问
    const github = res.body.providers.find((provider: { id: string }) => provider.id === 'github'); // GitHub 已配置
    const google = res.body.providers.find((provider: { id: string }) => provider.id === 'google'); // Google 未配置
    expect(github.configured).toBe(true); // 有凭证
    expect(google.configured).toBe(false); // 无凭证
  }); // 结束用例
}); // describe 结束

/** 发起授权并返回 state 与授权地址 */
async function authorize(provider: string, region: 'cn' | 'global', mode: 'login' | 'bind' = 'login', token?: string) { // 供全流程用例复用
  const req = request(app).post(`/api/v1/auth/oauth/${provider}/authorize`).send({ region, mode, return_to: '/account' }); // 构造请求
  if (token) req.set('Authorization', `Bearer ${token}`); // 绑定模式带登录态
  return req; // 交出可等待的请求
} // authorize 结束

describe('GitHub 标准 OAuth 全流程', () => { // 授权 → 回调 → 票据 → 会话
  it('首次登录自动建号发号码，二次登录复用同一账号', async () => { // 核心链路
    const first = await authorize('github', 'global'); // 发起授权
    expect(first.status).toBe(201); // 201 表示已记录 state
    const authorizationUrl = new URL(first.body.authorization_url as string); // 解析授权地址
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy(); // 带 PKCE 挑战
    const state = first.body.state as string; // 取 state
    const callback = await request(app).get('/api/v1/auth/oauth/github/callback').query({ code: 'gh-code', state }); // 模拟提供方回调
    expect(callback.status).toBe(302); // 必须重定向
    const location = new URL(callback.headers.location as string); // 解析回跳地址
    expect(location.pathname).toBe('/signin'); // 回登录页
    const ticket = location.searchParams.get('oauth_ticket'); // 一次性票据
    expect(ticket).toBeTruthy(); // 有票据
    const exchanged = await request(app).post('/api/v1/auth/oauth/exchange').send({ ticket }); // 兑换会话
    expect(exchanged.status).toBe(200); // 兑换成功
    expect(exchanged.body.user.member_no).toBe('102'); // 自动分配号码
    expect(exchanged.body.user.display_name).toBe('Octo Cat'); // 用提供方昵称作展示名
    const second = await authorize('github', 'global'); // 第二次授权
    const secondCallback = await request(app).get('/api/v1/auth/oauth/github/callback').query({ code: 'gh-code-2', state: second.body.state }); // 再次回调
    const secondTicket = new URL(secondCallback.headers.location as string).searchParams.get('oauth_ticket'); // 新票据
    const secondExchange = await request(app).post('/api/v1/auth/oauth/exchange').send({ ticket: secondTicket }); // 兑换
    expect(secondExchange.body.user.id).toBe(exchanged.body.user.id); // 同一账号
    expect(secondExchange.body.user.member_no).toBe('102'); // 号码不变
  }); // 结束用例

  it('state 无效时 302 回登录页并带错误码', async () => { // 防 CSRF
    const callback = await request(app).get('/api/v1/auth/oauth/github/callback').query({ code: 'x', state: 'forged-state' }); // 伪造 state
    expect(callback.status).toBe(302); // 仍重定向
    expect(new URL(callback.headers.location as string).searchParams.get('oauth_error')).toBe('AUTH_OAUTH_STATE_INVALID'); // 明确错误码
  }); // 结束用例

  it('票据只能消费一次', async () => { // 一次性
    const auth = await authorize('github', 'global'); // 发起授权
    const callback = await request(app).get('/api/v1/auth/oauth/github/callback').query({ code: 'c', state: auth.body.state }); // 回调
    const ticket = new URL(callback.headers.location as string).searchParams.get('oauth_ticket') as string; // 取票据
    expect((await request(app).post('/api/v1/auth/oauth/exchange').send({ ticket })).status).toBe(200); // 首次成功
    expect((await request(app).post('/api/v1/auth/oauth/exchange').send({ ticket })).status).toBe(401); // 二次失败
  }); // 结束用例
}); // describe 结束

describe('微信自定义协议全流程', () => { // 非标准 OAuth2
  it('首次登录建号并返回号码', async () => { // 端到端
    const auth = await authorize('wechat', 'cn'); // 国内区发起
    expect(auth.status).toBe(201); // 已记录 state
    const callback = await request(app).get('/api/v1/auth/oauth/wechat/callback').query({ code: 'wx-code', state: auth.body.state }); // 回调
    expect(callback.status).toBe(302); // 重定向
    const ticket = new URL(callback.headers.location as string).searchParams.get('oauth_ticket') as string; // 票据
    const exchanged = await request(app).post('/api/v1/auth/oauth/exchange').send({ ticket }); // 兑换
    expect(exchanged.status).toBe(200); // 成功
    expect(exchanged.body.user.member_no).toBe('102'); // 自动发号
    expect(exchanged.body.user.display_name).toBe('微信用户'); // 微信昵称
  }); // 结束用例

  it('区域不匹配（global 区选微信）返回 400', async () => { // 区域隔离
    const res = await authorize('wechat', 'global'); // 海外区选微信
    expect(res.status).toBe(400); // 参数错误
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 统一码
  }); // 结束用例
}); // describe 结束

describe('绑定与解绑', () => { // 账号安全规则
  it('同一第三方身份绑定到第二个账号时 409', async () => { // 防抢占
    const first = await request(app).post('/api/v1/auth/register').send({ region: 'cn', identifier: '13900000020', password: 'mim-pass-123' }); // 账号 A
    const authBind = await authorize('github', 'global', 'bind', first.body.access_token as string); // A 发起绑定
    const callback = await request(app).get('/api/v1/auth/oauth/github/callback').query({ code: 'c', state: authBind.body.state }); // A 完成绑定
    expect(new URL(callback.headers.location as string).searchParams.get('oauth_bound')).toBe('github'); // 绑定成功标记
    const second = await request(app).post('/api/v1/auth/register').send({ region: 'cn', identifier: '13900000021', password: 'mim-pass-123' }); // 账号 B
    const authBind2 = await authorize('github', 'global', 'bind', second.body.access_token as string); // B 尝试绑同一身份
    const callback2 = await request(app).get('/api/v1/auth/oauth/github/callback').query({ code: 'c2', state: authBind2.body.state }); // 回调
    expect(new URL(callback2.headers.location as string).searchParams.get('oauth_error')).toBe('AUTH_OAUTH_ALREADY_BOUND'); // 409 语义
  }); // 结束用例

  it('最后一个登录方式不允许解绑', async () => { // 防锁死
    const auth = await authorize('github', 'global'); // 纯 OAuth 建号（无口令）
    const callback = await request(app).get('/api/v1/auth/oauth/github/callback').query({ code: 'c', state: auth.body.state }); // 回调
    const ticket = new URL(callback.headers.location as string).searchParams.get('oauth_ticket') as string; // 票据
    const session = await request(app).post('/api/v1/auth/oauth/exchange').send({ ticket }); // 兑换
    const unlink = await request(app).delete('/api/v1/me/oauth/github').set('Authorization', `Bearer ${session.body.access_token}`); // 解绑唯一方式
    expect(unlink.status).toBe(409); // 拒绝
    expect(unlink.body.code).toBe('AUTH_OAUTH_LAST_METHOD'); // 专用错误码
  }); // 结束用例
}); // describe 结束
