/** 契约测试：覆盖健康检查 / FR-01 账号身份 / 幂等中间件 / 生产安全开关（内存库，独立时钟不作注入） */

import { beforeEach, describe, expect, it } from 'vitest'; // 引入 vitest 的用例编排 API：beforeEach 负责每例重建内存库，隔离用例间状态
import request from 'supertest'; // supertest 在进程内直接驱动 Express 实例，无需真实监听端口即可发 HTTP 请求
import type { Express } from 'express'; // 只引入 Express 类型，用于给全局 app 变量标注类型
import { createApp } from '../src/app.js'; // createApp 是唯一装配入口，测试通过注入依赖构造被测应用
import { createDatabase } from '../src/db.js'; // createDatabase 建库；用 :memory: 保证每例干净且互不污染

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定的测试 JWT 密钥，长度满足构建期对 secret 强度的校验

let app: Express; // 待测应用实例，由 beforeEach 赋值
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄，用例内可直接写库造数据
let keyCounter = 0; // 幂等键自增计数器，保证同一用例内多次写操作的 key 不重复

function nextKey(): string { // 生成唯一幂等键，避免回放缓存串到其他请求
  keyCounter += 1; // 先自增再取值，使首个键以 1 结尾
  return `test-key-${keyCounter}`; // 统一前缀区分用例来源，失败时便于定位是哪套契约产生的键
} // 结束 nextKey 定义

interface Session { // 登录会话最小契约：令牌用于鉴权头，用户 id 用于归属断言
  token: string; // Bearer 访问令牌，后续所有受保护请求都带它
  userId: string; // 用户主键，用于校验令牌与档案指向同一主体
} // 结束 Session 定义

async function login(identifier: string, provider: 'phone' | 'email' = 'phone', region: 'cn' | 'global' = 'cn'): Promise<Session> { // 复用登录链路：先取验证码再换令牌，参数化 provider 与 region 覆盖双区双通道
  const codeRes = await request(app) // 第一步申请验证码
    .post('/api/v1/auth/code') // 验证码端点
    .send({ region, provider, identifier }); // 传区域、通道与标识，交给被测实现决定是否合法
  expect(codeRes.status).toBe(201); // 断言 201 表示验证码已创建，否则后续拿不到 dev_code

  const loginRes = await request(app) // 第二步用验证码换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ region, provider, identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } }); // 带 dev_code 与设备信息，设备字段是登录契约的必填项
  expect(loginRes.status).toBe(200); // 断言 200，确认凭证通过校验
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回会话：令牌进请求头，用户 id 用于归属断言
} // 结束 login 定义

function auth(session: Session, key?: string) { // 构造鉴权头，集中管理 Bearer 前缀避免每处重复拼接
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` }; // 固定 Bearer 头，令牌来自登录结果
  if (key) headers['idempotency-key'] = key; // 可选幂等键：写操作必传，读操作不传
  return headers; // 返回可直接交给 supertest 的头对象
} // 结束 auth 定义

beforeEach(() => { // 每例前置：重建内存库与应用，保证用例之间零共享状态
  db = createDatabase(':memory:'); // 内存库每次全新创建，避免数据泄漏到下一例
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // env 传空对象即开发默认配置，测试不读真实环境变量
  keyCounter = 0; // 重置幂等键计数，避免跨用例复用同一键而命中回放缓存
}); // 结束 beforeEach

describe('公开能力', () => { // describe 公开能力：无需鉴权的端点与路由层统一 404 语义
  it('健康检查', async () => { // 用例：健康检查探活
    const health = await request(app).get('/health'); // 直接 GET /health，不携带任何请求头
    expect(health.status).toBe(200); // 断言 200，探活路径必须恒可用
    expect(health.body.status).toBe('ok'); // 断言业务状态为 ok，供负载均衡与监控判定实例就绪
    expect(health.body.service).toBe('mim-api'); // 断言服务名，避免多服务混布时探活串台
  }); // 结束健康检查用例

  it('非法 JSON 请求体返回 400 VALIDATION_FAILED，而不是 500', async () => { // 用例：畸形 JSON 应被识别为请求体校验失败，而不是服务端异常
    const res = await request(app) // 发起请求
      .post('/api/v1/auth/code') // 用验证码端点作为投递入口，其解析器与全局一致
      .set('content-type', 'application/json') // 显式声明 JSON，触发 JSON 解析器
      .send('{"region":'); // 故意发送被截断的 JSON，模拟客户端序列化中断
    expect(res.status).toBe(400); // 断言 400，说明解析失败被归一为客户端错误
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言错误码，避免把解析失败误报成 500
  }); // 结束畸形 JSON 用例

  it('已移除的旧接口与未知路径返回 404，不被受保护 router 的鉴权拦成 401', async () => { // 用例：已移除的旧接口与未知路径统一 404，不能被受保护路由的鉴权抢答成 401
    for (const path of ['/api/v1/plans', '/api/v1/audit/logs', '/api/v1/not-exist']) { // 遍历三类路径：已移除的老接口、审计接口、纯随机路径
      const res = await request(app).get(path); // 逐个发起 GET，不带任何鉴权头
      expect(res.status).toBe(404); // 断言 404，证明路由层先于鉴权层给出结论
      expect(res.body.code).toBe('NOT_FOUND'); // 断言统一错误码，客户端可据此区分未实现与无权限
    } // 结束路径循环
  }); // 结束本用例
}); // 结束公开能力分组

describe('FR-01 账号身份', () => { // describe FR-01 账号身份：验证码登录、区域约束与令牌无效三类核心契约
  it('验证码登录、刷新轮换与登出', async () => { // 用例：验证码登录、刷新轮换与登出后令牌失效的完整闭环
    const session = await login('13800000001'); // 先用辅助函数建会话，后续 /me 需要可用令牌
    const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier: '13800000001' }); // 重新申请一枚验证码，取最新 dev_code 用于二次登录
    const loginRes = await request(app) // 再次登录同一标识，验证可重复签发会话
      .post('/api/v1/auth/login') // 登录端点
      .send({ region: 'cn', provider: 'phone', identifier: '13800000001', code: codeRes.body.dev_code }); // 使用上一步拿到的 dev_code 完成登录
    expect(loginRes.body.user.region).toBe('cn'); // 断言区域落库为 cn，说明 region 随请求写入用户档案

    const refresh = await request(app) // 用刷新令牌换取新一对令牌
      .post('/api/v1/auth/refresh') // 刷新端点
      .send({ refresh_token: loginRes.body.refresh_token }); // 传入首次登录得到的刷新令牌
    expect(refresh.status).toBe(200); // 断言 200，刷新链路可用
    expect(refresh.body.refresh_token).not.toBe(loginRes.body.refresh_token); // 断言新旧刷新令牌不同，证明服务端做了轮换而非原样回显

    const me = await request(app).get('/api/v1/me').set(auth(session)); // 用首次会话的访问令牌访问个人档案
    expect(me.status).toBe(200); // 断言 200，说明刷新轮换不影响既有访问令牌
    expect(me.body.user.id).toBe(session.userId); // 断言返回的用户 id 与会话一致，确认令牌指向同一主体

    const logout = await request(app) // 携带刷新令牌登出
      .post('/api/v1/auth/logout') // 登出端点
      .set(auth(session)) // 带上访问令牌做鉴权
      .send({ refresh_token: refresh.body.refresh_token }); // 提交要作废的刷新令牌
    expect(logout.status).toBe(200); // 断言 200，登出成功

    const reused = await request(app) // 再次用已作废的刷新令牌尝试刷新
      .post('/api/v1/auth/refresh') // 刷新端点
      .send({ refresh_token: refresh.body.refresh_token }); // 携带已作废令牌，模拟令牌泄漏后的重放
    expect(reused.status).toBe(401); // 断言 401，证明登出确实使刷新令牌失效
  }); // 结束本用例

  it('cn 区仅接受手机号：邮箱标识被拒绝', async () => { // 用例：cn 区只接受手机号，邮箱通道属于非法组合
    const res = await request(app) // 发起验证码请求
      .post('/api/v1/auth/code') // 验证码端点
      .send({ region: 'cn', provider: 'email', identifier: 'a@b.com' }); // 故意用 email 通道配 cn 区，检验区域与通道的约束关系
    expect(res.status).toBe(400); // 断言 400，非法组合在入口即被拒
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言校验错误码，说明是入参问题而非通道未配置
  }); // 结束本用例

  it('未携带令牌访问受保护接口返回 401', async () => { // 用例：未带令牌访问受保护接口必须 401
    const res = await request(app).get('/api/v1/me'); // 直接请求个人档案，不设置 authorization 头
    expect(res.status).toBe(401); // 断言 401，鉴权中间件先于业务逻辑拦截
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言统一未授权码，便于客户端跳转登录页
  }); // 结束本用例
}); // 结束 FR-01 分组

describe('写操作幂等', () => { // describe 写操作幂等：回放、冲突与缺键三条边界
  it('幂等键回放返回首次结果，复用不同请求体返回 409', async () => { // 用例：同键同体回放返回首次结果，同键异体视为冲突
    const session = await login('13800000013'); // 登录拿会话，写操作必须鉴权
    const key = 'replay-key'; // 固定幂等键，后续三个请求共用同一个键
    const body = { display_name: '幂等用户' }; // 固定请求体，用于验证回放结果逐字段一致

    const first = await request(app) // 首次写请求
      .patch('/api/v1/me') // 修改个人资料端点
      .set(auth(session, key)) // 带鉴权头与幂等键
      .send(body); // 提交要写入的昵称
    expect(first.status).toBe(200); // 断言 200，首次写入成功
    expect(first.body.user.display_name).toBe('幂等用户'); // 断言昵称已落库并原样回显

    const replay = await request(app) // 用同一键与同一请求体重放
      .patch('/api/v1/me') // 同一端点
      .set(auth(session, key)) // 同一幂等键
      .send(body); // 同一请求体
    expect(replay.status).toBe(200); // 断言 200，重放不应报错而是命中回放
    expect(replay.body).toEqual(first.body); // 断言响应体与首次完全一致，证明走缓存而非二次写入

    const conflict = await request(app) // 同键但换请求体
      .patch('/api/v1/me') // 同一端点
      .set(auth(session, key)) // 同一幂等键
      .send({ display_name: '另一个名字' }); // 换一个昵称，触发同键异体冲突
    expect(conflict.status).toBe(409); // 断言 409，语义上是幂等冲突
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT'); // 断言冲突错误码，客户端据此判断需要更换新键
  }); // 结束幂等回放用例

  it('写操作缺少 Idempotency-Key 被拒', async () => { // 用例：写操作缺少幂等键必须被拒
    const session = await login('13800000005'); // 登录拿会话
    const res = await request(app) // 发起写请求
      .patch('/api/v1/me') // 修改个人资料端点
      .set(auth(session)) // 只带鉴权头，故意不传 idempotency-key
      .send({ display_name: '无键用户' }); // 提交昵称
    expect(res.status).toBe(400); // 断言 400，说明幂等键是写操作的强制契约
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言校验错误码，指向缺失的请求头
  }); // 结束缺键用例

  it('region 隔离：同标识在不同 region 视为不同账号', async () => { // 用例：region 隔离，同标识在 cn 与 global 视为不同账号
    const cn = await login('user@example.com', 'phone', 'cn').catch(() => null); // cn 区不接受邮箱，故该登录预期抛错，用 catch 转成 null
    expect(cn).toBeNull(); // 断言为 null，证明 cn 区拒绝了邮箱标识
    const global = await login('user@example.com', 'email', 'global'); // global 区用同一邮箱登录
    const me = await request(app).get('/api/v1/me').set(auth(global)); // 用 global 会话访问个人档案
    expect(me.body.user.region).toBe('global'); // 断言用户落在 global 区，说明账号体系按区域分区
    expect(me.body.user.locale).toBe('en-US'); // 断言默认语言为 en-US，说明区域决定本地化默认值
  }); // 结束区域隔离用例
}); // 结束写操作幂等分组

describe('账号注销与撤销', () => { // describe 账号注销与撤销：冷静期内可逆
  it('注销后进入待删除态，撤销后恢复 active', async () => { // 用例：注销进入待删除态，撤销后恢复 active
    const session = await login('13800000040'); // 登录拿会话

    const deletion = await request(app) // 申请注销
      .post('/api/v1/me/deletion') // 注销端点
      .set(auth(session, nextKey())) // 写操作必须带幂等键
      .send({}); // 注销无需额外参数
    expect(deletion.status).toBe(200); // 断言 200，注销申请已受理
    expect(deletion.body.status).toBe('pending_deletion'); // 断言状态为待删除，说明是软删除而非立即清除
    expect(deletion.body.deletion_scheduled_at).toBeTruthy(); // 断言存在计划删除时间，供前端展示冷静期截止

    const me = await request(app).get('/api/v1/me').set(auth(session)); // 回查当前用户档案
    expect(me.body.user.status).toBe('pending_deletion'); // 断言档案状态已切换，且对本人仍可见

    const cancel = await request(app) // 撤销注销
      .post('/api/v1/me/cancel-deletion') // 撤销端点
      .set(auth(session, nextKey())) // 幂等键不可复用，换一个新键
      .send({}); // 撤销无需参数
    expect(cancel.status).toBe(200); // 断言 200，撤销成功
    expect(cancel.body.status).toBe('active'); // 断言状态恢复 active，说明注销流程可逆
  }); // 结束注销用例
}); // 结束注销分组

describe('生产安全开关', () => { // describe 生产安全开关：生产环境不得回显验证码
  it('生产环境拒绝直发验证码：503 AUTH_CHANNEL_NOT_CONFIGURED 且无 dev_code', async () => { // 用例：生产环境未配置通道时拒绝直发，且响应不含 dev_code
    const prodApp = createApp({ // 用生产环境变量单独建应用，避免影响全局实例
      db: createDatabase(':memory:'), // 独立内存库，防止与全局 db 交叉污染
      jwtSecret: JWT_SECRET, // 复用同一测试密钥
      env: { NODE_ENV: 'production' }, // 唯一差异是把 NODE_ENV 设为 production
    }); // 结束生产环境应用构造，参数含独立内存库、测试密钥与生产环境标记
    const res = await request(prodApp) // 发起验证码请求
      .post('/api/v1/auth/code') // 生产环境默认不开放 dev_code 直发
      .send({ region: 'cn', provider: 'phone', identifier: '13800000032' }); // 用 cn 手机号走最常规的短信路径
    expect(res.status).toBe(503); // 断言 503，语义是能力未就绪而非参数错误
    expect(res.body.code).toBe('AUTH_CHANNEL_NOT_CONFIGURED'); // 断言通道未配置错误码，运维可据此定位环境变量缺失
    expect(res.body.dev_code).toBeUndefined(); // 断言响应不含 dev_code，防止生产环境泄漏验证码
  }); // 结束生产安全用例
}); // 结束生产安全分组

describe('验证码通道（短信/邮件供应商接入）', () => { // describe 验证码通道：短信与邮件供应商接入后的行为
  function channelApp( // 构造带自定义通知依赖的应用，用于注入假供应商
    env: Record<string, string | undefined>, // 接收完整环境变量集合，可精确控制通道开关
    notify?: { sms?: { send(id: string, code: string): Promise<void> }; email?: { send(id: string, code: string): Promise<void> } }, // 通知依赖形状与生产适配器一致，仅需 send(标识, 验证码)
  ): Express { // 返回新的 Express 实例
    return createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env, notify }); // 注入内存库与假供应商，使通道判定与发送行为都可断言
  } // 结束 channelApp 定义

  it('生产环境 + 短信通道已配置：201 无 dev_code，可用真实下发的码登录', async () => { // 用例：生产环境配置短信通道后正常下发，并可用真实码登录
    let sent: { identifier: string; code: string } | undefined; // 记录供应商实际收到的标识与验证码
    const app = channelApp( // 用生产环境与假短信通道建应用
      { NODE_ENV: 'production' }, // 打开生产环境开关，进入真实通道分支
      { sms: { send: async (id, code) => { sent = { identifier: id, code }; } } }, // 假供应商只记录参数，不打真实网络
    ); // 结束应用构造
    const codeRes = await request(app) // 发起验证码请求
      .post('/api/v1/auth/code') // 验证码端点
      .send({ region: 'cn', provider: 'phone', identifier: '13800000051' }); // cn 手机号
    expect(codeRes.status).toBe(201); // 断言 201，表示验证码已生成并投递
    expect(codeRes.body.dev_code).toBeUndefined(); // 断言无 dev_code，生产环境不得直发
    expect(codeRes.body.delivery).toBe('phone'); // 断言投递渠道为 phone，前端据此提示用户查收短信
    expect(codeRes.body.expires_in).toBeGreaterThan(0); // 断言有效期为正数，保证验证码不会立即过期
    expect(sent?.identifier).toBe('13800000051'); // 断言供应商收到的是同一标识
    expect(sent?.code).toMatch(/^\d{6}$/); // 断言验证码为 6 位数字，符合短信文案与输入约定

    const login = await request(app) // 用供应商实收的验证码登录，验证发送与校验闭环
      .post('/api/v1/auth/login') // 登录端点
      .send({ region: 'cn', provider: 'phone', identifier: '13800000051', code: sent!.code }); // 带上真实下发的码，不使用 dev_code
    expect(login.status).toBe(200); // 断言 200，登录成功
    expect(login.body.access_token).toBeTruthy(); // 断言签发了访问令牌
  }); // 结束短信通道用例

  it('生产环境 + 邮件通道已配置：201 delivery=email 且无 dev_code', async () => { // 用例：生产环境配置邮件通道时投递渠道为 email
    let sent: { identifier: string; code: string } | undefined; // 记录邮件供应商收到的参数
    const app = channelApp( // 构建应用
      { NODE_ENV: 'production' }, // 生产环境
      { email: { send: async (id, code) => { sent = { identifier: id, code }; } } }, // 只注入假邮件供应商
    ); // 结束应用构造
    const res = await request(app) // 发起验证码请求
      .post('/api/v1/auth/code') // 验证码端点
      .send({ region: 'global', provider: 'email', identifier: 'user@example.com' }); // global 区邮箱标识，匹配邮件通道
    expect(res.status).toBe(201); // 断言 201
    expect(res.body.dev_code).toBeUndefined(); // 断言无 dev_code
    expect(res.body.delivery).toBe('email'); // 断言投递渠道为 email，说明服务端按 provider 选择通道
    expect(sent?.identifier).toBe('user@example.com'); // 断言邮件供应商收到该邮箱
  }); // 结束邮件通道用例

  it('生产环境只配置了邮件通道，请求短信：仍 503 AUTH_CHANNEL_NOT_CONFIGURED', async () => { // 用例：只配置邮件通道时请求短信，仍应返回通道未配置
    const app = channelApp( // 构建应用
      { NODE_ENV: 'production' }, // 生产环境
      { email: { send: async () => {} } }, // 只注入邮件供应商，短信通道保持空缺
    ); // 结束应用构造
    const res = await request(app) // 发起短信验证码请求
      .post('/api/v1/auth/code') // 验证码端点
      .send({ region: 'cn', provider: 'phone', identifier: '13800000052' }); // cn 手机号走短信通道
    expect(res.status).toBe(503); // 断言 503，说明通道按请求类型独立判定
    expect(res.body.code).toBe('AUTH_CHANNEL_NOT_CONFIGURED'); // 断言通道未配置错误码
  }); // 结束通道错配用例

  it('供应商发送失败：502 AUTH_CODE_DELIVERY_FAILED', async () => { // 用例：供应商抛错时归一为 502 投递失败
    const app = channelApp( // 构建应用
      { NODE_ENV: 'production' }, // 生产环境
      { sms: { send: async () => { throw new Error('provider down'); } } }, // 假短信通道直接抛错，模拟供应商故障
    ); // 结束应用构造
    const res = await request(app) // 发起验证码请求
      .post('/api/v1/auth/code') // 验证码端点
      .send({ region: 'cn', provider: 'phone', identifier: '13800000053' }); // cn 手机号
    expect(res.status).toBe(502); // 断言 502，表达上游网关类错误而非 500
    expect(res.body.code).toBe('AUTH_CODE_DELIVERY_FAILED'); // 断言投递失败错误码
    expect(res.body.dev_code).toBeUndefined(); // 断言失败响应同样不泄漏 dev_code
  }); // 结束投递失败用例

  it('开发环境通道已配置时同样走真实通道（无 dev_code）', async () => { // 用例：开发环境只要配置了通道，也同样走真实通道
    let sentCode = ''; // 记录下发的验证码
    const app = channelApp( // 构建应用
      {}, // env 为空即开发默认配置
      { sms: { send: async (_id, code) => { sentCode = code; } } }, // 注入假短信供应商，忽略标识只记录验证码
    ); // 结束应用构造
    const res = await request(app) // 发起验证码请求
      .post('/api/v1/auth/code') // 验证码端点
      .send({ region: 'cn', provider: 'phone', identifier: '13800000054' }); // cn 手机号
    expect(res.status).toBe(201); // 断言 201
    expect(res.body.dev_code).toBeUndefined(); // 断言开发环境配置通道后同样不回显 dev_code
    expect(res.body.delivery).toBe('phone'); // 断言投递渠道为 phone
    expect(sentCode).toMatch(/^\d{6}$/); // 断言收到的码为 6 位数字，与生产分支行为一致
  }); // 结束开发环境用例
}); // 结束验证码通道分组

describe('密码登录（验证码通道未接入时的生产入口）', () => { // describe 密码登录：验证码通道未接入时的生产入口
  const PASSWORD = 'test-admin-pass-2026'; // 固定的管理员口令，用于注入环境变量

  function passwordApp(env: Record<string, string | undefined>): Express { // 构造只关心口令配置的应用
    return createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env }); // 注入内存库与指定环境变量，口令由 env 决定是否可用
  } // 结束 passwordApp 定义

  it('口令正确：200 签发令牌且可访问 /me', async () => { // 用例：口令正确时签发令牌，并能访问受保护接口
    const app = passwordApp({ MIM_AUTH_ADMIN_PASSWORD: PASSWORD }); // 配置管理员口令后建应用
    const res = await request(app) // 发起密码登录
      .post('/api/v1/auth/password') // 密码登录端点
      .send({ region: 'cn', identifier: '13800000041', password: PASSWORD }); // 提交区域、标识与正确口令
    expect(res.status).toBe(200); // 断言 200，口令校验通过
    expect(res.body.token_type).toBe('Bearer'); // 断言令牌类型为 Bearer，符合客户端拼装约定
    expect(res.body.access_token).toBeTruthy(); // 断言签发了访问令牌
    expect(res.body.refresh_token).toBeTruthy(); // 断言同时签发刷新令牌，保证可续期
    expect(res.body.user.id).toBeTruthy(); // 断言返回了用户 id，供后续归属校验

    const me = await request(app) // 用刚签发的访问令牌访问个人档案
      .get('/api/v1/me') // 受保护端点
      .set('authorization', `Bearer ${res.body.access_token}`); // 手工拼 Bearer 头，验证令牌可独立使用
    expect(me.status).toBe(200); // 断言 200，说明密码登录的令牌与验证码登录等价
    expect(me.body.user.id).toBe(res.body.user.id); // 断言用户 id 与登录响应一致，确认同一主体
  }); // 结束口令正确用例

  it('口令错误：401 AUTH_PASSWORD_INVALID', async () => { // 用例：口令错误返回 401，而不是 403 或 500
    const res = await request(passwordApp({ MIM_AUTH_ADMIN_PASSWORD: PASSWORD })) // 构建配置了口令的应用并直接发起请求
      .post('/api/v1/auth/password') // 密码登录端点
      .send({ region: 'cn', identifier: '13800000042', password: 'wrong-pass' }); // 提交错误口令
    expect(res.status).toBe(401); // 断言 401，语义是凭证无效
    expect(res.body.code).toBe('AUTH_PASSWORD_INVALID'); // 断言口令无效错误码，便于前端提示重新输入
  }); // 结束口令错误用例

  it('未配置口令：503 AUTH_PASSWORD_NOT_CONFIGURED', async () => { // 用例：未配置口令时明确返回服务未就绪
    const res = await request(passwordApp({})) // env 为空即未配置管理员口令
      .post('/api/v1/auth/password') // 密码登录端点
      .send({ region: 'cn', identifier: '13800000043', password: PASSWORD }); // 即使口令参数正确也应被拒，因为服务端无口令可比
    expect(res.status).toBe(503); // 断言 503，语义是能力未配置
    expect(res.body.code).toBe('AUTH_PASSWORD_NOT_CONFIGURED'); // 断言未配置错误码，指导运维补齐环境变量
  }); // 结束未配置用例
}); // 结束密码登录分组
