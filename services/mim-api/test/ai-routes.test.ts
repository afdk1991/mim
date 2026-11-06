/** 契约测试：ai 路由 HTTP 层（鉴权 401 / 归属 404 / 非 queued CONFLICT / 触发成功） */

import { mkdtempSync, rmSync } from 'node:fs'; // 建临时目录与递归删除目录的同步 API
import { tmpdir } from 'node:os'; // 取系统临时目录作为存储根
import { join } from 'node:path'; // 路径拼接工具
import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 引入 afterEach 用于清理本用例产生的临时存储
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 只引入 Express 类型，用于标注全局 app
import { createApp } from '../src/app.js'; // createApp 是唯一装配入口
import { createDatabase } from '../src/db.js'; // createDatabase 建库，用例用内存库隔离
import { createStorage, type StorageAdapter } from '../src/storage.js'; // 同时引入存储工厂与适配器类型，供注入与断言

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，存储签名与 JWT 共用同一来源

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 数据库句柄，用例内直接写库造数据
let storage: StorageAdapter; // 存储适配器，AI 产物落盘经它
let storageDir: string; // 每例独立的临时存储目录
let keyCounter = 0; // 幂等键自增计数器

function nextKey(): string { // 生成唯一幂等键
  keyCounter += 1; // 先自增再取值
  return `ai-route-key-${keyCounter}`; // ai-route 前缀便于区分来源
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

function grantEntitlement(userId: string): void { // 授予权益：直接写库模拟下单开通
  const moduleRow = db.prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`).get() as // 查模块主键，下一行是类型联合的第一支
    | { id: string } // 类型分支：命中种子时返回模块 id
    | undefined; // 类型分支：未命中为 undefined
  if (!moduleRow) throw new Error('comic.workbench module seed missing'); // 种子缺失直接抛错，避免用例静默通过
  const now = new Date().toISOString(); // 统一时间戳，保证创建与更新时间一致
  db.prepare( // 插入权益行
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`, // 关闭模板，随后执行插入并拼出稳定权益 id
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now); // 用用户与模块拼权益 id，并写入同一时间戳
} // 结束 grantEntitlement 定义

beforeEach(() => { // 每例前置：重建临时目录、存储、库与应用
  storageDir = mkdtempSync(join(tmpdir(), 'mim-ai-routes-')); // 先建临时目录，供存储与回退共用
  storage = createStorage({ // 创建存储适配器
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir }, // 显式指定本地驱动与落盘目录
    jwtSecret: JWT_SECRET, // 存储签名使用测试密钥
    fallbackDir: storageDir, // 回退目录指向同一临时目录
  }); // 结束 createStorage 参数
  db = createDatabase(':memory:'); // 内存库每次全新创建
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage }); // 注入存储构造应用，env 为空即开发默认
  keyCounter = 0; // 重置幂等键计数
}); // 结束 beforeEach

afterEach(() => { // 后置清理：删除临时目录
  rmSync(storageDir, { recursive: true, force: true }); // 递归并强制删除，避免 Windows 文件句柄残留
}); // 结束 afterEach

describe('鉴权边界', () => { // describe 鉴权边界：所有 ai 端点都要求登录
  it('未登录访问 capabilities / run 一律 401', async () => { // 用例：未登录访问能力查询与任务触发一律 401
    const caps = await request(app).get('/api/v1/ai/capabilities'); // 不带令牌查询能力
    expect(caps.status).toBe(401); // 断言 401
    expect(caps.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言未授权错误码

    const run = await request(app) // 未登录直接触发任务
      .post('/api/v1/ai/jobs/job-nonexistent/run') // 指向不存在的任务 id，用于证明鉴权先于存在性判断
      .set('idempotency-key', nextKey()) // 只带幂等键，故意不带鉴权头
      .send({}); // 空请求体
    expect(run.status).toBe(401); // 断言 401
    expect(run.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言未授权错误码，未泄漏任务是否存在
  }); // 结束鉴权边界用例
}); // 结束鉴权分组

describe('GET /ai/capabilities', () => { // describe 能力查询端点
  it('解锁后返回 200 与 mock 提供方契约形状', async () => { // 用例：解锁后返回 200 与 mock 提供方契约形状
    const session = await login('13900000061'); // 登录
    grantEntitlement(session.userId); // 授予权益，绕过门禁

    const res = await request(app).get('/api/v1/ai/capabilities').set(auth(session)); // 带鉴权查询能力
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.ai.provider).toBe('mock'); // 断言提供方为 mock，说明测试不依赖真实模型
    expect(res.body.ai.provider_configured).toBe(true); // 断言提供方已配置
    expect(res.body.ai.mock_provider).toBe(true); // 断言处于 mock 模式，明确当前形态
    expect(res.body.ai.supported_job_types).toEqual(['text', 'image', 'video', 'tts', 'compose']); // 断言支持的任务类型集合与顺序稳定，防止契约漂移
    expect(res.body.ai.storage).toEqual({ driver: 'local', configured: true }); // 断言 ai 视角下存储已配置为本地驱动
    expect(res.body.storage).toEqual({ driver: 'local', configured: true }); // 断言顶层 storage 与 ai.storage 口径一致
  }); // 结束能力查询用例
}); // 结束能力分组

describe('POST /ai/jobs/:id/run 边界', () => { // describe 任务触发端点的边界
  it('任务不存在 → 404（不泄漏存在性）', async () => { // 用例：任务不存在返回 404，不泄漏存在性
    const session = await login('13900000062'); // 登录
    grantEntitlement(session.userId); // 授予权益

    const res = await request(app) // 触发一个不存在的任务
      .post('/api/v1/ai/jobs/job-missing/run') // 任务 id 明显不存在
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(res.status).toBe(404); // 断言 404
    expect(res.body.code).toBe('NOT_FOUND'); // 断言未找到错误码，与无权限语义区分
  }); // 结束不存在用例

  it('已取消任务（非 queued）→ 409 CONFLICT 并透传当前状态', async () => { // 用例：非 queued 任务返回 409，并透传当前状态
    const session = await login('13900000063'); // 登录
    grantEntitlement(session.userId); // 授予权益

    const created = await request(app) // 建工程作为任务载体
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: 'ai-routes-取消' }); // 标题
    expect(created.status).toBe(201); // 断言 201
    const projectId = created.body.project.id as string; // 取工程 id

    const confirmed = await request(app) // 先确认分镜，使工程进入可创建任务的状态
      .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 分镜端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ shots: [{ index: 1, description: '镜头一' }], confirm: true }); // 单条分镜并显式确认
    expect(confirmed.status).toBe(201); // 断言 201

    const job = await request(app) // 创建一个 image 任务
      .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ job_type: 'image' }); // 任务类型为 image
    expect(job.status).toBe(201); // 断言 201
    const jobId = job.body.job.id as string; // 取任务 id

    const canceled = await request(app) // 先取消任务，制造非 queued 的前置状态
      .post(`/api/v1/comic/jobs/${jobId}/cancel`) // 取消端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(canceled.status).toBe(200); // 断言 200，取消成功

    const run = await request(app) // 对已取消任务触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(409); // 断言 409
    expect(run.body.code).toBe('CONFLICT'); // 断言冲突错误码
    expect(run.body.details.status).toBe('canceled'); // 断言 details 透传当前状态为 canceled，便于前端提示
  }); // 结束非 queued 用例

  it('queued 任务触发成功：返回 run+job 契约，产物落库', async () => { // 用例：queued 任务触发成功，返回 run 与 job 双契约且产物落库
    const session = await login('13900000064'); // 登录
    grantEntitlement(session.userId); // 授予权益

    const created = await request(app) // 建工程
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: 'ai-routes-成功' }); // 标题
    expect(created.status).toBe(201); // 断言 201
    const projectId = created.body.project.id as string; // 取工程 id

    const confirmed = await request(app) // 确认分镜，解锁任务创建
      .post(`/api/v1/comic/projects/${projectId}/storyboard`) // 分镜端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ shots: [{ index: 1, description: '镜头一' }], confirm: true }); // 单条分镜并确认
    expect(confirmed.status).toBe(201); // 断言 201

    const job = await request(app) // 创建 text 任务
      .post(`/api/v1/comic/projects/${projectId}/jobs`) // 任务端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ job_type: 'text', payload: { prompt: '你好' } }); // 任务类型 text 并带提示词
    expect(job.status).toBe(201); // 断言 201
    const jobId = job.body.job.id as string; // 取任务 id

    const run = await request(app) // 触发执行
      .post(`/api/v1/ai/jobs/${jobId}/run`) // run 端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({}); // 空请求体
    expect(run.status).toBe(200); // 断言 200，执行成功
    expect(run.body.run.job_id).toBe(jobId); // 断言 run 关联的是同一任务
    expect(run.body.run.status).toBe('succeeded'); // 断言执行状态为 succeeded
    expect(run.body.run.provider).toBe('mock'); // 断言使用 mock 提供方
    expect(run.body.run.object_key).toBeTruthy(); // 断言产物已生成对象键
    expect(run.body.job.id).toBe(jobId); // 断言响应同时带回更新后的 job
    expect(run.body.job.status).toBe('succeeded'); // 断言 job 状态同步为 succeeded
    expect(run.body.job.result.object_key).toBe(run.body.run.object_key); // 断言 job 结果对象键与 run 一致，两处口径不漂移

    const assets = await request(app) // 查该工程的产物列表
      .get(`/api/v1/media/assets?project_id=${projectId}`) // 按工程 id 过滤
      .set(auth(session)); // 读操作只带鉴权头
    expect(assets.status).toBe(200); // 断言 200
    expect(assets.body.items).toHaveLength(1); // 断言落库一条产物
    expect(assets.body.items[0].object_key).toBe(run.body.run.object_key); // 断言产物对象键与 run 一致，证明产物确实落库
  }); // 结束成功用例
}); // 结束 run 边界分组
