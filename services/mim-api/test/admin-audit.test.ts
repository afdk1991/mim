/** 审计留痕测试：写入语义（脱敏 / 结果 / 对象）与后台查询筛选 */

import { beforeEach, describe, expect, it } from 'vitest'; // 用例编排 API，每例重建内存库
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 仅类型引用
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { writeAudit } from '../src/audit.js'; // 被直接断言的审计写入口

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 与 createApp 注入的引导令牌一致
const ADMIN_HEADERS = { 'x-admin-token': ADMIN_TOKEN }; // 超管引导通道请求头

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库句柄

beforeEach(() => {
  db = createDatabase(':memory:'); // 每例全新内存库，避免审计行互相污染
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 注入引导令牌
});

describe('后台敏感操作写入审计', () => {
  it('建号 / 授予角色 / 重置口令 各留一条 success，且明文口令不落库', async () => {
    const created = await request(app).post('/api/v1/admin/users').set(ADMIN_HEADERS).send({
      region: 'cn',
      provider: 'phone',
      identifier: '13700000301',
      password: 'Admin-pass-1',
      role_codes: ['viewer'],
    });
    expect(created.status).toBe(201); // 建号成功
    const userId = created.body.user.id as string; // 后续操作的目标用户

    const granted = await request(app).post(`/api/v1/admin/users/${userId}/roles`).set(ADMIN_HEADERS).send({ role_code: 'operator' });
    expect(granted.status).toBe(201); // 首次授予

    const reset = await request(app).post(`/api/v1/admin/users/${userId}/password`).set(ADMIN_HEADERS).send({ password: 'Admin-pass-2' });
    expect(reset.status).toBe(200); // 重置成功

    const list = await request(app).get('/api/v1/admin/audit-logs').set(ADMIN_HEADERS).query({ target_type: 'user', target_id: userId });
    expect(list.status).toBe(200); // 查询可用
    expect(list.body.total).toBe(3); // 三条操作各一行
    expect(list.body.items.map((item: { action: string }) => item.action)).toEqual(
      expect.arrayContaining(['admin.user.create', 'admin.user.role_grant', 'admin.user.reset_password']),
    ); // 动作码齐全
    expect(list.body.items.every((item: { result: string }) => item.result === 'success')).toBe(true); // 结果均为成功

    const payloads = (db.prepare('SELECT payload FROM audit_logs').all() as Array<{ payload: string }>).map((row) => row.payload).join('\n');
    expect(payloads).not.toContain('Admin-pass-1'); // 初始口令不入审计
    expect(payloads).not.toContain('Admin-pass-2'); // 新口令不入审计
    expect(payloads).not.toContain('13700000301'); // 登录标识（手机号）不入审计
  });

  it('失败动作记 result=failure 并带稳定错误码', async () => {
    const created = await request(app).post('/api/v1/admin/users').set(ADMIN_HEADERS).send({
      region: 'cn',
      provider: 'phone',
      identifier: '13700000302',
      password: 'Admin-pass-3',
      role_codes: ['viewer'],
    });
    const userId = created.body.user.id as string; // 建号即带 viewer 角色
    const first = await request(app).delete(`/api/v1/admin/users/${userId}/roles/viewer`).set(ADMIN_HEADERS);
    expect(first.status).toBe(200); // 首次回收成功
    const again = await request(app).delete(`/api/v1/admin/users/${userId}/roles/viewer`).set(ADMIN_HEADERS);
    expect(again.status).toBe(404); // 授权已不存在，包装层内抛错

    const failed = db.prepare("SELECT result, payload FROM audit_logs WHERE action = 'admin.user.role_revoke' AND result = 'failure'").get() as { result: string; payload: string };
    expect(failed.result).toBe('failure'); // 失败结果
    expect(JSON.parse(failed.payload).error_code).toBe('NOT_FOUND'); // 只记错误码，不记入参
  });
});

describe('审计字段口径与查询筛选', () => {
  const actor = { id: 'admin-1', region: 'cn', ip: '10.0.0.1', requestId: 'req-1' }; // 固定操作人快照

  it('敏感键统一脱敏，对象编码为 `类型:主键`', () => {
    writeAudit(db, actor, {
      action: 'test.redact',
      targetType: 'user',
      targetId: 'u-1',
      detail: {
        password: 'plain', // 口令
        access_token: 'tk', // 令牌
        id_number: '110101199001011234', // 证件号
        account_no: '6222020000000000', // 提现账号
        note: 'ok', // 普通明细应保留
        nested: { secret: 's' }, // 嵌套敏感键
      },
    });
    const row = db.prepare('SELECT * FROM audit_logs').get() as { payload: string; result: string; target: string };
    const payload = JSON.parse(row.payload);
    expect(payload.password).toBe('[REDACTED]'); // 口令脱敏
    expect(payload.access_token).toBe('[REDACTED]'); // 令牌脱敏
    expect(payload.id_number).toBe('[REDACTED]'); // 证件号脱敏
    expect(payload.account_no).toBe('[REDACTED]'); // 提现账号脱敏
    expect(payload.nested.secret).toBe('[REDACTED]'); // 嵌套敏感键同样处理
    expect(payload.note).toBe('ok'); // 非敏感明细原样保留
    expect(payload._ip).toBe('10.0.0.1'); // 来源 IP 记在保留键
    expect(row.result).toBe('success'); // 缺省成功
    expect(row.target).toBe('user:u-1'); // 对象编码
  });

  it('按 result / action 筛选，非法 result 返回 400', async () => {
    writeAudit(db, actor, { action: 'plan.create', targetType: 'plan', targetId: 'p1' });
    writeAudit(db, actor, { action: 'plan.delete', targetType: 'plan', targetId: 'p1', result: 'failure' });

    const failed = await request(app).get('/api/v1/admin/audit-logs').set(ADMIN_HEADERS).query({ result: 'failure' });
    expect(failed.body.total).toBe(1); // 只命中失败行
    expect(failed.body.items[0].action).toBe('plan.delete'); // 动作码正确

    const byAction = await request(app).get('/api/v1/admin/audit-logs').set(ADMIN_HEADERS).query({ action: 'plan.create' });
    expect(byAction.body.total).toBe(1); // 动作精确匹配
    expect(byAction.body.items[0].target_type).toBe('plan'); // 对象类型拆列

    const bad = await request(app).get('/api/v1/admin/audit-logs').set(ADMIN_HEADERS).query({ result: 'nope' });
    expect(bad.status).toBe(400); // 非法枚举值拒绝
  });

  it('未鉴权访问审计流水返回 401', async () => {
    const res = await request(app).get('/api/v1/admin/audit-logs');
    expect(res.status).toBe(401); // 后台数据不公开
  });
});
