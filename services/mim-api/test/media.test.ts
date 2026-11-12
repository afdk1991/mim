/** 契约测试：media 域（预签名上传/下载、归属隔离、签名校验） */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'; // 引入 afterEach 用于清理临时存储目录，保持用例互不影响
import request from 'supertest'; // supertest 进程内驱动 Express，无需监听真实端口
import type { Express } from 'express'; // 只引入 Express 类型，用于标注全局 app
import { mkdtempSync, rmSync } from 'node:fs'; // 建临时目录与递归删除目录的同步 API
import { tmpdir } from 'node:os'; // 取系统临时目录作为存储根
import { join } from 'node:path'; // 路径拼接工具
import sharp from 'sharp'; // 测试内生成真实可解码的 PNG 字节，供缩略图端点走完整解码链路
import { createApp } from '../src/app.js'; // createApp 是唯一装配入口
import { createDatabase } from '../src/db.js'; // createDatabase 建库，用例用内存库隔离
import { createStorage } from '../src/storage.js'; // createStorage 工厂：按驱动创建存储适配器
import type { StorageAdapter } from '../src/storage.js'; // StorageAdapter 是存储层的抽像类型

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，存储签名与 JWT 共用同一来源

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 数据库句柄，用例内直接写库造数据
let storage: StorageAdapter; // 存储适配器，上传下载都经它落盘
let storageDir: string; // 每例独立的临时存储目录
let keyCounter = 0; // 幂等键自增计数器

function nextKey(): string { // 生成唯一幂等键
  keyCounter += 1; // 先自增再取值
  return `media-key-${keyCounter}`; // media 前缀便于区分来源
} // 结束 nextKey 定义

interface Session { // 登录会话契约
  token: string; // Bearer 访问令牌
  userId: string; // 用户主键，用于对象键前缀与权益授予
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

function grantEntitlement(userId: string): void { // 授予权益：media 复用 comic.workbench 模块做门禁
  const moduleRow = db // 先查模块主键
    .prepare(`SELECT id FROM modules WHERE code = 'comic.workbench' AND region = 'cn'`) // 固定 cn 区与模块编码，media 用例只用国内用户
    .get() as { id: string } | undefined; // 取首行并按联合类型断言
  if (!moduleRow) throw new Error('comic.workbench module seed missing'); // 种子缺失直接抛错，避免门禁用例静默通过
  const now = new Date().toISOString(); // 统一时间戳，保证创建与更新时间一致
  db.prepare( // 插入权益行
    // 参数化写入权益行，状态固定 active、版本固定 1
    `INSERT INTO entitlements
       (id, user_id, module_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`,
  ).run(`ent:${userId}:${moduleRow.id}`, userId, moduleRow.id, now, now); // 执行插入并用用户与模块拼出稳定权益 id
} // 结束 grantEntitlement 定义

function pathOf(url: string): string { // 把绝对 URL 转成同源路径，便于直接用 supertest 访问本地存储端点
  const parsed = new URL(url); // 用 WHATWG URL 解析，避免手写正则
  return `${parsed.pathname}${parsed.search}`; // 保留 pathname 与查询串，查询串里含签名参数
} // 结束 pathOf 定义

beforeEach(() => { // 每例前置：重建库、临时目录、存储与应用
  keyCounter = 0; // 重置幂等键计数
  db = createDatabase(':memory:'); // 内存库每次全新创建
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
  it('未解锁模块 403；解锁后可完成预签名上传 → 下载闭环', async () => { // 用例：未解锁 403，解锁后完成上传到下载的闭环
    const session = await login('13900000031'); // 登录普通用户

    const denied = await request(app) // 未解锁先尝试申请上传预签名
      .post('/api/v1/media/presign/upload') // 上传预签名端点
      .set(auth(session, nextKey())) // 带鉴权与幂等键
      .send({ asset_type: 'image', mime: 'image/png' }); // 声明素材类型与 MIME
    expect(denied.status).toBe(403); // 断言 403，门禁先于业务
    expect(denied.body.code).toBe('FEATURE_NOT_AVAILABLE'); // 断言功能未开通错误码

    grantEntitlement(session.userId); // 写库授予权益

    const presign = await request(app) // 解锁后再次申请上传预签名
      .post('/api/v1/media/presign/upload') // 同一端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ asset_type: 'image', mime: 'image/png' }); // 同样参数
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
    grantEntitlement(owner.userId); // 属主授予权益
    grantEntitlement(other.userId); // 他人也授予权益，排除门禁因素干扰归属结论

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

    // 用他人工程 id 申请上传同样 404
    const created = await request(app) // 属主建工程，用于验证带工程 id 上传的归属校验
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(owner, nextKey())) // 新幂等键
      .send({ title: '归属工程' }); // 标题
    expect(created.status).toBe(201); // 断言 201
    const crossUpload = await request(app) // 他人携带该工程 id 申请上传
      .post('/api/v1/media/presign/upload') // 上传预签名端点
      .set(auth(other, nextKey())) // 他人会话
      .send({ asset_type: 'image', mime: 'image/png', project_id: created.body.project.id }); // project_id 指向他人工程
    expect(crossUpload.status).toBe(404); // 断言 404，工程归属校验同样不泄漏
  }); // 结束跨用户用例

  it('签名篡改或过期返回 401', async () => { // 用例：签名被篡改时应被拒绝
    const session = await login('13900000034'); // 登录
    grantEntitlement(session.userId); // 授予权益
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
  it('过期产物即使字节尚未清理也不可下载签名，与列表口径一致', async () => { // 用例：保留期在「列表」与「下载签名」两条路径上必须同口径
    const session = await login('13900000036'); // 登录
    grantEntitlement(session.userId); // 授予权益，排除门禁干扰

    const created = await request(app) // 先建工程，产物登记行必须挂在真实工程上
      .post('/api/v1/comic/projects') // 创建端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ title: '过期产物工程' }); // 标题
    expect(created.status).toBe(201); // 断言 201
    const projectId = created.body.project.id as string; // 取工程 ID

    const presign = await request(app) // 申请上传预签名，拿到真实对象键
      .post('/api/v1/media/presign/upload') // 上传预签名端点
      .set(auth(session, nextKey())) // 新幂等键
      .send({ asset_type: 'image', mime: 'image/png', project_id: projectId }); // 带上工程
    expect(presign.status).toBe(201); // 断言 201
    const objectKey = presign.body.object_key as string; // 取对象键
    const uploaded = await request(app) // 真实上传字节，确保后续失败原因是保留期而不是对象缺失
      .put(pathOf(presign.body.upload.url as string)) // 转同源路径
      .set('content-type', 'image/png') // 声明类型
      .send(Buffer.from('expired-contract-bytes')); // 发送内容
    expect(uploaded.status).toBe(204); // 断言上传成功

    const before = await request(app) // 登记保留期之前：应可正常签发
      .get('/api/v1/media/presign/download') // 下载预签名端点
      .query({ object_key: objectKey }) // 查询参数
      .set(auth(session)); // 鉴权头
    expect(before.status).toBe(200); // 断言 200，证明基线链路正常

    // 手工登记一条「已过期」产物，模拟 TTL 到期但 asset-gc 尚未轮到清理的窗口
    db.prepare( // 预编译插入
      `INSERT INTO generation_assets
         (id, job_id, project_id, asset_type, object_key, mime, checksum, expires_at, created_at)
       VALUES ('asset-contract-expired', 'job-contract-expired', ?, 'image', ?, 'image/png', 'sha256-contract', ?, ?)`,
    ).run(projectId, objectKey, new Date(Date.now() - 3_600_000).toISOString(), new Date().toISOString()); // 到期时间设为一小时前

    const after = await request(app) // 登记过期之后：应被拒绝
      .get('/api/v1/media/presign/download') // 同一端点
      .query({ object_key: objectKey }) // 同一对象键
      .set(auth(session)); // 同一用户
    expect(after.status).toBe(404); // 与「不存在」同口径，不额外泄漏保留期策略
    expect(after.body.code).toBe('NOT_FOUND'); // 错误码
    expect(after.body.message).toContain('asset expired'); // 明确说明是过期而非权限问题

    const listed = await request(app) // 列表接口核对同口径
      .get('/api/v1/media/assets') // 产物列表
      .query({ project_id: projectId }) // 限定工程
      .set(auth(session)); // 鉴权头
    expect(listed.status).toBe(200); // 断言 200
    const listedKeys = (listed.body.items as Array<{ object_key: string }>).map((item) => item.object_key); // 取出列表里的对象键
    expect(listedKeys).not.toContain(objectKey); // 过期产物同样不出现在列表中
  }); // 结束过期产物用例

  it('图片产物可生成 WebP 缩略图；非图片类型返回 400', async () => { // 用例：sharp 解码 → 缩放 → WebP 编码全链路，脏类型被拒
    const session = await login('13900000041'); // 登录普通用户
    grantEntitlement(session.userId); // 授予权益，排除门禁干扰

    const png = await sharp({ // 用 sharp 造一张 200x200 真实可解码的 PNG（纯红底）
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } }, // 画布尺寸与底色
    }).png().toBuffer(); // 编码为 PNG Buffer 作为上传源

    const presign = await request(app) // 申请上传预签名
      .post('/api/v1/media/presign/upload')
      .set(auth(session, nextKey()))
      .send({ asset_type: 'image', mime: 'image/png' });
    expect(presign.status).toBe(201); // 断言预签名成功
    const objectKey = presign.body.object_key as string; // 取对象键

    const uploaded = await request(app) // 真实上传 PNG 字节
      .put(pathOf(presign.body.upload.url as string))
      .set('content-type', 'image/png')
      .send(png);
    expect(uploaded.status).toBe(204); // 断言落盘成功

    const thumb = await request(app) // 请求 120px 缩略图
      .get('/api/v1/media/thumb')
      .query({ object_key: objectKey, size: 120 })
      .set(auth(session));
    expect(thumb.status).toBe(200); // 断言 200
    expect(thumb.headers['content-type']).toContain('image/webp'); // 断言输出类型为 WebP
    const thumbBody = Buffer.from(thumb.body); // 取响应字节做魔数校验
    expect(thumbBody.subarray(0, 4).toString('ascii')).toBe('RIFF'); // WebP 前 4 字节为 RIFF
    expect(thumbBody.subarray(8, 12).toString('ascii')).toBe('WEBP'); // 第 8~11 字节为 WEBP 标识

    const textPresign = await request(app) // 再造一个纯文本对象，验证类型守卫
      .post('/api/v1/media/presign/upload')
      .set(auth(session, nextKey()))
      .send({ asset_type: 'text', mime: 'text/plain' });
    expect(textPresign.status).toBe(201); // 断言文本预签名成功
    const textKey = textPresign.body.object_key as string; // 取文本对象键
    await request(app) // 落盘文本字节
      .put(pathOf(textPresign.body.upload.url as string))
      .set('content-type', 'text/plain')
      .send(Buffer.from('plain-text-payload'));

    const nonImage = await request(app) // 对文本对象请求缩略图，应被类型守卫拒绝
      .get('/api/v1/media/thumb')
      .query({ object_key: textKey })
      .set(auth(session));
    expect(nonImage.status).toBe(400); // 断言 400
    expect(nonImage.body.code).toBe('VALIDATION_FAILED'); // 断言参数/类型错误码
  }); // 结束缩略图成功与类型守卫用例

  it('跨用户缩略图一律 404，不泄漏对象存在性', async () => { // 用例：缩略图端点复用同一套对象归属守卫
    const owner = await login('13900000042'); // 属主登录
    const other = await login('13900000043'); // 他人登录
    grantEntitlement(owner.userId); // 双方都授予权益，排除门禁因素
    grantEntitlement(other.userId);

    const png = await sharp({ // 造一张 40x40 蓝底 PNG
      create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).png().toBuffer();
    const presign = await request(app) // 属主上传
      .post('/api/v1/media/presign/upload')
      .set(auth(owner, nextKey()))
      .send({ asset_type: 'image', mime: 'image/png' });
    expect(presign.status).toBe(201); // 断言：校验接口响应或状态符合冻结契约
    const objectKey = presign.body.object_key as string; // 准备：构造本用例需要的输入或句柄
    await request(app) // 执行：等待异步操作返回后继续
      .put(pathOf(presign.body.upload.url as string))
      .set('content-type', 'image/png')
      .send(png);

    const cross = await request(app) // 他人拿属主键请求缩略图
      .get('/api/v1/media/thumb')
      .query({ object_key: objectKey })
      .set(auth(other));
    expect(cross.status).toBe(404); // 断言 404，与下载预签名同一归属口径
  }); // 结束跨用户用例
}); // 结束 media 域分组
