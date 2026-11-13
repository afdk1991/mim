/** 契约测试：RBAC 后台控制面 —— 身份回显 / 权限点 / 角色增删改 / 用户角色授权（铁律十一：逐行中文注释） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排 API，beforeEach 每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 仅引入类型，用于标注全局 app
import { createApp } from '../src/app.js'; // 唯一装配入口，走它才能保证中间件挂载顺序真实
import { createDatabase } from '../src/db.js'; // 内存库工厂，保证用例之间零共享状态

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足构建期强度校验
const ADMIN_TOKEN = 'test-admin-token'; // 超管引导令牌固定值，必须与 createApp 注入的 env 一致

/** 内置权限点全集：与 db.ts RBAC_PERMISSIONS 保持同步的期望值，用于断言种子完整性 */
const BUILTIN_PERMISSION_CODES = [ // 按字典序排列，便于与 API 返回顺序直接比对
  'appearance:write', // 外观 / 页面 / 语言设置
  'commerce:write', // 发货 / 售后 / 提现 / 离线确认
  'content:write', // 公告 / 更新日志 / 推广计划维护与发布归档（域脚本 seed）
  'entitlement:grant', // 发放权益
  'entitlement:read', // 查看权益
  'entitlement:revoke', // 回收权益
  'module:read', // 查看模块
  'module:write', // 变更模块状态
  'rbac:read', // 查看角色权限
  'rbac:write', // 变更角色权限
  'user:read', // 查看用户
]; // 权限点清单结束

let app: Express; // 待测应用实例（已注入引导令牌）
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄，用于直接造数与回读断言

/** 构造引导通道请求头：传 null 表示故意不带令牌，用于验证 401 分支 */
function adminHeaders(token: string | null = ADMIN_TOKEN): Record<string, string> {
  return token === null ? {} : { 'x-admin-token': token }; // 单个表达式返回请求头对象
} // adminHeaders 结束

interface Session { // 登录会话契约
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键，用于后续角色授权与列表断言
} // Session 结束

/** 登录辅助：先申请验证码再换取令牌，返回令牌与用户 ID */
async function login(identifier: string): Promise<Session> {
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
    }); // 请求体结束
  expect(loginRes.status).toBe(200); // 断言 200，登录成功
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回令牌与用户 id
} // login 结束

/** 用引导通道给指定用户授予角色，返回 supertest 链式对象供调用方继续断言 */
function grantRole(userId: string, roleCode: string) {
  return request(app) // 应用实例
    .post(`/api/v1/admin/users/${userId}/roles`) // 授权端点
    .set(adminHeaders()) // 使用超管引导通道，避免构造另一个超管用户
    .send({ role_code: roleCode }); // 角色码入参
} // grantRole 结束

beforeEach(() => { // 每例前置：重建内存库与已注入引导令牌的应用
  db = createDatabase(':memory:'); // 内存库每次全新创建，RBAC 种子自动种入
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // env 注入引导令牌即开启超管通道
}); // beforeEach 结束

describe('GET /admin/me 身份回显', () => { // 后台首屏需要知道自己是谁、有哪些权限
  it('引导令牌 → bootstrap:true、roles=[superadmin]、全量权限', async () => { // 冷启动鸡生蛋场景：无任何用户角色也能进后台
    const res = await request(app) // 引导通道请求
      .get('/api/v1/admin/me') // 身份端点
      .set(adminHeaders()); // 正确引导令牌
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.bootstrap).toBe(true); // 断言引导通道标记
    expect(res.body.user).toBeNull(); // 引导通道没有真实用户主体
    expect(res.body.roles).toEqual(['superadmin']); // 视作超级管理员
    expect(res.body.permissions).toHaveLength(BUILTIN_PERMISSION_CODES.length); // 全量权限点数量对齐
    expect(res.body.permissions).toContain('rbac:write'); // 必须含最高写权限
  }); // 引导通道用例结束

  it('Bearer 用户（viewer 角色）→ 实际 roles 与实时 permissions', async () => { // 常规 RBAC 主通道
    const session = await login('13900000001'); // 建一个真实用户
    const granted = await grantRole(session.userId, 'viewer'); // 授予只读角色
    expect(granted.status).toBe(201); // 断言首次授权成功
    const res = await request(app) // 用该用户 Bearer 请求
      .get('/api/v1/admin/me') // 身份端点
      .set('Authorization', `Bearer ${session.token}`); // 只带 Bearer
    expect(res.status).toBe(200); // viewer 含 rbac:read，应放行
    expect(res.body.bootstrap).toBe(false); // 断言非引导通道
    expect(res.body.user.id).toBe(session.userId); // 断言回显当前用户
    expect(res.body.roles).toEqual(['viewer']); // 断言实际授予角色
    expect(res.body.permissions).toEqual([ // viewer 的四条只读权限，按字典序排序
      'entitlement:read', // 查看权益
      'module:read', // 查看模块
      'rbac:read', // 查看角色权限
      'user:read', // 查看用户
    ]); // 权限断言结束
  }); // Bearer 用例结束

  it('Bearer 用户无任何角色 → 403 FORBIDDEN 且回显缺失权限点', async () => { // 登录成功不等于能进后台
    const session = await login('13900000002'); // 新建未授权用户
    const res = await request(app) // 未授权用户请求
      .get('/api/v1/admin/me') // 身份端点
      .set('Authorization', `Bearer ${session.token}`); // 仅带 Bearer
    expect(res.status).toBe(403); // 断言 403
    expect(res.body.code).toBe('FORBIDDEN'); // 断言 RBAC 专用错误码
    expect(res.body.details.permission).toBe('rbac:read'); // 断言缺失权限点，便于前端提示
  }); // 无角色用例结束

  it('无凭据 → 401 AUTH_UNAUTHORIZED；错误引导令牌 → 401 invalid admin token', async () => { // 缺失与错误同语义，避免令牌探测
    const missing = await request(app).get('/api/v1/admin/me'); // 完全不带头
    expect(missing.status).toBe(401); // 断言 401
    expect(missing.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言错误码
    expect(missing.body.message).toBe('missing bearer token'); // 落到 Bearer 解析分支
    const wrong = await request(app) // 带错误令牌
      .get('/api/v1/admin/me') // 同一端点
      .set(adminHeaders('wrong-token')); // 故意用错值
    expect(wrong.status).toBe(401); // 断言 401
    expect(wrong.body.message).toBe('invalid admin token'); // 文案来自 adminTokenMatches
  }); // 凭据缺失用例结束
}); // 身份回显分组结束

describe('权限点与角色读取', () => { // 后台勾选矩阵的数据源，必须与种子完全一致
  it('GET /admin/permissions 返回 11 个内置权限点且 builtin:true', async () => { // 权限点由种子维护（含域脚本追加的 content:write），不允许后台新增
    const res = await request(app) // 读取权限点
      .get('/api/v1/admin/permissions') // 权限点端点
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(200); // 断言 200
    const codes = (res.body.permissions as Array<{ code: string }>).map((item) => item.code); // 抽取权限码
    expect(codes).toEqual(BUILTIN_PERMISSION_CODES); // 断言与内置清单逐项一致且有序
    expect((res.body.permissions as Array<{ builtin: boolean }>).every((item) => item.builtin)).toBe(true); // 全部标记为内置
  }); // 权限点用例结束

  it('GET /admin/roles 返回 3 个内置角色，内置置顶且权限映射完整', async () => { // 一次查全量映射，避免 N+1
    const res = await request(app) // 读取角色列表
      .get('/api/v1/admin/roles') // 角色端点
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(200); // 断言 200
    const roles = res.body.roles as Array<{ code: string; builtin: boolean; permissions: string[] }>; // 角色视图数组
    expect(roles.map((role) => role.code)).toEqual(['operator', 'superadmin', 'viewer']); // 全部内置时按角色码排序
    expect(roles.every((role) => role.builtin)).toBe(true); // 三个都是内置角色
    expect(roles.find((role) => role.code === 'superadmin')!.permissions).toHaveLength(BUILTIN_PERMISSION_CODES.length); // 超管全量权限
    expect(roles.find((role) => role.code === 'viewer')!.permissions).toHaveLength(4); // 只读角色四条权限
  }); // 角色列表用例结束

  it('GET /admin/roles/:code/permissions 不存在角色 → 404', async () => { // 参数化路由需对未知角色给 404
    const res = await request(app) // 不存在的角色码
      .get('/api/v1/admin/roles/no-such-role/permissions') // 角色权限端点
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.code).toBe('NOT_FOUND'); // 断言错误码
    expect(res.body.message).toBe('role not found'); // 断言文案
  }); // 未知角色用例结束
}); // 读取分组结束

describe('角色写操作（POST / PATCH / DELETE / PUT permissions）', () => { // 全部要求 rbac:write
  it('POST /admin/roles 201 新建角色并写入权限映射', async () => { // 自建角色 builtin 固定为 0
    const res = await request(app) // 新建角色
      .post('/api/v1/admin/roles') // 角色集合端点
      .set(adminHeaders()) // 引导令牌
      .send({ code: 'auditor', name: { 'zh-CN': '审计员' }, permissions: ['module:read', 'user:read'] }); // 合法入参
    expect(res.status).toBe(201); // 断言 201
    expect(res.body.role.code).toBe('auditor'); // 断言角色码
    expect(res.body.role.builtin).toBe(false); // 断言非内置
    expect(res.body.role.permissions).toEqual(['module:read', 'user:read']); // 断言权限按码排序后一致
  }); // 新建用例结束

  it('POST /admin/roles 重复 code → 409 CONFLICT', async () => { // 主键冲突必须在事务前拦下
    const res = await request(app) // 复用内置角色码
      .post('/api/v1/admin/roles') // 角色集合端点
      .set(adminHeaders()) // 引导令牌
      .send({ code: 'viewer', name: { 'zh-CN': '重复角色' } }); // 已存在的 code
    expect(res.status).toBe(409); // 断言 409
    expect(res.body.code).toBe('CONFLICT'); // 断言冲突码
    expect(res.body.message).toBe('role code already exists'); // 断言文案
  }); // 重复 code 用例结束

  it('POST /admin/roles 未知权限码 → 400 并回显 unknown', async () => { // 避免写坏权限映射
    const res = await request(app) // 含伪造权限码
      .post('/api/v1/admin/roles') // 角色集合端点
      .set(adminHeaders()) // 引导令牌
      .send({ code: 'auditor', name: { 'zh-CN': '审计员' }, permissions: ['module:read', 'nope:nope'] }); // 第二个码不存在
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 校验类错误
    expect(res.body.details.unknown).toEqual(['nope:nope']); // 精确回显未知权限码
  }); // 未知权限用例结束

  it('POST /admin/roles 非法 code 格式 → 400', async () => { // 角色码要能直接进 URL 与前端路由
    const res = await request(app) // 大写开头的非法码
      .post('/api/v1/admin/roles') // 角色集合端点
      .set(adminHeaders()) // 引导令牌
      .send({ code: 'Auditor', name: { 'zh-CN': '审计员' } }); // 违规入参
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言校验失败
  }); // 非法 code 用例结束

  it('PATCH /admin/roles/:code 内置角色 → 403', async () => { // 内置角色名称由种子维护，防止误改
    const res = await request(app) // 试图改内置角色
      .patch('/api/v1/admin/roles/operator') // 角色端点
      .set(adminHeaders()) // 引导令牌
      .send({ name: { 'zh-CN': '改名的运营' } }); // 合法字段
    expect(res.status).toBe(403); // 断言 403
    expect(res.body.code).toBe('FORBIDDEN'); // 断言错误码
    expect(res.body.message).toBe('builtin role cannot be modified'); // 断言文案
    expect(res.body.details.role_code).toBe('operator'); // 回显目标角色
  }); // 内置角色改用例结束

  it('PATCH /admin/roles/:code 自建角色可改；空 PATCH → 400', async () => { // 至少一个字段，杜绝空写库
    await request(app) // 先建一个自建角色
      .post('/api/v1/admin/roles') // 角色集合端点
      .set(adminHeaders()) // 引导令牌
      .send({ code: 'auditor', name: { 'zh-CN': '审计员' } }); // 最小入参
    const ok = await request(app) // 正常修改
      .patch('/api/v1/admin/roles/auditor') // 自建角色
      .set(adminHeaders()) // 引导令牌
      .send({ name: { 'zh-CN': '高级审计员' }, description: { 'zh-CN': '只读审计' } }); // 两个字段都可改
    expect(ok.status).toBe(200); // 断言 200
    expect(ok.body.role.name['zh-CN']).toBe('高级审计员'); // 断言名称已更新
    expect(ok.body.role.description['zh-CN']).toBe('只读审计'); // 断言描述已更新
    const empty = await request(app) // 空 PATCH
      .patch('/api/v1/admin/roles/auditor') // 同一角色
      .set(adminHeaders()) // 引导令牌
      .send({}); // 无任何字段
    expect(empty.status).toBe(400); // 断言 400
    expect(empty.body.code).toBe('VALIDATION_FAILED'); // 断言校验失败
  }); // 自建角色改用例结束

  it('PATCH /admin/roles/:code 不存在 → 404', async () => { // 未知角色与未知模块同语义
    const res = await request(app) // 不存在的角色
      .patch('/api/v1/admin/roles/no-such-role') // 角色端点
      .set(adminHeaders()) // 引导令牌
      .send({ name: { 'zh-CN': '任意' } }); // 合法字段
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.message).toBe('role not found'); // 断言文案
  }); // 未知角色用例结束

  it('DELETE /admin/roles/:code 内置角色 → 403', async () => { // 内置角色不可删除
    const res = await request(app) // 删除内置角色
      .delete('/api/v1/admin/roles/viewer') // 角色端点
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(403); // 断言 403
    expect(res.body.message).toBe('builtin role cannot be deleted'); // 断言文案
  }); // 内置删除用例结束

  it('DELETE /admin/roles/:code 仍被用户引用 → 409 并回显 assignments', async () => { // 防悬空授权
    const session = await login('13900000003'); // 建用户
    await grantRole(session.userId, 'viewer'); // 引用内置角色
    await request(app) // 建一个自建角色
      .post('/api/v1/admin/roles') // 角色集合端点
      .set(adminHeaders()) // 引导令牌
      .send({ code: 'auditor', name: { 'zh-CN': '审计员' } }); // 最小入参
    await grantRole(session.userId, 'auditor'); // 让自建角色也被引用
    const res = await request(app) // 删除被引用的自建角色
      .delete('/api/v1/admin/roles/auditor') // 角色端点
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(409); // 断言 409
    expect(res.body.code).toBe('CONFLICT'); // 断言冲突码
    expect(res.body.details.assignments).toBe(1); // 断言引用计数
  }); // 被引用删除用例结束

  it('DELETE /admin/roles/:code 未被引用 → 200 且列表消失', async () => { // 级联清理 role_permissions
    await request(app) // 建一个自建角色
      .post('/api/v1/admin/roles') // 角色集合端点
      .set(adminHeaders()) // 引导令牌
      .send({ code: 'auditor', name: { 'zh-CN': '审计员' }, permissions: ['module:read'] }); // 带一条权限
    const res = await request(app) // 删除
      .delete('/api/v1/admin/roles/auditor') // 角色端点
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(200); // 断言 200
    expect(res.body).toEqual({ code: 'auditor', deleted: true }); // 断言回显结构
    const list = await request(app) // 复查列表
      .get('/api/v1/admin/roles') // 角色端点
      .set(adminHeaders()); // 引导令牌
    expect((list.body.roles as Array<{ code: string }>).some((role) => role.code === 'auditor')).toBe(false); // 断言已消失
    const leftover = db.prepare(`SELECT COUNT(*) AS total FROM role_permissions WHERE role_code = 'auditor'`).get() as { total: number }; // 回读映射表
    expect(leftover.total).toBe(0); // 断言级联删除生效
  }); // 未被引用删除用例结束

  it('PUT /admin/roles/:code/permissions 替换 superadmin → 403', async () => { // 防止把自己锁死在后台之外
    const res = await request(app) // 试图清空超管权限
      .put('/api/v1/admin/roles/superadmin/permissions') // 权限替换端点
      .set(adminHeaders()) // 引导令牌
      .send({ permissions: [] }); // 空集合
    expect(res.status).toBe(403); // 断言 403
    expect(res.body.message).toBe('superadmin permissions cannot be replaced'); // 断言文案
  }); // 超管权限替换用例结束

  it('PUT /admin/roles/:code/permissions operator 可整体替换', async () => { // 非超管内置角色允许调整
    const res = await request(app) // 整体替换
      .put('/api/v1/admin/roles/operator/permissions') // 权限替换端点
      .set(adminHeaders()) // 引导令牌
      .send({ permissions: ['module:read'] }); // 只保留一条
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.role_code).toBe('operator'); // 断言目标角色
    expect(res.body.permissions).toEqual(['module:read']); // 断言替换结果
    const read = await request(app) // 复查
      .get('/api/v1/admin/roles/operator/permissions') // 角色权限端点
      .set(adminHeaders()); // 引导令牌
    expect(read.body.permissions).toEqual(['module:read']); // 断言落库生效
  }); // operator 替换用例结束

  it('PUT /admin/roles/:code/permissions 未知权限 → 400；未知角色 → 404', async () => { // 两条错误路径都要覆盖
    const unknown = await request(app) // 含伪造权限码
      .put('/api/v1/admin/roles/operator/permissions') // 权限替换端点
      .set(adminHeaders()) // 引导令牌
      .send({ permissions: ['nope:nope'] }); // 非法码
    expect(unknown.status).toBe(400); // 断言 400
    expect(unknown.body.details.unknown).toEqual(['nope:nope']); // 断言回显未知码
    const missing = await request(app) // 不存在的角色
      .put('/api/v1/admin/roles/no-such-role/permissions') // 权限替换端点
      .set(adminHeaders()) // 引导令牌
      .send({ permissions: [] }); // 合法结构
    expect(missing.status).toBe(404); // 断言 404
  }); // 错误路径用例结束
}); // 角色写操作分组结束

describe('GET /admin/users 用户检索与分页', () => { // 需要 user:read
  it('关键字命中 identifier / display_name，并回显每页角色', async () => { // 三种 LIKE 分支选两种覆盖
    const alice = await login('13900000011'); // 第一个用户
    const bob = await login('13900000012'); // 第二个用户
    db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run('Alice 审计', alice.userId); // 直接写展示名，避免额外接口
    await grantRole(alice.userId, 'viewer'); // 给 Alice 一个角色
    const byPhone = await request(app) // 按手机号检索
      .get('/api/v1/admin/users') // 用户列表端点
      .query({ q: '13900000012' }) // 命中 identities.identifier
      .set(adminHeaders()); // 引导令牌
    expect(byPhone.status).toBe(200); // 断言 200
    expect(byPhone.body.total).toBe(1); // 断言只命中 Bob
    expect(byPhone.body.users[0].id).toBe(bob.userId); // 断言目标用户
    const byName = await request(app) // 按展示名检索
      .get('/api/v1/admin/users') // 用户列表端点
      .query({ q: 'Alice' }) // 命中 display_name
      .set(adminHeaders()); // 引导令牌
    expect(byName.body.total).toBe(1); // 断言只命中 Alice
    expect(byName.body.users[0].roles).toEqual(['viewer']); // 断言批量回填角色
  }); // 关键字用例结束

  it('分页参数 limit / offset 生效且 total 为全量', async () => { // total 与当前页解耦
    await login('13900000021'); // 第一个用户
    await login('13900000022'); // 第二个用户
    const res = await request(app) // 取第二页
      .get('/api/v1/admin/users') // 用户列表端点
      .query({ limit: 1, offset: 1 }) // 每页一条、跳过第一条
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.total).toBe(2); // 断言全量计数
    expect(res.body.limit).toBe(1); // 断言回显 limit
    expect(res.body.offset).toBe(1); // 断言回显 offset
    expect(res.body.users).toHaveLength(1); // 断言当页一条
  }); // 分页用例结束

  it('非法 limit → 400', async () => { // 上限 100 防止大页拖库
    const res = await request(app) // 超出上限
      .get('/api/v1/admin/users') // 用户列表端点
      .query({ limit: 500 }) // 非法值
      .set(adminHeaders()); // 引导令牌
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言校验失败
  }); // 非法分页用例结束
}); // 用户检索分组结束

describe('用户角色授权（GET / POST / DELETE）', () => { // 授权是 RBAC 落地的最后一环
  it('POST 首次 201 created:true，重复 200 created:false 且 granted_by=bootstrap', async () => { // 幂等授权
    const session = await login('13900000031'); // 建用户
    const first = await grantRole(session.userId, 'viewer'); // 首次授权
    expect(first.status).toBe(201); // 断言 201
    expect(first.body.created).toBe(true); // 断言新建标记
    expect(first.body.granted_by).toBe('bootstrap'); // 引导通道无真实用户
    const again = await grantRole(session.userId, 'viewer'); // 重复授权
    expect(again.status).toBe(200); // 断言 200 而非冲突
    expect(again.body.created).toBe(false); // 断言幂等标记
    const read = await request(app) // 读取该用户角色
      .get(`/api/v1/admin/users/${session.userId}/roles`) // 用户角色端点
      .set(adminHeaders()); // 引导令牌
    expect(read.body.roles).toHaveLength(1); // 断言未重复插入
  }); // 幂等授权用例结束

  it('用户不存在 / 角色不存在 → 404', async () => { // 两类前置缺失都要明确报错
    const session = await login('13900000032'); // 建一个真实用户用于角色缺失分支
    const noUser = await request(app) // 不存在的用户
      .post('/api/v1/admin/users/no-such-user/roles') // 授权端点
      .set(adminHeaders()) // 引导令牌
      .send({ role_code: 'viewer' }); // 合法角色
    expect(noUser.status).toBe(404); // 断言 404
    expect(noUser.body.message).toBe('user not found'); // 断言文案
    const noRole = await request(app) // 不存在的角色
      .post(`/api/v1/admin/users/${session.userId}/roles`) // 授权端点
      .set(adminHeaders()) // 引导令牌
      .send({ role_code: 'no-such-role' }); // 非法角色
    expect(noRole.status).toBe(404); // 断言 404
    expect(noRole.body.message).toBe('role not found'); // 断言文案
  }); // 前置缺失用例结束

  it('GET 用户不存在 → 404；DELETE 未授权 → 404、授权后 → 200', async () => { // 撤销路径三条分支
    const missing = await request(app) // 不存在的用户
      .get('/api/v1/admin/users/no-such-user/roles') // 用户角色端点
      .set(adminHeaders()); // 引导令牌
    expect(missing.status).toBe(404); // 断言 404
    const session = await login('13900000033'); // 建用户
    const before = await request(app) // 未授权时撤销
      .delete(`/api/v1/admin/users/${session.userId}/roles/viewer`) // 撤销端点
      .set(adminHeaders()); // 引导令牌
    expect(before.status).toBe(404); // 断言 404
    expect(before.body.message).toBe('user role assignment not found'); // 断言文案
    await grantRole(session.userId, 'viewer'); // 先授权
    const after = await request(app) // 再撤销
      .delete(`/api/v1/admin/users/${session.userId}/roles/viewer`) // 撤销端点
      .set(adminHeaders()); // 引导令牌
    expect(after.status).toBe(200); // 断言 200
    expect(after.body).toEqual({ user_id: session.userId, role_code: 'viewer', deleted: true }); // 断言回显结构
  }); // 撤销路径用例结束
}); // 用户角色分组结束

describe('细粒度权限：viewer 只读、无角色不可进后台', () => { // 端到端验证权限点真正生效
  it('viewer 读角色列表 200，写角色 403 并回显 rbac:write', async () => { // 同一身份读放行写拒绝
    const session = await login('13900000041'); // 建用户
    await grantRole(session.userId, 'viewer'); // 授予只读角色
    const read = await request(app) // 读操作
      .get('/api/v1/admin/roles') // 角色端点
      .set('Authorization', `Bearer ${session.token}`); // 仅带 Bearer
    expect(read.status).toBe(200); // 断言 200
    const write = await request(app) // 写操作
      .post('/api/v1/admin/roles') // 角色集合端点
      .set('Authorization', `Bearer ${session.token}`) // 仅带 Bearer
      .send({ code: 'auditor', name: { 'zh-CN': '审计员' } }); // 合法入参
    expect(write.status).toBe(403); // 断言 403
    expect(write.body.code).toBe('FORBIDDEN'); // 断言错误码
    expect(write.body.details.permission).toBe('rbac:write'); // 断言缺失权限点
  }); // viewer 用例结束

  it('operator 无 rbac:write：可读角色但不可建角色、不可替换 superadmin 权限', async () => { // 验证内置角色权限差异真实存在（operator 基线 7 条，不含 rbac:write）
    const session = await login('13900000042'); // 建用户
    await grantRole(session.userId, 'operator'); // 授予运营角色（基线权限不含 rbac:write）
    const read = await request(app) // 运营可读角色列表（含 rbac:read）
      .get('/api/v1/admin/roles') // 角色集合端点
      .set('Authorization', `Bearer ${session.token}`); // 仅带 Bearer
    expect(read.status).toBe(200); // 断言 200，读能力在基线上
    const create = await request(app) // 运营不可建角色
      .post('/api/v1/admin/roles') // 角色集合端点
      .set('Authorization', `Bearer ${session.token}`) // 仅带 Bearer
      .send({ code: 'auditor', name: { 'zh-CN': '审计员' } }); // 合法入参
    expect(create.status).toBe(403); // 断言 403，缺 rbac:write
    expect(create.body.code).toBe('FORBIDDEN'); // 断言错误码
    expect(create.body.details.permission).toBe('rbac:write'); // 断言缺失权限点
    const guard = await request(app) // 运营同样不能替换超管权限
      .put('/api/v1/admin/roles/superadmin/permissions') // 权限替换端点
      .set('Authorization', `Bearer ${session.token}`) // 仅带 Bearer
      .send({ permissions: [] }); // 空集合
    expect(guard.status).toBe(403); // 断言 403，权限点先于 superadmin 护栏拦截
    expect(guard.body.details.permission).toBe('rbac:write'); // 断言缺失权限点
  }); // operator 用例结束
}); // 细粒度权限分组结束
