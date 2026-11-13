/**
 * 契约测试：独立商城 shop 结算接入积分抵扣（三期收口）。
 *
 * 组合顺序：商品原价 → 优惠码折扣 → 积分抵扣 → 余额扣款；积分扣减、订单落库、
 * 余额扣款同事务，失败整体回滚。覆盖：上限百分比截断 / 余额截断 / 积分不足 /
 * 超额 / 开关关闭 / 全额抵扣即时完成 / 订单留痕回显。
 *
 * 每个用例 beforeEach 重建内存 SQLite 与真实 Express 应用；写请求带独立幂等键。
 */

import { randomUUID } from 'node:crypto'; // 写操作幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // 测试编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import type { Db } from '../src/types.js'; // 数据库连接类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_PASSWORD = 'testpass123'; // 运营引导口令
const PRODUCT = 'pixi-pack'; // 自动发卡商品：1900 分，库存卡密 3 张

let app: Express; // 待测应用
let db: Db; // 内存库句柄

beforeEach(() => { // 每例重建内存库；默认配置：100 积分 = 1 元，单笔上限 30%
  db = createDatabase(':memory:'); // 赋值：更新变量 db 的取值
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD } }); // 赋值：更新变量 app 的取值
}); // 代码块结束

async function login(identifier: string): Promise<{ token: string; userId: string }> { // 密码登录同款流程
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD }); // 常量 res：保存固定配置或一次性派生值
  expect(res.status).toBe(200); // 调用 expect 并处理其返回结果
  return { token: res.body.access_token as string, userId: res.body.user.id as string }; // 返回当前函数的处理结果
} // 代码块结束

function writeHeaders(token: string): Record<string, string> { // 写请求头 + 幂等键
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }; // 返回当前函数的处理结果
} // 代码块结束

/** 直接造钱包余额与积分，绕过充值 / 签到链路。 */
function setWallet(userId: string, balanceCents: number, points: number): void {
  db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET balance_cents = excluded.balance_cents, points = excluded.points, updated_at = excluded.updated_at') // 执行当前业务步骤
    .run(userId, balanceCents, points, new Date().toISOString()); // 执行当前业务步骤
} // 代码块结束

function wallet(userId: string): { balance_cents: number; points: number } { // 函数 wallet：封装一段可复用的处理逻辑
  const row = db.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as { balance_cents: number; points: number } | undefined; // 常量 row：保存固定配置或一次性派生值
  return row ?? { balance_cents: 0, points: 0 }; // 返回当前函数的处理结果
} // 代码块结束

function orderRow(userId: string): { payable_cents: number; points_spent: number; points_deduct_cents: number; status: string } { // 函数 orderRow：封装一段可复用的处理逻辑
  return db.prepare('SELECT payable_cents, points_spent, points_deduct_cents, status FROM shop_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as { payable_cents: number; points_spent: number; points_deduct_cents: number; status: string }; // 返回当前函数的处理结果
} // 代码块结束

describe('shop 积分抵扣 · 正常抵扣与边界', () => { // 调用 describe 并处理其返回结果
  it('最大化抵扣受单笔 30% 上限截断；积分、订单、余额同事务落库并回显', async () => { // 调用 it 并处理其返回结果
    const session = await login('13820000001'); // 常量 session：保存固定配置或一次性派生值
    setWallet(session.userId, 20000, 5000); // 5000 积分，余额充足

    const order = await request(app).post('/api/v1/shop/orders').set(writeHeaders(session.token)).send({ product_code: PRODUCT, use_points: true }); // 常量 order：保存固定配置或一次性派生值
    expect(order.status).toBe(201); // 调用 expect 并处理其返回结果
    // 1900 × 30% = 570 分上限；5000 积分可折 5000 分，按上限截断
    expect(order.body.points_deduct_cents).toBe(570);
    expect(order.body.points_spent).toBe(570); // 调用 expect 并处理其返回结果
    expect(order.body.payable_cents).toBe(1330); // 1900 - 570
    expect(order.body.discount_cents).toBe(0); // 既有优惠码字段不变
    expect(order.body.delivery_kind).toBe('virtual_auto'); // 调用 expect 并处理其返回结果

    const after = wallet(session.userId); // 常量 after：保存固定配置或一次性派生值
    expect(after.points).toBe(4430); // 5000 - 570
    expect(after.balance_cents).toBe(18670); // 20000 - 1330

    const row = orderRow(session.userId); // 常量 row：保存固定配置或一次性派生值
    expect(row.points_spent).toBe(570); // 订单留痕
    expect(row.points_deduct_cents).toBe(570); // 调用 expect 并处理其返回结果
    expect(row.payable_cents).toBe(1330); // 调用 expect 并处理其返回结果

    const list = await request(app).get('/api/v1/shop/orders').set({ authorization: `Bearer ${session.token}` }); // 常量 list：保存固定配置或一次性派生值
    const item = list.body.items.find((o: { product_code: string }) => o.product_code === 'pixi-pack'); // 常量 item：保存固定配置或一次性派生值
    expect(item.points_spent).toBe(570); // 订单读取回显积分留痕
    expect(item.points_deduct_cents).toBe(570); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('积分余额不足时按余额可折金额截断，不报错', async () => { // 调用 it 并处理其返回结果
    const session = await login('13820000002'); // 常量 session：保存固定配置或一次性派生值
    setWallet(session.userId, 20000, 100); // 100 积分 = 100 分
    const order = await request(app).post('/api/v1/shop/orders').set(writeHeaders(session.token)).send({ product_code: PRODUCT, use_points: true }); // 常量 order：保存固定配置或一次性派生值
    expect(order.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(order.body.points_spent).toBe(100); // 调用 expect 并处理其返回结果
    expect(order.body.points_deduct_cents).toBe(100); // 调用 expect 并处理其返回结果
    expect(order.body.payable_cents).toBe(1800); // 调用 expect 并处理其返回结果
    expect(wallet(session.userId).points).toBe(0); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('指定积分超过余额：400 INSUFFICIENT_POINTS，不生成订单、不扣积分', async () => { // 调用 it 并处理其返回结果
    const session = await login('13820000003'); // 常量 session：保存固定配置或一次性派生值
    setWallet(session.userId, 20000, 50); // 调用 setWallet 并处理其返回结果
    const order = await request(app).post('/api/v1/shop/orders').set(writeHeaders(session.token)).send({ product_code: PRODUCT, points_to_use: 100 }); // 常量 order：保存固定配置或一次性派生值
    expect(order.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(order.body.details.reason).toBe('INSUFFICIENT_POINTS'); // 调用 expect 并处理其返回结果
    expect(wallet(session.userId).points).toBe(50); // 未扣积分
    const count = (db.prepare('SELECT COUNT(*) AS n FROM shop_orders WHERE user_id = ?').get(session.userId) as { n: number }).n; // 常量 count：保存固定配置或一次性派生值
    expect(count).toBe(0); // 未生成订单
  }); // 代码块结束

  it('指定积分超过单笔上限：400 POINTS_CAP_EXCEEDED，不生成订单', async () => { // 调用 it 并处理其返回结果
    const session = await login('13820000004'); // 常量 session：保存固定配置或一次性派生值
    setWallet(session.userId, 20000, 5000); // 调用 setWallet 并处理其返回结果
    // 600 积分折 600 分 > 1900 × 30% = 570 分上限
    const order = await request(app).post('/api/v1/shop/orders').set(writeHeaders(session.token)).send({ product_code: PRODUCT, points_to_use: 600 });
    expect(order.status).toBe(400); // 调用 expect 并处理其返回结果
    expect(order.body.details.reason).toBe('POINTS_CAP_EXCEEDED'); // 调用 expect 并处理其返回结果
    expect(wallet(session.userId).points).toBe(5000); // 调用 expect 并处理其返回结果
    const count = (db.prepare('SELECT COUNT(*) AS n FROM shop_orders WHERE user_id = ?').get(session.userId) as { n: number }).n; // 常量 count：保存固定配置或一次性派生值
    expect(count).toBe(0); // 调用 expect 并处理其返回结果
  }); // 代码块结束

  it('开关 MIM_POINTS_DEDUCTION_ENABLED=0：整段跳过，积分不动、应付不变', async () => { // 调用 it 并处理其返回结果
    const offDb = createDatabase(':memory:'); // 常量 offDb：保存固定配置或一次性派生值
    const offApp = createApp({ db: offDb, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_POINTS_DEDUCTION_ENABLED: '0' } }); // 常量 offApp：保存固定配置或一次性派生值
    const loginRes = await request(offApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13820000005', password: ADMIN_PASSWORD }); // 常量 loginRes：保存固定配置或一次性派生值
    const token = loginRes.body.access_token as string; // 常量 token：保存固定配置或一次性派生值
    const userId = loginRes.body.user.id as string; // 常量 userId：保存固定配置或一次性派生值
    offDb.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 20000, 5000, ?)').run(userId, new Date().toISOString()); // 执行当前业务步骤

    const order = await request(offApp).post('/api/v1/shop/orders').set({ authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }).send({ product_code: PRODUCT, use_points: true }); // 常量 order：保存固定配置或一次性派生值
    expect(order.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(order.body.points_spent).toBe(0); // 调用 expect 并处理其返回结果
    expect(order.body.points_deduct_cents).toBe(0); // 调用 expect 并处理其返回结果
    expect(order.body.payable_cents).toBe(1900); // 调用 expect 并处理其返回结果
    const points = (offDb.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number }).points; // 常量 points：保存固定配置或一次性派生值
    expect(points).toBe(5000); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束

describe('shop 积分抵扣 · 全额抵扣即时完成', () => { // 调用 describe 并处理其返回结果
  it('上限放开且积分充足：应付 0，订单即时结算并发卡密，不生成待支付死单', async () => { // 调用 it 并处理其返回结果
    const fullDb = createDatabase(':memory:'); // 常量 fullDb：保存固定配置或一次性派生值
    const fullApp = createApp({ db: fullDb, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_POINTS_MAX_RATIO_PERCENT: '100' } }); // 常量 fullApp：保存固定配置或一次性派生值
    const loginRes = await request(fullApp).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13820000006', password: ADMIN_PASSWORD }); // 常量 loginRes：保存固定配置或一次性派生值
    const token = loginRes.body.access_token as string; // 常量 token：保存固定配置或一次性派生值
    const userId = loginRes.body.user.id as string; // 常量 userId：保存固定配置或一次性派生值
    fullDb.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 19000, ?)').run(userId, new Date().toISOString()); // 执行当前业务步骤

    const order = await request(fullApp).post('/api/v1/shop/orders').set({ authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }).send({ product_code: PRODUCT, use_points: true }); // 常量 order：保存固定配置或一次性派生值
    expect(order.status).toBe(201); // 调用 expect 并处理其返回结果
    expect(order.body.payable_cents).toBe(0); // 调用 expect 并处理其返回结果
    expect(order.body.points_spent).toBe(1900); // 调用 expect 并处理其返回结果
    expect(order.body.points_deduct_cents).toBe(1900); // 调用 expect 并处理其返回结果

    const row = fullDb.prepare('SELECT status, payable_cents, points_spent, points_deduct_cents, paid_at, delivered_content FROM shop_orders WHERE user_id = ?').get(userId) as { status: string; payable_cents: number; points_spent: number; points_deduct_cents: number; paid_at: string | null; delivered_content: string | null }; // 常量 row：保存固定配置或一次性派生值
    expect(row.payable_cents).toBe(0); // 调用 expect 并处理其返回结果
    expect(row.points_spent).toBe(1900); // 调用 expect 并处理其返回结果
    expect(row.points_deduct_cents).toBe(1900); // 调用 expect 并处理其返回结果
    expect(row.status).toBe('delivered'); // 自动发卡即时完成，无 pending 死单
    expect(row.paid_at).toBeTruthy(); // 调用 expect 并处理其返回结果
    expect(row.delivered_content).toMatch(/^PIXI-MIM-\d{2}-2026$/); // 调用 expect 并处理其返回结果

    const walletRow = fullDb.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as { balance_cents: number; points: number }; // 常量 walletRow：保存固定配置或一次性派生值
    expect(walletRow.balance_cents).toBe(0); // 未扣余额
    expect(walletRow.points).toBe(17100); // 19000 - 1900

    const list = await request(fullApp).get('/api/v1/shop/orders').set({ authorization: `Bearer ${token}` }); // 常量 list：保存固定配置或一次性派生值
    expect(list.body.items[0].points_spent).toBe(1900); // 调用 expect 并处理其返回结果
    expect(list.body.items[0].points_deduct_cents).toBe(1900); // 调用 expect 并处理其返回结果
  }); // 代码块结束
}); // 代码块结束
