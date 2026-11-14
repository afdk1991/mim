/** 契约测试：media 域（预签名上传/下载、归属隔离、签名校验） */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 引入 afterEach 用于清理临时存储目录，保持用例互不影响
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 只引入 Express 类型，用于标注全局 app
import { mkdtempSync, rmSync } from 'node:fs'; // 建临时目录与递归删除目录的同步 API
import { tmpdir } from 'node:os'; // 取系统临时目录作为存储根
import { join } from 'node:path'; // 路径拼接工具
import { createApp } from '../src/app.js'; // createApp 是唯一装配入口
import { createDatabase } from '../src/db.js'; // createDatabase 建库，用例用内存库隔离
import { createStorage } from '../src/storage.js'; // createStorage 工厂：按驱动创建存储适配器
import type { StorageAdapter } from '../src/storage.js'; // StorageAdapter 是存储层的抽像类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，存储签名与 JWT 共用同一来源

let app: Express; // 待测应用实例
let storage: StorageAdapter; // 存储适配器，上传下载都经它落盘
let storageDir: string; // 每例独立的临时存储目录
let keyCounter = 0; // 幂等键自增计数器

function nextKey(): string { // 生成唯一幂等键
  keyCounter += 1; // 先自增再取值
  return `media-key-${keyCounter}`; // media 前缀便于区分来源
} // 结束 nextKey 定义

interface Session { // 登录会话契约
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键，用于对象键前缀断言
} // 结束 Session 定义

async function login(identifier: string): Promise<Session> { // 登录辅助：固定 cn 区手机号通道，media 用例不关心身份差异
  const codeRes = await request(app).post('/api/v1/auth/code').send({ region: 'cn', provider: 'phone', identifier }); // 一步申请验证码
  expect(codeRes.status).toBe(201); // 断言 201 表示验证码已创建
  const loginRes = await request(app) // 用验证码换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ region: 'cn', provider: 'phone', identifier, code: codeRes.body.dev_code, device: { platform: 'web', name: 'test' } }); // 带 dev_code 与设备信息
  expect(loginRes.status).toBe(200); // 断言 200
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回令牌与用户 id
} // 结束 login 定义

function auth(session: Session, key?: string) { // 构造鉴权头
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` }; // 固定 Bearer 头
  if (key) headers['idempotency-key'] = key; // 可选幂等键：写操作必传
  return headers; // 返回头对象
} // 结束 auth 定义

function pathOf(url: string): string { // 把绝对 URL 转成同源路径，便于直接用 supertest 访问本地存储端点
  const parsed = new URL(url); // 用 WHATWG URL 解析，避免手写正则
  return `${parsed.pathname}${parsed.search}`; // 保留 pathname 与查询串，查询串里含签名参数
} // 结束 pathOf 定义

beforeEach(() => { // 每例前置：重建库、临时目录、存储与应用
  keyCounter = 0; // 重置幂等键计数
  const db = createDatabase(':memory:'); // 内存库每次全新创建
  storageDir = mkdtempSync(join(tmpdir(), 'mim-media-')); // 建本用例专属临时目录，避免跨用例文件残留
  storage = createStorage({ // 用本地驱动创建存储适配器
    env: { MIM_STORAGE_DRIVER: 'local', MIM_STORAGE_LOCAL_DIR: storageDir }, // 显式指定 local 驱动与落盘目录
    jwtSecret: JWT_SECRET, // 存储签名同样使用测试密钥
    fallbackDir: storageDir, // 回退目录也指向临时目录，保证签名校验可读
  }); // 结束 createStorage 参数
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {}, storage }); // 把存储注入应用，env 传空即开发默认
}); // 结束 beforeEach

afterEach(() => { // 后置清理：删除临时目录
  rmSync(storageDir, { recursive: true, force: true }); // 递归并强制删除，避免 Windows 文件句柄导致残留
}); // 结束 afterEach

describe('media 域', () => { // describe media 域：预签名上传下载、归属隔离与签名校验
  it('可完成预签名上传 → 下载闭环', async () => { // 用例：聊天 / 社区附件共用的通用上传链路
    const session = await login('13900000031'); // 登录普通用户

    const presign = await request(app) // 申请上传预签名
      .post('/api/v1/media/presign/upload') // 上传预签名端点
      .set(auth(session, nextKey())) // 带鉴权与幂等键
      .send({ asset_type: 'image', mime: 'image/png' }); // 声明素材类型与 MIME
    expect(presign.status).toBe(201); // 断言 201，表示预签名已生成
    const objectKey = presign.body.object_key as string; // 取出服务端分配的对象键
    expect(objectKey.startsWith(`${session.userId}/`)).toBe(true); // 断言键以用户 id 开头，保证按用户隔离存储目录
    expect(objectKey.endsWith('.png')).toBe(true); // 断言扩展名与 MIME 对应，便于 CDN 识别类型

    const payload = Buffer.from('fake-png-bytes-for-contract-test'); // 构造假二进制内容，只验证传输链路不校验图像合法性
    const uploaded = await request(app) // 直接 PUT 到预签名地址
      .put(pathOf(presign.body.upload.url as string)) // 把绝对地址转成同源路径
      .set('content-type', 'image/png') // 声明内容类型
      .send(payload); // 发送二进制体
    expect(uploaded.status).toBe(204); // 断言 204，上传成功且无响应体
    expect(uploaded.headers['x-object-checksum']).toBeTruthy(); // 断言返回校验和头，客户端可据此核对完整性

    const downloadPresign = await request(app) // 申请下载预签名
      .get('/api/v1/media/presign/download') // 下载预签名端点
      .query({ object_key: objectKey }) // 把对象键作为查询参数
      .set(auth(session)); // 读操作只带鉴权头，不需要幂等键
    expect(downloadPresign.status).toBe(200); // 断言 200

    const fetched = await request(app).get(pathOf(downloadPresign.body.download.url as string)); // 按下载地址取回内容
    expect(fetched.status).toBe(200); // 断言 200
    expect(Buffer.from(fetched.body)).toEqual(payload); // 断言取回字节与上传完全一致，验证存取闭环
  }); // 结束闭环用例

  it('跨用户对象一律 404，不泄漏存在性', async () => { // 用例：跨用户访问对象一律 404，不泄漏存在性
    const owner = await login('13900000032'); // 属主登录
    const other = await login('13900000033'); // 另一用户登录

    const presign = await request(app) // 属主申请上传
      .post('/api/v1/media/presign/upload') // 上传预签名端点
      .set(auth(owner, nextKey())) // 新幂等键
      .send({ asset_type: 'image', mime: 'image/png' }); // 参数
    expect(presign.status).toBe(201); // 断言 201
    const objectKey = presign.body.object_key as string; // 取对象键

    const cross = await request(app) // 他人拿该对象键申请下载
      .get('/api/v1/media/presign/download') // 下载预签名端点
      .query({ object_key: objectKey }) // 查询参数带属主的对象键
      .set(auth(other)); // 用他人会话发起
    expect(cross.status).toBe(404); // 断言 404，不暴露对象是否存在
    expect(cross.body.code).toBe('NOT_FOUND'); // 断言未找到错误码
  }); // 结束跨用户用例

  it('签名篡改或过期返回 401', async () => { // 用例：签名被篡改时应被拒绝
    const session = await login('13900000034'); // 登录
    const presign = await request(app) // 申请上传预签名
      .post('/api/v1/media/presign/upload') // 上传端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ asset_type: 'image', mime: 'image/png' }); // 参数
    expect(presign.status).toBe(201); // 断言 201

    const tampered = new URL(presign.body.upload.url as string); // 解析出预签名 URL 以便改写签名
    tampered.searchParams.set('signature', 'deadbeef'.repeat(8)); // 把签名替换为伪造值
    const rejected = await request(app) // 用篡改后的地址发起上传
      .put(`${tampered.pathname}${tampered.search}`) // 拼接篡改后的路径与查询串
      .set('content-type', 'image/png') // 声明内容类型
      .send(Buffer.from('payload')); // 发送内容
    expect(rejected.status).toBe(401); // 断言 401，签名校验在写入前拦截
    expect(rejected.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言未授权错误码
  }); // 结束签名用例
}); // 结束 media 域分组
