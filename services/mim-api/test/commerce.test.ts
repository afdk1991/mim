/** 契约测试：付费资产 / 支付意图 / 发货售后 / 提现分成 / 外观页面 / 成长私信 / 国际化 */

import { createHmac, randomUUID } from 'node:crypto'; // 沙箱签名与幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // HTTP 断言
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const ADMIN_PASSWORD = 'testpass123'; // 测试口令
const ADMIN_TOKEN = 'test-admin-token'; // 运营引导令牌
const SANDBOX_SECRET = 'sandbox-secret'; // 沙箱回调密钥
let app: Express; // 状态：保存跨步骤复用的值

beforeEach(() => {
  app = createApp({
    db: createDatabase(':memory:'),
    jwtSecret: JWT_SECRET,
    env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_PAYMENT_SANDBOX: '1', MIM_PAYMENT_SANDBOX_SECRET: SANDBOX_SECRET },
  });
});

/** 登录并返回鉴权头；identifier 不同即不同用户。 */
async function login(identifier = '13800000001'): Promise<Record<string, string>> {
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD }); // 构造：准备本用例需要的输入、句柄或期望值
  expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' };
}

/** 带幂等键的写请求头。 */
function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() };
}

/** 运营请求头：走超管引导通道，不依赖角色表。 */
function opsHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json', 'idempotency-key': randomUUID() };
}

describe('商业化二期', () => {
  it('付费资产种子齐备；未购买只给试读，购买后解锁正文', async () => {
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const list = await request(app).get('/api/v1/assets').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(list.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(list.body.items.length).toBe(5); // 断言：校验响应字段与冻结契约一致
    expect(list.body.items.find((item: { code: string }) => item.code === 'paid-article-store').unlocked).toBe(false); // 断言：校验响应字段与冻结契约一致

    const locked = await request(app).get('/api/v1/assets/paid-article-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(locked.body.asset.unlocked).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(locked.body.asset.body.length).toBeLessThan(260); // 断言：校验响应字段与冻结契约一致
    expect(locked.body.asset.file_url).toBeNull(); // 断言：校验响应字段与冻结契约一致

    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回
    const buy = await request(app).post('/api/v1/assets/paid-article-store/purchase').set(writeHeaders(auth)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(buy.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(buy.body.charged_cents).toBe(1900); // 断言：校验响应字段与冻结契约一致
    expect(buy.body.via).toBe('balance'); // 断言：校验响应字段与冻结契约一致

    const unlocked = await request(app).get('/api/v1/assets/paid-article-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(unlocked.body.asset.unlocked).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(unlocked.body.asset.body).toContain('六层'); // 断言：校验响应字段与冻结契约一致
  });

  it('作者发布资产、他人购买后作者获得 70% 待结算收益', async () => {
    const author = await login('13800000001'); // 构造：准备本用例需要的输入、句柄或期望值
    const buyer = await login('13800000002'); // 构造：准备本用例需要的输入、句柄或期望值
    const created = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/assets')
      .set(writeHeaders(author))
      .send({ code: 'author-kit', kind: 'download', title: '作者工具包', summary: '测试', body: '内容', price_cents: 500, file_url: '/f.zip' });
    expect(created.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(buyer)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回
    const buy = await request(app).post('/api/v1/assets/author-kit/purchase').set(writeHeaders(buyer)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(buy.body.charged_cents).toBe(500); // 断言：校验响应字段与冻结契约一致
    const earnings = await request(app).get('/api/v1/earnings').set(author); // 构造：准备本用例需要的输入、句柄或期望值
    expect(earnings.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(earnings.body.summary.pending).toBe(350); // 断言：校验响应字段与冻结契约一致
  });

  it('沙箱支付：验签通过才充值，错误签名被 403 拒绝', async () => {
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const create = await request(app).post('/api/v1/payments/intents').set(writeHeaders(auth)).send({ purpose: 'recharge', ref_id: 'wallet', provider: 'sandbox', amount_cents: 1000 }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(create.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const intent = create.body.intent; // 构造：准备本用例需要的输入、句柄或期望值
    const good = createHmac('sha256', SANDBOX_SECRET).update(`${intent.id}.1000.paid`).digest('hex'); // 构造：准备本用例需要的输入、句柄或期望值
    const bad = await request(app).post('/api/v1/payments/sandbox/notify').send({ intent_id: intent.id, amount_cents: 1000, status: 'paid' }).set('x-mim-signature', 'deadbeef'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(bad.status).toBe(403); // 断言：校验响应字段与冻结契约一致
    const ok = await request(app).post('/api/v1/payments/sandbox/notify').send({ intent_id: intent.id, amount_cents: 1000, status: 'paid' }).set('x-mim-signature', good); // 构造：准备本用例需要的输入、句柄或期望值
    expect(ok.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(1000); // 断言：校验响应字段与冻结契约一致
  });

  it('发货、轨迹、评价、售后退款串成完整闭环', async () => {
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回
    const order = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/shop/orders')
      .set(writeHeaders(auth))
      .send({ product_code: 'mim-keycap', quantity: 1, shipping: { name: '张三', phone: '13800000000', address: '宁波市测试路 1 号' } });
    expect(order.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const orderId = order.body.order_id; // 构造：准备本用例需要的输入、句柄或期望值

    const ship = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post(`/api/v1/shop/orders/${orderId}/ship`)
      .set(opsHeaders())
      .send({ carrier: '顺丰', tracking_no: 'SF123456789', status: 'transit', events: [{ text: '已揽收' }] });
    expect(ship.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const tracking = await request(app).get(`/api/v1/shop/orders/${orderId}/shipment`).set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(tracking.body.shipment.carrier).toBe('顺丰'); // 断言：校验响应字段与冻结契约一致
    expect(tracking.body.shipment.events).toHaveLength(1); // 断言：校验响应字段与冻结契约一致

    const review = await request(app).post(`/api/v1/shop/orders/${orderId}/review`).set(writeHeaders(auth)).send({ rating: 5, content: '手感很好' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(review.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const reviews = await request(app).get('/api/v1/shop/products/mim-keycap/reviews').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(reviews.body.summary.avg).toBe(5); // 断言：校验响应字段与冻结契约一致

    const after = await request(app).post(`/api/v1/shop/orders/${orderId}/after-sales`).set(writeHeaders(auth)).send({ kind: 'refund', reason: '尺寸不合适' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(after.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const approve = await request(app).post(`/api/v1/after-sales/${after.body.id}/review`).set(opsHeaders()).send({ approve: true, note: '同意退款' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(approve.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const orders = await request(app).get('/api/v1/shop/orders').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(orders.body.items.find((item: { id: string }) => item.id === orderId).status).toBe('refunded'); // 断言：校验响应字段与冻结契约一致
  });

  it('提现冻结余额、驳回退回、通过后可标记打款', async () => {
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回
    const apply = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(auth)).send({ amount_cents: 5000, channel: 'alipay', account: 'test@example.com' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(apply.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(5000); // 断言：校验响应字段与冻结契约一致

    const reject = await request(app).post(`/api/v1/withdrawals/${apply.body.id}/review`).set(opsHeaders()).send({ action: 'reject', note: '账号不符' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(reject.body.status).toBe('rejected'); // 断言：校验响应字段与冻结契约一致
    const restored = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(restored.body.wallet.balance_cents).toBe(10000); // 断言：校验响应字段与冻结契约一致

    const second = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(auth)).send({ amount_cents: 5000, channel: 'bank', account: '6222000000000000' }); // 构造：准备本用例需要的输入、句柄或期望值
    const approve = await request(app).post(`/api/v1/withdrawals/${second.body.id}/review`).set(opsHeaders()).send({ action: 'approve' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(approve.body.status).toBe('approved'); // 断言：校验响应字段与冻结契约一致
    const paid = await request(app).post(`/api/v1/withdrawals/${second.body.id}/review`).set(opsHeaders()).send({ action: 'paid' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(paid.body.status).toBe('paid'); // 断言：校验响应字段与冻结契约一致
  });

  it('外观设置与页面区块可读可改可排序', async () => {
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const view = await request(app).get('/api/v1/appearance').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(view.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(view.body.settings.theme.accent).toBe('#0f766e'); // 断言：校验响应字段与冻结契约一致
    const home = await request(app).get('/api/v1/pages/home').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(home.body.blocks.length).toBe(3); // 断言：校验响应字段与冻结契约一致

    const update = await request(app).put('/api/v1/appearance/settings').set(opsHeaders()).send({ key: 'theme', value: { accent: '#1d4ed8' } }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(update.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const create = await request(app).post('/api/v1/pages/home/blocks').set(opsHeaders()).send({ kind: 'notice', sort_order: 9, config: { text: '新公告' } }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(create.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const reorder = await request(app).put('/api/v1/pages/home/reorder').set(opsHeaders()).send({ ids: [create.body.id, 'block-home-hero'] }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(reorder.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  });

  it('成长等级、徽章同步、私信与 IP 归属地可用', async () => {
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const growth = await request(app).get('/api/v1/me/growth').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(growth.body.level).toBe(1); // 断言：校验响应字段与冻结契约一致
    expect(growth.body.badges.length).toBe(5); // 断言：校验响应字段与冻结契约一致
    const sync = await request(app).post('/api/v1/me/growth/sync').set(writeHeaders(auth)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(sync.body.awarded).toContain('newcomer'); // 断言：校验响应字段与冻结契约一致

    const me = await request(app).get('/api/v1/me').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    const other = await login('13800000002'); // 构造：准备本用例需要的输入、句柄或期望值
    const otherMe = await request(app).get('/api/v1/me').set(other); // 构造：准备本用例需要的输入、句柄或期望值
    const send = await request(app).post('/api/v1/messages').set(writeHeaders(auth)).send({ to_member_no: otherMe.body.user.member_no, content: '你好' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(send.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const inbox = await request(app).get('/api/v1/messages').set(other); // 构造：准备本用例需要的输入、句柄或期望值
    expect(inbox.body.unread).toBe(1); // 断言：校验响应字段与冻结契约一致
    expect(inbox.body.items[0].peer_member_no).toBe(me.body.user.member_no); // 断言：校验响应字段与冻结契约一致

    const ip = await request(app).get('/api/v1/me/ip').set(auth).set('cf-ipcountry', 'CN'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(ip.body.region_code).toBe('CN'); // 断言：校验响应字段与冻结契约一致
    expect(ip.body.ip_hash_prefix.length).toBe(12); // 断言：校验响应字段与冻结契约一致
  });

  it('翻译未配置时明确 503，前后台语言可分离', async () => {
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const settings = await request(app).get('/api/v1/i18n/settings').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(settings.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(settings.body.settings.front).toBe('zh-CN'); // 断言：校验响应字段与冻结契约一致
    const update = await request(app).put('/api/v1/i18n/settings').set(opsHeaders()).send({ front: 'en-US', admin: 'zh-CN', machine_translation: false }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(update.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(update.body.settings.front).toBe('en-US'); // 断言：校验响应字段与冻结契约一致
    const translate = await request(app).post('/api/v1/i18n/translate').set(auth).send({ text: '你好', target: 'en-US' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(translate.status).toBe(503); // 断言：校验响应字段与冻结契约一致
    expect(translate.body.code).toBe('PROVIDER_NOT_CONFIGURED'); // 断言：校验响应字段与冻结契约一致
  });
});
