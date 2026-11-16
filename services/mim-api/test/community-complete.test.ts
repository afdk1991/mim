/**
 * 契约测试：社区完整性补齐
 *   覆盖：列表真分页 / 置顶排序 / 作者编辑 / 楼中楼与回复锁定 / 回复软删计数回退
 *        / 全文搜索高亮 / 站内通知未读流转 / 举报与版主治理。
 *   付费帖与作者免购口径由 community-paid.test.ts 单独守护，本文件只验证编辑改价后不被绕过。
 */

import { randomUUID } from 'node:crypto'; // 写操作幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 被测应用
import { createDatabase } from '../src/db.js'; // 内存库 + 种子
import { registerTestAccount } from './_auth-helper.js'; // 注册并拿令牌

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const API = '/api/v1/community'; // 社区路由前缀

let app: Express; // 应用句柄
let db: ReturnType<typeof createDatabase>; // 直接改库做前置条件

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} });
});

/** 写操作统一带幂等键，避免重复提交被中间件拦截 */
function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() };
}

/** 令牌转鉴权头 */
function authWith(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

/** 在综合讨论板块发一帖，返回帖子 id；可按需覆盖字段 */
async function createThread(auth: Record<string, string>, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app)
    .post(`${API}/threads`)
    .set(writeHeaders(auth))
    .send({
      board_slug: 'general',
      title: '社区补齐契约测试帖',
      summary: '用于校验社区完整性的测试摘要',
      body: '这是一段足够长的测试正文，用于校验发帖、编辑与检索链路。',
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.thread_id as string;
}

describe('社区完整性', () => {
  it('列表：真分页返回总数，翻页之间不重复', async () => {
    const auth = await loginHeadersOf('13900000101');

    const first = await request(app).get(`${API}/threads?limit=2`).set(auth);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(17); // 种子共 17 帖（6 条原有 + 11 条指南/示例），total 是过滤后的总量而非本页条数
    expect(first.body.items).toHaveLength(2);
    expect(first.body.limit).toBe(2);
    expect(first.body.offset).toBe(0);

    const second = await request(app).get(`${API}/threads?limit=2&offset=2`).set(auth);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(2);
    const ids = new Set([...first.body.items, ...second.body.items].map((row: { id: string }) => row.id));
    expect(ids.size).toBe(4); // 两页无重叠
  });

  it('置顶：版主置顶后排到列表首位，取消后回到时间序', async () => {
    const mod = await registerTestAccount(app, '13900000102');
    const auth = authWith(mod.token);
    // 种子板块没有版主，先授予「公告」板块版主身份
    db.prepare("UPDATE community_boards SET moderator_id = ? WHERE slug = 'announce'").run(mod.userId);

    const pin = await request(app)
      .post(`${API}/threads/thread-announce/moderate`)
      .set(writeHeaders(auth))
      .send({ action: 'pin' });
    expect(pin.status).toBe(200);

    const pinned = await request(app).get(`${API}/threads?limit=50`).set(auth);
    expect(pinned.body.items[0].id).toBe('thread-announce'); // 置顶优先于活跃时间
    expect(pinned.body.items[0].pinned).toBe(1);

    const unpin = await request(app)
      .post(`${API}/threads/thread-announce/moderate`)
      .set(writeHeaders(auth))
      .send({ action: 'unpin' });
    expect(unpin.status).toBe(200);

    const after = await request(app).get(`${API}/threads?limit=50`).set(auth);
    expect(after.body.items[0].id).not.toBe('thread-announce');
  });

  it('编辑：只有作者能改，改价后付费墙与作者免购口径不变', async () => {
    const author = await registerTestAccount(app, '13900000103');
    const other = await registerTestAccount(app, '13900000104');
    const threadId = await createThread(authWith(author.token));

    const denied = await request(app)
      .patch(`${API}/threads/${threadId}`)
      .set(writeHeaders(authWith(other.token)))
      .send({ title: '非作者尝试修改标题' });
    expect(denied.status).toBe(403);

    const edited = await request(app)
      .patch(`${API}/threads/${threadId}`)
      .set(writeHeaders(authWith(author.token)))
      .send({
        title: '作者编辑后的标题',
        body: '作者更新后的正文内容，用于验证编辑确实写回数据库并生效。',
      });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe('作者编辑后的标题');

    const asAuthor = await request(app).get(`${API}/threads/${threadId}`).set(authWith(author.token));
    expect(asAuthor.body.thread.can_edit).toBe(true);
    expect(asAuthor.body.thread.title).toBe('作者编辑后的标题');
    expect(asAuthor.body.thread.body).toContain('作者更新后的正文内容');

    // 付费帖直接落到付费板块：验证作者调价不会让未购用户绕过付费墙
    const paidId = `thread-edit-paid-${Date.now()}`;
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO community_threads
         (id, board_id, author_id, title, summary, body, kind, price_cents, status, views, likes, reply_count, recommend_score, created_at, updated_at, last_activity_at)
       VALUES (?, 'board-paid', ?, ?, ?, ?, 'text', 700, 'published', 0, 0, 0, 0, ?, ?, ?)`,
    ).run(
      paidId,
      author.userId,
      '作者待调价的付费帖',
      '调整价格',
      '作者自己可见的付费正文，未购用户不可读。',
      ts,
      ts,
      ts,
    );

    const repriced = await request(app)
      .patch(`${API}/threads/${paidId}`)
      .set(writeHeaders(authWith(author.token)))
      .send({ price_cents: 900 });
    expect(repriced.status).toBe(200);
    expect(repriced.body.price_cents).toBe(900);

    const paidAsAuthor = await request(app).get(`${API}/threads/${paidId}`).set(authWith(author.token));
    expect(paidAsAuthor.body.unlocked).toBe(true); // 作者免购仍然成立
    expect(paidAsAuthor.body.thread.body.length).toBeGreaterThan(10);

    const paidAsOther = await request(app).get(`${API}/threads/${paidId}`).set(authWith(other.token));
    expect(paidAsOther.body.unlocked).toBe(false);
    expect(paidAsOther.body.thread.locked).toBe(true);
    expect(paidAsOther.body.thread.body).toBe(''); // 调价后付费墙依然生效
  });

  it('回复：楼中楼 parent_id 生效，锁定后拒绝新回复', async () => {
    const author = await registerTestAccount(app, '13900000105');
    const replier = await registerTestAccount(app, '13900000106');
    const threadId = await createThread(authWith(author.token));

    const first = await request(app)
      .post(`${API}/threads/${threadId}/reply`)
      .set(writeHeaders(authWith(replier.token)))
      .send({ content: '一楼回复内容' });
    expect(first.status).toBe(201);

    const afterFirst = await request(app).get(`${API}/threads/${threadId}`).set(authWith(author.token));
    expect(afterFirst.body.posts_total).toBe(1);
    const parentId = afterFirst.body.posts[0].id as string;

    const nested = await request(app)
      .post(`${API}/threads/${threadId}/reply`)
      .set(writeHeaders(authWith(replier.token)))
      .send({ content: '楼中楼回复内容', parent_id: parentId });
    expect(nested.status).toBe(201);

    const afterNested = await request(app).get(`${API}/threads/${threadId}`).set(authWith(author.token));
    expect(afterNested.body.posts_total).toBe(2);
    expect(afterNested.body.posts[1].parent_id).toBe(parentId); // 楼中楼引用关系落库

    const lock = await request(app)
      .post(`${API}/threads/${threadId}/moderate`)
      .set(writeHeaders(authWith(author.token)))
      .send({ action: 'lock' });
    expect(lock.status).toBe(200);

    const blocked = await request(app)
      .post(`${API}/threads/${threadId}/reply`)
      .set(writeHeaders(authWith(replier.token)))
      .send({ content: '锁帖后仍想回复' });
    expect(blocked.status).toBe(403);

    const lockedDetail = await request(app).get(`${API}/threads/${threadId}`).set(authWith(author.token));
    expect(lockedDetail.body.thread.reply_locked).toBe(true);

    const unlock = await request(app)
      .post(`${API}/threads/${threadId}/moderate`)
      .set(writeHeaders(authWith(author.token)))
      .send({ action: 'unlock' });
    expect(unlock.status).toBe(200);
    const reopened = await request(app)
      .post(`${API}/threads/${threadId}/reply`)
      .set(writeHeaders(authWith(replier.token)))
      .send({ content: '解锁后的回复内容' });
    expect(reopened.status).toBe(201);
  });

  it('回复软删：作者或版主可删，计数回退且详情不再返回', async () => {
    const author = await registerTestAccount(app, '13900000107');
    const replier = await registerTestAccount(app, '13900000108');
    const outsider = await registerTestAccount(app, '13900000109');
    const threadId = await createThread(authWith(author.token));

    await request(app)
      .post(`${API}/threads/${threadId}/reply`)
      .set(writeHeaders(authWith(replier.token)))
      .send({ content: '待删除的回复内容' });
    const before = await request(app).get(`${API}/threads/${threadId}`).set(authWith(author.token));
    expect(before.body.posts_total).toBe(1);
    expect(before.body.thread.reply_count).toBe(1);
    const postId = before.body.posts[0].id as string;

    const denied = await request(app).delete(`${API}/posts/${postId}`).set(writeHeaders(authWith(outsider.token)));
    expect(denied.status).toBe(403);

    const deleted = await request(app).delete(`${API}/posts/${postId}`).set(writeHeaders(authWith(replier.token)));
    expect(deleted.status).toBe(200);

    const after = await request(app).get(`${API}/threads/${threadId}`).set(authWith(author.token));
    expect(after.body.posts_total).toBe(0); // 已删回复不计入总数
    expect(after.body.posts).toHaveLength(0);
    expect(after.body.thread.reply_count).toBe(0); // 回帖数同步回退

    const again = await request(app).delete(`${API}/posts/${postId}`).set(writeHeaders(authWith(replier.token)));
    expect(again.status).toBe(200); // 重复删除幂等，不重复扣数
    expect((db.prepare('SELECT reply_count FROM community_threads WHERE id = ?').get(threadId) as { reply_count: number }).reply_count).toBe(0);
  });

  it('搜索：正文命中、<mark> 高亮、空词拒绝', async () => {
    const author = await registerTestAccount(app, '13900000110');
    const auth = authWith(author.token);
    const keyword = '量子纠缠布丁';
    const threadId = await createThread(auth, {
      title: '搜索契约测试帖',
      body: `这段正文里埋了${keyword}这个独有词，用来验证搜索会命中正文并高亮命中片段。`,
    });

    const hit = await request(app).get(`${API}/search?q=${encodeURIComponent(keyword)}`).set(auth);
    expect(hit.status).toBe(200);
    expect(hit.body.total).toBe(1);
    expect(hit.body.items[0].id).toBe(threadId);
    expect(hit.body.items[0].snippet).toContain('<mark>'); // 服务端已转义后再插高亮标签
    expect(hit.body.items[0].snippet).toContain(keyword);

    const miss = await request(app).get(`${API}/search?q=${encodeURIComponent('绝对不存在的检索词xyz')}`).set(auth);
    expect(miss.body.total).toBe(0);

    const empty = await request(app).get(`${API}/search?q=`).set(auth);
    expect(empty.status).toBe(400); // 空关键词直接拒绝
  });

  it('通知：回复产生未读，标记已读后归零，不自通知', async () => {
    const author = await registerTestAccount(app, '13900000111');
    const replier = await registerTestAccount(app, '13900000112');
    const threadId = await createThread(authWith(author.token));

    await request(app)
      .post(`${API}/threads/${threadId}/reply`)
      .set(writeHeaders(authWith(replier.token)))
      .send({ content: '触发楼主通知的回复' });

    const inbox = await request(app).get(`${API}/notifications`).set(authWith(author.token));
    expect(inbox.status).toBe(200);
    expect(inbox.body.unread).toBe(1);
    expect(inbox.body.items[0].kind).toBe('reply');
    expect(inbox.body.items[0].thread_id).toBe(threadId);

    const unreadOnly = await request(app).get(`${API}/notifications?unread=1`).set(authWith(author.token));
    expect(unreadOnly.body.total).toBe(1);

    const read = await request(app)
      .post(`${API}/notifications/read`)
      .set(writeHeaders(authWith(author.token)))
      .send({ ids: [inbox.body.items[0].id] });
    expect(read.status).toBe(200);
    expect(read.body.unread).toBe(0);

    const cleared = await request(app).get(`${API}/notifications?unread=1`).set(authWith(author.token));
    expect(cleared.body.total).toBe(0);

    const replierInbox = await request(app).get(`${API}/notifications`).set(authWith(replier.token));
    expect(replierInbox.body.unread).toBe(0); // 自己回复自己不产生通知
  });

  it('举报与治理：重复举报幂等、非版主不可见、处理后可删帖删回复', async () => {
    const mod = await registerTestAccount(app, '13900000113');
    const author = await registerTestAccount(app, '13900000114');
    const reporter = await registerTestAccount(app, '13900000115');
    const replier = await registerTestAccount(app, '13900000116');
    db.prepare("UPDATE community_boards SET moderator_id = ? WHERE slug = 'general'").run(mod.userId);

    const threadId = await createThread(authWith(author.token));

    const report = await request(app)
      .post(`${API}/reports`)
      .set(writeHeaders(authWith(reporter.token)))
      .send({ target_type: 'thread', target_id: threadId, reason: 'spam', detail: '疑似广告' });
    expect(report.status).toBe(201);

    const duplicate = await request(app)
      .post(`${API}/reports`)
      .set(writeHeaders(authWith(reporter.token)))
      .send({ target_type: 'thread', target_id: threadId, reason: 'spam' });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true); // 同一人同一对象只保留一条待处理

    const forbidden = await request(app).get(`${API}/boards/general/reports`).set(authWith(author.token));
    expect(forbidden.status).toBe(403); // 非版主不能看举报工作台

    const queue = await request(app).get(`${API}/boards/general/reports`).set(authWith(mod.token));
    expect(queue.status).toBe(200);
    expect(queue.body.total).toBe(1);
    expect(queue.body.items[0].reason).toBe('spam');
    expect(queue.body.items[0].thread_title).toBe('社区补齐契约测试帖');

    const resolved = await request(app)
      .post(`${API}/reports/${report.body.id}/resolve`)
      .set(writeHeaders(authWith(mod.token)))
      .send({ action: 'dismiss' });
    expect(resolved.status).toBe(200);

    const openQueue = await request(app).get(`${API}/boards/general/reports?status=open`).set(authWith(mod.token));
    expect(openQueue.body.total).toBe(0);
    const dismissedQueue = await request(app).get(`${API}/boards/general/reports?status=dismissed`).set(authWith(mod.token));
    expect(dismissedQueue.body.total).toBe(1);

    const reporterInbox = await request(app).get(`${API}/notifications`).set(authWith(reporter.token));
    expect(reporterInbox.body.items.some((row: { kind: string }) => row.kind === 'report')).toBe(true); // 处理结果回执举报人

    // 回复举报 → 版主执行删除：帖子回复数与总数同步回退
    await request(app)
      .post(`${API}/threads/${threadId}/reply`)
      .set(writeHeaders(authWith(replier.token)))
      .send({ content: '这条回复稍后会被举报并删除' });
    const withReply = await request(app).get(`${API}/threads/${threadId}`).set(authWith(mod.token));
    const replyId = withReply.body.posts[0].id as string;

    const postReport = await request(app)
      .post(`${API}/reports`)
      .set(writeHeaders(authWith(reporter.token)))
      .send({ target_type: 'post', target_id: replyId, reason: 'abuse' });
    expect(postReport.status).toBe(201);

    const handle = await request(app)
      .post(`${API}/reports/${postReport.body.id}/resolve`)
      .set(writeHeaders(authWith(mod.token)))
      .send({ action: 'delete_post' });
    expect(handle.status).toBe(200);

    const afterDelete = await request(app).get(`${API}/threads/${threadId}`).set(authWith(mod.token));
    expect(afterDelete.body.posts_total).toBe(0);
    expect(afterDelete.body.thread.reply_count).toBe(0);
  });

  it('治理：版主隐藏后列表不可见、恢复后重新出现', async () => {
    const mod = await registerTestAccount(app, '13900000117');
    const author = await registerTestAccount(app, '13900000118');
    db.prepare("UPDATE community_boards SET moderator_id = ? WHERE slug = 'general'").run(mod.userId);
    const threadId = await createThread(authWith(author.token));

    const hide = await request(app)
      .post(`${API}/threads/${threadId}/moderate`)
      .set(writeHeaders(authWith(mod.token)))
      .send({ action: 'hide' });
    expect(hide.status).toBe(200);

    const hiddenList = await request(app).get(`${API}/threads?limit=50`).set(authWith(mod.token));
    expect(hiddenList.body.items.some((row: { id: string }) => row.id === threadId)).toBe(false);

    const restore = await request(app)
      .post(`${API}/threads/${threadId}/moderate`)
      .set(writeHeaders(authWith(mod.token)))
      .send({ action: 'restore' });
    expect(restore.status).toBe(200);

    const visible = await request(app).get(`${API}/threads?limit=50`).set(authWith(mod.token));
    expect(visible.body.items.some((row: { id: string }) => row.id === threadId)).toBe(true);
  });
});

/** 注册并返回鉴权头（每个用例使用独立手机号，内存库互不影响） */
async function loginHeadersOf(phone: string): Promise<Record<string, string>> {
  const account = await registerTestAccount(app, phone);
  return authWith(account.token);
}
