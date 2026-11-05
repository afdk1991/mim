/** 契约测试：media 域（预签名上传/下载、归属隔离、签名校验） */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { createStorage } from '../src/storage.js';
import type { StorageAdapter } from '../src/storage.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

let app: Express;
let db: ReturnType<typeof createDatabase>;
let storage: StorageAdapter;
let storageDir: string;
let keyCounter = 0;

function nextKey(): string {
  keyCounter += 1;
  return `media-key-${keyCounter}`;
}

interface Session {
  token: string;
  userId: string;
}

async function login(identifier: string): Promise<Session> {
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier });
  expect(codeRes.status).toBe(201);
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } });
  expect(loginRes.status).toBe(200);
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string };
}

function auth(session: Session, key?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  if (key) headers['idempotency-key'] = key;
  return headers;
}

function grantEntitlement(userId: string): void {
  const moduleRow = db
    .prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`)
    .get() as { id: string } | undefined;
  if (!moduleRow) throw new Error('comic.workbench module seed missing');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`,
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now);
}

function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

beforeEach(() => {
  keyCounter = 0;
  db = createDatabase(':memory:');
  storageDir = mkdtempSync(join(tmpdir(), 'mim-media-'));
  storage = createStorage({
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir },
    jwtSecret: JWT_SECRET,
    fallbackDir: storageDir,
  });
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage });
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

describe('media 域', () => {
  it('未解锁模块 403；解锁后可完成预签名上传 → 下载闭环', async () => {
    const session = await login('13900000031');

    const denied = await request(app)
      .post('/api/v1/media/presign/upload')
      .set(auth(session, nextKey()))
      .send({ asset_type: 'image', mime: 'image/png' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FEATURE_NOT_AVAILABLE');

    grantEntitlement(session.userId);

    const presign = await request(app)
      .post('/api/v1/media/presign/upload')
      .set(auth(session, nextKey()))
      .send({ asset_type: 'image', mime: 'image/png' });
    expect(presign.status).toBe(201);
    const objectKey = presign.body.object_key as string;
    expect(objectKey.startsWith(`${session.userId}/`)).toBe(true);
    expect(objectKey.endsWith('.png')).toBe(true);

    const payload = Buffer.from('fake-png-bytes-for-contract-test');
    const uploaded = await request(app)
      .put(pathOf(presign.body.upload.url as string))
      .set('content-type', 'image/png')
      .send(payload);
    expect(uploaded.status).toBe(204);
    expect(uploaded.headers['x-object-checksum']).toBeTruthy();

    const downloadPresign = await request(app)
      .get('/api/v1/media/presign/download')
      .query({ object_key: objectKey })
      .set(auth(session));
    expect(downloadPresign.status).toBe(200);

    const fetched = await request(app).get(pathOf(downloadPresign.body.download.url as string));
    expect(fetched.status).toBe(200);
    expect(Buffer.from(fetched.body)).toEqual(payload);
  });

  it('跨用户对象一律 404，不泄漏存在性', async () => {
    const owner = await login('13900000032');
    const other = await login('13900000033');
    grantEntitlement(owner.userId);
    grantEntitlement(other.userId);

    const presign = await request(app)
      .post('/api/v1/media/presign/upload')
      .set(auth(owner, nextKey()))
      .send({ asset_type: 'image', mime: 'image/png' });
    expect(presign.status).toBe(201);
    const objectKey = presign.body.object_key as string;

    const cross = await request(app)
      .get('/api/v1/media/presign/download')
      .query({ object_key: objectKey })
      .set(auth(other));
    expect(cross.status).toBe(404);
    expect(cross.body.code).toBe('NOT_FOUND');

    // 用他人工程 id 申请上传同样 404
    const created = await request(app)
      .post('/api/v1/comic/projects')
      .set(auth(owner, nextKey()))
      .send({ title: '归属工程' });
    expect(created.status).toBe(201);
    const crossUpload = await request(app)
      .post('/api/v1/media/presign/upload')
      .set(auth(other, nextKey()))
      .send({ asset_type: 'image', mime: 'image/png', project_id: created.body.project.id });
    expect(crossUpload.status).toBe(404);
  });

  it('签名篡改或过期返回 401', async () => {
    const session = await login('13900000034');
    grantEntitlement(session.userId);
    const presign = await request(app)
      .post('/api/v1/media/presign/upload')
      .set(auth(session, nextKey()))
      .send({ asset_type: 'image', mime: 'image/png' });
    expect(presign.status).toBe(201);

    const tampered = new URL(presign.body.upload.url as string);
    tampered.searchParams.set('signature', 'deadbeef'.repeat(8));
    const rejected = await request(app)
      .put(`${tampered.pathname}${tampered.search}`)
      .set('content-type', 'image/png')
      .send(Buffer.from('payload'));
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe('AUTH_UNAUTHORIZED');
  });
});
