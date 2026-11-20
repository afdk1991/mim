/** 契约测试：付费阅读（社区帖子层）——未购不可读 / 购买永久 / 重复不扣费 / 统一交易域入账 */

// 引入随机 UUID：为写操作生成幂等键，避免重复提交被中间件拦截
import { randomUUID } from 'node:crypto'; // 写操作幂等键
// 引入 vitest 套件与断言：组织用例、冻结前后置与结果比对
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
// 引入 supertest：对 mini 应用发起真实 HTTP 调用并断言响应
import request from 'supertest'; // 真实 HTTP 调用
// 引入 Express 应用类型：约束 app 句柄类型
import type { Express } from 'express'; // 应用类型
// 引入被测应用工厂：装配路由、中间件与错误信封
import { createApp } from '../src/app.js'; // 被测应用
// 引入建库函数：创建内存库并执行种子，避免依赖真实数据库
import { createDatabase } from '../src/db.js'; // 内存库 + 种子
// 引入统一交易域回填：验证历史购买记录补单幂等性
import { backfillUnifiedCommerce } from '../src/commerce/unified.js'; // 回填幂等验证
// 引入鉴权辅助：注册测试账号与口令登录拿鉴权头
import { loginHeaders, registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const THREAD = 'thread-paid-store'; // 种子付费帖：board-paid，单价 1900
const PRICE = 1900; // 与种子一致

let app: Express; // 应用句柄
let db: ReturnType<typeof createDatabase>; // 直接查库核对落单字段

// 每个用例前重建内存库与应用：用例之间数据互不污染
beforeEach(() => {
  db = createDatabase(':memory:'); // 全新内存库，自带社区与商城种子
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 装配完整应用，环境变量留空走缺省
});

/** 写操作需要幂等键，避免重复提交被中间件拦截 */
function writeHeaders(auth: Record<string, string>): Record<string, string> {
  // 在鉴权头基础上附加一次一换的幂等键
  return { ...auth, 'idempotency-key': randomUUID() };
}

/** 统计某张表里与付费帖相关的行数 */
function countRows(sql: string, ...args: unknown[]): number {
  // 预编译 SQL 并取 COUNT 结果，返回数值行计数
  return (db.prepare(sql).get(...args) as { n: number }).n;
}

describe('付费阅读（社区帖子层）', () => {
  it('未购买：详情隐藏正文与回复、列表标锁、回复被 403 拒绝', async () => {
    // 注册并登录一个未购买该帖的普通用户
    const auth = await loginHeaders(app, '13800000101');

    // 请求付费帖详情：未购视角应被付费墙裁剪
    const detail = await request(app).get(`/api/v1/community/threads/${THREAD}`).set(auth);
    expect(detail.status).toBe(200); // 详情接口本身可达，只是内容被锁定
    expect(detail.body.unlocked).toBe(false); // 未解锁标记为假
    expect(detail.body.thread.body).toBe(''); // 正文不下发，空串兜底
    expect(detail.body.thread.locked).toBe(true); // 帖子锁定标记为真
    expect(detail.body.thread.media).toHaveLength(0); // 锁定媒体不下发 url，列表为空
    expect(detail.body.posts).toHaveLength(0); // 回复列表同样不下发

    // 拉取付费板块列表：未购条目应带锁定标记
    const list = await request(app).get('/api/v1/community/threads?board=paid').set(auth);
    const item = list.body.items.find((row: { id: string }) => row.id === THREAD); // 定位目标帖条目
    expect(item.locked).toBe(true); // 列表条目同样标锁

    // 未购直接尝试回复：应被门禁拦截
    const reply = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/reply`)
      .set(writeHeaders(auth))
      .send({ content: '没买就想回复' });
    expect(reply.status).toBe(403); // 无权限回复锁定帖，返回禁止访问
  });

  it('余额不足：明确拒绝且不产生购买记录与统一订单', async () => {
    // 注册并登录新用户，钱包余额为零
    const auth = await loginHeaders(app, '13800000102');

    // 尝试解锁付费帖：余额不足以支付单价
    const unlock = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(unlock.status).toBe(400); // 业务校验失败返回 400
    expect(unlock.body.details.reason).toBe('INSUFFICIENT_BALANCE'); // 错误码明确为余额不足
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ?', THREAD)).toBe(0); // 未落购买记录
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(0); // 未落统一订单
  });

  it('购买后永久可读：余额扣减一次，订单 / 明细 / 支付 / 履约同事务入统一交易域', async () => {
    // 注册并登录用户，准备通过演示卡密充值后购买
    const auth = await loginHeaders(app, '13800000103');

    // 兑换演示充值卡：入账 10000 分（¥100.00）
    const redeem = await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' });
    expect(redeem.status).toBe(200); // 兑换成功
    expect(redeem.body.amount_cents).toBe(10000); // 充值面额与演示卡一致

    // 发起解锁：从钱包余额扣款购买阅读权
    const unlock = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(unlock.status).toBe(200); // 购买成功
    expect(unlock.body.unlocked).toBe(true); // 解锁标记为真
    expect(unlock.body.charged_cents).toBe(PRICE); // 实扣金额等于帖单价

    // 再次拉详情：已购视角应可见完整正文
    const detail = await request(app).get(`/api/v1/community/threads/${THREAD}`).set(auth);
    expect(detail.body.unlocked).toBe(true); // 已购解锁
    expect(detail.body.thread.locked).toBe(false); // 帖子不再标锁
    expect(detail.body.thread.body.length).toBeGreaterThan(10); // 正文已下发且非空

    // 核对钱包余额与流水：扣减一次，流水备注为解锁付费帖
    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(10000 - PRICE); // 余额 = 充值额 - 帖单价
    expect(wallet.body.transactions[0].note).toBe('解锁付费帖'); // 最新一条消费流水备注一致

    // 统一交易域：订单来自 community 产线，金额与钱包扣减一致
    const orders = await request(app).get('/api/v1/commerce/orders?source=community').set(auth);
    expect(orders.status).toBe(200); // 订单列表可达
    expect(orders.body.items).toHaveLength(1); // 仅一笔社区订单
    const order = orders.body.items[0]; // 取出该笔订单
    expect(order.source).toBe('community'); // 产线标识为社区
    expect(order.status).toBe('paid'); // 订单状态为已支付
    expect(order.channel).toBe('wallet'); // 支付渠道为钱包余额
    expect(order.payable_cents).toBe(PRICE); // 应付金额等于帖单价
    expect(order.total_cents).toBe(PRICE); // 订单总额等于帖单价
    expect(order.items[0].product_id).toBe(THREAD); // 明细商品指向目标帖

    // 支付 / 履约 / 商品三类凭据同事务落库（不走第二套记账）
    expect(countRows("SELECT COUNT(*) AS n FROM payments WHERE provider = 'wallet' AND status = 'paid' AND amount_cents = ?", PRICE)).toBe(1); // 钱包支付凭据 1 条
    expect(countRows("SELECT COUNT(*) AS n FROM fulfillments WHERE kind = 'entitlement'")).toBe(1); // 权益履约凭据 1 条
    expect(countRows("SELECT COUNT(*) AS n FROM products WHERE id = ? AND kind = 'asset'", THREAD)).toBe(1); // 商品目录条目 1 条
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ? AND amount_cents = ?', THREAD, PRICE)).toBe(1); // 购买记录 1 条且金额一致

    // 订单汇总：已付 1 笔、应付合计等于帖单价
    const summary = await request(app).get('/api/v1/commerce/orders/summary').set(auth);
    expect(summary.body.summary.paid).toBe(1); // 已付笔数为 1
    expect(summary.body.summary.payable_cents).toBe(PRICE); // 应付合计等于帖单价
  });

  it('重复购买：直接放行、不重复扣费、不新增订单与明细', async () => {
    // 注册登录用户并完成一次解锁，作为重复购买对照
    const auth = await loginHeaders(app, '13800000104');
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 充值演示卡
    await request(app).post(`/api/v1/community/threads/${THREAD}/unlock`).set(writeHeaders(auth)).send({}); // 首次购买解锁

    // 再次请求解锁：已购权益应直接放行，不再扣款
    const again = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(again.status).toBe(200); // 放行返回成功
    expect(again.body.via).toBe('owned'); // 放行来源为已有权益
    expect(again.body.charged_cents).toBe(0); // 本次扣费为零

    // 核对钱包与各表行数：重复购买不新增任何记录
    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(10000 - PRICE); // 余额仍只扣首次单价
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ?', THREAD)).toBe(1); // 购买记录仍 1 条
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(1); // 订单仍 1 笔
    expect(countRows('SELECT COUNT(*) AS n FROM order_items')).toBe(1); // 明细仍 1 条
    expect(countRows("SELECT COUNT(*) AS n FROM wallet_transactions WHERE kind = 'consume' AND ref_type = 'community_thread'")).toBe(1); // 消费流水仍 1 条
  });

  it('调价后已购仍永久可读；启动回填可重复执行不重复落单', async () => {
    // 注册登录、充值并完成首次解锁
    const auth = await loginHeaders(app, '13800000105');
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 充值演示卡
    await request(app).post(`/api/v1/community/threads/${THREAD}/unlock`).set(writeHeaders(auth)).send({}); // 首次购买

    // 直改库把帖单价上调：模拟商品调价场景
    db.prepare('UPDATE community_threads SET price_cents = 4900 WHERE id = ?').run(THREAD);

    // 已购视角再次读详情：调价不影响既有权益
    const detail = await request(app).get(`/api/v1/community/threads/${THREAD}`).set(auth);
    expect(detail.body.unlocked).toBe(true); // 仍然解锁
    expect(detail.body.thread.body.length).toBeGreaterThan(10); // 正文仍完整下发
    expect(detail.body.thread.locked).toBe(false); // 不再标锁

    // 再次解锁：仍走已有权益放行，零扣费
    const again = await request(app)
      .post(`/api/v1/community/threads/${THREAD}/unlock`)
      .set(writeHeaders(auth))
      .send({});
    expect(again.body.via).toBe('owned'); // 放行来源为已有权益
    expect(again.body.charged_cents).toBe(0); // 不按新价补扣差价

    // 历史数据：直写一条 community_purchases 模拟迁移前的旧记录，回填必须为它补出统一订单
    const legacy = await registerTestAccount(app, '13800000107');
    db.prepare(
      'INSERT INTO community_purchases (id, user_id, thread_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('cp_legacy_backfill', legacy.userId, THREAD, 1500, new Date().toISOString());

    const first = backfillUnifiedCommerce(db); // 首次回填：旧记录补单，已落单行不重复
    expect(first.orders).toBe(1); // 补出 1 笔统一订单
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE id = 'uo_community_cp_legacy_backfill'")).toBe(1); // 旧记录对应订单存在
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(2); // 加上先前首单共 2 笔社区订单

    const second = backfillUnifiedCommerce(db); // 再跑一次：全部命中幂等，零新增
    expect(second.orders).toBe(0); // 二次回填不新增订单
    expect(second.items).toBe(0); // 二次回填不新增明细
    expect(countRows("SELECT COUNT(*) AS n FROM orders WHERE source = 'community'")).toBe(2); // 订单总数保持 2 笔
  });

  it('作者本人：无需购买即可读正文，unlock 返回 author 且不落购买记录', async () => {
    // 注册作者账号并直写一条本人发布的付费帖
    const author = await registerTestAccount(app, '13800000106');
    const ts = new Date().toISOString(); // 统一创建 / 更新 / 活跃时间戳
    db.prepare(
      `INSERT INTO community_threads
         (id, board_id, author_id, title, summary, body, kind, price_cents, status, views, likes, reply_count, recommend_score, created_at, updated_at, last_activity_at)
       VALUES (?, 'board-paid', ?, ?, ?, ?, 'text', 2600, 'published', 0, 0, 0, 0, ?, ?, ?)`,
    ).run('thread-author-owned', author.userId, '作者自己的付费帖', '作者免购验证', '这是作者本人发布的付费正文，作者读取自己内容不应被付费墙拦截。', ts, ts, ts);
    // 组装作者鉴权头：直传令牌与 JSON 内容类型
    const auth = { authorization: `Bearer ${author.token}`, 'content-type': 'application/json' };

    // 作者拉自己帖子详情：应免购解锁且具备管理身份标记
    const detail = await request(app).get('/api/v1/community/threads/thread-author-owned').set(auth);
    expect(detail.body.unlocked).toBe(true); // 作者视角解锁
    expect(detail.body.thread.body.length).toBeGreaterThan(10); // 正文完整下发
    expect(detail.body.thread.can_moderate).toBe(true); // 作者可管理本帖

    // 列表视角：作者自己的帖不标锁
    const list = await request(app).get('/api/v1/community/threads?board=paid').set(auth);
    const item = list.body.items.find((row: { id: string }) => row.id === 'thread-author-owned'); // 定位作者条目
    expect(item.locked).toBe(false); // 作者条目不标锁

    // 作者主动调用解锁接口：返回 author 来源且零扣费、不落购买记录
    const unlock = await request(app)
      .post('/api/v1/community/threads/thread-author-owned/unlock')
      .set(writeHeaders(auth))
      .send({});
    expect(unlock.status).toBe(200); // 接口放行成功
    expect(unlock.body.via).toBe('author'); // 放行来源为作者本人
    expect(unlock.body.charged_cents).toBe(0); // 作者免扣费
    expect(countRows('SELECT COUNT(*) AS n FROM community_purchases WHERE thread_id = ?', 'thread-author-owned')).toBe(0); // 不落购买记录
  });
});
