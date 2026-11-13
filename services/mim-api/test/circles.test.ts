/**
 * 圈子（circle）契约测试：创建门槛 / 三种加入方式 / 满员 / 私密可见性 / 审核 /
 * 圈内动态与公告 / 退出隔离 / 幂等重放 / 访客 401。
 * 测试自建 mini express app，只挂载 circles 路由；与板块（board）测试互不干扰。
 */

import { randomUUID } from 'node:crypto';
import express from 'express'; // 组装 mini app
import type { Express } from 'express'; // 引入：声明测试所需依赖
import { describe, expect, it } from 'vitest';
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
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createCirclesRouter(deps));
  app.use(errorHandler);
  return app;
}

interface Setup {
  deps: ApiDeps;
  app: Express;
  user: ReturnType<typeof createUser>;
  token: string;
}

/** 装配内存库 + mini app + 普通用户；env 可覆盖等级 / 数量等配置。 */
function setup(env: Record<string, string | undefined> = {}): Setup {
  const deps: ApiDeps = { db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env };
  const app = miniApp(deps);
  const user = createUser(deps.db, { region: 'cn', now: FIXED_NOW });
  const token = issueAccessToken(user.id, user.region, deps.jwtSecret);
  return { deps, app, user, token };
}

/** 再造一个用户并返回其令牌与 ID。 */
function anotherUser(deps: ApiDeps, identifier = '13800000002'): { id: string; token: string } {
  const user = createUser(deps.db, { region: 'cn', now: FIXED_NOW, display_name: identifier });
  return { id: user.id, token: issueAccessToken(user.id, user.region, deps.jwtSecret) };
}

/** 登录请求头 */
function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

/** 写操作请求头：叠幂等键（全局幂等中间件对写方法强制要求）。 */
function writeHeaders(token: string): Record<string, string> {
  return { ...auth(token), 'idempotency-key': randomUUID() };
}

/** 以指定参数创建圈子并返回响应（默认 open / public）。 */
async function createCircle(
  app: Express,
  token: string,
  payload: Record<string, unknown>,
): Promise<request.Response> {
  return request(app).post('/api/v1/circles').set(writeHeaders(token)).send(payload);
}

describe('圈子公开浏览与访客门禁', () => {
  it('匿名可拉取公开圈子列表（空库返回空 items）', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/circles');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('匿名创建圈子返回 401', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/v1/circles').send({ slug: 'anon', name: '匿名圈' });
    expect(res.status).toBe(401);
  });

  it('匿名加入圈子返回 401', async () => {
    const { app, token } = setup();
    const created = await createCircle(app, token, { slug: 'open-one', name: '开放圈' });
    expect(created.status).toBe(201);
    const res = await request(app).post(`/api/v1/circles/${created.body.circle.slug}/join`).send({});
    expect(res.status).toBe(401);
  });
});

describe('圈子创建门槛', () => {
  it('登录用户可创建 open/public 圈子，创建者自动成为 owner，成员数为 1', async () => {
    const { app, token, user } = setup();
    const res = await createCircle(app, token, { slug: 'makers', name: '手作同好', intro: '一起做手工' });
    expect(res.status).toBe(201);
    expect(res.body.circle.slug).toBe('makers');
    expect(res.body.circle.my_role).toBe('owner');
    expect(res.body.circle.i_am_member).toBe(true);
    expect(res.body.circle.member_count).toBe(1);
    expect(res.body.circle.owner_id).toBe(user.id);
    expect(typeof res.body.circle.invite_code).toBe('string');

    const detail = await request(app).get('/api/v1/circles/makers').set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.circle.name).toBe('手作同好');
  });

  it('每人创建数量达上限（默认 1）后再建返回 400 CIRCLE_CREATE_LIMIT', async () => {
    const { app, token } = setup();
    const first = await createCircle(app, token, { slug: 'first-circle', name: '第一个圈' });
    expect(first.status).toBe(201);
    const second = await createCircle(app, token, { slug: 'second-circle', name: '第二个圈' });
    expect(second.status).toBe(400);
    expect(second.body.details.reason).toBe('CIRCLE_CREATE_LIMIT');
  });

  it('等级门槛：min_level=2 时新用户（Lv.1）创建返回 403 CIRCLE_CREATE_LEVEL', async () => {
    const { app, token } = setup({ MIM_CIRCLE_CREATE_MIN_LEVEL: '2' });
    const res = await createCircle(app, token, { slug: 'high-level', name: '高等级圈' });
    expect(res.status).toBe(403);
    expect(res.body.details.reason).toBe('CIRCLE_CREATE_LEVEL');
  });

  it('slug 重复返回 409 CONFLICT', async () => {
    const { app, token } = setup();
    await createCircle(app, token, { slug: 'dup-slug', name: '圈 A' });
    const dup = await createCircle(app, token, { slug: 'dup-slug', name: '圈 B' });
    expect(dup.status).toBe(409);
  });
});

describe('加入方式：open / approve / invite', () => {
  it('open 圈子：新成员直接 active，成员数 +1 且出现在名单', async () => {
    const { app, deps, token } = setup();
    const created = await createCircle(app, token, { slug: 'open-join', name: '开放圈' });
    const other = anotherUser(deps);
    const join = await request(app).post(`/api/v1/circles/open-join/join`).set(writeHeaders(other.token)).send({});
    expect(join.status).toBe(201);
    expect(join.body.status).toBe('active');
    expect(join.body.role).toBe('member');

    const members = await request(app).get('/api/v1/circles/open-join/members').set(auth(other.token));
    expect(members.status).toBe(200);
    expect(members.body.member_count).toBe(2);
    expect(members.body.items.some((m: { user_id: string }) => m.user_id === other.id)).toBe(true);
  });

  it('approve 圈子：先落 pending，圈主通过后转 active', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'approve-one', name: '审核圈', join_mode: 'approve' });
    const other = anotherUser(deps);
    const join = await request(app).post('/api/v1/circles/approve-one/join').set(writeHeaders(other.token)).send({});
    expect(join.status).toBe(200);
    expect(join.body.status).toBe('pending');

    const approve = await request(app).post('/api/v1/circles/approve-one/approve').set(writeHeaders(token)).send({ user_id: other.id });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('active');

    const members = await request(app).get('/api/v1/circles/approve-one/members').set(auth(other.token));
    expect(members.body.member_count).toBe(2);
  });

  it('approve 圈子：圈主拒绝后成员置 left，不进入名单', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'reject-one', name: '拒绝圈', join_mode: 'approve' });
    const other = anotherUser(deps);
    await request(app).post('/api/v1/circles/reject-one/join').set(writeHeaders(other.token)).send({});

    const reject = await request(app).post('/api/v1/circles/reject-one/reject').set(writeHeaders(token)).send({ user_id: other.id });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('left');

    const members = await request(app).get('/api/v1/circles/reject-one/members').set(auth(token));
    expect(members.body.items.some((m: { user_id: string }) => m.user_id === other.id)).toBe(false);
  });

  it('invite 圈子：错误邀请码 400，正确邀请码加入成功', async () => {
    const { app, deps, token } = setup();
    const created = await createCircle(app, token, { slug: 'invite-one', name: '邀请圈', join_mode: 'invite' });
    const inviteCode = created.body.circle.invite_code as string;

    const other = anotherUser(deps);
    const wrong = await request(app).post('/api/v1/circles/invite-one/join').set(writeHeaders(other.token)).send({ invite_code: 'WRONG00' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.details.reason).toBe('CIRCLE_INVITE_INVALID');

    const right = await request(app).post('/api/v1/circles/invite-one/join').set(writeHeaders(other.token)).send({ invite_code: inviteCode });
    expect(right.status).toBe(201);
    expect(right.body.status).toBe('active');
  });

  it('成员上限已满：第二人加入返回 409 CIRCLE_MEMBER_LIMIT', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'limited-one', name: '上限圈', member_limit: 1 });
    const other = anotherUser(deps);
    const join = await request(app).post('/api/v1/circles/limited-one/join').set(writeHeaders(other.token)).send({});
    expect(join.status).toBe(409);
    expect(join.body.details.reason).toBe('CIRCLE_MEMBER_LIMIT');
  });
});

describe('私密圈子可见性与退出隔离', () => {
  it('private 圈子：非成员读详情 403，成员读 200', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'private-one', name: '私密圈', visibility: 'private' });
    const other = anotherUser(deps);

    const forbidden = await request(app).get('/api/v1/circles/private-one').set(auth(other.token));
    expect(forbidden.status).toBe(403);

    const mine = await request(app).get('/api/v1/circles/private-one').set(auth(token));
    expect(mine.status).toBe(200);
    expect(mine.body.circle.visibility).toBe('private');
  });

  it('退出私密圈子后不可再读详情（403）', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'private-leave', name: '私密可退圈', visibility: 'private', join_mode: 'open' });
    const other = anotherUser(deps);
    await request(app).post('/api/v1/circles/private-leave/join').set(writeHeaders(other.token)).send({});

    const leave = await request(app).post('/api/v1/circles/private-leave/leave').set(writeHeaders(other.token)).send({});
    expect(leave.status).toBe(200);

    const after = await request(app).get('/api/v1/circles/private-leave').set(auth(other.token));
    expect(after.status).toBe(403);
  });
});

describe('圈内动态与公告', () => {
  it('成员可发圈内动态并在动态流读到；非成员读动态流 403', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'feed-one', name: '动态圈' });
    const other = anotherUser(deps);

    const beforeJoin = await request(app).get('/api/v1/circles/feed-one/posts').set(auth(other.token));
    expect(beforeJoin.status).toBe(403);

    await request(app).post('/api/v1/circles/feed-one/join').set(writeHeaders(other.token)).send({});
    const post = await request(app).post('/api/v1/circles/feed-one/posts').set(writeHeaders(other.token)).send({ body: '第一条圈内动态' });
    expect(post.status).toBe(201);

    const feed = await request(app).get('/api/v1/circles/feed-one/posts').set(auth(token));
    expect(feed.status).toBe(200);
    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0].body).toBe('第一条圈内动态');
  });

  it('圈主可发公告，成员可读；普通成员发公告 403', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'notice-one', name: '公告圈' });
    const other = anotherUser(deps);
    await request(app).post('/api/v1/circles/notice-one/join').set(writeHeaders(other.token)).send({});

    const notice = await request(app).post('/api/v1/circles/notice-one/notices').set(writeHeaders(token)).send({ body: '本周六线下聚会' });
    expect(notice.status).toBe(201);

    const feed = await request(app).get('/api/v1/circles/notice-one/notices').set(auth(other.token));
    expect(feed.status).toBe(200);
    expect(feed.body.items[0].body).toBe('本周六线下聚会');

    const forbidden = await request(app).post('/api/v1/circles/notice-one/notices').set(writeHeaders(other.token)).send({ body: '越权公告' });
    expect(forbidden.status).toBe(403);
  });

  it('非 owner/admin 执行审核操作返回 403', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'moderate-one', name: '管理圈', join_mode: 'approve' });
    const other = anotherUser(deps);
    await request(app).post('/api/v1/circles/moderate-one/join').set(writeHeaders(other.token)).send({});

    const approve = await request(app).post('/api/v1/circles/moderate-one/approve').set(writeHeaders(other.token)).send({ user_id: anotherUser(deps).id });
    expect(approve.status).toBe(403);
  });
});

describe('幂等重放', () => {
  it('同一幂等键重复加入：第二次回放首次响应，成员数不翻倍', async () => {
    const { app, deps, token } = setup();
    await createCircle(app, token, { slug: 'idempotent-one', name: '幂等圈' });
    const other = anotherUser(deps);
    const key = randomUUID();
    const headers = { ...auth(other.token), 'idempotency-key': key };

    const first = await request(app).post('/api/v1/circles/idempotent-one/join').set(headers).send({});
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/v1/circles/idempotent-one/join').set(headers).send({});
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const members = await request(app).get('/api/v1/circles/idempotent-one/members').set(auth(token));
    expect(members.body.member_count).toBe(2);
  });
});
