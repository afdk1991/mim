/**
 * 社区浏览量契约测试：
 *   1. 同一账号首次打开详情 +1，刷新（重复请求）不再累加；
 *   2. 另一个账号首次打开再 +1，浏览量按独立账号口径统计；
 *   3. 详情响应里的 views 与数据库同源，不出现「多加一次」的写死值。
 */

import { randomUUID } from 'node:crypto'; // 幂等键：每个写请求独立，避免幂等中间件把用例当成回放
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // HTTP 断言客户端
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 真实 Express 应用，不 mock 路由
import { createDatabase } from '../src/db.js'; // 内存 SQLite
import type { Db } from '../src/types.js'; // 数据库类型
import { loginHeaders } from './_auth-helper.js'; // 注册 + 口令登录辅助

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 与其余社区用例保持同一密钥
let app: Express; // 被测应用
let db: Db; // 被测数据库

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} });
});

/** 写请求头：附带独立幂等键，避免不同用例被幂等中间件当成重复回放 */
function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() };
}

describe('社区浏览量：真实累加 + 账号去重', () => {
  it('首次打开 +1，同一账号重复打开不累加，换账号再 +1，且与库内一致', async () => {
    const author = await loginHeaders(app, '13800000041'); // 作者账号
    const created = await request(app)
      .post('/api/v1/community/threads')
      .set(writeHeaders(author))
      .send({
        board_slug: 'general',
        title: '浏览量口径验证帖',
        body: '用于验证浏览计数：同一账号只计一次，不同账号分别计数。',
        kind: 'text',
      });
    expect(created.status).toBe(201);
    const threadId = created.body.thread_id as string;

    // 作者发布后自己打开一次：记为 1
    const first = await request(app).get(`/api/v1/community/threads/${threadId}`).set(author);
    expect(first.status).toBe(200);
    expect(first.body.thread.views).toBe(1);

    // 同一账号刷新：去重账本命中，浏览量保持不变
    const refresh = await request(app).get(`/api/v1/community/threads/${threadId}`).set(author);
    expect(refresh.body.thread.views).toBe(1);

    // 第二个账号首次打开：再 +1
    const second = await loginHeaders(app, '13800000042');
    const other = await request(app).get(`/api/v1/community/threads/${threadId}`).set(second);
    expect(other.body.thread.views).toBe(2);

    // 数据库同源校验：帖子 views=2，去重账本 2 行
    const row = db.prepare('SELECT views FROM community_threads WHERE id = ?').get(threadId) as { views: number };
    expect(row.views).toBe(2);
    const counted = db.prepare('SELECT COUNT(*) AS total FROM community_thread_views WHERE thread_id = ?').get(threadId) as { total: number };
    expect(counted.total).toBe(2);
  });
});
