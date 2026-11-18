/**
 * 社区激励链契约测试：签到 → 积分 → 等级 → 徽章。
 * 测试自建 mini app，只挂载 growth 路由，并用可注入时钟冻结自然日，
 * 逐项断言「签到与发分同事务」「重复签到不重复发分」「断签归零」「自然日按时区换天」
 * 「积分走既有钱包账本」「等级按累计积分升级」「徽章自动授予与手动授予幂等」以及管理端权限与审计。
 */

import express from 'express'; // 组装 mini app
import type { Express } from 'express'; // 应用类型
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // HTTP 断言
import { createDatabase } from '../src/db.js'; // 内存库：启动即执行 schema.sql + schema.d（含激励链种子）
import { createUser } from '../src/identity.js'; // 造普通用户
import { issueAccessToken } from '../src/auth.js'; // 造登录态令牌
import { createGrowthRouter } from '../src/routes/growth.js'; // 被测路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import type { ApiDeps } from '../src/types.js'; // 依赖容器类型

const JWT_SECRET = 'growth-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'growth-admin-token'; // 超管引导令牌：requirePermission 的引导通道
const BASE = '2026-11-16T02:00:00.000Z'; // 北京时间 2026-11-16 10:00

/** 组装只含激励链路由的 mini app */
function miniApp(deps: ApiDeps): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createGrowthRouter(deps));
  app.use(errorHandler);
  return app;
}

interface Setup {
  deps: ApiDeps;
  app: Express;
  userId: string;
  token: string;
  setNow: (iso: string) => void; // 推进时钟，模拟跨天
}

/** 装配内存库 + mini app + 普通用户；默认给一个 0 积分钱包，模拟「钱包里已有积分」的老用户 */
function setup(start: string = BASE): Setup {
  let clock = start;
  const deps: ApiDeps = {
    db: createDatabase(':memory:'),
    jwtSecret: JWT_SECRET,
    env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN },
    now: () => clock,
  };
  const app = miniApp(deps);
  const user = createUser(deps.db, { region: 'cn', now: start });
  // 预置空钱包：避免「新用户见面礼 100 分」干扰签到积分断言；钱包账本是既有余额体系
  deps.db
    .prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 0, ?)')
    .run(user.id, start);
  const token = issueAccessToken(user.id, user.region, deps.jwtSecret);
  return { deps, app, userId: user.id, token, setNow: (iso: string) => { clock = iso; } };
}

/** 用户侧鉴权头 */
function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** 管理端鉴权头：走 requirePermission 的超管引导通道 */
function admin(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN };
}

describe('签到', () => {
  it('首次签到：签到行、积分流水、累计积分同事务落库，余额与连续天数正确', async () => {
    const { app, deps, token, userId } = setup();

    const status = await request(app).get('/api/v1/growth/checkin').set(auth(token));
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ checked_in_today: false, streak: 0, next_checkin_points: 5, points_balance: 0 });

    const first = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      checked_in_today: true,
      first_today: true,
      already_checked_in: false,
      day: '2026-11-16',
      points_awarded: 5,
      points_balance: 5,
      streak: 1,
      lifetime_points: 5,
    });

    // 签到行与流水都指向同一个来源，且累计积分同步
    const checkin = deps.db
      .prepare('SELECT id, day, points, streak FROM checkins WHERE user_id = ?')
      .get(userId) as { id: string; day: string; points: number; streak: number };
    expect(checkin).toMatchObject({ day: '2026-11-16', points: 5, streak: 1 });
    const ledger = deps.db
      .prepare("SELECT points, ref_type, ref_id FROM wallet_transactions WHERE user_id = ? AND kind = 'points'")
      .all(userId) as Array<{ points: number; ref_type: string; ref_id: string }>;
    expect(ledger).toEqual([{ points: 5, ref_type: 'checkin', ref_id: checkin.id }]);
    const growth = deps.db.prepare('SELECT lifetime_points, level FROM user_growth WHERE user_id = ?').get(userId);
    expect(growth).toMatchObject({ lifetime_points: 5, level: 1 });
  });

  it('同日重复签到：返回已签标记且不重复发分、不重复记账', async () => {
    const { app, deps, token, userId } = setup();
    await request(app).post('/api/v1/growth/checkin').set(auth(token));

    const again = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      checked_in_today: true,
      first_today: false,
      already_checked_in: true,
      points_awarded: 0,
      points_balance: 5,
      streak: 1,
    });

    const checkins = deps.db.prepare('SELECT COUNT(*) AS c FROM checkins WHERE user_id = ?').get(userId) as { c: number };
    expect(checkins.c).toBe(1);
    const rows = deps.db
      .prepare("SELECT COUNT(*) AS c FROM wallet_transactions WHERE user_id = ? AND kind = 'points'")
      .get(userId) as { c: number };
    expect(rows.c).toBe(1);
  });

  it('连续签到累加并触发连续加成：第二天 +6', async () => {
    const { app, token, setNow } = setup();
    const day1 = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(day1.body.points_awarded).toBe(5);
    expect(day1.body.streak).toBe(1);

    setNow('2026-11-17T02:00:00.000Z'); // 次日 10:00
    const day2 = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(day2.body).toMatchObject({ points_awarded: 6, points_balance: 11, streak: 2 });

    const status = await request(app).get('/api/v1/growth/checkin').set(auth(token));
    expect(status.body).toMatchObject({ checked_in_today: true, streak: 2, today_points: 6, next_checkin_points: 7 });
  });

  it('断签后连续天数归零、再签从 1 重新累计', async () => {
    const { app, token, setNow } = setup();
    await request(app).post('/api/v1/growth/checkin').set(auth(token));
    setNow('2026-11-17T02:00:00.000Z');
    await request(app).post('/api/v1/growth/checkin').set(auth(token));

    setNow('2026-11-19T02:00:00.000Z'); // 跳过 11-18
    const status = await request(app).get('/api/v1/growth/checkin').set(auth(token));
    expect(status.body).toMatchObject({ checked_in_today: false, streak: 0, next_checkin_points: 5 });

    const resumed = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(resumed.body).toMatchObject({ points_awarded: 5, streak: 1, already_checked_in: false });
  });

  it('自然日按 Asia/Shanghai 换天：UTC 16:00 之后算次日', async () => {
    const { app, token, setNow } = setup('2026-11-16T15:59:00.000Z'); // 北京 11-16 23:59
    const before = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(before.body.day).toBe('2026-11-16');

    setNow('2026-11-16T16:00:00.000Z'); // 北京 11-17 00:00
    const after = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(after.body).toMatchObject({ day: '2026-11-17', already_checked_in: false, streak: 2 });
  });
});

describe('积分流水', () => {
  it('流水可查到每笔来源与时间，收支合计与余额一致', async () => {
    const { app, token, setNow } = setup();
    await request(app).post('/api/v1/growth/checkin').set(auth(token));
    setNow('2026-11-17T02:00:00.000Z');
    await request(app).post('/api/v1/growth/checkin').set(auth(token));

    const ledger = await request(app).get('/api/v1/growth/points').set(auth(token));
    expect(ledger.status).toBe(200);
    expect(ledger.body).toMatchObject({ balance: 11, earned_total: 11, spent_total: 0, total: 2 });
    expect(ledger.body.items).toHaveLength(2);
    const latest = ledger.body.items[0] as { points: number; note: string; ref_type: string; created_at: string };
    expect(latest).toMatchObject({ points: 6, ref_type: 'checkin', created_at: '2026-11-17T02:00:00.000Z' });
    expect(latest.note).toContain('连续 2 天');
  });

  it('分页参数生效且不影响合计', async () => {
    const { app, token, setNow } = setup();
    await request(app).post('/api/v1/growth/checkin').set(auth(token));
    setNow('2026-11-17T02:00:00.000Z');
    await request(app).post('/api/v1/growth/checkin').set(auth(token));

    const page = await request(app).get('/api/v1/growth/points?limit=1&offset=0').set(auth(token));
    expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 0, earned_total: 11 });
    expect(page.body.items).toHaveLength(1);
  });
});

describe('等级', () => {
  it('初始进度：等级 1，距等级 2 还差 300 分', async () => {
    const { app, token } = setup();
    const res = await request(app).get('/api/v1/growth/level').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      lifetime_points: 0,
      points_to_next: 300,
      progress_percent: 0,
      level: { level: 1, name: '新人', min_points: 0 },
      next_level: { level: 2, min_points: 300 },
    });
  });

  it('累计积分跨过门槛后升级，收益按累计积分而非钱包余额', async () => {
    const { app, token } = setup();
    await request(app).post('/api/v1/growth/checkin').set(auth(token));

    const regrade = await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [
        { level: 1, name: '新人', min_points: 0 },
        { level: 2, name: '活跃', min_points: 5 },
        { level: 3, name: '常驻', min_points: 50 },
      ],
    });
    expect(regrade.status).toBe(200);

    const res = await request(app).get('/api/v1/growth/level').set(auth(token));
    expect(res.body).toMatchObject({
      lifetime_points: 5,
      points_to_next: 45,
      progress_percent: 0,
      level: { level: 2, name: '活跃' },
      next_level: { level: 3, min_points: 50 },
    });
  });

  it('升级时签到结果回带 level_up', async () => {
    const { app, token } = setup();
    await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [
        { level: 1, name: '新人', min_points: 0 },
        { level: 2, name: '活跃', min_points: 5 },
      ],
    });
    const res = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(res.body.level_up).toEqual({ from: 1, to: 2 });
    expect(res.body.next_level).toBeNull();
  });

  it('管理端等级配置校验：首级门槛必须为 0、门槛必须严格递增', async () => {
    const { app } = setup();
    const badFirst = await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [{ level: 1, name: '新人', min_points: 10 }],
    });
    expect(badFirst.status).toBe(400);

    const badOrder = await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [
        { level: 1, name: '新人', min_points: 0 },
        { level: 2, name: '活跃', min_points: 300 },
        { level: 3, name: '常驻', min_points: 200 },
      ],
    });
    expect(badOrder.status).toBe(400);
  });
});

describe('徽章', () => {
  it('达到连续签到条件自动授予，我的徽章可查询到授予时间与进度', async () => {
    const { app, deps, token, userId, setNow } = setup();
    const created = await request(app).post('/api/v1/admin/growth/badges').set(admin()).send({
      code: 'checkin-2',
      name: '两日不断',
      description: '连续签到 2 天',
      condition_type: 'checkin_streak',
      condition_value: 2,
    });
    expect(created.status).toBe(201);

    const day1 = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(day1.body.badges_awarded).toEqual([]);

    setNow('2026-11-17T02:00:00.000Z');
    const day2 = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(day2.body.badges_awarded).toEqual(['checkin-2']);

    const mine = await request(app).get('/api/v1/growth/badges').set(auth(token));
    expect(mine.status).toBe(200);
    const badge = (mine.body.badges as Array<Record<string, unknown>>).find((item) => item.code === 'checkin-2');
    expect(badge).toMatchObject({ awarded: true, source: 'auto', progress: { current: 2, target: 2 } });
    expect(badge?.awarded_at).toBe('2026-11-17T02:00:00.000Z');

    const rows = deps.db.prepare('SELECT COUNT(*) AS c FROM user_badges WHERE user_id = ?').get(userId) as { c: number };
    expect(rows.c).toBe(1);
  });

  it('手动授予幂等：第二次 granted=false，不产生重复记录', async () => {
    const { app, deps, token, userId } = setup();
    const payload = { user_id: userId, badge_code: 'level-3' };
    const first = await request(app).post('/api/v1/admin/growth/badge-grants').set(admin()).send(payload);
    expect(first.status).toBe(200);
    expect(first.body.granted).toBe(true);

    const second = await request(app).post('/api/v1/admin/growth/badge-grants').set(admin()).send(payload);
    expect(second.body.granted).toBe(false);

    const rows = deps.db
      .prepare('SELECT source FROM user_badges WHERE user_id = ? AND badge_code = ?')
      .all(userId, 'level-3') as Array<{ source: string }>;
    expect(rows).toEqual([{ source: 'admin' }]);
  });

  it('停用徽章后不再自动授予，也不会出现在我的徽章列表', async () => {
    const { app, token } = setup();
    await request(app).post('/api/v1/admin/growth/badges').set(admin()).send({
      code: 'checkin-any',
      name: '签到即得',
      condition_type: 'checkin_streak',
      condition_value: 1,
    });
    const disabled = await request(app).delete('/api/v1/admin/growth/badges/checkin-any').set(admin());
    expect(disabled.status).toBe(200);
    expect(disabled.body.badge.active).toBe(false);

    const checkin = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(checkin.body.badges_awarded).not.toContain('checkin-any');

    const mine = await request(app).get('/api/v1/growth/badges').set(auth(token));
    expect((mine.body.badges as Array<{ code: string }>).some((item) => item.code === 'checkin-any')).toBe(false);
  });
});

describe('管理端权限与审计', () => {
  it('未带凭据 401，普通用户无 content:write 时 403', async () => {
    const { app, token } = setup();
    const anonymous = await request(app).get('/api/v1/admin/growth/config');
    expect(anonymous.status).toBe(401);

    const forbidden = await request(app).get('/api/v1/admin/growth/config').set(auth(token));
    expect(forbidden.status).toBe(403);
  });

  it('写入签到规则成功并落审计；非法时区 400', async () => {
    const { app, deps } = setup();
    const saved = await request(app).put('/api/v1/admin/growth/config').set(admin()).send({
      timezone: 'Asia/Tokyo',
      checkin: { base_points: 8, streak_bonus_per_day: 2, streak_bonus_cap: 5 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      timezone: 'Asia/Tokyo',
      checkin: { base_points: 8, streak_bonus_per_day: 2, streak_bonus_cap: 5 },
    });

    const log = deps.db
      .prepare("SELECT action, result FROM audit_logs WHERE action = 'admin.growth.config_update'")
      .get() as { action: string; result: string } | undefined;
    expect(log).toEqual({ action: 'admin.growth.config_update', result: 'success' });

    const invalid = await request(app).put('/api/v1/admin/growth/config').set(admin()).send({ timezone: 'Mars/Base' });
    expect(invalid.status).toBe(400);
  });

  it('徽章定义读写：编码冲突 409，停用后仍可在管理列表看到', async () => {
    const { app } = setup();
    const body = { code: 'extra-badge', name: '额外徽章', condition_type: 'points', condition_value: 100 };
    expect((await request(app).post('/api/v1/admin/growth/badges').set(admin()).send(body)).status).toBe(201);
    expect((await request(app).post('/api/v1/admin/growth/badges').set(admin()).send(body)).status).toBe(409);

    const updated = await request(app).put('/api/v1/admin/growth/badges/extra-badge').set(admin()).send({ name: '改名徽章' });
    expect(updated.status).toBe(200);
    expect(updated.body.badge.name).toBe('改名徽章');

    await request(app).delete('/api/v1/admin/growth/badges/extra-badge').set(admin());
    const list = await request(app).get('/api/v1/admin/growth/badges').set(admin());
    const row = (list.body.badges as Array<{ code: string; active: boolean }>).find((item) => item.code === 'extra-badge');
    expect(row?.active).toBe(false);
  });
});
