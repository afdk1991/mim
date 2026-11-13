/** 契约测试：商城购物车（加购 / 去重 / 移除 / 清空 / 免费即时解锁 / 付费生成待结算订单 / 依赖跳过 / 重复结算不重复下单）。 */

import { randomUUID } from 'node:crypto'; // 生成幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例
import request from 'supertest'; // 真实 HTTP
import type { Express } from 'express'; // 类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const ADMIN_PASSWORD = 'testpass123'; // 测试口令

let app: Express; // 每个用例重建

beforeEach(() => { // 调用 beforeEach 并处理其返回结果
  app = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD } }); // 全新内存库
}); // 代码块结束

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

describe('商城购物车', () => { // 调用 describe 并处理其返回结果
  // 匿名不可访问
  it('匿名访问 /cart 返回 401', async () => {
    const res = await request(app).get('/api/v1/cart'); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(401); // 断言：校验接口响应或状态符合冻结契约
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言：校验接口响应或状态符合冻结契约
  }); // 代码块结束

  // 免费模块加购 + 幂等
  it('免费模块可加购，重复加购回放不重复', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    const first = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 准备：构造本用例需要的输入或句柄
    expect(first.status).toBe(201); // 断言：校验接口响应或状态符合冻结契约
    expect(first.body.added).toBe(true); // 断言：校验接口响应或状态符合冻结契约
    expect(first.body.cart.count).toBe(1); // 断言：校验接口响应或状态符合冻结契约
    const again = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 准备：构造本用例需要的输入或句柄
    expect(again.status).toBe(200); // 回放语义
    expect(again.body.added).toBe(false); // 断言：校验接口响应或状态符合冻结契约
    expect(again.body.cart.count).toBe(1); // 不重复
  }); // 代码块结束

  // 不存在 / 已拥有
  it('不存在模块 404、已解锁模块加购 409', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    const missing = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'does.not.exist' }); // 准备：构造本用例需要的输入或句柄
    expect(missing.status).toBe(404); // 断言：校验接口响应或状态符合冻结契约
    const unlock = await request(app).post('/api/v1/entitlements').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 先解锁
    expect(unlock.status).toBe(201); // 断言：校验接口响应或状态符合冻结契约
    const owned = await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 准备：构造本用例需要的输入或句柄
    expect(owned.status).toBe(409); // 已拥有无需加购
    expect(owned.body.code).toBe('CONFLICT'); // 断言：校验接口响应或状态符合冻结契约
  }); // 代码块结束

  // 价格与合计
  it('购物车返回单价、免费标记与按币种合计', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 免费
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' }); // 付费 ¥99
    const res = await request(app).get('/api/v1/cart').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(res.body.count).toBe(2); // 断言：校验接口响应或状态符合冻结契约
    const free = res.body.items.find((item: { module_code: string }) => item.module_code === 'comic.workbench'); // 准备：构造本用例需要的输入或句柄
    const paid = res.body.items.find((item: { module_code: string }) => item.module_code === 'comic.genpack.basic'); // 准备：构造本用例需要的输入或句柄
    expect(free.free).toBe(true); // 免费
    expect(free.price).toBeNull(); // 无价格行
    expect(paid.price.currency).toBe('CNY'); // 付费币种
    expect(paid.price.amount_minor).toBeGreaterThan(0); // 金额非零
    expect(res.body.totals).toEqual([{ currency: 'CNY', amount_minor: paid.price.amount_minor }]); // 合计只算付费
    expect(res.body.payable_count).toBe(1); // 只有付费项可支付
  }); // 代码块结束

  // 移除单个 / 清空
  it('移除单个与清空购物车', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 执行：等待异步操作返回后继续
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'ai.dubbing' }); // 执行：等待异步操作返回后继续
    const removed = await request(app).delete('/api/v1/cart/items/comic.workbench').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(removed.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(removed.body.cart.count).toBe(1); // 剩一条
    const cleared = await request(app).delete('/api/v1/cart').set(writeHeaders(auth)); // 准备：构造本用例需要的输入或句柄
    expect(cleared.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(cleared.body.cart.count).toBe(0); // 清空
  }); // 代码块结束

  // 免费结算即时解锁
  it('结算免费模块即时发放权益并清空购物车', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' }); // 执行：等待异步操作返回后继续
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    expect(checkout.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(checkout.body.results[0].kind).toBe('unlocked'); // 即时解锁
    expect(checkout.body.cart.count).toBe(0); // 已移出车
    const mine = await request(app).get('/api/v1/me/entitlements').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(mine.body.entitlements.some((item: { module_code: string }) => item.module_code === 'comic.workbench')).toBe(true); // 权益已到账
  }); // 代码块结束

  // 付费结算生成待结算订单
  it('结算付费模块生成 pending 订单（金额取当前价）', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' }); // 执行：等待异步操作返回后继续
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({ channel: 'manual' }); // 准备：构造本用例需要的输入或句柄
    expect(checkout.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    const result = checkout.body.results[0]; // 准备：构造本用例需要的输入或句柄
    expect(result.kind).toBe('order'); // 生成订单
    expect(result.order.status).toBe('pending'); // 待结算
    expect(result.order.amount_minor).toBeGreaterThan(0); // 金额来自服务端快照
    expect(checkout.body.cart.count).toBe(0); // 已移出车
    const orders = await request(app).get('/api/v1/orders').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(orders.body.orders.some((item: { module_code: string; status: string }) => item.module_code === 'comic.genpack.basic' && item.status === 'pending')).toBe(true); // 订单可见
  }); // 代码块结束

  // 依赖缺失跳过且保留在车
  it('依赖未满足的模块跳过并保留在购物车', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.pro' }); // 前置 basic
    const checkout = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    expect(checkout.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(checkout.body.results[0].kind).toBe('skipped'); // 断言：校验接口响应或状态符合冻结契约
    expect(String(checkout.body.results[0].reason)).toContain('missing_dependency'); // 原因带缺失清单
    expect(checkout.body.cart.count).toBe(1); // 未被清掉
  }); // 代码块结束

  // 重复结算不产生第二张待结算单
  it('同一付费模块重复结算只保留一张 pending 订单', async () => {
    const auth = await login(); // 准备：构造本用例需要的输入或句柄
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' }); // 执行：等待异步操作返回后继续
    const first = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    const firstOrderId = first.body.results[0].order.id; // 第一张单
    await request(app).post('/api/v1/cart/items').set(writeHeaders(auth)).send({ module_code: 'comic.genpack.basic' }); // 再加回车里
    const second = await request(app).post('/api/v1/cart/checkout').set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    expect(second.body.results[0].order.id).toBe(firstOrderId); // 回放同一张单
    const orders = await request(app).get('/api/v1/orders').set(auth); // 准备：构造本用例需要的输入或句柄
    const pending = orders.body.orders.filter((item: { module_code: string; status: string }) => item.module_code === 'comic.genpack.basic' && item.status === 'pending'); // 准备：构造本用例需要的输入或句柄
    expect(pending).toHaveLength(1); // 不产生重复订单
  }); // 代码块结束
}); // 代码块结束
