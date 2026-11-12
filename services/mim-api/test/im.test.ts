/** 契约测试：IM 即时通讯域（会话 / 消息 / 用户搜索 / 已读） */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 测试框架
import request from 'supertest'; // 对 Express app 发起真实 HTTP 请求
import type { Express } from 'express'; // 仅类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存数据库工厂

// 测试用 JWT 密钥
const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 准备：构造本用例需要的输入或句柄
// 测试用管理员口令（密码登录入口）
const ADMIN_PASSWORD = 'testpass123'; // 准备：构造本用例需要的输入或句柄

// 每个用例前重建 app，保证 case 间无状态残留
let app: Express; // 状态：保存跨步骤复用的值

// 钩子：为每个 it 准备一个全新的内存库 app 实例，env 注入管理员口令以启用密码登录
beforeEach(() => {
  app = createApp({
    db: createDatabase(':memory:'),
    jwtSecret: JWT_SECRET,
    env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD }, // 启用密码登录，便于测试创建用户
  });
});

// 辅助：用指定手机号登录并拿到 access_token；密码登录会自动创建用户
async function login(identifier: string): Promise<{ token: string; userId: string }> {
  const res = await request(app).post('/api/v1/auth/password').send({ // 准备：构造本用例需要的输入或句柄
    region: 'cn', // 国内通道
    identifier, // 手机号
    password: ADMIN_PASSWORD, // 管理员口令
  });
  expect(res.status).toBe(200); // 登录必须成功
  expect(res.body.access_token).toBeTruthy(); // 必须返回访问令牌
  expect(res.body.user.id).toBeTruthy(); // 必须返回用户 ID
  return { token: res.body.access_token, userId: res.body.user.id }; // 返回：交回本步骤结果供断言使用
}

// IM 域契约测试集合
describe('IM 即时通讯', () => {
  // 用例 1：未登录访问受保护路由返回 401
  it('未登录访问会话列表返回 401', async () => {
    const res = await request(app).get('/api/v1/im/conversations'); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(401); // 鉴权中间件拦截
  });

  // 用例 2：登录后初始会话列表为空
  it('登录后会话列表初始为空', async () => {
    const { token } = await login('13800000001'); // 登录用户 A
    const res = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${token}`); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 正常返回
    expect(res.body.items).toEqual([]); // 无会话
  });

  // 用例 3：创建两人私聊会话
  it('创建 direct 会话返回 conversation_id', async () => {
    const a = await login('13800000001'); // 用户 A
    const b = await login('13800000002'); // 用户 B
    const res = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/im/conversations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ type: 'direct', target_user_id: b.userId });
    expect(res.status).toBe(201); // 创建成功
    expect(res.body.conversation_id).toBeTruthy(); // 返回会话 ID
    // 双方会话列表都应有 1 条
    const listA = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(listA.body.items).toHaveLength(1); // 断言：校验接口响应或状态符合冻结契约
    const listB = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${b.token}`); // 准备：构造本用例需要的输入或句柄
    expect(listB.body.items).toHaveLength(1); // 断言：校验接口响应或状态符合冻结契约
  });

  // 用例 4：同两人重复创建私聊复用同一会话
  it('同两人重复创建 direct 复用同一会话', async () => {
    const a = await login('13800000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13800000002'); // 准备：构造本用例需要的输入或句柄
    const r1 = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const r2 = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${b.token}`).send({ type: 'direct', target_user_id: a.userId }); // 准备：构造本用例需要的输入或句柄
    expect(r1.body.conversation_id).toBe(r2.body.conversation_id); // 两次返回同一 ID
    const listA = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(listA.body.items).toHaveLength(1); // 不会出现两条
  });

  // 用例 5：不能与自己创建私聊
  it('与自己创建私聊返回 400', async () => {
    const a = await login('13800000001'); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: a.userId }); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(400); // 拒绝
  });

  // 用例 6：发送文本消息
  it('发送文本消息并能在历史中查到', async () => {
    const a = await login('13800000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13800000002'); // 准备：构造本用例需要的输入或句柄
    const conv = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const cid = conv.body.conversation_id; // 准备：构造本用例需要的输入或句柄
    // 发消息
    const sent = await request(app).post(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content_type: 'text', content: '你好' }); // 准备：构造本用例需要的输入或句柄
    expect(sent.status).toBe(201); // 断言：校验接口响应或状态符合冻结契约
    expect(sent.body.message.content_type).toBe('text'); // 断言：校验接口响应或状态符合冻结契约
    expect(sent.body.message.content).toBe('你好'); // 断言：校验接口响应或状态符合冻结契约
    // 拉历史
    const hist = await request(app).get(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(hist.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(hist.body.items).toHaveLength(1); // 断言：校验接口响应或状态符合冻结契约
    expect(hist.body.items[0].content).toBe('你好'); // 断言：校验接口响应或状态符合冻结契约
  });

  // 用例 7：非会话成员访问消息返回 403
  it('非会话成员拉取消息返回 403', async () => {
    const a = await login('13800000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13800000002'); // 准备：构造本用例需要的输入或句柄
    const c = await login('13800000003'); // 第三方用户
    const conv = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const cid = conv.body.conversation_id; // 准备：构造本用例需要的输入或句柄
    const res = await request(app).get(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${c.token}`); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(403); // 非成员拒绝
  });

  // 用例 8：创建群聊（含自己与多人）
  it('创建群聊返回会话且成员可见', async () => {
    const a = await login('13800000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13800000002'); // 准备：构造本用例需要的输入或句柄
    const c = await login('13800000003'); // 准备：构造本用例需要的输入或句柄
    const res = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'group', name: '测试群', member_user_ids: [b.userId, c.userId] }); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(201); // 断言：校验接口响应或状态符合冻结契约
    expect(res.body.conversation_id).toBeTruthy(); // 断言：校验接口响应或状态符合冻结契约
    // 三人都应在群里
    for (const u of [a, b, c]) {
      const list = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${u.token}`); // 准备：构造本用例需要的输入或句柄
      expect(list.body.items).toHaveLength(1); // 断言：校验接口响应或状态符合冻结契约
      expect(list.body.items[0].type).toBe('group'); // 断言：校验接口响应或状态符合冻结契约
      expect(list.body.items[0].title).toBe('测试群'); // 断言：校验接口响应或状态符合冻结契约
    }
  });

  // 用例 9：搜索用户（排除自己）
  it('搜索用户返回匹配项且不包含自己', async () => {
    const a = await login('13800000001'); // A 登录
    await login('13800000002'); // 创建 B
    await login('13800000003'); // 创建 C
    const res = await request(app).get('/api/v1/im/users?q=138').set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    const ids = res.body.items.map((u: { id: string }) => u.id); // 准备：构造本用例需要的输入或句柄
    expect(ids).not.toContain(a.userId); // 不包含自己
    expect(ids.length).toBeGreaterThanOrEqual(2); // 至少包含 B、C
  });

  // 用例 10：标记已读
  it('标记会话已读返回 ok', async () => {
    const a = await login('13800000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13800000002'); // 准备：构造本用例需要的输入或句柄
    const conv = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const cid = conv.body.conversation_id; // 准备：构造本用例需要的输入或句柄
    const sent = await request(app).post(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content_type: 'text', content: 'mark read' }); // 准备：构造本用例需要的输入或句柄
    const msgId = sent.body.message.id; // 准备：构造本用例需要的输入或句柄
    const res = await request(app).post(`/api/v1/im/conversations/${cid}/read`).set('Authorization', `Bearer ${b.token}`).send({ message_id: msgId }); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(res.body.ok).toBe(true); // 断言：校验接口响应或状态符合冻结契约
  });
});
