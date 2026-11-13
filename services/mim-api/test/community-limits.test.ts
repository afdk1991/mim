/**
 * 契约测试：社区三期（关注后可见 / 发帖频控 / 建板块限制与审核队列 / 论坛设为首页 /
 * Tab 栏目组合 / 推荐指数与评分收藏排序 / 付费板块种子 / 推荐权重配置）。
 *
 * 每个用例 beforeEach 重建内存 SQLite 与真实 Express 应用，不 mock 业务路由；
 * 写请求均带独立 Idempotency-Key。管理端点走 x-admin-token 引导通道（等同全权限）。
 */

import { randomUUID } from 'node:crypto'; // 引入依赖：声明本文件使用的外部能力
import { beforeEach, describe, expect, it } from 'vitest'; // 引入依赖：声明本文件使用的外部能力
import request from 'supertest'; // 引入依赖：声明本文件使用的外部能力
import type { Express } from 'express'; // 引入依赖：声明本文件使用的外部能力
import { createApp } from '../src/app.js'; // 引入依赖：声明本文件使用的外部能力
import { createDatabase } from '../src/db.js'; // 引入依赖：声明本文件使用的外部能力
import type { Db } from '../src/types.js'; // 引入依赖：声明本文件使用的外部能力
import { createCaptcha, captchaHash } from '../src/security.js'; // 图形验证码造数（post 场景开关验证）

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 保存 JWT_SECRET：承载本步骤的计算结果供后续使用
const ADMIN_PASSWORD = 'testpass123'; // 保存 ADMIN_PASSWORD：承载本步骤的计算结果供后续使用
const ADMIN_TOKEN = 'test-admin-token-0123456789'; // 保存 ADMIN_TOKEN：承载本步骤的计算结果供后续使用
let app: Express; // 保存 app：承载本步骤的计算结果供后续使用
let db: Db; // 保存 db：承载本步骤的计算结果供后续使用

beforeEach(() => { // 业务步骤：推进当前流程的下一项处理
  db = createDatabase(':memory:'); // 赋值：更新当前作用域中的状态
  app = createApp({ // 赋值：更新当前作用域中的状态
    db, // 业务步骤：推进当前流程的下一项处理
    jwtSecret: JWT_SECRET, // 对象字段：声明结构中的一项数据
    env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_ADMIN_TOKEN: ADMIN_TOKEN }, // 对象字段：声明结构中的一项数据
  }); // 结束代码块：本层作用域收尾
}); // 结束函数体：本层作用域收尾

async function login(identifier: string): Promise<Record<string, string>> { // 定义函数 login：封装可复用业务步骤
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD }); // 保存 res：承载本步骤的计算结果供后续使用
  expect(res.status).toBe(200); // 断言：校验接口返回符合契约
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

function writeHeaders(auth: Record<string, string>): Record<string, string> { // 定义函数 writeHeaders：封装可复用业务步骤
  return { ...auth, 'idempotency-key': randomUUID() }; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

function adminHeaders(): Record<string, string> { // 定义函数 adminHeaders：封装可复用业务步骤
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 直接把用户积分抬到可建板块的等级门槛（Lv.5+），绕过充值 / 订单链路；钱包行懒开户。 */
function elevateUserPoints(targetDb: Db, userId: string): void { // 定义函数 elevateUserPoints：封装可复用业务步骤
  const existing = targetDb.prepare('SELECT 1 AS ok FROM wallets WHERE user_id = ?').get(userId); // 保存 existing：承载本步骤的计算结果供后续使用
  const ts = new Date().toISOString(); // 保存 ts：承载本步骤的计算结果供后续使用
  if (existing) targetDb.prepare('UPDATE wallets SET points = 1500 WHERE user_id = ?').run(userId); // 条件分支：仅在满足业务前置条件时继续
  else targetDb.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 1500, ?)').run(userId, ts); // 预编译 SQL：固定语句结构后绑定参数执行
} // 结束函数体：本层作用域收尾

async function elevateToCreator(auth: Record<string, string>): Promise<string> { // 定义函数 elevateToCreator：封装可复用业务步骤
  const me = await request(app).get('/api/v1/me').set(auth); // 保存 me：承载本步骤的计算结果供后续使用
  const userId = me.body.user.id as string; // 保存 userId：承载本步骤的计算结果供后续使用
  elevateUserPoints(db, userId); // 业务步骤：推进当前流程的下一项处理
  return userId; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 直接向指定板块插入一篇已发布帖子，用于可见性 / 排序断言。 */
function seedThread(boardSlug: string, title: string, body: string, authorId: string | null): string { // 定义函数 seedThread：封装可复用业务步骤
  const board = db.prepare('SELECT id FROM community_boards WHERE slug = ?').get(boardSlug) as { id: string }; // 保存 board：承载本步骤的计算结果供后续使用
  const id = `thread-test-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
  const ts = new Date().toISOString(); // 保存 ts：承载本步骤的计算结果供后续使用
  db.prepare( // 预编译 SQL：固定语句结构后绑定参数执行
    `INSERT INTO community_threads (id, board_id, author_id, title, summary, body, kind, status, views, likes, reply_count, created_at, updated_at, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, 'text', 'published', 0, 0, 0, ?, ?, ?)`,
  ).run(id, board.id, authorId, title, title, body, ts, ts, ts); // 执行写入：把参数落库并返回影响结果
  return id; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

describe('三期 1：followers 板块关注后可见，列表只回摘要', () => { // 用例「三期 1：followers 板块关注后可见，列表只回摘要」：覆盖对应业务契约
  it('未关注：详情隐藏正文；关注后可读；取关后重新锁定', async () => { // 用例「未关注：详情隐藏正文；关注后可读；取关后重新锁定」：覆盖对应业务契约
    db.prepare("UPDATE community_boards SET visibility = 'followers' WHERE slug = 'general'").run(); // 预编译 SQL：固定语句结构后绑定参数执行
    const author = await login('13810000001'); // 保存 author：承载本步骤的计算结果供后续使用
    const authorId = (await request(app).get('/api/v1/me').set(author)).body.user.id as string; // 保存 authorId：承载本步骤的计算结果供后续使用
    const threadId = seedThread('general', 'followers 板块私密帖', '这是 followers 板块的完整正文，未关注不应读到。', authorId); // 保存 threadId：承载本步骤的计算结果供后续使用

    const guest = await login('13810000002'); // 保存 guest：承载本步骤的计算结果供后续使用
    const list = await request(app).get('/api/v1/community/threads?board=general').set(guest); // 保存 list：承载本步骤的计算结果供后续使用
    expect(list.status).toBe(200); // 断言：校验接口返回符合契约
    const item = list.body.items.find((t: { id: string }) => t.id === threadId); // 保存 item：承载本步骤的计算结果供后续使用
    expect(item).toBeTruthy(); // 断言：校验接口返回符合契约
    expect(item.summary).toBeTruthy(); // 列表只回摘要
    expect(item.body).toBeUndefined(); // 列表绝不返回正文

    const before = await request(app).get(`/api/v1/community/threads/${threadId}`).set(guest); // 保存 before：承载本步骤的计算结果供后续使用
    expect(before.body.unlocked).toBe(false); // 断言：校验接口返回符合契约
    expect(before.body.thread.body).toBe(''); // 断言：校验接口返回符合契约
    expect(before.body.thread.locked).toBe(true); // 断言：校验接口返回符合契约

    const follow = await request(app).post('/api/v1/community/boards/general/follow').set(writeHeaders(guest)).send({}); // 保存 follow：承载本步骤的计算结果供后续使用
    expect(follow.status).toBe(200); // 断言：校验接口返回符合契约
    expect(follow.body.followed).toBe(true); // 断言：校验接口返回符合契约

    const after = await request(app).get(`/api/v1/community/threads/${threadId}`).set(guest); // 保存 after：承载本步骤的计算结果供后续使用
    expect(after.body.unlocked).toBe(true); // 断言：校验接口返回符合契约
    expect(after.body.thread.body).toContain('完整正文'); // 断言：校验接口返回符合契约

    const unfollow = await request(app).post('/api/v1/community/boards/general/follow').set(writeHeaders(guest)).send({}); // 保存 unfollow：承载本步骤的计算结果供后续使用
    expect(unfollow.body.followed).toBe(false); // 断言：校验接口返回符合契约
    const relocked = await request(app).get(`/api/v1/community/threads/${threadId}`).set(guest); // 保存 relocked：承载本步骤的计算结果供后续使用
    expect(relocked.body.thread.body).toBe(''); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束函数体：本层作用域收尾

describe('三期 2：发帖滑动窗口频控，超限 429 + Retry-After', () => { // 用例「三期 2：发帖滑动窗口频控，超限 429 + Retry-After」：覆盖对应业务契约
  it('窗口内超过板块上限返回 429，携带 Retry-After 与 RATE_LIMITED', async () => { // 用例「窗口内超过板块上限返回 429，携带 Retry-After 与 RATE_LIMITED」：覆盖对应业务契约
    db.prepare('UPDATE community_boards SET rate_window_minutes = 10, rate_window_max = 2 WHERE slug = ?').run('general'); // 预编译 SQL：固定语句结构后绑定参数执行
    const auth = await login('13810000003'); // 保存 auth：承载本步骤的计算结果供后续使用

    const post = (title: string) => // 保存 post：承载本步骤的计算结果供后续使用
      request(app) // 业务步骤：推进当前流程的下一项处理
        .post('/api/v1/community/threads') // 链式调用：在上一步结果上继续处理
        .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
        .send({ board_slug: 'general', title, body: '这是一篇用于频控验证的帖子正文，长度满足最低要求。' }); // 链式调用：在上一步结果上继续处理

    const first = await post('频控帖一'); // 保存 first：承载本步骤的计算结果供后续使用
    expect(first.status).toBe(201); // 断言：校验接口返回符合契约
    const second = await post('频控帖二'); // 保存 second：承载本步骤的计算结果供后续使用
    expect(second.status).toBe(201); // 断言：校验接口返回符合契约

    const third = await post('频控帖三'); // 保存 third：承载本步骤的计算结果供后续使用
    expect(third.status).toBe(429); // 断言：校验接口返回符合契约
    expect(third.body.code).toBe('RATE_LIMITED'); // 断言：校验接口返回符合契约
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0); // 断言：校验接口返回符合契约
    expect(third.body.details.reason).toBe('WINDOW'); // 断言：校验接口返回符合契约
    expect(third.body.details.retry_after).toBeGreaterThan(0); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('板块配额可由版主调整：放宽窗口上限后可继续发帖', async () => { // 用例「板块配额可由版主调整：放宽窗口上限后可继续发帖」：覆盖对应业务契约
    db.prepare('UPDATE community_boards SET rate_window_max = 1 WHERE slug = ?').run('general'); // 预编译 SQL：固定语句结构后绑定参数执行
    const auth = await login('13810000004'); // 保存 auth：承载本步骤的计算结果供后续使用
    const first = await request(app) // 保存 first：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/threads') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ board_slug: 'general', title: '配额调整帖一', body: '正文内容用于验证板块级配额配置生效。' }); // 链式调用：在上一步结果上继续处理
    expect(first.status).toBe(201); // 断言：校验接口返回符合契约
    const second = await request(app) // 保存 second：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/threads') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ board_slug: 'general', title: '配额调整帖二', body: '第二篇应当被窗口上限 1 拦截。' }); // 链式调用：在上一步结果上继续处理
    expect(second.status).toBe(429); // 断言：校验接口返回符合契约

    const me = await request(app).get('/api/v1/me').set(auth); // 保存 me：承载本步骤的计算结果供后续使用
    db.prepare('UPDATE community_boards SET moderator_id = ? WHERE slug = ?').run(me.body.user.id, 'general'); // 预编译 SQL：固定语句结构后绑定参数执行
    const config = await request(app) // 保存 config：承载本步骤的计算结果供后续使用
      .put('/api/v1/community/boards/general/config') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ rate_window_max: 3 }); // 链式调用：在上一步结果上继续处理
    expect(config.status).toBe(200); // 断言：校验接口返回符合契约
    expect(config.body.quota.windowMax).toBe(3); // 断言：校验接口返回符合契约

    const third = await request(app) // 保存 third：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/threads') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ board_slug: 'general', title: '配额放宽后帖', body: '配额调到 3 之后，这一篇应当可以正常发出。' }); // 链式调用：在上一步结果上继续处理
    expect(third.status).toBe(201); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束函数体：本层作用域收尾

describe('三期 3：创建板块限制（门槛 / 数量 / 重名 / 敏感词 / 审核队列）', () => { // 用例「三期 3：创建板块限制（门槛 / 数量 / 重名 / 敏感词 / 审核队列）」：覆盖对应业务契约
  it('等级不足创建被 403；达标后可建；slug 与名称重复均 409', async () => { // 用例「等级不足创建被 403；达标后可建；slug 与名称重复均 409」：覆盖对应业务契约
    const auth = await login('13810000005'); // 保存 auth：承载本步骤的计算结果供后续使用
    const forbidden = await request(app) // 保存 forbidden：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/boards') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ slug: 'my-club', name: '我的小圈子', description: '门槛验证' }); // 链式调用：在上一步结果上继续处理
    expect(forbidden.status).toBe(403); // 断言：校验接口返回符合契约
    expect(forbidden.body.details.reason).toBe('BOARD_CREATE_FORBIDDEN'); // 断言：校验接口返回符合契约

    await elevateToCreator(auth); // 等待异步结果：串行完成依赖操作
    const created = await request(app) // 保存 created：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/boards') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ slug: 'my-club', name: '我的小圈子', description: '门槛达标后创建成功' }); // 链式调用：在上一步结果上继续处理
    expect(created.status).toBe(201); // 断言：校验接口返回符合契约
    expect(created.body.status).toBe('active'); // 断言：校验接口返回符合契约

    const dupSlug = await request(app) // 保存 dupSlug：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/boards') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ slug: 'my-club', name: '另一个名字' }); // 链式调用：在上一步结果上继续处理
    expect(dupSlug.status).toBe(409); // 断言：校验接口返回符合契约

    const dupName = await request(app) // 保存 dupName：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/boards') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ slug: 'my-club-2', name: '我的小圈子' }); // 链式调用：在上一步结果上继续处理
    expect(dupName.status).toBe(409); // 断言：校验接口返回符合契约
    expect(dupName.body.details.reason).toBe('BOARD_NAME_DUPLICATE'); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('敏感词拦截：名称命中受限词返回 400', async () => { // 用例「敏感词拦截：名称命中受限词返回 400」：覆盖对应业务契约
    const db2 = createDatabase(':memory:'); // 保存 db2：承载本步骤的计算结果供后续使用
    const blockedApp = createApp({ // 保存 blockedApp：承载本步骤的计算结果供后续使用
      db: db2, // 对象字段：声明结构中的一项数据
      jwtSecret: JWT_SECRET, // 对象字段：声明结构中的一项数据
      env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_COMMUNITY_BLOCK_WORDS: '违禁词' }, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    const auth = await request(blockedApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13810000006', password: ADMIN_PASSWORD }); // 保存 auth：承载本步骤的计算结果供后续使用
    const headers = { authorization: `Bearer ${auth.body.access_token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 保存 headers：承载本步骤的计算结果供后续使用
    const me = await request(blockedApp).get('/api/v1/me').set(headers); // 保存 me：承载本步骤的计算结果供后续使用
    elevateUserPoints(db2, me.body.user.id); // 业务步骤：推进当前流程的下一项处理

    const blocked = await request(blockedApp) // 保存 blocked：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/boards') // 链式调用：在上一步结果上继续处理
      .set(headers) // 链式调用：在上一步结果上继续处理
      .send({ slug: 'bad-club', name: '含有违禁词的板块', description: '简介' }); // 链式调用：在上一步结果上继续处理
    expect(blocked.status).toBe(400); // 断言：校验接口返回符合契约
    expect(blocked.body.details.reason).toBe('BOARD_BLOCKED_WORD'); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('开启审核后新板块进入 pending 队列；运营审核通过后上架', async () => { // 用例「开启审核后新板块进入 pending 队列；运营审核通过后上架」：覆盖对应业务契约
    const db3 = createDatabase(':memory:'); // 保存 db3：承载本步骤的计算结果供后续使用
    const reviewApp = createApp({ // 保存 reviewApp：承载本步骤的计算结果供后续使用
      db: db3, // 对象字段：声明结构中的一项数据
      jwtSecret: JWT_SECRET, // 对象字段：声明结构中的一项数据
      env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_COMMUNITY_BOARD_REVIEW: '1' }, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    const authRes = await request(reviewApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13810000007', password: ADMIN_PASSWORD }); // 保存 authRes：承载本步骤的计算结果供后续使用
    const auth = { authorization: `Bearer ${authRes.body.access_token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 保存 auth：承载本步骤的计算结果供后续使用
    const me = await request(reviewApp).get('/api/v1/me').set(auth); // 保存 me：承载本步骤的计算结果供后续使用
    elevateUserPoints(db3, me.body.user.id); // 业务步骤：推进当前流程的下一项处理

    const created = await request(reviewApp) // 保存 created：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/boards') // 链式调用：在上一步结果上继续处理
      .set(auth) // 链式调用：在上一步结果上继续处理
      .send({ slug: 'pending-club', name: '待审核板块', description: '需要人工审核' }); // 链式调用：在上一步结果上继续处理
    expect(created.status).toBe(201); // 断言：校验接口返回符合契约
    expect(created.body.status).toBe('pending'); // 断言：校验接口返回符合契约

    // 创建者本人可见自己的待审核板块（状态 pending）；其他用户列表中不可见。
    const creatorList = await request(reviewApp).get('/api/v1/community/boards').set(auth); // 保存 creatorList：承载本步骤的计算结果供后续使用
    const ownEntry = creatorList.body.boards.find((b: { slug: string }) => b.slug === 'pending-club'); // 保存 ownEntry：承载本步骤的计算结果供后续使用
    expect(ownEntry).toBeTruthy(); // 断言：校验接口返回符合契约
    expect(ownEntry.status).toBe('pending'); // 断言：校验接口返回符合契约
    const otherRes = await request(reviewApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13810000011', password: ADMIN_PASSWORD }); // 保存 otherRes：承载本步骤的计算结果供后续使用
    const otherAuth = { authorization: `Bearer ${otherRes.body.access_token}`, 'content-type': 'application/json' }; // 保存 otherAuth：承载本步骤的计算结果供后续使用
    const otherList = await request(reviewApp).get('/api/v1/community/boards').set(otherAuth); // 保存 otherList：承载本步骤的计算结果供后续使用
    expect(otherList.body.boards.some((b: { slug: string }) => b.slug === 'pending-club')).toBe(false); // 断言：校验接口返回符合契约

    const pending = await request(reviewApp).get('/api/v1/community/boards/pending').set(adminHeaders()); // 保存 pending：承载本步骤的计算结果供后续使用
    expect(pending.status).toBe(200); // 断言：校验接口返回符合契约
    expect(pending.body.boards.some((b: { slug: string }) => b.slug === 'pending-club')).toBe(true); // 断言：校验接口返回符合契约

    const approve = await request(reviewApp).post('/api/v1/community/boards/pending-club/approve').set(adminHeaders()).send({}); // 保存 approve：承载本步骤的计算结果供后续使用
    expect(approve.status).toBe(200); // 断言：校验接口返回符合契约
    expect(approve.body.status).toBe('active'); // 断言：校验接口返回符合契约

    const afterList = await request(reviewApp).get('/api/v1/community/boards').set(auth); // 保存 afterList：承载本步骤的计算结果供后续使用
    expect(afterList.body.boards.some((b: { slug: string }) => b.slug === 'pending-club')).toBe(true); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('三期 4：论坛设为首页（权威配置读写）', () => { // 用例「三期 4：论坛设为首页（权威配置读写）」：覆盖对应业务契约
  it('匿名可读当前指向；运营写入 community 后公开配置同步为论坛首页', async () => { // 用例「匿名可读当前指向；运营写入 community 后公开配置同步为论坛首页」：覆盖对应业务契约
    const before = await request(app).get('/api/v1/community/home-setting'); // 保存 before：承载本步骤的计算结果供后续使用
    expect(before.status).toBe(200); // 断言：校验接口返回符合契约
    expect(before.body.home).toBe('portal'); // 断言：校验接口返回符合契约

    const put = await request(app).put('/api/v1/community/home-setting').set(adminHeaders()).send({ home: 'community' }); // 保存 put：承载本步骤的计算结果供后续使用
    expect(put.status).toBe(200); // 断言：校验接口返回符合契约
    expect(put.body.home).toBe('community'); // 断言：校验接口返回符合契约

    const after = await request(app).get('/api/v1/community/home-setting'); // 保存 after：承载本步骤的计算结果供后续使用
    expect(after.body.home).toBe('community'); // 断言：校验接口返回符合契约

    const publicConfig = await request(app).get('/api/v1/site/config'); // 保存 publicConfig：承载本步骤的计算结果供后续使用
    expect(publicConfig.body.home_view).toBe('community'); // 断言：校验接口返回符合契约

    const back = await request(app).put('/api/v1/community/home-setting').set(adminHeaders()).send({ home: 'portal' }); // 保存 back：承载本步骤的计算结果供后续使用
    expect(back.body.home).toBe('portal'); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束函数体：本层作用域收尾

describe('三期 5：板块 Tab 栏目模块化组合', () => { // 用例「三期 5：板块 Tab 栏目模块化组合」：覆盖对应业务契约
  it('缺省返回一套默认 Tab；创建者可持久化调整顺序与显隐', async () => { // 用例「缺省返回一套默认 Tab；创建者可持久化调整顺序与显隐」：覆盖对应业务契约
    const defaults = await request(app).get('/api/v1/community/boards/general/tabs'); // 保存 defaults：承载本步骤的计算结果供后续使用
    expect(defaults.status).toBe(200); // 断言：校验接口返回符合契约
    expect(defaults.body.tabs.map((t: { key: string }) => t.key)).toEqual(['latest', 'hot', 'recommend', 'rating', 'favorites']); // 断言：校验接口返回符合契约

    const auth = await login('13810000008'); // 保存 auth：承载本步骤的计算结果供后续使用
    await elevateToCreator(auth); // 等待异步结果：串行完成依赖操作
    const created = await request(app) // 保存 created：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/boards') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ slug: 'tab-club', name: '栏目实验板块', description: 'Tab 组合验证' }); // 链式调用：在上一步结果上继续处理
    expect(created.status).toBe(201); // 断言：校验接口返回符合契约

    const save = await request(app) // 保存 save：承载本步骤的计算结果供后续使用
      .put('/api/v1/community/boards/tab-club/tabs') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ // 链式调用：在上一步结果上继续处理
        tabs: [ // 对象字段：声明结构中的一项数据
          { key: 'recommend', label: '编辑推荐', sort_order: 1, visible: true, sort_by: 'recommend' }, // 业务步骤：推进当前流程的下一项处理
          { key: 'latest', label: '最新', sort_order: 2, visible: true }, // 业务步骤：推进当前流程的下一项处理
          { key: 'favorites', label: '收藏', sort_order: 3, visible: false }, // 业务步骤：推进当前流程的下一项处理
        ], // 集合结束：数组或索引表达式收尾
      }); // 结束代码块：本层作用域收尾
    expect(save.status).toBe(200); // 断言：校验接口返回符合契约
    const tabs = save.body.tabs; // 保存 tabs：承载本步骤的计算结果供后续使用
    expect(tabs[0].key).toBe('recommend'); // 断言：校验接口返回符合契约
    expect(tabs[0].label).toBe('编辑推荐'); // 断言：校验接口返回符合契约
    expect(tabs.find((t: { key: string }) => t.key === 'favorites').visible).toBe(false); // 断言：校验接口返回符合契约

    const reread = await request(app).get('/api/v1/community/boards/tab-club/tabs'); // 保存 reread：承载本步骤的计算结果供后续使用
    expect(reread.body.tabs[0].key).toBe('recommend'); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束函数体：本层作用域收尾

describe('三期 6：推荐指数与 rating / favorites 排序', () => { // 用例「三期 6：推荐指数与 rating / favorites 排序」：覆盖对应业务契约
  it('互动累积的帖子推荐分更高；rating 与 favorites 排序各自生效', async () => { // 用例「互动累积的帖子推荐分更高；rating 与 favorites 排序各自生效」：覆盖对应业务契约
    const auth = await login('13810000009'); // 保存 auth：承载本步骤的计算结果供后续使用
    const rich = await request(app) // 保存 rich：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/threads') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ board_slug: 'general', title: '高互动帖子', body: '这篇帖子会被收藏、评分与回复，用于验证推荐指数计算。' }); // 链式调用：在上一步结果上继续处理
    const plain = await request(app) // 保存 plain：承载本步骤的计算结果供后续使用
      .post('/api/v1/community/threads') // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ board_slug: 'general', title: '普通帖子', body: '这篇帖子没有任何互动，作为推荐分对照样本。' }); // 链式调用：在上一步结果上继续处理

    await request(app).post(`/api/v1/community/threads/${rich.body.thread_id}/favorite`).set(writeHeaders(auth)).send({}); // 等待异步结果：串行完成依赖操作
    await request(app).post(`/api/v1/community/threads/${rich.body.thread_id}/rate`).set(writeHeaders(auth)).send({ rating: 5 }); // 等待异步结果：串行完成依赖操作
    await request(app) // 等待异步结果：串行完成依赖操作
      .post(`/api/v1/community/threads/${rich.body.thread_id}/reply`) // 链式调用：在上一步结果上继续处理
      .set(writeHeaders(auth)) // 链式调用：在上一步结果上继续处理
      .send({ content: '回复一条，计入回复权重。' }); // 链式调用：在上一步结果上继续处理

    const recommend = await request(app).get('/api/v1/community/threads?board=general&sort=recommend').set(auth); // 保存 recommend：承载本步骤的计算结果供后续使用
    expect(recommend.status).toBe(200); // 断言：校验接口返回符合契约
    expect(recommend.body.items[0].id).toBe(rich.body.thread_id); // 断言：校验接口返回符合契约
    const richRow = recommend.body.items.find((t: { id: string }) => t.id === rich.body.thread_id); // 保存 richRow：承载本步骤的计算结果供后续使用
    expect(richRow.recommend_score).toBeGreaterThan(0); // 断言：校验接口返回符合契约

    const byRating = await request(app).get('/api/v1/community/threads?board=general&sort=rating').set(auth); // 保存 byRating：承载本步骤的计算结果供后续使用
    expect(byRating.body.items[0].id).toBe(rich.body.thread_id); // 断言：校验接口返回符合契约

    const byFavorites = await request(app).get('/api/v1/community/threads?board=general&sort=favorites').set(auth); // 保存 byFavorites：承载本步骤的计算结果供后续使用
    expect(byFavorites.body.items[0].id).toBe(rich.body.thread_id); // 断言：校验接口返回符合契约
    expect(plain.body.thread_id).toBeTruthy(); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾

  it('推荐权重可由运营持久化调整', async () => { // 用例「推荐权重可由运营持久化调整」：覆盖对应业务契约
    const get = await request(app).get('/api/v1/community/recommend-weights'); // 保存 get：承载本步骤的计算结果供后续使用
    expect(get.status).toBe(200); // 断言：校验接口返回符合契约
    expect(get.body.defaults.favorites).toBeGreaterThan(0); // 断言：校验接口返回符合契约

    const put = await request(app) // 保存 put：承载本步骤的计算结果供后续使用
      .put('/api/v1/community/recommend-weights') // 链式调用：在上一步结果上继续处理
      .set(adminHeaders()) // 链式调用：在上一步结果上继续处理
      .send({ favorites: 9, halfLifeDays: 3 }); // 链式调用：在上一步结果上继续处理
    expect(put.status).toBe(200); // 断言：校验接口返回符合契约
    expect(put.body.weights.favorites).toBe(9); // 断言：校验接口返回符合契约
    expect(put.body.weights.halfLifeDays).toBe(3); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('三期 7：付费板块种子幂等写入真实价格', () => { // 用例「三期 7：付费板块种子幂等写入真实价格」：覆盖对应业务契约
  it('种子付费板块 price_cents > 0，且不新增板块行数（仍为 6 个）', async () => { // 用例「种子付费板块 price_cents > 0，且不新增板块行数（仍为 6 个）」：覆盖对应业务契约
    const auth = await login('13810000010'); // 保存 auth：承载本步骤的计算结果供后续使用
    const overview = await request(app).get('/api/v1/community/overview').set(auth); // 保存 overview：承载本步骤的计算结果供后续使用
    expect(overview.body.boards).toHaveLength(6); // 断言：校验接口返回符合契约
    const paid = overview.body.boards.find((b: { slug: string }) => b.slug === 'paid'); // 保存 paid：承载本步骤的计算结果供后续使用
    expect(paid).toBeTruthy(); // 断言：校验接口返回符合契约
    expect(paid.price_cents).toBeGreaterThan(0); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束函数体：本层作用域收尾

describe('三期 8：每日上限与累计上限（环境变量配额）', () => { // 用例「三期 8：每日上限与累计上限」：覆盖对应业务契约
  it('每日配额 MIM_COMMUNITY_DAILY_MAX=1：第二篇 429 DAILY，Retry-After 指向次日零点', async () => { // 用例「每日配额」：覆盖对应业务契约
    const dayDb = createDatabase(':memory:'); // 保存 dayDb：承载本步骤的计算结果供后续使用
    const dayApp = createApp({ // 保存 dayApp：每日上限 1、累计与窗口放开
      db: dayDb, // 对象字段 db：记录一项配置或数据
      jwtSecret: JWT_SECRET, // 对象字段 jwtSecret：记录一项配置或数据
      env: { // 对象字段 env：记录一项配置或数据
        MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_ADMIN_TOKEN: ADMIN_TOKEN, // 对象字段 MIM_AUTH_ADMIN_PASSWORD：记录一项配置或数据
        MIM_COMMUNITY_DAILY_MAX: '1', MIM_COMMUNITY_TOTAL_MAX: '200', MIM_COMMUNITY_WINDOW_MAX: '5', // 对象字段 MIM_COMMUNITY_DAILY_MAX：记录一项配置或数据
      }, // 代码块结束
    }); // 代码块结束
    const loginRes = await request(dayApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13810000021', password: ADMIN_PASSWORD }); // 常量 loginRes：保存固定配置或一次性派生值
    const headers = { authorization: `Bearer ${loginRes.body.access_token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 常量 headers：保存固定配置或一次性派生值
    const post = (title: string) => // 常量 post：保存固定配置或一次性派生值
      request(dayApp).post('/api/v1/community/threads').set({ ...headers, 'idempotency-key': randomUUID() }) // 调用 request 并处理其返回结果
        .send({ board_slug: 'general', title, body: '正文内容用于验证每日配额上限是否生效。' }); // 执行当前业务步骤

    const first = await post('每日配额帖一'); // 常量 first：保存固定配置或一次性派生值
    expect(first.status).toBe(201); // 调用 expect 并处理其返回结果
    const second = await post('每日配额帖二'); // 常量 second：保存固定配置或一次性派生值
    expect(second.status).toBe(429); // 调用 expect 并处理其返回结果
    expect(second.body.code).toBe('RATE_LIMITED'); // 调用 expect 并处理其返回结果
    expect(second.body.details.reason).toBe('DAILY'); // 调用 expect 并处理其返回结果
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0); // 调用 expect 并处理其返回结果
    expect(second.body.details.retry_after).toBeGreaterThan(0); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('累计配额 MIM_COMMUNITY_TOTAL_MAX=1：第二篇 429 TOTAL', async () => { // 用例「累计配额」：覆盖对应业务契约
    const totalDb = createDatabase(':memory:'); // 保存 totalDb：承载本步骤的计算结果供后续使用
    const totalApp = createApp({ // 保存 totalApp：累计上限 1、每日与窗口放开
      db: totalDb, // 对象字段 db：记录一项配置或数据
      jwtSecret: JWT_SECRET, // 对象字段 jwtSecret：记录一项配置或数据
      env: { // 对象字段 env：记录一项配置或数据
        MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_ADMIN_TOKEN: ADMIN_TOKEN, // 对象字段 MIM_AUTH_ADMIN_PASSWORD：记录一项配置或数据
        MIM_COMMUNITY_DAILY_MAX: '200', MIM_COMMUNITY_TOTAL_MAX: '1', MIM_COMMUNITY_WINDOW_MAX: '5', // 对象字段 MIM_COMMUNITY_DAILY_MAX：记录一项配置或数据
      }, // 代码块结束
    }); // 代码块结束
    const loginRes = await request(totalApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13810000022', password: ADMIN_PASSWORD }); // 常量 loginRes：保存固定配置或一次性派生值
    const headers = { authorization: `Bearer ${loginRes.body.access_token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 常量 headers：保存固定配置或一次性派生值
    const post = (title: string) => // 常量 post：保存固定配置或一次性派生值
      request(totalApp).post('/api/v1/community/threads').set({ ...headers, 'idempotency-key': randomUUID() }) // 调用 request 并处理其返回结果
        .send({ board_slug: 'general', title, body: '正文内容用于验证累计配额上限是否生效。' }); // 执行当前业务步骤

    const first = await post('累计配额帖一'); // 常量 first：保存固定配置或一次性派生值
    expect(first.status).toBe(201); // 调用 expect 并处理其返回结果
    const second = await post('累计配额帖二'); // 常量 second：保存固定配置或一次性派生值
    expect(second.status).toBe(429); // 调用 expect 并处理其返回结果
    expect(second.body.details.reason).toBe('TOTAL'); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 结束函数体：本层作用域收尾

describe('三期 9：推荐权重环境变量 JSON 覆盖改变 recommend 排序', () => { // 用例「三期 9：权重 env 覆盖」：覆盖对应业务契约
  it('权重向回复倾斜后，回复多的帖子排在收藏多的帖子之前', async () => { // 用例「env 覆盖排序」：覆盖对应业务契约
    const wDb = createDatabase(':memory:'); // 保存 wDb：承载本步骤的计算结果供后续使用
    const wApp = createApp({ // 保存 wApp：回复权重 20、收藏权重 1（默认收藏 5 > 回复 3）
      db: wDb, // 对象字段 db：记录一项配置或数据
      jwtSecret: JWT_SECRET, // 对象字段 jwtSecret：记录一项配置或数据
      env: { // 对象字段 env：记录一项配置或数据
        MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, // 对象字段 MIM_AUTH_ADMIN_PASSWORD：记录一项配置或数据
        MIM_COMMUNITY_RECOMMEND_WEIGHTS: JSON.stringify({ replies: 20, favorites: 1 }), // 对象字段 MIM_COMMUNITY_RECOMMEND_WEIGHTS：记录一项配置或数据
      }, // 代码块结束
    }); // 代码块结束
    const loginRes = await request(wApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13810000023', password: ADMIN_PASSWORD }); // 常量 loginRes：保存固定配置或一次性派生值
    const auth = { authorization: `Bearer ${loginRes.body.access_token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 常量 auth：保存固定配置或一次性派生值

    const replyThread = await request(wApp).post('/api/v1/community/threads').set(auth).send({ board_slug: 'general', title: '回复型帖子', body: '这篇帖子会收到一条回复，用于权重覆盖排序验证。' }); // 常量 replyThread：保存固定配置或一次性派生值
    const favThread = await request(wApp).post('/api/v1/community/threads').set({ ...auth, 'idempotency-key': randomUUID() }).send({ board_slug: 'general', title: '收藏型帖子', body: '这篇帖子会被收藏，作为排序对照样本。' }); // 常量 favThread：保存固定配置或一次性派生值

    await request(wApp).post(`/api/v1/community/threads/${replyThread.body.thread_id}/reply`).set({ ...auth, 'idempotency-key': randomUUID() }).send({ content: '回复一条，计入回复权重。' }); // 异步等待：挂起至 Promise 落定后再继续
    await request(wApp).post(`/api/v1/community/threads/${favThread.body.thread_id}/favorite`).set({ ...auth, 'idempotency-key': randomUUID() }).send({}); // 异步等待：挂起至 Promise 落定后再继续

    const list = await request(wApp).get('/api/v1/community/threads?board=general&sort=recommend').set(auth); // 常量 list：保存固定配置或一次性派生值
    expect(list.status).toBe(200); // 调用 expect 并处理其返回结果
    const ids = list.body.items.map((t: { id: string }) => t.id); // 常量 ids：保存固定配置或一次性派生值
    expect(ids.indexOf(replyThread.body.thread_id)).toBeLessThan(ids.indexOf(favThread.body.thread_id)); // 回复权重更高，回复型帖子在前
  }); // 代码块结束
}); // 结束函数体：本层作用域收尾

describe('三期 10：followers + paid 组合判定顺序', () => { // 用例「三期 10：组合判定」：覆盖对应业务契约
  it('先过付费门槛再过关注门槛：未加入且未关注锁定；仅关注仍锁定；仅加入仍锁定；两者齐备可读正文', async () => { // 用例「组合顺序」：覆盖对应业务契约
    db.prepare("UPDATE community_boards SET visibility = 'followers', price_cents = 1900 WHERE slug = 'paid'").run(); // 保存 paid：付费 + followers 双门槛
    const author = await login('13810000024'); // 常量 author：保存固定配置或一次性派生值
    const authorId = (await request(app).get('/api/v1/me').set(author)).body.user.id as string; // 常量 authorId：保存固定配置或一次性派生值
    const threadId = seedThread('paid', '付费关注双门槛帖', '这是付费且 followers 双门槛板块的完整正文。', authorId); // 常量 threadId：保存固定配置或一次性派生值
    const board = db.prepare('SELECT id FROM community_boards WHERE slug = ?').get('paid') as { id: string }; // 常量 board：保存固定配置或一次性派生值

    // 访客 A：两者都不满足 → 锁定
    const guestA = await login('13810000025');
    const neither = await request(app).get(`/api/v1/community/threads/${threadId}`).set(guestA); // 常量 neither：保存固定配置或一次性派生值
    expect(neither.body.thread.body).toBe(''); // 调用 expect 并处理其返回结果
    expect(neither.body.unlocked).toBe(false); // 调用 expect 并处理其返回结果

    // 访客 B：仅关注、未加入 → 付费门槛先拦截，仍锁定
    const guestB = await login('13810000026');
    const follow = await request(app).post('/api/v1/community/boards/paid/follow').set(writeHeaders(guestB)).send({}); // 常量 follow：保存固定配置或一次性派生值
    expect(follow.body.followed).toBe(true); // 调用 expect 并处理其返回结果
    const followOnly = await request(app).get(`/api/v1/community/threads/${threadId}`).set(guestB); // 常量 followOnly：保存固定配置或一次性派生值
    expect(followOnly.body.thread.body).toBe(''); // 调用 expect 并处理其返回结果
    expect(followOnly.body.unlocked).toBe(false); // 调用 expect 并处理其返回结果

    // 访客 C：仅加入、未关注 → 关注门槛再拦截，仍锁定
    const guestC = await login('13810000027');
    const guestCId = (await request(app).get('/api/v1/me').set(guestC)).body.user.id as string; // 常量 guestCId：保存固定配置或一次性派生值
    db.prepare('INSERT INTO community_board_memberships (board_id, user_id, amount_cents, created_at) VALUES (?, ?, 0, ?)').run(board.id, guestCId, new Date().toISOString()); // 直接落会员记录，绕开余额支付
    const joinedOnly = await request(app).get(`/api/v1/community/threads/${threadId}`).set(guestC); // 常量 joinedOnly：保存固定配置或一次性派生值
    expect(joinedOnly.body.thread.body).toBe(''); // 调用 expect 并处理其返回结果
    expect(joinedOnly.body.unlocked).toBe(false); // 调用 expect 并处理其返回结果

    // 访客 D：会员 + 关注齐备 → 放行
    const guestD = await login('13810000028');
    const guestDId = (await request(app).get('/api/v1/me').set(guestD)).body.user.id as string; // 常量 guestDId：保存固定配置或一次性派生值
    db.prepare('INSERT INTO community_board_memberships (board_id, user_id, amount_cents, created_at) VALUES (?, ?, 0, ?)').run(board.id, guestDId, new Date().toISOString()); // 执行当前业务步骤
    await request(app).post('/api/v1/community/boards/paid/follow').set(writeHeaders(guestD)).send({}); // 异步等待：挂起至 Promise 落定后再继续
    const both = await request(app).get(`/api/v1/community/threads/${threadId}`).set(guestD); // 常量 both：保存固定配置或一次性派生值
    expect(both.body.unlocked).toBe(true); // 调用 expect 并处理其返回结果
    expect(both.body.thread.body).toContain('双门槛'); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 结束函数体：本层作用域收尾

describe('三期 11：post 场景验证码开关驱动，默认空操作', () => { // 用例「三期 11：发帖验证码」：覆盖对应业务契约
  it('场景开关关闭时发帖不校验验证码；开启后缺验证码 400，补齐一次性验证码后放行', async () => { // 用例「开关驱动」：覆盖对应业务契约
    // 默认应用（本文件 beforeEach）未开启验证码：既有发帖链路已在三期 2/6 用例中 201 放行，此处复核开关关闭为空操作。
    const onDb = createDatabase(':memory:'); // 保存 onDb：承载本步骤的计算结果供后续使用
    const onApp = createApp({ // 保存 onApp：image 模式 + post 场景强制
      db: onDb, // 对象字段 db：记录一项配置或数据
      jwtSecret: JWT_SECRET, // 对象字段 jwtSecret：记录一项配置或数据
      env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_POST: '1' }, // 对象字段 env：记录一项配置或数据
    }); // 代码块结束
    const loginRes = await request(onApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13810000026', password: ADMIN_PASSWORD }); // 常量 loginRes：保存固定配置或一次性派生值
    const auth = { authorization: `Bearer ${loginRes.body.access_token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 常量 auth：保存固定配置或一次性派生值

    const missing = await request(onApp).post('/api/v1/community/threads').set(auth).send({ board_slug: 'general', title: '缺验证码帖子', body: '未携带验证码，应当被 post 场景校验拦截。' }); // 常量 missing：保存固定配置或一次性派生值
    expect(missing.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(missing.body.code).toBe('AUTH_CODE_INVALID'); // 调用 expect 并处理其返回结果

    const captcha = createCaptcha(); // 本地造一条有效图形验证码
    onDb.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)') // 执行当前业务步骤
      .run(captcha.id, captchaHash(captcha.answer), captcha.expires_at, new Date().toISOString()); // 执行当前业务步骤
    const ok = await request(onApp).post('/api/v1/community/threads').set({ ...auth, 'idempotency-key': randomUUID() }) // 常量 ok：保存固定配置或一次性派生值
      .send({ board_slug: 'general', title: '带验证码帖子', body: '携带一次性验证码答案，应当正常发出。', captcha_id: captcha.id, captcha_code: captcha.answer }); // 执行当前业务步骤
    expect(ok.status).toBe(201); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 结束函数体：本层作用域收尾
