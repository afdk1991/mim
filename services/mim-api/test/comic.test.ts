/** 契约测试：第 1 期 AI 辅助创作工作台（comic 域 + entitlement 门禁） */

import { beforeEach, describe, expect, it } from 'vitest'; // 引入 vitest 的用例编排 API，beforeEach 负责每例重建内存库
import request from 'supertest'; // supertest 在进程内驱动 Express 实例，无需监听真实端口
import type { Express } from 'express'; // 只引入 Express 类型，用于标注全局 app
import { createApp } from '../src/app.js'; // createApp 是唯一装配入口，测试通过注入依赖构造被测应用
import { createDatabase } from '../src/db.js'; // createDatabase 建库，用例用内存库保证干净隔离

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足构建期对 secret 强度的校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄，用例内可直接写库造数据
let keyCounter = 0; // 幂等键自增计数器，保证同例内多次写操作键不重复

function nextKey(): string { // 生成唯一幂等键
  keyCounter += 1; // 先自增再取值
  return `comic-key-${keyCounter}`; // comic 前缀用于区分来源，失败时便于定位
} // 结束 nextKey 定义

interface Session { // 登录会话契约：令牌用于鉴权头，用户 id 用于权益授予
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键
} // 结束 Session 定义

async function login( // 登录辅助：先取验证码再换令牌，参数化区域与通道
  identifier: string, // 登录标识，手机号或邮箱
  provider: 'phone' | 'email' = 'phone', // 通道默认手机号，与 cn 区默认值匹配
  region: 'cn' | 'global' = 'cn', // 区域默认 cn，comic 用例多数只需国内用户
): Promise<Session> { // 返回会话对象
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region, provider, identifier }); // 一步申请验证码：把区域、通道、标识原样透传
  expect(codeRes.status).toBe(201); // 断言 201 表示验证码已创建，否则后续拿不到 dev_code
  const loginRes = await request(app) // 用验证码换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ region, provider, identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } }); // 带 dev_code 与设备信息，设备字段是登录契约必填项
  expect(loginRes.status).toBe(200); // 断言 200 表示凭证有效
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回访问令牌与用户 id
} // 结束 login 定义

function auth(session: Session, key?: string) { // 构造鉴权头，集中拼接 Bearer 前缀
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` }; // 固定 Bearer 头
  if (key) headers['idempotency-key'] = key; // 可选幂等键：写操作必传，读操作不传
  return headers; // 返回可直接交给 supertest 的头对象
} // 结束 auth 定义

/** 直接写库授予模块权益（模拟下单 / 运营开通链路） */
function grantEntitlement(userId: string, region: 'cn' | 'global' = 'cn'): void { // 授予权益：直接写库模拟下单或运营开通链路，绕开支付依赖
  const moduleRow = db // 先按区域查出模块主键
    .prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = ?`) // 用模块编码加区域唯一定位种子行
    .get(region) as { id: string } | undefined; // 取首行并按联合类型断言结果形状
  if (!moduleRow) throw new Error('comic.workbench module seed missing'); // 种子缺失直接抛错，避免门禁用例静默通过
  const now = new Date().toISOString(); // 统一时间戳，保证创建时间与更新时间一致
  db.prepare( // 插入权益行
    // 用参数化 SQL 写入权益行，状态固定 active、版本固定 1
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`,
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now); // 执行插入并用用户与模块拼出稳定权益 id
} // 结束 grantEntitlement 定义

beforeEach(() => { // 每例前置：重建内存库与应用，确保用例零共享
  db = createDatabase(':memory:'); // 内存库每次全新创建
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // env 传空对象即开发默认配置，不读真实环境变量
  keyCounter = 0; // 重置幂等键计数，避免跨用例命中原有回放缓存
}); // 结束 beforeEach

describe('comic 工作台门禁', () => { // describe comic 工作台门禁：模块权益决定能否进入工作台
  it('未解锁模块返回 403 FEATURE_NOT_AVAILABLE，解锁后放行', async () => { // 用例：未解锁返回 403，写库解锁后放行
    const session = await login('13900000001'); // 登录普通用户
    const denied = await request(app).get('/api/v1/comic/projects').set(auth(session)); // 未授权时访问工程列表
    expect(denied.status).toBe(403); // 断言 403，说明门禁在业务逻辑前拦截
    expect(denied.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言功能未开通错误码
    expect(denied.body.details.module_code).toBe('comic.workbench'); // 断言 details 指出具体模块，便于前端跳转购买页

    grantEntitlement(session.userId); // 直接写库授予 comic.workbench 权益
    const allowed = await request(app).get('/api/v1/comic/projects').set(auth(session)); // 解锁后再次访问同一列表
    expect(allowed.status).toBe(200); // 断言 200，说明门禁已放行
    expect(allowed.body.items).toEqual([]); // 断言列表为空数组，既证明放行又证明无脏数据
  }); // 结束门禁用例

  it('模块种子按区域隔离：global 用户需 global 区权益', async () => { // 用例：模块种子按区域隔离，global 用户不能用 cn 区权益
    const globalUser = await login('global@example.com', 'email', 'global'); // global 区必须用邮箱登录，故显式传 email 与 global
    grantEntitlement(globalUser.userId, 'cn'); // 只授予 cn 区权益，制造区域错配
    const denied = await request(app).get('/api/v1/comic/projects').set(auth(globalUser)); // 用 global 会话访问列表
    expect(denied.status).toBe(403); // 断言 403，证明权益不跨区生效

    grantEntitlement(globalUser.userId, 'global'); // 再补授 global 区权益
    const allowed = await request(app).get('/api/v1/comic/projects').set(auth(globalUser)); // 再次访问列表
    expect(allowed.status).toBe(200); // 断言 200，说明区域匹配后才放行
  }); // 结束区域隔离用例
}); // 结束门禁分组

describe('创作工程 CRUD', () => { // describe 创作工程 CRUD：创建、乐观锁与可见性
  it('新建工程 + 幂等回放 + 同 Key 异 body 冲突', async () => { // 用例：新建工程、幂等回放与同键异体冲突
    const session = await login('13900000002'); // 登录创作者
    grantEntitlement(session.userId); // 授予工作台权益，否则后续全是 403
    const key = 'create-project'; // 固定幂等键，三个请求共用
    const body = { title: '雨夜追光', synopsis: '一名少女在雨夜寻找失散的哥哥。' }; // 请求体含标题与简介

    const created = await request(app) // 首次创建
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, key)) // 带鉴权与幂等键
      .send(body); // 提交请求体
    expect(created.status).toBe(201); // 断言 201，新建语义
    expect(created.body.project.status).toBe('draft'); // 断言初始状态为 draft
    expect(created.body.project.version).toBe(1); // 断言版本从 1 开始，供后续乐观锁使用

    const replay = await request(app) // 同键同体重放
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, key)) // 沿用同一幂等键
      .send(body); // 沿用同一请求体
    expect(replay.status).toBe(201); // 断言仍为 201，回放沿用首次状态码
    expect(replay.body.project.id).toBe(created.body.project.id); // 断言返回同一工程 id，证明未二次落库

    const conflict = await request(app) // 同键换请求体
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, key)) // 同一幂等键
      .send({ title: '另一个标题' }); // 换标题触发同键异体冲突
    expect(conflict.status).toBe(409); // 断言 409，语义是幂等冲突
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT'); // 断言冲突错误码

    const list = await request(app).get('/api/v1/comic/projects').set(auth(session)); // 列出该用户工程
    expect(list.body.items).toHaveLength(1); // 断言只有一条，反向证明重放没有产生新记录
  }); // 结束创建用例

  it('PATCH 乐观锁：版本不匹配返回 409', async () => { // 用例：PATCH 乐观锁，版本不匹配返回 409
    const session = await login('13900000003'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const created = await request(app) // 先建一个工程作为被更新对象
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '初稿' }); // 只给标题，版本由服务端置 1
    const projectId = created.body.project.id as string; // 取出工程 id

    const updated = await request(app) // 提交版本 1 的更新
      .patch(`/api/v1/comic/projects/${projectId}`) // 按 id 发起 PATCH
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '二稿', version: 1 }); // 标题加版本号，版本与库内一致应成功
    expect(updated.status).toBe(200); // 断言 200
    expect(updated.body.project.version).toBe(2); // 断言版本涨到 2

    const stale = await request(app) // 再用过期版本更新同一资源
      .patch(`/api/v1/comic/projects/${projectId}`) // 同一资源端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '回退稿', version: 1 }); // 仍提交版本 1，模拟并发覆盖
    expect(stale.status).toBe(409); // 断言 409，乐观锁拒绝陈旧写入
    expect(stale.body.code).toBe('CONFLICT'); // 断言冲突错误码
    expect(stale.body.details.current_version).toBe(2); // 断言 details 回传当前版本，便于前端对齐后重试
  }); // 结束乐观锁用例

  it('跨用户与已删除工程统一 404', async () => { // 用例：跨用户与已删除工程统一返回 404
    const owner = await login('13900000004'); // 属主登录
    grantEntitlement(owner.userId); // 授予权益
    const created = await request(app) // 属主建私有工程
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(owner, nextKey())) // 新幂等键
      .send({ title: '私有工程' }); // 标题
    const projectId = created.body.project.id as string; // 取工程 id

    const other = await login('13900000005'); // 另一个用户登录
    grantEntitlement(other.userId); // 他人也授予权益，排除门禁因素干扰可见性结论
    const peek = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(other)); // 他人读取该工程
    expect(peek.status).toBe(404); // 断言 404，不暴露资源是否存在
    expect(peek.body.code).toBe('NOT_FOUND'); // 断言未找到错误码

    const deleted = await request(app) // 属主删除工程
      .delete(`/api/v1/comic/projects/${projectId}`) // 删除端点
      .set(auth(owner, nextKey())); // 新幂等键
    expect(deleted.status).toBe(200); // 断言 200
    expect(deleted.body.ok).toBe(true); // 断言 ok 为 true

    const gone = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(owner)); // 删除后属主再查
    expect(gone.status).toBe(404); // 断言 404，删除后与不存在同语义
    const list = await request(app).get('/api/v1/comic/projects').set(auth(owner)); // 属主查列表
    expect(list.body.items).toHaveLength(0); // 断言归零，确认已删工程不再出现在列表
  }); // 结束可见性用例
}); // 结束工程 CRUD 分组

describe('分镜 / 角色 / AI 建议', () => { // describe 分镜、角色与 AI 建议：状态机与 upsert 语义
  it('分镜确认后驱动 draft → storyboarded 状态机', async () => { // 用例：分镜确认后驱动 draft 迁移到 storyboarded
    const session = await login('13900000006'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const created = await request(app) // 建工程
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '分镜工程' }); // 标题
    const projectId = created.body.project.id as string; // 取工程 id
    const shots = [ // 构造两条分镜
      { index: 1, description: '雨夜街角，少女回头', camera: '近景固定', duration_sec: 3 }, // 第一条：雨夜街角近景固定机位
      { index: 2, description: '镜头推向远处的灯牌', camera: '中景横移', duration_sec: 4 }, // 第二条：推镜到远处灯牌
    ]; // 结束分镜数组

    const draft = await request(app) // 提交未确认的分镜草稿
      .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 分镜端点，同一端点用 confirm 区分提交与确认
      .set(auth(session, nextKey())) // 新幂等键
      .send({ shots }); // 只传分镜数组
    expect(draft.status).toBe(201); // 断言 201
    expect(draft.body.storyboard.version_no).toBe(1); // 断言版本号为 1
    expect(draft.body.project_status).toBe('draft'); // 断言未确认时工程状态仍为 draft
    expect(draft.body.storyboard.confirmed_at).toBeNull(); // 断言确认时间为空，说明只是草稿

    const confirmed = await request(app) // 再次提交并确认
      .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 同一分镜端点
      .set(auth(session, nextKey())) // 新幂等键，否则会命中回放
      .send({ shots, confirm: true }); // confirm 为 true 触发状态迁移
    expect(confirmed.status).toBe(201); // 断言 201
    expect(confirmed.body.storyboard.version_no).toBe(2); // 断言版本号递增到 2
    expect(confirmed.body.project_status).toBe('storyboarded'); // 断言工程状态变为 storyboarded

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 读取工程详情
    expect(detail.body.project.status).toBe('storyboarded'); // 断言详情中的工程状态已同步更新
    expect(detail.body.latest_storyboard.version_no).toBe(2); // 断言 latest_storyboard 指向版本 2
    expect(detail.body.latest_storyboard.shots).toHaveLength(2); // 断言分镜条数仍为 2，内容未被截断
  }); // 结束分镜状态机用例

  it('分镜序号重复被拒；进入生成态后内容冻结', async () => { // 用例：分镜序号重复被拒，进入生成态后内容冻结
    const session = await login('13900000007'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const created = await request(app) // 建工程
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '冻结工程' }); // 标题
    const projectId = created.body.project.id as string; // 取工程 id

    const duplicated = await request(app) // 提交序号重复的分镜
      .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 分镜端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ // 两条记录 index 都为 1
        shots: [ // 分镜数组开始
          { index: 1, description: 'A' }, // 第一条序号 1
          { index: 1, description: 'B' }, // 第二条序号同为 1，应触发唯一性校验
        ], // 结束分镜数组
      }); // 结束请求体
    expect(duplicated.status).toBe(400); // 断言 400
    expect(duplicated.body.code).toBe('VALIDATION_FAILED'); // 断言校验失败错误码

    db.prepare(`UPDATE comic_projects SET status = 'generating', version = 2 WHERE id = ?`).run(projectId); // 直接写库把工程置为生成态，绕过接口造出冻结前置条件
    const frozen = await request(app) // 生成态下再提交分镜
      .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 分镜端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ shots: [{ index: 1, description: 'C' }] }); // 单条合法分镜
    expect(frozen.status).toBe(409); // 断言 409
    expect(frozen.body.code).toBe('CONFLICT'); // 断言冲突码，说明生成态内容已冻结
  }); // 结束冻结用例

  it('角色同名 upsert：内容不变不涨版本，变更后版本递增', async () => { // 用例：角色同名 upsert，内容不变不涨版本
    const session = await login('13900000008'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const created = await request(app) // 建工程
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '角色工程' }); // 标题
    const projectId = created.body.project.id as string; // 取工程 id
    const body = { // 角色请求体开始
      name: '小雨', // 角色名，作为 upsert 的业务键
      appearance_prompt: '银灰色短发，深蓝风衣，右眼下泪痣', // 外观提示词，用于图像生成
      seed: 42, // 随机种子，保证同角色可复现
      reference_asset_ids: ['asset-1'], // 参考素材 id 列表，验证原样保留
      voice_profile: '清冷少女音', // 音色描述，供配音使用
    }; // 结束角色请求体

    const first = await request(app) // 首次创建角色
      .post(`/api/v1/comic/projects/${projectId}/characters`) // 角色端点
      .set(auth(session, nextKey())) // 新幂等键
      .send(body); // 提交角色体
    expect(first.status).toBe(201); // 断言 201，表示新建
    expect(first.body.created).toBe(true); // 断言 created 为 true
    expect(first.body.character.version).toBe(1); // 断言版本为 1

    const repeated = await request(app) // 同内容再次提交
      .post(`/api/v1/comic/projects/${projectId}/characters`) // 同一角色端点
      .set(auth(session, nextKey())) // 新幂等键，避免走幂等回放而非 upsert 逻辑
      .send(body); // 同一请求体
    expect(repeated.status).toBe(200); // 断言 200 而非 201，说明命中 upsert 而非新建
    expect(repeated.body.created).toBe(false); // 断言 created 为 false
    expect(repeated.body.character.id).toBe(first.body.character.id); // 断言 id 未变，证明复用同一行
    expect(repeated.body.character.version).toBe(1); // 断言版本仍为 1，内容未变不涨版本

    const changed = await request(app) // 改动外观后再次提交
      .post(`/api/v1/comic/projects/${projectId}/characters`) // 同一角色端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ ...body, appearance_prompt: '银灰色长发，深蓝风衣' }); // 只替换外观提示词
    expect(changed.status).toBe(200); // 断言 200
    expect(changed.body.character.version).toBe(2); // 断言版本递增到 2

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 读取工程详情
    expect(detail.body.characters).toHaveLength(1); // 断言只有一个角色，证明按名称去重
    expect(detail.body.characters[0].reference_asset_ids).toEqual(['asset-1']); // 断言参考素材原样保留，未被覆盖清空
  }); // 结束角色 upsert 用例

  it('AI 建议返回结构稳定且需人工确认（不落库）', async () => { // 用例：AI 建议结构稳定且需人工确认，不落库
    const session = await login('13900000009'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const created = await request(app) // 建带简介的工程，为建议提供上下文
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '建议工程', synopsis: '少年在旧书店发现会说话的地图。' }); // 标题与简介
    const projectId = created.body.project.id as string; // 取工程 id

    const suggested = await request(app) // 请求 AI 建议
      .post(`/api/v1/comic/projects/${projectId}/suggest`) // 建议端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ kind: 'storyboard', count: 2 }); // 要两条分镜建议
    expect(suggested.status).toBe(200); // 断言 200
    expect(suggested.body.suggestion.requires_confirmation).toBe(true); // 断言需要人工确认，强调建议不自动生效
    expect(suggested.body.suggestion.model).toBe('mock-text-suggest'); // 断言模型名为 mock，说明测试不依赖真实模型服务
    expect(suggested.body.suggestion.items).toHaveLength(2); // 断言返回 2 条建议
    expect(suggested.body.suggestion.items[0].index).toBe(1); // 断言序号从 1 开始，结构稳定

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 读取详情确认建议未落库
    expect(detail.body.latest_storyboard).toBeNull(); // 断言最新分镜为空，证明建议只是预览
  }); // 结束 AI 建议用例

  it('写操作缺少 Idempotency-Key 被拒', async () => { // 用例：写操作缺少幂等键被拒
    const session = await login('13900000010'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益，让请求走到幂等校验而不是门禁
    const res = await request(app) // 发起创建请求
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session)) // 只带鉴权头，故意不传 idempotency-key
      .send({ title: '无幂等键' }); // 提交标题
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言校验失败错误码，指向缺失的请求头
  }); // 结束缺键用例
}); // 结束分镜角色建议分组
