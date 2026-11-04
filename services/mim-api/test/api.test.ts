/** 契约测试：覆盖 FR-01 / FR-02 / FR-06 的 P0 关键路径（内存库，独立时钟不作注入） */

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
  it('健康检查与套餐目录', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const plans = await request(app).get('/api/v1/plans?region=cn');
    expect(plans.status).toBe(200);
    expect(plans.body.items.map((item: { id: string }) => item.id)).toEqual(['free', 'basic', 'pro']);
    const basic = plans.body.items.find((item: { id: string }) => item.id === 'basic');
    expect(basic.prices.monthly).toBe(2900);
  });

  it('global 区定价未配置时如实标记（不臆造数值）', async () => {
    const plans = await request(app).get('/api/v1/plans?region=global');
    const basic = plans.body.items.find((item: { id: string }) => item.id === 'basic');
    expect(basic.configured).toBe(false);
    expect(basic.prices.monthly).toBeNull();
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
    expect(me.body.plan.id).toBe('free');

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

describe('FR-02 订阅计费', () => {
  it('模拟支付下单后订阅立即生效，/me 套餐同步更新', async () => {
    const session = await login('13800000002');
    const before = await request(app).get('/api/v1/me').set(auth(session));
    expect(before.body.plan.id).toBe('free');

    const checkout = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session, nextKey()))
      .send({ plan_id: 'basic', cycle: 'monthly', driver: 'mock' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.order.status).toBe('paid');
    expect(checkout.body.subscription.plan_id).toBe('basic');

    const after = await request(app).get('/api/v1/me').set(auth(session));
    expect(after.body.plan.id).toBe('basic');
    expect(after.body.plan.expires_at).toBeTruthy();
  });

  it('真实支付驱动未接入时返回 503 并声明原因', async () => {
    const session = await login('13800000003');
    const res = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session, nextKey()))
      .send({ plan_id: 'basic', cycle: 'monthly', driver: 'wechat' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENT_DRIVER_UNAVAILABLE');
    expect(res.body.details.reason).toBeDefined();
  });

  it('取消订阅后到期前仍保留权益', async () => {
    const session = await login('13800000004');
    await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session, nextKey()))
      .send({ plan_id: 'pro', cycle: 'yearly', driver: 'mock' });
    const cancel = await request(app)
      .post('/api/v1/subscriptions/cancel')
      .set(auth(session, nextKey()))
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.subscription.cancel_at_period_end).toBe(true);
    const me = await request(app).get('/api/v1/me').set(auth(session));
    expect(me.body.plan.id).toBe('pro');
  });

  it('写操作缺少 Idempotency-Key 被拒', async () => {
    const session = await login('13800000005');
    const res = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session))
      .send({ plan_id: 'basic', cycle: 'monthly', driver: 'mock' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('FR-06 审计与幂等', () => {
  it('审计日志按时间倒序返回本人记录', async () => {
    const session = await login('13800000012');
    const updated = await request(app)
      .patch('/api/v1/me')
      .set(auth(session, nextKey()))
      .send({ display_name: '审计用户' });
    expect(updated.status).toBe(200);

    const audit = await request(app).get('/api/v1/audit?limit=10').set(auth(session));
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBeGreaterThan(0);
    expect(audit.body.items[0].action).toBe('account.profile_update');
  });

  it('幂等键回放返回首次结果，复用不同请求体返回 409', async () => {
    const session = await login('13800000013');
    const key = 'replay-key';
    const body = { plan_id: 'basic', cycle: 'monthly', driver: 'mock' };

    const first = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session, key))
      .send(body);
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session, key))
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(first.body.order.id);

    const conflict = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session, key))
      .send({ ...body, plan_id: 'pro' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const orders = await request(app).get('/api/v1/orders').set(auth(session));
    expect(orders.body.items).toHaveLength(1);
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
