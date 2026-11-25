/**
 * 「我的举报」契约测试：GET /api/v1/community/reports/mine
 *
 * 覆盖口径：
 *   ① 本人可见自己提交的社区举报，状态 / 理由 / 详情 / 时间字段完整；
 *   ② 看不到他人提交的举报单；
 *   ③ 匿名访问必须 401（私密读，不落入匿名可读白名单）；
 *   ④ 无举报记录时返回空列表 []，而不是报错。
 *
 * 数据源为社区举报表 community_reports（ReportDialog 写入的那张），
 * 与 security.ts 的 content_reports（安全审核域）语义不同，本用例不混用。
 */

import { randomUUID } from 'node:crypto'; // 幂等键：每个写请求独立，避免幂等中间件把用例当成回放
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // HTTP 断言客户端
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 真实 Express 应用，不 mock 路由
import { createDatabase } from '../src/db.js'; // 内存 SQLite
import type { Db } from '../src/types.js'; // 数据库类型
import { registerTestAccount, TEST_PASSWORD } from './_auth-helper.js'; // 注册 + 口令登录辅助

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 与其余社区用例保持同一密钥
let app: Express; // 被测应用
let db: Db; // 被测数据库

beforeEach(() => {
  db = createDatabase(':memory:'); // 内存库：每个用例独立，不跨例串数据
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 装配真实应用
});

/** 测试账号：令牌头 + 用户主键，便于直接落库关联本人单据 */
interface TestAuth {
  headers: Record<string, string>; // 鉴权请求头
  userId: string; // 用户主键
} // TestAuth 结束

/** 注册并登录，返回鉴权头与用户主键 */
async function auth(identifier: string): Promise<TestAuth> {
  const account = await registerTestAccount(app, identifier, TEST_PASSWORD); // 真实注册 + 口令登录
  return { headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' }, userId: account.userId }; // 头 + 主键一并交回
} // auth 结束

/** 写请求头：附带独立幂等键，避免不同用例被幂等中间件当成重复回放 */
function writeHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...headers, 'idempotency-key': randomUUID() }; // 合并鉴权头与幂等键
} // writeHeaders 结束

describe('GET /community/reports/mine：本人社区举报聚合', () => {
  it('本人可见自己的举报，状态 / 理由 / 详情 / 时间字段完整，open 归一化为 pending', async () => {
    const author = await auth('13800000051'); // 发帖人账号
    const threadRes = await request(app) // 作者发一篇普通帖，作为举报对象
      .post('/api/v1/community/threads')
      .set(writeHeaders(author.headers))
      .send({ board_slug: 'general', title: '我的举报-被举报帖', body: '内容用于举报记录回读与状态字段校验。', kind: 'text' });
    expect(threadRes.status).toBe(201); // 帖子创建成功
    const threadId = threadRes.body.thread_id as string; // 帖子主键

    const reporter = await auth('13800000052'); // 举报人账号
    const reportRes = await request(app) // 举报人提交一条社区举报
      .post('/api/v1/community/reports')
      .set(writeHeaders(reporter.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: 'spam', detail: '广告刷屏，需要复核' });
    expect(reportRes.status).toBe(201); // 举报入队成功

    // 直接补一条已处理（resolved）举报，覆盖处理动作 / 处理时间字段回读
    const now = new Date().toISOString(); // 统一时间戳
    db.prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `INSERT INTO community_reports (id, reporter_id, target_type, target_id, thread_id, board_id, reason, detail, status, resolution, created_at, resolved_at)
       VALUES (?, ?, 'thread', ?, ?, ?, 'abuse', '人身攻击补充说明', 'resolved', 'hide_thread', ?, ?)`,
    ).run(`report-${randomUUID()}`, reporter.userId, threadId, threadId, null, now, now);

    const mine = await request(app).get('/api/v1/community/reports/mine').set(reporter.headers); // 本人拉取举报列表
    expect(mine.status).toBe(200); // 私密读鉴权通过
    expect(mine.body.total).toBe(2); // 两条都归属本人
    expect(mine.body.items).toHaveLength(2); // 列表长度与总数一致

    const pending = mine.body.items.find((item: { reason: string }) => item.reason === 'spam'); // 待处理那条
    const resolved = mine.body.items.find((item: { reason: string }) => item.reason === 'abuse'); // 已处理那条
    expect(pending.status).toBe('pending'); // 库内 open 归一化为待处理 pending
    expect(pending.target_type).toBe('thread'); // 对象类型回读正确
    expect(pending.target_id).toBe(threadId); // 对象主键回读正确
    expect(pending.detail).toBe('广告刷屏，需要复核'); // 补充说明回读正确
    expect(pending.created_at).toBeTruthy(); // 提交时间存在
    expect(pending.resolved_at).toBeNull(); // 未处理，处理时间为空
    expect(resolved.status).toBe('resolved'); // 已处理状态原样透传
    expect(resolved.resolution).toBe('hide_thread'); // 处理动作回读正确
    expect(resolved.resolved_at).toBeTruthy(); // 处理时间存在
    expect(resolved.thread_title).toBe('我的举报-被举报帖'); // 归属帖子标题关联正确
  });

  it('看不到他人提交的举报单（只按 reporter_id 过滤）', async () => {
    const author = await auth('13800000053'); // 发帖人账号
    const threadRes = await request(app) // 建帖作为举报对象
      .post('/api/v1/community/threads')
      .set(writeHeaders(author.headers))
      .send({ board_slug: 'general', title: '他人举报-被举报帖', body: '用于隔离他人举报记录的测试帖子内容。', kind: 'text' });
    expect(threadRes.status).toBe(201); // 帖子创建成功
    const threadId = threadRes.body.thread_id as string; // 帖子主键

    const reporter = await auth('13800000054'); // 举报人账号
    const reportRes = await request(app) // 另一账号提交举报
      .post('/api/v1/community/reports')
      .set(writeHeaders(reporter.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: 'other', detail: '仅举报人本人可见这条举报' });
    expect(reportRes.status).toBe(201); // 举报入队成功

    const other = await auth('13800000055'); // 无关账号
    const mine = await request(app).get('/api/v1/community/reports/mine').set(other.headers); // 无关账号拉取
    expect(mine.status).toBe(200); // 鉴权通过
    expect(mine.body.items).toHaveLength(0); // 看不到他人单据
    expect(mine.body.total).toBe(0); // 总数为 0
  });

  it('匿名访问返回 401，不落库也不返回任何举报数据', async () => {
    const anonymous = await request(app).get('/api/v1/community/reports/mine'); // 不带鉴权头
    expect(anonymous.status).toBe(401); // 私密读必须拦截匿名
    expect(anonymous.body.code).toBe('AUTH_UNAUTHORIZED'); // 错误码与其余私密读一致
    expect(anonymous.body.items).toBeUndefined(); // 不泄露列表结构
  });

  it('无举报记录的账号返回空列表 []，而不是报错', async () => {
    const fresh = await auth('13800000056'); // 全新账号，从未举报
    const mine = await request(app).get('/api/v1/community/reports/mine').set(fresh.headers); // 拉取本人列表
    expect(mine.status).toBe(200); // 正常返回
    expect(mine.body.items).toEqual([]); // 空数组而非 null / 报错
    expect(mine.body.total).toBe(0); // 总数为 0
  });
});
