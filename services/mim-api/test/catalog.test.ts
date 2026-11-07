/** 契约测试：catalog 管理面 —— 模块状态机 / 权益发放 / 权益回收（铁律十一：逐行中文注释） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排 API，beforeEach 每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 仅引入类型，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，走它才能保证中间件挂载顺序真实
import { createDatabase } from '../src/db.js'; // 内存库工厂，保证用例之间零共享状态

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足构建期强度校验
const ADMIN_TOKEN = 'test-admin-token'; // 管理令牌固定值，必须与 createApp 注入的 env 保持一致

let app: Express; // 待测应用实例（已启用管理面）
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄，用例内可直接写库造数据

function adminHeaders(token: string | null = ADMIN_TOKEN): Record<string, string> { // 构造管理请求头
  return token === null ? {} : { 'x-admin-token': token }; // 传 null 表示故意不带令牌，用于验证 401 分支
} // 结束 adminHeaders 定义

interface Session { // 登录会话契约
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键，用于权益发放的目标用户
} // 结束 Session 定义

async function login(identifier: string): Promise<Session> { // 登录辅助：先取验证码再换令牌
  const codeRes = await request(app) // 申请验证码
    .post('/api/v1/auth/code') // 验证码端点
    .send({ region: 'cn', provider: 'phone', identifier }); // 固定 cn + 手机号通道，减少变量
  expect(codeRes.status).toBe(201); // 断言 201，验证码已创建
  const loginRes = await request(app) // 用验证码换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ // 登录请求体
      region: 'cn', // 区域固定 cn
      provider: 'phone', // 通道固定手机号
      identifier, // 与验证码阶段一致
      code: codeRes.body.dev_code, // 测试环境无通知通道，服务端直接回传 dev_code
      device: { platform: 'web', name: 'test' }, // 设备信息为登录契约必填项
    }); // 结束登录请求体
  expect(loginRes.status).toBe(200); // 断言 200，登录成功
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回令牌与用户 id
} // 结束 login 定义

/** 把种子模块置为 draft，用于验证状态机前置条件 */
function setModuleStatus(status: 'draft' | 'active' | 'archived'): void { // 直接改库，绕开状态机以构造任意起点
  db.prepare(`UPDATE modules SET status = ? WHERE code = 'comic.workbench' AND region = 'cn'`).run(status); // 种子行唯一，无需再过滤 deleted_at
} // 结束 setModuleStatus 定义

function entitlementRow(id: string) { // 读取权益行，供状态与版本断言
  return db // 数据库句柄
    .prepare(`SELECT status, version, expires_at FROM entitlements WHERE id = ?`) // 只取断言关心的三列
    .get(id) as { status: string; version: number; expires_at: string | null } | undefined; // 未命中返回 undefined
} // 结束 entitlementRow 定义

function eventRows(entitlementId: string) { // 读取权益审计事件，按写入顺序返回
  return db // 数据库句柄
    .prepare( // 预编译：同一权益的全部事件
      `SELECT actor, from_status, to_status, reason FROM entitlement_events
       WHERE entitlement_id = ? ORDER BY created_at ASC, rowid ASC`, // rowid 兜底同一毫秒内的写入顺序
    ) // 结束预编译
    .all(entitlementId) as Array<{ actor: string; from_status: string | null; to_status: string; reason: string }>; // 事件四元组
} // 结束 eventRows 定义

beforeEach(() => { // 每例前置：重建内存库与已启用管理面的应用
  db = createDatabase(':memory:'); // 内存库每次全新创建，种子模块自动种入
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // env 注入管理令牌即开启管理面
}); // 结束 beforeEach

describe('管理面鉴权（requireAdmin）', () => { // 管理路由必须先过令牌校验，否则不应泄露任何写能力
  it('未配置 MIM_ADMIN_TOKEN → 403 FEATURE_NOT_AVAILABLE', async () => { // 服务端未启用管理面时，即使带令牌也应拒绝
    const bareApp = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 独立应用实例，env 不含管理令牌
    const res = await request(bareApp) // 用未启用管理面的实例发请求
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 带上令牌，证明拒绝原因不是缺令牌
      .send({ status: 'active' }); // 合法请求体
    expect(res.status).toBe(403); // 断言 403，功能未启用
    expect(res.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言错误码
    expect(res.body.message).toBe('admin API is not enabled'); // 断言文案，前端可据此提示运维配置
  }); // 结束未配置用例

  it('缺少或错误令牌 → 401 AUTH_UNAUTHORIZED', async () => { // 已启用管理面时，令牌缺失与令牌错误必须同为 401
    const missing = await request(app) // 完全不带头
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .send({ status: 'active' }); // 合法请求体
    expect(missing.status).toBe(401); // 断言 401
    expect(missing.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言错误码
    expect(missing.body.message).toBe('invalid admin token'); // 断言文案，与中间件实现一致

    const wrong = await request(app) // 带错误令牌
      .patch('/api/v1/modules/comic.workbench/status') // 同一端点
      .set(adminHeaders('wrong-token')) // 故意用错值
      .send({ status: 'active' }); // 合法请求体
    expect(wrong.status).toBe(401); // 断言 401，错误令牌与缺失同语义
  }); // 结束令牌用例

  it('正确令牌通过鉴权', async () => { // 正向用例：正确令牌应放行到业务逻辑
    const res = await request(app) // 带正确令牌
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 正确令牌
      .send({ status: 'archived' }); // 种子模块为 active，archived 是合法迁移
    expect(res.status).toBe(200); // 断言 200，说明鉴权已放行
    expect(res.body.module.code).toBe('comic.workbench'); // 断言回显模块码
  }); // 结束正向用例
}); // 结束管理面鉴权分组

describe('模块状态机（draft → active → archived）', () => { // 单向迁移，任何回退或跨级都必须被拒
  it('draft → active 返回 200', async () => { // 首个合法迁移
    setModuleStatus('draft'); // 构造 draft 起点（种子默认 active）
    const res = await request(app) // 发起迁移
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ status: 'active', region: 'cn' }); // 显式指定区域，避免依赖请求头兜底
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.module.status).toBe('active'); // 断言目标状态
    expect(res.body.module.region).toBe('cn'); // 断言区域原样回显
    const row = db.prepare(`SELECT status FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`).get() as { status: string }; // 回读库内状态
    expect(row.status).toBe('active'); // 断言落库生效，而非仅回显
  }); // 结束 draft→active 用例

  it('active → archived 返回 200', async () => { // 第二个合法迁移
    const res = await request(app) // 种子模块初始即为 active
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ status: 'archived' }); // 不传 region，走 x-region/兜底 cn 分支
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.module.status).toBe('archived'); // 断言目标状态
  }); // 结束 active→archived 用例

  it('同状态迁移 → 409 module is already in the requested status', async () => { // 相同状态判断先于白名单判断
    const res = await request(app) // 种子模块已是 active
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ status: 'active' }); // 重复提交同一状态
    expect(res.status).toBe(409); // 断言 409
    expect(res.body.code).toBe('CONFLICT'); // 断言冲突错误码
    expect(res.body.message).toBe('module is already in the requested status'); // 断言文案区分于「非法迁移」
  }); // 结束同状态用例

  it('跨级迁移 draft → archived → 409 illegal module status transition', async () => { // 白名单只允许相邻一步
    setModuleStatus('draft'); // 构造 draft 起点
    const res = await request(app) // 试图一步跳过 active
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ status: 'archived' }); // 跨级目标
    expect(res.status).toBe(409); // 断言 409
    expect(res.body.message).toBe('illegal module status transition'); // 断言文案，携带 from/to 详情
    expect(res.body.details.from).toBe('draft'); // 断言 details.from（信封将明细嵌套在 details 下）
    expect(res.body.details.to).toBe('archived'); // 断言 details.to
  }); // 结束跨级用例

  it('回退迁移 archived → active → 409', async () => { // 单向状态机不允许回退
    setModuleStatus('archived'); // 构造 archived 起点
    const res = await request(app) // 试图回退
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ status: 'active' }); // 回退目标
    expect(res.status).toBe(409); // 断言 409
    expect(res.body.message).toBe('illegal module status transition'); // 断言非法迁移文案
  }); // 结束回退用例

  it('模块不存在 → 404 module not found', async () => { // 参数化路由需对未知模块给 404
    const res = await request(app) // 不存在的模块码
      .patch('/api/v1/modules/no.such.module/status') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ status: 'active' }); // 合法目标状态
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.code).toBe('NOT_FOUND'); // 断言错误码
    expect(res.body.message).toBe('module not found'); // 断言文案
  }); // 结束不存在用例

  it('非法状态值 → 400 VALIDATION_FAILED', async () => { // zod 枚举校验必须在进入业务前拦下
    const res = await request(app) // 传入枚举外状态
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ status: 'offline' }); // 非枚举值
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言校验失败错误码
  }); // 结束非法状态用例
}); // 结束状态机分组

describe('管理面权益发放（POST /entitlements/grant）', () => { // 手工发放按「当前已有状态」天然幂等
  it('首次发放 201，重复发放 200 回放且 version 不变', async () => { // 幂等回放必须不产生新版本、不产生新事件
    const session = await login('13800000001'); // 建一个真实用户作为发放目标
    const first = await request(app) // 第一次发放
      .post('/api/v1/entitlements/grant') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'comic.workbench' }); // 目标用户 + 模块码
    expect(first.status).toBe(201); // 断言 201，新建权益
    expect(first.body.entitlement.status).toBe('active'); // 断言状态 active
    expect(first.body.entitlement.version).toBe(1); // 断言初始版本 1
    expect(first.body.entitlement.expires_at).toBeNull(); // 未指定到期时间即长期有效

    const entitlementId = first.body.entitlement.id as string; // 记录权益 id 供后续断言
    const second = await request(app) // 第二次发放同样内容
      .post('/api/v1/entitlements/grant') // 同一端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'comic.workbench' }); // 与上次完全一致
    expect(second.status).toBe(200); // 断言 200，走幂等回放分支
    expect(second.body.entitlement.id).toBe(entitlementId); // 断言复用同一权益行
    expect(second.body.entitlement.version).toBe(1); // 断言版本未递增，证明未重复写入
    expect(eventRows(entitlementId).length).toBe(1); // 断言只留一条发放事件
    const events = eventRows(entitlementId); // 取事件明细
    expect(events[0].actor).toBe('admin'); // 断言操作者
    expect(events[0].from_status).toBeNull(); // 断言新建时无前置状态
    expect(events[0].to_status).toBe('active'); // 断言目标状态
    expect(events[0].reason).toBe('admin_grant'); // 断言发放原因
  }); // 结束首次发放用例

  it('已过期权益重新发放 → 200 且 version + 1', async () => { // 过期视为无效，需要真正写库续期
    const session = await login('13800000002'); // 发放目标用户
    const first = await request(app) // 先发一条已过期的权益
      .post('/api/v1/entitlements/grant') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'comic.workbench', expires_at: '2020-01-01T00:00:00.000Z' }); // 到期时间早于当前，必然失效
    expect(first.status).toBe(201); // 断言 201
    expect(first.body.entitlement.version).toBe(1); // 断言初始版本
    const entitlementId = first.body.entitlement.id as string; // 记录权益 id

    const second = await request(app) // 重新发放为长期有效
      .post('/api/v1/entitlements/grant') // 同一端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'comic.workbench' }); // 不带 expires_at 即长期
    expect(second.status).toBe(200); // 断言 200
    expect(second.body.entitlement.id).toBe(entitlementId); // 断言仍是同一行，而非新建
    expect(second.body.entitlement.version).toBe(2); // 断言版本递增
    expect(second.body.entitlement.expires_at).toBeNull(); // 断言到期时间被清空
    const row = entitlementRow(entitlementId); // 回读库内状态
    expect(row?.status).toBe('active'); // 断言重新激活
    expect(row?.expires_at).toBeNull(); // 断言库内到期时间为空
    expect(eventRows(entitlementId).length).toBe(2); // 断言新增一条续期事件
  }); // 结束续期用例

  it('目标用户不存在 → 404 user not found', async () => { // 发放必须校验目标用户
    const res = await request(app) // 用一个不存在的用户 id
      .post('/api/v1/entitlements/grant') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: 'not-a-user', module_code: 'comic.workbench' }); // 幽灵用户
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.message).toBe('user not found'); // 断言文案
  }); // 结束用户不存在用例

  it('目标模块不存在 → 404 module not found', async () => { // 发放必须校验模块存在
    const session = await login('13800000003'); // 建真实用户，确保失败原因只在模块侧
    const res = await request(app) // 用一个不存在的模块码
      .post('/api/v1/entitlements/grant') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'no.such.module' }); // 幽灵模块
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.message).toBe('module not found'); // 断言文案
  }); // 结束模块不存在用例

  it('expires_at 非日期字符串 → 400 VALIDATION_FAILED', async () => { // 到期时间必须可被 Date.parse 解析
    const session = await login('13800000004'); // 建真实用户
    const res = await request(app) // 传不可解析的时间串
      .post('/api/v1/entitlements/grant') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'comic.workbench', expires_at: 'not-a-date' }); // 非法时间
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言校验失败错误码
  }); // 结束非法时间用例
}); // 结束权益发放分组

describe('管理面权益回收（POST /entitlements/:id/revoke）', () => { // 回收按当前状态天然幂等
  it('回收返回 200 并写审计事件；重复回收不新增事件', async () => { // 幂等回放不得重复写事件
    const session = await login('13800000005'); // 建发放目标用户
    const granted = await request(app) // 先发一条有效权益
      .post('/api/v1/entitlements/grant') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'comic.workbench' }); // 目标用户 + 模块
    const entitlementId = granted.body.entitlement.id as string; // 记录权益 id

    const revoked = await request(app) // 第一次回收
      .post(`/api/v1/entitlements/${entitlementId}/revoke`) // 回收端点
      .set(adminHeaders()) // 管理令牌
      .send({ reason: '违规使用' }); // 自定义回收原因
    expect(revoked.status).toBe(200); // 断言 200
    expect(revoked.body.entitlement.status).toBe('revoked'); // 断言状态已回收
    expect(revoked.body.entitlement.version).toBe(2); // 断言版本递增
    expect(revoked.body.entitlement.user_id).toBe(session.userId); // 断言回显归属用户

    const events = eventRows(entitlementId); // 取全部审计事件
    expect(events.length).toBe(2); // 断言发放 + 回收各一条
    expect(events[1].actor).toBe('admin'); // 断言回收操作者
    expect(events[1].from_status).toBe('active'); // 断言前置状态
    expect(events[1].to_status).toBe('revoked'); // 断言目标状态
    expect(events[1].reason).toBe('违规使用'); // 断言自定义原因原样落库

    const again = await request(app) // 重复回收
      .post(`/api/v1/entitlements/${entitlementId}/revoke`) // 同一端点
      .set(adminHeaders()) // 管理令牌
      .send({}); // 空请求体，走默认原因分支
    expect(again.status).toBe(200); // 断言 200，幂等回放
    expect(again.body.entitlement.version).toBe(2); // 断言版本未再递增
    expect(eventRows(entitlementId).length).toBe(2); // 断言未新增事件
  }); // 结束回收用例

  it('空请求体回收 → 默认原因 admin_revoke', async () => { // 运维一键回收不应强制填原因
    const session = await login('13800000006'); // 建发放目标用户
    const granted = await request(app) // 先发一条有效权益
      .post('/api/v1/entitlements/grant') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ user_id: session.userId, module_code: 'comic.workbench' }); // 目标用户 + 模块
    const entitlementId = granted.body.entitlement.id as string; // 记录权益 id

    const revoked = await request(app) // 完全不带请求体
      .post(`/api/v1/entitlements/${entitlementId}/revoke`) // 回收端点
      .set(adminHeaders()); // 只带管理令牌
    expect(revoked.status).toBe(200); // 断言 200
    const events = eventRows(entitlementId); // 取审计事件
    expect(events[1].reason).toBe('admin_revoke'); // 断言默认原因
  }); // 结束默认原因用例

  it('权益不存在 → 404 entitlement not found', async () => { // 未知权益 id 必须 404
    const res = await request(app) // 用一个不存在的权益 id
      .post('/api/v1/entitlements/not-an-entitlement/revoke') // 回收端点
      .set(adminHeaders()) // 管理令牌
      .send({}); // 空请求体
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.code).toBe('NOT_FOUND'); // 断言错误码
    expect(res.body.message).toBe('entitlement not found'); // 断言文案
  }); // 结束不存在用例
}); // 结束权益回收分组
