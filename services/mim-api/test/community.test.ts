/** 契约测试：社区论坛 / 付费阅读 / VIP / 钱包积分 / 独立商城 / 优惠码 / 推广分成 */

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const ADMIN_PASSWORD = 'testpass123';
let app: Express;

beforeEach(() => {
  app = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD } });
});

async function login(identifier = '13800000001'): Promise<Record<string, string>> {
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' };
}

function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() };
}

describe('社区与变现', () => {
  it('匿名访问社区接口返回 401', async () => {
    const res = await request(app).get('/api/v1/community/overview');
    expect(res.status).toBe(401);
  });

  it('种子数据齐备：6 板块 / 7 帖 / 3 VIP / 3 商品 / 2 优惠码，新用户 100 积分', async () => {
    const auth = await login();
    const overview = await request(app).get('/api/v1/community/overview').set(auth);
    expect(overview.status).toBe(200);
    expect(overview.body.boards).toHaveLength(6);
    expect(overview.body.stats.threads).toBe(7);
    expect(overview.body.wallet.points).toBe(100);
    const plans = await request(app).get('/api/v1/vip/plans').set(auth);
    expect(plans.body.plans).toHaveLength(3);
    const products = await request(app).get('/api/v1/shop/products').set(auth);
    expect(products.body.products).toHaveLength(3);
    expect(products.body.products.find((p: { code: string }) => p.code === 'pixi-pack').available).toBe(3);
  });

  it('付费帖未解锁隐藏正文；充值卡兑换后可解锁并读到正文，余额正确扣减', async () => {
    const auth = await login();
    const before = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth);
    expect(before.status).toBe(200);
    expect(before.body.unlocked).toBe(false);
    expect(before.body.thread.body).toBe('');
    expect(before.body.thread.locked).toBe(true);
    expect(before.body.posts).toHaveLength(0);

    const redeem = await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' });
    expect(redeem.status).toBe(200);
    expect(redeem.body.amount_cents).toBe(10000);

    const unlock = await request(app).post('/api/v1/community/threads/thread-paid-store/unlock').set(writeHeaders(auth)).send({});
    expect(unlock.status).toBe(200);
    expect(unlock.body.charged_cents).toBe(1900);

    const after = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth);
    expect(after.body.unlocked).toBe(true);
    expect(after.body.thread.body.length).toBeGreaterThan(10);

    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(8100);
    expect(wallet.body.transactions[0].note).toBe('解锁付费帖'); // 最近一条为消费
  });

  it('回复与点赞写回计数；未解锁的付费帖回复被 403 拒绝', async () => {
    const auth = await login();
    const forbidden = await request(app)
      .post('/api/v1/community/threads/thread-paid-store/reply')
      .set(writeHeaders(auth))
      .send({ content: '还没买就想回复' });
    expect(forbidden.status).toBe(403);

    const reply = await request(app)
      .post('/api/v1/community/threads/thread-store-visual/reply')
      .set(writeHeaders(auth))
      .send({ content: '封面复用策略很实用。' });
    expect(reply.status).toBe(201);
    const detail = await request(app).get('/api/v1/community/threads/thread-store-visual').set(auth);
    expect(detail.body.posts).toHaveLength(1);
    expect(detail.body.thread.reply_count).toBe(1);

    const like = await request(app).post('/api/v1/community/threads/thread-store-visual/like').set(writeHeaders(auth)).send({});
    expect(like.body.liked).toBe(true);
    const unlike = await request(app).post('/api/v1/community/threads/thread-store-visual/like').set(writeHeaders(auth)).send({});
    expect(unlike.body.liked).toBe(false);
  });

  it('VIP 开通扣余额并直接解锁付费帖', async () => {
    const auth = await login();
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-500' });
    const subscribe = await request(app).post('/api/v1/vip/subscribe').set(writeHeaders(auth)).send({ code: 'vip-yearly' });
    expect(subscribe.status).toBe(201);
    expect(subscribe.body.level).toBe(2);

    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(20200);
    expect(wallet.body.vip_level).toBe(2);

    const unlock = await request(app).post('/api/v1/community/threads/thread-paid-store/unlock').set(writeHeaders(auth)).send({});
    expect(unlock.status).toBe(200);
    expect(unlock.body.via).toBe('vip');
    const detail = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth);
    expect(detail.body.unlocked).toBe(true);
  });

  it('实物订单：优惠码立减、地址必填、确认收货；自动发卡订单返回真实卡密并可退款', async () => {
    const auth = await login();
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' });

    const missingShipping = await request(app).post('/api/v1/shop/orders').set(writeHeaders(auth)).send({ product_code: 'mim-keycap' });
    expect(missingShipping.status).toBe(400);

    const physical = await request(app)
      .post('/api/v1/shop/orders')
      .set(writeHeaders(auth))
      .send({
        product_code: 'mim-keycap',
        coupon_code: 'MIM10',
        shipping: { name: '张三', phone: '13800000001', address: '浙江省宁波市测试路 1 号' },
      });
    expect(physical.status).toBe(201);
    expect(physical.body.discount_cents).toBe(1000);
    expect(physical.body.payable_cents).toBe(5900);

    const orders = await request(app).get('/api/v1/shop/orders').set(auth);
    expect(orders.body.items[0].status).toBe('paid');
    expect(orders.body.items[0].coupon_code).toBe('MIM10');

    const confirm = await request(app).post(`/api/v1/shop/orders/${physical.body.order_id}/confirm`).set(writeHeaders(auth)).send({});
    expect(confirm.status).toBe(200);

    const auto = await request(app).post('/api/v1/shop/orders').set(writeHeaders(auth)).send({ product_code: 'pixi-pack' });
    expect(auto.status).toBe(201);
    const autoOrder = (await request(app).get('/api/v1/shop/orders').set(auth)).body.items.find((o: { delivery_kind: string }) => o.delivery_kind === 'virtual_auto');
    expect(autoOrder.status).toBe('delivered');
    expect(autoOrder.delivered_content).toMatch(/^PIXI-MIM-\d{2}-2026$/);

    const refund = await request(app).post(`/api/v1/shop/orders/${autoOrder.id}/refund`).set(writeHeaders(auth)).send({});
    expect(refund.status).toBe(200);
    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(4100); // 10000 - 5900 实物 + 1900 自动发卡退款
  });

  it('优惠码门槛与重复签到冲突都被明确拒绝', async () => {
    const auth = await login();
    const coupon = await request(app).post('/api/v1/coupons/validate').set(writeHeaders(auth)).send({ code: 'MIM10', amount_cents: 1900 });
    expect(coupon.status).toBe(400);
    expect(coupon.body.details.reason).toBe('COUPON_MIN_AMOUNT');

    const first = await request(app).post('/api/v1/wallet/checkin').set(writeHeaders(auth)).send({});
    expect(first.status).toBe(200);
    const again = await request(app).post('/api/v1/wallet/checkin').set(writeHeaders(auth)).send({});
    expect(again.status).toBe(409);
  });

  it('推广绑定：邀请人获得被邀请人首单 5% 佣金', async () => {
    const a = await login('13800000001');
    const b = await login('13800000002');
    const invite = await request(app).get('/api/v1/referral').set(b);
    expect(invite.status).toBe(200);
    expect(invite.body.code).toMatch(/^MIM/);

    const bind = await request(app).post('/api/v1/referral/bind').set(writeHeaders(a)).send({ code: invite.body.code });
    expect(bind.status).toBe(200);

    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(a)).send({ code: 'MIM-DEMO-100' });
    const order = await request(app)
      .post('/api/v1/shop/orders')
      .set(writeHeaders(a))
      .send({
        product_code: 'mim-keycap',
        coupon_code: 'MIM10',
        shipping: { name: '李四', phone: '13800000001', address: '浙江省宁波市测试路 2 号' },
      });
    expect(order.status).toBe(201);

    const walletB = await request(app).get('/api/v1/wallet').set(b);
    expect(walletB.body.wallet.balance_cents).toBe(295); // 5900 * 5%
    const referralB = await request(app).get('/api/v1/referral').set(b);
    expect(referralB.body.invited.count).toBe(1);
    expect(referralB.body.commission_cents).toBe(295);
  });
});
