/**
 * 社区激励链契约测试：签到 → 积分 → 等级 → 徽章。
 * 测试自建 mini app，只挂载 growth 路由，并用可注入时钟冻结自然日，
 * 逐项断言「签到与发分同事务」「重复签到不重复发分」「断签归零」「自然日按时区换天」
 * 「积分走既有钱包账本」「等级按累计积分升级」「徽章自动授予与手动授予幂等」以及管理端权限与审计。
 */

// 引入 Express 工厂：组装只挂激励链路由的 mini 应用
import express from 'express'; // 组装 mini app
// 引入 Express 应用类型：约束 app 句柄类型
import type { Express } from 'express'; // 应用类型
// 引入 vitest 套件与断言：组织用例、前后置与结果比对
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
// 引入 supertest：对 mini 应用发起进程内 HTTP 调用并断言响应
import request from 'supertest'; // HTTP 断言
// 引入建库函数：内存库启动即执行 schema.sql + schema.d（含激励链种子）
import { createDatabase } from '../src/db.js'; // 内存库：启动即执行 schema.sql + schema.d（含激励链种子）
// 引入建号函数：造普通测试用户
import { createUser } from '../src/identity.js'; // 造普通用户
// 引入令牌签发：造登录态访问令牌
import { issueAccessToken } from '../src/auth.js'; // 造登录态令牌
// 引入被测路由工厂：挂载 growth 路由
import { createGrowthRouter } from '../src/routes/growth.js'; // 被测路由工厂
// 引入统一错误信封处理器：保证错误响应结构一致
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
// 引入依赖容器类型：约束 deps 结构
import type { ApiDeps } from '../src/types.js'; // 依赖容器类型

const JWT_SECRET = 'growth-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'growth-admin-token'; // 超管引导令牌：requirePermission 的引导通道
const BASE = '2026-11-16T02:00:00.000Z'; // 北京时间 2026-11-16 10:00

/** 组装只含激励链路由的 mini app */
function miniApp(deps: ApiDeps): Express {
  const app = express(); // 新建 Express 实例
  app.use(express.json()); // 解析 JSON 请求体
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createGrowthRouter(deps)); // 挂载激励链路由到 /api/v1 前缀
  app.use(errorHandler); // 末尾挂统一错误信封
  return app; // 返回装配完成的应用
}

// 用例装配结果：依赖容器、应用、用户主键、令牌与时钟推进函数
interface Setup {
  deps: ApiDeps; // 依赖容器（库 / 密钥 / 时钟 / 环境）
  app: Express; // 已挂载路由的 mini 应用
  userId: string; // 普通用户主键
  token: string; // 用户访问令牌
  setNow: (iso: string) => void; // 推进时钟，模拟跨天
}

/** 装配内存库 + mini app + 普通用户；默认给一个 0 积分钱包，模拟「钱包里已有积分」的老用户 */
function setup(start: string = BASE): Setup {
  let clock = start; // 可注入时钟：用 setNow 推进，避免依赖真实时间
  const deps: ApiDeps = {
    db: createDatabase(':memory:'), // 全新内存库带激励链种子
    jwtSecret: JWT_SECRET,
    env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN }, // 超管引导令牌走环境变量
    now: () => clock, // 时钟函数读当前 clock 变量
  };
  const app = miniApp(deps); // 装配 mini 应用
  const user = createUser(deps.db, { region: 'cn', now: start }); // 造普通用户
  // 预置空钱包：避免「新用户见面礼 100 分」干扰签到积分断言；钱包账本是既有余额体系
  deps.db
    .prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 0, ?)')
    .run(user.id, start);
  const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 签发用户访问令牌
  // 返回装配结果与时钟推进闭包
  return { deps, app, userId: user.id, token, setNow: (iso: string) => { clock = iso; } };
}

/** 用户侧鉴权头 */
function auth(token: string): Record<string, string> {
  // 组装 Bearer 令牌头
  return { authorization: `Bearer ${token}` };
}

/** 管理端鉴权头：走 requirePermission 的超管引导通道 */
function admin(): Record<string, string> {
  // 组装超管引导令牌头
  return { 'x-admin-token': ADMIN_TOKEN };
}

describe('签到', () => {
  it('首次签到：签到行、积分流水、累计积分同事务落库，余额与连续天数正确', async () => {
    const { app, deps, token, userId } = setup(); // 装配用例场景

    // 先查签到状态：未签到视角返回连续 0 天、待签 5 分、余额 0
    const status = await request(app).get('/api/v1/growth/checkin').set(auth(token));
    expect(status.status).toBe(200); // 状态接口可达
    expect(status.body).toMatchObject({ checked_in_today: false, streak: 0, next_checkin_points: 5, points_balance: 0 }); // 未签到口径一致

    // 发起首次签到：应发 5 分、连续 1 天、累计 5 分
    const first = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(first.status).toBe(200); // 签到成功
    expect(first.body).toMatchObject({
      checked_in_today: true, // 今日已签到
      first_today: true, // 今日首次签到
      already_checked_in: false, // 非重复签到
      day: '2026-11-16', // 签到自然日
      points_awarded: 5, // 本次发 5 分
      points_balance: 5, // 钱包积分余额 5
      streak: 1, // 连续天数 1
      lifetime_points: 5, // 累计积分 5
    });

    // 签到行与流水都指向同一个来源，且累计积分同步
    const checkin = deps.db
      .prepare('SELECT id, day, points, streak FROM checkins WHERE user_id = ?')
      .get(userId) as { id: string; day: string; points: number; streak: number };
    expect(checkin).toMatchObject({ day: '2026-11-16', points: 5, streak: 1 }); // 签到行落库一致
    const ledger = deps.db
      .prepare("SELECT points, ref_type, ref_id FROM wallet_transactions WHERE user_id = ? AND kind = 'points'")
      .all(userId) as Array<{ points: number; ref_type: string; ref_id: string }>;
    expect(ledger).toEqual([{ points: 5, ref_type: 'checkin', ref_id: checkin.id }]); // 积分流水指向签到行
    const growth = deps.db.prepare('SELECT lifetime_points, level FROM user_growth WHERE user_id = ?').get(userId);
    expect(growth).toMatchObject({ lifetime_points: 5, level: 1 }); // 累计积分与初始等级一致
  });

  it('同日重复签到：返回已签标记且不重复发分、不重复记账', async () => {
    const { app, deps, token, userId } = setup(); // 装配场景
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 先完成首次签到

    // 同日再次签到：应判已签，本次发分为 0
    const again = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(again.status).toBe(200); // 接口放行成功
    expect(again.body).toMatchObject({
      checked_in_today: true, // 今日已签到
      first_today: false, // 非首次
      already_checked_in: true, // 命中重复签到
      points_awarded: 0, // 重复签到不发分
      points_balance: 5, // 余额保持首次签到后的值
      streak: 1, // 连续天数不重复累加
    });

    // 直查库：签到行与积分流水都只有 1 条
    const checkins = deps.db.prepare('SELECT COUNT(*) AS c FROM checkins WHERE user_id = ?').get(userId) as { c: number };
    expect(checkins.c).toBe(1); // 签到行不重复
    const rows = deps.db
      .prepare("SELECT COUNT(*) AS c FROM wallet_transactions WHERE user_id = ? AND kind = 'points'")
      .get(userId) as { c: number };
    expect(rows.c).toBe(1); // 积分流水不重复
  });

  it('连续签到累加并触发连续加成：第二天 +6', async () => {
    const { app, token, setNow } = setup(); // 装配场景
    const day1 = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 首日签到
    expect(day1.body.points_awarded).toBe(5); // 首日基础 5 分
    expect(day1.body.streak).toBe(1); // 首日连续 1 天

    setNow('2026-11-17T02:00:00.000Z'); // 次日 10:00
    const day2 = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 次日签到
    expect(day2.body).toMatchObject({ points_awarded: 6, points_balance: 11, streak: 2 }); // 次日连续加成 6 分、累计 11、连续 2 天

    // 次日状态查询：连续 2 天、当日 6 分、下次 7 分
    const status = await request(app).get('/api/v1/growth/checkin').set(auth(token));
    expect(status.body).toMatchObject({ checked_in_today: true, streak: 2, today_points: 6, next_checkin_points: 7 }); // 状态口径一致
  });

  it('断签后连续天数归零、再签从 1 重新累计', async () => {
    const { app, token, setNow } = setup(); // 装配场景
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 首日签到
    setNow('2026-11-17T02:00:00.000Z'); // 推进到次日
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 次日签到，连续 2 天

    setNow('2026-11-19T02:00:00.000Z'); // 跳过 11-18，断签一天
    const status = await request(app).get('/api/v1/growth/checkin').set(auth(token)); // 查断签后状态
    expect(status.body).toMatchObject({ checked_in_today: false, streak: 0, next_checkin_points: 5 }); // 连续天数归零、回到基础 5 分

    // 断签后再签：从连续 1 天重新累计
    const resumed = await request(app).post('/api/v1/growth/checkin').set(auth(token));
    expect(resumed.body).toMatchObject({ points_awarded: 5, streak: 1, already_checked_in: false }); // 重新起算连续 1 天
  });

  it('自然日按 Asia/Shanghai 换天：UTC 16:00 之后算次日', async () => {
    const { app, token, setNow } = setup('2026-11-16T15:59:00.000Z'); // 北京 11-16 23:59
    const before = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 当天最后一分钟签到
    expect(before.body.day).toBe('2026-11-16'); // 仍记 11-16 自然日

    setNow('2026-11-16T16:00:00.000Z'); // 北京 11-17 00:00
    const after = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 跨过 UTC 16:00 再签
    expect(after.body).toMatchObject({ day: '2026-11-17', already_checked_in: false, streak: 2 }); // 归入 11-17 自然日、连续 2 天
  });
});

describe('积分流水', () => {
  it('流水可查到每笔来源与时间，收支合计与余额一致', async () => {
    const { app, token, setNow } = setup(); // 装配场景
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 首日签到 5 分
    setNow('2026-11-17T02:00:00.000Z'); // 推进次日
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 次日签到 6 分

    // 拉积分账本：余额 11、累计收入 11、支出 0、共 2 笔
    const ledger = await request(app).get('/api/v1/growth/points').set(auth(token));
    expect(ledger.status).toBe(200); // 账本接口可达
    expect(ledger.body).toMatchObject({ balance: 11, earned_total: 11, spent_total: 0, total: 2 }); // 合计口径一致
    expect(ledger.body.items).toHaveLength(2); // 两条流水
    const latest = ledger.body.items[0] as { points: number; note: string; ref_type: string; created_at: string }; // 取最新一条
    expect(latest).toMatchObject({ points: 6, ref_type: 'checkin', created_at: '2026-11-17T02:00:00.000Z' }); // 最新流水为次日 6 分
    expect(latest.note).toContain('连续 2 天'); // 流水备注含连续天数
  });

  it('分页参数生效且不影响合计', async () => {
    const { app, token, setNow } = setup(); // 装配场景
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 首日签到
    setNow('2026-11-17T02:00:00.000Z'); // 推进次日
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 次日签到

    // 带 limit/offset 拉账本：分页只裁剪列表，合计仍按全量统计
    const page = await request(app).get('/api/v1/growth/points?limit=1&offset=0').set(auth(token));
    expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 0, earned_total: 11 }); // 合计不受分页影响
    expect(page.body.items).toHaveLength(1); // 当前页仅 1 条
  });
});

describe('等级', () => {
  it('初始进度：等级 1，距等级 2 还差 300 分', async () => {
    const { app, token } = setup(); // 装配零积分场景
    const res = await request(app).get('/api/v1/growth/level').set(auth(token)); // 拉等级进度
    expect(res.status).toBe(200); // 等级接口可达
    expect(res.body).toMatchObject({
      lifetime_points: 0, // 累计积分 0
      points_to_next: 300, // 距下一级 300 分
      progress_percent: 0, // 进度百分比 0
      level: { level: 1, name: '新人', min_points: 0 }, // 当前等级 1 新人
      next_level: { level: 2, min_points: 300 }, // 下一级门槛 300
    });
  });

  it('累计积分跨过门槛后升级，收益按累计积分而非钱包余额', async () => {
    const { app, token } = setup(); // 装配场景
    await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 签到得 5 累计分

    // 管理员下调等级门槛：2 级 5 分、3 级 50 分，触发重算
    const regrade = await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [
        { level: 1, name: '新人', min_points: 0 },
        { level: 2, name: '活跃', min_points: 5 },
        { level: 3, name: '常驻', min_points: 50 },
      ],
    });
    expect(regrade.status).toBe(200); // 等级配置保存成功

    // 拉等级：按累计 5 分应升到 2 级，距 3 级 45 分
    const res = await request(app).get('/api/v1/growth/level').set(auth(token));
    expect(res.body).toMatchObject({
      lifetime_points: 5, // 累计积分 5
      points_to_next: 45, // 距 3 级 45 分
      progress_percent: 0, // 进度百分比口径
      level: { level: 2, name: '活跃' }, // 当前升到 2 级活跃
      next_level: { level: 3, min_points: 50 }, // 下一级门槛 50
    });
  });

  it('升级时签到结果回带 level_up', async () => {
    const { app, token } = setup(); // 装配场景
    // 先把 2 级门槛压到 5 分，便于签到后跨级
    await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [
        { level: 1, name: '新人', min_points: 0 },
        { level: 2, name: '活跃', min_points: 5 },
      ],
    });
    const res = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 签到 5 分跨级
    expect(res.body.level_up).toEqual({ from: 1, to: 2 }); // 签到结果回带升级 1→2
    expect(res.body.next_level).toBeNull(); // 已达最高级，下一级为空
  });

  it('管理端等级配置校验：首级门槛必须为 0、门槛必须严格递增', async () => {
    const { app } = setup(); // 装配场景
    // 非法用例一：首级门槛非 0，应 400
    const badFirst = await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [{ level: 1, name: '新人', min_points: 10 }],
    });
    expect(badFirst.status).toBe(400); // 首级门槛校验失败

    // 非法用例二：门槛未严格递增（3 级低于 2 级），应 400
    const badOrder = await request(app).put('/api/v1/admin/growth/levels').set(admin()).send({
      levels: [
        { level: 1, name: '新人', min_points: 0 },
        { level: 2, name: '活跃', min_points: 300 },
        { level: 3, name: '常驻', min_points: 200 },
      ],
    });
    expect(badOrder.status).toBe(400); // 递增校验失败
  });
});

describe('徽章', () => {
  it('达到连续签到条件自动授予，我的徽章可查询到授予时间与进度', async () => {
    const { app, deps, token, userId, setNow } = setup(); // 装配场景
    // 管理员建一条连续 2 天解锁的徽章定义
    const created = await request(app).post('/api/v1/admin/growth/badges').set(admin()).send({
      code: 'checkin-2',
      name: '两日不断',
      description: '连续签到 2 天',
      condition_type: 'checkin_streak',
      condition_value: 2,
    });
    expect(created.status).toBe(201); // 徽章定义创建成功

    const day1 = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 首日签到，连续 1 天
    expect(day1.body.badges_awarded).toEqual([]); // 首日未达条件，不发徽章

    setNow('2026-11-17T02:00:00.000Z'); // 推进次日
    const day2 = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 次日签到，连续 2 天
    expect(day2.body.badges_awarded).toEqual(['checkin-2']); // 次日自动授予该徽章

    // 拉我的徽章：已授予、来源自动、进度 2/2、授予时间为次日时钟
    const mine = await request(app).get('/api/v1/growth/badges').set(auth(token));
    expect(mine.status).toBe(200); // 徽章列表可达
    const badge = (mine.body.badges as Array<Record<string, unknown>>).find((item) => item.code === 'checkin-2'); // 定位目标徽章
    expect(badge).toMatchObject({ awarded: true, source: 'auto', progress: { current: 2, target: 2 } }); // 授予状态 / 来源 / 进度一致
    expect(badge?.awarded_at).toBe('2026-11-17T02:00:00.000Z'); // 授予时间回读一致

    const rows = deps.db.prepare('SELECT COUNT(*) AS c FROM user_badges WHERE user_id = ?').get(userId) as { c: number };
    expect(rows.c).toBe(1); // 用户徽章记录仅 1 条
  });

  it('手动授予幂等：第二次 granted=false，不产生重复记录', async () => {
    const { app, deps, token, userId } = setup(); // 装配场景
    const payload = { user_id: userId, badge_code: 'level-3' }; // 手动授予载荷
    const first = await request(app).post('/api/v1/admin/growth/badge-grants').set(admin()).send(payload); // 首次授予
    expect(first.status).toBe(200); // 授予成功
    expect(first.body.granted).toBe(true); // 首次 granted 为真

    const second = await request(app).post('/api/v1/admin/growth/badge-grants').set(admin()).send(payload); // 重复授予同一徽章
    expect(second.body.granted).toBe(false); // 第二次 granted 为假（幂等）

    // 直查库：只落一条管理员来源记录
    const rows = deps.db
      .prepare('SELECT source FROM user_badges WHERE user_id = ? AND badge_code = ?')
      .all(userId, 'level-3') as Array<{ source: string }>;
    expect(rows).toEqual([{ source: 'admin' }]); // 不产生重复授予记录
  });

  it('停用徽章后不再自动授予，也不会出现在我的徽章列表', async () => {
    const { app, token } = setup(); // 装配场景
    // 建一条签到即得徽章定义
    await request(app).post('/api/v1/admin/growth/badges').set(admin()).send({
      code: 'checkin-any',
      name: '签到即得',
      condition_type: 'checkin_streak',
      condition_value: 1,
    });
    // 停用该徽章：active 置假
    const disabled = await request(app).delete('/api/v1/admin/growth/badges/checkin-any').set(admin());
    expect(disabled.status).toBe(200); // 停用成功
    expect(disabled.body.badge.active).toBe(false); // 已停用标记为假

    const checkin = await request(app).post('/api/v1/growth/checkin').set(auth(token)); // 签到触发自动授予判定
    expect(checkin.body.badges_awarded).not.toContain('checkin-any'); // 停用徽章不再自动授予

    const mine = await request(app).get('/api/v1/growth/badges').set(auth(token)); // 拉我的徽章列表
    expect((mine.body.badges as Array<{ code: string }>).some((item) => item.code === 'checkin-any')).toBe(false); // 停用徽章不进列表
  });
});

describe('管理端权限与审计', () => {
  it('未带凭据 401，普通用户无 content:write 时 403', async () => {
    const { app, token } = setup(); // 装配场景
    const anonymous = await request(app).get('/api/v1/admin/growth/config'); // 匿名访问管理配置
    expect(anonymous.status).toBe(401); // 未带凭据 401

    const forbidden = await request(app).get('/api/v1/admin/growth/config').set(auth(token)); // 普通用户访问
    expect(forbidden.status).toBe(403); // 无权限 403
  });

  it('写入签到规则成功并落审计；非法时区 400', async () => {
    const { app, deps } = setup(); // 装配场景
    // 管理员写入签到规则：时区 Tokyo、基础 8 分、连续加成每日 2 分、上限 5
    const saved = await request(app).put('/api/v1/admin/growth/config').set(admin()).send({
      timezone: 'Asia/Tokyo',
      checkin: { base_points: 8, streak_bonus_per_day: 2, streak_bonus_cap: 5 },
    });
    expect(saved.status).toBe(200); // 保存成功
    expect(saved.body).toMatchObject({
      timezone: 'Asia/Tokyo', // 时区回读一致
      checkin: { base_points: 8, streak_bonus_per_day: 2, streak_bonus_cap: 5 }, // 签到参数回读一致
    });

    // 审计表核对：该次配置更新落一条 success 审计
    const log = deps.db
      .prepare("SELECT action, result FROM audit_logs WHERE action = 'admin.growth.config_update'")
      .get() as { action: string; result: string } | undefined;
    expect(log).toEqual({ action: 'admin.growth.config_update', result: 'success' }); // 审计动作码与结果一致

    const invalid = await request(app).put('/api/v1/admin/growth/config').set(admin()).send({ timezone: 'Mars/Base' }); // 非法时区
    expect(invalid.status).toBe(400); // 时区校验失败 400
  });

  it('徽章定义读写：编码冲突 409，停用后仍可在管理列表看到', async () => {
    const { app } = setup(); // 装配场景
    const body = { code: 'extra-badge', name: '额外徽章', condition_type: 'points', condition_value: 100 }; // 徽章定义载荷
    expect((await request(app).post('/api/v1/admin/growth/badges').set(admin()).send(body)).status).toBe(201); // 首次创建成功
    expect((await request(app).post('/api/v1/admin/growth/badges').set(admin()).send(body)).status).toBe(409); // 同编码重复创建 409

    const updated = await request(app).put('/api/v1/admin/growth/badges/extra-badge').set(admin()).send({ name: '改名徽章' }); // 改名
    expect(updated.status).toBe(200); // 更新成功
    expect(updated.body.badge.name).toBe('改名徽章'); // 名称回读一致

    await request(app).delete('/api/v1/admin/growth/badges/extra-badge').set(admin()); // 停用徽章
    const list = await request(app).get('/api/v1/admin/growth/badges').set(admin()); // 拉管理列表
    const row = (list.body.badges as Array<{ code: string; active: boolean }>).find((item) => item.code === 'extra-badge'); // 定位停用徽章
    expect(row?.active).toBe(false); // 停用后仍在列表，仅 active 为假
  });
});
