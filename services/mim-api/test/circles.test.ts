/**
 * 圈子（circle）契约测试：创建门槛 / 三种加入方式 / 满员 / 私密可见性 / 审核 /
 * 圈内动态与公告 / 退出隔离 / 幂等重放 / 访客 401。
 * 测试自建 mini express app，只挂载 circles 路由；与板块（board）测试互不干扰。
 */

import { randomUUID } from 'node:crypto'; // 引入依赖、类型或本地模块绑定
import express from 'express'; // 组装 mini app
import type { Express } from 'express'; // 引入：声明测试所需依赖
import { describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // HTTP 断言客户端
import { createDatabase } from '../src/db.js'; // 内存库（含 schema.d 域脚本与种子）
import { createUser } from '../src/identity.js'; // 造普通用户
import { issueAccessToken } from '../src/auth.js'; // 造登录态令牌
import { createCirclesRouter } from '../src/routes/circles.js'; // 被测路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import type { ApiDeps } from '../src/types.js'; // 依赖容器类型

const JWT_SECRET = 'circles-secret-0123456789abcdef0123456789'; // 固定测试密钥
const FIXED_NOW = '2026-11-13T08:00:00.000Z'; // 固定时钟，便于断言时间字段

/** 组装只含 circles 路由的 mini app */
function miniApp(deps: ApiDeps): Express {
  const app = express(); // 常量 app：保存固定配置或一次性派生值
  app.use(express.json()); // 执行当前业务步骤
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createCirclesRouter(deps)); // 执行当前业务步骤
  app.use(errorHandler); // 执行当前业务步骤
  return app; // 返回当前函数的处理结果
} // 代码块结束

interface Setup { // 接口 Setup：约束对象的字段与类型形态
  deps: ApiDeps; // 对象字段 deps：记录一项配置或数据
  app: Express; // 对象字段 app：记录一项配置或数据
  user: ReturnType<typeof createUser>; // 对象字段 user：记录一项配置或数据
  token: string; // 对象字段 token：记录一项配置或数据
} // 代码块结束

/** 装配内存库 + mini app + 普通用户；env 可覆盖等级 / 数量等配置。 */
function setup(env: Record<string, string | undefined> = {}): Setup {
  const deps: ApiDeps = { db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env }; // 常量 deps：保存固定配置或一次性派生值
  const app = miniApp(deps); // 常量 app：保存固定配置或一次性派生值
  const user = createUser(deps.db, { region: 'cn', now: FIXED_NOW }); // 常量 user：保存固定配置或一次性派生值
  const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 常量 token：保存固定配置或一次性派生值
  return { deps, app, user, token }; // 返回当前函数的处理结果
} // 代码块结束

/** 再造一个用户并返回其令牌与 ID。 */
function anotherUser(deps: ApiDeps, identifier = '13800000002'): { id: string; token: string } {
  const user = createUser(deps.db, { region: 'cn', now: FIXED_NOW, display_name: identifier }); // 常量 user：保存固定配置或一次性派生值
  return { id: user.id, token: issueAccessToken(user.id, user.region, deps.jwtSecret) }; // 返回当前函数的处理结果
} // 代码块结束

/** 登录请求头 */
function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }; // 返回当前函数的处理结果
} // 代码块结束

/** 写操作请求头：叠幂等键（全局幂等中间件对写方法强制要求）。 */
function writeHeaders(token: string): Record<string, string> {
  return { ...auth(token), 'idempotency-key': randomUUID() }; // 返回当前函数的处理结果
} // 代码块结束

/** 以指定参数创建圈子并返回响应（默认 open / public）。 */
async function createCircle(
  app: Express, // 对象字段 app：记录一项配置或数据
  token: string, // 对象字段 token：记录一项配置或数据
  payload: Record<string, unknown>, // 对象字段 payload：记录一项配置或数据
): Promise<request.Response> { // 执行当前业务步骤
  return request(app).post('/api/v1/circles').set(writeHeaders(token)).send(payload); // 返回当前函数的处理结果
} // 代码块结束

describe('圈子公开浏览与访客门禁', () => { // 调用 describe 并处理其返回结果
  it('匿名可拉取公开圈子列表（空库返回空 items）', async () => { // 调用 it 并处理其返回结果
    const { app } = setup(); // 执行当前业务步骤
    const res = await request(app).get('/api/v1/circles'); // 常量 res：保存固定配置或一次性派生值
    expect(res.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(res.body.items).toEqual([]); // 调用 expect 并处理其返回结果
    expect(res.body.total).toBe(0); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('匿名创建圈子返回 401', async () => { // 调用 it 并处理其返回结果
    const { app } = setup(); // 执行当前业务步骤
    const res = await request(app).post('/api/v1/circles').send({ slug: 'anon', name: '匿名圈' }); // 常量 res：保存固定配置或一次性派生值
    expect(res.status).toBe(401); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('匿名加入圈子返回 401', async () => { // 调用 it 并处理其返回结果
    const { app, token } = setup(); // 执行当前业务步骤
    const created = await createCircle(app, token, { slug: 'open-one', name: '开放圈' }); // 常量 created：保存固定配置或一次性派生值
    expect(created.status).toBe(201); // 调用 expect 并处理其返回结果
    const res = await request(app).post(`/api/v1/circles/${created.body.circle.slug}/join`).send({}); // 常量 res：保存固定配置或一次性派生值
    expect(res.status).toBe(401); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('圈子创建门槛', () => { // 调用 describe 并处理其返回结果
  it('登录用户可创建 open/public 圈子，创建者自动成为 owner，成员数为 1', async () => { // 调用 it 并处理其返回结果
    const { app, token, user } = setup(); // 执行当前业务步骤
    const res = await createCircle(app, token, { slug: 'makers', name: '手作同好', intro: '一起做手工' }); // 常量 res：保存固定配置或一次性派生值
    expect(res.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(res.body.circle.slug).toBe('makers'); // 调用 expect 并处理其返回结果
    expect(res.body.circle.my_role).toBe('owner'); // 调用 expect 并处理其返回结果
    expect(res.body.circle.i_am_member).toBe(true); // 调用 expect 并处理其返回结果
    expect(res.body.circle.member_count).toBe(1); // 调用 expect 并处理其返回结果
    expect(res.body.circle.owner_id).toBe(user.id); // 调用 expect 并处理其返回结果
    expect(typeof res.body.circle.invite_code).toBe('string'); // 调用 expect 并处理其返回结果

    const detail = await request(app).get('/api/v1/circles/makers').set(auth(token)); // 常量 detail：保存固定配置或一次性派生值
    expect(detail.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(detail.body.circle.name).toBe('手作同好'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('每人创建数量达上限（默认 1）后再建返回 400 CIRCLE_CREATE_LIMIT', async () => { // 调用 it 并处理其返回结果
    const { app, token } = setup(); // 执行当前业务步骤
    const first = await createCircle(app, token, { slug: 'first-circle', name: '第一个圈' }); // 常量 first：保存固定配置或一次性派生值
    expect(first.status).toBe(201); // 调用 expect 并处理其返回结果
    const second = await createCircle(app, token, { slug: 'second-circle', name: '第二个圈' }); // 常量 second：保存固定配置或一次性派生值
    expect(second.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(second.body.details.reason).toBe('CIRCLE_CREATE_LIMIT'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('等级门槛：min_level=2 时新用户（Lv.1）创建返回 403 CIRCLE_CREATE_LEVEL', async () => { // 调用 it 并处理其返回结果
    const { app, token } = setup({ MIM_CIRCLE_CREATE_MIN_LEVEL: '2' }); // 执行当前业务步骤
    const res = await createCircle(app, token, { slug: 'high-level', name: '高等级圈' }); // 常量 res：保存固定配置或一次性派生值
    expect(res.status).toBe(403); // 调用 expect 并处理其返回结果
    expect(res.body.details.reason).toBe('CIRCLE_CREATE_LEVEL'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('slug 重复返回 409 CONFLICT', async () => { // 调用 it 并处理其返回结果
    const { app, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'dup-slug', name: '圈 A' }); // 异步等待：挂起至 Promise 落定后再继续
    const dup = await createCircle(app, token, { slug: 'dup-slug', name: '圈 B' }); // 常量 dup：保存固定配置或一次性派生值
    expect(dup.status).toBe(409); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('加入方式：open / approve / invite', () => { // 调用 describe 并处理其返回结果
  it('open 圈子：新成员直接 active，成员数 +1 且出现在名单', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    const created = await createCircle(app, token, { slug: 'open-join', name: '开放圈' }); // 常量 created：保存固定配置或一次性派生值
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    const join = await request(app).post(`/api/v1/circles/open-join/join`).set(writeHeaders(other.token)).send({}); // 常量 join：保存固定配置或一次性派生值
    expect(join.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(join.body.status).toBe('active'); // 调用 expect 并处理其返回结果
    expect(join.body.role).toBe('member'); // 调用 expect 并处理其返回结果

    const members = await request(app).get('/api/v1/circles/open-join/members').set(auth(other.token)); // 常量 members：保存固定配置或一次性派生值
    expect(members.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(members.body.member_count).toBe(2); // 调用 expect 并处理其返回结果
    expect(members.body.items.some((m: { user_id: string }) => m.user_id === other.id)).toBe(true); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('approve 圈子：先落 pending，圈主通过后转 active', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'approve-one', name: '审核圈', join_mode: 'approve' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    const join = await request(app).post('/api/v1/circles/approve-one/join').set(writeHeaders(other.token)).send({}); // 常量 join：保存固定配置或一次性派生值
    expect(join.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(join.body.status).toBe('pending'); // 调用 expect 并处理其返回结果

    const approve = await request(app).post('/api/v1/circles/approve-one/approve').set(writeHeaders(token)).send({ user_id: other.id }); // 常量 approve：保存固定配置或一次性派生值
    expect(approve.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(approve.body.status).toBe('active'); // 调用 expect 并处理其返回结果

    const members = await request(app).get('/api/v1/circles/approve-one/members').set(auth(other.token)); // 常量 members：保存固定配置或一次性派生值
    expect(members.body.member_count).toBe(2); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('approve 圈子：圈主拒绝后成员置 left，不进入名单', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'reject-one', name: '拒绝圈', join_mode: 'approve' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    await request(app).post('/api/v1/circles/reject-one/join').set(writeHeaders(other.token)).send({}); // 异步等待：挂起至 Promise 落定后再继续

    const reject = await request(app).post('/api/v1/circles/reject-one/reject').set(writeHeaders(token)).send({ user_id: other.id }); // 常量 reject：保存固定配置或一次性派生值
    expect(reject.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(reject.body.status).toBe('left'); // 调用 expect 并处理其返回结果

    const members = await request(app).get('/api/v1/circles/reject-one/members').set(auth(token)); // 常量 members：保存固定配置或一次性派生值
    expect(members.body.items.some((m: { user_id: string }) => m.user_id === other.id)).toBe(false); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('invite 圈子：错误邀请码 400，正确邀请码加入成功', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    const created = await createCircle(app, token, { slug: 'invite-one', name: '邀请圈', join_mode: 'invite' }); // 常量 created：保存固定配置或一次性派生值
    const inviteCode = created.body.circle.invite_code as string; // 常量 inviteCode：保存固定配置或一次性派生值

    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    const wrong = await request(app).post('/api/v1/circles/invite-one/join').set(writeHeaders(other.token)).send({ invite_code: 'WRONG00' }); // 常量 wrong：保存固定配置或一次性派生值
    expect(wrong.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(wrong.body.details.reason).toBe('CIRCLE_INVITE_INVALID'); // 调用 expect 并处理其返回结果

    const right = await request(app).post('/api/v1/circles/invite-one/join').set(writeHeaders(other.token)).send({ invite_code: inviteCode }); // 常量 right：保存固定配置或一次性派生值
    expect(right.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(right.body.status).toBe('active'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('成员上限已满：第二人加入返回 409 CIRCLE_MEMBER_LIMIT', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'limited-one', name: '上限圈', member_limit: 1 }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    const join = await request(app).post('/api/v1/circles/limited-one/join').set(writeHeaders(other.token)).send({}); // 常量 join：保存固定配置或一次性派生值
    expect(join.status).toBe(409); // 调用 expect 并处理其返回结果
    expect(join.body.details.reason).toBe('CIRCLE_MEMBER_LIMIT'); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('私密圈子可见性与退出隔离', () => { // 调用 describe 并处理其返回结果
  it('private 圈子：非成员读详情 403，成员读 200', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'private-one', name: '私密圈', visibility: 'private' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值

    const forbidden = await request(app).get('/api/v1/circles/private-one').set(auth(other.token)); // 常量 forbidden：保存固定配置或一次性派生值
    expect(forbidden.status).toBe(403); // 调用 expect 并处理其返回结果

    const mine = await request(app).get('/api/v1/circles/private-one').set(auth(token)); // 常量 mine：保存固定配置或一次性派生值
    expect(mine.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(mine.body.circle.visibility).toBe('private'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('退出私密圈子后不可再读详情（403）', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'private-leave', name: '私密可退圈', visibility: 'private', join_mode: 'open' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    await request(app).post('/api/v1/circles/private-leave/join').set(writeHeaders(other.token)).send({}); // 异步等待：挂起至 Promise 落定后再继续

    const leave = await request(app).post('/api/v1/circles/private-leave/leave').set(writeHeaders(other.token)).send({}); // 常量 leave：保存固定配置或一次性派生值
    expect(leave.status).toBe(200); // 调用 expect 并处理其返回结果

    const after = await request(app).get('/api/v1/circles/private-leave').set(auth(other.token)); // 常量 after：保存固定配置或一次性派生值
    expect(after.status).toBe(403); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('圈内动态与公告', () => { // 调用 describe 并处理其返回结果
  it('成员可发圈内动态并在动态流读到；非成员读动态流 403', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'feed-one', name: '动态圈' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值

    const beforeJoin = await request(app).get('/api/v1/circles/feed-one/posts').set(auth(other.token)); // 常量 beforeJoin：保存固定配置或一次性派生值
    expect(beforeJoin.status).toBe(403); // 调用 expect 并处理其返回结果

    await request(app).post('/api/v1/circles/feed-one/join').set(writeHeaders(other.token)).send({}); // 异步等待：挂起至 Promise 落定后再继续
    const post = await request(app).post('/api/v1/circles/feed-one/posts').set(writeHeaders(other.token)).send({ body: '第一条圈内动态' }); // 常量 post：保存固定配置或一次性派生值
    expect(post.status).toBe(201); // 调用 expect 并处理其返回结果

    const feed = await request(app).get('/api/v1/circles/feed-one/posts').set(auth(token)); // 常量 feed：保存固定配置或一次性派生值
    expect(feed.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(feed.body.items).toHaveLength(1); // 调用 expect 并处理其返回结果
    expect(feed.body.items[0].body).toBe('第一条圈内动态'); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('圈主可发公告，成员可读；普通成员发公告 403', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'notice-one', name: '公告圈' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    await request(app).post('/api/v1/circles/notice-one/join').set(writeHeaders(other.token)).send({}); // 异步等待：挂起至 Promise 落定后再继续

    const notice = await request(app).post('/api/v1/circles/notice-one/notices').set(writeHeaders(token)).send({ body: '本周六线下聚会' }); // 常量 notice：保存固定配置或一次性派生值
    expect(notice.status).toBe(201); // 调用 expect 并处理其返回结果

    const feed = await request(app).get('/api/v1/circles/notice-one/notices').set(auth(other.token)); // 常量 feed：保存固定配置或一次性派生值
    expect(feed.status).toBe(200); // 调用 expect 并处理其返回结果
    expect(feed.body.items[0].body).toBe('本周六线下聚会'); // 调用 expect 并处理其返回结果

    const forbidden = await request(app).post('/api/v1/circles/notice-one/notices').set(writeHeaders(other.token)).send({ body: '越权公告' }); // 常量 forbidden：保存固定配置或一次性派生值
    expect(forbidden.status).toBe(403); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('非 owner/admin 执行审核操作返回 403', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'moderate-one', name: '管理圈', join_mode: 'approve' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    await request(app).post('/api/v1/circles/moderate-one/join').set(writeHeaders(other.token)).send({}); // 异步等待：挂起至 Promise 落定后再继续

    const approve = await request(app).post('/api/v1/circles/moderate-one/approve').set(writeHeaders(other.token)).send({ user_id: anotherUser(deps).id }); // 常量 approve：保存固定配置或一次性派生值
    expect(approve.status).toBe(403); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('幂等重放', () => { // 调用 describe 并处理其返回结果
  it('同一幂等键重复加入：第二次回放首次响应，成员数不翻倍', async () => { // 调用 it 并处理其返回结果
    const { app, deps, token } = setup(); // 执行当前业务步骤
    await createCircle(app, token, { slug: 'idempotent-one', name: '幂等圈' }); // 异步等待：挂起至 Promise 落定后再继续
    const other = anotherUser(deps); // 常量 other：保存固定配置或一次性派生值
    const key = randomUUID(); // 常量 key：保存固定配置或一次性派生值
    const headers = { ...auth(other.token), 'idempotency-key': key }; // 常量 headers：保存固定配置或一次性派生值

    const first = await request(app).post('/api/v1/circles/idempotent-one/join').set(headers).send({}); // 常量 first：保存固定配置或一次性派生值
    expect(first.status).toBe(201); // 调用 expect 并处理其返回结果
    const second = await request(app).post('/api/v1/circles/idempotent-one/join').set(headers).send({}); // 常量 second：保存固定配置或一次性派生值
    expect(second.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(second.body).toEqual(first.body); // 调用 expect 并处理其返回结果

    const members = await request(app).get('/api/v1/circles/idempotent-one/members').set(auth(token)); // 常量 members：保存固定配置或一次性派生值
    expect(members.body.member_count).toBe(2); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束
