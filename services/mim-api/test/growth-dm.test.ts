/**
 * 成长私信契约测试：管理端按条件挑人 → 系统身份私信落到真实 IM 会话。
 *
 * 覆盖：受众预览、单人发送、跳转字段、批次幂等重放、系统会话复用、
 * 权限拒绝，以及普通 1v1 聊天 / 未读角标回归不受影响。
 */

import { randomUUID } from 'node:crypto'; // 为每次写请求生成独立幂等键
import type { Express } from 'express'; // 应用类型
import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // 真实 HTTP 调用
import { createApp } from '../src/app.js'; // 完整应用（含全局中间件与全部路由）
import { createDatabase } from '../src/db.js'; // 内存数据库
import { registerTestAccount } from './_auth-helper.js'; // 注册 + 登录辅助

// 测试 JWT 密钥
const JWT_SECRET = 'growth-dm-secret-0123456789abcdef012345'; // 固定值
// 引导令牌：命中后视为全权限，用于管理端调用
const ADMIN_TOKEN = 'growth-dm-admin-token'; // 固定值

// 每个用例独立数据库与应用，避免状态串扰
let db: ReturnType<typeof createDatabase>; // 内存库
let app: Express; // 应用实例

beforeEach(() => {
  db = createDatabase(':memory:'); // 新建内存库（含全部 schema 与增量脚本）
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 组装完整应用
});

/** 管理端请求头：引导令牌 + 独立幂等键（避免被全局幂等中间件缓存响应） */
function adminHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'idempotency-key': randomUUID() }; // 每次请求独立键
}

/** 管理端发送一封成长私信 */
async function sendDm(payload: Record<string, unknown>) {
  return request(app).post('/api/v1/admin/growth-dm/send').set(adminHeaders()).send(payload); // 发起发送
}

/** 读取某用户的会话列表 */
async function listConversations(token: string) {
  return request(app).get('/api/v1/im/conversations').set('Authorization', `Bearer ${token}`); // 发起查询
}

describe('成长私信', () => {
  it('预览受众：按注册地区统计命中人数与样本', async () => {
    await registerTestAccount(app, '13900000001'); // 用户 A
    await registerTestAccount(app, '13900000002'); // 用户 B
    const res = await request(app)
      .post('/api/v1/admin/growth-dm/preview')
      .set(adminHeaders())
      .send({ audience: { region: 'cn' } }); // 按地区预览
    expect(res.status).toBe(200); // 正常返回
    expect(res.body.count).toBe(2); // 两个活跃用户
    expect(res.body.sample).toHaveLength(2); // 样本与命中数一致
    expect(res.body.sample[0]).toHaveProperty('member_no'); // 样本带 Mim ID 便于核对
  });

  it('指定单人发送：进入真实会话列表，发件方为系统身份且带跳转字段', async () => {
    const user = await registerTestAccount(app, '13900000003'); // 目标用户
    const res = await sendDm({
      dedupe_key: 'growthdm:test:single', // 幂等键
      title: '成长计划邀请', // 批次标题（仅后台）
      body: '你有一份成长计划待领取', // 正文
      link_url: '/community', // 站内跳转
      link_label: '立即查看', // 按钮文案
      audience: { user_ids: [user.userId] }, // 指定单人
    });
    expect(res.status).toBe(201); // 新批次创建成功
    expect(res.body.duplicate).toBe(false); // 非幂等命中
    expect(res.body.sent_count).toBe(1); // 实际发出 1 条

    // 会话列表：出现一条系统会话，标题与发件方均为「成长私信」
    const list = await listConversations(user.token);
    expect(list.status).toBe(200); // 正常返回
    expect(list.body.items).toHaveLength(1); // 只有系统会话
    const conv = list.body.items[0]; // 系统会话
    expect(conv.system_kind).toBe('growth'); // 标记为成长私信会话
    expect(conv.title).toBe('成长私信'); // 系统身份而非管理员个人账号
    expect(conv.unread_count).toBe(1); // 未读角标生效
    expect(conv.last_message.sender_user_id).toBe('system:growth-dm'); // 伪发送者 ID
    expect(conv.last_message.sender_display_name).toBe('成长私信'); // 展示名兜底

    // 历史消息：content_type=system，跳转字段完整
    const msgs = await request(app)
      .get(`/api/v1/im/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(msgs.status).toBe(200); // 正常返回
    expect(msgs.body.items).toHaveLength(1); // 仅一条系统私信
    const msg = msgs.body.items[0]; // 消息体
    expect(msg.content_type).toBe('system'); // 系统消息类型
    expect(msg.content).toBe('你有一份成长计划待领取'); // 正文一致
    expect(msg.link_url).toBe('/community'); // 跳转地址透传
    expect(msg.link_label).toBe('立即查看'); // 按钮文案透传

    // 系统伪 ID 不落 users 表：用户总数仍为 1
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    expect(count.n).toBe(1); // 没有为系统身份建账号
  });

  it('幂等重放：同一 dedupe_key 不重复发信', async () => {
    const user = await registerTestAccount(app, '13900000004'); // 目标用户
    const payload = {
      dedupe_key: 'growthdm:test:idem', // 同一幂等键
      title: '活动提醒', // 批次标题
      body: '明天有一场线上分享', // 正文
      audience: { user_ids: [user.userId] }, // 指定单人
    };
    const first = await sendDm(payload);
    expect(first.status).toBe(201); // 首次创建
    const second = await sendDm(payload);
    expect(second.status).toBe(200); // 幂等命中
    expect(second.body.duplicate).toBe(true); // 明确标记重复
    expect(second.body.sent_count).toBe(0); // 没有新发信
    expect(second.body.campaign.id).toBe(first.body.campaign.id); // 回执同一批次

    // 会话里仍只有一条消息
    const list = await listConversations(user.token);
    const conv = list.body.items[0];
    const msgs = await request(app)
      .get(`/api/v1/im/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(msgs.body.items).toHaveLength(1); // 未重复写入

    // 批次台账只有一条
    const campaigns = await request(app).get('/api/v1/admin/growth-dm/campaigns').set(adminHeaders());
    expect(campaigns.status).toBe(200); // 正常返回
    expect(campaigns.body.campaigns).toHaveLength(1); // 不产生重复批次
  });

  it('两次不同批次复用同一系统会话', async () => {
    const user = await registerTestAccount(app, '13900000005'); // 目标用户
    await sendDm({ dedupe_key: 'growthdm:test:first', title: '第一次', body: '第一条', audience: { user_ids: [user.userId] } });
    await sendDm({ dedupe_key: 'growthdm:test:second', title: '第二次', body: '第二条', audience: { user_ids: [user.userId] } });

    const list = await listConversations(user.token);
    expect(list.body.items).toHaveLength(1); // 仍只有一个系统会话
    const conv = list.body.items[0]; // 系统会话
    const msgs = await request(app)
      .get(`/api/v1/im/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(msgs.body.items).toHaveLength(2); // 两条消息落在同一会话
    expect(msgs.body.items.map((m: { content: string }) => m.content)).toEqual(['第一条', '第二条']); // 顺序正确
  });

  it('普通用户无 messaging:write 时发送返回 403', async () => {
    const user = await registerTestAccount(app, '13900000006'); // 普通用户
    const res = await request(app)
      .post('/api/v1/admin/growth-dm/send')
      .set({ Authorization: `Bearer ${user.token}`, 'idempotency-key': randomUUID() })
      .send({ dedupe_key: 'growthdm:test:forbidden', title: 'x', body: 'y', audience: { user_ids: [user.userId] } });
    expect(res.status).toBe(403); // 权限不足
  });

  it('普通 1v1 收发、未读与系统会话互不影响', async () => {
    const a = await registerTestAccount(app, '13900000007'); // 用户 A
    const b = await registerTestAccount(app, '13900000008'); // 用户 B
    // 先给 A 发一封成长私信
    await sendDm({ dedupe_key: 'growthdm:test:regression', title: '系统', body: '系统私信', audience: { user_ids: [a.userId] } });

    // A 与 B 建立普通私聊
    const conv = await request(app)
      .post('/api/v1/im/conversations')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ type: 'direct', target_user_id: b.userId });
    expect(conv.status).toBe(201); // 普通私聊创建成功
    const cid = conv.body.conversation_id as string; // 私聊会话 ID

    // B 发一条普通文本给 A
    const sent = await request(app)
      .post(`/api/v1/im/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ content_type: 'text', content: '你好' });
    expect(sent.status).toBe(201); // 普通消息发送成功
    expect(sent.body.message.content_type).toBe('text'); // 类型未被系统逻辑污染

    // A 的会话列表：系统会话 + 普通私聊共存，普通私聊用对方昵称且未读 1
    const list = await listConversations(a.token);
    expect(list.body.items).toHaveLength(2); // 两条会话
    const direct = list.body.items.find((item: { id: string }) => item.id === cid);
    expect(direct).toBeTruthy(); // 普通私聊仍在
    expect(direct.system_kind).toBeNull(); // 未被标记为系统会话
    expect(direct.title).toBe('测试用户'); // 普通私聊仍显示对方昵称
    expect(direct.unread_count).toBe(1); // 未读角标正常
    expect(direct.last_message.content).toBe('你好'); // 最后一条为普通消息

    // 历史消息仍是普通文本
    const history = await request(app)
      .get(`/api/v1/im/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(history.body.items).toHaveLength(1); // 只有那一条
    expect(history.body.items[0].sender_user_id).toBe(b.userId); // 发送者为真实用户
  });
});
