/** 契约测试：付费阅读（社区帖子层）——未购不可读 / 购买永久 / 重复不扣费 / 统一交易域入账 */

import { randomUUID } from 'node:crypto'; // 写操作幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 被测应用
import { createDatabase } from '../src/db.js'; // 内存库 + 种子
import { backfillUnifiedCommerce } from '../src/commerce/unified.js'; // 回填幂等验证
import { loginHeaders, registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const THREAD = 'thread-paid-store'; // 种子付费帖：board-paid，单价 1900
const PRICE = 1900; // 与种子一致

let app: Express; // 应用句柄
let db: ReturnType<typeof createDatabase>; // 直接查库核对落单字段

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} });
});

/** 写操作需要幂等键，避免重复提交被中间件拦截 */
function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() };
}

/** 统计某张表里与付费帖相关的行数 */
function countRows(sql: string, ...args: unknown[]): number {
  return (db.prepare(sql).get(...args) as { n: number }).n;
}

describe('付费阅读（社区帖子层）', () => {
  it('未购买：详情隐藏正文与回复、列表标锁、回复被 403 拒绝', async () => {
    const auth = await loginHeaders(app, '13800000101');

    const detail = await request(app).get(`/api/v1/community/threads/${THREAD}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.unlocked).toBe(false);
    expect(detail.body.thread.body).toBe('');
    expect(detail.body.thread.locked).toBe(true);
    expect(detail.body.thread.media).toHaveLength(0);
    expect(detail.body.posts).toHaveLength(0);

    const list = await request(app).get('/api/v1/community/threads?board=paid').set(auth);
    const item = list.body.items.find((row: { id: string }) => row.id === THREAD);
    expect(item.locked).toBe(true);

    const reply = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/reply`)
      .set(writeHeaders(auth))
      .send({ content: '没买就想回复' });
    expect(reply.status).toBe(403);
  });

  it('余额不足：明确拒绝且不产生购买记录与统一订单', async () => {
    const auth = await loginHeaders(app, '13800000102');

    const unlock = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(unlock.status).toBe(400);
    expect(unlock.body.details.reason).toBe('INSUFFICIENT_BALANCE');
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ?', THREAD)).toBe(0);
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(0);
  });

  it('购买后永久可读：余额扣减一次，订单 / 明细 / 支付 / 履约同事务入统一交易域', async () => {
    const auth = await loginHeaders(app, '13800000103');

    const redeem = await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' });
    expect(redeem.status).toBe(200);
    expect(redeem.body.amount_cents).toBe(10000);

    const unlock = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(unlock.status).toBe(200);
    expect(unlock.body.unlocked).toBe(true);
    expect(unlock.body.charged_cents).toBe(PRICE);

    const detail = await request(app).get(`/api/v1/community/threads/${THREAD}`).set(auth);
    expect(detail.body.unlocked).toBe(true);
    expect(detail.body.thread.locked).toBe(false);
    expect(detail.body.thread.body.length).toBeGreaterThan(10);

    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(10000 - PRICE);
    expect(wallet.body.transactions[0].note).toBe('解锁付费帖');

    // 统一交易域：订单来自 community 产线，金额与钱包扣减一致
    const orders = await request(app).get('/api/v1/commerce/orders?source=community').set(auth);
    expect(orders.status).toBe(200);
    expect(orders.body.items).toHaveLength(1);
    const order = orders.body.items[0];
    expect(order.source).toBe('community');
    expect(order.status).toBe('paid');
    expect(order.channel).toBe('wallet');
    expect(order.payable_cents).toBe(PRICE);
    expect(order.total_cents).toBe(PRICE);
    expect(order.items[0].product_id).toBe(THREAD);

    // 支付 / 履约 / 商品三类凭据同事务落库（不走第二套记账）
    expect(countRows("SELECT COUNT(*) AS n FROM payments WHERE provider = 'wallet' AND status = 'paid' AND amount_cents = ?", PRICE)).toBe(1);
    expect(countRows("SELECT COUNT(*) AS n FROM fulfillments WHERE kind = 'entitlement'")).toBe(1);
    expect(countRows("SELECT COUNT(*) AS n FROM products WHERE id = ? AND kind = 'asset'", THREAD)).toBe(1);
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ? AND amount_cents = ?', THREAD, PRICE)).toBe(1);

    const summary = await request(app).get('/api/v1/commerce/orders/summary').set(auth);
    expect(summary.body.summary.paid).toBe(1);
    expect(summary.body.summary.payable_cents).toBe(PRICE);
  });

  it('重复购买：直接放行、不重复扣费、不新增订单与明细', async () => {
    const auth = await loginHeaders(app, '13800000104');
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' });
    await request(app).post(`/api/v1/community/threads/${THREAD}/unlock`).set(writeHeaders(auth)).send({});

    const again = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.via).toBe('owned');
    expect(again.body.charged_cents).toBe(0);

    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(10000 - PRICE);
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ?', THREAD)).toBe(1);
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(1);
    expect(countRows('SELECT COUNT(*) AS n FROM order_items')).toBe(1);
    expect(countRows("SELECT COUNT(*) AS n FROM wallet_transactions WHERE kind = 'consume' AND ref_type = 'community_thread'")).toBe(1);
  });

  it('调价后已购仍永久可读；启动回填可重复执行不重复落单', async () => {
    const auth = await loginHeaders(app, '13800000105');
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' });
    await request(app).post(`/api/v1/community/threads/${THREAD}/unlock`).set(writeHeaders(auth)).send({});

    db.prepare('UPDATE community_threads SET price_cents = 4900 WHERE id = ?').run(THREAD);

    const detail = await request(app).get(`/api/v1/community/threads/${THREAD}`).set(auth);
    expect(detail.body.unlocked).toBe(true);
    expect(detail.body.thread.body.length).toBeGreaterThan(10);
    expect(detail.body.thread.locked).toBe(false);

    const again = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(again.body.via).toBe('owned');
    expect(again.body.charged_cents).toBe(0);

    // 历史数据：直写一条 community_purchases 模拟迁移前的旧记录，回填必须为它补出统一订单
    const legacy = await registerTestAccount(app, '13800000107');
    db.prepare(
      'INSERT INTO community_purchases (id, user_id, thread_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('cp_legacy_backfill', legacy.userId, THREAD, 1500, new Date().toISOString());

    const first = backfillUnifiedCommerce(db); // 首次回填：旧记录补单，已落单行不重复
    expect(first.orders).toBe(1);
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE id = 'uo_community_cp_legacy_backfill'")).toBe(1);
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(2);

    const second = backfillUnifiedCommerce(db); // 再跑一次：全部命中幂等，零新增
    expect(second.orders).toBe(0);
    expect(second.items).toBe(0);
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(2);
  });

  it('作者本人：无需购买即可读正文，unlock 返回 author 且不落购买记录', async () => {
    const author = await registerTestAccount(app, '13800000106');
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO community_threads
         (id, board_id, author_id, title, summary, body, kind, price_cents, status, views, likes, reply_count, recommend_score, created_at, updated_at, last_activity_at)
       VALUES (?, 'board-paid', ?, ?, ?, ?, 'text', 2600, 'published', 0, 0, 0, 0, ?, ?, ?)`,
    ).run('thread-author-owned', author.userId, '作者自己的付费帖', '作者免购验证', '这是作者本人发布的付费正文，作者读取自己内容不应被付费墙拦截。', ts, ts, ts);
    const auth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };

    const detail = await request(app).get('/api/v1/community/threads/thread-author-owned').set(auth);
    expect(detail.body.unlocked).toBe(true);
    expect(detail.body.thread.body.length).toBeGreaterThan(10);
    expect(detail.body.thread.can_moderate).toBe(true);

    const list = await request(app).get('/api/v1/community/threads?board=paid').set(auth);
    const item = list.body.items.find((row: { id: string }) => row.id === 'thread-author-owned');
    expect(item.locked).toBe(false);

    const unlock = await request(app)
      .post('/api/v1/community/threads/thread-author-owned/unlock')
      .set(writeHeaders(auth))
      .send({});
    expect(unlock.status).toBe(200);
    expect(unlock.body.via).toBe('author');
    expect(unlock.body.charged_cents).toBe(0);
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ?', 'thread-author-owned')).toBe(0);
  });
});
