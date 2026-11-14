/** 契约测试：自助账号注册 / 账号口令登录 / 登录通道可用性（内存库，独立应用实例） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排 API：每例重建内存库，保证用例隔离
import request from 'supertest'; // supertest 在进程内驱动 Express，无需真实端口
import type { Express } from 'express'; // Express 类型，用于标注被测应用
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 建库函数，:memory: 保证每例干净
import { LOGIN_IP_LOCK_AFTER_FAILURES } from '../src/config.js'; // IP 维度阈值，避免测试硬编码漂移

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，满足强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库句柄

beforeEach(() => { // 每例前置：全新内存库 + 全新应用，环境变量保持空（模拟未配置通道的部署）
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // env 为空即短信 / 邮件 / 管理员口令均未配置
}); // beforeEach 结束

/** 注册一个自建账号，返回令牌与用户视图，供后续登录 / 鉴权用例复用 */
async function register(identifier = '13900000001', password = 'mim-pass-123') {
  const res = await request(app) // 注册端点
    .post('/api/v1/auth/register') // 路由
    .send({ region: 'cn', identifier, password, display_name: '注册用户', device: { platform: 'web', name: 'test' } }); // 完整请求体
  return res; // 交回原始响应，调用方可断言状态码
} // register 结束

describe('登录通道可用性', () => { // 通道能力查询：前端据此隐藏不可用入口
  it('未配置任何通道时只有注册可用', async () => { // 空 env 场景
    const res = await request(app).get('/api/v1/auth/channels'); // 公开只读接口
    expect(res.status).toBe(200); // 恒可用
    expect(res.body).toEqual({ sms: false, email: false, password: false, register: true }); // 布尔能力清单
  }); // 结束用例

  it('配置管理员口令后 password 变为可用', async () => { // 有口令场景
    const appWithPassword = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: 'admin-secret' } }); // 注入口令
    const res = await request(appWithPassword).get('/api/v1/auth/channels'); // 查询能力
    expect(res.body.password).toBe(true); // 管理员口令入口点亮
    expect(res.body.sms).toBe(false); // 短信仍需真实凭证
  }); // 结束用例
}); // describe 结束

describe('自助注册', () => { // 账号 + 口令注册
  it('注册成功即返回会话与用户视图', async () => { // 正常路径
    const res = await register(); // 发起注册
    expect(res.status).toBe(201); // 新建资源用 201
    expect(res.body.access_token).toBeTypeOf('string'); // 直接下发访问令牌
    expect(res.body.refresh_token).toBeTypeOf('string'); // 刷新令牌同时下发
    expect(res.body.user.display_name).toBe('注册用户'); // 昵称按请求写入
    expect(res.body.user.region).toBe('cn'); // 区域随请求
  }); // 结束用例

  it('同一身份重复注册返回 409 AUTH_IDENTITY_EXISTS', async () => { // 唯一性冲突
    await register('13900000002'); // 先注册一次
    const again = await register('13900000002'); // 同标识再注册
    expect(again.status).toBe(409); // 409 让前端引导改用登录
    expect(again.body.code).toBe('AUTH_IDENTITY_EXISTS'); // 专用错误码
  }); // 结束用例

  it('口令过弱返回 400 VALIDATION_FAILED', async () => { // 强度校验
    const res = await request(app).post('/api/v1/auth/register').send({ region: 'cn', identifier: '13900000003', password: 'aaaaaaaa' }); // 纯字母无数字
    expect(res.status).toBe(400); // 参数错误
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 统一校验错误码
    expect(res.body.details.field).toBe('password'); // 明确指出字段
  }); // 结束用例
}); // describe 结束

describe('账号口令登录', () => { // 注册后可用账号 + 口令登录
  it('正确口令换取会话，错误口令 401', async () => { // 正常与失败路径
    await register('13900000004', 'mim-pass-456'); // 先注册
    const ok = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000004', password: 'mim-pass-456' }); // 正确口令
    expect(ok.status).toBe(200); // 登录成功
    expect(ok.body.user.id).toBeTypeOf('string'); // 返回用户视图
    const bad = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000004', password: 'wrong-pass' }); // 错误口令
    expect(bad.status).toBe(401); // 认证失败
    expect(bad.body.code).toBe('AUTH_PASSWORD_INVALID'); // 不回显口令线索
  }); // 结束用例

  it('既无管理员口令也无自建账号时返回 503 AUTH_PASSWORD_NOT_CONFIGURED', async () => { // 完全未配置
    const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000005', password: 'any-pass' }); // 未注册标识
    expect(res.status).toBe(503); // 服务不可用
    expect(res.body.code).toBe('AUTH_PASSWORD_NOT_CONFIGURED'); // 指向缺失的环境变量
  }); // 结束用例

  it('管理员口令只对白名单内、已存在的账号生效', async () => { // SEC-01：口令不再对任意标识生效
    await register('13900000007', 'mim-pass-789'); // 先建立真实账号
    const appWithPassword = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: 'admin-secret', MIM_AUTH_ADMIN_IDENTIFIERS: 'cn:13900000007' } }); // 口令 + 白名单
    const res = await request(appWithPassword).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000007', password: 'admin-secret' }); // 白名单内账号
    expect(res.status).toBe(200); // 允许登录
    expect(res.body.user.region).toBe('cn'); // 用户按请求区域返回
  }); // 结束用例

  it('白名单外的已存在账号，管理员口令一律 401', async () => { // SEC-01：口令不对任意账号标识成立
    await register('13900000008', 'mim-pass-789'); // 账号真实存在但不在白名单
    const appWithPassword = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: 'admin-secret', MIM_AUTH_ADMIN_IDENTIFIERS: 'cn:13900000099' } }); // 白名单只含其他标识
    const res = await request(appWithPassword).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000008', password: 'admin-secret' }); // 正确口令但非白名单
    expect(res.status).toBe(401); // 拒绝
    expect(res.body.code).toBe('AUTH_PASSWORD_INVALID'); // 统一错误码，不泄露配置细节
  }); // 结束用例

  it('不存在的标识：一律失败且不建号', async () => { // SEC-01：管理员口令不具备自动建号能力
    const appWithPassword = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: 'admin-secret', MIM_AUTH_ADMIN_IDENTIFIERS: 'cn:13900000009' } }); // 标识已列入白名单但未注册
    const res = await request(appWithPassword).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000009', password: 'admin-secret' }); // 正确口令 + 白名单
    expect(res.status).toBe(401); // 不存在标识必须失败
    expect(res.body.code).toBe('AUTH_PASSWORD_INVALID'); // 与口令错误同码，避免标识枚举
    const row = db.prepare('SELECT COUNT(*) AS n FROM identities WHERE identifier = ?').get('13900000009') as { n: number }; // 核查是否偷偷建号
    expect(row.n).toBe(0); // 绝不建号
  }); // 结束用例

  it('同一标识连续失败 5 次后锁定（423 AUTH_ACCOUNT_LOCKED）', async () => { // 标识维度失败计数
    await register('13900000010', 'mim-pass-789'); // 先建立账号
    for (let i = 0; i < 5; i += 1) { // 连续 5 次错误口令
      const bad = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000010', password: 'wrong-pass' });
      expect(bad.status).toBe(401); // 前 5 次均为认证失败
    } // 循环结束
    const locked = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000010', password: 'mim-pass-789' }); // 第 6 次即使口令正确
    expect(locked.status).toBe(423); // 也必须被锁定拦截
    expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED'); // 明确锁定错误码
  }); // 结束用例

  it('同一来源 IP 跨账号累计失败 20 次后锁定（423 AUTH_ACCOUNT_LOCKED）', async () => { // IP 维度失败计数
    const ipApp = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: 'admin-secret' } }); // 配置口令入口，确保失败路径返回 401
    for (let i = 0; i < LOGIN_IP_LOCK_AFTER_FAILURES; i += 1) { // 每次换一个从未存在的标识，避免触发标识维度锁定
      const bad = await request(ipApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: `1391000${String(i).padStart(4, '0')}`, password: 'wrong-pass' });
      expect(bad.status).toBe(401); // 单次失败仍是 401
    } // 循环结束
    const locked = await request(ipApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13919999999', password: 'wrong-pass' }); // 全新标识、同一 IP
    expect(locked.status).toBe(423); // IP 维度锁定生效
    expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED'); // 明确锁定错误码
  }); // 结束用例
}); // describe 结束
