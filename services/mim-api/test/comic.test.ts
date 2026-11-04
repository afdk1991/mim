/** 契约测试：第 1 期 AI 辅助创作工作台（comic 域 + entitlement 门禁） */

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
  return `comic-key-${keyCounter}`;
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

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} });
  keyCounter = 0;
});

describe('comic 工作台门禁', () => {
  it('未解锁模块返回 403 FEATURE_NOT_AVAILABLE，解锁后放行', async () => {
    const session = await login('13900000001');
    const denied = await request(app).get('/api/v1/comic/projects').set(auth(session));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(denied.body.details.module_code).toBe('comic.workbench');

    grantEntitlement(session.userId);
    const allowed = await request(app).get('/api/v1/comic/projects').set(auth(session));
    expect(allowed.status).toBe(200);
    expect(allowed.body.items).toEqual([]);
  });

  it('模块种子按区域隔离：global 用户需 global 区权益', async () => {
    const globalUser = await login('global@example.com', 'email', 'global');
    grantEntitlement(globalUser.userId, 'cn');
    const denied = await request(app).get('/api/v1/comic/projects').set(auth(globalUser));
    expect(denied.status).toBe(403);

    grantEntitlement(globalUser.userId, 'global');
    const allowed = await request(app).get('/api/v1/comic/projects').set(auth(globalUser));
    expect(allowed.status).toBe(200);
  });
});

describe('创作工程 CRUD', () => {
  it('新建工程 + 幂等回放 + 同 Key 异 body 冲突', async () => {
    const session = await login('13900000002');
    grantEntitlement(session.userId);
    const key = 'create-project';
    const body = { title: '雨夜追光', synopsis: '一名少女在雨夜寻找失散的哥哥。' };

    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, key))
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.project.status).toBe('draft');
    expect(created.body.project.version).toBe(1);

    const replay = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, key))
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.project.id).toBe(created.body.project.id);

    const conflict = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, key))
      .send({ title: '另一个标题' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const list = await request(app).get('/api/v1/comic/projects').set(auth(session));
    expect(list.body.items).toHaveLength(1);
  });

  it('PATCH 乐观锁：版本不匹配返回 409', async () => {
    const session = await login('13900000003');
    grantEntitlement(session.userId);
    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: '初稿' });
    const projectId = created.body.project.id as string;

    const updated = await request(app)
      .patch(`/api/v1/comic/projects/${projectId}`)
      .set(auth(session, nextKey()))
      .send({ title: '二稿', version: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.project.version).toBe(2);

    const stale = await request(app)
      .patch(`/api/v1/comic/projects/${projectId}`)
      .set(auth(session, nextKey()))
      .send({ title: '回退稿', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
    expect(stale.body.details.current_version).toBe(2);
  });

  it('跨用户与已删除工程统一 404', async () => {
    const owner = await login('13900000004');
    grantEntitlement(owner.userId);
    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(owner, nextKey()))
      .send({ title: '私有工程' });
    const projectId = created.body.project.id as string;

    const other = await login('13900000005');
    grantEntitlement(other.userId);
    const peek = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(other));
    expect(peek.status).toBe(404);
    expect(peek.body.code).toBe('NOT_FOUND');

    const deleted = await request(app)
      .delete(`/api/v1/comic/projects/${projectId}`)
      .set(auth(owner, nextKey()));
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);

    const gone = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(owner));
    expect(gone.status).toBe(404);
    const list = await request(app).get('/api/v1/comic/projects').set(auth(owner));
    expect(list.body.items).toHaveLength(0);
  });
});

describe('分镜 / 角色 / AI 建议', () => {
  it('分镜确认后驱动 draft → storyboarded 状态机', async () => {
    const session = await login('13900000006');
    grantEntitlement(session.userId);
    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: '分镜工程' });
    const projectId = created.body.project.id as string;
    const shots = [
      { index: 1, description: '雨夜街角，少女回头', camera: '近景固定', duration_sec: 3 },
      { index: 2, description: '镜头推向远处的灯牌', camera: '中景横移', duration_sec: 4 },
    ];

    const draft = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/storyboard`)
      .set(auth(session, nextKey()))
      .send({ shots });
    expect(draft.status).toBe(201);
    expect(draft.body.storyboard.version_no).toBe(1);
    expect(draft.body.project_status).toBe('draft');
    expect(draft.body.storyboard.confirmed_at).toBeNull();

    const confirmed = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/storyboard`)
      .set(auth(session, nextKey()))
      .send({ shots, confirm: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.storyboard.version_no).toBe(2);
    expect(confirmed.body.project_status).toBe('storyboarded');

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(detail.body.project.status).toBe('storyboarded');
    expect(detail.body.latest_storyboard.version_no).toBe(2);
    expect(detail.body.latest_storyboard.shots).toHaveLength(2);
  });

  it('分镜序号重复被拒；进入生成态后内容冻结', async () => {
    const session = await login('13900000007');
    grantEntitlement(session.userId);
    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: '冻结工程' });
    const projectId = created.body.project.id as string;

    const duplicated = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/storyboard`)
      .set(auth(session, nextKey()))
      .send({
        shots: [
          { index: 1, description: 'A' },
          { index: 1, description: 'B' },
        ],
      });
    expect(duplicated.status).toBe(400);
    expect(duplicated.body.code).toBe('VALIDATION_FAILED');

    db.prepare(`UPDATE comic_projects SET status = 'generating', version = 2 WHERE id = ?`).run(projectId);
    const frozen = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/storyboard`)
      .set(auth(session, nextKey()))
      .send({ shots: [{ index: 1, description: 'C' }] });
    expect(frozen.status).toBe(409);
    expect(frozen.body.code).toBe('CONFLICT');
  });

  it('角色同名 upsert：内容不变不涨版本，变更后版本递增', async () => {
    const session = await login('13900000008');
    grantEntitlement(session.userId);
    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: '角色工程' });
    const projectId = created.body.project.id as string;
    const body = {
      name: '小雨',
      appearance_prompt: '银灰色短发，深蓝风衣，右眼下泪痣',
      seed: 42,
      reference_asset_ids: ['asset-1'],
      voice_profile: '清冷少女音',
    };

    const first = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/characters`)
      .set(auth(session, nextKey()))
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(first.body.character.version).toBe(1);

    const repeated = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/characters`)
      .set(auth(session, nextKey()))
      .send(body);
    expect(repeated.status).toBe(200);
    expect(repeated.body.created).toBe(false);
    expect(repeated.body.character.id).toBe(first.body.character.id);
    expect(repeated.body.character.version).toBe(1);

    const changed = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/characters`)
      .set(auth(session, nextKey()))
      .send({ ...body, appearance_prompt: '银灰色长发，深蓝风衣' });
    expect(changed.status).toBe(200);
    expect(changed.body.character.version).toBe(2);

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(detail.body.characters).toHaveLength(1);
    expect(detail.body.characters[0].reference_asset_ids).toEqual(['asset-1']);
  });

  it('AI 建议返回结构稳定且需人工确认（不落库）', async () => {
    const session = await login('13900000009');
    grantEntitlement(session.userId);
    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session, nextKey()))
      .send({ title: '建议工程', synopsis: '少年在旧书店发现会说话的地图。' });
    const projectId = created.body.project.id as string;

    const suggested = await request(app)
      .post(`/api/v1/comic/projects/${projectId}/suggest`)
      .set(auth(session, nextKey()))
      .send({ kind: 'storyboard', count: 2 });
    expect(suggested.status).toBe(200);
    expect(suggested.body.suggestion.requires_confirmation).toBe(true);
    expect(suggested.body.suggestion.model).toBe('mock-text-suggest');
    expect(suggested.body.suggestion.items).toHaveLength(2);
    expect(suggested.body.suggestion.items[0].index).toBe(1);

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session));
    expect(detail.body.latest_storyboard).toBeNull();
  });

  it('写操作缺少 Idempotency-Key 被拒', async () => {
    const session = await login('13900000010');
    grantEntitlement(session.userId);
    const res = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(session))
      .send({ title: '无幂等键' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
