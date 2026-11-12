/** 契约测试：商业化三期 · 批量改价（固定价 / 百分比 / 金额增减 + 快照回滚 + 幂等 + 0 价保护） */

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
}

/** 读 cn 区模块当前生效价格（分）；无价返回 null */
function modulePrice(code: string): number | null {
  const row = db // 构造：准备本用例需要的输入、句柄或期望值
    .prepare(
      `SELECT p.amount_minor FROM module_prices p
         JOIN modules m ON m.id = p.module_id
        WHERE m.code = ? AND m.region = 'cn' AND p.effective_to IS NULL
        ORDER BY p.effective_from DESC LIMIT 1`,
    )
    .get(code) as { amount_minor: number } | undefined;
  return row?.amount_minor ?? null; // 返回：交回本步骤结果供断言使用
}

/** 读独立商城商品价格（分） */
function shopPrice(code: string): number {
  const row = db.prepare('SELECT price_cents FROM shop_products WHERE code = ?').get(code) as { price_cents: number } | undefined; // 构造：准备本用例需要的输入、句柄或期望值
  return row?.price_cents ?? -1; // 返回：交回本步骤结果供断言使用
}

beforeEach(() => { // 每例重建内存库与应用
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } });
});

describe('批量改价 · 三种模式', () => {
  it('固定价：把指定模块改成新价，未命中目标不动', async () => {
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'module', mode: 'fixed', direction: 'set', value: 8800, filter: { region: 'cn', codes: ['comic.genpack.basic'] }, idempotency_key: 'fixed-1' });
    expect(res.status).toBe(201); // 批次创建成功
    expect(res.body.batch.changed).toBe(1); // 仅基础版一条被改
    expect(modulePrice('comic.genpack.basic')).toBe(8800); // 新价生效
    expect(modulePrice('comic.genpack.pro')).toBe(29900); // 专业版不受影响
  });

  it('百分比上调 10%：按原价四舍五入到分', async () => {
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'module', mode: 'percent', direction: 'increase', value: 10, filter: { codes: ['comic.genpack.basic'] }, idempotency_key: 'pct-up-1' });
    expect(res.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(modulePrice('comic.genpack.basic')).toBe(Math.round(9900 * 1.1)); // 9900 × 1.1 = 10890
  });

  it('固定金额下调 500 分：原价减去金额，不为负', async () => {
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'module', mode: 'amount', direction: 'decrease', value: 500, filter: { codes: ['media.storage'] }, idempotency_key: 'amt-down-1' });
    expect(res.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(modulePrice('media.storage')).toBe(4400); // 4900 - 500
  });

  it('0 价免费模块跳过不改：分类批次里免费品记 skipped，付费品正常改动', async () => {
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'module', mode: 'amount', direction: 'increase', value: 100, filter: { category_slug: 'ai-01' }, idempotency_key: 'cat-1' });
    expect(res.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const freeWorkbench = res.body.batch.items.find((item: { target_code: string }) => item.target_code === 'comic.workbench'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(freeWorkbench.skipped).toBe(true); // 免费模块被跳过
    expect(freeWorkbench.reason).toBe('free_zero_price'); // 原因可追溯
    expect(modulePrice('comic.genpack.basic')).toBe(10000); // 付费品 9900 + 100
  });

  it('独立商城商品同样支持批量改价', async () => {
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'shop_product', mode: 'fixed', direction: 'set', value: 1500, filter: { codes: ['pixi-pack'] }, idempotency_key: 'shop-1' });
    expect(res.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(shopPrice('pixi-pack')).toBe(1500); // 商品价格已改
    expect(shopPrice('mim-keycap')).toBe(6900); // 其余商品不动
  });
});

describe('批量改价 · 幂等与回滚', () => {
  it('同一幂等键重复提交回放同一批，不二次改价', async () => {
    const body = { target_type: 'module', mode: 'percent', direction: 'increase', value: 10, filter: { codes: ['comic.genpack.basic'] }, idempotency_key: 'idem-1' }; // 构造：准备本用例需要的输入、句柄或期望值
    const first = await request(app).post('/api/v1/admin/commerce/price-batches').set(adminHeaders()).send(body); // 构造：准备本用例需要的输入、句柄或期望值
    const second = await request(app).post('/api/v1/admin/commerce/price-batches').set(adminHeaders()).send(body); // 构造：准备本用例需要的输入、句柄或期望值
    expect(first.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(second.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(second.body.batch.id).toBe(first.body.batch.id); // 回放同一批次
    expect(modulePrice('comic.genpack.basic')).toBe(10890); // 只上浮一次
  });

  it('回滚按快照恢复到改前价格；重复回滚 409', async () => {
    const batch = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'module', mode: 'fixed', direction: 'set', value: 7777, filter: { codes: ['comic.genpack.basic'] }, idempotency_key: 'rb-1' });
    const batchId = batch.body.batch.id; // 构造：准备本用例需要的输入、句柄或期望值
    expect(modulePrice('comic.genpack.basic')).toBe(7777); // 断言：校验响应字段与冻结契约一致
    const rolled = await request(app).post(`/api/v1/admin/commerce/price-batches/${batchId}/rollback`).set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(rolled.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(modulePrice('comic.genpack.basic')).toBe(9900); // 快照恢复到改前
    const again = await request(app).post(`/api/v1/admin/commerce/price-batches/${batchId}/rollback`).set(adminHeaders()); // 构造：准备本用例需要的输入、句柄或期望值
    expect(again.status).toBe(409); // 重复回滚冲突
  });

  it('商城商品批次同样可回滚', async () => {
    const batch = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'shop_product', mode: 'amount', direction: 'decrease', value: 400, filter: { codes: ['pixi-pack'] }, idempotency_key: 'shop-rb-1' });
    const batchId = batch.body.batch.id; // 构造：准备本用例需要的输入、句柄或期望值
    expect(shopPrice('pixi-pack')).toBe(1500); // 1900 - 400
    await request(app).post(`/api/v1/admin/commerce/price-batches/${batchId}/rollback`).set(adminHeaders()); // 执行：等待接口或数据库操作返回
    expect(shopPrice('pixi-pack')).toBe(1900); // 恢复
  });
});

describe('批量改价 · 入参校验', () => {
  it('百分比超出 1–100 被拒 400', async () => {
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'module', mode: 'percent', direction: 'increase', value: 150, filter: {}, idempotency_key: 'bad-1' });
    expect(res.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言：校验响应字段与冻结契约一致
  });

  it('固定价模式带增减方向被拒 400', async () => {
    const res = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/admin/commerce/price-batches')
      .set(adminHeaders())
      .send({ target_type: 'module', mode: 'fixed', direction: 'increase', value: 100, filter: {}, idempotency_key: 'bad-2' });
    expect(res.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言：校验响应字段与冻结契约一致
  });
});
