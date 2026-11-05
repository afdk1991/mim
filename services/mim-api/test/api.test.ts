/** 契约测试：覆盖健康检查 / FR-01 账号身份 / 幂等中间件 / 生产安全开关（内存库，独立时钟不作注入） */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

let app: Express;
let db: ReturnType<typeof createDatabase>;
let keyCounter = 0;

function nextKey(): string {
  keyCounter += 1;
  return `test-key-${keyCounter}`;
}

interface Session {
  token: string;
  userId: string;
}

async function login(identifier: string, provider: 'phone' | 'email' = 'phone', region: 'cn' | 'global' = 'cn'): Promise<Session> {
  const codeRes = await request(app)
    .post('/api/v1/auth/code')
    .send({ region, provider, identifier });
  expect(codeRes.status).toBe(201);

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ region, provider, identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } });
  expect(loginRes.status).toBe(200);
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string };
}

function auth(session: Session, key?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  if (key) headers['idempotency-key'] = key;
  return headers;
}

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} });
  keyCounter = 0;
});

describe('公开能力', () => {
  it('健康检查', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.service).toBe('mim-api');
  });

  it('非法 JSON 请求体返回 400 VALIDATION_FAILED，而不是 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/code')
      .set('content-type', 'application/json')
      .send('{"region":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('已下线与未知路径返回 404，不被受保护 router 的鉴权拦成 401', async () => {
    for (const path of ['/api/v1/plans', '/api/v1/audit/logs', '/api/v1/not-exist']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });
});

describe('FR-01 账号身份', () => {
  it('验证码登录、刷新轮换与登出', async () => {
    const session = await login('13800000001');
    const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier: '13800000001' });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ region: 'cn', provider: 'phone', identifier: '13800000001', code: codeRes.body.dev_code });
    expect(loginRes.body.user.region).toBe('cn');

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: loginRes.body.refresh_token });
    expect(refresh.status).toBe(200);
    expect(refresh.body.refresh_token).not.toBe(loginRes.body.refresh_token);

    const me = await request(app).get('/api/v1/me').set(auth(session));
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(session.userId);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set(auth(session))
      .send({ refresh_token: refresh.body.refresh_token });
    expect(logout.status).toBe(200);

    const reused = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh.body.refresh_token });
    expect(reused.status).toBe(401);
  });

  it('cn 区仅接受手机号：邮箱标识被拒绝', async () => {
    const res = await request(app)
      .post('/api/v1/auth/code')
      .send({ region: 'cn', provider: 'email', identifier: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('未携带令牌访问受保护接口返回 401', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
  });
});

describe('写操作幂等', () => {
  it('幂等键回放返回首次结果，复用不同请求体返回 409', async () => {
    const session = await login('13800000013');
    const key = 'replay-key';
    const body = { display_name: '幂等用户' };

    const first = await request(app)
      .patch('/api/v1/me')
      .set(auth(session, key))
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.user.display_name).toBe('幂等用户');

    const replay = await request(app)
      .patch('/api/v1/me')
      .set(auth(session, key))
      .send(body);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const conflict = await request(app)
      .patch('/api/v1/me')
      .set(auth(session, key))
      .send({ display_name: '另一个名字' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('写操作缺少 Idempotency-Key 被拒', async () => {
    const session = await login('13800000005');
    const res = await request(app)
      .patch('/api/v1/me')
      .set(auth(session))
      .send({ display_name: '无键用户' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('region 隔离：同标识在不同 region 视为不同账号', async () => {
    const cn = await login('user@example.com', 'phone', 'cn').catch(() => null);
    expect(cn).toBeNull();
    const global = await login('user@example.com', 'email', 'global');
    const me = await request(app).get('/api/v1/me').set(auth(global));
    expect(me.body.user.region).toBe('global');
    expect(me.body.user.locale).toBe('en-US');
  });
});

describe('账号注销与撤销', () => {
  it('注销后进入待删除态，撤销后恢复 active', async () => {
    const session = await login('13800000040');

    const deletion = await request(app)
      .post('/api/v1/me/deletion')
      .set(auth(session, nextKey()))
      .send({});
    expect(deletion.status).toBe(200);
    expect(deletion.body.status).toBe('pending_deletion');
    expect(deletion.body.deletion_scheduled_at).toBeTruthy();

    const me = await request(app).get('/api/v1/me').set(auth(session));
    expect(me.body.user.status).toBe('pending_deletion');

    const cancel = await request(app)
      .post('/api/v1/me/cancel-deletion')
      .set(auth(session, nextKey()))
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('active');
  });
});

describe('生产安全开关', () => {
  it('生产环境拒绝直发验证码：503 AUTH_CHANNEL_NOT_CONFIGURED 且无 dev_code', async () => {
    const prodApp = createApp({
      db: createDatabase(':memory:'),
      jwtSecret: JWT_SECRET,
      env: { NODE_ENV: 'production' },
    });
    const res = await request(prodApp)
      .post('/api/v1/auth/code')
      .send({ region: 'cn', provider: 'phone', identifier: '13800000032' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUTH_CHANNEL_NOT_CONFIGURED');
    expect(res.body.dev_code).toBeUndefined();
  });
});
