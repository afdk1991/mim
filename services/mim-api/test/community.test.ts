/** 契约测试：社区论坛 / 付费阅读 / VIP / 钱包积分 / 独立商城 / 优惠码 / 推广分成 */

import { randomUUID } from 'node:crypto'; // 引入依赖、类型或本地模块绑定
import { beforeEach, describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // 引入：声明测试所需依赖
import type { Express } from 'express'; // 引入：声明测试所需依赖
import { createApp } from '../src/app.js'; // 引入依赖、类型或本地模块绑定
import { createDatabase } from '../src/db.js'; // 引入依赖、类型或本地模块绑定

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 构造：准备本用例需要的输入、句柄或期望值
const ADMIN_PASSWORD = 'testpass123'; // 构造：准备本用例需要的输入、句柄或期望值
let app: Express; // 状态：保存跨步骤复用的值

beforeEach(() => { // 调用 beforeEach 并处理其返回结果
  app = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD } }); // 赋值：更新变量 app 的取值
}); // 代码块结束

async function login(identifier = '13800000001'): Promise<Record<string, string>> { // 函数 login：封装一段可复用的处理逻辑
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD }); // 构造：准备本用例需要的输入、句柄或期望值
  expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' }; // 返回：交回本步骤结果供断言使用
} // 代码块结束

function writeHeaders(auth: Record<string, string>): Record<string, string> { // 函数 writeHeaders：封装一段可复用的处理逻辑
  return { ...auth, 'idempotency-key': randomUUID() }; // 返回：交回本步骤结果供断言使用
} // 代码块结束

describe('社区与变现', () => { // 调用 describe 并处理其返回结果
  it('匿名访问社区接口返回 401', async () => { // 调用 it 并处理其返回结果
    const res = await request(app).get('/api/v1/community/overview'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(res.status).toBe(401); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('种子数据齐备：6 板块 / 7 帖 / 3 VIP / 3 商品 / 2 优惠码，新用户 100 积分', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const overview = await request(app).get('/api/v1/community/overview').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(overview.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(overview.body.boards).toHaveLength(6); // 断言：校验响应字段与冻结契约一致
    expect(overview.body.stats.threads).toBe(7); // 断言：校验响应字段与冻结契约一致
    expect(overview.body.wallet.points).toBe(100); // 断言：校验响应字段与冻结契约一致
    const plans = await request(app).get('/api/v1/vip/plans').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(plans.body.plans).toHaveLength(3); // 断言：校验响应字段与冻结契约一致
    const products = await request(app).get('/api/v1/shop/products').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(products.body.products).toHaveLength(3); // 断言：校验响应字段与冻结契约一致
    expect(products.body.products.find((p: { code: string }) => p.code === 'pixi-pack').available).toBe(3); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('付费帖未解锁隐藏正文；充值卡兑换后可解锁并读到正文，余额正确扣减', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const before = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(before.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(before.body.unlocked).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(before.body.thread.body).toBe(''); // 断言：校验响应字段与冻结契约一致
    expect(before.body.thread.locked).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(before.body.posts).toHaveLength(0); // 断言：校验响应字段与冻结契约一致

    const redeem = await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(redeem.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(redeem.body.amount_cents).toBe(10000); // 断言：校验响应字段与冻结契约一致

    const unlock = await request(app).post('/api/v1/community/threads/thread-paid-store/unlock').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(unlock.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(unlock.body.charged_cents).toBe(1900); // 断言：校验响应字段与冻结契约一致

    const after = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(after.body.unlocked).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(after.body.thread.body.length).toBeGreaterThan(10); // 断言：校验响应字段与冻结契约一致

    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(8100); // 断言：校验响应字段与冻结契约一致
    expect(wallet.body.transactions[0].note).toBe('解锁付费帖'); // 最近一条为消费
  }); // 代码块结束

  it('回复与点赞写回计数；未解锁的付费帖回复被 403 拒绝', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const forbidden = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/community/threads/thread-paid-store/reply') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(auth)) // 执行当前业务步骤
      .send({ content: '还没买就想回复' }); // 执行当前业务步骤
    expect(forbidden.status).toBe(403); // 断言：校验响应字段与冻结契约一致

    const reply = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/community/threads/thread-store-visual/reply') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(auth)) // 执行当前业务步骤
      .send({ content: '封面复用策略很实用。' }); // 执行当前业务步骤
    expect(reply.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const detail = await request(app).get('/api/v1/community/threads/thread-store-visual').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(detail.body.posts).toHaveLength(1); // 断言：校验响应字段与冻结契约一致
    expect(detail.body.thread.reply_count).toBe(1); // 断言：校验响应字段与冻结契约一致

    const like = await request(app).post('/api/v1/community/threads/thread-store-visual/like').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(like.body.liked).toBe(true); // 断言：校验响应字段与冻结契约一致
    const unlike = await request(app).post('/api/v1/community/threads/thread-store-visual/like').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(unlike.body.liked).toBe(false); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('VIP 开通扣余额并直接解锁付费帖', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-500' }); // 执行：等待接口或数据库操作返回
    const subscribe = await request(app).post('/api/v1/vip/subscribe').set(writeHeaders(auth)).send({ code: 'vip-yearly' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(subscribe.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(subscribe.body.level).toBe(2); // 断言：校验响应字段与冻结契约一致

    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(20200); // 断言：校验响应字段与冻结契约一致
    expect(wallet.body.vip_level).toBe(2); // 断言：校验响应字段与冻结契约一致

    const unlock = await request(app).post('/api/v1/community/threads/thread-paid-store/unlock').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(unlock.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(unlock.body.via).toBe('vip'); // 断言：校验响应字段与冻结契约一致
    const detail = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(detail.body.unlocked).toBe(true); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('实物订单：优惠码立减、地址必填、确认收货；自动发卡订单返回真实卡密并可退款', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回

    const missingShipping = await request(app).post('/api/v1/shop/orders').set(writeHeaders(auth)).send({ product_code: 'mim-keycap' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(missingShipping.status).toBe(400); // 断言：校验响应字段与冻结契约一致

    const physical = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/shop/orders') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(auth)) // 执行当前业务步骤
      .send({ // 执行当前业务步骤
        product_code: 'mim-keycap', // 对象字段 product_code：记录一项配置或数据
        coupon_code: 'MIM10', // 对象字段 coupon_code：记录一项配置或数据
        shipping: { name: '张三', phone: '13800000001', address: '浙江省宁波市测试路 1 号' }, // 对象字段 shipping：记录一项配置或数据
      }); // 代码块结束
    expect(physical.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(physical.body.discount_cents).toBe(1000); // 断言：校验响应字段与冻结契约一致
    expect(physical.body.payable_cents).toBe(5900); // 断言：校验响应字段与冻结契约一致

    const orders = await request(app).get('/api/v1/shop/orders').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(orders.body.items[0].status).toBe('paid'); // 断言：校验响应字段与冻结契约一致
    expect(orders.body.items[0].coupon_code).toBe('MIM10'); // 断言：校验响应字段与冻结契约一致

    const confirm = await request(app).post(`/api/v1/shop/orders/${physical.body.order_id}/confirm`).set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(confirm.status).toBe(200); // 断言：校验响应字段与冻结契约一致

    const auto = await request(app).post('/api/v1/shop/orders').set(writeHeaders(auth)).send({ product_code: 'pixi-pack' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(auto.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const autoOrder = (await request(app).get('/api/v1/shop/orders').set(auth)).body.items.find((o: { delivery_kind: string }) => o.delivery_kind === 'virtual_auto'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(autoOrder.status).toBe('delivered'); // 断言：校验响应字段与冻结契约一致
    expect(autoOrder.delivered_content).toMatch(/^PIXI-MIM-\d{2}-2026$/); // 断言：校验响应字段与冻结契约一致

    const refund = await request(app).post(`/api/v1/shop/orders/${autoOrder.id}/refund`).set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(refund.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(4100); // 10000 - 5900 实物 + 1900 自动发卡退款
  }); // 代码块结束

  it('优惠码门槛与重复签到冲突都被明确拒绝', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const coupon = await request(app).post('/api/v1/coupons/validate').set(writeHeaders(auth)).send({ code: 'MIM10', amount_cents: 1900 }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(coupon.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(coupon.body.details.reason).toBe('COUPON_MIN_AMOUNT'); // 断言：校验响应字段与冻结契约一致

    const first = await request(app).post('/api/v1/wallet/checkin').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(first.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const again = await request(app).post('/api/v1/wallet/checkin').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(again.status).toBe(409); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('推广绑定：邀请人获得被邀请人首单 5% 佣金', async () => { // 调用 it 并处理其返回结果
    const a = await login('13800000001'); // 构造：准备本用例需要的输入、句柄或期望值
    const b = await login('13800000002'); // 构造：准备本用例需要的输入、句柄或期望值
    const invite = await request(app).get('/api/v1/referral').set(b); // 构造：准备本用例需要的输入、句柄或期望值
    expect(invite.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(invite.body.code).toMatch(/^MIM/); // 断言：校验响应字段与冻结契约一致

    const bind = await request(app).post('/api/v1/referral/bind').set(writeHeaders(a)).send({ code: invite.body.code }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(bind.status).toBe(200); // 断言：校验响应字段与冻结契约一致

    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(a)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回
    const order = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/shop/orders') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(a)) // 执行当前业务步骤
      .send({ // 执行当前业务步骤
        product_code: 'mim-keycap', // 对象字段 product_code：记录一项配置或数据
        coupon_code: 'MIM10', // 对象字段 coupon_code：记录一项配置或数据
        shipping: { name: '李四', phone: '13800000001', address: '浙江省宁波市测试路 2 号' }, // 对象字段 shipping：记录一项配置或数据
      }); // 代码块结束
    expect(order.status).toBe(201); // 断言：校验响应字段与冻结契约一致

    const walletB = await request(app).get('/api/v1/wallet').set(b); // 构造：准备本用例需要的输入、句柄或期望值
    expect(walletB.body.wallet.balance_cents).toBe(295); // 5900 * 5%
    const referralB = await request(app).get('/api/v1/referral').set(b); // 构造：准备本用例需要的输入、句柄或期望值
    expect(referralB.body.invited.count).toBe(1); // 断言：校验响应字段与冻结契约一致
    expect(referralB.body.commission_cents).toBe(295); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束
}); // 代码块结束
