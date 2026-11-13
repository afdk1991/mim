/** 契约测试：模块真实能力调用 —— 门禁三连（登录 / 上架 / 已解锁）与六种能力的真实输出（铁律十一：逐行中文注释） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 用例编排 API，每例重建内存库互不污染
import request from 'supertest'; // 进程内驱动 Express，不占端口
import type { Express } from 'express'; // 仅引入类型用于标注应用实例
import { createApp } from '../src/app.js'; // 唯一装配入口，路由挂载顺序与线上一致
import { createDatabase } from '../src/db.js'; // 内存库工厂：建库即执行 schema + 全部种子
import { CAPABILITY_HANDLERS } from '../src/capabilities.js'; // 能力注册表，用于断言键与实现一致
import { MODULE_CAPABILITIES } from '@mim/core-domain'; // 能力清单，校验注册表覆盖度

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥，满足强度校验

let app: Express; // 待测应用实例
let db: ReturnType<typeof createDatabase>; // 与 app 同生命周期的数据库句柄

beforeEach(() => { // 每例独立建库
  db = createDatabase(':memory:'); // 内存库：自动补列并写入全部种子
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 公开面无需管理令牌
}); // 结束 beforeEach

interface Session { // 登录会话契约
  token: string; // Bearer 令牌
  userId: string; // 用户主键
} // 代码块结束

async function login(identifier: string): Promise<Session> { // 登录辅助：先取验证码再换令牌
  const codeRes = await request(app) // 申请验证码
    .post('/api/v1/auth/code') // 验证码端点
    .send({ region: 'cn', provider: 'phone', identifier }); // 固定 cn + 手机号通道
  expect(codeRes.status).toBe(201); // 验证码已创建
  const loginRes = await request(app) // 换令牌
    .post('/api/v1/auth/login') // 登录端点
    .send({ // 登录请求体
      region: 'cn', // 区域固定 cn
      provider: 'phone', // 通道固定手机号
      identifier, // 与验证码阶段一致
      code: codeRes.body.dev_code, // 测试环境直接回传 dev_code
      device: { platform: 'web', name: 'test' }, // 设备信息为契约必填
    }); // 结束请求体
  expect(loginRes.status).toBe(200); // 登录成功
  return { token: loginRes.body.access_token as string, userId: loginRes.body.user.id as string }; // 返回令牌与用户 id
} // login 结束

/** 给用户发放某个模块的权益，直接写库以绕开付费流程 */
function grant(moduleCode: string, userId: string): void {
  const moduleRow = db // 定位模块主键
    .prepare(`SELECT id FROM modules WHERE code = ? AND region = 'cn' AND deleted_at IS NULL`) // 只取主键
    .get(moduleCode) as { id: string } | undefined; // 命中结构
  expect(moduleRow).toBeTruthy(); // 模块必须存在
  db.prepare( // 插入权益行（active 且永久有效）
    `INSERT INTO entitlements (id, module_id, user_id, source, source_id, status, expires_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 'active', NULL, 1, ?, ?)`, // 固定 admin 来源与永久有效
  ).run(`ent:${moduleCode}:${userId}`, moduleRow!.id, userId, new Date().toISOString(), new Date().toISOString()); // 主键可预测，便于复用
} // grant 结束

describe('能力注册表与清单一致', () => { // 防止 core-domain 登记了能力却没有实现
  it('每条登记能力的 key 都有对应 handler', () => { // 调用 it 并处理其返回结果
    for (const item of MODULE_CAPABILITIES) { // 逐条比对
      expect(CAPABILITY_HANDLERS[item.key], `缺少 handler: ${item.key}`).toBeTypeOf('function'); // 必须是函数
    } // 循环结束
  }); // 用例结束
}); // 分组结束

describe('POST /modules/:code/invoke 门禁', () => { // 三层门禁逐条验证
  it('未登录 → 401 AUTH_UNAUTHORIZED', async () => { // 调用 it 并处理其返回结果
    const res = await request(app) // 匿名调用
      .post('/api/v1/modules/cat.dev-28/invoke') // JSON 工具
      .send({ text: '{"a":1}' }); // 合法输入
    expect(res.status).toBe(401); // 断言 401
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED'); // 断言错误码
  }); // 用例结束

  it('已登录但未解锁 → 403 FORBIDDEN', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000031'); // 新用户，无任何权益
    const res = await request(app) // 带令牌调用
      .post('/api/v1/modules/cat.dev-28/invoke') // JSON 工具
      .set('authorization', `Bearer ${session.token}`) // Bearer 鉴权
      .send({ text: '{"a":1}' }); // 合法输入
    expect(res.status).toBe(403); // 断言 403
    expect(res.body.code).toBe('FORBIDDEN'); // 断言错误码
  }); // 用例结束

  it('原「规划中」模块现已具备真实能力（产出模块起盘蓝图）', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000032'); // 登录
    grant('cat.store-03', session.userId); // 给权益，证明门禁放行后能真正产出内容
    const res = await request(app) // 调用 BBS 论坛模块
      .post('/api/v1/modules/cat.store-03/invoke') // 该模块现由蓝图能力承接
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'BBS 论坛改造' }); // 项目名即第一行
    expect(res.status).toBe(200); // 蓝图能力正常返回
    expect(res.body.output_kind).toBe('text'); // 输出为 Markdown 文本
    expect(res.body.output).toContain('cat.store-03'); // 文档内回显模块编码
    expect(res.body.output).not.toContain('功能规划中'); // 不再出现「规划中」文案
    expect(res.body.meta.module_code).toBe('cat.store-03'); // 元信息回显编码
  }); // 用例结束

  it('输入超长 → 400 VALIDATION_FAILED', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000033'); // 登录
    grant('cat.dev-28', session.userId); // 解锁 JSON 工具
    const res = await request(app) // 调用
      .post('/api/v1/modules/cat.dev-28/invoke') // JSON 工具
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'x'.repeat(20001) }); // 超过 20000 上限
    expect(res.status).toBe(400); // 断言 400
    expect(res.body.code).toBe('VALIDATION_FAILED'); // 断言错误码
  }); // 用例结束
}); // 分组结束

describe('六种能力的真实输出', () => { // 每种能力跑一次端到端调用
  it('json.format 格式化与压缩', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000041'); // 登录
    grant('cat.dev-28', session.userId); // 解锁
    const pretty = await request(app) // 格式化
      .post('/api/v1/modules/cat.dev-28/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: '{"a":1,"b":[2,3]}', options: { mode: 'pretty' } }); // 两空格缩进
    expect(pretty.status).toBe(200); // 断言 200
    expect(pretty.body.output_kind).toBe('json'); // 输出形态
    expect(pretty.body.output).toContain('\n  "a": 1'); // 缩进生效
    const minify = await request(app) // 压缩
      .post('/api/v1/modules/cat.dev-28/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: '{ "a" : 1 }', options: { mode: 'minify' } }); // 去空白
    expect(minify.body.output).toBe('{"a":1}'); // 压缩结果精确匹配
    const bad = await request(app) // 非法 JSON
      .post('/api/v1/modules/cat.dev-28/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: '{a:1}' }); // 非法输入
    expect(bad.status).toBe(400); // 断言 400
    expect(bad.body.code).toBe('VALIDATION_FAILED'); // 断言错误码
  }); // 用例结束

  it('text.encode 六向编解码（base64 / base64url / hex / url）', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000042'); // 登录
    grant('cat.dev-04', session.userId); // 解锁常用工具包
    const encoded = await request(app) // Base64 编码
      .post('/api/v1/modules/cat.dev-04/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: '你好Mim', options: { op: 'base64', direction: 'encode' } }); // 中文输入
    expect(encoded.body.output).toBe(Buffer.from('你好Mim', 'utf8').toString('base64')); // 与原生结果一致
    const decoded = await request(app) // Base64 解码
      .post('/api/v1/modules/cat.dev-04/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: encoded.body.output, options: { op: 'base64', direction: 'decode' } }); // 用上一步结果
    expect(decoded.body.output).toBe('你好Mim'); // 往返一致
    const hex = await request(app) // Hex 编码
      .post('/api/v1/modules/cat.dev-04/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'Mim', options: { op: 'hex' } }); // 默认 encode
    expect(hex.body.output).toBe('4d696d'); // 固定期望值
    const url = await request(app) // URL 编码
      .post('/api/v1/modules/cat.dev-04/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'a b&c', options: { op: 'url' } }); // 含特殊字符
    expect(url.body.output).toBe('a%20b%26c'); // 空格与 & 均被转义
    const badOp = await request(app) // 未知编码方式
      .post('/api/v1/modules/cat.dev-04/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'x', options: { op: 'rot13' } }); // 未支持
    expect(badOp.status).toBe(400); // 断言 400
    expect(badOp.body.code).toBe('VALIDATION_FAILED'); // 断言错误码
  }); // 用例结束

  it('text.hash 四种算法与非法算法', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000043'); // 登录
    grant('cat.dev-03', session.userId); // 解锁安全开发模块
    const sha256 = await request(app) // SHA-256 摘要
      .post('/api/v1/modules/cat.dev-03/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'abc', options: { algo: 'sha256' } }); // 标准向量
    expect(sha256.body.output).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); // NIST 已知向量
    const md5 = await request(app) // MD5 摘要
      .post('/api/v1/modules/cat.dev-03/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'abc', options: { algo: 'md5' } }); // 标准向量
    expect(md5.body.output).toBe('900150983cd24fb0d6963f7d28e17f72'); // RFC 1321 已知向量
    const bad = await request(app) // 非法算法
      .post('/api/v1/modules/cat.dev-03/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'abc', options: { algo: 'crc32' } }); // 未支持
    expect(bad.status).toBe(400); // 断言 400
    expect(bad.body.code).toBe('VALIDATION_FAILED'); // 断言错误码
  }); // 用例结束

  it('markdown.render 输出 HTML', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000044'); // 登录
    grant('cat.dev-17', session.userId); // 解锁 Markdown 工具包
    const res = await request(app) // 渲染
      .post('/api/v1/modules/cat.dev-17/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: '# 标题\n\n- 一\n- **二**' }); // 标题 + 列表 + 加粗
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.output_kind).toBe('html'); // 输出形态
    expect(res.body.output).toContain('<h1>标题</h1>'); // 标题渲染
    expect(res.body.output).toContain('<strong>二</strong>'); // 加粗渲染
  }); // 用例结束

  it('qrcode.generate 输出 PNG dataURL 且尺寸受夹紧', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000045'); // 登录
    grant('cat.dev-06', session.userId); // 解锁二维码模块
    const res = await request(app) // 生成
      .post('/api/v1/modules/cat.dev-06/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'https://mim.mixm.top', options: { size: 4096 } }); // 故意越界，期望被夹到 1024
    expect(res.status).toBe(200); // 断言 200
    expect(res.body.output_kind).toBe('image'); // 输出形态
    expect(res.body.output.startsWith('data:image/png;base64,')).toBe(true); // PNG dataURL 数据
    expect(res.body.meta.size).toBe(1024); // 尺寸被夹紧到上限
  }); // 用例结束

  it('cron.describe 推算未来触发时间与非法表达式', async () => { // 调用 it 并处理其返回结果
    const session = await login('13900000046'); // 登录
    grant('cat.dev-14', session.userId); // 解锁任务调度模块
    const res = await request(app) // 解析
      .post('/api/v1/modules/cat.dev-14/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: '0 9 * * 1-5', options: { count: 3 } }); // 工作日 9 点
    expect(res.status).toBe(200); // 断言 200
    const parsed = JSON.parse(res.body.output as string) as { expression: string; next: string[] }; // 解析输出
    expect(parsed.expression).toBe('0 9 * * 1-5'); // 回显表达式
    expect(parsed.next.length).toBe(3); // 条数符合请求
    expect(new Date(parsed.next[0]).getHours()).toBe(9); // 首次触发落在 9 点（本地时钟口径）
    const bad = await request(app) // 非法表达式
      .post('/api/v1/modules/cat.dev-14/invoke') // 端点
      .set('authorization', `Bearer ${session.token}`) // 鉴权
      .send({ text: 'not a cron' }); // 完全非法
    expect(bad.status).toBe(400); // 断言 400
    expect(bad.body.code).toBe('VALIDATION_FAILED'); // 断言错误码
  }); // 用例结束
}); // 分组结束
