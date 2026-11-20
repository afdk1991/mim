/**
 * VIP 定价规则契约测试（批次 6 · P1-2 / P1-4）。
 *
 * 覆盖鉴权矩阵与写路径审计留痕：
 *   - GET  /vip/prices                    匿名 200（公开只读）
 *   - GET  /admin/vip/price-rules         匿名 401 / 无权限 403 / 管理员 200
 *   - POST /admin/vip/price-rules         匿名 401 / 无权限 403 / 参数非法 400 / 管理员 201 + 审计
 *   - PUT  /admin/vip/price-rules/:id     匿名 401 / 无权限 403 / 参数非法 400 / 管理员 200 + 审计
 *   - DELETE /admin/vip/price-rules/:id   匿名 401 / 无权限 403 / 管理员 200 + 审计，重复删除 404
 *
 * 复用既有 _auth-helper 注册登录与 createApp 装配，不另建 harness。
 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排 API，beforeEach 每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 仅引入类型，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，走它才能保证中间件挂载顺序真实
import { createDatabase } from '../src/db.js'; // 内存库工厂，保证用例之间零共享状态
import type { Db } from '../src/types.js'; // 数据库句柄类型
import { registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录辅助

const JWT_SECRET = 'vip-pricing-test-secret-0123456789abcdef01'; // 固定测试密钥，长度满足构建期强度校验
const ADMIN_TOKEN = 'vip-pricing-admin-token'; // 超管引导令牌固定值，与 createApp 注入 env 一致

/** 合法固定价规则入参（fixed 模式必须带 price_cents，折扣字段归 null） */
function fixedRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { // 字段白名单：与路由 ruleCreateSchema 一一对应
    dimension: 'module', // 命中维度
    dimension_value: 'community', // 维度取值
    level_min: 1, // 最低 VIP 等级
    mode: 'fixed', // 定价模式：固定价
    price_cents: 1900, // 固定价（分）
    discount_percent: null, // 折扣字段归 null
    currency: 'CNY', // 币种
    enabled: true, // 默认生效
    ...overrides, // 用例覆盖字段
  };
}

let app: Express; // 待测应用实例（已注入引导令牌）
let db: Db; // 与 app 同生命周期的数据库句柄，用于直接回读审计流水

/** 引导通道请求头；传 null 表示故意不带令牌，验证 401 分支 */
function adminHeaders(token: string | null = ADMIN_TOKEN): Record<string, string> {
  return token === null ? {} : { 'x-admin-token': token, 'content-type': 'application/json' }; // 引导令牌头
}

/** 按动作码回读审计流水行 */
function auditRows(action: string): Array<{ action: string; target: string | null; result: string }> {
  return db.prepare('SELECT action, target, result FROM audit_logs WHERE action = ?').all(action) as
    Array<{ action: string; target: string | null; result: string }>;
}

beforeEach(() => { // 每例前置：重建内存库与已注入引导令牌的应用
  db = createDatabase(':memory:'); // 内存库每次全新创建，RBAC 种子自动种入
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // env 注入引导令牌即开启超管通道
}); // beforeEach 结束

describe('GET /vip/prices 公开只读', () => {
  it('匿名访问返回 200，空库回显空规则列表', async () => {
    const res = await request(app).get('/api/v1/vip/prices'); // 不带任何鉴权头
    expect(res.status).toBe(200); // 公开读不拦 401
    expect(Array.isArray(res.body.rules)).toBe(true); // 回显 rules 数组
    expect(res.body.rules).toHaveLength(0); // 空库即空列表
  });
});

describe('GET /admin/vip/price-rules 鉴权矩阵', () => {
  it('匿名 → 401 AUTH_UNAUTHORIZED', async () => {
    const res = await request(app).get('/api/v1/admin/vip/price-rules'); // 无令牌
    expect(res.status).toBe(401); // 未登录统一 401
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 错误码对齐鉴权中间件
  });

  it('已登录但无 commerce:write 权限 → 403 FORBIDDEN', async () => {
    const { token } = await registerTestAccount(app, '13921000001'); // 普通注册账号，无后台角色
    const res = await request(app).get('/api/v1/admin/vip/price-rules').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403); // 权限不足 403
    expect(res.body.code).toBe('FORBIDDEN'); // 错误码对齐 requirePermission
  });

  it('引导令牌（超管）→ 200，回显全量规则', async () => {
    const res = await request(app).get('/api/v1/admin/vip/price-rules').set(adminHeaders());
    expect(res.status).toBe(200); // 超管放行
    expect(Array.isArray(res.body.rules)).toBe(true); // 回显 rules 数组
  });
});

describe('POST /admin/vip/price-rules 鉴权矩阵 + 审计留痕', () => {
  it('匿名 → 401，不落库', async () => {
    const res = await request(app).post('/api/v1/admin/vip/price-rules').send(fixedRule());
    expect(res.status).toBe(401); // 未登录 401
    expect(auditRows('vip_price_rule.create')).toHaveLength(0); // 未通过鉴权不写审计
  });

  it('已登录但无权限 → 403', async () => {
    const { token } = await registerTestAccount(app, '13921000002');
    const res = await request(app).post('/api/v1/admin/vip/price-rules').set('Authorization', `Bearer ${token}`).send(fixedRule());
    expect(res.status).toBe(403); // 普通账号 403
  });

  it('参数非法（fixed 模式缺 price_cents）→ 400 VALIDATION_FAILED', async () => {
    const res = await request(app).post('/api/v1/admin/vip/price-rules')
      .set(adminHeaders())
      .send(fixedRule({ mode: 'fixed', price_cents: null })); // 固定价却不带价格
    expect(res.status).toBe(400); // 校验失败 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 错误码对齐 zod 包装
  });

  it('引导令牌新增成功 → 201，公开读可见，且写 create 审计行', async () => {
    const res = await request(app).post('/api/v1/admin/vip/price-rules').set(adminHeaders()).send(fixedRule());
    expect(res.status).toBe(201); // 新增 201
    const rule = res.body.rule; // 落库视图
    expect(rule.id).toBeTruthy(); // 回读主键
    expect(rule.enabled).toBe(true); // 布尔收敛正确

    const publicList = await request(app).get('/api/v1/vip/prices'); // 公开读应能看到生效规则
    expect(publicList.status).toBe(200);
    expect(publicList.body.rules.some((r: { id: string }) => r.id === rule.id)).toBe(true);

    const audits = auditRows('vip_price_rule.create'); // 回读新增审计
    expect(audits).toHaveLength(1); // 一条成功留痕
    expect(audits[0].result).toBe('success'); // 结果 success
    expect(audits[0].target).toBe('vip_price_rule:module:community'); // 对象编码 = 类型:主键
  });
});

describe('PUT /admin/vip/price-rules/:id 鉴权矩阵 + 审计留痕', () => {
  async function seedRule(): Promise<string> { // 先造一条规则供修改 / 删除用例复用
    const res = await request(app).post('/api/v1/admin/vip/price-rules').set(adminHeaders()).send(fixedRule());
    return res.body.rule.id as string;
  }

  it('匿名 → 401', async () => {
    const id = await seedRule();
    const res = await request(app).put(`/api/v1/admin/vip/price-rules/${id}`).send({ price_cents: 2100 });
    expect(res.status).toBe(401); // 未登录 401
  });

  it('已登录但无权限 → 403', async () => {
    const id = await seedRule();
    const { token } = await registerTestAccount(app, '13921000003');
    const res = await request(app).put(`/api/v1/admin/vip/price-rules/${id}`).set('Authorization', `Bearer ${token}`).send({ price_cents: 2100 });
    expect(res.status).toBe(403); // 普通账号 403
  });

  it('空 body（无任何字段）→ 400 VALIDATION_FAILED', async () => {
    const id = await seedRule();
    const res = await request(app).put(`/api/v1/admin/vip/price-rules/${id}`).set(adminHeaders()).send({});
    expect(res.status).toBe(400); // 补丁至少一项字段
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('引导令牌修改成功 → 200，回写价格并写 update 审计行', async () => {
    const id = await seedRule();
    const res = await request(app).put(`/api/v1/admin/vip/price-rules/${id}`).set(adminHeaders()).send({ price_cents: 2100 });
    expect(res.status).toBe(200); // 修改 200
    expect(res.body.rule.price_cents).toBe(2100); // 价格已更新

    const audits = auditRows('vip_price_rule.update');
    expect(audits).toHaveLength(1); // 一条成功留痕
    expect(audits[0].result).toBe('success');
    expect(audits[0].target).toBe(`vip_price_rule:${id}`); // 对象主键 = 规则 ID
  });
});

describe('DELETE /admin/vip/price-rules/:id 鉴权矩阵 + 审计留痕', () => {
  async function seedRule(): Promise<string> {
    const res = await request(app).post('/api/v1/admin/vip/price-rules').set(adminHeaders()).send(fixedRule());
    return res.body.rule.id as string;
  }

  it('匿名 → 401', async () => {
    const id = await seedRule();
    const res = await request(app).delete(`/api/v1/admin/vip/price-rules/${id}`);
    expect(res.status).toBe(401); // 未登录 401
  });

  it('已登录但无权限 → 403', async () => {
    const id = await seedRule();
    const { token } = await registerTestAccount(app, '13921000004');
    const res = await request(app).delete(`/api/v1/admin/vip/price-rules/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403); // 普通账号 403
  });

  it('引导令牌删除成功 → 200，写 delete 审计行；重复删除 → 404', async () => {
    const id = await seedRule();
    const del = await request(app).delete(`/api/v1/admin/vip/price-rules/${id}`).set(adminHeaders());
    expect(del.status).toBe(200); // 删除成功
    expect(del.body.deleted).toBe(true); // 明确告知删除成功

    const audits = auditRows('vip_price_rule.delete');
    expect(audits).toHaveLength(1); // 一条成功留痕
    expect(audits[0].result).toBe('success');
    expect(audits[0].target).toBe(`vip_price_rule:${id}`);

    const again = await request(app).delete(`/api/v1/admin/vip/price-rules/${id}`).set(adminHeaders());
    expect(again.status).toBe(404); // 物理删除后重复命中 404
  });
});
