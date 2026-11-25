/**
 * 申诉通道 + 成长规则公开 + 关注板块清单 契约测试（2026-11-25 批次）。
 *
 * 覆盖口径：
 *   ① 帖子 / 回复被处置后 7 天内可申诉一次；超窗口 400，重复申诉 409；
 *   ② 只能申诉本人内容，他人目标 403；未被处置内容不受理 400；
 *   ③ 我的申诉 / 关注板块为私密读，匿名 401；后台队列需 content:write，普通用户 403；
 *   ④ 受理 / 驳回写 audit_logs 并向申诉人发站内通知；申诉期间不改动目标内容状态；
 *   ⑤ GET /growth/rules 匿名 200，返回等级列表与积分来源（取既有配置，不新造数值）。
 */

import { randomUUID } from 'node:crypto'; // 幂等键：每个写请求独立，避免被幂等中间件当成回放
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // HTTP 断言客户端
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 真实 Express 应用，不 mock 路由
import { createDatabase } from '../src/db.js'; // 内存 SQLite
import type { Db } from '../src/types.js'; // 数据库类型
import { registerTestAccount, TEST_PASSWORD } from './_auth-helper.js'; // 注册 + 口令登录辅助

const JWT_SECRET = 'appeals-secret-0123456789abcdef0123456789'; // 固定测试密钥，与其余社区用例同口径
let app: Express; // 被测应用
let db: Db; // 被测数据库

beforeEach(() => {
  db = createDatabase(':memory:'); // 内存库：每个用例独立，不跨例串数据
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 装配真实应用
});

/** 测试账号：令牌头 + 用户主键 */
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

/** 把账号提升为内置超管：继承全部基线权限点，模拟后台复核人 */
function grantSuperadmin(userId: string): void {
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_code, granted_by, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, 'superadmin', 'test', new Date().toISOString()); // 绑定内置超管角色
} // grantSuperadmin 结束

/** 造一篇帖子并直接按测试需要隐藏；ageDays 为处置距今天数，0 表示刚处置 */
async function createHiddenThread(author: TestAuth, title: string, ageDays: number): Promise<string> {
  const res = await request(app) // 作者发帖，作为申诉对象
    .post('/api/v1/community/threads')
    .set(writeHeaders(author.headers))
    .send({ board_slug: 'general', title, body: '用于申诉窗口与归属校验的测试帖子内容。', kind: 'text' });
  expect(res.status).toBe(201); // 帖子创建成功
  const threadId = res.body.thread_id as string; // 帖子主键
  const disposedAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString(); // 处置时间：按天数回推
  db.prepare('UPDATE community_threads SET status = \'hidden\', updated_at = ? WHERE id = ?').run(disposedAt, threadId); // 直接置隐藏并写处置时间
  return threadId; // 交回帖子主键
} // createHiddenThread 结束

/** 造一条回复并软删；返回回复主键，作为回复申诉对象 */
async function createDeletedReply(author: TestAuth, threadId: string, ageDays = 0): Promise<string> {
  const res = await request(app) // 作者在自己帖下回复
    .post(`/api/v1/community/threads/${threadId}/reply`)
    .set(writeHeaders(author.headers))
    .send({ content: '用于回复申诉归属与窗口校验的测试内容。' });
  expect(res.status).toBe(201); // 回复发布成功
  const postId = res.body.id as string; // 回复主键
  const disposedAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString(); // 软删时间：按天数回推
  db.prepare('UPDATE community_posts SET deleted_at = ? WHERE id = ?').run(disposedAt, postId); // 直接软删
  return postId; // 交回回复主键
} // createDeletedReply 结束

describe('POST /community/appeals：提交申诉', () => {
  it('7 天窗口内本人隐藏帖申诉成功，返回申诉 id 与 pending 状态', async () => {
    const author = await auth('13800000061'); // 被处置帖作者
    const threadId = await createHiddenThread(author, '窗口内申诉帖', 0); // 刚处置，窗口内

    const res = await request(app) // 作者提交申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '帖子内容无误，请求恢复展示' });
    expect(res.status).toBe(201); // 申诉入队成功
    expect(res.body.id).toBeTruthy(); // 回申诉主键
    expect(res.body.status).toBe('pending'); // 初始状态待处理
  });

  it('超 7 天受理窗口返回 400，不写申诉单', async () => {
    const author = await auth('13800000062'); // 被处置帖作者
    const threadId = await createHiddenThread(author, '超期申诉帖', 8); // 8 天前处置，已超窗口

    const res = await request(app) // 超期提交申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '想恢复展示' });
    expect(res.status).toBe(400); // 窗口过期按校验失败拒绝
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 错误码与既有校验拒绝一致
    const count = db.prepare('SELECT COUNT(*) AS n FROM community_appeals WHERE target_id = ?').get(threadId) as { n: number }; // 回读落库条数
    expect(count.n).toBe(0); // 超期不入库
  });

  it('同一目标重复申诉返回 409', async () => {
    const author = await auth('13800000063'); // 被处置帖作者
    const threadId = await createHiddenThread(author, '重复申诉帖', 1); // 1 天前处置，窗口内

    const first = await request(app) // 第一次申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '第一次提交申诉' });
    expect(first.status).toBe(201); // 首次入队成功

    const second = await request(app) // 同一目标再次申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '第二次又想申诉' });
    expect(second.status).toBe(409); // 重复提交冲突拦截
    expect(second.body.code).toBe('CONFLICT'); // 错误码与既有重复拦截一致
  });

  it('非本人目标申诉返回 403', async () => {
    const owner = await auth('13800000064'); // 帖子作者
    const threadId = await createHiddenThread(owner, '他人申诉帖', 1); // 作者本人隐藏帖
    const stranger = await auth('13800000065'); // 无关账号

    const res = await request(app) // 陌生人对他人隐藏帖申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(stranger.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '我觉得该恢复' });
    expect(res.status).toBe(403); // 归属校验拒绝
    expect(res.body.code).toBe('FORBIDDEN'); // 错误码与既有越权拒绝一致
  });

  it('未被处置的内容申诉返回 400', async () => {
    const author = await auth('13800000066'); // 发帖人
    const res = await request(app) // 作者发一篇正常帖（未隐藏）
      .post('/api/v1/community/threads')
      .set(writeHeaders(author.headers))
      .send({ board_slug: 'general', title: '正常未隐藏帖', body: '内容未被处置，不应受理申诉。', kind: 'text' });
    expect(res.status).toBe(201); // 帖子创建成功
    const threadId = res.body.thread_id as string; // 帖子主键

    const appeal = await request(app) // 对未处置帖申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '想申诉未隐藏的帖子' });
    expect(appeal.status).toBe(400); // 未处置不受理
    expect(appeal.body.code).toBe('VALIDATION_FAILED'); // 校验失败错误码
  });

  it('回复被软删后本人可在窗口内申诉', async () => {
    const author = await auth('13800000067'); // 回复作者
    const threadId = await createHiddenThread(author, '回复申诉所属帖', 0); // 先有一篇归属帖
    const postId = await createDeletedReply(author, threadId, 1); // 回复 1 天前被软删

    const res = await request(app) // 作者对被删回复申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'reply', target_id: postId, reason: '回复被误删，请求恢复' });
    expect(res.status).toBe(201); // 回复申诉入队成功
    expect(res.body.status).toBe('pending'); // 初始待处理
  });

  it('匿名提交申诉返回 401，不落库', async () => {
    const res = await request(app) // 不带鉴权头
      .post('/api/v1/community/appeals')
      .send({ target_type: 'thread', target_id: 'thread-anon', reason: '匿名想申诉' });
    expect(res.status).toBe(401); // 写操作登录门禁拦截
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 统一未登录错误码
    const count = db.prepare('SELECT COUNT(*) AS n FROM community_appeals').get() as { n: number }; // 回读全表条数
    expect(count.n).toBe(0); // 匿名未产生申诉单
  });
});

describe('GET /community/appeals/mine：本人申诉列表', () => {
  it('本人可见自己的申诉，字段完整；匿名 401', async () => {
    const author = await auth('13800000068'); // 申诉人
    const threadId = await createHiddenThread(author, '本人列表校验帖', 2); // 2 天前隐藏
    const appeal = await request(app) // 提交一条申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '列表回读校验理由' });
    expect(appeal.status).toBe(201); // 申诉入队成功

    const mine = await request(app).get('/api/v1/community/appeals/mine').set(author.headers); // 本人拉取列表
    expect(mine.status).toBe(200); // 私密读鉴权通过
    expect(mine.body.total).toBe(1); // 只回本人一条
    const item = mine.body.items[0]; // 首条即刚提交的申诉
    expect(item.target_type).toBe('thread'); // 对象类型回读正确
    expect(item.target_id).toBe(threadId); // 对象主键回读正确
    expect(item.reason).toBe('列表回读校验理由'); // 理由回读正确
    expect(item.status).toBe('pending'); // 状态回读待处理
    expect(item.created_at).toBeTruthy(); // 提交时间存在
    expect(item.handled_at).toBeNull(); // 未处理，处理时间为空

    const anonymous = await request(app).get('/api/v1/community/appeals/mine'); // 匿名访问
    expect(anonymous.status).toBe(401); // 私密读必须拦截匿名
    expect(anonymous.body.code).toBe('AUTH_UNAUTHORIZED'); // 统一未登录错误码
  });
});

describe('GET /admin/appeals + PUT /admin/appeals/:id：后台复核', () => {
  it('普通用户访问后台队列 403；超管可见待处理队列', async () => {
    const author = await auth('13800000069'); // 申诉人
    const threadId = await createHiddenThread(author, '后台队列校验帖', 1); // 1 天前隐藏
    await request(app) // 提交申诉入队
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '等待后台复核' });

    const plain = await auth('13800000070'); // 普通账号，无后台权限
    const plainRes = await request(app).get('/api/v1/admin/appeals').set(plain.headers); // 普通用户拉队列
    expect(plainRes.status).toBe(403); // 权限不足拦截
    expect(plainRes.body.code).toBe('FORBIDDEN'); // 权限拒绝错误码

    const admin = await auth('13800000071'); // 后台复核人
    grantSuperadmin(admin.userId); // 提升为超管，继承全部权限点
    const adminRes = await request(app).get('/api/v1/admin/appeals').set(admin.headers); // 超管拉队列
    expect(adminRes.status).toBe(200); // 权限通过
    expect(adminRes.body.total).toBeGreaterThanOrEqual(1); // 队列能看到待处理申诉
    const queueItem = adminRes.body.items.find((row: { target_id: string }) => row.target_id === threadId); // 定位本条
    expect(queueItem.status).toBe('pending'); // 队列初始待处理
    expect(queueItem.user_name).toBeTruthy(); // 申诉人昵称已联表带出
  });

  it('受理申诉：状态流转 accepted、写审计、发站内回执，目标内容不被恢复', async () => {
    const author = await auth('13800000072'); // 申诉人
    const threadId = await createHiddenThread(author, '受理复核帖', 1); // 1 天前隐藏
    const appeal = await request(app) // 提交申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '受理路径校验' });
    const appealId = appeal.body.id as string; // 申诉主键

    const admin = await auth('13800000073'); // 后台复核人
    grantSuperadmin(admin.userId); // 提升超管
    const review = await request(app) // 受理并附处理说明
      .put(`/api/v1/admin/appeals/${appealId}`)
      .set(writeHeaders(admin.headers))
      .send({ decision: 'accept', note: '复核成立，按规则恢复展示。' });
    expect(review.status).toBe(200); // 流转成功
    expect(review.body.status).toBe('accepted'); // 状态回读已受理

    // 审计留痕：动作码 / 对象 / 结果齐备
    const audit = db.prepare("SELECT action, target, result FROM audit_logs WHERE action = 'community.appeal.review'").all() as Array<{ action: string; target: string; result: string }>; // 回读审计行
    expect(audit).toHaveLength(1); // 一次处理一条审计
    expect(audit[0].target).toBe(`appeal:${appealId}`); // 对象定位到申诉单
    expect(audit[0].result).toBe('success'); // 成功结果留痕

    // 站内通知回执申诉人：kind=appeal，关联归属帖
    const notice = db.prepare('SELECT user_id, kind, thread_id, content FROM community_notifications WHERE user_id = ? AND kind = ?').get(author.userId, 'appeal') as { user_id: string; kind: string; thread_id: string | null; content: string } | undefined; // 回读通知行
    expect(notice).toBeTruthy(); // 回执已落库
    expect(notice!.thread_id).toBe(threadId); // 通知关联归属帖子
    expect(notice!.content).toContain('受理'); // 回执文案含受理结论

    // 保守口径：申诉受理不自动恢复目标内容，帖子仍保持 hidden
    const thread = db.prepare('SELECT status FROM community_threads WHERE id = ?').get(threadId) as { status: string }; // 回读帖子状态
    expect(thread.status).toBe('hidden'); // 内容状态未被申诉流程改动
  });

  it('驳回申诉：状态流转 rejected、写审计、回执申诉人', async () => {
    const author = await auth('13800000074'); // 申诉人
    const threadId = await createHiddenThread(author, '驳回复核帖', 2); // 2 天前隐藏
    const appeal = await request(app) // 提交申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '驳回路径校验' });
    const appealId = appeal.body.id as string; // 申诉主键

    const admin = await auth('13800000075'); // 后台复核人
    grantSuperadmin(admin.userId); // 提升超管
    const review = await request(app) // 驳回并附说明
      .put(`/api/v1/admin/appeals/${appealId}`)
      .set(writeHeaders(admin.headers))
      .send({ decision: 'reject', note: '复核后原处置维持不变。' });
    expect(review.status).toBe(200); // 流转成功
    expect(review.body.status).toBe('rejected'); // 状态回读已驳回

    const audit = db.prepare("SELECT action FROM audit_logs WHERE action = 'community.appeal.review'").all(); // 回读审计
    expect(audit).toHaveLength(1); // 驳回同样留痕
    const notice = db.prepare('SELECT content FROM community_notifications WHERE user_id = ? AND kind = ?').get(author.userId, 'appeal') as { content: string } | undefined; // 回读回执
    expect(notice!.content).toContain('驳回'); // 回执文案含驳回结论
  });

  it('已结案申诉重复流转返回 409', async () => {
    const author = await auth('13800000076'); // 申诉人
    const threadId = await createHiddenThread(author, '重复流转帖', 1); // 1 天前隐藏
    const appeal = await request(app) // 提交申诉
      .post('/api/v1/community/appeals')
      .set(writeHeaders(author.headers))
      .send({ target_type: 'thread', target_id: threadId, reason: '重复流转校验' });
    const appealId = appeal.body.id as string; // 申诉主键

    const admin = await auth('13800000077'); // 后台复核人
    grantSuperadmin(admin.userId); // 提升超管
    const first = await request(app) // 第一次受理
      .put(`/api/v1/admin/appeals/${appealId}`)
      .set(writeHeaders(admin.headers))
      .send({ decision: 'accept', note: '第一次处理' });
    expect(first.status).toBe(200); // 首次流转成功
    const second = await request(app) // 再次流转同一单据
      .put(`/api/v1/admin/appeals/${appealId}`)
      .set(writeHeaders(admin.headers))
      .send({ decision: 'reject', note: '想改判' });
    expect(second.status).toBe(409); // 已结案不可重复流转
    expect(second.body.code).toBe('CONFLICT'); // 冲突错误码
  });
});

describe('GET /community/follows/boards：本人关注板块清单', () => {
  it('匿名 401；登录后回本人关注的板块名称 / slug / 成员数', async () => {
    const anonymous = await request(app).get('/api/v1/community/follows/boards'); // 不带鉴权头
    expect(anonymous.status).toBe(401); // 关注关系私密，匿名拦截
    expect(anonymous.body.code).toBe('AUTH_UNAUTHORIZED'); // 统一未登录错误码

    const member = await auth('13800000078'); // 登录用户
    const board = db.prepare("SELECT id FROM community_boards WHERE slug = 'general'").get() as { id: string } | undefined; // 取种子板块主键
    expect(board).toBeTruthy(); // 种子板块存在
    db.prepare('INSERT INTO community_board_follows (board_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(board!.id, member.userId, new Date().toISOString()); // 直接落一条关注记录

    const res = await request(app).get('/api/v1/community/follows/boards').set(member.headers); // 登录后拉清单
    expect(res.status).toBe(200); // 私密读鉴权通过
    expect(res.body.total).toBe(1); // 只回本人关注的板块
    const row = res.body.boards[0]; // 首条即关注的板块
    expect(row.slug).toBe('general'); // slug 回读正确
    expect(row.name).toBeTruthy(); // 板块名称存在
    expect(typeof row.member_count).toBe('number'); // 成员数为数值口径
  });
});

describe('GET /growth/rules：成长与积分规则公开', () => {
  it('匿名 200，返回等级列表与积分来源，不含个人数据', async () => {
    const res = await request(app).get('/api/v1/growth/rules'); // 不带鉴权头，匿名可读
    expect(res.status).toBe(200); // 公开读放行
    expect(Array.isArray(res.body.levels)).toBe(true); // 等级列表存在
    expect(res.body.levels.length).toBeGreaterThan(0); // 种子等级非空
    const level = res.body.levels[0]; // 首条等级
    expect(level.name).toBeTruthy(); // 等级名称公开
    expect(typeof level.min_points).toBe('number'); // 门槛为数值
    expect(Array.isArray(res.body.sources)).toBe(true); // 积分来源清单存在
    const checkin = res.body.sources.find((s: { key: string }) => s.key === 'checkin'); // 签到来源
    expect(checkin).toBeTruthy(); // 签到规则已配置并公开
    expect(typeof checkin.points).toBe('number'); // 签到分值取既有配置
    expect(res.body.rules.checkin.base_points).toBeGreaterThanOrEqual(0); // 签到基础分非负
  });
});
