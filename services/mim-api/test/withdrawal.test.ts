/**
 * 提现分成（钱包结算层）契约测试。
 *
 * 覆盖用户三条硬约束：
 *   1) 口径分离：充值余额不可提现，佣金 / 创作分成才累积 withdrawable_cents；
 *   2) 金额一律整数分：浮点、负数、低于下限一律 400，不产生浮点误差；
 *   3) 幂等与并发保护：同键回放、不同键重复提交 409、重复审核不二次出账。
 * 外加状态机：pending → approved → paid、approved → rejected 原路退款、用户撤销。
 *
 * 每个用例重建内存 SQLite；写请求统一带独立幂等键。
 */

import { randomUUID } from 'node:crypto'; // 幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // 测试编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import type { ApiDeps, Db } from '../src/types.js'; // 依赖与数据库类型
import { registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录
import { accrueCommission, settleDueCommissions } from '../src/commerce/referral-settlement.js'; // 佣金链路
import { settleCreatorEarnings } from '../src/commerce/withdrawal.js'; // 创作分成结算

const JWT_SECRET = 'withdraw-test-secret-0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'withdraw-admin-token'; // 后台引导令牌

/** 测试环境：保护期置 0，佣金立即可结算，避免用例等待真实时间 */
const TEST_ENV: Record<string, string> = {
  MIM_ADMIN_TOKEN: ADMIN_TOKEN,
  MIM_REFERRAL_PROTECT_DAYS: '0',
};

let db: Db; // 内存库
let deps: ApiDeps; // 依赖容器（服务层直调用）
let app: Express; // 待测应用

beforeEach(() => {
  db = createDatabase(':memory:'); // 每例全新库
  deps = { db, jwtSecret: JWT_SECRET, env: TEST_ENV }; // 复用同一依赖
  app = createApp(deps); // 真实 Express 应用
});

/** 写请求头：登录态 + 幂等键 */
function writeHeaders(token: string, key: string = randomUUID()): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key };
}

/** 后台写请求头：引导令牌 + 幂等键 */
function adminHeaders(key: string = randomUUID()): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json', 'idempotency-key': key };
}

/** 直接造钱包余额与可提现额度，绕过充值 / 佣金链路 */
function setWallet(userId: string, balanceCents: number, withdrawableCents: number): void {
  db.prepare(
    `INSERT INTO wallets (user_id, balance_cents, withdrawable_cents, points, updated_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       balance_cents = excluded.balance_cents,
       withdrawable_cents = excluded.withdrawable_cents,
       updated_at = excluded.updated_at`,
  ).run(userId, balanceCents, withdrawableCents, new Date().toISOString());
}

/** 读取钱包两个口径 */
function walletOf(userId: string): { balance_cents: number; withdrawable_cents: number } {
  const row = db.prepare('SELECT balance_cents, withdrawable_cents FROM wallets WHERE user_id = ?').get(userId) as
    | { balance_cents: number; withdrawable_cents: number }
    | undefined;
  return row ?? { balance_cents: 0, withdrawable_cents: 0 };
}

/** 统计某类流水条数 */
function countTx(userId: string, kind: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM wallet_transactions WHERE user_id = ? AND kind = ?').get(userId, kind) as {
    total: number;
  };
  return row.total;
}

/** 提交提现申请的「合法最小请求体」 */
function payload(amountCents = 2000): Record<string, unknown> {
  return { amount_cents: amountCents, method: 'alipay', account_name: '张三', account_no: 'zhangsan@example.com' };
}

describe('可提现口径：充值余额与分成收益分开核算', () => {
  it('充值余额不计入可提现：快照 withdrawable=0，申请直接被拒', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000001');
    setWallet(userId, 5000, 0); // 5000 分全部是充值余额

    const overview = await request(app).get('/api/v1/wallet/withdrawals').set('Authorization', `Bearer ${token}`);
    expect(overview.status).toBe(200);
    expect(overview.body.balance_cents).toBe(5000);
    expect(overview.body.withdrawable_cents).toBe(0);
    expect(overview.body.available_cents).toBe(0);

    const apply = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(2000));
    expect(apply.status).toBe(400);
    expect(apply.body.details?.reason ?? apply.body.reason).toBe('INSUFFICIENT_WITHDRAWABLE');
  });

  it('推广佣金结算后同时累加余额与可提现余额', async () => {
    const inviter = await registerTestAccount(app, '13910000002');
    const invitee = await registerTestAccount(app, '13910000003');
    db.prepare('INSERT INTO referrals (id, inviter_id, invitee_id, code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'ref-test-1',
      inviter.userId,
      invitee.userId,
      'INVITE01',
      'bound',
      new Date().toISOString(),
    );

    const accrued = accrueCommission(deps, { inviteeId: invitee.userId, orderId: 'order-1', payableCents: 10000 });
    expect(accrued.accrued).toBe(1);
    expect(accrued.commissions[0]?.amountCents).toBe(500); // 缺省 5%

    const settled = settleDueCommissions(deps);
    expect(settled.settled).toBe(1);
    expect(settled.totalCents).toBe(500);

    const wallet = walletOf(inviter.userId);
    expect(wallet.balance_cents).toBe(500);
    expect(wallet.withdrawable_cents).toBe(500); // 佣金属于可提现收入
  });

  it('创作分成结算后进入可提现余额；重复调用不二次入账', async () => {
    const { userId } = await registerTestAccount(app, '13910000004');
    // 造一笔保护期早已结束的待结算分成
    db.prepare(
      `INSERT INTO creator_earnings (id, user_id, source_type, source_id, gross_cents, platform_fee_cents, net_cents, status, created_at)
       VALUES (?, ?, 'paid_asset', ?, ?, ?, ?, 'pending', ?)`,
    ).run('ce-test-1', userId, 'asset-1', 1000, 300, 700, '2020-01-01T00:00:00.000Z');

    const first = settleCreatorEarnings(deps);
    expect(first.settled).toBe(1);
    expect(first.totalCents).toBe(700);
    const wallet = walletOf(userId);
    expect(wallet.balance_cents).toBe(700);
    expect(wallet.withdrawable_cents).toBe(700);

    const second = settleCreatorEarnings(deps);
    expect(second.settled).toBe(0); // 条件 UPDATE 抢占，重复结算落空
    expect(walletOf(userId).withdrawable_cents).toBe(700);
  });

  it('余额被消费后，可提现值读取时夹紧到余额，不会超过真实余额', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000005');
    setWallet(userId, 300, 5000); // 模拟历史消费吃掉余额但可提现列未同步
    const overview = await request(app).get('/api/v1/wallet/withdrawals').set('Authorization', `Bearer ${token}`);
    expect(overview.status).toBe(200);
    expect(overview.body.withdrawable_cents).toBe(300); // min(withdrawable, balance)
    expect(overview.body.available_cents).toBe(300);
  });
});

describe('申请流程：整数分、幂等、状态机与不重复出账', () => {
  it('金额必须是正整数分：浮点 / 负数 / 低于下限一律 400', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000006');
    setWallet(userId, 10000, 10000);

    const float = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(1000.5));
    expect(float.status).toBe(400);

    const negative = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(-2000));
    expect(negative.status).toBe(400);

    const belowMin = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(999));
    expect(belowMin.status).toBe(400);
    expect(belowMin.body.details?.reason ?? belowMin.body.reason).toBe('BELOW_MINIMUM');

    // 三次失败都没有落库
    const rows = db.prepare('SELECT COUNT(*) AS total FROM withdrawal_requests').get() as { total: number };
    expect(rows.total).toBe(0);
  });

  it('同幂等键重复提交回放首次响应，不产生第二笔申请', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000007');
    setWallet(userId, 10000, 10000);
    const key = randomUUID();

    const first = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token, key)).send(payload(2000));
    expect(first.status).toBe(201);
    const replay = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token, key)).send(payload(2000));
    expect(replay.status).toBe(201);
    expect(replay.body.request.id).toBe(first.body.request.id);

    const rows = db.prepare('SELECT COUNT(*) AS total FROM withdrawal_requests').get() as { total: number };
    expect(rows.total).toBe(1);
  });

  it('不同幂等键重复提交被「单用户单笔处理中」唯一索引挡下（409）', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000008');
    setWallet(userId, 10000, 10000);

    const first = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(2000));
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(3000));
    expect(second.status).toBe(409);
  });

  it('审核通过只扣一次款：余额与可提现同步减少，重复审核 409 且无二次流水', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000009');
    setWallet(userId, 5000, 5000);

    const apply = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(2000));
    expect(apply.status).toBe(201);
    const id = apply.body.request.id as string;

    // 申请阶段只冻结，不动余额
    expect(walletOf(userId).balance_cents).toBe(5000);
    const overview = await request(app).get('/api/v1/wallet/withdrawals').set('Authorization', `Bearer ${token}`);
    expect(overview.body.reserved_cents).toBe(2000);
    expect(overview.body.available_cents).toBe(3000);

    const approve = await request(app).post(`/api/v1/admin/withdrawals/${id}/approve`).set(adminHeaders()).send({ note: '资料齐全' });
    expect(approve.status).toBe(200);
    expect(approve.body.request.status).toBe('approved');
    expect(walletOf(userId)).toEqual({ balance_cents: 3000, withdrawable_cents: 3000 });
    expect(countTx(userId, 'withdraw')).toBe(1);

    const again = await request(app).post(`/api/v1/admin/withdrawals/${id}/approve`).set(adminHeaders()).send({});
    expect(again.status).toBe(409); // 状态机条件 UPDATE 已挡下
    expect(walletOf(userId)).toEqual({ balance_cents: 3000, withdrawable_cents: 3000 }); // 未被二次扣款
    expect(countTx(userId, 'withdraw')).toBe(1);
  });

  it('后台标记到账后不再动账，队列与统计可读', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000010');
    setWallet(userId, 5000, 5000);
    const apply = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(2000));
    const id = apply.body.request.id as string;
    await request(app).post(`/api/v1/admin/withdrawals/${id}/approve`).set(adminHeaders()).send({});

    const queue = await request(app).get('/api/v1/admin/withdrawals?status=approved').set('x-admin-token', ADMIN_TOKEN);
    expect(queue.status).toBe(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0].display_name).toBeTruthy(); // JOIN users 带出展示名
    expect(queue.body.summary.approved).toBe(1);

    const paid = await request(app).post(`/api/v1/admin/withdrawals/${id}/paid`).set(adminHeaders()).send({ payout_ref: 'ALI-20261115-0001' });
    expect(paid.status).toBe(200);
    expect(paid.body.request.status).toBe('paid');
    expect(paid.body.request.payout_ref).toBe('ALI-20261115-0001');
    expect(walletOf(userId)).toEqual({ balance_cents: 3000, withdrawable_cents: 3000 }); // 到账不再动账
  });

  it('已通过后驳回：余额与可提现原路退回，并写 refund 流水', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000011');
    setWallet(userId, 5000, 5000);
    const apply = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(2000));
    const id = apply.body.request.id as string;
    await request(app).post(`/api/v1/admin/withdrawals/${id}/approve`).set(adminHeaders()).send({});
    expect(walletOf(userId)).toEqual({ balance_cents: 3000, withdrawable_cents: 3000 });

    const reject = await request(app).post(`/api/v1/admin/withdrawals/${id}/reject`).set(adminHeaders()).send({ reason: '收款账号与实名不一致' });
    expect(reject.status).toBe(200);
    expect(reject.body.request.status).toBe('rejected');
    expect(walletOf(userId)).toEqual({ balance_cents: 5000, withdrawable_cents: 5000 }); // 原路退回
    expect(countTx(userId, 'refund')).toBe(1);

    // 重复驳回无效，不会二次退款
    const again = await request(app).post(`/api/v1/admin/withdrawals/${id}/reject`).set(adminHeaders()).send({ reason: '重复驳回' });
    expect(again.status).toBe(409);
    expect(walletOf(userId)).toEqual({ balance_cents: 5000, withdrawable_cents: 5000 });
  });

  it('用户可撤销 pending 申请并释放冻结额度，撤销后不可再审核', async () => {
    const { token, userId } = await registerTestAccount(app, '13910000012');
    setWallet(userId, 5000, 5000);
    const apply = await request(app).post('/api/v1/wallet/withdrawals').set(writeHeaders(token)).send(payload(2000));
    const id = apply.body.request.id as string;

    const cancel = await request(app).post(`/api/v1/wallet/withdrawals/${id}/cancel`).set(writeHeaders(token)).send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.request.status).toBe('cancelled');
    const overview = await request(app).get('/api/v1/wallet/withdrawals').set('Authorization', `Bearer ${token}`);
    expect(overview.body.reserved_cents).toBe(0); // 冻结额度已释放

    const approve = await request(app).post(`/api/v1/admin/withdrawals/${id}/approve`).set(adminHeaders()).send({});
    expect(approve.status).toBe(409);
    expect(walletOf(userId)).toEqual({ balance_cents: 5000, withdrawable_cents: 5000 });
  });
});
