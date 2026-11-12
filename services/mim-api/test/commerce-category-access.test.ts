/** 契约测试：商业化三期 · 分类级权限（deny 生效 / 未配置放行 / 用户级与角色级 / 一级前缀覆盖） */

import { randomUUID } from 'node:crypto'; // 写操作幂等键
import { beforeEach, describe, expect, it } from 'vitest'; // 测试编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 运营引导令牌

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 内存库句柄

interface Session { token: string; userId: string } // 登录会话

async function login(identifier: string): Promise<Session> {
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier }); // 构造：准备本用例需要的输入、句柄或期望值
  expect(codeRes.status).toBe(201); // 断言：校验响应字段与冻结契约一致
  const loginRes = await request(app).post('/api/v1/auth/login').send({ // 构造：准备本用例需要的输入、句柄或期望值
    region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' },
  });
  expect(loginRes.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string };
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function writeHeaders(token: string): Record<string, string> {
  return { ...authHeaders(token), 'idempotency-key': randomUUID() };
}

function adminHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' };
}

/** 后台整组写规则 */
async function putRule(subjectType: 'role' | 'user', subjectId: string, rules: Array<{ category_slug: string; effect: 'allow' | 'deny' }>) {
  return request(app).put('/api/v1/admin/category-access').set(adminHeaders()).send({ subject_type: subjectType, subject_id: subjectId, rules }); // 返回：交回本步骤结果供断言使用
}

/** 列表中是否含某模块码 */
async function listCodes(token: string | null): Promise<string[]> {
  const req = request(app).get('/api/v1/modules?region=cn'); // 构造：准备本用例需要的输入、句柄或期望值
  const res = token ? await req.set(authHeaders(token)) : await req; // 构造：准备本用例需要的输入、句柄或期望值
  expect(res.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  return res.body.modules.map((item: { code: string }) => item.code); // 返回：交回本步骤结果供断言使用
}

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } });
});

describe('分类级权限 · 未配置保持现网公开行为', () => {
  it('无规则时登录用户与匿名均可看到付费模块、详情 200', async () => {
    const session = await login('13800002001'); // 构造：准备本用例需要的输入、句柄或期望值
    const authedCodes = await listCodes(session.token); // 构造：准备本用例需要的输入、句柄或期望值
    expect(authedCodes).toContain('comic.genpack.basic'); // 断言：校验响应字段与冻结契约一致
    const anonymousCodes = await listCodes(null); // 构造：准备本用例需要的输入、句柄或期望值
    expect(anonymousCodes).toContain('comic.genpack.basic'); // 断言：校验响应字段与冻结契约一致
    const detail = await request(app).get('/api/v1/modules/comic.genpack.basic').set(authHeaders(session.token)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(detail.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  });
});

describe('分类级权限 · 用户级 deny 生效', () => {
  it('deny 二级分类：列表剔除、详情 403、下单 403；其他用户与同站其它分类不受影响', async () => {
    const denied = await login('13800002002'); // 构造：准备本用例需要的输入、句柄或期望值
    const allowed = await login('13800002003'); // 构造：准备本用例需要的输入、句柄或期望值
    const ruleRes = await putRule('user', denied.userId, [{ category_slug: 'ai-01', effect: 'deny' }]); // 构造：准备本用例需要的输入、句柄或期望值
    expect(ruleRes.status).toBe(200); // 断言：校验响应字段与冻结契约一致

    const deniedCodes = await listCodes(denied.token); // 构造：准备本用例需要的输入、句柄或期望值
    expect(deniedCodes).not.toContain('comic.genpack.basic'); // ai-01 被剔除
    expect(deniedCodes).toContain('ai.dubbing'); // ai-06 不受影响

    const detail = await request(app).get('/api/v1/modules/comic.genpack.basic').set(authHeaders(denied.token)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(detail.status).toBe(403); // 断言：校验响应字段与冻结契约一致
    expect(detail.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言：校验响应字段与冻结契约一致

    const order = await request(app).post('/api/v1/orders').set(writeHeaders(denied.token)).send({ module_code: 'comic.genpack.basic', channel: 'manual' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(order.status).toBe(403); // 断言：校验响应字段与冻结契约一致

    const allowedCodes = await listCodes(allowed.token); // 其它用户不受规则影响
    expect(allowedCodes).toContain('comic.genpack.basic'); // 断言：校验响应字段与冻结契约一致
    const allowedDetail = await request(app).get('/api/v1/modules/comic.genpack.basic').set(authHeaders(allowed.token)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(allowedDetail.status).toBe(200); // 断言：校验响应字段与冻结契约一致
  });

  it('一级分类前缀 deny 覆盖其全部二级条目', async () => {
    const denied = await login('13800002004'); // 构造：准备本用例需要的输入、句柄或期望值
    await putRule('user', denied.userId, [{ category_slug: 'ai', effect: 'deny' }]); // 一级 slug 前缀
    const codes = await listCodes(denied.token); // 构造：准备本用例需要的输入、句柄或期望值
    expect(codes).not.toContain('comic.genpack.basic'); // ai-01
    expect(codes).not.toContain('ai.dubbing'); // ai-06
  });

  it('deny 优先于同主体 allow', async () => {
    const session = await login('13800002005'); // 构造：准备本用例需要的输入、句柄或期望值
    await putRule('user', session.userId, [ // 执行：等待接口或数据库操作返回
      { category_slug: 'ai-01', effect: 'allow' },
      { category_slug: 'ai-01', effect: 'deny' },
    ]);
    const detail = await request(app).get('/api/v1/modules/comic.genpack.basic').set(authHeaders(session.token)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(detail.status).toBe(403); // 断言：校验响应字段与冻结契约一致
  });
});

describe('分类级权限 · 角色级 deny 生效', () => {
  it('角色规则经 user_roles 并集生效：持该角色的用户被拦截', async () => {
    const member = await login('13800002006'); // 构造：准备本用例需要的输入、句柄或期望值
    const other = await login('13800002007'); // 构造：准备本用例需要的输入、句柄或期望值
    const now = new Date().toISOString(); // 构造：准备本用例需要的输入、句柄或期望值
    db.prepare("INSERT INTO roles (code, name_i18n, description_i18n, builtin, created_at, updated_at) VALUES (?, '{}', '{}', 0, ?, ?)")
      .run('tester-role', now, now);
    db.prepare('INSERT INTO user_roles (user_id, role_code, granted_by, created_at) VALUES (?, ?, ?, ?)')
      .run(member.userId, 'tester-role', 'system', now);
    const ruleRes = await putRule('role', 'tester-role', [{ category_slug: 'ai-06', effect: 'deny' }]); // 构造：准备本用例需要的输入、句柄或期望值
    expect(ruleRes.status).toBe(200); // 断言：校验响应字段与冻结契约一致

    const memberDetail = await request(app).get('/api/v1/modules/ai.dubbing').set(authHeaders(member.token)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(memberDetail.status).toBe(403); // 角色 deny 命中
    const otherDetail = await request(app).get('/api/v1/modules/ai.dubbing').set(authHeaders(other.token)); // 构造：准备本用例需要的输入、句柄或期望值
    expect(otherDetail.status).toBe(200); // 未持角色不受影响
  });
});
