/** 契约测试：成片导出（POST /comic/films/:id/export）—— 原片直下 / 转码降级 / 预签名下载 / 幂等 / 归属隔离 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 引入用例编排 API；每例重建内存库与临时存储目录
import request from 'supertest'; // 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 只引入类型，标注应用实例
import { mkdtempSync, rmSync } from 'node:fs'; // 建/删每例独立的临时存储目录
import { tmpdir } from 'node:os'; // 取系统临时目录作为存储根
import { join } from 'node:path'; // 路径拼接
import { createApp } from '../src/app.js'; // 唯一应用装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { createStorage } from '../src/storage.js'; // 本地存储适配器工厂
import type { StorageAdapter } from '../src/storage.js'; // 存储适配器类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，JWT 与预签名共用
const OBJECT_KEY = 'films/export-demo.mp4'; // 原片对象键，与 compose 产物命名一致

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 内存库句柄，用例内可直接写库授权
let storage: StorageAdapter; // 本地存储适配器，用于写入可被下载的原片字节
let storageDir: string; // 每例独立的临时落盘目录
let keyCounter = 0; // 幂等键自增计数器

function nextKey(): string { // 生成唯一幂等键
  keyCounter += 1; // 先自增
  return `film-export-key-${keyCounter}`; // 前缀便于与其它测试文件区分
} // 结束 nextKey

interface Session { // 登录会话契约
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键，用于授权与归属校验
} // 结束 Session

async function login(identifier: string): Promise<Session> { // 通过验证码通道换令牌
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier }); // 申请验证码
  expect(codeRes.status).toBe(201); // 断言验证码已创建
  const loginRes = await request(app).post('/api/v1/auth/login') // 换取会话
    .send({ region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } }); // device 为登录契约必填
  expect(loginRes.status).toBe(200); // 断言登录成功
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回令牌与用户 id
} // 结束 login

function auth(session: Session, key?: string) { // 构造鉴权头，可选幂等键
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` }; // 固定 Bearer
  if (key) headers['idempotency-key'] = key; // 写操作必传幂等键
  return headers; // 返回头对象
} // 结束 auth

function grantEntitlement(userId: string): void { // 直接写库模拟运营开通 comic.workbench
  const moduleRow = db.prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`) // 定位 cn 区模块种子
    .get() as { id: string } | undefined; // 取首行
  if (!moduleRow) throw new Error('comic.workbench module seed missing'); // 种子缺失直接抛错，避免用例静默通过
  const now = new Date().toISOString(); // 统一时间戳
  db.prepare( // 插入有效权益
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`,
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now); // 稳定权益 id，避免重复授权冲突
} // 结束 grantEntitlement

/** 走真实链路造一个带产物的成片：建工程 → 确认分镜 → compose 完成 → 创建成片 */
async function setupFilm(session: Session, phone: string, withObjectKey = true): Promise<string> { // 返回成片 id
  const created = await request(app).post('/api/v1/comic/projects') // 建工程
    .set(auth(session, nextKey())).send({ title: `导出工程-${phone}` }); // 标题带号码便于辨认
  expect(created.status).toBe(201); // 断言建工程成功
  const projectId = created.body.project.id as string; // 取工程 id
  const confirmed = await request(app).post(`/api/v1/comic/projects/${projectId}/storyboard`) // 提交并确认分镜
    .set(auth(session, nextKey())).send({ shots: [{ index: 1, description: '开场镜头' }], confirm: true }); // 单镜确认
  expect(confirmed.status).toBe(201); // 断言分镜已确认
  const job = await request(app).post(`/api/v1/comic/projects/${projectId}/jobs`) // 派发 compose 任务
    .set(auth(session, nextKey())).send({ job_type: 'compose' }); // compose 成功后工程进入 rendered
  expect(job.status).toBe(201); // 断言任务已排队
  const jobId = job.body.job.id as string; // 取任务 id
  await request(app).post(`/api/v1/comic/jobs/${jobId}/start`).set(auth(session, nextKey())); // 推进到 running
  const done = await request(app).post(`/api/v1/comic/jobs/${jobId}/complete`) // 完成任务使工程 rendered
    .set(auth(session, nextKey())).send({ result: { object_key: OBJECT_KEY } }); // 回传成片对象键
  expect(done.status).toBe(200); // 断言任务完成
  const payload: { title: string; object_key?: string } = { title: `导出用成片-${phone}` }; // 成片入参
  if (withObjectKey) payload.object_key = OBJECT_KEY; // 无产物用例不传对象键
  const film = await request(app).post(`/api/v1/comic/projects/${projectId}/films`) // 创建成片与首版本
    .set(auth(session, nextKey())).send(payload); // 带上可选对象键
  expect(film.status).toBe(201); // 断言成片创建成功
  return film.body.film.id as string; // 返回成片 id
} // 结束 setupFilm

function pathOf(url: string): string { // 把预签名地址转成 supertest 可直接请求的路径
  if (!url.startsWith('http')) return url; // 本地驱动返回同源相对路径，原样使用
  const parsed = new URL(url); // 绝对地址（S3 / 配置了 MIM_PUBLIC_BASE_URL）用 WHATWG URL 解析
  return `${parsed.pathname}${parsed.search}`; // 保留签名查询串
} // 结束 pathOf

beforeEach(async () => { // 每例前置：重建库、临时目录、存储与应用
  keyCounter = 0; // 重置幂等键
  db = createDatabase(':memory:'); // 全新内存库
  storageDir = mkdtempSync(join(tmpdir(), 'mim-film-export-')); // 独立临时目录
  storage = createStorage({ // 本地驱动，落盘到临时目录
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir }, // 显式指定驱动与目录
    jwtSecret: JWT_SECRET, // 与 JWT 共用测试密钥
    fallbackDir: storageDir, // 兜底目录一致，保证签名可验
  }); // 结束 createStorage
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage }); // env 为空即不配置 ffmpeg，转码分支返回 403
  await storage.putObject(OBJECT_KEY, Buffer.from('mim-export-fixture'), 'video/mp4'); // 写入可被预签名 URL 下载的原片字节
}); // 结束 beforeEach

afterEach(() => { // 后置清理：删除临时目录
  rmSync(storageDir, { recursive: true, force: true }); // force 容忍 Windows 文件句柄延迟释放
}); // 结束 afterEach

describe('成片导出契约', () => { // 成片导出的全部对外行为
  it('未解锁 comic.workbench 时导出返回 403（权益门禁先于业务）', async () => { // 门禁用例
    const session = await login('13900001001'); // 登录未授权用户
    const res = await request(app).post('/api/v1/comic/films/any-film/export') // 直接打导出端点
      .set(auth(session, nextKey())).send({}); // 默认参数
    expect(res.status).toBe(403); // 断言被门禁拦下
    expect(res.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言统一错误码
  }); // 结束门禁用例

  it('成片无产物时导出返回 404，并提示先合成', async () => { // 无产物用例
    const session = await login('13900001002'); // 登录创作者
    grantEntitlement(session.userId); // 授权
    const filmId = await setupFilm(session, '13900001002', false); // 创建不带 object_key 的成片
    const res = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 尝试导出
      .set(auth(session, nextKey())).send({}); // 默认 mp4/1080p
    expect(res.status).toBe(404); // 断言无可导出产物
    expect(res.body.code).toBe('NOT_FOUND'); // 断言统一错误码
  }); // 结束无产物用例

  it('默认 mp4/1080p 导出返回原片直下的预签名地址', async () => { // 主成功路径
    const session = await login('13900001003'); // 登录创作者
    grantEntitlement(session.userId); // 授权
    const filmId = await setupFilm(session, '13900001003'); // 带产物的成片
    const res = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 导出
      .set(auth(session, nextKey())).send({}); // 空体走服务端默认
    expect(res.status).toBe(200); // 断言成功
    expect(res.body.film_id).toBe(filmId); // 回显成片 id
    expect(res.body.version_no).toBe(1); // 基于首版本
    expect(res.body.format).toBe('mp4'); // 默认格式
    expect(res.body.resolution).toBe('1080p'); // 默认分辨率
    expect(res.body.transcoded).toBe(false); // 原片直下，无需转码
    expect(res.body.method).toBe('GET'); // 下载方法
    expect(res.body.download_url).toContain(OBJECT_KEY); // 地址指向原片对象键
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now()); // 凭证未过期
  }); // 结束主成功路径

  it('预签名地址可真实下载原片字节（media 对象端点验签通过）', async () => { // 端到端下载闭环
    const session = await login('13900001004'); // 登录创作者
    grantEntitlement(session.userId); // 授权
    const filmId = await setupFilm(session, '13900001004'); // 带产物的成片
    const exported = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 签发下载地址
      .set(auth(session, nextKey())).send({ format: 'mp4', resolution: '1080p' }); // 显式指定原片参数
    expect(exported.status).toBe(200); // 断言签发成功
    const downloaded = await request(app).get(pathOf(exported.body.download_url as string)); // 直接 GET 预签名地址，无需 Bearer
    expect(downloaded.status).toBe(200); // 断言验签通过且对象存在
    expect(Buffer.from(downloaded.body).toString('utf-8')).toBe('mim-export-fixture'); // 二进制响应走 body，断言拿到的正是写入的原片字节
  }); // 结束下载闭环

  it('未配置 ffmpeg 时 mov/720p 返回 403 并回显被拒绝的选项', async () => { // 转码降级路径
    const session = await login('13900001005'); // 登录创作者
    grantEntitlement(session.userId); // 授权
    const filmId = await setupFilm(session, '13900001005'); // 带产物的成片
    const res = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 请求转码
      .set(auth(session, nextKey())).send({ format: 'mov', resolution: '720p' }); // 与原片不同的格式与分辨率
    expect(res.status).toBe(403); // 断言能力不可用
    expect(res.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言统一错误码
    expect(res.body.details.requested).toEqual({ format: 'mov', resolution: '720p' }); // 前端据此区分「转码不可用」与「模块未解锁」
  }); // 结束转码降级路径

  it('非法格式返回 400 VALIDATION_FAILED', async () => { // 入参校验
    const session = await login('13900001006'); // 登录创作者
    grantEntitlement(session.userId); // 授权
    const filmId = await setupFilm(session, '13900001006'); // 带产物的成片
    const res = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 导出
      .set(auth(session, nextKey())).send({ format: 'avi' }); // 不在枚举内
    expect(res.status).toBe(400); // 断言参数被拒
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言统一错误码
  }); // 结束入参校验

  it('同一幂等键同体重放返回首次结果，不重复签发凭证', async () => { // 幂等契约
    const session = await login('13900001007'); // 登录创作者
    grantEntitlement(session.userId); // 授权
    const filmId = await setupFilm(session, '13900001007'); // 带产物的成片
    const key = nextKey(); // 固定幂等键
    const first = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 首次请求
      .set(auth(session, key)).send({ format: 'mp4', resolution: '1080p' }); // 原片参数
    const replay = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 重放
      .set(auth(session, key)).send({ format: 'mp4', resolution: '1080p' }); // 同键同体
    expect(first.status).toBe(200); // 断言首次成功
    expect(replay.status).toBe(200); // 断言重放同样成功
    expect(replay.body.download_url).toBe(first.body.download_url); // 断言返回完全相同的首次凭证
  }); // 结束幂等契约

  it('导出始终基于最新版本；追加 v2 后指向新对象键', async () => { // 版本选择
    const session = await login('13900001008'); // 登录创作者
    grantEntitlement(session.userId); // 授权
    const filmId = await setupFilm(session, '13900001008'); // 带产物的成片
    const added = await request(app).post(`/api/v1/comic/films/${filmId}/versions`) // 追加新版本
      .set(auth(session, nextKey())).send({ object_key: 'films/export-demo-v2.mp4' }); // v2 对象键
    expect(added.status).toBe(201); // 断言版本已登记
    const res = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 再次导出
      .set(auth(session, nextKey())).send({}); // 默认参数
    expect(res.status).toBe(200); // 断言成功
    expect(res.body.version_no).toBe(2); // 断言取最新版本
    expect(res.body.download_url).toContain('films/export-demo-v2.mp4'); // 断言指向 v2 产物
  }); // 结束版本选择

  it('他人成片不可导出，返回 404 不泄露资源存在性', async () => { // 归属隔离
    const owner = await login('13900001009'); // 成片所有者
    const other = await login('13900001010'); // 另一用户
    grantEntitlement(owner.userId); // 双方都授权，确保分歧来自归属而非门禁
    grantEntitlement(other.userId); // 同上
    const filmId = await setupFilm(owner, '13900001009'); // 所有者造带产物成片
    const res = await request(app).post(`/api/v1/comic/films/${filmId}/export`) // 他人尝试导出
      .set(auth(other, nextKey())).send({}); // 默认参数
    expect(res.status).toBe(404); // 断言不可见
    expect(res.body.code).toBe('NOT_FOUND'); // 断言统一错误码
  }); // 结束归属隔离
}); // 结束成片导出契约分组
