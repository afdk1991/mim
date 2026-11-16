/** 契约测试：图库 / 视频（媒体元数据、严格付费墙、收藏、按帖聚合、匿名白名单） */

import { mkdtempSync, rmSync } from 'node:fs'; // 建 / 删临时存储目录
import { randomUUID } from 'node:crypto'; // 写操作幂等键
import { tmpdir } from 'node:os'; // 系统临时目录
import { join } from 'node:path'; // 路径拼接
import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // 进程内 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 被测应用
import { createDatabase } from '../src/db.js'; // 内存库 + 种子
import { createStorage } from '../src/storage.js'; // 本地存储驱动
import type { StorageAdapter } from '../src/storage.js'; // 存储适配器类型
import { loginHeaders, registerTestAccount } from './_auth-helper.js'; // 注册 + 登录

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const FREE_THREAD = 'thread-store-visual'; // 种子免费帖
const PAID_THREAD = 'thread-paid-store'; // 种子付费帖（1900 分）

let app: Express; // 应用句柄
let db: ReturnType<typeof createDatabase>; // 直接查库构造场景
let storageDir: string; // 每例独立存储目录
let storage: StorageAdapter; // 存储实例

/** 把预签名绝对地址转成同源路径 */
function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/** 预签名上传一段字节，返回对象键 */
async function uploadFile(auth: Record<string, string>, mime: string, body: Buffer): Promise<string> {
  const presign = await request(app)
    .post('/api/v1/media/presign/upload')
    .set({ ...auth, 'idempotency-key': randomUUID() })
    .send({ asset_type: 'final', mime, size_bytes: body.byteLength });
  expect(presign.status).toBe(201);
  const uploaded = await request(app).put(pathOf(presign.body.upload.url as string)).set('content-type', mime).send(body);
  expect(uploaded.status).toBe(204);
  return presign.body.object_key as string;
}

/** 取某个帖子的媒体主键 */
function mediaIdOf(threadId: string): string {
  return (db.prepare('SELECT id FROM community_thread_media WHERE thread_id = ? ORDER BY sort_order ASC LIMIT 1').get(threadId) as { id: string }).id;
}

beforeEach(() => {
  db = createDatabase(':memory:');
  storageDir = mkdtempSync(join(tmpdir(), 'mim-gallery-'));
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

describe('图库 / 视频', () => {
  it('发帖挂对象键图片与视频：详情回签名地址与时长 / 分辨率，绝不泄露对象键', async () => {
    const auth = await loginHeaders(app, '13700000301');
    const imageKey = await uploadFile(auth, 'image/png', Buffer.from('fake-png-bytes'));
    const videoKey = await uploadFile(auth, 'video/mp4', Buffer.from('fake-mp4-bytes'));
    const posterKey = await uploadFile(auth, 'image/jpeg', Buffer.from('fake-poster-bytes'));

    const created = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...auth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '图库与视频元数据',
        body: '这篇帖子携带图片与视频对象键，服务端需要回读真实元数据并在详情签发短时地址。',
        media: [
          { kind: 'image', object_key: imageKey, width: 1200, height: 800 },
          { kind: 'video', object_key: videoKey, poster_key: posterKey, duration_seconds: 42, width: 1920, height: 1080, mime: 'video/mp4' },
        ],
      });
    expect(created.status).toBe(201);
    const threadId = created.body.thread_id as string;

    const detail = await request(app).get(`/api/v1/community/threads/${threadId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.thread.media).toHaveLength(2);
    const video = detail.body.thread.media[1];
    expect(video.kind).toBe('video');
    expect(video.duration_seconds).toBe(42);
    expect(video.width).toBe(1920);
    expect(video.height).toBe(1080);
    expect(video.mime).toBe('video/mp4');
    expect(video.url).toContain('signature='); // 对象键已换成签名地址
    expect(video.poster_url).toContain('signature=');
    expect(String(detail.body.thread.cover_url)).toContain('signature='); // 未显式传封面时回落第一条带封面的媒体，并已签名
    expect(detail.body.thread.cover_url).not.toBe(posterKey);

    const raw = JSON.stringify(detail.body);
    expect(raw).not.toContain(`"${imageKey}"`); // 对象键只在签名地址内部出现，绝不作为裸字段下发
    expect(raw).not.toContain(`"${videoKey}"`);
    expect(raw).not.toContain(`"${posterKey}"`);

    const fetched = await request(app).get(pathOf(video.url as string));
    expect(fetched.status).toBe(200); // 签名地址能取回原字节
    expect(Buffer.from(fetched.body)).toEqual(Buffer.from('fake-mp4-bytes'));
  });

  it('付费帖的视频与图片严格受付费墙约束：匿名 / 未购看不到地址，作者与 VIP 可见', async () => {
    const author = await registerTestAccount(app, '13700000302');
    const authorAuth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };
    db.prepare('UPDATE community_threads SET author_id = ? WHERE id = ?').run(author.userId, PAID_THREAD);
    const imageKey = await uploadFile(authorAuth, 'image/png', Buffer.from('paid-image'));
    const videoKey = await uploadFile(authorAuth, 'video/mp4', Buffer.from('paid-video'));
    db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, storage_key, poster_key, mime, size_bytes, duration_seconds, width, height, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`media-${randomUUID()}`, PAID_THREAD, 'video', '', null, videoKey, null, 'video/mp4', 10, 99, 1280, 720, 0, new Date().toISOString());
    db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, storage_key, poster_key, mime, size_bytes, duration_seconds, width, height, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`media-${randomUUID()}`, PAID_THREAD, 'image', '', null, imageKey, null, 'image/png', 9, 0, 100, 100, 1, new Date().toISOString());

    const anonymous = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.thread.media).toEqual([]); // 免费板块里的付费帖：板块开放也不能放行媒体
    expect(JSON.stringify(anonymous.body)).not.toContain(videoKey);

    const outsider = await loginHeaders(app, '13700000303');
    const notBought = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set(outsider);
    expect(notBought.body.thread.media).toEqual([]);

    const byAuthor = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set(authorAuth);
    expect(byAuthor.body.thread.media).toHaveLength(2);
    expect(byAuthor.body.thread.media[0].duration_seconds).toBe(99);

    const vip = await registerTestAccount(app, '13700000304');
    db.prepare('INSERT INTO vip_memberships (id, user_id, plan_id, level, starts_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`vip-${randomUUID()}`, vip.userId, 'vip-monthly', 1, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString(), 'active', new Date().toISOString());
    const byVip = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set({ authorization: `Bearer ${vip.token}` });
    expect(byVip.body.thread.media).toHaveLength(2); // VIP 免购
  });

  it('图库列表按用户视角返回：锁定项隐藏地址，作者 / VIP / 收藏过滤与聚合可用', async () => {
    const author = await registerTestAccount(app, '13700000305');
    const authorAuth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };
    const freeKey = await uploadFile(authorAuth, 'image/png', Buffer.from('gallery-free'));
    const free = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '公开图库：海边落日',
        body: '公开图库用于验证匿名可读与收藏链路，图片走对象键直传。',
        media: [{ kind: 'image', object_key: freeKey, width: 800, height: 600 }],
      });
    expect(free.status).toBe(201);
    const freeThreadId = free.body.thread_id as string;

    const paidKey = await uploadFile(authorAuth, 'video/mp4', Buffer.from('gallery-paid'));
    const paid = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '付费视频：完整课程',
        body: '付费视频用于验证图库锁定与收藏拦截，购买前不返回任何地址。',
        price_cents: 2600,
        media: [{ kind: 'video', object_key: paidKey, duration_seconds: 600, width: 1920, height: 1080 }],
      });
    expect(paid.status).toBe(201);
    const paidThreadId = paid.body.thread_id as string;
    const paidMediaId = mediaIdOf(paidThreadId);

    const anonymous = await request(app).get('/api/v1/community/gallery/items?limit=60');
    expect(anonymous.status).toBe(200);
    const freeItem = (anonymous.body.items as Array<Record<string, unknown>>).find((item) => item.thread_id === freeThreadId);
    const paidItem = (anonymous.body.items as Array<Record<string, unknown>>).find((item) => item.thread_id === paidThreadId);
    expect(freeItem?.locked).toBe(false);
    expect(String(freeItem?.url)).toContain('signature=');
    expect(paidItem?.locked).toBe(true);
    expect(paidItem?.url).toBe('');
    expect(JSON.stringify(anonymous.body)).not.toContain(paidKey);

    const byAuthor = await request(app).get(`/api/v1/community/gallery/items?author_id=${author.userId}`).set(authorAuth);
    expect((byAuthor.body.items as Array<Record<string, unknown>>).find((item) => item.thread_id === paidThreadId)?.locked).toBe(false);

    const outsider = await loginHeaders(app, '13700000306');
    const favoriteLocked = await request(app)
      .post(`/api/v1/community/gallery/items/${paidMediaId}/favorite`)
      .set({ ...outsider, 'idempotency-key': randomUUID() });
    expect(favoriteLocked.status).toBe(403); // 未解锁的媒体不能收藏

    const freeMediaId = mediaIdOf(freeThreadId);
    const favorite = await request(app)
      .post(`/api/v1/community/gallery/items/${freeMediaId}/favorite`)
      .set({ ...outsider, 'idempotency-key': randomUUID() });
    expect(favorite.status).toBe(200);
    const mine = await request(app).get('/api/v1/community/gallery/items?favorited=1').set(outsider);
    expect((mine.body.items as Array<Record<string, unknown>>).map((item) => item.id)).toContain(freeMediaId);
    const unfavorite = await request(app)
      .delete(`/api/v1/community/gallery/items/${freeMediaId}/favorite`)
      .set({ ...outsider, 'idempotency-key': randomUUID() });
    expect(unfavorite.status).toBe(200);

    const collections = await request(app).get(`/api/v1/community/gallery/collections?group=thread&author_id=${author.userId}`);
    expect(collections.status).toBe(200);
    const freeGroup = (collections.body.collections as Array<Record<string, unknown>>).find((item) => item.key === freeThreadId);
    expect(freeGroup?.count).toBe(1);
    expect(String(freeGroup?.cover_url)).toContain('signature=');
    expect((collections.body.collections as Array<Record<string, unknown>>).find((item) => item.key === paidThreadId)).toBeUndefined(); // 匿名聚合不包含锁定帖
  });

  it('图库筛选：板块与上传时间区间可叠加，作者聚合复用 collections 路由', async () => {
    const author = await registerTestAccount(app, '13700000307');
    const authorAuth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };
    const imageKey = await uploadFile(authorAuth, 'image/png', Buffer.from('filter-image'));
    const created = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '筛选样本：板块与时间',
        body: '用于验证图库的板块与上传时间区间筛选，以及作者聚合入口。',
        media: [{ kind: 'image', object_key: imageKey }],
      });
    expect(created.status).toBe(201);
    const threadId = created.body.thread_id as string;
    const mediaId = mediaIdOf(threadId);
    db.prepare('UPDATE community_thread_media SET created_at = ? WHERE id = ?').run('2026-01-02T10:00:00.000Z', mediaId);

    // 作者聚合入口：collections 复用同一批筛选参数（此时帖子仍在公开板块，匿名可见）
    const collections = await request(app).get(`/api/v1/community/gallery/collections?group=thread&author_id=${author.userId}&from=2026-01-01&to=2026-01-03`);
    expect(collections.status).toBe(200);
    expect((collections.body.collections as Array<Record<string, unknown>>).map((item) => item.key)).toContain(threadId);
    const filteredOut = await request(app).get(`/api/v1/community/gallery/collections?group=thread&author_id=${author.userId}&from=2026-01-03`);
    expect((filteredOut.body.collections as Array<Record<string, unknown>>).map((item) => item.key)).not.toContain(threadId);

    db.prepare("UPDATE community_threads SET board_id = (SELECT id FROM community_boards WHERE slug = 'paid') WHERE id = ?").run(threadId);

    const byBoard = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&limit=60');
    expect(byBoard.status).toBe(200);
    expect((byBoard.body.items as Array<Record<string, unknown>>).every((item) => item.board_slug === 'paid')).toBe(true);
    expect((byBoard.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(true);

    const otherBoard = await request(app).get('/api/v1/community/gallery/items?board_slug=general&limit=60');
    expect((otherBoard.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(false);

    const inRange = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&from=2026-01-01&to=2026-01-03&limit=60');
    expect((inRange.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(true);
    const tooLate = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&from=2026-01-03&limit=60');
    expect((tooLate.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(false);
    const tooEarly = await request(app).get('/api/v1/community/gallery/items?board_slug=paid&to=2026-01-01&limit=60');
    expect((tooEarly.body.items as Array<Record<string, unknown>>).some((item) => item.id === mediaId)).toBe(false);

    const anonymous = await request(app).get('/api/v1/community/gallery/items?limit=60');
    expect(anonymous.status).toBe(200); // 新筛选不影响匿名可读
    const lockedRows = (anonymous.body.items as Array<Record<string, unknown>>).filter((item) => item.locked === true);
    for (const row of lockedRows) expect(row.url).toBe(''); // 付费墙契约：锁定项地址仍为空
  });

  it('全站强制登录开启时：图库匿名可读，锁定规则不变', async () => {
    db.prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`media-${randomUUID()}`, PAID_THREAD, 'image', '/catalog/store.jpg', null, 0, new Date().toISOString()); // 种子付费帖补一条媒体，用于验证收藏门禁
    const guarded = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_FORCE_LOGIN: '1' }, storage });
    const list = await request(guarded).get('/api/v1/community/gallery/items?limit=20');
    expect(list.status).toBe(200); // 白名单内匿名可读
    expect(list.body.total).toBeGreaterThan(0);
    const collections = await request(guarded).get('/api/v1/community/gallery/collections?group=author&limit=20');
    expect(collections.status).toBe(200);
    const anonymousPaid = await request(guarded).get(`/api/v1/community/threads/${PAID_THREAD}`);
    expect(anonymousPaid.status).toBe(200); // 详情仍匿名可读，但媒体为空
    expect(anonymousPaid.body.thread.media).toEqual([]);
    const favorite = await request(guarded)
      .post(`/api/v1/community/gallery/items/${mediaIdOf(PAID_THREAD)}/favorite`)
      .set({ 'idempotency-key': randomUUID() });
    expect([401, 403]).toContain(favorite.status); // 收藏必须登录
  });
});
