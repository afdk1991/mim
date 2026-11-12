/**
 * 实名认证测试：提交脱敏（库内查不到明文姓名 / 证件号）、状态流转、管理队列、权限门禁。
 * 测试自建 mini app，只挂载实名路由。
 */

import express from 'express'; // 组装 mini app
import { describe, expect, it } from 'vitest'; // vitest 用例编排与断言
import request from 'supertest'; // HTTP 断言
import { createDatabase } from '../src/db.js'; // 内存库
import { createUser } from '../src/identity.js'; // 造正式用户
import { issueAccessToken } from '../src/auth.js'; // 造登录态令牌
import { createRealnameRouter } from '../src/routes/realname.js'; // 被测路由工厂
import { errorHandler } from '../src/middleware.js'; // 统一错误信封
import type { ApiDeps } from '../src/types.js'; // 依赖容器

const ADMIN_TOKEN = 'admin-test-token'; // 引导管理令牌

/** 组装只含实名路由的 mini app */
function miniApp(deps: ApiDeps) { // 依赖显式注入
  const app = express(); // 独立实例
  app.use(express.json()); // 解析 JSON
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 注入依赖容器
  app.use('/api/v1', createRealnameRouter(deps)); // 挂载被测路由
  app.use(errorHandler); // 统一错误处理
  return app; // 交出实例
} // miniApp 结束

/** 造依赖与正式用户 */
function setup() { // 复用装配
  const deps: ApiDeps = { // 依赖容器
    db: createDatabase(':memory:'), // 内存库
    jwtSecret: 'realname-secret', // HMAC 密钥
    env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN }, // 引导通道令牌
  }; // deps 结束
  const user = createUser(deps.db, { region: 'cn', now: '2026-11-13T08:00:00.000Z' }); // 正式用户
  const token = issueAccessToken(user.id, user.region, deps.jwtSecret); // 登录态
  return { deps, app: miniApp(deps), user, token }; // 交出实例与身份
} // setup 结束

describe('实名认证（人工审核）', () => { // 实名维度
  it('提交后只存哈希与脱敏片段：库内查不到明文姓名与证件号', async () => { // 脱敏硬约束
    const { app, deps, token } = setup(); // 装配
    const submit = await request(app).post('/api/v1/auth/realname/submit').set('Authorization', `Bearer ${token}`) // 构造：准备本用例需要的输入、句柄或期望值
      .send({ id_type: 'id_card', name: '张三', id_number: '110101199001011234' }); // 提交实名
    expect(submit.status).toBe(201); // 提交成功
    expect(submit.body.status).toBe('pending'); // 进入待审
    expect(submit.body.provider).toBe('manual'); // 未接第三方，走人工
    expect(submit.body.name_masked).toBe('张*'); // 姓名脱敏：保留首字
    expect(submit.body.id_last4).toBe('1234'); // 证件号只留后四位

    const rows = deps.db.prepare('SELECT * FROM realname_records').all() as Array<Record<string, unknown>>; // 全表回读
    const dumped = JSON.stringify(rows); // 序列化整行
    expect(dumped).not.toContain('张三'); // 明文姓名不得入库
    expect(dumped).not.toContain('110101199001011234'); // 明文证件号不得入库
    expect(rows[0].name_hash).toBeTruthy(); // 姓名摘要存在
    expect(rows[0].id_hash).toBeTruthy(); // 证件号摘要存在
  }); // 结束脱敏用例

  it('格式非法的姓名 / 证件号返回 400 REALNAME_INVALID', async () => { // 格式校验
    const { app, token } = setup(); // 装配
    const res = await request(app).post('/api/v1/auth/realname/submit').set('Authorization', `Bearer ${token}`) // 构造：准备本用例需要的输入、句柄或期望值
      .send({ id_type: 'id_card', name: '张三', id_number: 'abcdefghijklmnop' }); // 长度达标但格式非法的证件号
    expect(res.status).toBe(400); // 参数错误
    expect(res.body.code).toBe('REALNAME_INVALID'); // 明确错误码
  }); // 结束格式校验用例

  it('待审状态下重复提交返回 409 REALNAME_ALREADY_SUBMITTED', async () => { // 重复提交拦截
    const { app, token } = setup(); // 装配
    await request(app).post('/api/v1/auth/realname/submit').set('Authorization', `Bearer ${token}`) // 执行：等待接口或数据库操作返回
      .send({ id_type: 'id_card', name: '张三', id_number: '110101199001011234' }); // 首次提交
    const duplicate = await request(app).post('/api/v1/auth/realname/submit').set('Authorization', `Bearer ${token}`) // 构造：准备本用例需要的输入、句柄或期望值
      .send({ id_type: 'id_card', name: '张三', id_number: '110101199001011234' }); // 重复提交
    expect(duplicate.status).toBe(409); // 状态冲突
    expect(duplicate.body.code).toBe('REALNAME_ALREADY_SUBMITTED'); // 明确错误码
  }); // 结束重复提交用例

  it('本人可查询审核状态与脱敏视图', async () => { // 状态查询
    const { app, token } = setup(); // 装配
    await request(app).post('/api/v1/auth/realname/submit').set('Authorization', `Bearer ${token}`) // 执行：等待接口或数据库操作返回
      .send({ id_type: 'id_card', name: '李四', id_number: '310101198505056789' }); // 提交
    const res = await request(app).get('/api/v1/auth/realname/status').set('Authorization', `Bearer ${token}`); // 查询本人状态
    expect(res.status).toBe(200); // 查询成功
    expect(res.body.record.status).toBe('pending'); // 待审
    expect(res.body.record.id_last4).toBe('6789'); // 后四位回显
    expect(res.body.record).not.toHaveProperty('id_hash'); // 摘要列不外泄
  }); // 结束状态查询用例

  it('管理端队列可见待审记录；驳回 → 重新提交 → 通过，状态机完整流转', async () => { // 审核流转
    const { app, deps, token, user } = setup(); // 装配
    await request(app).post('/api/v1/auth/realname/submit').set('Authorization', `Bearer ${token}`) // 执行：等待接口或数据库操作返回
      .send({ id_type: 'id_card', name: '王五', id_number: '440101199202023456' }); // 提交待审

    const queue = await request(app).get('/api/v1/admin/realname/queue').set('x-admin-token', ADMIN_TOKEN); // 引导通道取队列
    expect(queue.status).toBe(200); // 队列可读
    expect(queue.body.queue).toHaveLength(1); // 一条待审
    const recordId = queue.body.queue[0].id as string; // 记录主键

    const reject = await request(app).post(`/api/v1/admin/realname/${recordId}/review`).set('x-admin-token', ADMIN_TOKEN) // 构造：准备本用例需要的输入、句柄或期望值
      .send({ decision: 'reject', reason: '证件照片不清晰，请重传' }); // 驳回
    expect(reject.status).toBe(200); // 审核成功
    expect(reject.body.status).toBe('rejected'); // 状态驳回
    expect(reject.body.reject_reason).toContain('不清晰'); // 原因回填

    const resubmit = await request(app).post('/api/v1/auth/realname/submit').set('Authorization', `Bearer ${token}`) // 构造：准备本用例需要的输入、句柄或期望值
      .send({ id_type: 'id_card', name: '王五', id_number: '440101199202023456' }); // 驳回后重新提交
    expect(resubmit.status).toBe(201); // 允许重新进入待审
    expect(resubmit.body.status).toBe('pending'); // 回到待审

    const approve = await request(app).post(`/api/v1/admin/realname/${recordId}/review`).set('x-admin-token', ADMIN_TOKEN) // 构造：准备本用例需要的输入、句柄或期望值
      .send({ decision: 'approve' }); // 通过
    expect(approve.status).toBe(200); // 审核成功
    expect(approve.body.status).toBe('approved'); // 状态通过
    void deps; void user; // 占位保持装配返回结构
  }); // 结束流转用例

  it('无管理权限的普通用户访问审核队列返回 403', async () => { // 权限门禁
    const { app, token } = setup(); // 装配（普通用户，未授 user:read）
    const res = await request(app).get('/api/v1/admin/realname/queue').set('Authorization', `Bearer ${token}`); // 尝试取队列
    expect(res.status).toBe(403); // 权限拒绝
  }); // 结束权限用例
}); // 结束 describe
