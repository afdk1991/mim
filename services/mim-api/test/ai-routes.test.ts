/** 契约测试：ai 路由 HTTP 层（鉴权 401 / 归属 404 / 非 queued CONFLICT / 触发成功） */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { createStorage, type StorageAdapter } from '../src/storage.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

let app: Express;
let db: ReturnType<typeof createDatabase>;
let storage: StorageAdapter;
let storageDir: string;
let keyCounter = 0;

function nextKey(): string {
  keyCounter += 1;
  return `ai-route-key-${keyCounter}`;
}

interface Session {
  token: string;
  userId: string;
}

async function login(identifier: string): Promise<Session> {
  const codeRes = await request(app)
    .post('/api/v1/auth/code')
    .send({ region: 'cn', provider: 'phone', identifier });
  expect(codeRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({
      region: 'cn',
      provider: 'phone',
      identifier,
      code: codeRes.body.dev_code,
      device: { platform: 'web', name: 'test' },
    });
  expect(loginRes.status).toBe(200);
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string };
}

function auth(session: Session, key?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  if (key) headers['idempotency-key'] = key;
  return headers;
}

function grantEntitlement(userId: string): void {
  const moduleRow = db.prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`).get() as
    | { id: string }
    | undefined;
  if (!moduleRow) throw new Error('comic.workbench module seed missing');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`,
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now);
}

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'mim-ai-routes-'));
  storage = createStorage({
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir },
    jwtSecret: JWT_SECRET,
    fallbackDir: storageDir,
  });
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage });
  keyCounter = 0;
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

describe('鉴权边界', () => {
  it('未登录访问 capabilities / run 一律 401', async () => {
    const caps = await request(app).get('/api/v1/ai/capabilities');
    expect(caps.status).toBe(401);
    expect(caps.body.code).toBe('AUTH_UNAUTHORIZED');

    const run = await request(app)
      .post('/api/v1/ai/jobs/job-nonexistent/run')
      .set('idempotency-key', nextKey())
      .send({});
    expect(run.status).toBe(401);
    expect(run.body.code).toBe('AUTH_UNAUTHORIZED');
  });
});

describe('GET /ai/capabilities', () => {
  it('解锁后返回 200 与 mock 提供方契约形状', async () => {
    const session = await login('13900000061');
    grantEntitlement(session.userId);

    const res = await request(app).get('/api/v1/ai/capabilities').set(auth(session));
    expect(res.status).toBe(200);
    expect(res.body.ai.provider).toBe('mock');
    expect(res.body.ai.provider_configured).toBe(true);
    expect(res.body.ai.mock_provider).toBe(true);
    expect(res.body.ai.supported_job_types).toEqual(['text', 'image', 'video', 'tts', 'compose']);
    expect(res.body.ai.storage).toEqual({ driver: 'local', configured: true });
    expect(res.body.storage).toEqual({ driver: 'local', configured: true });
  });
});

describe('POST /ai/jobs/:id/run 边界', () => {
  it('任务不存在 → 404（不泄漏存在性）', async () => {
    const session = await login('13900000062');
    grantEntitlement(session.userId);

    const res = await request(app)
      .post('/api/v1/ai/jobs/job-missing/run')
      .set(auth(session, nextKey()))
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('已取消任务（非 queued）→ 409 CONFLICT 并透传当前状态', async () => {
    const session = await login('13900000063');
    grantEntitlement(session.userId);

    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: 'ai-routes-取消' });
    expect(created.status).toBe(201);
    const projectId = created.body.project.id as string;

    const confirmed = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/storyboard`)
      .set(auth(session, nextKey()))
      .send({ shots: [{ index: 1, description: '镜头一' }], confirm: true });
    expect(confirmed.status).toBe(201);

    const job = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session, nextKey()))
      .send({ job_type: 'image' });
    expect(job.status).toBe(201);
    const jobId = job.body.job.id as string;

    const canceled = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/cancel`)
      .set(auth(session, nextKey()))
      .send({});
    expect(canceled.status).toBe(200);

    const run = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(run.status).toBe(409);
    expect(run.body.code).toBe('CONFLICT');
    expect(run.body.details.status).toBe('canceled');
  });

  it('queued 任务触发成功：返回 run+job 契约，产物落库', async () => {
    const session = await login('13900000064');
    grantEntitlement(session.userId);

    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: 'ai-routes-成功' });
    expect(created.status).toBe(201);
    const projectId = created.body.project.id as string;

    const confirmed = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/storyboard`)
      .set(auth(session, nextKey()))
      .send({ shots: [{ index: 1, description: '镜头一' }], confirm: true });
    expect(confirmed.status).toBe(201);

    const job = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session, nextKey()))
      .send({ job_type: 'text', payload: { prompt: '你好' } });
    expect(job.status).toBe(201);
    const jobId = job.body.job.id as string;

    const run = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.run.job_id).toBe(jobId);
    expect(run.body.run.status).toBe('succeeded');
    expect(run.body.run.provider).toBe('mock');
    expect(run.body.run.object_key).toBeTruthy();
    expect(run.body.job.id).toBe(jobId);
    expect(run.body.job.status).toBe('succeeded');
    expect(run.body.job.result.object_key).toBe(run.body.run.object_key);

    const assets = await request(app)
      .get(`/api/v1/media/assets?project_id=${projectId}`)
      .set(auth(session));
    expect(assets.status).toBe(200);
    expect(assets.body.items).toHaveLength(1);
    expect(assets.body.items[0].object_key).toBe(run.body.run.object_key);
  });
});
