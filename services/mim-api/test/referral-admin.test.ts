/**
 * 返佣结算管理端点契约测试（批次 6 · P1-4）。
 *
 * 覆盖 POST /admin/referrals/settle：
 *   - 匿名 401 / 已登录无 commerce:write 权限 403 / 引导令牌 200；
 *   - 到期 pending 佣金批量入账；重复调用幂等，不二次入账；
 *   - 每次结算动作写 referral.settle 审计行。
 *
 * 保护期置 0，佣金 accrual 后立即可结算；复用 _auth-helper 与既有 withdrawal 测试同款装配。
 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排 API
import request from 'supertest'; // supertest 进程内驱动 Express
import type { Express } from 'express'; // 仅引入类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import type { ApiDeps, Db } from '../src/types.js'; // 依赖与数据库类型
import { registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录
import { accrueCommission } from '../src/commerce/referral-settlement.js'; // 佣金计提链路

const JWT_SECRET = 'referral-admin-test-secret-0123456789abcd'; // 固定测试密钥
const ADMIN_TOKEN = 'referral-admin-token'; // 引导令牌固定值

/** 测试环境：保护期 0 天，佣金计提后立即进入可结算候选 */
const TEST_ENV: Record<string, string> = {
  MIM_ADMIN_TOKEN: ADMIN_TOKEN, // 开启引导超管通道
  MIM_REFERRAL_PROTECT_DAYS: '0', // 保护期置 0，避免用例等待真实时间
};

let db: Db; // 内存库
let deps: ApiDeps; // 依赖容器（服务层计提佣金用）
let app: Express; // 待测应用

/** 引导通道请求头 */
function adminHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' };
}

/** 按动作码回读审计流水 */
function auditRows(action: string): Array<{ action: string; target: string | null; result: string }> {
  return db.prepare('SELECT action, target, result FROM audit_logs WHERE action = ?').all(action) as
    Array<{ action: string; target: string | null; result: string }>;
}

/** 读取指定邀请人钱包两个口径 */
function walletOf(userId: string): { balance_cents: number; withdrawable_cents: number } {
  const row = db.prepare('SELECT balance_cents, withdrawable_cents FROM wallets WHERE user_id = ?').get(userId) as
    | { balance_cents: number; withdrawable_cents: number }
    | undefined;
  return row ?? { balance_cents: 0, withdrawable_cents: 0 };
}

beforeEach(() => { // 每例前置：重建内存库与依赖容器
  db = createDatabase(':memory:'); // 全新内存库
  deps = { db, jwtSecret: JWT_SECRET, env: TEST_ENV }; // 复用同一依赖
  app = createApp(deps); // 真实 Express 应用
});

describe('POST /admin/referrals/settle 鉴权矩阵', () => {
  it('匿名 → 401 AUTH_UNAUTHORIZED，不写审计', async () => {
    const res = await request(app).post('/api/v1/admin/referrals/settle'); // 无令牌
    expect(res.status).toBe(401); // 未登录 401
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
    expect(auditRows('referral.settle')).toHaveLength(0); // 未过鉴权不留痕
  });

  it('已登录但无 commerce:write 权限 → 403 FORBIDDEN', async () => {
    const { token } = await registerTestAccount(app, '13922000001'); // 普通账号，无后台角色
    const res = await request(app).post('/api/v1/admin/referrals/settle').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403); // 权限不足 403
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('引导令牌空库结算 → 200，settled=0、total_cents=0，写一条成功审计', async () => {
    const res = await request(app).post('/api/v1/admin/referrals/settle').set(adminHeaders());
    expect(res.status).toBe(200); // 超管放行
    expect(res.body.ok).toBe(true);
    expect(res.body.settled).toBe(0); // 无到期佣金
    expect(res.body.total_cents).toBe(0);

    const audits = auditRows('referral.settle');
    expect(audits).toHaveLength(1); // 空结算同样留痕，便于审计追溯「跑过一轮空批次」
    expect(audits[0].result).toBe('success');
    expect(audits[0].target).toBe('referral_settle:batch');
  });
});

describe('POST /admin/referrals/settle 结算结果与幂等', () => {
  it('到期佣金入账；重复调用不二次入账，余额不翻倍', async () => {
    const inviter = await registerTestAccount(app, '13922000002'); // 邀请人
    const invitee = await registerTestAccount(app, '13922000003'); // 被邀请人
    db.prepare('INSERT INTO referrals (id, inviter_id, invitee_id, code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ref-test-1', inviter.userId, invitee.userId, 'INVITE02', 'bound', new Date().toISOString());

    const accrued = accrueCommission(deps, { inviteeId: invitee.userId, orderId: 'order-settle-1', payableCents: 10000 });
    expect(accrued.accrued).toBe(1); // 计提一条一级佣金，缺省 5% = 500 分
    expect(accrued.commissions[0]?.amountCents).toBe(500);

    const first = await request(app).post('/api/v1/admin/referrals/settle').set(adminHeaders());
    expect(first.status).toBe(200);
    expect(first.body.settled).toBe(1); // 本轮结算 1 条
    expect(first.body.total_cents).toBe(500); // 入账 500 分
    const walletAfterFirst = walletOf(inviter.userId);
    expect(walletAfterFirst.balance_cents).toBe(500); // 佣金进余额
    expect(walletAfterFirst.withdrawable_cents).toBe(500); // 佣金属于可提现收入

    const second = await request(app).post('/api/v1/admin/referrals/settle').set(adminHeaders());
    expect(second.status).toBe(200);
    expect(second.body.settled).toBe(0); // 条件 UPDATE 抢占，重复调用落空
    expect(second.body.total_cents).toBe(0); // 不二次入账
    const walletAfterSecond = walletOf(inviter.userId);
    expect(walletAfterSecond.balance_cents).toBe(500); // 余额不翻倍
    expect(walletAfterSecond.withdrawable_cents).toBe(500);

    const audits = auditRows('referral.settle');
    expect(audits).toHaveLength(2); // 两次结算各留一条审计
    expect(audits.every((row) => row.result === 'success')).toBe(true);
  });
});
