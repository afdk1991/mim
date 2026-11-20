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

  it('存在账号口令凭据后 password 变为可用', async () => { // 有口令场景
    await register('13900000006', 'mim-pass-789'); // 先建立一个带口令的账号
    const res = await request(app).get('/api/v1/auth/channels'); // 查询能力
    expect(res.body.password).toBe(true); // 账号口令入口点亮
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

  it('未注册标识一律 401 AUTH_PASSWORD_INVALID，不再有 503 配置态', async () => { // 无任何凭据
    const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000005', password: 'any-pass' }); // 未注册标识
    expect(res.status).toBe(401); // 统一按认证失败处理
    expect(res.body.code).toBe('AUTH_PASSWORD_INVALID'); // 不回显账号是否存在
  }); // 结束用例

  it('环境变量 MIM_AUTH_ADMIN_PASSWORD 不再生效（只剩账号口令一条路径）', async () => { // 口令收敛
    await register('13900000007', 'mim-pass-789'); // 先建立真实账号
    const appWithEnvPassword = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: 'admin-secret', MIM_AUTH_ADMIN_IDENTIFIERS: 'cn:13900000007' } }); // 旧的白名单 + 环境口令
    const envPw = await request(appWithEnvPassword).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000007', password: 'admin-secret' }); // 用旧环境口令
    expect(envPw.status).toBe(401); // 已不再被接受
    expect(envPw.body.code).toBe('AUTH_PASSWORD_INVALID'); // 与普通口令错误同码
    const accountPw = await request(appWithEnvPassword).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000007', password: 'mim-pass-789' }); // 账号自身口令
    expect(accountPw.status).toBe(200); // 唯一有效路径
    expect(accountPw.body.user.region).toBe('cn'); // 用户按请求区域返回
  }); // 结束用例

  it('不存在的标识：一律失败且不建号', async () => { // 口令不具备自动建号能力
    const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13900000009', password: 'admin-secret' }); // 不存在的标识
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
    const ipApp = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 失败路径本身即 401，无需额外口令配置
    for (let i = 0; i < LOGIN_IP_LOCK_AFTER_FAILURES; i += 1) { // 每次换一个从未存在的标识，避免触发标识维度锁定
      const bad = await request(ipApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: `1391000${String(i).padStart(4, '0')}`, password: 'wrong-pass' });
      expect(bad.status).toBe(401); // 单次失败仍是 401
    } // 循环结束
    const locked = await request(ipApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13919999999', password: 'wrong-pass' }); // 全新标识、同一 IP
    expect(locked.status).toBe(423); // IP 维度锁定生效
    expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED'); // 明确锁定错误码
  }); // 结束用例
}); // describe 结束

describe('用户名（username）身份登录', () => { // 既有账号绑定用户名后的口令登录通道
  const EMAIL_IDENTIFIER = 'admin-bootstrap@laal.top'; // 种子邮箱身份：模拟生产管理员的旧邮箱通道
  const USERNAME = 'administrator'; // 归一化后的小写用户名（库内形态）
  const PASSWORD = 'mim-pass-456'; // 测试口令：含字母与数字，满足强度校验

  /** 在内存库中落一个 global 邮箱账号（含口令凭据），返回用户 ID，供绑定用户名用 */
  async function seedGlobalUser(): Promise<string> {
    const res = await request(app) // 注册 global 邮箱账号
      .post('/api/v1/auth/register') // 自助注册端点
      .send({ region: 'global', identifier: EMAIL_IDENTIFIER, password: PASSWORD, display_name: 'Administrator', device: { platform: 'admin', name: 'test' } }); // 完整请求体
    expect(res.status).toBe(201); // 注册成功即下发会话
    return res.body.user.id as string; // 交回用户 ID，供直写身份绑定
  } // seedGlobalUser 结束

  /** 直写一条 username 身份绑定到指定用户（等价于后台/库内为既有账号绑用户名，注册通道不开放此 provider） */
  function bindUsername(userId: string, username: string): void {
    db.prepare('INSERT INTO identities (id, user_id, region, provider, identifier, created_at) VALUES (?, ?, ?, ?, ?, ?)') // 唯一三元组
      .run(crypto.randomUUID(), userId, 'global', 'username', username, new Date().toISOString()); // 绑定到既有账号，不新建用户
  } // bindUsername 结束

  it('绑定用户名后可直接用用户名 + 口令登录成功', async () => { // 正常路径：管理员用户名登录
    const userId = await seedGlobalUser(); // 先建邮箱账号
    bindUsername(userId, USERNAME); // 再为该账号绑定用户名
    const ok = await request(app).post('/api/v1/auth/password').send({ region: 'global', identifier: 'Administrator', password: PASSWORD }); // 输入首字母大写形态
    expect(ok.status).toBe(200); // 登录成功
    expect(ok.body.user.id).toBe(userId); // 落到同一账号，不另建号
  }); // 结束用例

  it('用户名大小写不敏感：ADMINISTRATOR / Administrator / administrator 命中同一身份', async () => { // 归一化校验
    const userId = await seedGlobalUser(); // 先建账号并绑用户名
    bindUsername(userId, USERNAME);
    for (const variant of ['ADMINISTRATOR', 'Administrator', 'administrator']) { // 三种大小写形态逐一登录
      const ok = await request(app).post('/api/v1/auth/password').send({ region: 'global', identifier: variant, password: PASSWORD });
      expect(ok.status).toBe(200); // 均应命中
      expect(ok.body.user.id).toBe(userId); // 归属同一用户
    } // 形态循环结束
  }); // 结束用例

  it('不存在的用户名一律 401 AUTH_PASSWORD_INVALID，不建号', async () => { // 标识枚举防护
    const res = await request(app).post('/api/v1/auth/password').send({ region: 'global', identifier: 'nosuchuser', password: 'any-pass-1' }); // 未绑定用户名
    expect(res.status).toBe(401); // 与口令错误同码
    expect(res.body.code).toBe('AUTH_PASSWORD_INVALID'); // 不回显账号是否存在
    const row = db.prepare('SELECT COUNT(*) AS n FROM identities WHERE provider = ? AND identifier = ?').get('username', 'nosuchuser') as { n: number }; // 核查未偷偷建号
    expect(row.n).toBe(0); // 登录路径绝不自动注册用户名身份
  }); // 结束用例

  it('原邮箱身份仍可登录；已更名作废的旧标识登录 401', async () => { // 旧身份可逆更名后的行为
    const userId = await seedGlobalUser(); // 建账号（邮箱 + 口令）
    bindUsername(userId, USERNAME); // 同时绑用户名
    const emailOk = await request(app).post('/api/v1/auth/password').send({ region: 'global', identifier: EMAIL_IDENTIFIER, password: PASSWORD }); // 原邮箱仍可登
    expect(emailOk.status).toBe(200); // 邮箱通道未被用户名绑定破坏
    db.prepare("UPDATE identities SET identifier = ? WHERE user_id = ? AND provider = 'email'") // 模拟生产可逆更名：旧邮箱改为 retired 形态
      .run('admin-bootstrap+retired@laal.top', userId); // 不删行，仅更名使旧标识失效
    const retired = await request(app).post('/api/v1/auth/password').send({ region: 'global', identifier: EMAIL_IDENTIFIER, password: PASSWORD }); // 用旧标识再登
    expect(retired.status).toBe(401); // 旧标识已不能命中
    const usernameStillOk = await request(app).post('/api/v1/auth/password').send({ region: 'global', identifier: 'Administrator', password: PASSWORD }); // 用户名通道不受更名影响
    expect(usernameStillOk.status).toBe(200); // 管理员仍可经用户名进入
  }); // 结束用例

  it('非法用户名（过短 / 含非法字符）返回 400 VALIDATION_FAILED', async () => { // 格式校验
    for (const bad of ['ab', 'bad name', 'bad@name', '管理员']) { // 过短、含空格、含 @、纯中文四类非法形态
      const res = await request(app).post('/api/v1/auth/password').send({ region: 'global', identifier: bad, password: 'any-pass-1' });
      expect(res.status).toBe(400); // 参数错误
      expect(res.body.code).toBe('VALIDATION_FAILED'); // 统一校验错误码
      expect(res.body.details.field).toBe('identifier'); // 指明出错字段
    } // 非法形态循环结束
  }); // 结束用例

  it('自助注册不开放 username 通道：显式 provider=username 被 400 拒绝', async () => { // 注册侧收敛：用户名只能由既有账号绑定
    const res = await request(app).post('/api/v1/auth/register').send({ region: 'global', provider: 'username', identifier: 'newname', password: 'mim-pass-123' });
    expect(res.status).toBe(400); // zod 枚举直接拦截
    const row = db.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider = 'username'").get() as { n: number }; // 核查注册路径未写入任何用户名身份
    expect(row.n).toBe(0); // 用户名身份只能经后台/库内绑定产生
  }); // 结束用例
}); // describe 结束
