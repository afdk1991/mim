/** 契约测试：统一交易域 —— 三套历史订单回填、统一只读接口、跨用户隔离、回填幂等 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排：每例重建内存库
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂（内部已执行统一交易域回填）
import { backfillUnifiedCommerce } from '../src/commerce/unified.js'; // 回填函数，用于幂等断言

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 管理引导令牌，与其他用例口径一致

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库

beforeEach(() => { // 每例重建，避免用例间订单互相污染
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 装配应用
});

/** 领取访客令牌：统一订单接口要求登录态，访客会话同样持有自己的订单 */
async function guest() {
  const res = await request(app).post('/api/v1/auth/guest').send({}); // 公开端点
  expect(res.status).toBe(200); // 免登录体验下必成功
  return { token: res.body.access_token as string, userId: res.body.user.id as string }; // 返回令牌与用户 id
}

describe('统一交易域：回填与只读视图', () => {
  it('三套历史订单回填后，GET /orders 一次返回三条来源不同的订单', async () => {
    const { token, userId } = await guest(); // 建一个访客会话
    const moduleRow = db.prepare('SELECT id, region FROM modules LIMIT 1').get() as { id: string; region: string }; // 取一个种子模块（模块表不带币种列，结算币种由下单快照决定）
    db.prepare(
      `INSERT INTO module_orders (id, user_id, module_id, region, currency, amount_minor, status, channel, created_at, updated_at, paid_at)
       VALUES ('mo-test-1', ?, ?, ?, 'CNY', 1200, 'paid', 'alipay', '2026-11-01T00:00:00.000Z', '2026-11-01T00:01:00.000Z', '2026-11-01T00:01:00.000Z')`,
    ).run(userId, moduleRow.id, moduleRow.region); // 模块线：已支付
    const shopRow = db.prepare('SELECT id, price_cents FROM shop_products LIMIT 1').get() as { id: string; price_cents: number }; // 取一个种子商品
    db.prepare(
      `INSERT INTO shop_orders (id, user_id, product_id, quantity, amount_cents, discount_cents, payable_cents, status, created_at, paid_at)
       VALUES ('so-test-1', ?, ?, 1, ?, 0, ?, 'delivered', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:30.000Z')`,
    ).run(userId, shopRow.id, shopRow.price_cents, shopRow.price_cents); // 实物线：已发货
    const assetRow = db.prepare('SELECT id, price_cents FROM paid_assets LIMIT 1').get() as { id: string; price_cents: number }; // 取一个付费资产
    db.prepare(
      `INSERT INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at)
       VALUES ('ap-test-1', ?, ?, ?, '2026-11-03T00:00:00.000Z')`,
    ).run(userId, assetRow.id, Math.max(assetRow.price_cents, 100)); // 资产线：无状态列
    const first = backfillUnifiedCommerce(db); // 手动回填（启动期已跑过一次，但那时这三条还不存在）
    expect(first.orders).toBe(3); // 三条各自写一笔订单
    expect(first.items).toBe(3); // 三条各写一条明细
    const res = await request(app).get('/api/v1/commerce/orders').set('Authorization', `Bearer ${token}`); // 统一订单列表（分配置目标 /orders 已被商城占用）
    expect(res.status).toBe(200); // 登录后可读
    expect(res.body.items).toHaveLength(3); // 三条都在
    expect(res.body.items.map((item: { source: string }) => item.source).sort()).toEqual(['asset', 'module', 'shop']); // 来源产线完整
    const delivered = res.body.items.find((item: { source: string }) => item.source === 'shop'); // 实物线那条
    expect(delivered.status).toBe('delivered'); // 状态原样保留，不被归一成 paid
    expect(delivered.items[0].title.length).toBeGreaterThan(0); // 商品名快照非空
    expect(res.body.items.every((item: { id: string }) => item.id.startsWith('uo_'))).toBe(true); // 主键可追溯到来源
  });

  it('回填幂等：重复执行不新增行，也不改动既有订单', async () => {
    const { userId } = await guest(); // 用户
    db.prepare(
      `INSERT INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at)
       SELECT 'ap-idem-1', ?, id, 100, '2026-11-04T00:00:00.000Z' FROM paid_assets LIMIT 1`,
    ).run(userId); // 一笔资产订单
    const first = backfillUnifiedCommerce(db); // 第一次回填
    expect(first.orders).toBe(1); // 写入一笔
    const second = backfillUnifiedCommerce(db); // 第二次回填
    expect(second).toEqual({ products: 0, orders: 0, items: 0 }); // 唯一键与固定主键共同保证零新增
    const count = db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }; // 直接数订单行
    expect(count.n).toBe(1); // 仍然只有一笔
  });

  it('汇总口径与跨用户隔离：他人订单按 404 处理，不泄露存在性', async () => {
    const owner = await guest(); // 订单所有者
    const stranger = await guest(); // 另一个访客
    db.prepare(
      `INSERT INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at)
       SELECT 'ap-own-1', ?, id, 300, '2026-11-05T00:00:00.000Z' FROM paid_assets LIMIT 1`,
    ).run(owner.userId); // 给 owner 一笔
    backfillUnifiedCommerce(db); // 回填
    const summary = await request(app).get('/api/v1/commerce/orders/summary').set('Authorization', `Bearer ${owner.token}`); // owner 汇总
    expect(summary.status).toBe(200); // 可读
    expect(summary.body.summary.total).toBe(1); // 只有一笔
    expect(summary.body.summary.payable_cents).toBe(300); // 实付合计
    const detail = await request(app).get('/api/v1/commerce/orders/uo_asset_ap-own-1').set('Authorization', `Bearer ${owner.token}`); // owner 查详情
    expect(detail.status).toBe(200); // 自己的订单可见
    expect(detail.body.order.items).toHaveLength(1); // 带明细
    const stolen = await request(app).get('/api/v1/commerce/orders/uo_asset_ap-own-1').set('Authorization', `Bearer ${stranger.token}`); // 他人越权查询
    expect(stolen.status).toBe(404); // 与「不存在」同响应
    expect(stolen.body.code).toBe('NOT_FOUND'); // 统一错误信封
    const anon = await request(app).get('/api/v1/commerce/orders'); // 未登录
    expect(anon.status).toBe(401); // 订单属个人数据，必须登录
  });
});
