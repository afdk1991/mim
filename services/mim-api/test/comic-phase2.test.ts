/** 契约测试：第 2 期 生成任务编排（generation_jobs）+ 成片合成（comic_films / film_versions） */

import { beforeEach, describe, expect, it } from 'vitest'; // 引入 vitest 的用例编排 API，beforeEach 负责每例重建内存库
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 只引入 Express 类型，用于标注全局 app
import { createApp } from '../src/app.js'; // createApp 是唯一装配入口
import { createDatabase } from '../src/db.js'; // createDatabase 建库，用例用内存库隔离

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，长度满足构建期对 secret 强度的校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄，用例内可直接写库造数据
let keyCounter = 0; // 幂等键自增计数器

function nextKey(): string { // 生成唯一幂等键
  keyCounter += 1; // 先自增再取值
  return `comic2-key-${keyCounter}`; // comic2 前缀便于区分来源
} // 结束 nextKey 定义

interface Session { // 登录会话契约
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键，用于权益授予与工程归属
} // 结束 Session 定义

async function login( // 登录辅助：先取验证码再换令牌，参数化标识、通道与区域
  identifier: string, // 登录标识
  provider: 'phone' | 'email' = 'phone', // 通道默认手机号
  region: 'cn' | 'global' = 'cn', // 区域默认 cn
): Promise<Session> { // 返回会话承诺
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region, provider, identifier }); // 一步申请验证码，参数原样透传
  expect(codeRes.status).toBe(201); // 断言 201 表示验证码已创建
  const loginRes = await request(app) // 用验证码换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ region, provider, identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } }); // 带 dev_code 与设备信息，设备字段是登录契约必填项
  expect(loginRes.status).toBe(200); // 断言 200
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回令牌与用户 id
} // 结束 login 定义

function auth(session: Session, key?: string) { // 构造鉴权头
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` }; // 固定 Bearer 头
  if (key) headers['idempotency-key'] = key; // 可选幂等键：写操作必传
  return headers; // 返回头对象
} // 结束 auth 定义

/** 直接写库授予模块权益（模拟下单 / 运营开通链路） */
function grantEntitlement(userId: string, region: 'cn' | 'global' = 'cn'): void { // 授予权益：直接写库模拟下单或运营开通
  const moduleRow = db // 先按区域查出模块主键
    .prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = ?`) // 用模块编码加区域唯一定位种子行
    .get(region) as { id: string } | undefined; // 取首行并按联合类型断言形状
  if (!moduleRow) throw new Error('comic.workbench module seed missing'); // 种子缺失直接抛错，避免门禁用例静默通过
  const now = new Date().toISOString(); // 统一时间戳，保证创建与更新时间一致
  db.prepare( // 插入权益行
    // SQL 模板：向权益表插入一行，占位符由 run 的实参填充
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`,
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now); // 执行插入并用用户与模块拼出稳定权益 id
} // 结束 grantEntitlement 定义

/** 建工程 + 确认分镜，返回 storyboarded 状态的工程与已确认分镜 id */
async function setupStoryboardedProject(session: Session, phone: string) { // 建工程并确认分镜，返回渲染前置所需的两级 id
  const created = await request(app) // 建工程
    .post('/api/v1/comic/projects') // 创建端点
    .set(auth(session, nextKey())) // 新幂等键
    .send({ title: `编排工程-${session.userId.slice(0, 8)}` }); // 标题带用户 id 前缀，便于在库里辨认归属
  expect(created.status).toBe(201); // 断言 201
  const projectId = created.body.project.id as string; // 取工程 id
  const confirmed = await request(app) // 提交并确认分镜，使状态进入 storyboarded
    .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 分镜端点挂在工程下
    .set(auth(session, nextKey())) // 新幂等键
    .send({ shots: [{ index: 1, description: '开场镜头' }], confirm: true }); // 单条分镜并显式确认
  expect(confirmed.status).toBe(201); // 断言 201
  return { projectId, storyboardId: confirmed.body.storyboard.id as string }; // 返回工程与分镜 id
} // 结束 setupStoryboardedProject 定义

/** 推进到 rendered：派 compose 任务 → start → complete */
async function driveProjectToRendered(session: Session, projectId: string) { // 推进到 rendered：派 compose 任务后走 start 与 complete
  const created = await request(app) // 派发 compose 任务
    .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
    .set(auth(session, nextKey())) // 新幂等键
    .send({ job_type: 'compose' }); // 任务类型 compose 触发工程进入生成态
  expect(created.status).toBe(201); // 断言 201
  const jobId = created.body.job.id as string; // 取任务 id
  await request(app).post(`/api/v1/comic/jobs/${jobId}/start`).set(auth(session, nextKey())); // 先 start 进入 running，此处只关心副作用不检查响应
  const completed = await request(app) // 再 complete 产出成片
    .post(`/api/v1/comic/jobs/${jobId}/complete`) // complete 端点
    .set(auth(session, nextKey())) // 新幂等键，避免被幂等回放挡住
    .send({ result: { object_key: 'films/demo.mp4' } }); // 提交成片对象键作为执行结果
  expect(completed.status).toBe(200); // 断言 200
  return jobId; // 返回任务 id
} // 结束 driveProjectToRendered 定义

beforeEach(() => { // 每例前置：重建内存库与应用，保证零共享状态
  db = createDatabase(':memory:'); // 内存库每次全新创建
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // env 传空对象即开发默认配置
  keyCounter = 0; // 重置幂等键计数
}); // 结束 beforeEach

describe('第 2 期门禁', () => { // describe 第 2 期门禁：新版端点同样受模块权益控制
  it('jobs / films 未解锁模块返回 403，解锁后放行', async () => { // 用例：未解锁 jobs 与 films 均 403，解锁后 200 且列表为空
    const session = await login('13900000021'); // 登录创作者
    const { projectId } = await (async () => { // 用立即执行函数先授权再建工程，锁定建工程的权益前提
      grantEntitlement(session.userId); // 授予权益
      return setupStoryboardedProject(session, '13900000021'); // 建已确认分镜的工程
    })(); // 结束立即执行函数
    // 撤销权益后验证门禁：直接删库模拟未解锁
    db.prepare(`DELETE FROM entitlements WHERE user_id = ?`).run(session.userId); // 删库撤销权益，模拟未解锁
    const deniedJobs = await request(app) // 未解锁查任务列表
      .get(`/api/v1/comic/projects/${projectId}/jobs`) // 任务列表端点
      .set(auth(session)); // 只带鉴权头
    expect(deniedJobs.status).toBe(403); // 断言 403
    expect(deniedJobs.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言功能未开通错误码
    const deniedFilms = await request(app) // 未解锁查成片列表
      .get(`/api/v1/comic/projects/${projectId}/films`) // 成片列表端点
      .set(auth(session)); // 只带鉴权头
    expect(deniedFilms.status).toBe(403); // 断言 403，两个新端点门禁一致

    grantEntitlement(session.userId); // 重新授予权益
    const allowedJobs = await request(app) // 解锁后查任务列表
      .get(`/api/v1/comic/projects/${projectId}/jobs`) // 同一端点
      .set(auth(session)); // 只带鉴权头
    expect(allowedJobs.status).toBe(200); // 断言 200，门禁放行
    expect(allowedJobs.body.items).toEqual([]); // 断言空数组，证明放行且无残留数据
    const allowedFilms = await request(app) // 解锁后查成片列表
      .get(`/api/v1/comic/projects/${projectId}/films`) // 同一端点
      .set(auth(session)); // 只带鉴权头
    expect(allowedFilms.status).toBe(200); // 断言 200
    expect(allowedFilms.body.items).toEqual([]); // 断言空数组
  }); // 结束门禁用例
}); // 结束第 2 期门禁分组

describe('生成任务编排（generation_jobs）', () => { // describe 生成任务编排：状态机与派发前置条件
  it('派发任务驱动 storyboarded → generating；draft 工程派发被拒', async () => { // 用例：派发任务驱动 storyboarded 到 generating，draft 工程派发被拒
    const session = await login('13900000022'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益

    // draft 工程不可派发
    const draft = await request(app) // 先建一个 draft 工程用于验证派发前置条件
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '草稿工程' }); // 标题
    const rejected = await request(app) // 对 draft 工程派发任务
      .post(`/api/v1/comic/projects/${draft.body.project.id}/jobs`) // 任务端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ job_type: 'image' }); // 类型 image
    expect(rejected.status).toBe(409); // 断言 409，状态机不允许 draft 派任务
    expect(rejected.body.code).toBe('CONFLICT'); // 断言冲突错误码

    const { projectId, storyboardId } = await setupStoryboardedProject(session, '13900000022'); // 建已确认分镜的工程，满足派发前置条件
    const created = await request(app) // 派发 image 任务
      .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ // 请求体开始
        job_type: 'image', // 任务类型 image
        storyboard_id: storyboardId, // 关联刚确认的分镜
        payload: { shot: 1 }, // 任务载荷
        cost_estimate_minor: 120, // 预估成本 120 分
      }); // 结束请求体
    expect(created.status).toBe(201); // 断言 201，任务已创建
    expect(created.body.job.status).toBe('queued'); // 断言初始状态 queued
    expect(created.body.job.job_type).toBe('image'); // 断言类型原样回显
    expect(created.body.job.storyboard_id).toBe(storyboardId); // 断言分镜引用已落库
    expect(created.body.job.payload).toEqual({ shot: 1 }); // 断言载荷原样保留
    expect(created.body.job.cost_estimate_minor).toBe(120); // 断言成本估算落库
    expect(created.body.project_status).toBe('generating'); // 断言派发同时把工程推进到 generating

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 查工程详情核对落库状态
    expect(detail.body.project.status).toBe('generating'); // 断言库内状态同步为 generating

    // 引用他工程分镜 → 404
    const missing = await request(app) // 引用不存在的分镜派发
      .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ job_type: 'image', storyboard_id: 'not-exists' }); // 分镜 id 明显不存在
    expect(missing.status).toBe(404); // 断言 404，不存在与无权限同语义
  }); // 结束派发用例

  it('状态机单向：queued → running → succeeded；非法迁移 409', async () => { // 用例：任务状态机单向迁移，非法迁移一律 409
    const session = await login('13900000023'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '13900000023'); // 建已确认分镜的工程

    const created = await request(app) // 派发 video 任务
      .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ job_type: 'video' }); // 类型 video
    const jobId = created.body.job.id as string; // 取任务 id

    // queued 不可直接 complete
    const premature = await request(app) // queued 状态直接 complete
      .post(`/api/v1/comic/jobs/${jobId}/complete`) // complete 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(premature.status).toBe(409); // 断言 409，跳过 running 非法

    const started = await request(app) // 正常 start
      .post(`/api/v1/comic/jobs/${jobId}/start`) // start 端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(started.status).toBe(200); // 断言 200
    expect(started.body.job.status).toBe('running'); // 断言状态变 running
    expect(started.body.job.started_at).not.toBeNull(); // 断言开始时间已写入

    // running 不可再次 start
    const restart = await request(app) // running 状态再次 start
      .post(`/api/v1/comic/jobs/${jobId}/start`) // start 端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(restart.status).toBe(409); // 断言 409，禁止重复开始

    const completed = await request(app) // 正常 complete
      .post(`/api/v1/comic/jobs/${jobId}/complete`) // complete 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ result: { object_key: 'shots/1.mp4' } }); // 提交结果对象键
    expect(completed.status).toBe(200); // 断言 200
    expect(completed.body.job.status).toBe('succeeded'); // 断言状态变 succeeded
    expect(completed.body.job.result).toEqual({ object_key: 'shots/1.mp4' }); // 断言结果原样保留
    expect(completed.body.job.finished_at).not.toBeNull(); // 断言结束时间已写入

    // 终态不可 cancel
    const canceled = await request(app) // 终态再尝试 cancel
      .post(`/api/v1/comic/jobs/${jobId}/cancel`) // cancel 端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(canceled.status).toBe(409); // 断言 409，终态不可取消
  }); // 结束状态机用例

  it('失败重试新建 job（retry_of 指向原 job），历史不覆盖', async () => { // 用例：失败重试新建任务并指向原任务，历史不被覆盖
    const session = await login('13900000024'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '13900000024'); // 建已确认分镜的工程

    const created = await request(app) // 派发 tts 任务
      .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ job_type: 'tts', payload: { voice: 'a' } }); // 类型 tts 并带音色载荷
    const jobId = created.body.job.id as string; // 取任务 id
    await request(app).post(`/api/v1/comic/jobs/${jobId}/start`).set(auth(session, nextKey())); // 先 start 才能进入可失败状态
    const failed = await request(app) // 标记任务失败
      .post(`/api/v1/comic/jobs/${jobId}/fail`) // fail 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ error_code: 'TTS_TIMEOUT' }); // 失败错误码
    expect(failed.body.job.status).toBe('failed'); // 断言状态为 failed
    expect(failed.body.job.error_code).toBe('TTS_TIMEOUT'); // 断言错误码落库

    const retried = await request(app) // 请求重试
      .post(`/api/v1/comic/jobs/${jobId}/retry`) // retry 端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(retried.status).toBe(201); // 断言 201，重试语义上是新建资源
    expect(retried.body.job.id).not.toBe(jobId); // 断言得到新的任务 id
    expect(retried.body.job.retry_of).toBe(jobId); // 断言 retry_of 指向原任务，保留追溯链
    expect(retried.body.job.status).toBe('queued'); // 断言新任务回到 queued
    expect(retried.body.job.payload).toEqual({ voice: 'a' }); // 断言载荷从原任务继承

    // 原 job 保持 failed 不变；非 failed 不可重试
    const original = await request(app).get(`/api/v1/comic/jobs/${jobId}`).set(auth(session)); // 回查原任务
    expect(original.body.job.status).toBe('failed'); // 断言原任务仍为 failed，历史不被覆盖
    const invalidRetry = await request(app) // 对非 failed 的新任务再次重试
      .post(`/api/v1/comic/jobs/${retried.body.job.id}/retry`) // retry 端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(invalidRetry.status).toBe(409); // 断言 409，仅失败任务可重试

    const list = await request(app) // 按状态过滤任务列表
      .get(`/api/v1/comic/projects/${projectId}/jobs?status=failed`) // 查询参数 status=failed
      .set(auth(session)); // 只带鉴权头
    expect(list.body.items).toHaveLength(1); // 断言只有一条失败任务，说明重试的是新记录
  }); // 结束重试用例

  it('compose 任务成功驱动工程 generating → rendered', async () => { // 用例：compose 任务成功驱动工程 generating 到 rendered
    const session = await login('13900000025'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '13900000025'); // 建已确认分镜的工程
    await driveProjectToRendered(session, projectId); // 走完整 compose 流程到 rendered

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 查工程详情
    expect(detail.body.project.status).toBe('rendered'); // 断言状态为 rendered
  }); // 结束 compose 用例

  it('跨用户访问任务与已删除工程任务统一 404', async () => { // 用例：跨用户与已删除工程的任务统一 404
    const owner = await login('13900000026'); // 属主登录
    grantEntitlement(owner.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(owner, '13900000026'); // 建工程
    const created = await request(app) // 属主派发任务
      .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
      .set(auth(owner, nextKey())) // 属主会话
      .send({ job_type: 'text' }); // 类型 text
    const jobId = created.body.job.id as string; // 取任务 id

    const other = await login('13900000027'); // 他人登录
    grantEntitlement(other.userId); // 他人也授予权益，排除门禁因素
    const peek = await request(app).get(`/api/v1/comic/jobs/${jobId}`).set(auth(other)); // 他人读取该任务
    expect(peek.status).toBe(404); // 断言 404，不泄漏存在性

    await request(app).delete(`/api/v1/comic/projects/${projectId}`).set(auth(owner, nextKey())); // 属主删除工程
    const gone = await request(app).get(`/api/v1/comic/jobs/${jobId}`).set(auth(owner)); // 删除后属主再查任务
    expect(gone.status).toBe(404); // 断言 404，与不存在同语义
  }); // 结束跨用户用例
}); // 结束任务编排分组

describe('成片合成（comic_films / film_versions）', () => { // describe 成片合成：成片与版本的状态流转
  it('未 rendered 工程不可合成；rendered 后创建 draft 成片 + 首个版本', async () => { // 用例：未 rendered 不可合成；rendered 后创建 draft 成片与首个版本
    const session = await login('13900000028'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '13900000028'); // 建工程

    const early = await request(app) // 未渲染就抢跑创建成片
      .post(`/api/v1/comic/projects/${projectId}/films`) // 成片端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '抢跑成片' }); // 标题
    expect(early.status).toBe(409); // 断言 409，状态校验前置

    await driveProjectToRendered(session, projectId); // 推进到 rendered
    const created = await request(app) // 创建成片
      .post(`/api/v1/comic/projects/${projectId}/films`) // 成片端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '雨夜追光·第 1 版', object_key: 'films/ep1-v1.mp4', duration_sec: 96, size_bytes: 1024 }); // 标题、对象键、时长与体积一次性给出
    expect(created.status).toBe(201); // 断言 201
    expect(created.body.film.status).toBe('draft'); // 断言初始状态 draft
    expect(created.body.film.version).toBe(1); // 断言成片版本号为 1
    expect(created.body.version.version_no).toBe(1); // 断言首个版本号也是 1
    expect(created.body.version.object_key).toBe('films/ep1-v1.mp4'); // 断言版本对象键与入参一致

    const list = await request(app) // 列出成片
      .get(`/api/v1/comic/projects/${projectId}/films`) // 成片列表端点
      .set(auth(session)); // 只带鉴权头
    expect(list.body.items).toHaveLength(1); // 断言仅一条
  }); // 结束创建成片用例

  it('提交审核需最新版本登记 object_key；发布驱动工程 → published', async () => { // 用例：提交审核要求最新版本登记对象键；发布驱动工程为 published
    const session = await login('13900000029'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '13900000029'); // 建工程
    await driveProjectToRendered(session, projectId); // 推进到 rendered

    // 无 object_key 的成片不可提交审核
    const noAsset = await request(app) // 创建无产物的成片
      .post(`/api/v1/comic/projects/${projectId}/films`) // 成片端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '无产物成片' }); // 只给标题，不给对象键
    const noAssetFilmId = noAsset.body.film.id as string; // 取成片 id
    const blocked = await request(app) // 尝试提交审核
      .post(`/api/v1/comic/films/${noAssetFilmId}/submit-review`) // 提交审核端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(blocked.status).toBe(409); // 断言 409，缺对象键不可提交

    // 追加带 object_key 的版本后可提交
    const versioned = await request(app) // 追加带对象键的新版本
      .post(`/api/v1/comic/films/${noAssetFilmId}/versions`) // 版本端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ object_key: 'films/ep1-v2.mp4', duration_sec: 98 }); // 对象键与时长
    expect(versioned.status).toBe(201); // 断言 201
    expect(versioned.body.version.version_no).toBe(2); // 断言版本号递增到 2

    const submitted = await request(app) // 再次提交审核
      .post(`/api/v1/comic/films/${noAssetFilmId}/submit-review`) // 提交审核端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(submitted.status).toBe(200); // 断言 200
    expect(submitted.body.film.status).toBe('reviewing'); // 断言状态变 reviewing

    // draft 不可直接发布；reviewing 发布成功
    const published = await request(app) // 从 reviewing 发布
      .post(`/api/v1/comic/films/${noAssetFilmId}/publish`) // 发布端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(published.status).toBe(200); // 断言 200
    expect(published.body.film.status).toBe('published'); // 断言状态变 published
    expect(published.body.film.current_version_id).toBe(versioned.body.version.id); // 断言当前版本指向刚追加的版本

    const detail = await request(app).get(`/api/v1/comic/films/${noAssetFilmId}`).set(auth(session)); // 查成片详情
    expect(detail.body.versions).toHaveLength(2); // 断言共有两个版本
    expect(detail.body.versions[1].published_at).not.toBeNull(); // 断言被发布版本有发布时间

    const project = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 查工程详情
    expect(project.body.project.status).toBe('published'); // 断言工程随成片发布变为 published
  }); // 结束提交审核用例

  it('驳回回到 draft 并留原因；published 发新版回到 draft；归档为终态', async () => { // 用例：驳回回 draft 留原因；发布后发新版回 draft；归档为终态
    const session = await login('13900000030'); // 登录创作者
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '13900000030'); // 建工程
    await driveProjectToRendered(session, projectId); // 推进到 rendered

    const created = await request(app) // 创建带产物的成片
      .post(`/api/v1/comic/projects/${projectId}/films`) // 成片端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '驳回成片', object_key: 'films/ep2-v1.mp4' }); // 标题与对象键
    const filmId = created.body.film.id as string; // 取成片 id
    await request(app).post(`/api/v1/comic/films/${filmId}/submit-review`).set(auth(session, nextKey())); // 提交审核，只关心状态副作用

    const rejected = await request(app) // 驳回该成片
      .post(`/api/v1/comic/films/${filmId}/reject`) // 驳回端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ reason: '第 3 镜头口型不同步' }); // 驳回原因
    expect(rejected.status).toBe(200); // 断言 200
    expect(rejected.body.film.status).toBe('draft'); // 断言状态回到 draft
    expect(rejected.body.film.review_note).toBe('第 3 镜头口型不同步'); // 断言驳回原因落库

    // 重走审核 → 发布 → 发新版回到 draft，已发布版本不被覆盖
    await request(app).post(`/api/v1/comic/films/${filmId}/submit-review`).set(auth(session, nextKey())); // 重走提交审核
    await request(app).post(`/api/v1/comic/films/${filmId}/publish`).set(auth(session, nextKey())); // 再次发布
    const newVersion = await request(app) // 追加新版本
      .post(`/api/v1/comic/films/${filmId}/versions`) // 版本端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ object_key: 'films/ep2-v2.mp4' }); // 新对象键
    expect(newVersion.status).toBe(201); // 断言 201
    const afterNewVersion = await request(app).get(`/api/v1/comic/films/${filmId}`).set(auth(session)); // 查成片详情
    expect(afterNewVersion.body.film.status).toBe('draft'); // 断言发新版后状态回 draft
    expect(afterNewVersion.body.film.current_version_id).not.toBeNull(); // 断言当前版本 id 仍保留，未被清空
    expect(afterNewVersion.body.versions[0].published_at).not.toBeNull(); // 断言旧版本仍保留发布时间，已发布内容不被覆盖

    // 归档终态：不可追加版本、不可再次归档
    const archived = await request(app) // 归档成片
      .post(`/api/v1/comic/films/${filmId}/archive`) // 归档端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(archived.body.film.status).toBe('archived'); // 断言状态为 archived
    const appendAfterArchive = await request(app) // 归档后再追加版本
      .post(`/api/v1/comic/films/${filmId}/versions`) // 版本端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ object_key: 'films/ep2-v3.mp4' }); // 新对象键
    expect(appendAfterArchive.status).toBe(409); // 断言 409，终态禁止追加
    const archiveAgain = await request(app) // 再次归档
      .post(`/api/v1/comic/films/${filmId}/archive`) // 归档端点
      .set(auth(session, nextKey())); // 新幂等键
    expect(archiveAgain.status).toBe(409); // 断言 409，重复归档同样被拒
  }); // 结束驳回与归档用例

  it('跨用户访问成片统一 404', async () => { // 用例：跨用户访问成片统一 404
    const owner = await login('13900000031'); // 属主登录
    grantEntitlement(owner.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(owner, '13900000031'); // 建工程
    await driveProjectToRendered(owner, projectId); // 推进到 rendered
    const created = await request(app) // 属主创建成片
      .post(`/api/v1/comic/projects/${projectId}/films`) // 成片端点
      .set(auth(owner, nextKey())) // 属主会话
      .send({ title: '私有成片' }); // 标题
    const filmId = created.body.film.id as string; // 取成片 id

    const other = await login('13900000032'); // 他人登录
    grantEntitlement(other.userId); // 他人也授予权益
    const peek = await request(app).get(`/api/v1/comic/films/${filmId}`).set(auth(other)); // 他人读取成片
    expect(peek.status).toBe(404); // 断言 404，不泄漏存在性
    const peekList = await request(app) // 他人查该工程的成片列表
      .get(`/api/v1/comic/projects/${projectId}/films`) // 成片列表端点
      .set(auth(other)); // 他人会话
    expect(peekList.status).toBe(404); // 断言 404，列表同样按属主隔离
  }); // 结束跨用户成片用例
}); // 结束成片合成分组
