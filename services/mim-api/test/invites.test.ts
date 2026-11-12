/**
 * 邀请码测试：开关关闭放行 / 开启拦截、无效 / 过期 / 耗尽拒绝、并发核销不超发、
 * 统计正确；管理端点生成 / 批量生成 / 禁用 / 核销记录。
 */

import { beforeEach, describe, expect, it } from 'vitest'; // 用例编排
import express from 'express'; // 管理端 mini app
import type { Express } from 'express'; // 应用实例类型
import request from 'supertest'; // HTTP 断言
import { createApp } from '../src/app.js'; // 完整装配（注册 / 登录路径）
import { createDatabase } from '../src/db.js'; // 内存库
import { createInvite, getInviteByCode } from '../src/invitations.js'; // 数据层直造码
import { createInviteAdminRouter } from '../src/routes/invites.js'; // 管理路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import type { ApiDeps } from '../src/types.js'; // 依赖容器

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'invite-admin-token'; // 引导管理令牌
const NOW = '2026-11-13T08:00:00.000Z'; // 固定基准时间

/** 完整应用（注册 / 验证码登录路径走真实装配） */
function makeApp(env: Record<string, string | undefined>) { // 环境按用例注入
  const db = createDatabase(':memory:'); // 独立内存库
  const app = createApp({ db, jwtSecret: JWT_SECRET, env }); // 装配完整应用
  return { app, db }; // 交出应用与库句柄
} // makeApp 结束

/** 管理端 mini app（只挂邀请码管理路由） */
function makeAdminApp(deps: ApiDeps) { // 依赖显式注入
  const app = express(); // 独立实例
  app.use(express.json()); // 解析 JSON
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖
  app.use('/api/v1', createInviteAdminRouter(deps)); // 挂载管理路由
  app.use(errorHandler); // 统一错误处理
  return app; // 交出实例
} // makeAdminApp 结束

/** 注册请求：identifier 与 invite_code 可覆盖 */
async function register(app: Express, identifier: string, inviteCode?: string) { // 复用注册动作
  return request(app).post('/api/v1/auth/register').send({ // 注册端点
    region: 'cn', provider: 'phone', identifier, password: 'mim-pass-123', // 合法口令与手机号
    ...(inviteCode ? { invite_code: inviteCode } : {}), // 条件带上邀请码
  }); // 请求结束
} // register 结束

describe('邀请码管理端点', () => { // 管理维度
  let deps: ApiDeps; // 依赖容器
  let app: Express; // 管理应用

  beforeEach(() => { // 每例重建
    deps = { db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }; // 引导通道开启
    app = makeAdminApp(deps); // 挂载管理路由
  }); // beforeEach 结束

  it('批量生成 3 枚单次码；列表与统计回写正确；可禁用', async () => { // 生成 / 统计 / 禁用
    const created = await request(app).post('/api/v1/admin/invites').set('x-admin-token', ADMIN_TOKEN) // 准备：构造本用例需要的输入或句柄
      .send({ count: 3, max_uses: 1, note: '灰度邀请' }); // 批量生成
    expect(created.status).toBe(201); // 创建成功
    expect(created.body.invites).toHaveLength(3); // 三枚码
    const firstCode = created.body.invites[0].code as string; // 取第一枚

    const list = await request(app).get('/api/v1/admin/invites').set('x-admin-token', ADMIN_TOKEN); // 列表 + 统计
    expect(list.status).toBe(200); // 可读
    expect(list.body.stats).toEqual({ total: 3, active: 3, redemptions: 0 }); // 统计口径正确
    expect(list.body.invites).toHaveLength(3); // 三枚在册

    const disabled = await request(app).patch(`/api/v1/admin/invites/${firstCode}/disable`).set('x-admin-token', ADMIN_TOKEN); // 禁用首枚
    expect(disabled.status).toBe(200); // 禁用成功
    const row = getInviteByCode(deps.db, firstCode)!; // 回读行
    expect(row.status).toBe('disabled'); // 状态已禁用
  }); // 结束生成用例

  it('核销记录可按码查询；未带管理令牌访问被拒绝', async () => { // 核销记录 + 门禁
    const invite = createInvite(deps.db, { createdBy: null, maxUses: 1, expiresAt: null, boundIdentifier: null, note: null, code: 'TESTCODE1' }, NOW); // 直造一枚码
    const records = await request(app).get('/api/v1/admin/invites/redemptions').set('x-admin-token', ADMIN_TOKEN); // 核销记录
    expect(records.status).toBe(200); // 可读
    expect(records.body.redemptions).toHaveLength(0); // 尚无核销
    void invite; // 占位
    const denied = await request(app).get('/api/v1/admin/invites'); // 不带令牌
    expect(denied.status).toBe(401); // 未登录 / 未授权拒绝
  }); // 结束记录与门禁用例
}); // 结束管理端点 describe

describe('注册门槛：开关关闭（默认行为不变）', () => { // 默认放行
  it('MIM_REGISTER_INVITE_REQUIRED 未开启时，无邀请码注册照常成功', async () => { // 兼容已上线注册
    const { app } = makeApp({}); // 空环境：门槛默认关闭
    const res = await register(app, '13900001001'); // 不带邀请码
    expect(res.status).toBe(201); // 注册成功，行为与现状一致
  }); // 结束放行用例
}); // 结束关闭 describe

describe('注册门槛：开关开启', () => { // 拦截维度
  it('无邀请码注册返回 403 AUTH_INVITE_REQUIRED', async () => { // 缺码拦截
    const { app } = makeApp({ MIM_REGISTER_INVITE_REQUIRED: '1' }); // 门槛开启
    const res = await register(app, '13900002001'); // 不带码
    expect(res.status).toBe(403); // 拒绝注册
    expect(res.body.code).toBe('AUTH_INVITE_REQUIRED'); // 明确错误码
  }); // 结束缺码用例

  it('不存在的邀请码返回 400 AUTH_INVITE_INVALID', async () => { // 无效码
    const { app } = makeApp({ MIM_REGISTER_INVITE_REQUIRED: '1' }); // 门槛开启
    const res = await register(app, '13900002002', 'NOPE-999'); // 伪造码
    expect(res.status).toBe(400); // 参数错误
    expect(res.body.code).toBe('AUTH_INVITE_INVALID'); // 无效码
  }); // 结束无效码用例

  it('已过期的邀请码返回 400 AUTH_INVITE_EXPIRED', async () => { // 过期码
    const { app, db } = makeApp({ MIM_REGISTER_INVITE_REQUIRED: '1' }); // 门槛开启
    createInvite(db, { createdBy: null, maxUses: 1, expiresAt: '2020-01-01T00:00:00.000Z', boundIdentifier: null, note: null, code: 'OLDDUE88' }, NOW); // 过期码
    const res = await register(app, '13900002003', 'OLDDUE88'); // 持过期码注册
    expect(res.status).toBe(400); // 拒绝
    expect(res.body.code).toBe('AUTH_INVITE_EXPIRED'); // 过期单独错误码
  }); // 结束过期用例

  it('单次码核销一次后，第二次注册返回 400 AUTH_INVITE_INVALID（耗尽）', async () => { // 次数耗尽
    const { app, db } = makeApp({ MIM_REGISTER_INVITE_REQUIRED: '1' }); // 门槛开启
    createInvite(db, { createdBy: null, maxUses: 1, expiresAt: null, boundIdentifier: null, note: null, code: 'ONCE-001' }, NOW); // 单次码
    const first = await register(app, '13900002004', 'ONCE-001'); // 首次核销
    expect(first.status).toBe(201); // 注册成功
    const second = await register(app, '13900002005', 'ONCE-001'); // 二次使用
    expect(second.status).toBe(400); // 耗尽拒绝
    expect(second.body.code).toBe('AUTH_INVITE_INVALID'); // 耗尽归无效码
  }); // 结束耗尽用例

  it('并发 5 次注册争抢 2 次码：恰好 2 个成功，计数与核销记录不超发', async () => { // 并发不超发
    const { app, db } = makeApp({ MIM_REGISTER_INVITE_REQUIRED: '1' }); // 门槛开启
    createInvite(db, { createdBy: null, maxUses: 2, expiresAt: null, boundIdentifier: null, note: null, code: 'TWO-USE' }, NOW); // 两次码
    const results = await Promise.all( // 并发发起 5 次注册
      Array.from({ length: 5 }, (_, index) => register(app, `1390000300${index}`, 'TWO-USE')), // 唯一标识 + 同一码
    ); // Promise.all 结束
    const succeeded = results.filter((res) => res.status === 201); // 成功集合
    const rejected = results.filter((res) => res.status === 400); // 被拒集合
    expect(succeeded).toHaveLength(2); // 恰好两次成功
    expect(rejected).toHaveLength(3); // 三次被拒
    const row = getInviteByCode(db, 'TWO-USE')!; // 回读码行
    expect(row.used_count).toBe(2); // 计数不超发
    expect(row.status).toBe('exhausted'); // 自动置耗尽
    const redemptions = db.prepare('SELECT COUNT(*) AS n FROM invitation_redemptions').get() as { n: number }; // 核销记录数
    expect(redemptions.n).toBe(2); // 核销记录与成功数一致
  }); // 结束并发用例

  it('验证码首登建号：无码 403；持有效码完成首登注册', async () => { // 首登路径
    const { app, db } = makeApp({ MIM_REGISTER_INVITE_REQUIRED: '1' }); // 门槛开启
    createInvite(db, { createdBy: null, maxUses: 1, expiresAt: null, boundIdentifier: null, note: null, code: 'FIRST-01' }, NOW); // 有效码

    const deniedCode = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier: '13900004001' }); // 申请验证码
    const deniedLogin = await request(app).post('/api/v1/auth/login').send({ region: 'cn', provider: 'phone', identifier: '13900004001', code: deniedCode.body.dev_code }); // 无码首登
    expect(deniedLogin.status).toBe(403); // 首登缺码拒绝
    expect(deniedLogin.body.code).toBe('AUTH_INVITE_REQUIRED'); // 明确错误码

    const okCode = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier: '13900004002' }); // 申请验证码
    const okLogin = await request(app).post('/api/v1/auth/login').send({ region: 'cn', provider: 'phone', identifier: '13900004002', code: okCode.body.dev_code, invite_code: 'FIRST-01' }); // 持码首登
    expect(okLogin.status).toBe(200); // 首登注册成功并拿到会话
    const row = getInviteByCode(db, 'FIRST-01')!; // 回读码行
    expect(row.used_count).toBe(1); // 已核销一次
  }); // 结束首登用例
}); // 结束开启 describe
