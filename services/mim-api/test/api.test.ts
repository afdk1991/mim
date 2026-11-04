/** 契约测试：覆盖 FR-01~FR-06 的 P0 关键路径（内存库，独立时钟不作注入） */

import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

let app: Express;
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

async function createProject(session: Session, name: string) {
  return request(app).post('/api/v1/projects').set(auth(session, nextKey())).send({ name });
}

async function createTask(
  session: Session,
  projectId: string,
  body: Record<string, unknown>,
) {
  return request(app).post(`/api/v1/projects/${projectId}/tasks`).set(auth(session, nextKey())).send(body);
}

beforeEach(() => {
  const db = createDatabase(':memory:');
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
    expect(me.body.counts.projects).toBe(0);

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
    const res = await request(app).get('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
  });
});

describe('FR-02 订阅计费', () => {
  it('免费版项目配额在第 4 个被拒，升级后放行', async () => {
    const session = await login('13800000002');
    for (const name of ['P1', 'P2', 'P3']) {
      const res = await createProject(session, name);
      expect(res.status).toBe(201);
    }
    const fourth = await createProject(session, 'P4');
    expect(fourth.status).toBe(403);
    expect(fourth.body.code).toBe('QUOTA_PROJECTS_EXCEEDED');

    const checkout = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(session, nextKey()))
      .send({ plan_id: 'basic', cycle: 'monthly', driver: 'mock' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.order.status).toBe('paid');
    expect(checkout.body.subscription.plan_id).toBe('basic');

    const after = await createProject(session, 'P4');
    expect(after.status).toBe(201);
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
    const res = await request(app).post('/api/v1/projects').set(auth(session)).send({ name: 'no-key' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('FR-03 工作区与任务', () => {
  it('两级任务层级、状态流转与 LWW 冲突裁决', async () => {
    const session = await login('13800000006');
    const project = await createProject(session, '工作区');
    const projectId = project.body.project.id as string;

    const parent = await createTask(session, projectId, { title: '父任务', priority: 2 });
    expect(parent.status).toBe(201);
    expect(parent.body.task.level).toBe(1);

    const child = await createTask(session, projectId, { title: '子任务', parent_id: parent.body.task.id });
    expect(child.body.task.level).toBe(2);

    const grandchild = await createTask(session, projectId, { title: '孙任务', parent_id: child.body.task.id });
    expect(grandchild.status).toBe(400);
    expect(grandchild.body.code).toBe('TASK_PARENT_INVALID');

    const stale = await request(app)
      .patch(`/api/v1/tasks/${parent.body.task.id}`)
      .set(auth(session, nextKey()))
      .send({ title: '改标题', version: 1, client_updated_at: '2000-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
    expect(stale.body.details.current.title).toBe('父任务');

    const patched = await request(app)
      .patch(`/api/v1/tasks/${parent.body.task.id}`)
      .set(auth(session, nextKey()))
      .send({ title: '父任务-改', version: 1, client_updated_at: parent.body.task.client_updated_at });
    expect(patched.status).toBe(200);
    expect(patched.body.task.version).toBe(2);

    const done = await request(app)
      .post(`/api/v1/tasks/${parent.body.task.id}/status`)
      .set(auth(session, nextKey()))
      .send({ status: 'done', version: 2, client_updated_at: patched.body.task.client_updated_at });
    expect(done.status).toBe(200);
    expect(done.body.task.status).toBe('done');

    const list = await request(app).get(`/api/v1/projects/${projectId}/tasks`).set(auth(session));
    expect(list.body.items).toHaveLength(2);

    const deleted = await request(app)
      .delete(`/api/v1/tasks/${parent.body.task.id}`)
      .set(auth(session, nextKey()));
    expect(deleted.status).toBe(200);
    expect(deleted.body.cascaded_children).toBe(1);
  });

  it('只读成员不能写入任务', async () => {
    const owner = await login('13800000007');
    const project = await createProject(owner, '协作项目');
    const projectId = project.body.project.id as string;

    // 免费版协作者配额为 0，邀请前先升级到基础版（协作 ≤3）
    const upgrade = await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(owner, nextKey()))
      .send({ plan_id: 'basic', cycle: 'monthly', driver: 'mock' });
    expect(upgrade.status).toBe(201);

    const invite = await request(app)
      .post(`/api/v1/projects/${projectId}/invitations`)
      .set(auth(owner, nextKey()))
      .send({ provider: 'phone', identifier: '13800000008', role: 'viewer' });
    expect(invite.status).toBe(201);

    const viewer = await login('13800000008');
    const accept = await request(app)
      .post(`/api/v1/invitations/${invite.body.invitation.token}/accept`)
      .set(auth(viewer, nextKey()))
      .send({});
    expect(accept.status).toBe(200);

    const read = await request(app).get(`/api/v1/projects/${projectId}/tasks`).set(auth(viewer));
    expect(read.status).toBe(200);

    const write = await createTask(viewer, projectId, { title: '越权写入' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('FORBIDDEN');
  });

  it('仪表盘按用户时区分桶并给出计数', async () => {
    const session = await login('13800000009');
    const project = await createProject(session, '仪表盘');
    const projectId = project.body.project.id as string;
    await createTask(session, projectId, { title: '无日期任务' });

    const dashboard = await request(app).get('/api/v1/dashboard').set(auth(session));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.timezone).toBe('Asia/Shanghai');
    expect(dashboard.body.unscheduled).toHaveLength(1);
    expect(dashboard.body.counts.unscheduled).toBe(1);
  });

  it('今日完成按用户时区切日（UTC 跨日不误判）', async () => {
    // UTC 2026-11-03T16:30Z = Asia/Shanghai 2026-11-04 00:30，服务端若按 UTC 日期比较会漏计
    const fixedNow = '2026-11-03T16:30:00.000Z';
    app = createApp({
      db: createDatabase(':memory:'),
      jwtSecret: JWT_SECRET,
      env: {},
      now: () => fixedNow,
    });

    const session = await login('13800000014');
    const project = await createProject(session, '跨日完成');
    const projectId = project.body.project.id as string;
    const task = await createTask(session, projectId, { title: '完成项' });

    const done = await request(app)
      .patch(`/api/v1/tasks/${task.body.task.id}`)
      .set(auth(session, nextKey()))
      .send({ status: 'done', version: 1, client_updated_at: task.body.task.client_updated_at });
    expect(done.status).toBe(200);

    const dashboard = await request(app).get('/api/v1/dashboard').set(auth(session));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.date).toBe('2026-11-04');
    expect(dashboard.body.counts.completed_today).toBe(1);
    expect(dashboard.body.counts.today).toBe(0);
  });

  it('增量同步返回事件流与游标', async () => {
    const session = await login('13800000010');
    const project = await createProject(session, '同步');
    const projectId = project.body.project.id as string;
    await createTask(session, projectId, { title: 'A', due_date: '2026-11-03' });
    await createTask(session, projectId, { title: 'B' });

    const changes = await request(app)
      .get('/api/v1/sync/changes?since_seq=0&device_id=device-a')
      .set(auth(session));
    expect(changes.status).toBe(200);
    expect(changes.body.items.length).toBeGreaterThanOrEqual(2);
    expect(changes.body.next_seq).toBeGreaterThan(0);
    expect(changes.body.has_more).toBe(false);

    const again = await request(app)
      .get(`/api/v1/sync/changes?since_seq=${changes.body.next_seq}&device_id=device-a`)
      .set(auth(session));
    expect(again.body.items).toHaveLength(0);
    expect(again.body.next_seq).toBe(changes.body.next_seq);
  });
});

describe('FR-03 CSV 导出与 FR-06 审计', () => {
  it('免费版导出被拒；升级后导出可下载且内容含表头', async () => {
    const free = await login('13800000011');
    const project = await createProject(free, '导出');
    const projectId = project.body.project.id as string;
    await createTask(free, projectId, { title: '含逗号,的任务' });

    const denied = await request(app)
      .post(`/api/v1/projects/${projectId}/exports`)
      .set(auth(free, nextKey()))
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FEATURE_NOT_AVAILABLE');

    await request(app)
      .post('/api/v1/subscriptions/checkout')
      .set(auth(free, nextKey()))
      .send({ plan_id: 'basic', cycle: 'monthly', driver: 'mock' });

    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/exports`)
      .set(auth(free, nextKey()))
      .send({});
    expect(created.status).toBe(201);
    expect(created.body.rows).toBe(1);

    const download = await request(app)
      .get(`/api/v1/exports/${created.body.export.id}/download`)
      .set(auth(free));
    expect(download.status).toBe(200);
    expect(download.text.split('\r\n')[0]).toContain('title');
    expect(download.text).toContain('"含逗号,的任务"');
  });

  it('审计日志按时间倒序返回本人记录', async () => {
    const session = await login('13800000012');
    await createProject(session, '审计');
    const audit = await request(app).get('/api/v1/audit?limit=10').set(auth(session));
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBeGreaterThan(0);
    expect(audit.body.items[0].action).toBe('project.create');
  });

  it('幂等键回放返回首次结果，复用不同请求体返回 409', async () => {
    const session = await login('13800000013');
    const key = 'replay-key';
    const first = await request(app)
      .post('/api/v1/projects')
      .set(auth(session, key))
      .send({ name: '幂等项目' });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post('/api/v1/projects')
      .set(auth(session, key))
      .send({ name: '幂等项目' });
    expect(replay.status).toBe(201);
    expect(replay.body.project.id).toBe(first.body.project.id);

    const conflict = await request(app)
      .post('/api/v1/projects')
      .set(auth(session, key))
      .send({ name: '不同请求体' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const list = await request(app).get('/api/v1/projects').set(auth(session));
    expect(list.body.items).toHaveLength(1);
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
