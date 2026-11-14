/**
 * 契约测试：图床公有读分支（img 域）
 *
 * 锁死三条口径：
 * 1. 只有 `public/` 前缀的对象免签名可读，其余对象不带签名一律 401；
 * 2. 缺 `MIM_STORAGE_PUBLIC_BASE_URL` 时直传接口显式失败（STORAGE_CONFIG_INVALID），
 *    不静默退回会过期的签名地址；
 * 3. 非图片 MIME 不允许进入公有前缀。
 */

import { randomUUID } from 'node:crypto'; // 生成幂等键与隔离的本地目录名
import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { tmpdir } from 'node:os'; // 系统临时目录
import { join } from 'node:path'; // 路径拼接
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const ADMIN_PASSWORD = 'testpass123'; // 测试口令
const PUBLIC_BASE = 'https://img.example.test'; // 公有读基线，仅用于断言拼接结果

let app: Express; // 每个用例重建，避免状态串味

/** 组装应用：可选注入公有读基线，其余配置走本地驱动 */
function makeApp(publicBase?: string): Express {
  return createApp({
    db: createDatabase(':memory:'), // 每个用例独立内存库
    jwtSecret: JWT_SECRET, // 签名与本地 HMAC 共用
    env: {
      MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD, // 口令登录入口
      MIM_STORAGE_DRIVER: 'local', // 明确本地驱动，测试不依赖任何云凭证
      MIM_STORAGE_LOCAL_DIR: join(tmpdir(), `mim-public-${randomUUID()}`), // 每次独立目录，避免污染仓库 data/media
      ...(publicBase ? { MIM_STORAGE_PUBLIC_BASE_URL: publicBase } : {}), // 未传时保持缺省，用于验证「缺值即报错」
    },
  });
} // makeApp 结束

/** 口令登录并返回鉴权头 */
async function login(): Promise<Record<string, string>> {
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier: '13800000001', password: ADMIN_PASSWORD });
  expect(res.status).toBe(200); // 登录必须成功
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' };
} // login 结束

/** 写操作鉴权头：幂等中间件强制要求 Idempotency-Key */
function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() }; // 每次独立键
} // writeHeaders 结束

/** 解锁创作工作台权益（media 控制面统一要求该权益） */
async function unlock(auth: Record<string, string>): Promise<void> {
  const res = await request(app).post('/api/v1/entitlements').set(writeHeaders(auth)).send({ module_code: 'comic.workbench' });
  expect([200, 201]).toContain(res.status); // 已解锁时可能返回 200，首次为 201
} // unlock 结束

/** 把服务端返回的绝对 URL 还原成 supertest 可用的路径 + 查询串 */
function pathOf(url: string): string {
  const parsed = new URL(url); // 解析绝对地址
  return `${parsed.pathname}${parsed.search}`; // 只保留路径与查询串
} // pathOf 结束

describe('图床公有读分支', () => { // 用例集合
  beforeEach(() => { // 每个用例重建应用
    app = makeApp(PUBLIC_BASE); // 默认带公有读基线
  }); // beforeEach 结束

  it('缺 MIM_STORAGE_PUBLIC_BASE_URL 时直传显式失败', async () => {
    app = makeApp(); // 不注入公有读基线
    const auth = await login(); // 登录
    await unlock(auth); // 解锁权益
    const res = await request(app)
      .post('/api/v1/media/presign/public-upload')
      .set(writeHeaders(auth))
      .send({ mime: 'image/png', size_bytes: 16 }); // 申请图床直传
    expect(res.status).toBe(500); // 配置类错误按 500 返回
    expect(res.body.code).toBe('STORAGE_CONFIG_INVALID'); // 明确告知是配置缺失，而不是静默降级
  }); // 用例结束

  it('公有前缀对象免签名可读，并带 CDN 缓存头', async () => {
    const auth = await login(); // 登录
    await unlock(auth); // 解锁权益
    const presign = await request(app)
      .post('/api/v1/media/presign/public-upload')
      .set(writeHeaders(auth))
      .send({ mime: 'image/png', size_bytes: 16 }); // 申请直传凭证
    expect(presign.status).toBe(201); // 创建上传意图
    const key = presign.body.object_key as string; // 服务端生成的对象键
    expect(key.startsWith('public/')).toBe(true); // 必须落在公有前缀内
    expect(presign.body.public_url).toBe(`${PUBLIC_BASE}/${key}`); // 直链 = 基线 + 对象键

    const put = await request(app) // 模拟浏览器直传
      .put(pathOf(presign.body.upload.url as string)) // 带上签名参数
      .set('content-type', 'image/png') // 与申请时声明的 MIME 一致
      .send(Buffer.from('89504e470d0a1a0a', 'hex')); // 最小 PNG 头即可，存储层不校验图片内容
    expect(put.status).toBe(204); // 上传成功无响应体

    const read = await request(app).get(`/api/v1/media/objects/${key}`); // 不带任何签名参数
    expect(read.status).toBe(200); // 公有前缀免签名放行
    expect(read.headers['cache-control']).toContain('public'); // 允许 CDN 缓存
  }); // 用例结束

  it('私有对象不带签名读取一律 401', async () => {
    const auth = await login(); // 登录
    await unlock(auth); // 解锁权益
    const presign = await request(app)
      .post('/api/v1/media/presign/upload')
      .set(writeHeaders(auth))
      .send({ asset_type: 'image', mime: 'image/png' }); // 走私有直传
    expect(presign.status).toBe(201); // 创建上传意图
    const key = presign.body.object_key as string; // 私有对象键（首段为 user_id，不含 public/）
    expect(key.startsWith('public/')).toBe(false); // 确认不在公有前缀

    const put = await request(app) // 正常签名上传
      .put(pathOf(presign.body.upload.url as string))
      .set('content-type', 'image/png')
      .send(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(put.status).toBe(204); // 上传成功

    const read = await request(app).get(`/api/v1/media/objects/${key}`); // 企图裸读私有对象
    expect(read.status).toBe(401); // 必须拒绝，不能因为公有分支存在而放行
    expect(read.body.code).toBe('AUTH_UNAUTHORIZED'); // 错误码与既有签名失败口径一致
  }); // 用例结束

  it('非图片 MIME 不允许进入公有前缀', async () => {
    const auth = await login(); // 登录
    await unlock(auth); // 解锁权益
    const res = await request(app)
      .post('/api/v1/media/presign/public-upload')
      .set(writeHeaders(auth))
      .send({ mime: 'application/pdf', size_bytes: 16 }); // 非图片
    expect(res.status).toBe(400); // 项目口径：VALIDATION_FAILED 统一映射 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 统一校验错误码
  }); // 用例结束

  it('分发包按 MIME 落正确后缀，下载走签名链接且保留 Content-Type', async () => {
    const auth = await login(); // 登录
    await unlock(auth); // 解锁权益
    const presign = await request(app)
      .post('/api/v1/media/presign/upload')
      .set(writeHeaders(auth))
      .send({ asset_type: 'final', mime: 'application/zip', size_bytes: 32 }); // 下载分发视图的上传口径
    expect(presign.status).toBe(201); // 创建上传意图
    const key = presign.body.object_key as string; // 服务端生成的对象键
    expect(key.endsWith('.zip')).toBe(true); // MIME_EXT 必须覆盖压缩包，否则会退化成 .bin

    const put = await request(app) // 直传字节
      .put(pathOf(presign.body.upload.url as string))
      .set('content-type', 'application/zip')
      .send(Buffer.from('504b0304', 'hex')); // 最小 ZIP 头
    expect(put.status).toBe(204); // 上传成功

    const signed = await request(app)
      .get(`/api/v1/media/presign/download?object_key=${encodeURIComponent(key)}`)
      .set(auth); // 取短时下载地址
    expect(signed.status).toBe(200); // 归本人所有，允许签发
    const read = await request(app).get(pathOf(signed.body.download.url as string)); // 凭签名读取
    expect(read.status).toBe(200); // 签名有效
    expect(String(read.headers['content-type'])).toContain('application/zip'); // 下载端拿到正确类型
  }); // 用例结束
}); // describe 结束
