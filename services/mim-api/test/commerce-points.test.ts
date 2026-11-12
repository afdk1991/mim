/** 契约测试：商业化三期 · 积分抵扣（比例 / 单笔上限 / 余额不足 / 超额 / 0 元单 / 同事务） */

import { randomUUID } from 'node:crypto'; // 写操作幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // 测试编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { computeDeduction } from '../src/commerce/points.js'; // 纯计算函数直测
import { readPointsConfig as readConfig } from '../src/commerce/config.js'; // 配置读取

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 运营引导令牌

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 内存库句柄

interface Session { token: string; userId: string } // 登录会话

async function login(identifier: string): Promise<Session> { // 验证码 + 密码登录同款流程
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier }); // 构造：准备本用例需要的输入、句柄或期望值
  expect(codeRes.status).toBe(201); // 断言：校验响应字段与冻结契约一致
  const loginRes = await request(app).post('/api/v1/auth/login').send({ // 构造：准备本用例需要的输入、句柄或期望值
    region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' },
  });
  expect(loginRes.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string };
}

function authHeaders(token: string): Record<string, string> { // 鉴权请求头（读）
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function writeHeaders(token: string): Record<string, string> { // 写请求头 + 幂等键（全局强制幂等）
  return { ...authHeaders(token), 'idempotency-key': randomUUID() };
}

/** 直接造钱包积分余额（不发见面礼，避免干扰断言） */
function setPoints(userId: string, points: number): void {
  db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT(user_id) DO UPDATE SET points = excluded.points')
    .run(userId, points, new Date().toISOString());
}

function walletPoints(userId: string): number {
  const row = db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number } | undefined; // 构造：准备本用例需要的输入、句柄或期望值
  return row?.points ?? 0; // 返回：交回本步骤结果供断言使用
}

beforeEach(() => { // 每例重建内存库；默认配置：100 积分 = 1 元，单笔上限 30%
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } });
});

describe('积分抵扣 · 纯函数边界', () => {
  const config = readConfig({}); // 缺省配置：100 积分/元，上限 30%

  it('0 元订单不抵扣、不消耗积分', () => {
    const result = computeDeduction({ amountCents: 0, pointsBalance: 5000, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
    expect(result.points_spent).toBe(0); // 断言：校验响应字段与冻结契约一致
  });

  it('无积分余额时抵扣为 0', () => {
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 0, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
    expect(result.payable_cents).toBe(9900); // 断言：校验响应字段与冻结契约一致
  });

  it('单笔上限百分比截断：9900 分订单最多抵 30% = 2970 分', () => {
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 5000, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(2970); // 上限约束
    expect(result.capped_by).toBe('ratio'); // 断言：校验响应字段与冻结契约一致
    expect(result.payable_cents).toBe(6930); // 断言：校验响应字段与冻结契约一致
  });

  it('余额不足时按余额可折金额截断', () => {
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 100, config }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(100); // 100 积分 = 100 分
    expect(result.points_spent).toBe(100); // 断言：校验响应字段与冻结契约一致
    expect(result.capped_by).toBe('balance'); // 断言：校验响应字段与冻结契约一致
  });

  it('总开关关闭时不抵扣', () => {
    const disabled = readConfig({ MIM_POINTS_DEDUCTION_ENABLED: '0' }); // 构造：准备本用例需要的输入、句柄或期望值
    const result = computeDeduction({ amountCents: 9900, pointsBalance: 5000, config: disabled }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.deduct_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
  });

  it('指定积分超过单笔上限报错 POINTS_CAP_EXCEEDED', () => {
    expect(() => computeDeduction({ amountCents: 9900, pointsBalance: 5000, config, pointsToUse: 5000 })) // 断言：校验响应字段与冻结契约一致
      .toThrowError(/points deduction exceeds per-order cap/);
  });

  it('指定积分超过余额报错 INSUFFICIENT_POINTS', () => {
    expect(() => computeDeduction({ amountCents: 9900, pointsBalance: 50, config, pointsToUse: 100 })) // 断言：校验响应字段与冻结契约一致
      .toThrowError(/insufficient points balance/);
  });
});

describe('积分抵扣 · 结算链路（购物车）', () => {
  it('自动最大化抵扣：受 30% 上限截断，积分与订单同事务落库', async () => {
    const session = await login('13800001001'); // 构造：准备本用例需要的输入、句柄或期望值
    setPoints(session.userId, 5000); // 5000 积分
    await request(app).post('/api/v1/cart/items').set(writeHeaders(session.token)).send({ module_code: 'comic.genpack.basic' }); // 执行：等待接口或数据库操作返回
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(session.token)).send({ use_points: true }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(checkout.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const result = checkout.body.results[0]; // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.kind).toBe('order'); // 断言：校验响应字段与冻结契约一致
    expect(result.points_spent).toBe(2970); // 上限内最大化
    expect(result.points_deduct_cents).toBe(2970); // 断言：校验响应字段与冻结契约一致
    expect(result.payable_cents).toBe(6930); // 9900 - 2970
    expect(result.order.status).toBe('pending'); // 抵扣后仍有待付余额
    expect(walletPoints(session.userId)).toBe(2030); // 5000 - 2970
    const order = db.prepare('SELECT points_spent, points_deduct_cents FROM module_orders WHERE user_id = ?').get(session.userId) as { points_spent: number; points_deduct_cents: number }; // 构造：准备本用例需要的输入、句柄或期望值
    expect(order.points_spent).toBe(2970); // 订单留痕
    expect(order.points_deduct_cents).toBe(2970); // 断言：校验响应字段与冻结契约一致
  });

  it('余额不足按余额截断抵扣', async () => {
    const session = await login('13800001002'); // 构造：准备本用例需要的输入、句柄或期望值
    setPoints(session.userId, 100);
    await request(app).post('/api/v1/cart/items').set(writeHeaders(session.token)).send({ module_code: 'comic.genpack.basic' }); // 执行：等待接口或数据库操作返回
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(session.token)).send({ use_points: true }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(checkout.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const result = checkout.body.results[0]; // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.points_spent).toBe(100); // 断言：校验响应字段与冻结契约一致
    expect(result.points_deduct_cents).toBe(100); // 断言：校验响应字段与冻结契约一致
    expect(result.payable_cents).toBe(9800); // 断言：校验响应字段与冻结契约一致
    expect(walletPoints(session.userId)).toBe(0); // 断言：校验响应字段与冻结契约一致
  });

  it('指定积分超额被拒：不生成订单、不扣积分', async () => {
    const session = await login('13800001003'); // 构造：准备本用例需要的输入、句柄或期望值
    setPoints(session.userId, 5000);
    await request(app).post('/api/v1/cart/items').set(writeHeaders(session.token)).send({ module_code: 'comic.genpack.basic' }); // 执行：等待接口或数据库操作返回
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(session.token)).send({ points_to_use: 5000 }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(checkout.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(checkout.body.details.reason).toBe('POINTS_CAP_EXCEEDED'); // 断言：校验响应字段与冻结契约一致
    expect(walletPoints(session.userId)).toBe(5000); // 未扣积分
    const orderCount = (db.prepare('SELECT COUNT(*) AS n FROM module_orders WHERE user_id = ?').get(session.userId) as { n: number }).n; // 构造：准备本用例需要的输入、句柄或期望值
    expect(orderCount).toBe(0); // 未生成订单
  });

  it('指定积分不足被拒：不生成订单', async () => {
    const session = await login('13800001004'); // 构造：准备本用例需要的输入、句柄或期望值
    setPoints(session.userId, 50);
    await request(app).post('/api/v1/cart/items').set(writeHeaders(session.token)).send({ module_code: 'comic.genpack.basic' }); // 执行：等待接口或数据库操作返回
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(session.token)).send({ points_to_use: 100 }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(checkout.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(checkout.body.details.reason).toBe('INSUFFICIENT_POINTS'); // 断言：校验响应字段与冻结契约一致
    expect(walletPoints(session.userId)).toBe(50); // 断言：校验响应字段与冻结契约一致
  });

  it('免费模块结算不消耗积分', async () => {
    const session = await login('13800001005'); // 构造：准备本用例需要的输入、句柄或期望值
    setPoints(session.userId, 5000);
    await request(app).post('/api/v1/cart/items').set(writeHeaders(session.token)).send({ module_code: 'comic.workbench' }); // 执行：等待接口或数据库操作返回
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(session.token)).send({ use_points: true }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(checkout.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(checkout.body.results[0].kind).toBe('unlocked'); // 断言：校验响应字段与冻结契约一致
    expect(walletPoints(session.userId)).toBe(5000); // 积分未动
  });

  it('未开启积分抵扣时订单不带抵扣明细', async () => {
    const session = await login('13800001006'); // 构造：准备本用例需要的输入、句柄或期望值
    setPoints(session.userId, 5000);
    await request(app).post('/api/v1/cart/items').set(writeHeaders(session.token)).send({ module_code: 'comic.genpack.basic' }); // 执行：等待接口或数据库操作返回
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(session.token)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(checkout.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const result = checkout.body.results[0]; // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.points_spent).toBe(0); // 断言：校验响应字段与冻结契约一致
    expect(result.points_deduct_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
    expect(result.payable_cents).toBe(9900); // 断言：校验响应字段与冻结契约一致
    expect(walletPoints(session.userId)).toBe(5000); // 断言：校验响应字段与冻结契约一致
  });
});

describe('积分抵扣 · 全额抵扣即时结算', () => {
  it('上限放开且积分充足时全额抵扣：订单 paid + 权益发放 + 积分扣减同事务', async () => {
    const cappedDb = createDatabase(':memory:'); // 独立内存库
    const cappedApp = createApp({ // 单笔上限 100% 的独立应用实例
      db: cappedDb,
      jwtSecret: JWT_SECRET,
      env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_POINTS_MAX_RATIO_PERCENT: '100' },
    });
    const codeRes = await request(cappedApp).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier: '13800001007' }); // 构造：准备本用例需要的输入、句柄或期望值
    const loginRes = await request(cappedApp).post('/api/v1/auth/login').send({ // 构造：准备本用例需要的输入、句柄或期望值
      region: 'cn', provider: 'phone', identifier: '13800001007', code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' },
    });
    const token = loginRes.body.access_token as string; // 构造：准备本用例需要的输入、句柄或期望值
    const userId = loginRes.body.user.id as string; // 构造：准备本用例需要的输入、句柄或期望值
    cappedDb.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT(user_id) DO UPDATE SET points = excluded.points')
      .run(userId, 10000, new Date().toISOString());
    await request(cappedApp).post('/api/v1/cart/items').set(writeHeaders(token)).send({ module_code: 'media.storage' }); // 执行：等待接口或数据库操作返回
    const checkout = await request(cappedApp).post('/api/v1/cart/checkout').set(writeHeaders(token)).send({ use_points: true }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(checkout.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const result = checkout.body.results[0]; // 构造：准备本用例需要的输入、句柄或期望值
    expect(result.order.status).toBe('paid'); // 全额抵扣即时结算
    expect(result.payable_cents).toBe(0); // 断言：校验响应字段与冻结契约一致
    expect(result.points_spent).toBe(4900); // 4900 分 = 4900 积分（100 积分/元）
    const entitlement = cappedDb.prepare('SELECT id FROM entitlements WHERE user_id = ? AND module_id = (SELECT id FROM modules WHERE code = ? AND region = ?)') // 构造：准备本用例需要的输入、句柄或期望值
      .get(userId, 'media.storage', 'cn') as { id: string } | undefined;
    expect(entitlement).toBeDefined(); // 权益已发放
  });
});
