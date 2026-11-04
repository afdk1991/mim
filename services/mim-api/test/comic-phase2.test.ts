/** 契约测试：第 2 期 生成任务编排（generation_jobs）+ 成片合成（comic_films / film_versions） */

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
  return `comic2-key-${keyCounter}`;
}

interface Session {
  token: string;
  userId: string;
}

async function login(
  identifier: string,
  provider: 'phone' | 'email' = 'phone',
  region: 'cn' | 'global' = 'cn',
): Promise<Session> {
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region, provider, identifier });
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

/** 直接写库授予模块权益（模拟下单 / 运营开通链路） */
function grantEntitlement(userId: string, region: 'cn' | 'global' = 'cn'): void {
  const moduleRow = db
    .prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = ?`)
    .get(region) as { id: string } | undefined;
  if (!moduleRow) throw new Error('comic.workbench module seed missing');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`,
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now);
}

/** 建工程 + 确认分镜，返回 storyboarded 状态的工程与已确认分镜 id */
async function setupStoryboardedProject(session: Session, phone: string) {
  const created = await request(app)
    .post('/api/v1/comic/projects')
    .set(auth(session, nextKey()))
    .send({ title: `编排工程-${session.userId.slice(0, 8)}` });
  expect(created.status).toBe(201);
  const projectId = created.body.project.id as string;
  const confirmed = await request(app)
    .post(`/api/v1/comic/projects/${projectId}/storyboard`)
    .set(auth(session, nextKey()))
    .send({ shots: [{ index: 1, description: '开场镜头' }], confirm: true });
  expect(confirmed.status).toBe(201);
  return { projectId, storyboardId: confirmed.body.storyboard.id as string };
}

/** 推进到 rendered：派 compose 任务 → start → complete */
async function driveProjectToRendered(session: Session, projectId: string) {
  const created = await request(app)
    .post(`/api/v1/comic/projects/${projectId}/jobs`)
    .set(auth(session, nextKey()))
    .send({ job_type: 'compose' });
  expect(created.status).toBe(201);
  const jobId = created.body.job.id as string;
  await request(app).post(`/api/v1/comic/jobs/${jobId}/start`).set(auth(session, nextKey()));
  const completed = await request(app)
    .post(`/api/v1/comic/jobs/${jobId}/complete`)
    .set(auth(session, nextKey()))
    .send({ result: { object_key: 'films/demo.mp4' } });
  expect(completed.status).toBe(200);
  return jobId;
}

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} });
  keyCounter = 0;
});

describe('第 2 期门禁', () => {
  it('jobs / films 未解锁模块返回 403，解锁后放行', async () => {
    const session = await login('13900000021');
    const { projectId } = await (async () => {
      grantEntitlement(session.userId);
      return setupStoryboardedProject(session, '13900000021');
    })();
    // 撤销权益后验证门禁：直接删库模拟未解锁
    db.prepare(`DELETE FROM entitlements WHERE user_id = ?`).run(session.userId);
    const deniedJobs = await request(app)
      .get(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session));
    expect(deniedJobs.status).toBe(403);
    expect(deniedJobs.body.code).toBe('FEATURE_NOT_AVAILABLE');
    const deniedFilms = await request(app)
      .get(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(session));
    expect(deniedFilms.status).toBe(403);

    grantEntitlement(session.userId);
    const allowedJobs = await request(app)
      .get(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session));
    expect(allowedJobs.status).toBe(200);
    expect(allowedJobs.body.items).toEqual([]);
    const allowedFilms = await request(app)
      .get(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(session));
    expect(allowedFilms.status).toBe(200);
    expect(allowedFilms.body.items).toEqual([]);
  });
});

describe('生成任务编排（generation_jobs）', () => {
  it('派发任务驱动 storyboarded → generating；draft 工程派发被拒', async () => {
    const session = await login('13900000022');
    grantEntitlement(session.userId);

    // draft 工程不可派发
    const draft = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: '草稿工程' });
    const rejected = await request(app)
      .post(`/api/v1/comic/projects/${draft.body.project.id}/jobs`)
      .set(auth(session, nextKey()))
      .send({ job_type: 'image' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('CONFLICT');

    const { projectId, storyboardId } = await setupStoryboardedProject(session, '13900000022');
    const created = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session, nextKey()))
      .send({
        job_type: 'image',
        storyboard_id: storyboardId,
        payload: { shot: 1 },
        cost_estimate_minor: 120,
      });
    expect(created.status).toBe(201);
    expect(created.body.job.status).toBe('queued');
    expect(created.body.job.job_type).toBe('image');
    expect(created.body.job.storyboard_id).toBe(storyboardId);
    expect(created.body.job.payload).toEqual({ shot: 1 });
    expect(created.body.job.cost_estimate_minor).toBe(120);
    expect(created.body.project_status).toBe('generating');

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(detail.body.project.status).toBe('generating');

    // 引用他工程分镜 → 404
    const missing = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session, nextKey()))
      .send({ job_type: 'image', storyboard_id: 'not-exists' });
    expect(missing.status).toBe(404);
  });

  it('状态机单向：queued → running → succeeded；非法迁移 409', async () => {
    const session = await login('13900000023');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '13900000023');

    const created = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session, nextKey()))
      .send({ job_type: 'video' });
    const jobId = created.body.job.id as string;

    // queued 不可直接 complete
    const premature = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/complete`)
      .set(auth(session, nextKey()))
      .send({});
    expect(premature.status).toBe(409);

    const started = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/start`)
      .set(auth(session, nextKey()));
    expect(started.status).toBe(200);
    expect(started.body.job.status).toBe('running');
    expect(started.body.job.started_at).not.toBeNull();

    // running 不可再次 start
    const restart = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/start`)
      .set(auth(session, nextKey()));
    expect(restart.status).toBe(409);

    const completed = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/complete`)
      .set(auth(session, nextKey()))
      .send({ result: { object_key: 'shots/1.mp4' } });
    expect(completed.status).toBe(200);
    expect(completed.body.job.status).toBe('succeeded');
    expect(completed.body.job.result).toEqual({ object_key: 'shots/1.mp4' });
    expect(completed.body.job.finished_at).not.toBeNull();

    // 终态不可 cancel
    const canceled = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/cancel`)
      .set(auth(session, nextKey()));
    expect(canceled.status).toBe(409);
  });

  it('失败重试新建 job（retry_of 指向原 job），历史不覆盖', async () => {
    const session = await login('13900000024');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '13900000024');

    const created = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(session, nextKey()))
      .send({ job_type: 'tts', payload: { voice: 'a' } });
    const jobId = created.body.job.id as string;
    await request(app).post(`/api/v1/comic/jobs/${jobId}/start`).set(auth(session, nextKey()));
    const failed = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/fail`)
      .set(auth(session, nextKey()))
      .send({ error_code: 'TTS_TIMEOUT' });
    expect(failed.body.job.status).toBe('failed');
    expect(failed.body.job.error_code).toBe('TTS_TIMEOUT');

    const retried = await request(app)
      .post(`/api/v1/comic/jobs/${jobId}/retry`)
      .set(auth(session, nextKey()));
    expect(retried.status).toBe(201);
    expect(retried.body.job.id).not.toBe(jobId);
    expect(retried.body.job.retry_of).toBe(jobId);
    expect(retried.body.job.status).toBe('queued');
    expect(retried.body.job.payload).toEqual({ voice: 'a' });

    // 原 job 保持 failed 不变；非 failed 不可重试
    const original = await request(app).get(`/api/v1/comic/jobs/${jobId}`).set(auth(session));
    expect(original.body.job.status).toBe('failed');
    const invalidRetry = await request(app)
      .post(`/api/v1/comic/jobs/${retried.body.job.id}/retry`)
      .set(auth(session, nextKey()));
    expect(invalidRetry.status).toBe(409);

    const list = await request(app)
      .get(`/api/v1/comic/projects/${projectId}/jobs?status=failed`)
      .set(auth(session));
    expect(list.body.items).toHaveLength(1);
  });

  it('compose 任务成功驱动工程 generating → rendered', async () => {
    const session = await login('13900000025');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '13900000025');
    await driveProjectToRendered(session, projectId);

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(detail.body.project.status).toBe('rendered');
  });

  it('跨用户访问任务与已删除工程任务统一 404', async () => {
    const owner = await login('13900000026');
    grantEntitlement(owner.userId);
    const { projectId } = await setupStoryboardedProject(owner, '13900000026');
    const created = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/jobs`)
      .set(auth(owner, nextKey()))
      .send({ job_type: 'text' });
    const jobId = created.body.job.id as string;

    const other = await login('13900000027');
    grantEntitlement(other.userId);
    const peek = await request(app).get(`/api/v1/comic/jobs/${jobId}`).set(auth(other));
    expect(peek.status).toBe(404);

    await request(app).delete(`/api/v1/comic/projects/${projectId}`).set(auth(owner, nextKey()));
    const gone = await request(app).get(`/api/v1/comic/jobs/${jobId}`).set(auth(owner));
    expect(gone.status).toBe(404);
  });
});

describe('成片合成（comic_films / film_versions）', () => {
  it('未 rendered 工程不可合成；rendered 后创建 draft 成片 + 首个版本', async () => {
    const session = await login('13900000028');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '13900000028');

    const early = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(session, nextKey()))
      .send({ title: '抢跑成片' });
    expect(early.status).toBe(409);

    await driveProjectToRendered(session, projectId);
    const created = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(session, nextKey()))
      .send({ title: '雨夜追光·第 1 版', object_key: 'films/ep1-v1.mp4', duration_sec: 96, size_bytes: 1024 });
    expect(created.status).toBe(201);
    expect(created.body.film.status).toBe('draft');
    expect(created.body.film.version).toBe(1);
    expect(created.body.version.version_no).toBe(1);
    expect(created.body.version.object_key).toBe('films/ep1-v1.mp4');

    const list = await request(app)
      .get(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(session));
    expect(list.body.items).toHaveLength(1);
  });

  it('提交审核需最新版本登记 object_key；发布驱动工程 → published', async () => {
    const session = await login('13900000029');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '13900000029');
    await driveProjectToRendered(session, projectId);

    // 无 object_key 的成片不可提交审核
    const noAsset = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(session, nextKey()))
      .send({ title: '无产物成片' });
    const noAssetFilmId = noAsset.body.film.id as string;
    const blocked = await request(app)
      .post(`/api/v1/comic/films/${noAssetFilmId}/submit-review`)
      .set(auth(session, nextKey()));
    expect(blocked.status).toBe(409);

    // 追加带 object_key 的版本后可提交
    const versioned = await request(app)
      .post(`/api/v1/comic/films/${noAssetFilmId}/versions`)
      .set(auth(session, nextKey()))
      .send({ object_key: 'films/ep1-v2.mp4', duration_sec: 98 });
    expect(versioned.status).toBe(201);
    expect(versioned.body.version.version_no).toBe(2);

    const submitted = await request(app)
      .post(`/api/v1/comic/films/${noAssetFilmId}/submit-review`)
      .set(auth(session, nextKey()));
    expect(submitted.status).toBe(200);
    expect(submitted.body.film.status).toBe('reviewing');

    // draft 不可直接发布；reviewing 发布成功
    const published = await request(app)
      .post(`/api/v1/comic/films/${noAssetFilmId}/publish`)
      .set(auth(session, nextKey()));
    expect(published.status).toBe(200);
    expect(published.body.film.status).toBe('published');
    expect(published.body.film.current_version_id).toBe(versioned.body.version.id);

    const detail = await request(app).get(`/api/v1/comic/films/${noAssetFilmId}`).set(auth(session));
    expect(detail.body.versions).toHaveLength(2);
    expect(detail.body.versions[1].published_at).not.toBeNull();

    const project = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(project.body.project.status).toBe('published');
  });

  it('驳回回到 draft 并留原因；published 发新版回到 draft；归档为终态', async () => {
    const session = await login('13900000030');
    grantEntitlement(session.userId);
    const { projectId } = await setupStoryboardedProject(session, '13900000030');
    await driveProjectToRendered(session, projectId);

    const created = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(session, nextKey()))
      .send({ title: '驳回成片', object_key: 'films/ep2-v1.mp4' });
    const filmId = created.body.film.id as string;
    await request(app).post(`/api/v1/comic/films/${filmId}/submit-review`).set(auth(session, nextKey()));

    const rejected = await request(app)
      .post(`/api/v1/comic/films/${filmId}/reject`)
      .set(auth(session, nextKey()))
      .send({ reason: '第 3 镜头口型不同步' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.film.status).toBe('draft');
    expect(rejected.body.film.review_note).toBe('第 3 镜头口型不同步');

    // 重走审核 → 发布 → 发新版回到 draft，已发布版本不被覆盖
    await request(app).post(`/api/v1/comic/films/${filmId}/submit-review`).set(auth(session, nextKey()));
    await request(app).post(`/api/v1/comic/films/${filmId}/publish`).set(auth(session, nextKey()));
    const newVersion = await request(app)
      .post(`/api/v1/comic/films/${filmId}/versions`)
      .set(auth(session, nextKey()))
      .send({ object_key: 'films/ep2-v2.mp4' });
    expect(newVersion.status).toBe(201);
    const afterNewVersion = await request(app).get(`/api/v1/comic/films/${filmId}`).set(auth(session));
    expect(afterNewVersion.body.film.status).toBe('draft');
    expect(afterNewVersion.body.film.current_version_id).not.toBeNull();
    expect(afterNewVersion.body.versions[0].published_at).not.toBeNull();

    // 归档终态：不可追加版本、不可再次归档
    const archived = await request(app)
      .post(`/api/v1/comic/films/${filmId}/archive`)
      .set(auth(session, nextKey()));
    expect(archived.body.film.status).toBe('archived');
    const appendAfterArchive = await request(app)
      .post(`/api/v1/comic/films/${filmId}/versions`)
      .set(auth(session, nextKey()))
      .send({ object_key: 'films/ep2-v3.mp4' });
    expect(appendAfterArchive.status).toBe(409);
    const archiveAgain = await request(app)
      .post(`/api/v1/comic/films/${filmId}/archive`)
      .set(auth(session, nextKey()));
    expect(archiveAgain.status).toBe(409);
  });

  it('跨用户访问成片统一 404', async () => {
    const owner = await login('13900000031');
    grantEntitlement(owner.userId);
    const { projectId } = await setupStoryboardedProject(owner, '13900000031');
    await driveProjectToRendered(owner, projectId);
    const created = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(owner, nextKey()))
      .send({ title: '私有成片' });
    const filmId = created.body.film.id as string;

    const other = await login('13900000032');
    grantEntitlement(other.userId);
    const peek = await request(app).get(`/api/v1/comic/films/${filmId}`).set(auth(other));
    expect(peek.status).toBe(404);
    const peekList = await request(app)
      .get(`/api/v1/comic/projects/${projectId}/films`)
      .set(auth(other));
    expect(peekList.status).toBe(404);
  });
});
