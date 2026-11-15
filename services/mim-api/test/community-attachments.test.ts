/** 契约测试：帖子附件位（上传 → 挂到帖子 → 按帖子权限签名下载） */

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
import { loginHeaders, registerTestAccount } from './_auth-helper.js'; // 注册 + 登录，返回鉴权头 / 账号

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥，JWT 与存储签名共用
const PAID_THREAD = 'thread-paid-store'; // 种子付费帖：未购买不可读

let app: Express; // 应用句柄
let db: ReturnType<typeof createDatabase>; // 直接查库构造夹带场景
let storageDir: string; // 每例独立存储目录
let storage: StorageAdapter; // 存储实例复用：需另建「强制登录开启」的应用副本

/** 把预签名绝对地址转成同源路径，便于 supertest 直接访问 */
function pathOf(url: string): string {
  const parsed = new URL(url); // 解析绝对地址
  return `${parsed.pathname}${parsed.search}`; // 保留路径与签名查询串
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

beforeEach(() => {
  db = createDatabase(':memory:');
  storageDir = mkdtempSync(join(tmpdir(), 'mim-attach-'));
  storage = createStorage({
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir },
    jwtSecret: JWT_SECRET,
    fallbackDir: storageDir,
  });
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage });
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true }); // 清理临时文件，避免 Windows 句柄残留
});

describe('帖子附件位', () => {
  it('作者挂附件：详情只回元数据，访客也能通过签名地址下载', async () => {
    const auth = await loginHeaders(app, '13700000201');
    const payload = Buffer.from('%PDF-1.4 attachment contract test');
    const objectKey = await uploadFile(auth, 'application/pdf', payload);

    const created = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...auth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '附件帖：规范文件',
        body: '这是一篇携带附件的帖子，正文长度满足发帖校验要求。',
        attachments: [{ name: '规范.pdf', object_key: objectKey, mime: 'application/pdf', size_bytes: 1 }],
      });
    expect(created.status).toBe(201);
    const threadId = created.body.thread_id as string;

    const detail = await request(app).get(`/api/v1/community/threads/${threadId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.thread.attachments).toHaveLength(1);
    expect(detail.body.thread.attachments[0].name).toBe('规范.pdf');
    expect(detail.body.thread.attachments[0].size_bytes).toBe(payload.byteLength); // 大小以存储实测为准
    expect(JSON.stringify(detail.body)).not.toContain(objectKey); // 详情绝不暴露对象键

    const signed = await request(app).get(`/api/v1/community/threads/${threadId}/attachments/${detail.body.thread.attachments[0].id}/download`);
    expect(signed.status).toBe(200); // 免费帖：匿名也能申请签名地址
    expect(signed.body.attachment.name).toBe('规范.pdf');

    const fetched = await request(app).get(pathOf(signed.body.download.url as string));
    expect(fetched.status).toBe(200);
    expect(Buffer.from(fetched.body)).toEqual(payload); // 签名地址能取回原字节
  });

  it('付费帖附件受付费墙约束：未购 / 匿名 403，作者可下', async () => {
    const authorAccount = await registerTestAccount(app, '13700000202'); // 付费帖作者
    const outsider = await loginHeaders(app, '13700000205'); // 已登录但未购买
    // 种子付费帖的作者不是测试账号：直接把作者改成测试账号，聚焦附件权限而非种子作者登录方式
    db.prepare('UPDATE community_threads SET author_id = ? WHERE id = ?').run(authorAccount.userId, PAID_THREAD);
    const authorAuth = { authorization: `Bearer ${authorAccount.token}`, 'content-type': 'application/json' };
    const objectKey = await uploadFile(authorAuth, 'application/zip', Buffer.from('paid-zip-bytes')); // 真实对象，才能通过 headObject 探测
    db.prepare(
      'INSERT INTO community_thread_attachments (id, thread_id, name, url, mime, size_bytes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(`att-${randomUUID()}`, PAID_THREAD, '付费资料.zip', objectKey, 'application/zip', 1024, 0, new Date().toISOString());
    const attachmentId = (db.prepare('SELECT id FROM community_thread_attachments WHERE thread_id = ?').get(PAID_THREAD) as { id: string }).id;

    const anonymous = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}/attachments/${attachmentId}/download`);
    expect(anonymous.status).toBe(403); // 未登录未购：附件与正文同一道付费墙
    const notBought = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}/attachments/${attachmentId}/download`).set(outsider);
    expect(notBought.status).toBe(403); // 已登录但未购买：同样拒绝
    const author = await request(app)
      .get(`/api/v1/community/threads/${PAID_THREAD}/attachments/${attachmentId}/download`)
      .set({ authorization: `Bearer ${authorAccount.token}` });
    expect(author.status).toBe(200); // 作者本人不受付费墙限制
  });

  it('不能把别人的对象键挂到自己的帖子', async () => {
    const owner = await loginHeaders(app, '13700000203');
    const stranger = await loginHeaders(app, '13700000204');
    const foreignKey = await uploadFile(owner, 'text/plain', Buffer.from('owned by another user'));

    const created = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...stranger, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '盗挂附件应被拒绝',
        body: '这篇帖子尝试引用他人的对象键，服务端必须拦截。',
        attachments: [{ name: '别人的.txt', object_key: foreignKey, mime: 'text/plain', size_bytes: 1 }],
      });
    expect(created.status).toBe(403); // 归属校验失败：拒绝入库
  });

  it('免费板块里的付费帖不因板块开放而放行附件：匿名 / 未购 403，作者 200', async () => {
    const authorAuth = await loginHeaders(app, '13700000206'); // 付费单帖作者
    const outsider = await loginHeaders(app, '13700000207'); // 已登录但未购买
    const objectKey = await uploadFile(authorAuth, 'application/pdf', Buffer.from('%PDF-1.4 paid-in-free-board'));

    const created = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general', // 免费公开板块：板块准入对匿名本来就成立
        title: '免费板块中的付费帖',
        body: '这篇帖子位于免费板块，但单帖收费，附件必须与正文同一道付费墙。',
        price_cents: 1900,
        attachments: [{ name: '付费资料.pdf', object_key: objectKey, mime: 'application/pdf', size_bytes: 1 }],
      });
    expect(created.status).toBe(201);
    const threadId = created.body.thread_id as string;
    const attachmentId = (db.prepare('SELECT id FROM community_thread_attachments WHERE thread_id = ?').get(threadId) as { id: string }).id;

    const anonymous = await request(app).get(`/api/v1/community/threads/${threadId}/attachments/${attachmentId}/download`);
    expect(anonymous.status).toBe(403); // 板块开放不等于单帖解锁：匿名不得拿到签名地址
    const notBought = await request(app).get(`/api/v1/community/threads/${threadId}/attachments/${attachmentId}/download`).set(outsider);
    expect(notBought.status).toBe(403); // 已登录未购同样拦下
    const author = await request(app).get(`/api/v1/community/threads/${threadId}/attachments/${attachmentId}/download`).set(authorAuth);
    expect(author.status).toBe(200); // 作者本人不受付费墙限制
    expect(author.body.attachment.name).toBe('付费资料.pdf');
  });

  it('全站强制登录开启时：免费帖附件匿名可下，付费帖仍 403', async () => {
    const guarded = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_FORCE_LOGIN: '1' }, storage }); // 复刻生产门禁
    const authorAuth = await loginHeaders(app, '13700000208');
    const freeKey = await uploadFile(authorAuth, 'text/plain', Buffer.from('force-login free attachment'));
    const free = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general',
        title: '强制登录下的免费附件帖',
        body: '正文长度满足发帖校验要求，用于验证全站门禁下的免费帖附件下载。',
        attachments: [{ name: '开放.txt', object_key: freeKey, mime: 'text/plain', size_bytes: 1 }],
      });
    expect(free.status).toBe(201);
    const freeId = free.body.thread_id as string;
    const freeAttachmentId = (db.prepare('SELECT id FROM community_thread_attachments WHERE thread_id = ?').get(freeId) as { id: string }).id;

    const freeAnonymous = await request(guarded).get(`/api/v1/community/threads/${freeId}/attachments/${freeAttachmentId}/download`);
    expect(freeAnonymous.status).toBe(200); // 全站门禁不得把免费帖附件挡成 401
    const freeBytes = await request(guarded).get(pathOf(freeAnonymous.body.download.url as string));
    expect(freeBytes.status).toBe(200); // 匿名拿到的签名地址可用
    expect(freeBytes.text).toBe('force-login free attachment'); // 签名地址能取回原字节

    const paidKey = await uploadFile(authorAuth, 'text/plain', Buffer.from('force-login paid attachment'));
    const paid = await request(app)
      .post('/api/v1/community/threads')
      .set({ ...authorAuth, 'idempotency-key': randomUUID() })
      .send({
        board_slug: 'general', // 免费板块里的付费单帖：过得了板块准入也过不了付费墙
        title: '强制登录下的付费附件帖',
        body: '免费板块中的付费单帖，附件必须被同一道付费墙拦住。',
        price_cents: 1900,
        attachments: [{ name: '付费.txt', object_key: paidKey, mime: 'text/plain', size_bytes: 1 }],
      });
    expect(paid.status).toBe(201);
    const paidId = paid.body.thread_id as string;
    const paidAttachmentId = (db.prepare('SELECT id FROM community_thread_attachments WHERE thread_id = ?').get(paidId) as { id: string }).id;

    const paidAnonymous = await request(guarded).get(`/api/v1/community/threads/${paidId}/attachments/${paidAttachmentId}/download`);
    expect(paidAnonymous.status).toBe(403); // 过了全站门禁也必须被付费墙拦下
  });
});
