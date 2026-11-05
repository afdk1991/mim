/** 契约测试：ai-orchestrator 队列消费 + 产物登记 + media 资产读出（08 §2 / §3.2 / §6） */

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
  return `orch-key-${keyCounter}`;
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

/** 直接写库授予模块权益（模拟下单 / 运营开通链路） */
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

/** 建工程 + 确认分镜 */
async function setupStoryboardedProject(session: Session, title: string) {
  const created = await request(app)
    .post('/api/v1/comic/projects')
    .set(auth(session, nextKey()))
    .send({ title });
  expect(created.status).toBe(201);
  const projectId = created.body.project.id as string;
  const confirmed = await request(app)
    .post(`/api/v1/comic/projects/${projectId}/storyboard`)
    .set(auth(session, nextKey()))
    .send({ shots: [{ index: 1, description: '开场镜头' }], confirm: true });
  expect(confirmed.status).toBe(201);
  return { projectId, storyboardId: confirmed.body.storyboard.id as string };
}

async function dispatchJob(
  session: Session,
  projectId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const created = await request(app)
    .post(`/api/v1/comic/projects/${projectId}/jobs`)
    .set(auth(session, nextKey()))
    .send(body);
  expect(created.status).toBe(201);
  return created.body.job.id as string;
}

/** 预签名 URL 只取 path，避免 supertest 每次新建服务器的端口差异 */
function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'mim-orch-'));
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

describe('能力自检', () => {
  it('GET /ai/capabilities 暴露 provider / 成本上限 / 保留期 / 存储驱动', async () => {
    const session = await login('13900000041');
    grantEntitlement(session.userId);

    const res = await request(app).get('/api/v1/ai/capabilities').set(auth(session));
    expect(res.status).toBe(200);
    expect(res.body.ai.provider).toBe('mock');
    expect(res.body.ai.provider_configured).toBe(true);
    expect(res.body.ai.job_cost_limit_minor).toBe(100000);
    expect(res.body.ai.daily_cost_limit_minor).toBe(500000);
    expect(res.body.ai.asset_ttl_days).toBe(90);
    expect(res.body.ai.supported_job_types).toEqual(['text', 'image', 'video', 'tts', 'compose']);
    expect(res.body.storage).toEqual({ driver: 'local', configured: true });

    // 未解锁模块 → 403
    db.prepare('DELETE FROM entitlements WHERE user_id = ?').run(session.userId);
    const denied = await request(app).get('/api/v1/ai/capabilities').set(auth(session));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FEATURE_NOT_AVAILABLE');
  });
});

describe('队列消费（POST /ai/jobs/:id/run）', () => {
  it('image 任务成功：job succeeded、产物落库、media 可下载', async () => {
    const session = await login('13900000042');
    grantEntitlement(session.userId);
    const { projectId, storyboardId } = await setupStoryboardedProject(session, '编排-图像');
    const jobId = await dispatchJob(session, projectId, {
      job_type: 'image',
      storyboard_id: storyboardId,
      payload: { shot: 1 },
      cost_estimate_minor: 120,
    });

    const run = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.run.status).toBe('succeeded');
    expect(run.body.run.provider).toBe('mock');
    expect(run.body.job.status).toBe('succeeded');
    expect(run.body.job.started_at).not.toBeNull();
    expect(run.body.job.finished_at).not.toBeNull();
    expect(run.body.job.result.object_key).toBe(run.body.run.object_key);
    expect(run.body.job.result.object_key.startsWith(`${session.userId}/${projectId}/`)).toBe(true);
    expect(run.body.job.result.mime).toBe('image/png');

    const assets = await request(app)
      .get(`/api/v1/media/assets?project_id=${projectId}`)
      .set(auth(session));
    expect(assets.status).toBe(200);
    expect(assets.body.items).toHaveLength(1);
    const asset = assets.body.items[0];
    expect(asset.object_key).toBe(run.body.run.object_key);
    expect(asset.asset_type).toBe('image');
    expect(asset.expires_at).not.toBeNull();
    expect(typeof asset.download_url).toBe('string');

    const download = await request(app).get(pathOf(asset.download_url));
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.body.length).toBeGreaterThan(0);
  });

  it('重复触发已消费任务 → 409；跨用户任务 → 404', async () => {
    const session = await login('13900000043');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '编排-重复');
    const jobId = await dispatchJob(session, projectId, { job_type: 'text' });

    const first = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.run.status).toBe('succeeded');

    const second = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('CONFLICT');
    expect(second.body.details.status).toBe('succeeded');

    const other = await login('13900000044');
    grantEntitlement(other.userId);
    const foreign = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(other, nextKey()))
      .send({});
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('NOT_FOUND');
  });

  it('compose 成功驱动工程 generating → rendered，成片长期保留', async () => {
    const session = await login('13900000045');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '编排-合成');
    const jobId = await dispatchJob(session, projectId, { job_type: 'compose' });

    const mid = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(mid.body.project.status).toBe('generating');

    const run = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.run.status).toBe('succeeded');

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(detail.body.project.status).toBe('rendered');

    const assets = await request(app)
      .get(`/api/v1/media/assets?project_id=${projectId}&asset_type=final`)
      .set(auth(session));
    expect(assets.body.items).toHaveLength(1);
    expect(assets.body.items[0].expires_at).toBeNull();
  });
});

describe('失败路径（不伪造外部产物）', () => {
  it('单任务成本超限 → job failed COST_LIMIT_EXCEEDED', async () => {
    app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AI_JOB_COST_LIMIT_MINOR: '1' }, storage });
    const session = await login('13900000046');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '编排-成本');
    const jobId = await dispatchJob(session, projectId, { job_type: 'image', cost_estimate_minor: 100 });

    const run = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.run.status).toBe('failed');
    expect(run.body.run.error_code).toBe('COST_LIMIT_EXCEEDED');
    expect(run.body.job.status).toBe('failed');
    expect(run.body.job.error_code).toBe('COST_LIMIT_EXCEEDED');

    const assets = await request(app)
      .get(`/api/v1/media/assets?project_id=${projectId}`)
      .set(auth(session));
    expect(assets.body.items).toEqual([]);
  });

  it('真实提供方未配置凭证 → job failed PROVIDER_NOT_CONFIGURED', async () => {
    app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AI_PROVIDER: 'openai' }, storage });
    const session = await login('13900000047');
    grantEntitlement(session.userId);

    const caps = await request(app).get('/api/v1/ai/capabilities').set(auth(session));
    expect(caps.body.ai.provider).toBe('openai');
    expect(caps.body.ai.provider_configured).toBe(false);

    const { projectId } = await setupStoryboardedProject(session, '编排-未配置');
    const jobId = await dispatchJob(session, projectId, { job_type: 'tts' });

    const run = await request(app)
      .post(`/api/v1/ai/jobs/${jobId}/run`)
      .set(auth(session, nextKey()))
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.run.status).toBe('failed');
    expect(run.body.run.error_code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(run.body.job.status).toBe('failed');
  });
});
