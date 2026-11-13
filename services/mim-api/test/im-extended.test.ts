/** 契约测试：IM 扩展能力（会话详情 / 群改名 / 成员增删 / 置顶免打扰 / 消息搜索 / 撤回 / 删除会话）。 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 测试框架
import request from 'supertest'; // 真实 HTTP 请求
import type { Express } from 'express'; // 仅类型
import { createApp } from '../src/app.js'; // 应用工厂
import { createDatabase } from '../src/db.js'; // 内存数据库工厂

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试 JWT 密钥
const ADMIN_PASSWORD = 'testpass123'; // 测试管理员口令

let app: Express; // 每个用例重建，避免状态残留

// 每个 it 前重建 app
beforeEach(() => {
  app = createApp({ // 赋值：更新变量 app 的取值
    db: createDatabase(':memory:'), // 全新内存库
    jwtSecret: JWT_SECRET, // 固定密钥
    env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD }, // 启用密码登录便于造用户
  }); // 代码块结束
}); // 代码块结束

/** 用手机号登录并返回令牌与用户 ID */
async function login(identifier: string): Promise<{ token: string; userId: string }> {
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD }); // 密码登录
  expect(res.status).toBe(200); // 必须成功
  return { token: res.body.access_token, userId: res.body.user.id }; // 返回令牌与 ID
} // login 结束

/** 创建群聊辅助：返回会话 ID */
async function createGroup(ownerToken: string, memberUserIds: string[], name = '测试群'): Promise<string> {
  const res = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${ownerToken}`).send({ type: 'group', name, member_user_ids: memberUserIds }); // 建群
  expect(res.status).toBe(201); // 创建成功
  return res.body.conversation_id as string; // 返回 ID
} // createGroup 结束

describe('IM 扩展能力', () => { // 调用 describe 并处理其返回结果
  // 用例 1：会话详情返回群主与成员清单
  it('GET /im/conversations/:id 返回会话信息与成员', async () => {
    const a = await login('13900000001'); // 群主
    const b = await login('13900000002'); // 成员
    const cid = await createGroup(a.token, [b.userId]); // 建群
    const res = await request(app).get(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 正常返回
    expect(res.body.conversation.owner_user_id).toBe(a.userId); // 群主正确
    expect(res.body.members).toHaveLength(2); // 两名成员
    const owner = res.body.members.find((m: { user_id: string }) => m.user_id === a.userId); // 找群主行
    expect(owner.role).toBe('owner'); // 角色为 owner
  }); // 代码块结束

  // 用例 2：群改名权限
  it('群改名：群主可改，普通成员 403', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const cid = await createGroup(a.token, [b.userId]); // 准备：构造本用例需要的输入或句柄
    const denied = await request(app).patch(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${b.token}`).send({ title: '改名试试' }); // 准备：构造本用例需要的输入或句柄
    expect(denied.status).toBe(403); // 非群主被拒
    const ok = await request(app).patch(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${a.token}`).send({ title: '新群名' }); // 准备：构造本用例需要的输入或句柄
    expect(ok.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(ok.body.title).toBe('新群名'); // 断言：校验接口响应或状态符合冻结契约
    const list = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${b.token}`); // 准备：构造本用例需要的输入或句柄
    expect(list.body.items[0].title).toBe('新群名'); // 列表标题同步
  }); // 代码块结束

  // 用例 3：邀请入群，重复邀请返回 added=0
  it('POST /members 邀请入群并去重', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const c = await login('13900000003'); // 准备：构造本用例需要的输入或句柄
    const cid = await createGroup(a.token, [b.userId]); // 准备：构造本用例需要的输入或句柄
    const first = await request(app).post(`/api/v1/im/conversations/${cid}/members`).set('Authorization', `Bearer ${a.token}`).send({ user_ids: [c.userId] }); // 准备：构造本用例需要的输入或句柄
    expect(first.status).toBe(201); // 断言：校验接口响应或状态符合冻结契约
    expect(first.body.added).toBe(1); // 新增 1 人
    const again = await request(app).post(`/api/v1/im/conversations/${cid}/members`).set('Authorization', `Bearer ${a.token}`).send({ user_ids: [c.userId] }); // 准备：构造本用例需要的输入或句柄
    expect(again.body.added).toBe(0); // 已在群里不重复加
    const members = await request(app).get(`/api/v1/im/conversations/${cid}/members`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(members.body.items).toHaveLength(3); // 三人
  }); // 代码块结束

  // 用例 4：踢人与禁止踢群主
  it('DELETE /members/:userId 群主可踢人，但不能踢群主', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const cid = await createGroup(a.token, [b.userId]); // 准备：构造本用例需要的输入或句柄
    const kick = await request(app).delete(`/api/v1/im/conversations/${cid}/members/${b.userId}`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(kick.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(kick.body.ok).toBe(true); // 断言：校验接口响应或状态符合冻结契约
    const list = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${b.token}`); // 准备：构造本用例需要的输入或句柄
    expect(list.body.items).toHaveLength(0); // 被踢后看不到会话
    const kickOwner = await request(app).delete(`/api/v1/im/conversations/${cid}/members/${a.userId}`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(kickOwner.status).toBe(400); // 群主不可被移出
  }); // 代码块结束

  // 用例 5：置顶与免打扰写入成员表并影响排序
  it('PATCH /preferences 写入置顶与免打扰', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const first = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const second = await createGroup(a.token, [b.userId], '第二会话'); // 准备：构造本用例需要的输入或句柄
    const pinned = await request(app).patch(`/api/v1/im/conversations/${second}/preferences`).set('Authorization', `Bearer ${a.token}`).send({ pinned: true, muted: true }); // 准备：构造本用例需要的输入或句柄
    expect(pinned.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    const list = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(list.body.items[0].id).toBe(second); // 置顶会话排第一
    expect(list.body.items[0].pinned).toBe(true); // 断言：校验接口响应或状态符合冻结契约
    expect(list.body.items[0].muted).toBe(true); // 断言：校验接口响应或状态符合冻结契约
    expect(list.body.items.find((c: { id: string }) => c.id === first.body.conversation_id).pinned).toBe(false); // 未置顶
  }); // 代码块结束

  // 用例 6：会话内消息搜索命中并排除不相关
  it('GET /messages/search 按内容模糊匹配', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const conv = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const cid = conv.body.conversation_id; // 准备：构造本用例需要的输入或句柄
    await request(app).post(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content_type: 'text', content: '今晚部署生产环境' }); // 执行：等待异步操作返回后继续
    await request(app).post(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content_type: 'text', content: '明天再看日志' }); // 执行：等待异步操作返回后继续
    const res = await request(app).get(`/api/v1/im/conversations/${cid}/messages/search?q=部署`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(res.body.items).toHaveLength(1); // 只命中一条
    expect(res.body.items[0].content).toContain('部署'); // 断言：校验接口响应或状态符合冻结契约
  }); // 代码块结束

  // 用例 7：撤回本人消息成功，他人撤回 403
  it('POST /messages/:id/recall 仅本人可撤回', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const conv = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const cid = conv.body.conversation_id; // 准备：构造本用例需要的输入或句柄
    const sent = await request(app).post(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content_type: 'text', content: '马上撤回' }); // 准备：构造本用例需要的输入或句柄
    const messageId = sent.body.message.id; // 准备：构造本用例需要的输入或句柄
    const denied = await request(app).post(`/api/v1/im/conversations/${cid}/messages/${messageId}/recall`).set('Authorization', `Bearer ${b.token}`); // 准备：构造本用例需要的输入或句柄
    expect(denied.status).toBe(403); // 非发送者
    const ok = await request(app).post(`/api/v1/im/conversations/${cid}/messages/${messageId}/recall`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(ok.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    const hist = await request(app).get(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(hist.body.items).toHaveLength(0); // 撤回后历史不再返回
    const missing = await request(app).post(`/api/v1/im/conversations/${cid}/messages/does-not-exist/recall`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(missing.status).toBe(404); // 不存在的消息
  }); // 代码块结束

  // 用例 8：成员删除会话 = 退群，群主删除 = 解散
  it('DELETE /conversations/:id 退群与解散语义正确', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const cid = await createGroup(a.token, [b.userId]); // 准备：构造本用例需要的输入或句柄
    const leave = await request(app).delete(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${b.token}`); // 准备：构造本用例需要的输入或句柄
    expect(leave.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(leave.body.result).toBe('left'); // 普通成员退群
    const listA = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(listA.body.items).toHaveLength(1); // 群主仍能看到群
    const dissolve = await request(app).delete(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(dissolve.body.result).toBe('dissolved'); // 群主解散
    const missing = await request(app).get(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(missing.status).toBe(404); // 解散后会话已软删，详情返回 404
  }); // 代码块结束

  // 用例 9：会话列表带 member_count / pinned / muted 字段
  it('会话列表返回 member_count、pinned、muted', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const c = await login('13900000003'); // 准备：构造本用例需要的输入或句柄
    await createGroup(a.token, [b.userId, c.userId]); // 执行：等待异步操作返回后继续
    const list = await request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    const item = list.body.items[0]; // 准备：构造本用例需要的输入或句柄
    expect(item.member_count).toBe(3); // 三人群
    expect(item.pinned).toBe(false); // 默认不置顶
    expect(item.muted).toBe(false); // 默认不免打扰
  }); // 代码块结束

  // 用例 10：引用回复落库并在历史中回显摘要，非法引用 400
  it('POST /messages 支持引用回复并校验引用有效性', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const conv = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const cid = conv.body.conversation_id; // 准备：构造本用例需要的输入或句柄
    const first = await request(app).post(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content_type: 'text', content: '原始问题：部署脚本在哪' }); // 准备：构造本用例需要的输入或句柄
    const firstId = first.body.message.id; // 准备：构造本用例需要的输入或句柄
    const reply = await request(app) // 准备：构造本用例需要的输入或句柄
      .post(`/api/v1/im/conversations/${cid}/messages`) // 注册 POST 路由 / 中间件处理器
      .set('Authorization', `Bearer ${b.token}`) // 执行当前业务步骤
      .send({ content_type: 'text', content: '在 deploy/ 目录', reply_to_id: firstId }); // 引用回复
    expect(reply.status).toBe(201); // 断言：校验接口响应或状态符合冻结契约
    expect(reply.body.message.reply_to_id).toBe(firstId); // 引用目标回显
    expect(reply.body.message.reply_excerpt).toContain('部署脚本在哪'); // 摘要包含被引用正文
    const missing = await request(app) // 准备：构造本用例需要的输入或句柄
      .post(`/api/v1/im/conversations/${cid}/messages`) // 注册 POST 路由 / 中间件处理器
      .set('Authorization', `Bearer ${b.token}`) // 执行当前业务步骤
      .send({ content_type: 'text', content: '引用不存在的消息', reply_to_id: 'does-not-exist' }); // 执行当前业务步骤
    expect(missing.status).toBe(400); // 非法引用被拒
    const recalled = await request(app).post(`/api/v1/im/conversations/${cid}/messages/${firstId}/recall`).set('Authorization', `Bearer ${a.token}`); // 撤回原消息
    expect(recalled.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    const afterRecall = await request(app) // 准备：构造本用例需要的输入或句柄
      .post(`/api/v1/im/conversations/${cid}/messages`) // 注册 POST 路由 / 中间件处理器
      .set('Authorization', `Bearer ${b.token}`) // 执行当前业务步骤
      .send({ content_type: 'text', content: '引用已撤回的消息', reply_to_id: firstId }); // 执行当前业务步骤
    expect(afterRecall.status).toBe(400); // 已撤回不可引用
  }); // 代码块结束

  // 用例 11：around 定位返回目标消息及其前后上下文
  it('GET /messages?around= 返回目标附近的上下文', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const conv = await request(app).post('/api/v1/im/conversations').set('Authorization', `Bearer ${a.token}`).send({ type: 'direct', target_user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    const cid = conv.body.conversation_id; // 准备：构造本用例需要的输入或句柄
    const ids: string[] = []; // 记录消息 ID 便于断言
    for (let i = 0; i < 5; i += 1) { // 循环：逐项遍历集合并执行相同处理
      const res = await request(app).post(`/api/v1/im/conversations/${cid}/messages`).set('Authorization', `Bearer ${a.token}`).send({ content_type: 'text', content: `第 ${i} 条` }); // 准备：构造本用例需要的输入或句柄
      ids.push(res.body.message.id); // 执行当前业务步骤
    } // 造 5 条消息
    const res = await request(app).get(`/api/v1/im/conversations/${cid}/messages?around=${ids[2]}&limit=4`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(res.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    expect(res.body.items.some((m: { id: string }) => m.id === ids[2])).toBe(true); // 目标必须在结果里
    expect(res.body.items[0].id).not.toBe(ids[4]); // 不是把全部消息都返回
  }); // 代码块结束

  // 用例 12：设 / 撤管理员（仅群主，群主角色不可改）
  it('PATCH /members/:userId 设管理员，非群主 403、群主行不可改', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const cid = await createGroup(a.token, [b.userId]); // 准备：构造本用例需要的输入或句柄
    const denied = await request(app).patch(`/api/v1/im/conversations/${cid}/members/${b.userId}`).set('Authorization', `Bearer ${b.token}`).send({ role: 'admin' }); // 准备：构造本用例需要的输入或句柄
    expect(denied.status).toBe(403); // 非群主无权
    const promote = await request(app).patch(`/api/v1/im/conversations/${cid}/members/${b.userId}`).set('Authorization', `Bearer ${a.token}`).send({ role: 'admin' }); // 准备：构造本用例需要的输入或句柄
    expect(promote.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    const detail = await request(app).get(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(detail.body.members.find((m: { user_id: string }) => m.user_id === b.userId).role).toBe('admin'); // 角色已变更
    const demoteOwner = await request(app).patch(`/api/v1/im/conversations/${cid}/members/${a.userId}`).set('Authorization', `Bearer ${a.token}`).send({ role: 'member' }); // 准备：构造本用例需要的输入或句柄
    expect(demoteOwner.status).toBe(400); // 群主角色不可被这条接口改写
    const notMember = await request(app).patch(`/api/v1/im/conversations/${cid}/members/nobody`).set('Authorization', `Bearer ${a.token}`).send({ role: 'admin' }); // 准备：构造本用例需要的输入或句柄
    expect(notMember.status).toBe(404); // 非成员
  }); // 代码块结束

  // 用例 13：转让群主后原群主降级、新群主可改名
  it('POST /transfer 转让群主并同步角色', async () => {
    const a = await login('13900000001'); // 准备：构造本用例需要的输入或句柄
    const b = await login('13900000002'); // 准备：构造本用例需要的输入或句柄
    const cid = await createGroup(a.token, [b.userId]); // 准备：构造本用例需要的输入或句柄
    const self = await request(app).post(`/api/v1/im/conversations/${cid}/transfer`).set('Authorization', `Bearer ${a.token}`).send({ user_id: a.userId }); // 准备：构造本用例需要的输入或句柄
    expect(self.status).toBe(400); // 不能转给自己
    const denied = await request(app).post(`/api/v1/im/conversations/${cid}/transfer`).set('Authorization', `Bearer ${b.token}`).send({ user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    expect(denied.status).toBe(403); // 非群主无权转让
    const ok = await request(app).post(`/api/v1/im/conversations/${cid}/transfer`).set('Authorization', `Bearer ${a.token}`).send({ user_id: b.userId }); // 准备：构造本用例需要的输入或句柄
    expect(ok.status).toBe(200); // 断言：校验接口响应或状态符合冻结契约
    const detail = await request(app).get(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${a.token}`); // 准备：构造本用例需要的输入或句柄
    expect(detail.body.conversation.owner_user_id).toBe(b.userId); // 会话群主已切换
    expect(detail.body.members.find((m: { user_id: string }) => m.user_id === a.userId).role).toBe('member'); // 原群主降级
    const rename = await request(app).patch(`/api/v1/im/conversations/${cid}`).set('Authorization', `Bearer ${b.token}`).send({ title: '新群主改名' }); // 准备：构造本用例需要的输入或句柄
    expect(rename.status).toBe(200); // 新群主获得管理权限
  }); // 代码块结束
}); // 代码块结束
