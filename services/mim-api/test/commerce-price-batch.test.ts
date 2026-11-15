/** 契约测试：批量改价（独立商城商品 · 固定价 / 百分比 / 金额增减 + 快照回滚 + 幂等 + 0 价保护） */

import { beforeEach, describe, expect, it } from 'vitest'; // 测试编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 运营引导令牌

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 内存库句柄

function adminHeaders(): Record<string, string> { // 运营引导通道请求头
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' }; // 返回：交回本步骤结果供断言使用
} // 代码块结束

/** 读独立商城商品价格（分）；不存在返回 -1 */
function shopPrice(code: string): number {
  const row = db.prepare('SELECT price_cents FROM shop_products WHERE code = ?').get(code) as { price_cents: number } | undefined; // 构造：准备本用例需要的输入、句柄或期望值
  return row?.price_cents ?? -1; // 返回：交回本步骤结果供断言使用
} // 代码块结束

/** 插入一个 0 价商品，验证批量改价跳过免费目标 */
function insertFreeProduct(): void {
  db.prepare(
    `INSERT INTO shop_products (id, code, name, summary, kind, price_cents, cover_url, stock, delivery_note, status, sort_order, created_at)
     VALUES ('prod-free', 'free-item', '免费样品', '0 价商品不参与调价。', 'virtual_auto', 0, '', 0, '', 'active', 99, ?)`,
  ).run(new Date().toISOString()); // 执行当前业务步骤
} // 代码块结束

beforeEach(() => { // 每例重建内存库与应用
  db = createDatabase(':memory:'); // 赋值：更新变量 db 的取值
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 赋值：更新变量 app 的取值
}); // 代码块结束

describe('批量改价 · 三种模式', () => { // 调用 describe 并处理其返回结果
  it('固定价：把指定商品改成新价，未命中目标不动', async () => { // 调用 it 并处理其返回结果
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'shop_product', mode: 'fixed', direction: 'set', value: 1500, filter: { codes: ['pixi-pack'] }, idempotency_key: 'fixed-1' }); // 执行当前业务步骤
    expect(res.status).toBe(201); // 批次创建成功
    expect(res.body.batch.changed).toBe(1); // 仅命中一条
    expect(shopPrice('pixi-pack')).toBe(1500); // 新价生效
    expect(shopPrice('mim-keycap')).toBe(6900); // 其余商品不受影响
  }); // 代码块结束

  it('百分比上调 10%：按原价四舍五入到分', async () => { // 调用 it 并处理其返回结果
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'shop_product', mode: 'percent', direction: 'increase', value: 10, filter: { codes: ['pixi-pack'] }, idempotency_key: 'pct-up-1' }); // 执行当前业务步骤
    expect(res.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(shopPrice('pixi-pack')).toBe(Math.round(1900 * 1.1)); // 1900 × 1.1 = 2090
  }); // 代码块结束

  it('固定金额下调 400 分：原价减去金额，不为负', async () => { // 调用 it 并处理其返回结果
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'shop_product', mode: 'amount', direction: 'decrease', value: 400, filter: { codes: ['pixi-pack'] }, idempotency_key: 'amt-down-1' }); // 执行当前业务步骤
    expect(res.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(shopPrice('pixi-pack')).toBe(1500); // 1900 - 400
  }); // 代码块结束

  it('0 价免费商品跳过不改：批次里免费品记 skipped，付费品正常改动', async () => { // 调用 it 并处理其返回结果
    insertFreeProduct(); // 造一个 0 价商品
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'shop_product', mode: 'amount', direction: 'increase', value: 100, filter: { codes: ['free-item', 'pixi-pack'] }, idempotency_key: 'free-1' }); // 执行当前业务步骤
    expect(res.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const freeItem = res.body.batch.items.find((item: { target_code: string }) => item.target_code === 'free-item'); // 取出免费品明细
    expect(freeItem.skipped).toBe(true); // 免费商品被跳过
    expect(freeItem.reason).toBe('free_zero_price'); // 原因可追溯
    expect(shopPrice('pixi-pack')).toBe(2000); // 付费品 1900 + 100
  }); // 代码块结束
}); // 代码块结束

describe('批量改价 · 幂等与回滚', () => { // 调用 describe 并处理其返回结果
  it('同一幂等键重复提交回放同一批，不二次改价', async () => { // 调用 it 并处理其返回结果
    const body = { target_type: 'shop_product', mode: 'percent', direction: 'increase', value: 10, filter: { codes: ['pixi-pack'] }, idempotency_key: 'idem-1' }; // 构造：准备本用例需要的输入、句柄或期望值
    const first = await request(app).post('/api/v1/admin/commerce/price-batches').set(adminHeaders()).send(body); // 构造：准备本用例需要的输入、句柄或期望值
    const second = await request(app).post('/api/v1/admin/commerce/price-batches').set(adminHeaders()).send(body); // 构造：准备本用例需要的输入、句柄或期望值
    expect(first.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(second.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(second.body.batch.id).toBe(first.body.batch.id); // 回放同一批次
    expect(shopPrice('pixi-pack')).toBe(2090); // 只上浮一次
  }); // 代码块结束

  it('回滚按快照恢复到改前价格；重复回滚 409', async () => { // 调用 it 并处理其返回结果
    const batch = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'shop_product', mode: 'fixed', direction: 'set', value: 7777, filter: { codes: ['pixi-pack'] }, idempotency_key: 'rb-1' }); // 执行当前业务步骤
    const batchId = batch.body.batch.id; // 构造：准备本用例需要的输入、句柄或期望值
    expect(shopPrice('pixi-pack')).toBe(7777); // 断言：校验响应字段与冻结契约一致
    const rolled = await request(app).post(`/api/v1/admin/commerce/price-batches/${batchId}/rollback`).set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(rolled.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(shopPrice('pixi-pack')).toBe(1900); // 快照恢复到改前
    const again = await request(app).post(`/api/v1/admin/commerce/price-batches/${batchId}/rollback`).set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(again.status).toBe(409); // 重复回滚冲突
  }); // 代码块结束
}); // 代码块结束

describe('批量改价 · 入参校验', () => { // 调用 describe 并处理其返回结果
  it('百分比超出 1–100 被拒 400', async () => { // 调用 it 并处理其返回结果
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'shop_product', mode: 'percent', direction: 'increase', value: 150, filter: {}, idempotency_key: 'bad-1' }); // 执行当前业务步骤
    expect(res.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('固定价模式带增减方向被拒 400', async () => { // 调用 it 并处理其返回结果
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'shop_product', mode: 'fixed', direction: 'increase', value: 100, filter: {}, idempotency_key: 'bad-2' }); // 执行当前业务步骤
    expect(res.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('已下线的 module 目标被拒 400', async () => { // 调用 it 并处理其返回结果
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches') // 注册 POST 路由 / 中间件处理器
      .set(adminHeaders()) // 执行当前业务步骤
      .send({ target_type: 'module', mode: 'fixed', direction: 'set', value: 100, filter: {}, idempotency_key: 'bad-3' }); // 执行当前业务步骤
    expect(res.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束
}); // 代码块结束
