/**
 * 内容运营契约测试：公告 / 更新日志 / 推广计划。
 * 测试自建 mini app，只挂载 content-ops 路由；公开过滤、置顶排序、未授权拒绝、
 * 管理端 CRUD、点击幂等与频控、版本聚合逐项断言。
 */

import { randomUUID } from 'node:crypto'; // 写操作幂等键
import express from 'express'; // 组装 mini app
import type { Express } from 'express'; // 引入：声明测试所需依赖
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest'; // 引入：声明测试所需依赖
import { createDatabase } from '../src/db.js'; // 内存库（含 schema.d 种子）
import { createUser } from '../src/identity.js'; // 造普通用户
import { issueAccessToken } from '../src/auth.js'; // 造登录态令牌
import { createContentOpsRouter } from '../src/routes/content-ops.js'; // 被测路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import type { ApiDeps } from '../src/types.js'; // 引入：声明测试所需依赖

const JWT_SECRET = 'content-ops-secret-0123456789abcdef0123456789'; // 固定测试密钥
const ADMIN_TOKEN = 'content-admin-token'; // 超管引导令牌，与注入 env 一致

/** 组装只含内容运营路由的 mini app */
function miniApp(deps: ApiDeps): Express {
  const app = express(); // 构造：准备本用例需要的输入、句柄或期望值
  app.use(express.json());
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createContentOpsRouter(deps));
  app.use(errorHandler);
  return app; // 返回：交回本步骤结果供断言使用
}

interface Setup {
  deps: ApiDeps;
  app: Express;
  user: ReturnType<typeof createUser>;
  token: string;
}

/** 装配内存库 + mini app + 普通用户；env 可覆盖频控等配置。 */
function setup(env: Record<string, string | undefined> = {}): Setup {
  const deps: ApiDeps = { // 构造：准备本用例需要的输入、句柄或期望值
    db: createDatabase(':memory:'),
    jwtSecret: JWT_SECRET,
    env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN, ...env },
  };
  const app = miniApp(deps); // 构造：准备本用例需要的输入、句柄或期望值
  const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 构造：准备本用例需要的输入、句柄或期望值
  const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 构造：准备本用例需要的输入、句柄或期望值
  return { deps, app, user, token }; // 返回：交回本步骤结果供断言使用
}

/** 引导通道管理端请求头 */
function adminHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN }; // 返回：交回本步骤结果供断言使用
}

/** 管理端写操作请求头：叠幂等键（全局幂等中间件对写方法强制要求）。 */
function adminWriteHeaders(): Record<string, string> {
  return { ...adminHeaders(), 'idempotency-key': randomUUID() }; // 返回：交回本步骤结果供断言使用
}

describe('公开公告列表', () => {
  it('只回已发布且在有效期内的条目，置顶在前，字段严格匹配冻结契约', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/announcements'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(res.body.items).toHaveLength(2); // 种子：1 置顶已发布 + 1 普通已发布；草稿不可见
    const [first, second] = res.body.items as Array<Record<string, unknown>>; // 准备：构造本用例需要的输入或句柄
    expect(Object.keys(first).sort()).toEqual(['body', 'id', 'pinned', 'published_at', 'title'].sort()); // 契约字段集合
    expect(first.pinned).toBe(true); // 置顶条目排第一
    expect(second.pinned).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(first.id).toBe('ann-seed-welcome'); // 断言：校验响应字段与冻结契约一致
  });

  it('草稿与已过期公告不出现在公开列表', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    // 后台补一条草稿 + 一条已过期已发布
    await request(app) // 执行：等待接口或数据库操作返回
      .post('/api/v1/admin/content/announcements')
      .set(adminWriteHeaders())
      .send({ title: '后台草稿', body: 'x', status: 'draft' });
    await request(app) // 执行：等待接口或数据库操作返回
      .post('/api/v1/admin/content/announcements')
      .set(adminWriteHeaders())
      .send({ title: '已过期公告', body: 'x', status: 'published', ends_at: '2020-01-01T00:00:00.000Z' });

    const res = await request(app).get('/api/v1/announcements'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const titles = (res.body.items as Array<{ title: string }>).map((i) => i.title); // 构造：准备本用例需要的输入、句柄或期望值
    expect(titles).not.toContain('后台草稿'); // 断言：校验响应字段与冻结契约一致
    expect(titles).not.toContain('已过期公告'); // 断言：校验响应字段与冻结契约一致
    expect(titles).toHaveLength(2); // 仍只有两条种子
  });

  it('limit 参数截断列表', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/announcements?limit=1'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(res.body.items).toHaveLength(1); // 断言：校验响应字段与冻结契约一致
  });
});

describe('公开更新日志与版本聚合', () => {
  it('按语义版本倒序返回，字段严格匹配冻结契约', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/changelog'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const versions = (res.body.items as Array<{ version: string }>).map((i) => i.version); // 构造：准备本用例需要的输入、句柄或期望值
    expect(versions).toEqual(['0.0.8', '0.0.7']); // 语义版本倒序，非字典序
    const first = res.body.items[0] as Record<string, unknown>; // 构造：准备本用例需要的输入、句柄或期望值
    expect(Object.keys(first).sort()).toEqual(['body', 'id', 'published_at', 'title', 'version'].sort()); // 断言：校验响应字段与冻结契约一致
  });

  it('语义版本排序：0.0.10 排在 0.0.8 之前', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    await request(app) // 执行：等待接口或数据库操作返回
      .post('/api/v1/admin/content/changelog')
      .set(adminWriteHeaders())
      .send({ version: '0.0.10', title: '第十个小版本', body: 'x', status: 'published', published_at: '2026-11-13T09:00:00.000Z' });
    const res = await request(app).get('/api/v1/changelog'); // 构造：准备本用例需要的输入、句柄或期望值
    const versions = (res.body.items as Array<{ version: string }>).map((i) => i.version); // 构造：准备本用例需要的输入、句柄或期望值
    expect(versions).toEqual(['0.0.10', '0.0.8', '0.0.7']); // 断言：校验响应字段与冻结契约一致
  });

  it('草稿更新日志不进入公开列表', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    await request(app) // 执行：等待接口或数据库操作返回
      .post('/api/v1/admin/content/changelog')
      .set(adminWriteHeaders())
      .send({ version: '0.0.9', title: '未发布', body: 'x', status: 'draft' });
    const res = await request(app).get('/api/v1/changelog'); // 构造：准备本用例需要的输入、句柄或期望值
    const versions = (res.body.items as Array<{ version: string }>).map((i) => i.version); // 构造：准备本用例需要的输入、句柄或期望值
    expect(versions).not.toContain('0.0.9'); // 断言：校验响应字段与冻结契约一致
  });

  it('按版本聚合视图：每版本一条代表条目 + 条目数，版本倒序', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/changelog/versions'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(res.body.items).toHaveLength(2); // 断言：校验响应字段与冻结契约一致
    const [v8, v7] = res.body.items as Array<{ version: string; entry_count: number; latest_id: string }>; // 准备：构造本用例需要的输入或句柄
    expect(v8.version).toBe('0.0.8'); // 断言：校验响应字段与冻结契约一致
    expect(v8.entry_count).toBe(1); // 断言：校验响应字段与冻结契约一致
    expect(v7.version).toBe('0.0.7'); // 断言：校验响应字段与冻结契约一致
    expect(v7.latest_id).toBeTruthy(); // 断言：校验响应字段与冻结契约一致
  });
});

describe('公开推广计划', () => {
  it('只回进行中且在有效期内的计划，字段严格匹配冻结契约', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/promotions'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(res.body.items).toHaveLength(1); // 断言：校验响应字段与冻结契约一致
    const item = res.body.items[0] as Record<string, unknown>; // 构造：准备本用例需要的输入、句柄或期望值
    expect(Object.keys(item).sort()).toEqual(['ends_at', 'id', 'name', 'status', 'summary', 'target_url', 'starts_at'].sort()); // 断言：校验响应字段与冻结契约一致
    expect(item.status).toBe('active'); // 断言：校验响应字段与冻结契约一致
    expect(item.id).toBe('promo-seed-launch'); // 断言：校验响应字段与冻结契约一致
  });

  it('草稿与已过期计划不出现在公开列表', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    await request(app) // 执行：等待接口或数据库操作返回
      .post('/api/v1/admin/content/promotions')
      .set(adminWriteHeaders())
      .send({ name: '草稿计划', status: 'draft' });
    await request(app) // 执行：等待接口或数据库操作返回
      .post('/api/v1/admin/content/promotions')
      .set(adminWriteHeaders())
      .send({ name: '过期计划', status: 'active', ends_at: '2020-01-01T00:00:00.000Z' });
    const res = await request(app).get('/api/v1/promotions'); // 构造：准备本用例需要的输入、句柄或期望值
    const names = (res.body.items as Array<{ name: string }>).map((i) => i.name); // 构造：准备本用例需要的输入、句柄或期望值
    expect(names).not.toContain('草稿计划'); // 断言：校验响应字段与冻结契约一致
    expect(names).not.toContain('过期计划'); // 断言：校验响应字段与冻结契约一致
    expect(names).toHaveLength(1); // 断言：校验响应字段与冻结契约一致
  });
});

describe('管理端鉴权门禁', () => {
  it('匿名访问管理端列表返回 401', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/admin/content/announcements'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(401); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言：校验响应字段与冻结契约一致
  });

  it('普通登录用户无运营内容权限返回 403', async () => {
    const { app, token } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/admin/content/announcements').set('Authorization', `Bearer ${token}`); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(403); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('FORBIDDEN'); // 断言：校验响应字段与冻结契约一致
  });

  it('引导令牌（x-admin-token）可访问管理端列表', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get('/api/v1/admin/content/announcements').set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(res.body.items.length).toBeGreaterThanOrEqual(3); // 三条公告种子全量可见（含草稿）
  });
});

describe('管理端 CRUD', () => {
  it('公告：新建 → 回读 → 更新 → 删除', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const create = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/content/announcements')
      .set(adminWriteHeaders())
      .send({ title: '运营公告', body: '正文', level: 'warning', status: 'published', pinned: true });
    expect(create.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const id = create.body.item.id as string; // 构造：准备本用例需要的输入、句柄或期望值

    const patch = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .patch(`/api/v1/admin/content/announcements/${id}`)
      .set(adminWriteHeaders())
      .send({ title: '运营公告（修订）', pinned: false });
    expect(patch.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(patch.body.item.title).toBe('运营公告（修订）'); // 断言：校验响应字段与冻结契约一致
    expect(patch.body.item.pinned).toBe(0); // 断言：校验响应字段与冻结契约一致

    const list = await request(app).get('/api/v1/admin/content/announcements').set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(list.body.items.some((i: { id: string }) => i.id === id)).toBe(true); // 断言：校验响应字段与冻结契约一致

    const del = await request(app).delete(`/api/v1/admin/content/announcements/${id}`).set(adminWriteHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(del.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const after = await request(app).get('/api/v1/admin/content/announcements').set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(after.body.items.some((i: { id: string }) => i.id === id)).toBe(false); // 断言：校验响应字段与冻结契约一致
  });

  it('更新日志：新建 → 重复版本号 409 → 更新 → 删除', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const create = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/content/changelog')
      .set(adminWriteHeaders())
      .send({ version: '0.0.9', title: '新版本', body: 'x', changes: ['修复问题'], status: 'published' });
    expect(create.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const id = create.body.item.id as string; // 构造：准备本用例需要的输入、句柄或期望值

    const dup = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/content/changelog')
      .set(adminWriteHeaders())
      .send({ version: '0.0.9', title: '重复版本', body: 'x', status: 'draft' });
    expect(dup.status).toBe(409); // 断言：校验响应字段与冻结契约一致
    expect(dup.body.code).toBe('CONFLICT'); // 断言：校验响应字段与冻结契约一致

    const patch = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .patch(`/api/v1/admin/content/changelog/${id}`)
      .set(adminWriteHeaders())
      .send({ title: '新版本（修订）' });
    expect(patch.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(patch.body.item.title).toBe('新版本（修订）'); // 断言：校验响应字段与冻结契约一致

    const del = await request(app).delete(`/api/v1/admin/content/changelog/${id}`).set(adminWriteHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(del.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  });

  it('推广计划：新建 → 更新状态 → 管理端可见统计字段 → 删除', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const create = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/content/promotions')
      .set(adminWriteHeaders())
      .send({ name: '双十一活动', summary: '满减', target_url: '/marketplace', code: 'DOUBLE11', budget_cents: 100000 });
    expect(create.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const id = create.body.item.id as string; // 构造：准备本用例需要的输入、句柄或期望值

    const patch = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .patch(`/api/v1/admin/content/promotions/${id}`)
      .set(adminWriteHeaders())
      .send({ status: 'paused' });
    expect(patch.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(patch.body.item.status).toBe('paused'); // 断言：校验响应字段与冻结契约一致

    const list = await request(app).get('/api/v1/admin/content/promotions').set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    const row = list.body.items.find((i: { id: string }) => i.id === id); // 构造：准备本用例需要的输入、句柄或期望值
    expect(row).toBeTruthy(); // 断言：校验响应字段与冻结契约一致
    expect(row).toHaveProperty('click_count'); // 统计列可读
    expect(row).toHaveProperty('conversion_count'); // 断言：校验响应字段与冻结契约一致
    expect(row).toHaveProperty('budget_cents'); // 断言：校验响应字段与冻结契约一致
    expect(row.budget_cents).toBe(100000); // 断言：校验响应字段与冻结契约一致

    const del = await request(app).delete(`/api/v1/admin/content/promotions/${id}`).set(adminWriteHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(del.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  });

  it('更新不存在的资源返回 404', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).patch('/api/v1/admin/content/announcements/no-such-id').set(adminWriteHeaders()).send({ title: 'x' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(404); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('NOT_FOUND'); // 断言：校验响应字段与冻结契约一致
  });
});

describe('推广点击：幂等去重与频控防刷', () => {
  it('同一幂等键重复点击只入账一次，click_count 不重复增加', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const first = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/promotions/promo-seed-launch/click')
      .set('idempotency-key', 'click-key-1');
    expect(first.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(first.body.deduped).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(first.body.click_count).toBe(1); // 断言：校验响应字段与冻结契约一致

    const second = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/promotions/promo-seed-launch/click')
      .set('idempotency-key', 'click-key-1');
    expect(second.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(second.body.deduped).toBe(true); // 命中幂等回放
    expect(second.body.click_count).toBe(1); // 计数不重复增加
  });

  it('滑动窗口频控：超过上限返回 429 RATE_LIMITED 并带 Retry-After', async () => {
    const { app } = setup({ MIM_CONTENT_CLICK_MAX: '2', MIM_CONTENT_CLICK_WINDOW_SECONDS: '600' }); // 准备：构造本用例需要的输入或句柄
    const ok1 = await request(app).post('/api/v1/promotions/promo-seed-launch/click'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(ok1.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const ok2 = await request(app).post('/api/v1/promotions/promo-seed-launch/click'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(ok2.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const limited = await request(app).post('/api/v1/promotions/promo-seed-launch/click'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(limited.status).toBe(429); // 断言：校验响应字段与冻结契约一致
    expect(limited.body.code).toBe('RATE_LIMITED'); // 断言：校验响应字段与冻结契约一致
    expect(limited.headers['retry-after']).toBeTruthy(); // 断言：校验响应字段与冻结契约一致
  });

  it('点击非进行中 / 不存在的计划返回 404', async () => {
    const { app } = setup(); // 准备：构造本用例需要的输入或句柄
    const draft = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/content/promotions')
      .set(adminWriteHeaders())
      .send({ name: '暂停计划', status: 'paused' });
    const pausedId = draft.body.item.id as string; // 构造：准备本用例需要的输入、句柄或期望值

    const paused = await request(app).post(`/api/v1/promotions/${pausedId}/click`); // 构造：准备本用例需要的输入、句柄或期望值
    expect(paused.status).toBe(404); // 断言：校验响应字段与冻结契约一致
    const missing = await request(app).post('/api/v1/promotions/no-such-promo/click'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(missing.status).toBe(404); // 断言：校验响应字段与冻结契约一致
  });
});
