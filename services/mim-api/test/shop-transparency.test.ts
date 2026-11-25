/**
 * 交易透明化契约测试（2026-11-25 批次）
 *
 * 覆盖口径：
 *   1. 订单列表 / 详情回传金额拆解（amount_cents / discount_cents / payable_cents）、
 *      状态时间线（缺时间戳节点为 null）、下单券信息与退款记录；
 *   2. GET /shop/coupons/mine：本人可见，匿名 401，逐条标注有效 / 过期 / 超次数与本人已用；
 *   3. 越权：他人订单一律 404，不泄露存在性；
 *   4. 券核验纯函数：未达门槛 / 已停用 / 本人已用 / 折扣封顶与立减封顶。
 *
 * 边界：本批不写新库表，全部复用 shop_orders / coupons / coupon_redemptions / payment_ext_refunds。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // vitest 编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { registerTestAccount, type TestAccount } from './_auth-helper.js'; // 测试账号辅助
import { evaluateCoupon, previewCouponDiscount, type CouponPolicyRow } from '../src/commerce/policy.js'; // 券核验纯函数

const JWT_SECRET = 'test-secret-transparency-0123456789abcdef'; // 固定测试密钥
const OPEN_ENV = { MIM_REGISTRATION_ENABLED: '1' }; // 显式开启注册（非生产环境验证码默认 off）

/** 构造一张测试券行，缺省字段给安全值，便于逐条覆盖失效原因 */
function couponRow(overrides: Partial<CouponPolicyRow>): CouponPolicyRow {
  return {
    id: 'cp-x', // 主键占位
    code: 'X10', // 明文占位
    kind: 'fixed', // 券型缺省立减
    value: 500, // 面值缺省 500 分
    min_amount_cents: 0, // 门槛缺省 0
    max_uses: 100, // 总次数缺省不限量级
    used_count: 0, // 已用次数缺省 0
    active: 1, // 缺省启用
    starts_at: null, // 缺省即刻生效
    expires_at: '2099-12-31T23:59:59.000Z', // 缺省长期有效
    ...overrides, // 用例覆盖具体字段
  };
}

let db: ReturnType<typeof createDatabase>; // 共享内存库
let app: Express; // 应用实例

beforeEach(() => { // 每例重建，保证隔离
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: OPEN_ENV }); // 开启注册的应用
});

afterEach(() => { // 用完关闭连接：内存库随进程销毁，显式收尾避免句柄泄漏
  db.close();
});

/** 直接落一条商城订单 + 统一订单 + 明细 + 券核销，供订单透明化断言使用 */
function seedTransparentOrder(userId: string, opts: { status?: string; couponCode?: string; now: string }): { orderId: string; sourceId: string } {
  const product = db.prepare('SELECT id FROM shop_products LIMIT 1').get() as { id: string }; // 取种子商品，满足外键
  const sourceId = `so-trans-${userId.slice(-4)}`; // 商城订单主键
  const orderId = `uo_shop_${sourceId}`; // 统一订单主键，按回填派生规则
  db.prepare( // 商城源订单：含券码、交付时间与金额拆解
    `INSERT INTO shop_orders (id, user_id, product_id, quantity, amount_cents, discount_cents, payable_cents, coupon_code, status, delivery_kind, created_at, paid_at, delivered_at)
     VALUES (?, ?, ?, 1, 5000, 1000, 4000, ?, ?, 'card_key', ?, ?, ?)`,
  ).run(sourceId, userId, product.id, opts.couponCode ?? null, opts.status ?? 'delivered', opts.now, opts.now, opts.now);
  db.prepare( // 统一商品行：kind 取卡密，满足 CHECK 约束
    `INSERT OR IGNORE INTO products (id, kind, code, title, price_cents, currency, stock, status, meta_json, created_at)
     VALUES (?, 'card', 'PROD-TRANS', '透明化测试商品', 5000, 'CNY', 1, 'active', '{}', ?)`,
  ).run('prod-trans-1', opts.now);
  db.prepare( // 统一订单主体
    `INSERT INTO orders (id, user_id, source, source_id, status, channel, currency, total_cents, discount_cents, payable_cents, created_at, paid_at)
     VALUES (?, ?, 'shop', ?, ?, 'wallet', 'CNY', 5000, 1000, 4000, ?, ?)`,
  ).run(orderId, userId, sourceId, opts.status ?? 'delivered', opts.now, opts.now);
  db.prepare( // 订单明细
    `INSERT INTO order_items (id, order_id, product_id, title, quantity, unit_price_cents, meta_json)
     VALUES (?, ?, 'prod-trans-1', '透明化测试商品', 1, 5000, '{}')`,
  ).run(`uoi_shop_${sourceId}`, orderId);
  return { orderId, sourceId };
}

describe('订单透明化回显', () => {
  it('匿名访问订单列表与我的优惠均返回 401', async () => {
    const orders = await request(app).get('/api/v1/commerce/orders'); // 未带令牌
    expect(orders.status).toBe(401); // 私密读未登录拦截
    const coupons = await request(app).get('/api/v1/shop/coupons/mine'); // 未带令牌
    expect(coupons.status).toBe(401); // 券清单同样要求登录
  });

  it('订单返回金额拆解、时间线、券信息；退款后回显退款记录；他人不可见', async () => {
    const a: TestAccount = await registerTestAccount(app, '13900000101'); // 下单人
    const b: TestAccount = await registerTestAccount(app, '13900000102'); // 越权对照人
    const now = new Date().toISOString(); // 统一时间戳，便于时间线断言
    db.prepare( // 有效立减券：门槛 0，100 次额度
      `INSERT INTO coupons (id, code, kind, value, min_amount_cents, max_uses, used_count, active, starts_at, expires_at)
       VALUES (?, 'TRANS10', 'fixed', 1000, 0, 100, 0, 1, NULL, '2099-12-31T23:59:59.000Z')`,
    ).run('cp-trans');
    const { orderId, sourceId } = seedTransparentOrder(a.userId, { couponCode: 'TRANS10', now });
    db.prepare( // 券核销记录：本单实减 1000 分
      `INSERT INTO coupon_redemptions (id, coupon_id, user_id, order_id, discount_cents, created_at)
       VALUES (?, 'cp-trans', ?, ?, 1000, ?)`,
    ).run('cr-trans-1', a.userId, sourceId, now);

    const res = await request(app).get('/api/v1/commerce/orders').set('authorization', `Bearer ${a.token}`); // 本人列表
    expect(res.status).toBe(200); // 登录读取成功
    expect(res.body.items).toHaveLength(1); // 仅本人这一单
    const order = res.body.items[0]; // 取订单视图

    // 金额拆解：原价 5000 / 优惠 1000 / 应付 4000
    expect(order.amount_cents).toBe(5000); // 原价合计
    expect(order.discount_cents).toBe(1000); // 优惠合计
    expect(order.payable_cents).toBe(4000); // 实付金额

    // 券信息：券型 / 面值 / 本单实减
    expect(order.coupon.code).toBe('TRANS10'); // 券明文
    expect(order.coupon.kind).toBe('fixed'); // 立减券
    expect(order.coupon.discount_cents).toBe(1000); // 本单实减

    // 时间线：已下单 / 已支付 / 已交付三个节点有时间戳，退款 / 取消节点为 null
    const nodes = Object.fromEntries(order.status_timeline.map((node: { node: string; at: string | null }) => [node.node, node.at]));
    expect(nodes.pending).toBe(now); // 下单时间
    expect(nodes.paid).toBe(now); // 支付时间
    expect(nodes.delivered).toBe(now); // 交付时间
    expect(nodes.refunded).toBeNull(); // 未退款：时间戳为 null
    expect(nodes.cancelled).toBeNull(); // 未取消：时间戳为 null
    expect(order.refunds).toEqual([]); // 未退款：退款记录为空数组

    // 商城订单标记退款后，退款记录按实付金额回显，来源为 shop_order
    db.prepare("UPDATE shop_orders SET status = 'refunded' WHERE id = ?").run(sourceId);
    const res2 = await request(app).get('/api/v1/commerce/orders').set('authorization', `Bearer ${a.token}`);
    const refunded = res2.body.items[0]; // 刷新后的订单视图
    expect(refunded.refunds).toHaveLength(1); // 一条退款记录
    expect(refunded.refunds[0].amount_cents).toBe(4000); // 退款金额取实付
    expect(refunded.refunds[0].source).toBe('shop_order'); // 来源标注为商城订单
    expect(refunded.refunds[0].created_at).toBeNull(); // 商城订单无退款时间列，标 null

    // 越权：他人访问该订单详情必须 404，不泄露存在性
    const other = await request(app).get(`/api/v1/commerce/orders/${orderId}`).set('authorization', `Bearer ${b.token}`);
    expect(other.status).toBe(404); // 跨用户不可见
  });
});

describe('我的优惠核验清单', () => {
  it('mine 清单标注有效 / 过期 / 超次数，并回显门槛与次数字段', async () => {
    const a: TestAccount = await registerTestAccount(app, '13900000103'); // 登录用户
    const future = '2099-12-31T23:59:59.000Z'; // 远期过期时间
    db.prepare( // 有效券：立减 500，100 次额度
      `INSERT INTO coupons (id, code, kind, value, min_amount_cents, max_uses, used_count, active, starts_at, expires_at)
       VALUES ('cp-ok', 'OK10', 'fixed', 500, 0, 100, 0, 1, NULL, ?)`,
    ).run(future);
    db.prepare( // 过期券：有效期已过
      `INSERT INTO coupons (id, code, kind, value, min_amount_cents, max_uses, used_count, active, starts_at, expires_at)
       VALUES ('cp-exp', 'EXP10', 'fixed', 500, 0, 100, 0, 1, NULL, '2020-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare( // 超次数券：额度 1 次且已用完
      `INSERT INTO coupons (id, code, kind, value, min_amount_cents, max_uses, used_count, active, starts_at, expires_at)
       VALUES ('cp-exh', 'EXH10', 'fixed', 500, 0, 1, 1, 1, NULL, ?)`,
    ).run(future);

    const res = await request(app).get('/api/v1/shop/coupons/mine').set('authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200); // 登录读取成功
    const byCode = Object.fromEntries(res.body.coupons.map((coupon: { code: string }) => [coupon.code, coupon]));
    expect(byCode.OK10.valid).toBe(true); // 有效券核验通过
    expect(byCode.OK10.redeemed_by_me).toBe(false); // 本人未核销
    expect(byCode.EXP10.invalid_reason).toBe('expired'); // 过期原因标注
    expect(byCode.EXH10.invalid_reason).toBe('exhausted'); // 超次数原因标注
    expect(byCode.OK10.max_uses).toBe(100); // 总次数字段回显
    expect(byCode.OK10.used_count).toBe(0); // 已用次数字段回显
  });
});

describe('券核验纯函数', () => {
  it('未达门槛 / 已停用 / 本人已用分别命中对应失效原因', () => {
    const belowMin = evaluateCoupon(couponRow({ min_amount_cents: 3000 }), 1000, { redeemedByMe: false });
    expect(belowMin.valid).toBe(false); // 核验不通过
    expect(belowMin.invalid_reason).toBe('min_amount'); // 未达门槛
    const inactive = evaluateCoupon(couponRow({ active: 0 }), 5000, { redeemedByMe: false });
    expect(inactive.invalid_reason).toBe('inactive'); // 已停用
    const alreadyUsed = evaluateCoupon(couponRow({}), 5000, { redeemedByMe: true });
    expect(alreadyUsed.invalid_reason).toBe('already_used'); // 本人已用
  });

  it('折扣与立减预估均不超过订单金额，百分比四舍五入到分', () => {
    expect(previewCouponDiscount('percent', 20, 3000)).toBe(600); // 20% × 3000 = 600 分
    expect(previewCouponDiscount('fixed', 99999, 5000)).toBe(5000); // 立减封顶为订单金额
    expect(previewCouponDiscount('percent', 20, 0)).toBe(0); // 0 元单不产生优惠
    const valid = evaluateCoupon(couponRow({ kind: 'percent', value: 20 }), 3000, { redeemedByMe: false });
    expect(valid.discount_cents).toBe(600); // 核验通过时同步给出预估实减
  });
});
