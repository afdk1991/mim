/** 安全加固包测试：验证码强制开启回归（image / slider / off，真实应用 + 环境变量驱动） */

import { beforeEach, describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // 引入依赖、类型或本地模块绑定
import { createHash } from 'node:crypto'; // 引入依赖、类型或本地模块绑定
import type { Express } from 'express'; // 引入依赖、类型或本地模块绑定
import { createApp } from '../src/app.js'; // 引入依赖、类型或本地模块绑定
import { createDatabase } from '../src/db.js'; // 引入依赖、类型或本地模块绑定
import { createCaptcha, captchaHash, verifyCaptcha } from '../src/security.js'; // 引入依赖、类型或本地模块绑定
import type { Db } from '../src/types.js'; // 引入依赖、类型或本地模块绑定

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥

let db: Db; // 可变变量 db：运行过程中会被重新赋值

beforeEach(() => { // 调用 beforeEach 并处理其返回结果
  db = createDatabase(':memory:'); // 每例全新内存库，题目与计数互不串扰
}); // 代码块结束

function makeApp(env: Record<string, string | undefined>): Express { // 函数 makeApp：封装一段可复用的处理逻辑
  return createApp({ db, jwtSecret: JWT_SECRET, env }); // 返回当前函数的处理结果
} // 代码块结束

/** 预置一道 image 题目：返回可直接提交的 id / code（答案只以摘要落库） */
function seedImageCaptcha(): { captcha_id: string; captcha_code: string } {
  const c = createCaptcha(); // 常量 c：保存固定配置或一次性派生值
  db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run( // 执行当前业务步骤
    c.id, // 执行当前业务步骤
    captchaHash(c.answer), // 调用 captchaHash 并处理其返回结果
    new Date(Date.now() + 600_000).toISOString(), // 执行当前业务步骤
    new Date().toISOString(), // 执行当前业务步骤
  ); // 执行当前业务步骤
  return { captcha_id: c.id, captcha_code: c.answer }; // 返回当前函数的处理结果
} // 代码块结束

/** 预置一道 slider 题目：目标 x 只存 sha256 摘要，返回题目 id */
function seedSliderCaptcha(expectedX: number): string {
  const id = `slider-test-${expectedX}-${Math.random().toString(36).slice(2)}`; // 常量 id：保存固定配置或一次性派生值
  db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run( // 执行当前业务步骤
    id, // 执行当前业务步骤
    createHash('sha256').update(String(expectedX)).digest('hex'), // 调用 createHash 并处理其返回结果
    new Date(Date.now() + 600_000).toISOString(), // 执行当前业务步骤
    new Date().toISOString(), // 执行当前业务步骤
  ); // 执行当前业务步骤
  return id; // 返回当前函数的处理结果
} // 代码块结束

const REGISTER_BODY = { region: 'cn', provider: 'phone', identifier: '13900000071', password: 'abc12345' }; // 常量 REGISTER_BODY：保存固定配置或一次性派生值
const LOGIN_BODY = { region: 'cn', provider: 'phone', identifier: '13900000071', code: '123456' }; // 常量 LOGIN_BODY：保存固定配置或一次性派生值

describe('image 模式 + 全场景强制（MIM_CAPTCHA_REQUIRED=1）', () => { // 调用 describe 并处理其返回结果
  const env: Record<string, string> = { MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_REQUIRED: '1' }; // 常量 env：保存固定配置或一次性派生值

  it('注册/登录缺验证码 → 400 AUTH_CODE_INVALID', async () => { // 调用 it 并处理其返回结果
    const app = makeApp(env); // 常量 app：保存固定配置或一次性派生值
    const register = await request(app).post('/api/v1/auth/register').send(REGISTER_BODY); // 常量 register：保存固定配置或一次性派生值
    expect(register.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(register.body.code).toBe('AUTH_CODE_INVALID'); // 调用 expect 并处理其返回结果
    const login = await request(app).post('/api/v1/auth/login').send(LOGIN_BODY); // 常量 login：保存固定配置或一次性派生值
    expect(login.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(login.body.code).toBe('AUTH_CODE_INVALID'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('带有效一次性码注册成功；同一码二次使用被拒绝（防重放）', async () => { // 调用 it 并处理其返回结果
    const app = makeApp(env); // 常量 app：保存固定配置或一次性派生值
    const captcha = seedImageCaptcha(); // 常量 captcha：保存固定配置或一次性派生值

    const first = await request(app).post('/api/v1/auth/register').send({ ...REGISTER_BODY, ...captcha }); // 常量 first：保存固定配置或一次性派生值
    expect(first.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(first.body.access_token).toBeTypeOf('string'); // 调用 expect 并处理其返回结果

    const reused = await request(app) // 常量 reused：保存固定配置或一次性派生值
      .post('/api/v1/auth/register') // 注册 POST 路由 / 中间件处理器
      .send({ ...REGISTER_BODY, identifier: '13900000072', ...captcha }); // 执行当前业务步骤
    expect(reused.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(reused.body.code).toBe('AUTH_CODE_INVALID'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('/security/status 如实回显 mode / required_scenes / providers', async () => { // 调用 it 并处理其返回结果
    const app = makeApp(env); // 常量 app：保存固定配置或一次性派生值
    const res = await request(app).get('/api/v1/security/status'); // 常量 res：保存固定配置或一次性派生值
    expect(res.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.mode).toBe('image'); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.required_scenes).toEqual(['register', 'login', 'report', 'post']); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.providers.image).toBe(true); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.providers.slider).toBe(true); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.providers.tencent).toBe(false); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.providers.geetest4).toBe(false); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('slider 模式 + login 场景强制', () => { // 调用 describe 并处理其返回结果
  const env: Record<string, string> = { MIM_CAPTCHA_MODE: 'slider', MIM_CAPTCHA_LOGIN: '1' }; // 常量 env：保存固定配置或一次性派生值

  it('登录缺滑动票据 → 400 AUTH_CODE_INVALID', async () => { // 调用 it 并处理其返回结果
    const app = makeApp(env); // 常量 app：保存固定配置或一次性派生值
    const res = await request(app).post('/api/v1/auth/login').send(LOGIN_BODY); // 常量 res：保存固定配置或一次性派生值
    expect(res.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(res.body.code).toBe('AUTH_CODE_INVALID'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('容差内滑动通过一次；超容差失败；消费后不可重用', async () => { // 调用 it 并处理其返回结果
    const okId = seedSliderCaptcha(120); // 常量 okId：保存固定配置或一次性派生值
    await expect(verifyCaptcha(db, env, 'login', { captcha_id: okId, slider_x: 125 })).resolves.toBeUndefined(); // 异步等待：挂起至 Promise 落定后再继续
    await expect(verifyCaptcha(db, env, 'login', { captcha_id: okId, slider_x: 125 })).rejects.toMatchObject({ code: 'AUTH_CODE_INVALID' }); // 异步等待：挂起至 Promise 落定后再继续

    const outsideId = seedSliderCaptcha(121); // 常量 outsideId：保存固定配置或一次性派生值
    await expect(verifyCaptcha(db, env, 'login', { captcha_id: outsideId, slider_x: 220 })).rejects.toMatchObject({ code: 'AUTH_CODE_INVALID' }); // 异步等待：挂起至 Promise 落定后再继续
  }); // 代码块结束

  it('/security/status 回显 mode=slider，仅 login 场景强制，providers.slider=true', async () => { // 调用 it 并处理其返回结果
    const app = makeApp(env); // 常量 app：保存固定配置或一次性派生值
    const res = await request(app).get('/api/v1/security/status'); // 常量 res：保存固定配置或一次性派生值
    expect(res.body.captcha.mode).toBe('slider'); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.required_scenes).toEqual(['login']); // 调用 expect 并处理其返回结果
    expect(res.body.captcha.providers.slider).toBe(true); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('off 模式：零拦截，不回归 0.0.9 现网行为', () => { // 调用 describe 并处理其返回结果
  it('注册不带验证码直接成功；status 回显 mode=off、required_scenes 为空', async () => { // 调用 it 并处理其返回结果
    const app = makeApp({}); // 常量 app：保存固定配置或一次性派生值
    const register = await request(app).post('/api/v1/auth/register').send(REGISTER_BODY); // 常量 register：保存固定配置或一次性派生值
    expect(register.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(register.body.access_token).toBeTypeOf('string'); // 调用 expect 并处理其返回结果

    const status = await request(app).get('/api/v1/security/status'); // 常量 status：保存固定配置或一次性派生值
    expect(status.body.captcha.mode).toBe('off'); // 调用 expect 并处理其返回结果
    expect(status.body.captcha.required_scenes).toEqual([]); // 调用 expect 并处理其返回结果
    expect(status.body.captcha_required).toBe(false); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束
