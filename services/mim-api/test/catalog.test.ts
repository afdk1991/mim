/** 契约测试：catalog 管理面 —— 模块状态机 / 权益发放 / 权益回收（铁律十一：逐行中文注释） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排 API，beforeEach 每例重建内存库
import { createHmac } from 'node:crypto'; // 渠道回调签名：与被测实现同一算法，验证「对的签名」与「错的签名」
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import ExcelJS from 'exceljs'; // 测试内读回导出的 xlsx，校验工作表与表头内容
import type { Express } from 'express'; // 仅引入类型，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，走它才能保证中间件挂载顺序真实
import { createDatabase, ensureAdditiveIndexes } from '../src/db.js'; // 内存库工厂 + 补索引迁移（结构回归用）

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足构建期强度校验
const ADMIN_TOKEN = 'test-admin-token'; // 管理令牌固定值，必须与 createApp 注入的 env 保持一致
const NOTIFY_SECRET = 'test-notify-secret-0123456789abcdef'; // 支付回调签名密钥，仅用于回调用例的独立应用实例

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

describe('管理面鉴权（requirePermission 双通道）', () => { // 管理路由已切 RBAC：引导令牌与 Bearer 均可，二者都没有时一律 401
  it('未配置 MIM_ADMIN_TOKEN 且无 Bearer → 401 AUTH_UNAUTHORIZED', async () => { // 双通道都不可用时不得泄露任何写能力
    const bareApp = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 独立应用实例，env 不含管理令牌
    const res = await request(bareApp) // 用未启用引导通道的实例发请求
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 带上令牌，证明拒绝原因不是缺令牌
      .send({ status: 'active' }); // 合法请求体
    expect(res.status).toBe(401); // 断言 401：引导通道未开启，且请求未携带 Bearer
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言错误码
    expect(res.body.message).toBe('missing bearer token'); // 断言文案，来自 Bearer 解析分支
  }); // 结束未配置用例

  it('缺少凭据 → 401；错误 x-admin-token → 401 invalid admin token', async () => { // 缺失与错误同语义，避免令牌探测
    const missing = await request(app) // 完全不带头
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .send({ status: 'active' }); // 合法请求体
    expect(missing.status).toBe(401); // 断言 401
    expect(missing.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言错误码
    expect(missing.body.message).toBe('missing bearer token'); // 完全没有凭据时落到 Bearer 分支

    const wrong = await request(app) // 带错误令牌
      .patch('/api/v1/modules/comic.workbench/status') // 同一端点
      .set(adminHeaders('wrong-token')) // 故意用错值
      .send({ status: 'active' }); // 合法请求体
    expect(wrong.status).toBe(401); // 断言 401，错误令牌与缺失同语义
    expect(wrong.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言错误码
    expect(wrong.body.message).toBe('invalid admin token'); // 断言文案，来自 adminTokenMatches
  }); // 结束令牌用例

  it('正确 x-admin-token（超管引导通道）通过鉴权', async () => { // 引导通道等同全权限，冷启动可用
    const res = await request(app) // 带正确令牌
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set(adminHeaders()) // 正确令牌
      .send({ status: 'archived' }); // 种子模块为 active，archived 是合法迁移
    expect(res.status).toBe(200); // 断言 200，说明鉴权已放行
    expect(res.body.module.code).toBe('comic.workbench'); // 断言回显模块码
  }); // 结束正向用例

  it('Bearer 用户无 module:write 权限 → 403 FORBIDDEN 并回显缺失权限点', async () => { // RBAC 主通道：登录通过但权限不足
    const session = await login('13800000009'); // 新建一个未授予任何角色的普通用户
    const res = await request(app) // 用普通用户 Bearer 发起管理写操作
      .patch('/api/v1/modules/comic.workbench/status') // 管理端点
      .set('Authorization', `Bearer ${session.token}`) // 仅带 Bearer，不带引导令牌
      .send({ status: 'archived' }); // 合法请求体
    expect(res.status).toBe(403); // 断言 403，鉴权通过但授权失败
    expect(res.body.code).toBe('FORBIDDEN'); // 断言 RBAC 专用错误码
    expect(res.body.message).toBe('permission denied'); // 断言文案
    expect(res.body.details.permission).toBe('module:write'); // 断言缺失的权限点，便于前端提示
  }); // 结束权限不足用例
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

describe('模块新建（POST /modules）', () => { // 新建默认 draft，编码区域内唯一且含软删行
  it('合法创建 → 201，默认 draft + one_time，字段原样回显', async () => { // 正向路径
    const res = await request(app) // 发起新建
      .post('/api/v1/modules') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ // 合法请求体
        code: 'notes.board', // 含点号编码，验证正则放行
        name: { 'zh-CN': '笔记看板' }, // 单语言名称
        summary: { 'zh-CN': '轻量笔记与看板组合' }, // 简介
        sort_order: 7, // 排序权重
        entitlements_required: ['comic.workbench'], // 依赖种子模块
      }); // 结束请求体
    expect(res.status).toBe(201); // 断言 201
    expect(res.body.module.code).toBe('notes.board'); // 断言编码回显
    expect(res.body.module.status).toBe('draft'); // 断言初始状态为 draft
    expect(res.body.module.unlock_mode).toBe('one_time'); // 断言解锁方式固定值
    expect(res.body.module.requires).toEqual(['comic.workbench']); // 断言依赖回显
    const row = db.prepare(`SELECT status FROM modules WHERE code = 'notes.board' AND region = 'cn'`).get() as { status: string }; // 回读库内状态
    expect(row.status).toBe('draft'); // 断言落库为 draft
  }); // 结束正向用例

  it('编码重复 → 409 module code already exists', async () => { // 撞种子模块编码
    const res = await request(app) // 用已存在的种子编码
      .post('/api/v1/modules') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ code: 'comic.workbench', name: { 'zh-CN': '重复' } }); // 重复编码
    expect(res.status).toBe(409); // 断言 409
    expect(res.body.message).toBe('module code already exists'); // 断言文案
  }); // 结束重码用例

  it('软删后的编码仍被占用 → 409', async () => { // dup 预检不滤 deleted_at，软删行同样占码
    await request(app).post('/api/v1/modules').set(adminHeaders()).send({ code: 'temp.mod', name: { 'zh-CN': '临时' } }); // 先建 draft 模块
    await request(app).delete('/api/v1/modules/temp.mod').set(adminHeaders()); // draft 可直接软删
    const res = await request(app) // 再用同一编码新建
      .post('/api/v1/modules') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ code: 'temp.mod', name: { 'zh-CN': '复用' } }); // 复用软删编码
    expect(res.status).toBe(409); // 断言 409：UNIQUE(region, code) 含软删行
  }); // 结束软删占码用例

  it('前置依赖不存在 → 400 required modules not found 且 details.required 回传缺失项', async () => { // 依赖校验
    const res = await request(app) // 依赖一个幽灵模块
      .post('/api/v1/modules') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ code: 'dep.test', name: { 'zh-CN': '依赖测试' }, entitlements_required: ['ghost.mod'] }); // 缺失依赖
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.message).toBe('required modules not found'); // 断言文案
    expect(res.body.details.required).toEqual(['ghost.mod']); // 断言缺失项回传，供前端引导
  }); // 结束依赖缺失用例

  it('非法编码（大写/前导符号）→ 400 VALIDATION_FAILED', async () => { // zod 正则拦截
    const res = await request(app) // 大写编码违反正则
      .post('/api/v1/modules') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ code: 'Bad.Code', name: { 'zh-CN': '坏编码' } }); // 非法编码
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言错误码
  }); // 结束非法编码用例
}); // 结束模块新建分组

describe('模块编辑（PATCH /modules/:code）', () => { // 仅文案/排序/依赖可改，状态走 /status
  it('更新名称与排序 → 200 且回读一致', async () => { // 正向编辑
    const res = await request(app) // 编辑种子模块
      .patch('/api/v1/modules/comic.workbench') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ name: { 'zh-CN': '漫画工作台 Pro' }, sort_order: 99 }); // 改名 + 改排序
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.module.name['zh-CN']).toBe('漫画工作台 Pro'); // 断言新名称
    expect(res.body.module.sort_order).toBe(99); // 断言新排序
    expect(res.body.module.status).toBe('active'); // 断言状态未被本路由改动
  }); // 结束正向用例

  it('空更新 → 400 at least one editable field must be provided', async () => { // refine 拦截无字段请求
    const res = await request(app) // 不传任何可编辑字段
      .patch('/api/v1/modules/comic.workbench') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({}); // 空请求体
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.message).toBe('at least one editable field must be provided'); // 断言文案
  }); // 结束空更新用例

  it('模块不存在 → 404 module not found', async () => { // 未知编码
    const res = await request(app) // 编辑幽灵模块
      .patch('/api/v1/modules/no.such.module') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ sort_order: 1 }); // 合法字段
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.message).toBe('module not found'); // 断言文案
  }); // 结束不存在用例

  it('依赖含缺失项 → 400 required modules not found', async () => { // 编辑时同样校验依赖存在性
    const res = await request(app) // 改依赖为幽灵模块
      .patch('/api/v1/modules/comic.workbench') // 管理端点
      .set(adminHeaders()) // 管理令牌
      .send({ entitlements_required: ['ghost.mod'] }); // 缺失依赖
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.details.required).toEqual(['ghost.mod']); // 断言缺失项
  }); // 结束依赖校验用例
}); // 结束模块编辑分组

describe('模块软删除（DELETE /modules/:code）', () => { // active 须先归档；重复删除幂等回放
  it('active 模块直接删除 → 409 module must be archived before deletion', async () => { // 在售保护
    const res = await request(app) // 种子模块为 active
      .delete('/api/v1/modules/comic.workbench') // 管理端点
      .set(adminHeaders()); // 管理令牌
    expect(res.status).toBe(409); // 断言 409
    expect(res.body.message).toBe('module must be archived before deletion'); // 断言提示先归档
  }); // 结束 active 保护用例

  it('draft 删除 → 200 deleted:true；重复删除回放同一 deleted_at', async () => { // 软删 + 幂等回放
    await request(app).post('/api/v1/modules').set(adminHeaders()).send({ code: 'del.me', name: { 'zh-CN': '待删' } }); // 先建 draft 模块
    const first = await request(app).delete('/api/v1/modules/del.me').set(adminHeaders()); // 第一次软删
    expect(first.status).toBe(200); // 断言 200
    expect(first.body.module.deleted).toBe(true); // 断言删除标记
    expect(typeof first.body.module.deleted_at).toBe('string'); // 断言删除时间存在
    const second = await request(app).delete('/api/v1/modules/del.me').set(adminHeaders()); // 重复删除
    expect(second.status).toBe(200); // 断言回放 200
    expect(second.body.module.deleted_at).toBe(first.body.module.deleted_at); // 断言回显同一删除时间，未被刷新
    const pub = await request(app).get('/api/v1/modules'); // 公开列表复查
    expect(pub.body.modules.some((m: { code: string }) => m.code === 'del.me')).toBe(false); // 断言软删模块不再外露
  }); // 结束软删回放用例

  it('模块不存在 → 404 module not found', async () => { // 未知编码
    const res = await request(app) // 删幽灵模块
      .delete('/api/v1/modules/no.such.module') // 管理端点
      .set(adminHeaders()); // 管理令牌
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.message).toBe('module not found'); // 断言文案
  }); // 结束不存在用例
}); // 结束模块软删除分组

describe('管理端模块列表（GET /modules/manage）', () => { // 含 draft/archived，支持 q/status 过滤
  it('返回 draft 模块与 total；注册顺序先于 /modules/:code', async () => { // 若被详情路由吞掉会 404 而非 200
    await request(app).post('/api/v1/modules').set(adminHeaders()).send({ code: 'draft.one', name: { 'zh-CN': '草稿一' } }); // 造一条 draft
    const res = await request(app).get('/api/v1/modules/manage').set(adminHeaders()); // 请求管理列表
    expect(res.status).toBe(200); // 断言 200：证明 manage 未被 :code 吞掉
    expect(res.body.total).toBe(res.body.modules.length); // 断言总数与列表一致
    const draft = res.body.modules.find((m: { code: string }) => m.code === 'draft.one'); // 找草稿模块
    expect(draft.status).toBe('draft'); // 断言 draft 可见（公开列表不含 draft）
    expect(draft.created_at).toBeTruthy(); // 断言管理视图带创建时间
  }); // 结束全量列表用例

  it('status=draft 过滤 + q 名称搜索命中', async () => { // 组合过滤
    await request(app).post('/api/v1/modules').set(adminHeaders()).send({ code: 'filter.me', name: { 'zh-CN': '过滤器' } }); // 造 draft
    const byStatus = await request(app).get('/api/v1/modules/manage?status=draft').set(adminHeaders()); // 按状态过滤
    expect(byStatus.body.modules.every((m: { status: string }) => m.status === 'draft')).toBe(true); // 断言全部为 draft
    const byQ = await request(app).get('/api/v1/modules/manage?q=filter.me').set(adminHeaders()); // 按编码搜索
    expect(byQ.body.modules.length).toBe(1); // 断言唯一命中
    expect(byQ.body.modules[0].code).toBe('filter.me'); // 断言命中项
  }); // 结束过滤用例

  it('非法 status → 400 VALIDATION_FAILED', async () => { // 状态枚举校验
    const res = await request(app).get('/api/v1/modules/manage?status=offline').set(adminHeaders()); // 非法状态
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.message).toBe('status must be one of draft/active/archived'); // 断言文案
  }); // 结束非法状态用例
}); // 结束管理列表分组

describe('管理端权益列表（GET /entitlements）', () => { // q/status/region 过滤 + limit/offset 分页
  it('发放后可被列出，字段含模块编码与版本', async () => { // 正向列表
    const session = await login('13800000020'); // 建用户
    await request(app).post('/api/v1/entitlements/grant').set(adminHeaders()).send({ user_id: session.userId, module_code: 'comic.workbench' }); // 发放权益
    const res = await request(app).get('/api/v1/entitlements').set(adminHeaders()); // 请求列表
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.total).toBe(1); // 断言总数
    expect(res.body.limit).toBe(20); // 断言默认分页大小
    const item = res.body.entitlements[0]; // 取首条
    expect(item.user_id).toBe(session.userId); // 断言归属用户
    expect(item.module_code).toBe('comic.workbench'); // 断言模块编码联表成功
    expect(item.status).toBe('active'); // 断言状态
    expect(item.version).toBe(1); // 断言初始版本
  }); // 结束正向用例

  it('q 命中模块编码；status=revoked 只回已回收项', async () => { // 搜索与状态过滤
    const session = await login('13800000021'); // 建用户
    const granted = await request(app).post('/api/v1/entitlements/grant').set(adminHeaders()).send({ user_id: session.userId, module_code: 'comic.workbench' }); // 发放
    const byQ = await request(app).get('/api/v1/entitlements?q=comic.work').set(adminHeaders()); // 按模块编码片段搜索
    expect(byQ.body.entitlements.length).toBe(1); // 断言搜索命中
    await request(app).post(`/api/v1/entitlements/${granted.body.entitlement.id}/revoke`).set(adminHeaders()).send({}); // 回收该权益
    const byStatus = await request(app).get('/api/v1/entitlements?status=revoked').set(adminHeaders()); // 按状态过滤
    expect(byStatus.body.entitlements.length).toBe(1); // 断言仅一条已回收
    expect(byStatus.body.entitlements[0].status).toBe('revoked'); // 断言状态
    const activeOnly = await request(app).get('/api/v1/entitlements?status=active').set(adminHeaders()); // 过滤 active
    expect(activeOnly.body.entitlements.length).toBe(0); // 断言已无 active
  }); // 结束搜索过滤用例

  it('非法 status / region → 400 VALIDATION_FAILED', async () => { // 枚举校验
    const badStatus = await request(app).get('/api/v1/entitlements?status=banned').set(adminHeaders()); // 非法状态
    expect(badStatus.status).toBe(400); // 断言 400
    expect(badStatus.body.message).toBe('status must be one of active/expired/revoked'); // 断言文案
    const badRegion = await request(app).get('/api/v1/entitlements?region=moon').set(adminHeaders()); // 非法地区
    expect(badRegion.status).toBe(400); // 断言 400
    expect(badRegion.body.message).toBe('region must be cn or global'); // 断言文案
  }); // 结束枚举校验用例
}); // 结束权益列表分组

describe('权益审计事件（GET /entitlements/:id/events）', () => { // 按写入顺序升序返回完整流转链
  it('发放→回收后返回两条事件，顺序与字段正确', async () => { // 正向审计链
    const session = await login('13800000022'); // 建用户
    const granted = await request(app).post('/api/v1/entitlements/grant').set(adminHeaders()).send({ user_id: session.userId, module_code: 'comic.workbench' }); // 发放
    const entitlementId = granted.body.entitlement.id as string; // 记录权益 id
    await request(app).post(`/api/v1/entitlements/${entitlementId}/revoke`).set(adminHeaders()).send({ reason: '审计验证' }); // 回收
    const res = await request(app).get(`/api/v1/entitlements/${entitlementId}/events`).set(adminHeaders()); // 取事件链
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.events.length).toBe(2); // 断言两条事件
    expect(res.body.events[0].from_status).toBeNull(); // 断言发放事件无前置状态
    expect(res.body.events[0].to_status).toBe('active'); // 断言发放目标状态
    expect(res.body.events[1].from_status).toBe('active'); // 断言回收前置状态
    expect(res.body.events[1].to_status).toBe('revoked'); // 断言回收目标状态
    expect(res.body.events[1].reason).toBe('审计验证'); // 断言原因原样返回
  }); // 结束正向用例

  it('权益不存在 → 404 entitlement not found', async () => { // 未知权益
    const res = await request(app).get('/api/v1/entitlements/not-an-entitlement/events').set(adminHeaders()); // 幽灵权益
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.message).toBe('entitlement not found'); // 断言文案
  }); // 结束不存在用例
}); // 结束审计事件分组

describe('公开目录搜索（GET /modules?q=）', () => { // q 命中编码或多语言名称
  it('q 命中编码片段 → 仅返回匹配模块；空结果不报错', async () => { // 搜索行为
    const hit = await request(app).get('/api/v1/modules?q=comic.work'); // 按编码片段搜索
    expect(hit.status).toBe(200); // 断言 200
    expect(hit.body.modules.length).toBe(1); // 断言唯一命中种子模块
    expect(hit.body.modules[0].code).toBe('comic.workbench'); // 断言命中项
    const miss = await request(app).get('/api/v1/modules?q=no-such-thing'); // 无匹配搜索
    expect(miss.status).toBe(200); // 断言 200，空集不报错
    expect(miss.body.modules.length).toBe(0); // 断言空结果
  }); // 结束搜索用例
}); // 结束公开目录搜索分组

describe('模块详情（GET /modules/:code）', () => { // 扁平响应：顶层即模块字段，price_history 必须含价格行 id 供管理端调价
  it('详情返回 price_history 且每行带 id / currency / amount_minor / 时间窗口', async () => { // 管理端调价 UI 依赖价格行 id 调 PUT/DELETE /modules/prices/:id
    const created = await request(app) // 先造一条价格行
      .post('/api/v1/modules/comic.workbench/prices') // 新增价格端点
      .set(adminHeaders()) // 管理令牌
      .send({ currency: 'CNY', amount_minor: 9900, effective_from: '2026-01-01T00:00:00.000Z' }); // 永久生效价格
    expect(created.status).toBe(201); // 断言 201，价格行已创建
    const priceId = created.body.price.id as string; // 记录价格行主键，稍后与详情对拍
    const res = await request(app).get('/api/v1/modules/comic.workbench'); // 拉取公开详情
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.code).toBe('comic.workbench'); // 扁平响应：顶层即模块码，无 module 包裹层
    expect(Array.isArray(res.body.price_history)).toBe(true); // 历史价格必须为数组
    expect(res.body.price_history.length).toBe(1); // 当前仅一条价格行
    expect(res.body.price_history[0].id).toBe(priceId); // 关键断言：价格行 id 必须透出，否则管理端无法调价
    expect(res.body.price_history[0].amount_minor).toBe(9900); // 断言金额回显一致
    expect(res.body.current_price.amount_minor).toBe(9900); // 当前生效价格同步断言
  }); // 结束详情价格历史用例
}); // 结束模块详情分组

// ---------- 商城订单闭环：付费模块下单 → 结算 → 发放权益 ----------

/** 读取订单行，供状态、金额与关联权益断言 */
function orderRow(id: string) { // 订单主键查询
  return db // 数据库句柄
    .prepare(`SELECT status, currency, amount_minor, entitlement_id, paid_at, cancelled_at FROM module_orders WHERE id = ?`) // 只取断言关心列
    .get(id) as { status: string; currency: string; amount_minor: number; entitlement_id: string | null; paid_at: string | null; cancelled_at: string | null } | undefined; // 未命中返回 undefined
} // 结束 orderRow

/** 统计某用户在某模块上的订单来源权益条数，用于验证结算幂等 */
function orderEntitlementCount(userId: string, moduleCode: string): number { // 只统计 source_id 非空的订单权益
  const row = db // 数据库句柄
    .prepare( // 预编译：联模块表按编码过滤
      `SELECT COUNT(*) AS c FROM entitlements e
       INNER JOIN modules m ON m.id = e.module_id
       WHERE e.user_id = ? AND m.code = ? AND e.source_id IS NOT NULL`,
    ) // 结束预编译
    .get(userId, moduleCode) as { c: number } | undefined; // 命中行统一收窄类型
  return row?.c ?? 0; // 未命中按 0 处理
} // 结束 orderEntitlementCount

describe('付费模块门禁与商城订单', () => { // 覆盖「不能免费拿付费模块」与完整下单结算链路
  it('付费模块调解锁接口 → 402 PAYMENT_REQUIRED 并回传成交价；免费模块仍可直接解锁', async () => { // 付费墙口径
    const session = await login('13900000041'); // 登录普通用户
    const paid = await request(app) // 尝试免费解锁付费模块
      .post('/api/v1/entitlements') // 解锁端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'paid-unlock-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic' }); // 种子付费模块 ¥99
    expect(paid.status).toBe(402); // 断言 402，提示先结算
    expect(paid.body.code).toBe('PAYMENT_REQUIRED'); // 断言错误码
    expect(paid.body.details.order_required).toBe(true); // 断言显式要求走下单
    expect(paid.body.details.price.amount_minor).toBe(9900); // 断言回传成交价，前端可直接展示
    expect(paid.body.details.price.currency).toBe('CNY'); // 断言币种

    const free = await request(app) // 免费模块行为不变
      .post('/api/v1/entitlements') // 解锁端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'free-unlock-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.workbench' }); // 免费种子模块
    expect(free.status).toBe(201); // 断言 201，免费模块仍可直接解锁
  }); // 结束付费门禁用例

  it('下单 → 重复下单回放 → 取消 → 可重新下单', async () => { // 订单生命周期
    const session = await login('13900000042'); // 登录
    const first = await request(app) // 首次下单
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic' }); // 付费模块
    expect(first.status).toBe(201); // 断言 201
    expect(first.body.order.status).toBe('pending'); // 断言初始状态
    expect(first.body.order.amount_minor).toBe(9900); // 断言金额取服务端快照
    const orderId = first.body.order.id as string; // 记录订单号

    const replay = await request(app) // 用新幂等键再次下单
      .post('/api/v1/orders') // 同端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'order-2' }) // 新幂等键，证明回放靠业务幂等而非幂等中间件
      .send({ module_code: 'comic.genpack.basic' }); // 同模块
    expect(replay.status).toBe(200); // 断言 200 表示复用
    expect(replay.body.order.id).toBe(orderId); // 断言同一张单，不产生重复待付

    const cancelled = await request(app) // 取消订单
      .post(`/api/v1/orders/${orderId}/cancel`) // 取消端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'order-cancel-1' }) // 鉴权 + 幂等键
      .send({}); // 空体
    expect(cancelled.status).toBe(200); // 断言 200
    expect(orderRow(orderId)?.status).toBe('cancelled'); // 断言落库为已取消
    expect(orderRow(orderId)?.cancelled_at).not.toBeNull(); // 断言取消时间已写

    const again = await request(app) // 取消后可重新下单
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'order-3' }) // 新幂等键
      .send({ module_code: 'comic.genpack.basic' }); // 同模块
    expect(again.status).toBe(201); // 断言 201，部分唯一索引只拦 pending
    expect(again.body.order.id).not.toBe(orderId); // 断言新订单号
  }); // 结束订单生命周期用例

  it('前置依赖未满足 → 403 并回传缺失清单；免费模块不能下单 → 400', async () => { // 下单前置校验
    const session = await login('13900000043'); // 登录
    const blocked = await request(app) // 未买基础版直接下单专业版
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'dep-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.pro' }); // 依赖基础版的付费模块
    expect(blocked.status).toBe(403); // 断言 403
    expect(blocked.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言错误码
    expect(blocked.body.details.required).toEqual(['comic.genpack.basic']); // 断言精确缺失清单

    const freeOrder = await request(app) // 免费模块走订单无意义
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'free-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.workbench' }); // 免费模块
    expect(freeOrder.status).toBe(400); // 断言 400
    expect(freeOrder.body.message).toBe('module is free, unlock it directly'); // 断言引导到解锁接口
  }); // 结束下单前置校验用例

  it('管理端结算 → 发放订单来源权益；重复结算回放不重复发放；结算后可下单后续模块', async () => { // 结算闭环
    const session = await login('13900000044'); // 登录
    const created = await request(app) // 下单基础版
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'settle-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic' }); // 付费模块
    expect(created.status).toBe(201); // 断言 201
    const orderId = created.body.order.id as string; // 订单号

    const settled = await request(app) // 管理端结算
      .post(`/api/v1/orders/${orderId}/settle`) // 结算端点
      .set(adminHeaders()) // 管理令牌
      .send({ reason: '线下转账已到账' }); // 结算备注
    expect(settled.status).toBe(200); // 断言 200
    expect(settled.body.order.status).toBe('paid'); // 断言订单已结算
    const entitlementId = settled.body.order.entitlement_id as string; // 结算后权益主键
    expect(entitlementId).toBeTruthy(); // 断言已发放权益
    const row = orderRow(orderId); // 读库对拍
    expect(row?.status).toBe('paid'); // 断言落库已结算
    expect(row?.entitlement_id).toBe(entitlementId); // 断言订单关联权益
    expect(row?.paid_at).not.toBeNull(); // 断言结算时间已写

    const entitlements = await request(app) // 用户视角确认权益生效
      .get('/api/v1/me/entitlements') // 我的权益
      .set({ authorization: `Bearer ${session.token}` }); // 鉴权
    expect(entitlements.body.entitlements.map((e: { module_code: string }) => e.module_code)).toContain('comic.genpack.basic'); // 断言权益列表含该模块

    const events = await request(app) // 审计链
      .get(`/api/v1/entitlements/${entitlementId}/events`) // 事件端点
      .set(adminHeaders()); // 管理令牌
    expect(events.body.events[0].reason).toBe('线下转账已到账'); // 断言结算备注写入事件原因
    expect(events.body.events[0].actor).toBe('admin'); // 断言操作者

    const replay = await request(app) // 重复结算
      .post(`/api/v1/orders/${orderId}/settle`) // 同端点
      .set(adminHeaders()) // 管理令牌
      .send({}); // 空体
    expect(replay.status).toBe(200); // 断言 200 回放
    expect(replay.body.order.entitlement_id).toBe(entitlementId); // 断言回放同一权益
    expect(orderEntitlementCount(session.userId, 'comic.genpack.basic')).toBe(1); // 断言未重复发放

    const nextOrder = await request(app) // 依赖已满足后可下单专业版
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'settle-order-2' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.pro' }); // 依赖基础版的模块
    expect(nextOrder.status).toBe(201); // 断言依赖链放行
  }); // 结束结算闭环用例

  it('已取消订单不能结算；已拥有模块再下单 → 409', async () => { // 反向分支
    const session = await login('13900000045'); // 登录
    const created = await request(app) // 下单
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'rev-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic' }); // 付费模块
    const orderId = created.body.order.id as string; // 订单号
    await request(app) // 先取消
      .post(`/api/v1/orders/${orderId}/cancel`) // 取消端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'rev-order-cancel' }) // 鉴权 + 幂等键
      .send({}); // 空体
    const settleCancelled = await request(app) // 结算已取消订单
      .post(`/api/v1/orders/${orderId}/settle`) // 结算端点
      .set(adminHeaders()) // 管理令牌
      .send({}); // 空体
    expect(settleCancelled.status).toBe(409); // 断言 409
    expect(settleCancelled.body.message).toBe('cancelled order cannot be settled'); // 断言文案

    const own = await request(app) // 先直接解锁免费模块
      .post('/api/v1/entitlements') // 解锁端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'own-unlock' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.workbench' }); // 免费模块
    expect(own.status).toBe(201); // 断言已拥有

    const dupOrder = await request(app) // 已拥有后给「付费模块」下单：先给该模块造价格
      .post('/api/v1/modules/comic.workbench/prices') // 管理端加价格行
      .set(adminHeaders()) // 管理令牌
      .send({ currency: 'CNY', amount_minor: 9900, effective_from: '2026-01-01T00:00:00.000Z' }); // 立即生效价格
    expect(dupOrder.status).toBe(201); // 断言价格行已建

    const blocked = await request(app) // 再尝试下单已拥有的模块
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'dup-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.workbench' }); // 刚加了价格的已拥有模块
    expect(blocked.status).toBe(409); // 断言 409
    expect(blocked.body.message).toBe('module already unlocked'); // 断言文案
  }); // 结束反向分支用例

  it('依赖成环被拒绝：互指与自指都返回 400', async () => { // 环检测
    const created = async (code: string, requires: string[] = []) => request(app) // 造模块的辅助
      .post('/api/v1/modules') // 创建端点
      .set(adminHeaders()) // 管理令牌
      .send({ code, name: { 'zh-CN': code }, entitlements_required: requires }); // 最小字段集
    expect((await created('cycle.a')).status).toBe(201); // A 无依赖
    expect((await created('cycle.b', ['cycle.a'])).status).toBe(201); // B 依赖 A

    const mutual = await request(app) // 把 A 改成依赖 B，形成 A→B→A
      .patch('/api/v1/modules/cycle.a') // 编辑端点
      .set(adminHeaders()) // 管理令牌
      .send({ entitlements_required: ['cycle.b'] }); // 互指
    expect(mutual.status).toBe(400); // 断言 400
    expect(mutual.body.message).toBe('module dependency cycle detected'); // 断言成环文案

    expect((await created('cycle.self')).status).toBe(201); // 再建一个无依赖模块
    const self = await request(app) // 改成依赖自身
      .patch('/api/v1/modules/cycle.self') // 编辑端点
      .set(adminHeaders()) // 管理令牌
      .send({ entitlements_required: ['cycle.self'] }); // 自指
    expect(self.status).toBe(400); // 断言 400
    expect(self.body.message).toBe('module dependency cycle detected'); // 断言同样是环
  }); // 结束环检测用例

  it('管理端订单列表跨用户可见、支持状态过滤；普通用户 403', async () => { // 人工结算需要全量视图
    const session = await login('13900000046'); // 登录普通用户
    const created = await request(app) // 该用户下单
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'manage-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic' }); // 付费模块
    expect(created.status).toBe(201); // 断言下单成功
    const orderId = created.body.order.id as string; // 订单号

    const pendingList = await request(app) // 管理端按状态查待结算
      .get('/api/v1/orders/manage?status=pending') // 管理列表端点
      .set(adminHeaders()); // 管理令牌
    expect(pendingList.status).toBe(200); // 断言 200
    expect(pendingList.body.orders.some((row: { id: string }) => row.id === orderId)).toBe(true); // 断言能跨用户看到该单
    expect(pendingList.body.total).toBeGreaterThanOrEqual(1); // 断言总数可用

    const paidList = await request(app) // 已结算过滤应为空
      .get('/api/v1/orders/manage?status=paid') // 只查已结算
      .set(adminHeaders()); // 管理令牌
    expect(paidList.body.orders.some((row: { id: string }) => row.id === orderId)).toBe(false); // 断言状态过滤生效

    const denied = await request(app) // 普通用户访问管理列表
      .get('/api/v1/orders/manage') // 管理列表端点
      .set({ authorization: `Bearer ${session.token}` }); // 用户令牌
    expect(denied.status).toBe(403); // 断言 403，不泄漏跨用户订单
  }); // 结束管理端列表用例

  it('管理端可导出订单 xlsx；普通用户 403', async () => { // 导出端点复用同一 RBAC，产物为可解析的 xlsx
    const session = await login('13900000047'); // 登录普通用户
    const created = await request(app) // 该用户下一张付费模块订单
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'export-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic' }); // 种子付费模块
    expect(created.status).toBe(201); // 断言下单成功
    const orderId = created.body.order.id as string; // 记录订单号供导出表对拍

    const denied = await request(app) // 普通用户尝试导出
      .get('/api/v1/orders/export') // 导出端点
      .set({ authorization: `Bearer ${session.token}` }); // 用户令牌
    expect(denied.status).toBe(403); // 断言 403，与管理列表同一权限口径

    const exported = await request(app) // 管理令牌导出全量订单
      .get('/api/v1/orders/export') // 导出端点
      .set(adminHeaders()) // 管理令牌
      .buffer(true) // 强制缓冲响应体，避免 superagent 按 MIME 误解析
      .parse((res, cb) => { // 自定义解析：原样收集二进制字节，xlsx 不经过 JSON/文本 parser
        const chunks: Buffer[] = []; // 分片收集器
        res.on('data', (chunk: Buffer) => chunks.push(chunk)); // 逐块入列
        res.on('end', () => cb(null, Buffer.concat(chunks))); // 结束后拼接为完整 Buffer
      }); // 自定义解析结束
    expect(exported.status).toBe(200); // 断言 200
    expect(exported.headers['content-type']).toContain('spreadsheetml'); // 断言 xlsx MIME
    expect(exported.headers['content-disposition']).toContain('.xlsx'); // 断言附件下载文件名

    const workbook = new ExcelJS.Workbook(); // 读回响应字节做内容校验
    const rawBody = exported.body as Buffer; // 自定义 parser 已把响应收集为 Node Buffer
    await workbook.xlsx.load(rawBody.buffer as never); // exceljs 本地 Buffer 即 ArrayBuffer，取底层 ArrayBuffer 传入以规避类型分裂
    const sheet = workbook.getWorksheet('orders'); // 取订单工作表
    expect(sheet).toBeTruthy(); // 断言工作表存在
    expect(sheet!.getRow(1).getCell(1).value).toBe('订单号'); // 断言表头第一列为订单号

    let found = false; // 标记导出表是否含刚下的订单
    sheet!.eachRow((row, rowNumber) => { // 逐行扫描，跳过表头
      if (rowNumber === 1) return; // 表头不参与匹配
      if (String(row.getCell(1).value) === orderId) found = true; // 第一列即订单号
    }); // 逐行扫描结束
    expect(found).toBe(true); // 断言订单已进入导出清单
  }); // 结束导出 xlsx 用例
}); // 结束商城订单分组

// ---------- 渠道支付回调：HMAC 签名 + 交易号幂等 ----------

/** 计算回调签名：与被测实现完全相同的 canonical 串与算法 */
function notifySignature(orderId: string, channel: string, txn: string, amount: number, ts: number, secret: string = NOTIFY_SECRET): string {
  // HMAC-SHA256 输出 hex
  return createHmac('sha256', secret).update(`${orderId}.${channel}.${txn}.${amount}.${ts}`).digest('hex'); // canonical 串逐字段拼接
} // 结束 notifySignature

/** 当前秒级时间戳：保证落在服务端 ±300s 窗口内 */
function nowSeconds(): number {
  // 取整到秒
  return Math.floor(Date.now() / 1000); // 返回：交回本步骤结果供断言使用
} // 结束 nowSeconds

describe('渠道支付回调（POST /orders/:id/payment-notify）', () => { // 无商户凭证下可验证的在线支付接入层
  it('未配置 MIM_PAYMENT_NOTIFY_SECRET → 503，且人工结算不受影响', async () => { // 环境不具备时明确报缺
    const noSecretApp = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 不含回调密钥的实例
    const res = await request(noSecretApp) // 直接回调一个不存在的订单
      .post('/api/v1/orders/ord_any/payment-notify') // 回调端点
      .set({ 'x-payment-timestamp': String(nowSeconds()), 'x-payment-signature': 'deadbeef' }) // 任意签名头
      .send({ channel: 'alipay', channel_txn_id: 'txn-1', amount_minor: 9900 }); // 合法报文
    expect(res.status).toBe(503); // 断言 503
    expect(res.body.code).toBe('PAYMENT_NOTIFY_NOT_CONFIGURED'); // 断言错误码
    expect(res.body.details.env).toBe('MIM_PAYMENT_NOTIFY_SECRET'); // 断言指出缺失变量
  }); // 结束未配置用例

  it('签名正确 → 订单结算并发放权益，渠道交易号落库；同一交易号重复回调 200 回放', async () => { // 主链路 + 幂等
    const notifyApp = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_PAYMENT_NOTIFY_SECRET: NOTIFY_SECRET } }); // 配齐密钥的实例
    const session = await login('13900000048'); // 登录下单用户
    const created = await request(notifyApp) // 下单并指定在线渠道
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'notify-order-1' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic', channel: 'alipay' }); // 渠道 alipay
    expect(created.status).toBe(201); // 断言下单成功
    expect(created.body.order.channel).toBe('alipay'); // 断言渠道已按请求落地
    const orderId = created.body.order.id as string; // 订单号
    const amount = created.body.order.amount_minor as number; // 成交金额

    const ts = nowSeconds(); // 当前时间戳
    const ok = await request(notifyApp) // 正确签名的回调
      .post(`/api/v1/orders/${orderId}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts), 'x-payment-signature': notifySignature(orderId, 'alipay', 'txn-alipay-1', amount, ts) }) // 正确签名
      .send({ channel: 'alipay', channel_txn_id: 'txn-alipay-1', amount_minor: amount }); // 合法报文
    expect(ok.status).toBe(200); // 断言结算成功
    expect(ok.body.replayed).toBe(false); // 断言首次不是回放
    expect(ok.body.order.status).toBe('paid'); // 断言订单已结算
    expect(orderRow(orderId)?.status).toBe('paid'); // 断言落库状态
    expect(orderEntitlementCount(session.userId, 'comic.genpack.basic')).toBe(1); // 断言已发放权益

    const again = await request(notifyApp) // 同一交易号重复回调
      .post(`/api/v1/orders/${orderId}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts), 'x-payment-signature': notifySignature(orderId, 'alipay', 'txn-alipay-1', amount, ts) }) // 同一签名
      .send({ channel: 'alipay', channel_txn_id: 'txn-alipay-1', amount_minor: amount }); // 同一报文
    expect(again.status).toBe(200); // 断言 200 回放
    expect(again.body.replayed).toBe(true); // 断言标记为回放
    expect(again.body.order.entitlement_id).toBe(ok.body.order.entitlement_id); // 断言回放同一权益
    expect(orderEntitlementCount(session.userId, 'comic.genpack.basic')).toBe(1); // 断言未重复发放

    const differentTxn = await request(notifyApp) // 换交易号再回调同一已结算订单
      .post(`/api/v1/orders/${orderId}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts), 'x-payment-signature': notifySignature(orderId, 'alipay', 'txn-alipay-2', amount, ts) }) // 新交易号签名
      .send({ channel: 'alipay', channel_txn_id: 'txn-alipay-2', amount_minor: amount }); // 新交易号报文
    expect(differentTxn.status).toBe(409); // 断言 409，二次扣款需人工对账
    expect(differentTxn.body.message).toBe('order already settled by another transaction'); // 断言文案
  }); // 结束主链路用例

  it('金额或渠道与下单快照不一致 → 400；签名错误 / 时间戳过期 → 401', async () => { // 拒绝错账与伪造
    const notifyApp = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_PAYMENT_NOTIFY_SECRET: NOTIFY_SECRET } }); // 配齐密钥的实例
    const session = await login('13900000049'); // 登录
    const created = await request(notifyApp) // 下单，渠道 alipay
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'notify-order-2' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic', channel: 'alipay' }); // 渠道 alipay
    const orderId = created.body.order.id as string; // 订单号
    const amount = created.body.order.amount_minor as number; // 金额
    const ts = nowSeconds(); // 时间戳

    const wrongAmount = await request(notifyApp) // 金额少付
      .post(`/api/v1/orders/${orderId}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts), 'x-payment-signature': notifySignature(orderId, 'alipay', 'txn-2', amount - 100, ts) }) // 按少付金额签名
      .send({ channel: 'alipay', channel_txn_id: 'txn-2', amount_minor: amount - 100 }); // 少付报文
    expect(wrongAmount.status).toBe(400); // 断言 400
    expect(wrongAmount.body.message).toBe('amount mismatch'); // 断言文案
    expect(wrongAmount.body.details.expected).toBe(amount); // 断言回传应付金额

    const wrongChannel = await request(notifyApp) // 渠道不符
      .post(`/api/v1/orders/${orderId}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts), 'x-payment-signature': notifySignature(orderId, 'wechat', 'txn-3', amount, ts) }) // 按微信签名
      .send({ channel: 'wechat', channel_txn_id: 'txn-3', amount_minor: amount }); // 微信报文
    expect(wrongChannel.status).toBe(400); // 断言 400
    expect(wrongChannel.body.message).toBe('channel mismatch'); // 断言文案

    const badSignature = await request(notifyApp) // 伪造签名
      .post(`/api/v1/orders/${orderId}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts), 'x-payment-signature': 'f'.repeat(64) }) // 长度正确内容错误
      .send({ channel: 'alipay', channel_txn_id: 'txn-4', amount_minor: amount }); // 合法报文
    expect(badSignature.status).toBe(401); // 断言 401
    expect(badSignature.body.message).toBe('invalid payment signature'); // 断言文案

    const expired = await request(notifyApp) // 过期时间戳（重放攻击面）
      .post(`/api/v1/orders/${orderId}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts - 3600), 'x-payment-signature': notifySignature(orderId, 'alipay', 'txn-5', amount, ts - 3600) }) // 一小时前的签名
      .send({ channel: 'alipay', channel_txn_id: 'txn-5', amount_minor: amount }); // 合法报文
    expect(expired.status).toBe(401); // 断言 401
    expect(expired.body.message).toBe('payment signature expired'); // 断言文案
  }); // 结束错账与伪造用例

  it('已取消订单不接受回调 409；同一交易号用于另一张单 409', async () => { // 状态与交易号唯一性
    const notifyApp = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN, MIM_PAYMENT_NOTIFY_SECRET: NOTIFY_SECRET } }); // 配齐密钥的实例
    const session = await login('13900000050'); // 登录

    const a = await request(notifyApp) // 第一张单
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'notify-order-3' }) // 鉴权 + 幂等键
      .send({ module_code: 'comic.genpack.basic', channel: 'stripe' }); // 渠道 stripe
    const orderA = a.body.order.id as string; // 订单 A
    await request(notifyApp) // 取消订单 A
      .post(`/api/v1/orders/${orderA}/cancel`) // 取消端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'notify-cancel-a' }) // 鉴权 + 幂等键
      .send({}); // 空体
    const ts = nowSeconds(); // 时间戳
    const cancelled = await request(notifyApp) // 回调已取消订单
      .post(`/api/v1/orders/${orderA}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(ts), 'x-payment-signature': notifySignature(orderA, 'stripe', 'txn-stripe-1', 9900, ts) }) // 正确签名
      .send({ channel: 'stripe', channel_txn_id: 'txn-stripe-1', amount_minor: 9900 }); // 合法报文
    expect(cancelled.status).toBe(409); // 断言 409
    expect(cancelled.body.message).toBe('cancelled order cannot be settled'); // 断言文案

    const b = await request(notifyApp) // 重新下单得到订单 B
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${session.token}`, 'idempotency-key': 'notify-order-4' }) // 新幂等键
      .send({ module_code: 'comic.genpack.basic', channel: 'stripe' }); // 渠道 stripe
    const orderB = b.body.order.id as string; // 订单 B
    const tsB = nowSeconds(); // 时间戳
    const okB = await request(notifyApp) // 用交易号结算订单 B
      .post(`/api/v1/orders/${orderB}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(tsB), 'x-payment-signature': notifySignature(orderB, 'stripe', 'txn-stripe-2', 9900, tsB) }) // 正确签名
      .send({ channel: 'stripe', channel_txn_id: 'txn-stripe-2', amount_minor: 9900 }); // 合法报文
    expect(okB.status).toBe(200); // 断言订单 B 结算成功

    const other = await request(notifyApp) // 另一个用户下单
      .post('/api/v1/orders') // 下单端点
      .set({ authorization: `Bearer ${(await login('13900000051')).token}`, 'idempotency-key': 'notify-order-5' }) // 另一用户登录
      .send({ module_code: 'comic.genpack.basic', channel: 'stripe' }); // 渠道 stripe
    const orderC = other.body.order.id as string; // 订单 C
    const tsC = nowSeconds(); // 时间戳
    const reused = await request(notifyApp) // 复用已被订单 B 用过的交易号
      .post(`/api/v1/orders/${orderC}/payment-notify`) // 回调端点
      .set({ 'x-payment-timestamp': String(tsC), 'x-payment-signature': notifySignature(orderC, 'stripe', 'txn-stripe-2', 9900, tsC) }) // 复用交易号签名
      .send({ channel: 'stripe', channel_txn_id: 'txn-stripe-2', amount_minor: 9900 }); // 复用交易号报文
    expect(reused.status).toBe(409); // 断言 409
    expect(reused.body.message).toBe('transaction already used'); // 断言文案
  }); // 结束状态与交易号用例
}); // 结束渠道回调查询分组

describe('商城订单表结构（存量库兼容）', () => { // 防止「索引写在 schema.sql 里导致老库启动失败」回归
  it('全新库即有 channel_txn_id 列与 uq_module_orders_txn 索引；重复补迁移幂等', async () => { // 结构断言
    const cols = db.prepare('PRAGMA table_info(module_orders)').all() as Array<{ name: string }>; // 读取列定义
    expect(cols.some((c) => c.name === 'channel_txn_id')).toBe(true); // 断言列存在
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_module_orders_txn'").get() as { sql: string } | undefined; // 读取索引定义
    expect(idx?.sql).toContain('WHERE channel_txn_id IS NOT NULL'); // 断言是部分唯一索引（人工结算的 NULL 不参与）
    const again = ensureAdditiveIndexes(db); // 再跑一次补索引
    expect(again).toEqual([]); // 断言幂等：第二次不再新建
  }); // 结束结构用例
}); // 结束结构分组

