/** 启动期清扫测试：过期验证码 / 题目 / 超期幂等键回收，重复执行幂等 */

import { describe, expect, it, beforeEach } from 'vitest'; // 引入依赖、类型或本地模块绑定
import { createDatabase } from '../src/db.js'; // 引入内存库工厂
import { sweepExpiredEphemeral } from '../src/housekeeping.js'; // 待测清扫函数
import type { Db } from '../src/types.js'; // 数据库连接类型

const NOW = new Date('2026-11-20T12:00:00.000Z'); // 固定时钟，便于构造过期 / 新鲜两批行
const PAST = '2026-11-20T11:00:00.000Z'; // 已过期时刻
const FUTURE = '2026-11-20T12:30:00.000Z'; // 尚未过期时刻
const OLD_KEY = '2026-11-18T12:00:00.000Z'; // 超过 24h 保留窗口 + 1h 宽限的幂等键
const RECENT_KEY = '2026-11-20T11:30:00.000Z'; // 窗口内的幂等键

let db: Db; // 跨用例复用的内存库连接

beforeEach(() => { // 每个用例独立建库，避免种子与残留行互相污染
  db = createDatabase(':memory:'); // 全新内存库：只校验清扫 SQL 与口径
});

describe('sweepExpiredEphemeral 过期易失数据清扫', () => { // 调用 describe 并处理当前业务步骤
  it('回收过期验证码 / 题目与超期幂等键，保留未过期与窗口内行', () => { // 用例：过期回收、新鲜保留
    db.prepare(`INSERT INTO verification_codes (id, region, provider, identifier, code_hash, attempts, consumed_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`).run('code-expired', '86', 'sms', '13920000001', 'hash-expired', PAST, PAST);
    db.prepare(`INSERT INTO verification_codes (id, region, provider, identifier, code_hash, attempts, consumed_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`).run('code-fresh', '86', 'sms', '13920000002', 'hash-fresh', FUTURE, NOW.toISOString());
    db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run('cap-expired', 'hash-cap-expired', PAST, PAST);
    db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run('cap-fresh', 'hash-cap-fresh', FUTURE, NOW.toISOString());
    db.prepare(`INSERT INTO idempotency_keys (key, user_id, method, path, request_hash, response_status, response_body, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`).run('key-old', 'user-1', 'POST', '/api/v1/orders', 'req-old', OLD_KEY);
    db.prepare(`INSERT INTO idempotency_keys (key, user_id, method, path, request_hash, response_status, response_body, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`).run('key-recent', 'user-1', 'POST', '/api/v1/orders', 'req-recent', RECENT_KEY);

    const result = sweepExpiredEphemeral(db, NOW); // 注入固定时钟执行一轮清扫

    expect(result.verificationCodes).toBe(1); // 过期验证码回收 1 行
    expect(result.captchas).toBe(1); // 过期题目回收 1 行
    expect(result.idempotencyKeys).toBe(1); // 超期幂等键回收 1 行

    const countCodes = db.prepare('SELECT COUNT(*) AS n FROM verification_codes').get() as { n: number };
    const countCaps = db.prepare('SELECT COUNT(*) AS n FROM captchas').get() as { n: number };
    const countKeys = db.prepare('SELECT COUNT(*) AS n FROM idempotency_keys').get() as { n: number };
    expect(countCodes.n).toBe(1); // 仅新鲜验证码保留
    expect(countCaps.n).toBe(1); // 仅新鲜题目保留
    expect(countKeys.n).toBe(1); // 仅窗口内幂等键保留
    expect(db.prepare('SELECT id FROM verification_codes WHERE id = ?').get('code-fresh')).toBeTruthy();
    expect(db.prepare('SELECT id FROM captchas WHERE id = ?').get('cap-fresh')).toBeTruthy();
    expect(db.prepare('SELECT key FROM idempotency_keys WHERE key = ?').get('key-recent')).toBeTruthy();
  });

  it('重复执行幂等：第二轮清扫命中 0 行，保留行不被误删', () => { // 用例：可重复执行、无副作用
    db.prepare(`INSERT INTO verification_codes (id, region, provider, identifier, code_hash, attempts, consumed_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`).run('code-expired', '86', 'sms', '13920000003', 'hash-expired', PAST, PAST);
    db.prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)').run('cap-expired', 'hash-cap-expired', PAST, PAST);
    db.prepare(`INSERT INTO idempotency_keys (key, user_id, method, path, request_hash, response_status, response_body, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`).run('key-old', 'user-2', 'POST', '/api/v1/orders', 'req-old', OLD_KEY);

    const first = sweepExpiredEphemeral(db, NOW); // 第一轮：回收过期行
    expect(first.verificationCodes + first.captchas + first.idempotencyKeys).toBe(3);

    const second = sweepExpiredEphemeral(db, NOW); // 第二轮：库内已无过期行
    expect(second.verificationCodes).toBe(0);
    expect(second.captchas).toBe(0);
    expect(second.idempotencyKeys).toBe(0);

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM verification_codes').get() as { n: number };
    expect(remaining.n).toBe(0); // 无新鲜行场景：两轮后验证码表为空，且第二轮不报错
  });
});
