/** 安全加固包测试：验证码强制开启回归（image / slider / off，真实应用 + 环境变量驱动） */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { createCaptcha, captchaHash, verifyCaptcha } from '../src/security.js';
import type { Db } from '../src/types.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥

let db: Db;

beforeEach(() => {
  db = createDatabase(':memory:'); // 每例全新内存库，题目与计数互不串扰
});

function makeApp(env: Record<string, string | undefined>): Express {
  return createApp({ db, jwtSecret: JWT_SECRET, env });
}

/** 预置一道 image 题目：返回可直接提交的 id / code（答案只以摘要落库） */
function seedImageCaptcha(): { captcha_id: string; captcha_code: string } {
  const c = createCaptcha();
  db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run(
    c.id,
    captchaHash(c.answer),
    new Date(Date.now() + 600_000).toISOString(),
    new Date().toISOString(),
  );
  return { captcha_id: c.id, captcha_code: c.answer };
}

/** 预置一道 slider 题目：目标 x 只存 sha256 摘要，返回题目 id */
function seedSliderCaptcha(expectedX: number): string {
  const id = `slider-test-${expectedX}-${Math.random().toString(36).slice(2)}`;
  db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run(
    id,
    createHash('sha256').update(String(expectedX)).digest('hex'),
    new Date(Date.now() + 600_000).toISOString(),
    new Date().toISOString(),
  );
  return id;
}

const REGISTER_BODY = { region: 'cn', provider: 'phone', identifier: '13900000071', password: 'abc12345' };
const LOGIN_BODY = { region: 'cn', provider: 'phone', identifier: '13900000071', code: '123456' };

describe('image 模式 + 全场景强制（MIM_CAPTCHA_REQUIRED=1）', () => {
  const env: Record<string, string> = { MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_REQUIRED: '1' };

  it('注册/登录缺验证码 → 400 AUTH_CODE_INVALID', async () => {
    const app = makeApp(env);
    const register = await request(app).post('/api/v1/auth/register').send(REGISTER_BODY);
    expect(register.status).toBe(400);
    expect(register.body.code).toBe('AUTH_CODE_INVALID');
    const login = await request(app).post('/api/v1/auth/login').send(LOGIN_BODY);
    expect(login.status).toBe(400);
    expect(login.body.code).toBe('AUTH_CODE_INVALID');
  });

  it('带有效一次性码注册成功；同一码二次使用被拒绝（防重放）', async () => {
    const app = makeApp(env);
    const captcha = seedImageCaptcha();

    const first = await request(app).post('/api/v1/auth/register').send({ ...REGISTER_BODY, ...captcha });
    expect(first.status).toBe(201);
    expect(first.body.access_token).toBeTypeOf('string');

    const reused = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...REGISTER_BODY, identifier: '13900000072', ...captcha });
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('AUTH_CODE_INVALID');
  });

  it('/security/status 如实回显 mode / required_scenes / providers', async () => {
    const app = makeApp(env);
    const res = await request(app).get('/api/v1/security/status');
    expect(res.status).toBe(200);
    expect(res.body.captcha.mode).toBe('image');
    expect(res.body.captcha.required_scenes).toEqual(['register', 'login', 'report', 'post']);
    expect(res.body.captcha.providers.image).toBe(true);
    expect(res.body.captcha.providers.slider).toBe(true);
    expect(res.body.captcha.providers.tencent).toBe(false);
    expect(res.body.captcha.providers.geetest4).toBe(false);
  });
});

describe('slider 模式 + login 场景强制', () => {
  const env: Record<string, string> = { MIM_CAPTCHA_MODE: 'slider', MIM_CAPTCHA_LOGIN: '1' };

  it('登录缺滑动票据 → 400 AUTH_CODE_INVALID', async () => {
    const app = makeApp(env);
    const res = await request(app).post('/api/v1/auth/login').send(LOGIN_BODY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTH_CODE_INVALID');
  });

  it('容差内滑动通过一次；超容差失败；消费后不可重用', async () => {
    const okId = seedSliderCaptcha(120);
    await expect(verifyCaptcha(db, env, 'login', { captcha_id: okId, slider_x: 125 })).resolves.toBeUndefined();
    await expect(verifyCaptcha(db, env, 'login', { captcha_id: okId, slider_x: 125 })).rejects.toMatchObject({ code: 'AUTH_CODE_INVALID' });

    const outsideId = seedSliderCaptcha(121);
    await expect(verifyCaptcha(db, env, 'login', { captcha_id: outsideId, slider_x: 220 })).rejects.toMatchObject({ code: 'AUTH_CODE_INVALID' });
  });

  it('/security/status 回显 mode=slider，仅 login 场景强制，providers.slider=true', async () => {
    const app = makeApp(env);
    const res = await request(app).get('/api/v1/security/status');
    expect(res.body.captcha.mode).toBe('slider');
    expect(res.body.captcha.required_scenes).toEqual(['login']);
    expect(res.body.captcha.providers.slider).toBe(true);
  });
});

describe('off 模式：零拦截，不回归 0.0.9 现网行为', () => {
  it('注册不带验证码直接成功；status 回显 mode=off、required_scenes 为空', async () => {
    const app = makeApp({});
    const register = await request(app).post('/api/v1/auth/register').send(REGISTER_BODY);
    expect(register.status).toBe(201);
    expect(register.body.access_token).toBeTypeOf('string');

    const status = await request(app).get('/api/v1/security/status');
    expect(status.body.captcha.mode).toBe('off');
    expect(status.body.captcha.required_scenes).toEqual([]);
    expect(status.body.captcha_required).toBe(false);
  });
});
