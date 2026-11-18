/** 卡密删除：物理清除语义、已兑换保护与审计留痕 */

import { beforeEach, describe, expect, it } from 'vitest'; // 用例编排 API，每例重建内存库
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 仅类型引用
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 与 createApp 注入的引导令牌一致
const ADMIN_HEADERS = { 'x-admin-token': ADMIN_TOKEN }; // 超管引导通道请求头

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库句柄

beforeEach(() => {
  db = createDatabase(':memory:'); // 每例全新内存库，避免卡密与审计行互相污染
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 注入引导令牌
});

/** 直接插入一张卡密：status 取 unused / used，voided 控制是否已作废 */
function insertCard(code: string, status: 'unused' | 'used', voided = false): void {
  const now = new Date().toISOString(); // 统一时间戳
  db.prepare(
    `INSERT INTO wallet_cards (id, code, amount_cents, status, used_by, used_at, voided_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `card-${code}`, // 主键与码一一对应，便于断言
    code, // 卡密原文
    status === 'used' ? 500 : 100, // 面额：已兑换 5 元、未使用 1 元
    status, // 状态
    status === 'used' ? 'u-1' : null, // 兑换人仅已兑换行存在
    status === 'used' ? now : null, // 兑换时间
    voided ? now : null, // 作废时间
    now, // 生成时间
  );
} // insertCard 结束

describe('卡密物理删除', () => {
  it('未使用与已作废卡密可删除，并各写一条审计', async () => {
    insertCard('MIM-AAAAAAAAAA', 'unused'); // 未使用
    insertCard('MIM-BBBBBBBBBB', 'unused', true); // 已作废（生产探针场景）

    const first = await request(app).delete('/api/v1/admin/cards/MIM-AAAAAAAAAA').set(ADMIN_HEADERS);
    expect(first.status).toBe(200); // 未使用可直接删
    expect(first.body).toEqual({ code: 'MIM-AAAAAAAAAA', deleted: true }); // 明确删除成功

    const second = await request(app).delete('/api/v1/admin/cards/MIM-BBBBBBBBBB').set(ADMIN_HEADERS);
    expect(second.status).toBe(200); // 已作废也可删，用于清理探针记录

    const left = db.prepare("SELECT COUNT(*) AS n FROM wallet_cards WHERE code IN ('MIM-AAAAAAAAAA', 'MIM-BBBBBBBBBB')").get() as { n: number };
    expect(left.n).toBe(0); // 两张目标卡密均已物理清除（库内另有内置演示卡，故不按全表计数）

    const audits = db.prepare("SELECT target, payload, result FROM audit_logs WHERE action = 'card.delete' ORDER BY created_at").all() as Array<{ target: string; payload: string; result: string }>;
    expect(audits).toHaveLength(2); // 两次删除各留一条
    expect(audits.every((row) => row.result === 'success')).toBe(true); // 结果均为成功
    expect(audits[0].target).toBe('card:MIM-AAAAAAAAAA'); // 对象编码为 类型:主键
    expect(JSON.parse(audits[0].payload).amount_cents).toBe(100); // 记录删除前面额，便于追溯
    expect(JSON.parse(audits[1].payload).voided).toBe(true); // 记录删除前是否已作废
  });

  it('已兑换卡密拒绝删除，行保留且不写成功审计', async () => {
    insertCard('MIM-CCCCCCCCCC', 'used'); // 已兑换，代表真实入账

    const res = await request(app).delete('/api/v1/admin/cards/MIM-CCCCCCCCCC').set(ADMIN_HEADERS);
    expect(res.status).toBe(409); // 台账必须保留
    expect(res.body.code).toBe('CONFLICT');

    const left = db.prepare('SELECT used_by FROM wallet_cards WHERE code = ?').get('MIM-CCCCCCCCCC') as { used_by: string } | undefined;
    expect(left?.used_by).toBe('u-1'); // 行未被删除

    const audits = db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'card.delete'").get() as { n: number };
    expect(audits.n).toBe(0); // 校验在审计包装之前，不产生成功留痕
  });

  it('不存在的卡密返回 404，未鉴权返回 401', async () => {
    const missing = await request(app).delete('/api/v1/admin/cards/MIM-NOTFOUND1').set(ADMIN_HEADERS);
    expect(missing.status).toBe(404); // 明确不存在

    const anonymous = await request(app).delete('/api/v1/admin/cards/MIM-AAAAAAAAAA');
    expect(anonymous.status).toBe(401); // 后台写操作必须鉴权
  });
});
