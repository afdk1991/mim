/** 契约测试：商城购物车（加购 / 去重 / 移除 / 清空 / 免费即时解锁 / 付费生成待结算订单 / 依赖跳过 / 重复结算不重复下单）。 */

import { randomUUID } from 'node:crypto'; // 生成幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // vitest
import request from 'supertest'; // 真实 HTTP
import type { Express } from 'express'; // 类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const ADMIN_PASSWORD = 'testpass123'; // 测试口令

let app: Express; // 每个用例重建

beforeEach(() => {
  app = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD } }); // 全新内存库
});

/** 登录并返回鉴权头 */
async function login(identifier = '13800000001'): Promise<Record<string, string>> {
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD }); // 口令登录
  expect(res.status).toBe(200); // 必须成功
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' }; // 鉴权头
} // login 结束

/** 写操作鉴权头：幂等中间件强制要求 Idempotency-Key */
function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() }; // 每次调用独立键，避免回放干扰用例断言
} // writeHeaders 结束

describe('商城购物车', () => {
  // 匿名不可访问
  it('匿名访问 /cart 返回 401', async () => {
    const res = await request(app).get('/api/v1/cart');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
  });

  // 免费模块加购 + 幂等
  it('免费模块可加购，重复加购回放不重复', async () => {
    const auth = await login();
    const first = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' });
    expect(first.status).toBe(201);
    expect(first.body.added).toBe(true);
    expect(first.body.cart.count).toBe(1);
    const again = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' });
    expect(again.status).toBe(200); // 回放语义
    expect(again.body.added).toBe(false);
    expect(again.body.cart.count).toBe(1); // 不重复
  });

  // 不存在 / 已拥有
  it('不存在模块 404、已解锁模块加购 409', async () => {
    const auth = await login();
    const missing = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'does.not.exist' });
    expect(missing.status).toBe(404);
    const unlock = await request(app).post('/api/v1/entitlements').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 先解锁
    expect(unlock.status).toBe(201);
    const owned = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' });
    expect(owned.status).toBe(409); // 已拥有无需加购
    expect(owned.body.code).toBe('CONFLICT');
  });

  // 价格与合计
  it('购物车返回单价、免费标记与按币种合计', async () => {
    const auth = await login();
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 免费
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' }); // 付费 ¥99
    const res = await request(app).get('/api/v1/cart').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const free = res.body.items.find((item: { module_code: string }) => item.module_code === 'comic.workbench');
    const paid = res.body.items.find((item: { module_code: string }) => item.module_code === 'comic.genpack.basic');
    expect(free.free).toBe(true); // 免费
    expect(free.price).toBeNull(); // 无价格行
    expect(paid.price.currency).toBe('CNY'); // 付费币种
    expect(paid.price.amount_minor).toBeGreaterThan(0); // 金额非零
    expect(res.body.totals).toEqual([{ currency: 'CNY', amount_minor: paid.price.amount_minor }]); // 合计只算付费
    expect(res.body.payable_count).toBe(1); // 只有付费项可支付
  });

  // 移除单个 / 清空
  it('移除单个与清空购物车', async () => {
    const auth = await login();
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' });
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'ai.dubbing' });
    const removed = await request(app).delete('/api/v1/cart/items/comic.workbench').set(auth);
    expect(removed.status).toBe(200);
    expect(removed.body.cart.count).toBe(1); // 剩一条
    const cleared = await request(app).delete('/api/v1/cart').set(writeHeaders(auth));
    expect(cleared.status).toBe(200);
    expect(cleared.body.cart.count).toBe(0); // 清空
  });

  // 免费结算即时解锁
  it('结算免费模块即时发放权益并清空购物车', async () => {
    const auth = await login();
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' });
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({});
    expect(checkout.status).toBe(200);
    expect(checkout.body.results[0].kind).toBe('unlocked'); // 即时解锁
    expect(checkout.body.cart.count).toBe(0); // 已移出车
    const mine = await request(app).get('/api/v1/me/entitlements').set(auth);
    expect(mine.body.entitlements.some((item: { module_code: string }) => item.module_code === 'comic.workbench')).toBe(true); // 权益已到账
  });

  // 付费结算生成待结算订单
  it('结算付费模块生成 pending 订单（金额取当前价）', async () => {
    const auth = await login();
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' });
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({ channel: 'manual' });
    expect(checkout.status).toBe(200);
    const result = checkout.body.results[0];
    expect(result.kind).toBe('order'); // 生成订单
    expect(result.order.status).toBe('pending'); // 待结算
    expect(result.order.amount_minor).toBeGreaterThan(0); // 金额来自服务端快照
    expect(checkout.body.cart.count).toBe(0); // 已移出车
    const orders = await request(app).get('/api/v1/orders').set(auth);
    expect(orders.body.orders.some((item: { module_code: string; status: string }) => item.module_code === 'comic.genpack.basic' && item.status === 'pending')).toBe(true); // 订单可见
  });

  // 依赖缺失跳过且保留在车
  it('依赖未满足的模块跳过并保留在购物车', async () => {
    const auth = await login();
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.pro' }); // 前置 basic
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({});
    expect(checkout.status).toBe(200);
    expect(checkout.body.results[0].kind).toBe('skipped');
    expect(String(checkout.body.results[0].reason)).toContain('missing_dependency'); // 原因带缺失清单
    expect(checkout.body.cart.count).toBe(1); // 未被清掉
  });

  // 重复结算不产生第二张待结算单
  it('同一付费模块重复结算只保留一张 pending 订单', async () => {
    const auth = await login();
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' });
    const first = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({});
    const firstOrderId = first.body.results[0].order.id; // 第一张单
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' }); // 再加回车里
    const second = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({});
    expect(second.body.results[0].order.id).toBe(firstOrderId); // 回放同一张单
    const orders = await request(app).get('/api/v1/orders').set(auth);
    const pending = orders.body.orders.filter((item: { module_code: string; status: string }) => item.module_code === 'comic.genpack.basic' && item.status === 'pending');
    expect(pending).toHaveLength(1); // 不产生重复订单
  });
});
