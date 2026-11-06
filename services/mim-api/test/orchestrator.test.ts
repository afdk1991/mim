/** 契约测试：ai-orchestrator 队列消费 + 产物登记 + media 资产读出（08 §2 / §3.2 / §6） */

import { mkdtempSync, rmSync } from 'node:fs'; // 建临时目录与递归删除目录的同步 API
import { tmpdir } from 'node:os'; // 取系统临时目录作为存储根
import { join } from 'node:path'; // 路径拼接工具
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'; // 额外引入 vi，用于给全局 fetch 打桩
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 只引入 Express 类型，用于标注全局 app
import { createApp } from '../src/app.js'; // createApp 是唯一装配入口
import { createDatabase } from '../src/db.js'; // createDatabase 建库，用例用内存库隔离
import { createStorage, type StorageAdapter } from '../src/storage.js'; // 同时引入存储工厂与适配器类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，存储签名与 JWT 共用同一来源

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 数据库句柄，用例内直接写库造数据
let storage: StorageAdapter; // 存储适配器，产物落盘经它
let storageDir: string; // 每例独立的临时存储目录
let keyCounter = 0; // 幂等键自增计数器

function nextKey(): string { // 生成唯一幂等键
  keyCounter += 1; // 先自增再取值
  return `orch-key-${keyCounter}`; // orch 前缀便于区分来源
} // 结束 nextKey 定义

interface Session { // 登录会话契约
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键，用于权益授予
} // 结束 Session 定义

async function login(identifier: string): Promise<Session> { // 登录辅助：固定 cn 区手机号通道
  const codeRes = await request(app) // 申请验证码
    .post('/api/v1/auth/code') // 验证码端点
    .send({ region: 'cn', provider: 'phone', identifier }); // 传区域、通道与标识
  expect(codeRes.status).toBe(201); // 断言 201 表示验证码已创建
  const loginRes = await request(app) // 用验证码换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ // 请求体开始
      region: 'cn', // 区域固定 cn
      provider: 'phone', // 通道固定手机号
      identifier, // 登录标识
      code: codeRes.body.dev_code, // 使用刚拿到的 dev_code
      device: { platform: 'web', name: 'test' }, // 设备信息是登录契约必填项
    }); // 结束请求体
  expect(loginRes.status).toBe(200); // 断言 200
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回令牌与用户 id
} // 结束 login 定义

function auth(session: Session, key?: string) { // 构造鉴权头
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` }; // 固定 Bearer 头
  if (key) headers['idempotency-key'] = key; // 可选幂等键：写操作必传
  return headers; // 返回头对象
} // 结束 auth 定义

/** 直接写库授予模块权益（模拟下单 / 运营开通链路） */
function grantEntitlement(userId: string): void { // 授予权益：直接写库模拟下单开通
  const moduleRow = db.prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`).get() as // 查模块主键，下一行是类型联合的第一支
    | { id: string } // 类型分支：命中种子时返回模块 id
    | undefined; // 类型分支：未命中为 undefined
  if (!moduleRow) throw new Error('comic.workbench module seed missing'); // 种子缺失直接抛错，避免用例静默通过
  const now = new Date().toISOString(); // 统一时间戳，保证创建与更新时间一致
  db.prepare( // 插入权益行
    // 参数化写入权益行，状态固定 active、版本固定 1
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`, // 关闭模板：VALUES 占位符覆盖全部列
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now); // 写入权益并复用同一时间戳
} // 结束 grantEntitlement 定义

/** 建工程 + 确认分镜 */
async function setupStoryboardedProject(session: Session, title: string) { // 辅助：建工程并确认分镜，返回工程 id 与分镜 id
  const created = await request(app) // 建工程
    .post('/api/v1/comic/projects') // 创建端点
    .set(auth(session, nextKey())) // 新幂等键
    .send({ title }); // 标题由调用方传入，便于在失败信息中定位用例
  expect(created.status).toBe(201); // 断言 201
  const projectId = created.body.project.id as string; // 取工程 id
  const confirmed = await request(app) // 提交并确认分镜，使工程可创建任务
    .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 分镜端点
    .set(auth(session, nextKey())) // 新幂等键
    .send({ shots: [{ index: 1, description: '开场镜头' }], confirm: true }); // 单条分镜并显式确认
  expect(confirmed.status).toBe(201); // 断言 201
  return { projectId, storyboardId: confirmed.body.storyboard.id as string }; // 返回两个 id，供后续任务引用分镜
} // 结束 setupStoryboardedProject 定义

async function dispatchJob( // 辅助：派发任务，统一断言 201 并返回任务 id
  session: Session, // 会话参数
  projectId: string, // 目标工程 id
  body: Record<string, unknown>, // 任务请求体
): Promise<string> { // 返回任务 id 的承诺
  const created = await request(app) // 创建任务
    .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点挂在工程下
    .set(auth(session, nextKey())) // 新幂等键
    .send(body); // 透传请求体
  expect(created.status).toBe(201); // 断言 201
  return created.body.job.id as string; // 返回任务 id
} // 结束 dispatchJob 定义

/** 预签名 URL 只取 path，避免 supertest 每次新建服务器的端口差异 */
function pathOf(url: string): string { // 只保留 path 与 query，规避每次新建服务的端口差异
  const parsed = new URL(url); // 解析绝对 URL
  return `${parsed.pathname}${parsed.search}`; // 返回 pathname 与查询串
} // 结束 pathOf 定义

beforeEach(() => { // 每例前置：重建临时目录、存储、库与应用
  storageDir = mkdtempSync(join(tmpdir(), 'mim-orch-')); // 先建临时目录
  storage = createStorage({ // 创建存储适配器
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir }, // 显式指定本地驱动与落盘目录
    jwtSecret: JWT_SECRET, // 存储签名使用测试密钥
    fallbackDir: storageDir, // 回退目录指向同一临时目录
  }); // 结束 createStorage 参数
  db = createDatabase(':memory:'); // 内存库每次全新创建
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage }); // 注入存储构造应用，env 为空即开发默认
  keyCounter = 0; // 重置幂等键计数
}); // 结束 beforeEach

afterEach(() => { // 后置清理：还原打桩并删除临时目录
  vi.unstubAllGlobals(); // 还原全局 fetch，避免打桩泄漏到后续用例
  rmSync(storageDir, { recursive: true, force: true }); // 递归强制删除，避免 Windows 文件句柄残留
}); // 结束 afterEach

describe('能力自检', () => { // describe 能力自检：默认上限与保留期契约
  it('GET /ai/capabilities 暴露 provider / 成本上限 / 保留期 / 存储驱动', async () => { // 用例：能力端点暴露提供方、成本上限、保留期与存储驱动
    const session = await login('13900000041'); // 登录
    grantEntitlement(session.userId); // 授予权益

    const res = await request(app).get('/api/v1/ai/capabilities').set(auth(session)); // 查能力
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.ai.provider).toBe('mock'); // 断言使用 mock 提供方
    expect(res.body.ai.provider_configured).toBe(true); // 断言提供方已配置
    expect(res.body.ai.job_cost_limit_minor).toBe(100000); // 断言单任务成本上限默认 100000 分
    expect(res.body.ai.daily_cost_limit_minor).toBe(500000); // 断言单日成本上限默认 500000 分
    expect(res.body.ai.asset_ttl_days).toBe(90); // 断言资产保留期默认 90 天
    expect(res.body.ai.supported_job_types).toEqual(['text', 'image', 'video', 'tts', 'compose']); // 断言支持的任务类型集合与顺序稳定
    expect(res.body.storage).toEqual({ driver: 'local', configured: true }); // 断言存储为本地驱动且已配置

    // 未解锁模块 → 403
    db.prepare('DELETE FROM entitlements WHERE user_id = ?').run(session.userId); // 删掉权益，模拟未解锁用户
    const denied = await request(app).get('/api/v1/ai/capabilities').set(auth(session)); // 再查能力
    expect(denied.status).toBe(403); // 断言 403
    expect(denied.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言功能未开通错误码
  }); // 结束能力自检用例
}); // 结束能力自检分组

describe('队列消费（POST /ai/jobs/:id/run）', () => { // describe 队列消费：触发任务后的状态与产物
  it('image 任务成功：job succeeded、产物落库、media 可下载', async () => { // 用例：image 任务成功，产物落库且 media 可下载
    const session = await login('13900000042'); // 登录
    grantEntitlement(session.userId); // 授予权益
    const { projectId, storyboardId } = await setupStoryboardedProject(session, '编排-图像'); // 建已确认分镜的工程，image 任务需要分镜上下文
    const jobId = await dispatchJob(session, projectId, { // 派发 image 任务
      job_type: 'image', // 任务类型 image
      storyboard_id: storyboardId, // 关联刚确认的分镜
      payload: { shot: 1 }, // 任务载荷
      cost_estimate_minor: 120, // 预估成本 120 分，低于默认上限
    }); // 结束任务请求体

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200
    expect(run.body.run.status).toBe('succeeded'); // 断言 run 状态 succeeded
    expect(run.body.run.provider).toBe('mock'); // 断言使用 mock 提供方
    expect(run.body.job.status).toBe('succeeded'); // 断言 job 状态同步为 succeeded
    expect(run.body.job.started_at).not.toBeNull(); // 断言开始时间已写入
    expect(run.body.job.finished_at).not.toBeNull(); // 断言结束时间已写入
    expect(run.body.job.result.object_key).toBe(run.body.run.object_key); // 断言 job 结果对象键与 run 一致
    expect(run.body.job.result.object_key.startsWith(`${session.userId}/${projectId}/`)).toBe(true); // 断言对象键按用户与工程分层，便于隔离与清理
    expect(run.body.job.result.mime).toBe('image/png'); // 断言产物 MIME 为 png

    const assets = await request(app) // 查该工程的产物列表
      .get(`/api/v1/media/assets?project_id=${projectId}`) // 按工程 id 过滤
      .set(auth(session)); // 读操作只带鉴权头
    expect(assets.status).toBe(200); // 断言 200
    expect(assets.body.items).toHaveLength(1); // 断言只有一条产物
    const asset = assets.body.items[0]; // 取第一条供字段断言
    expect(asset.object_key).toBe(run.body.run.object_key); // 断言资产对象键与 run 一致
    expect(asset.asset_type).toBe('image'); // 断言资产类型为 image
    expect(asset.expires_at).not.toBeNull(); // 断言普通素材带过期时间，受保留期约束
    expect(typeof asset.download_url).toBe('string'); // 断言返回下载地址字符串，前端可直接使用

    const download = await request(app).get(pathOf(asset.download_url)); // 按下载地址取回内容
    expect(download.status).toBe(200); // 断言 200
    expect(download.headers['content-type']).toContain('image/png'); // 断言内容类型为 png
    expect(download.body.length).toBeGreaterThan(0); // 断言内容非空，证明确实落盘
  }); // 结束 image 成功用例

  it('重复触发已消费任务 → 409；跨用户任务 → 404', async () => { // 用例：重复触发返回 409，跨用户访问返回 404
    const session = await login('13900000043'); // 登录
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '编排-重复'); // 建工程
    const jobId = await dispatchJob(session, projectId, { job_type: 'text' }); // 派发 text 任务

    const first = await request(app) // 首次触发
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(first.status).toBe(200); // 断言 200
    expect(first.body.run.status).toBe('succeeded'); // 断言执行成功

    const second = await request(app) // 再次触发同一任务
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键，避免被幂等回放挡住
      .send({}); // 空请求体
    expect(second.status).toBe(409); // 断言 409，任务已被消费
    expect(second.body.code).toBe('CONFLICT'); // 断言冲突错误码
    expect(second.body.details.status).toBe('succeeded'); // 断言 details 透传当前状态，前端可据此提示

    const other = await login('13900000044'); // 另一个用户登录
    grantEntitlement(other.userId); // 他人也授予权益，排除门禁因素
    const foreign = await request(app) // 他人触发非本人任务
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(other, nextKey())) // 他人会话
      .send({}); // 空请求体
    expect(foreign.status).toBe(404); // 断言 404，不泄漏任务存在性
    expect(foreign.body.code).toBe('NOT_FOUND'); // 断言未找到错误码
  }); // 结束重复触发用例

  it('compose 成功驱动工程 generating → rendered，成片长期保留', async () => { // 用例：compose 成功驱动 generating 到 rendered，成片长期保留
    const session = await login('13900000045'); // 登录
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '编排-合成'); // 建工程
    const jobId = await dispatchJob(session, projectId, { job_type: 'compose' }); // 派发 compose 任务，创建即触发工程进入生成态

    const mid = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 派发后立即查详情
    expect(mid.body.project.status).toBe('generating'); // 断言工程已进入 generating

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200
    expect(run.body.run.status).toBe('succeeded'); // 断言执行成功

    const detail = await request(app).get(`/api/v1/comic/projects/${projectId}`).set(auth(session)); // 执行后查详情
    expect(detail.body.project.status).toBe('rendered'); // 断言状态迁移到 rendered

    const assets = await request(app) // 查 final 类型产物
      .get(`/api/v1/media/assets?project_id=${projectId}&asset_type=final`) // 同时按工程与资产类型过滤
      .set(auth(session)); // 只带鉴权头
    expect(assets.body.items).toHaveLength(1); // 断言成片只有一条
    expect(assets.body.items[0].expires_at).toBeNull(); // 断言成片不过期，属于长期保留
  }); // 结束 compose 用例
}); // 结束队列消费分组

describe('失败路径（不伪造外部产物）', () => { // describe 失败路径：失败不得伪造产物
  it('单任务成本超限 → job failed COST_LIMIT_EXCEEDED', async () => { // 用例：单任务成本超限时任务失败
    app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AI_JOB_COST_LIMIT_MINOR: '1' }, storage }); // 用极低成本上限重建应用，制造超限条件
    const session = await login('13900000046'); // 登录
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '编排-成本'); // 建工程
    const jobId = await dispatchJob(session, projectId, { job_type: 'image', cost_estimate_minor: 100 }); // 派发预估 100 分的任务，必然超过上限 1

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200，业务失败仍在响应体内表达
    expect(run.body.run.status).toBe('failed'); // 断言 run 状态 failed
    expect(run.body.run.error_code).toBe('COST_LIMIT_EXCEEDED'); // 断言错误码为成本超限
    expect(run.body.job.status).toBe('failed'); // 断言 job 状态同步 failed
    expect(run.body.job.error_code).toBe('COST_LIMIT_EXCEEDED'); // 断言 job 错误码与 run 一致

    const assets = await request(app) // 查产物
      .get(`/api/v1/media/assets?project_id=${projectId}`) // 按工程过滤
      .set(auth(session)); // 只带鉴权头
    expect(assets.body.items).toEqual([]); // 断言无产物，失败不生成占位素材
  }); // 结束成本超限用例

  it('真实提供方未配置凭证 → job failed PROVIDER_NOT_CONFIGURED', async () => { // 用例：真实提供方缺凭证时任务失败
    app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AI_PROVIDER: 'openai' }, storage }); // 切到 openai 但只给提供方名，不注入密钥
    const session = await login('13900000047'); // 登录
    grantEntitlement(session.userId); // 授予权益

    const caps = await request(app).get('/api/v1/ai/capabilities').set(auth(session)); // 查能力
    expect(caps.body.ai.provider).toBe('openai'); // 断言提供方为 openai
    expect(caps.body.ai.provider_configured).toBe(false); // 断言未配置凭证

    const { projectId } = await setupStoryboardedProject(session, '编排-未配置'); // 建工程
    const jobId = await dispatchJob(session, projectId, { job_type: 'tts' }); // 派发 tts 任务

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200
    expect(run.body.run.status).toBe('failed'); // 断言 run 失败
    expect(run.body.run.error_code).toBe('PROVIDER_NOT_CONFIGURED'); // 断言错误码为提供方未配置
    expect(run.body.job.status).toBe('failed'); // 断言 job 同步失败
  }); // 结束缺凭证用例

  it('openai 提供方不支持的任务类型（video/tts/compose）→ PROVIDER_NOT_CONFIGURED', async () => { // 用例：openai 不支持的任务类型同样报未配置
    app = createApp({ // 重建应用
      db, // 复用同一内存库
      jwtSecret: JWT_SECRET, // 测试密钥
      env: { MIM_AI_PROVIDER: 'openai', MIM_AI_OPENAI_API_KEY: 'sk-test' }, // 配置 openai 与假密钥，使提供方视为已配置
      storage, // 沿用同一存储
    }); // 结束应用参数
    const session = await login('13900000048'); // 登录
    grantEntitlement(session.userId); // 授予权益

    const caps = await request(app).get('/api/v1/ai/capabilities').set(auth(session)); // 查能力
    expect(caps.body.ai.provider).toBe('openai'); // 断言提供方为 openai
    expect(caps.body.ai.provider_configured).toBe(true); // 断言已配置
    expect(caps.body.ai.mock_provider).toBe(false); // 断言非 mock 模式
    expect(caps.body.ai.supported_job_types).toEqual(['text', 'image']); // 断言仅支持 text 与 image，其余类型无能力
    expect(caps.body.ai.base_url).toBe('https://api.openai.com/v1'); // 断言默认 base_url 指向官方 v1
    expect(caps.body.ai.text_model).toBe('gpt-4o-mini'); // 断言默认文本模型

    const { projectId } = await setupStoryboardedProject(session, '编排-不支持类型'); // 建工程
    const jobId = await dispatchJob(session, projectId, { job_type: 'video' }); // 派发 video 任务，属于当前提供方不支持的类型
    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200
    expect(run.body.run.status).toBe('failed'); // 断言 run 失败
    expect(run.body.run.error_code).toBe('PROVIDER_NOT_CONFIGURED'); // 断言错误码为提供方未配置，表达能力缺口
  }); // 结束不支持类型用例
}); // 结束失败路径分组

describe('真实提供方（openai 兼容协议，fetch 打桩）', () => { // describe 真实提供方：用 fetch 打桩验证 openai 兼容协议
  const OPENAI_ENV = { // 固定的 openai 兼容环境变量集合
    MIM_AI_PROVIDER: 'openai', // 指定提供方为 openai
    MIM_AI_OPENAI_API_KEY: 'sk-test', // 假密钥，仅用于让配置判定通过
    MIM_AI_BASE_URL: 'https://llm.example.test/v1', // 指向测试域名，避免真实外网调用
    MIM_AI_TEXT_MODEL: 'test-text-model', // 指定文本模型名
    MIM_AI_IMAGE_MODEL: 'test-image-model', // 指定图像模型名
  }; // 结束环境变量定义

  function stubFetch(handler: (url: string, body: unknown) => { status?: number; json: unknown }) { // 安装 fetch 打桩，按请求返回预设响应
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { // 用 vi.fn 替换 fetch 实现
      const url = String(input); // 取请求地址字符串
      const body = init?.body ? JSON.parse(String(init.body)) : undefined; // 解析请求体 JSON，GET 请求时为空
      const { status = 200, json } = handler(url, body); // 交给 handler 决定状态码与响应体
      return new Response(JSON.stringify(json), { // 构造真实 Response 对象，供被测代码按标准解析
        status, // 状态码由 handler 决定，默认 200
        headers: { 'content-type': 'application/json' }, // 声明 JSON 内容类型
      }); // 结束 Response 参数
    }); // 结束 fetch 实现
    vi.stubGlobal('fetch', spy); // 全局替换 fetch，afterEach 会还原
    return spy; // 返回 spy 以便断言调用次数与参数
  } // 结束 stubFetch 定义

  it('text 任务真实调用 chat/completions，产物为模型文本', async () => { // 用例：text 任务真实调用 chat/completions，产物为模型文本
    app = createApp({ db, jwtSecret: JWT_SECRET, env: OPENAI_ENV, storage }); // 用 openai 环境重建应用
    const spy = stubFetch((url, body) => { // 安装打桩并在 handler 内断言请求
      expect(url).toBe('https://llm.example.test/v1/chat/completions'); // 断言命中 chat/completions 端点
      const payload = body as { model: string; messages: Array<{ role: string; content: string }> }; // 断言请求体形状
      expect(payload.model).toBe('test-text-model'); // 断言模型名来自环境变量
      expect(payload.messages[1].content).toContain('写一句开场白'); // 断言用户消息包含任务提示词
      return { // 返回预设响应
        json: { // 响应体开始
          choices: [{ message: { role: 'assistant', content: '夜色降临，主角登场。' } }], // 标准 chat 响应，含助手文本
          usage: { total_tokens: 42 }, // 用量字段供成本统计
        }, // 结束响应体
      }; // 结束 handler
    }); // 结束 stubFetch 调用

    const session = await login('13900000049'); // 登录
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '编排-真实文本'); // 建工程
    const jobId = await dispatchJob(session, projectId, { // 派发 text 任务
      job_type: 'text', // 任务类型 text
      payload: { prompt: '写一句开场白' }, // 带提示词
    }); // 结束请求体

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200
    expect(spy).toHaveBeenCalledTimes(1); // 断言 fetch 只调用一次，避免重复计费
    expect(run.body.run.status).toBe('succeeded'); // 断言 run 成功
    expect(run.body.run.provider).toBe('openai'); // 断言提供方为 openai
    expect(run.body.job.result.provider).toBe('openai'); // 断言 job 结果记录提供方

    const assets = await request(app) // 查产物
      .get(`/api/v1/media/assets?project_id=${projectId}`) // 按工程过滤
      .set(auth(session)); // 只带鉴权头
    expect(assets.body.items).toHaveLength(1); // 断言一条产物
    const download = await request(app).get(pathOf(assets.body.items[0].download_url)); // 下载该产物
    expect(download.status).toBe(200); // 断言 200
    const manifest = JSON.parse(download.text) as { provider: string; content: string; model: string }; // 解析文本清单，验证落库内容
    expect(manifest.provider).toBe('openai'); // 断言清单记录提供方
    expect(manifest.model).toBe('test-text-model'); // 断言清单记录模型名
    expect(manifest.content).toBe('夜色降临，主角登场。'); // 断言清单正文与上游返回一致
  }); // 结束真实文本用例

  it('image 任务真实调用 images/generations，b64 产物落盘为 PNG', async () => { // 用例：image 任务真实调用 images/generations，b64 落盘为 PNG
    app = createApp({ db, jwtSecret: JWT_SECRET, env: OPENAI_ENV, storage }); // 用 openai 环境重建应用
    const png = // 1x1 透明 PNG 的 base64，仅用于验证解码落盘
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; // 上一行赋值的字符串续行
    stubFetch((url, body) => { // 安装打桩
      expect(url).toBe('https://llm.example.test/v1/images/generations'); // 断言命中图像生成端点
      const payload = body as { model: string; prompt: string }; // 断言请求体形状
      expect(payload.model).toBe('test-image-model'); // 断言模型名
      expect(payload.prompt).toBe('一座霓虹城市'); // 断言提示词原样透传
      return { json: { data: [{ b64_json: png }] } }; // 返回带 b64_json 的响应
    }); // 结束 handler

    const session = await login('13900000050'); // 登录
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '编排-真实图像'); // 建工程
    const jobId = await dispatchJob(session, projectId, { // 派发 image 任务
      job_type: 'image', // 任务类型 image
      payload: { prompt: '一座霓虹城市' }, // 提示词
    }); // 结束请求体

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200
    expect(run.body.run.status).toBe('succeeded'); // 断言执行成功
    expect(run.body.job.result.mime).toBe('image/png'); // 断言产物 MIME 为 png，说明 b64 被解码并按图片落盘

    const assets = await request(app) // 查产物
      .get(`/api/v1/media/assets?project_id=${projectId}`) // 按工程过滤
      .set(auth(session)); // 只带鉴权头
    const download = await request(app).get(pathOf(assets.body.items[0].download_url)); // 下载产物
    expect(download.status).toBe(200); // 断言 200
    expect(download.headers['content-type']).toContain('image/png'); // 断言内容类型为 png
    expect(download.body.length).toBeGreaterThan(0); // 断言内容非空
  }); // 结束真实图像用例

  it('上游 HTTP 500 → job failed（不伪造产物，可 retry）', async () => { // 用例：上游 500 时任务失败且不伪造产物
    app = createApp({ db, jwtSecret: JWT_SECRET, env: OPENAI_ENV, storage }); // 用 openai 环境重建应用
    stubFetch(() => ({ status: 500, json: { error: { message: 'upstream down' } } })); // 打桩固定返回 500 与错误信息

    const session = await login('13900000051'); // 登录
    grantEntitlement(session.userId); // 授予权益
    const { projectId } = await setupStoryboardedProject(session, '编排-上游失败'); // 建工程
    const jobId = await dispatchJob(session, projectId, { // 派发 text 任务
      job_type: 'text', // 任务类型 text
      payload: { prompt: 'hello' }, // 提示词
    }); // 结束请求体

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200
    expect(run.body.run.status).toBe('failed'); // 断言 run 失败
    expect(run.body.job.status).toBe('failed'); // 断言 job 失败
    expect(String(run.body.job.result.error)).toContain('HTTP 500'); // 断言错误信息含 HTTP 500，保留上游原因便于排查

    const assets = await request(app) // 查产物
      .get(`/api/v1/media/assets?project_id=${projectId}`) // 按工程过滤
      .set(auth(session)); // 只带鉴权头
    expect(assets.body.items).toEqual([]); // 断言无产物，失败不留半成品
  }); // 结束上游失败用例
}); // 结束真实提供方分组
