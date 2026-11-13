/** 契约测试：统一内容与消息域 —— 论坛/圈子合并、IM/私信合并、成员权限、回填幂等 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { backfillUnifiedContentMessaging } from '../src/content/unified.js'; // 回填函数

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 管理令牌

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 数据库

beforeEach(() => { // 每例重建
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 装配
});

/** 领访客令牌 */
async function guest() {
  const res = await request(app).post('/api/v1/auth/guest').send({}); // 公开端点
  expect(res.status).toBe(200); // 必成功
  return { token: res.body.access_token as string, userId: res.body.user.id as string }; // 令牌与用户 id
}

describe('统一内容与消息域', () => {
  it('内容流把论坛主题与圈内动态合并成一个列表，公开可读', async () => {
    const { userId } = await guest(); // 需要一个已有用户做圈主
    db.prepare(`INSERT INTO circles (id, slug, name, owner_id, created_at) VALUES ('c-test-1', 'test-circle', '测试圈子', ?, '2026-11-06T00:00:00.000Z')`).run(userId); // 建一个圈子
    db.prepare(`INSERT INTO circle_posts (id, circle_id, author_id, body, created_at) VALUES ('cp-test-1', 'c-test-1', ?, '圈内第一条动态', '2026-11-07T00:00:00.000Z')`).run(userId); // 圈内动态
    const backfill = backfillUnifiedContentMessaging(db); // 回填
    expect(backfill.content).toBeGreaterThan(0); // 论坛种子帖 + 本条动态都应写入
    const res = await request(app).get('/api/v1/content/items?limit=200'); // 匿名读取
    expect(res.status).toBe(200); // 内容流公开
    const sources = res.body.items.map((item: { source: string }) => item.source); // 来源集合
    expect(sources).toContain('community_thread'); // 论坛线在
    expect(sources).toContain('circle_post'); // 圈子线在
    const circle = res.body.items.find((item: { source: string }) => item.source === 'circle_post'); // 圈内那条
    expect(circle.container_kind).toBe('circle'); // 容器类型正确
    expect(circle.title).toBe(''); // 圈内动态没有标题
    const filtered = await request(app).get('/api/v1/content/items?container_id=c-test-1'); // 按容器过滤
    expect(filtered.body.items.every((item: { container_id: string }) => item.container_id === 'c-test-1')).toBe(true); // 只出该圈子
  });

  it('IM 会话与裸私信合并为同一会话列表，会话内消息按成员权限放行', async () => {
    const alice = await guest(); // 用户 A
    const bob = await guest(); // 用户 B
    db.prepare(`INSERT INTO im_conversations (id, type, title, owner_user_id, created_at, updated_at) VALUES ('ic-test-1', 'direct', '', ?, '2026-11-08T00:00:00.000Z', '2026-11-08T00:01:00.000Z')`).run(alice.userId); // IM 会话
    db.prepare(`INSERT INTO im_conversation_members (conversation_id, user_id, joined_at) VALUES ('ic-test-1', ?, '2026-11-08T00:00:00.000Z')`).run(alice.userId); // A 在会话里
    db.prepare(`INSERT INTO im_conversation_members (conversation_id, user_id, joined_at) VALUES ('ic-test-1', ?, '2026-11-08T00:00:00.000Z')`).run(bob.userId); // B 在会话里
    db.prepare(`INSERT INTO im_messages (id, conversation_id, sender_user_id, content_type, content, created_at, updated_at) VALUES ('im-test-1', 'ic-test-1', ?, 'text', 'IM 消息', '2026-11-08T00:01:00.000Z', '2026-11-08T00:01:00.000Z')`).run(alice.userId); // 一条 IM 消息
    db.prepare(`INSERT INTO direct_messages (id, from_user_id, to_user_id, content, created_at) VALUES ('dm-test-1', ?, ?, '裸私信', '2026-11-09T00:00:00.000Z')`).run(alice.userId, bob.userId); // 一条私信
    backfillUnifiedContentMessaging(db); // 回填
    const list = await request(app).get('/api/v1/messaging/conversations').set('Authorization', `Bearer ${alice.token}`); // A 的会话
    expect(list.status).toBe(200); // 登录可读
    expect(list.body.items.map((item: { source: string }) => item.source).sort()).toEqual(['dm', 'im']); // 两条线各一个会话
    const imConversation = list.body.items.find((item: { source: string }) => item.source === 'im'); // IM 会话
    expect(imConversation.members.sort()).toEqual([alice.userId, bob.userId].sort()); // 成员聚合正确
    const messages = await request(app).get(`/api/v1/messaging/conversations/${imConversation.id}/messages`).set('Authorization', `Bearer ${bob.token}`); // B 读 IM 会话
    expect(messages.status).toBe(200); // 成员可读
    expect(messages.body.items).toHaveLength(1); // 一条消息
    expect(messages.body.items[0].source).toBe('im'); // 来源正确
    const stranger = await guest(); // 会话外用户
    const denied = await request(app).get(`/api/v1/messaging/conversations/${imConversation.id}/messages`).set('Authorization', `Bearer ${stranger.token}`); // 越权读
    expect(denied.status).toBe(404); // 非成员与不存在同响应
    const anon = await request(app).get('/api/v1/messaging/conversations'); // 未登录
    expect(anon.status).toBe(401); // 消息必须登录
  });

  it('回填幂等：重复执行不新增内容、会话与消息', async () => {
    const user = await guest(); // 用户
    db.prepare(`INSERT INTO circles (id, slug, name, owner_id, created_at) VALUES ('c-idem-1', 'idem-circle', '幂等圈子', ?, '2026-11-10T00:00:00.000Z')`).run(user.userId); // 圈子
    db.prepare(`INSERT INTO circle_notices (id, circle_id, author_id, body, created_at) VALUES ('cn-idem-1', 'c-idem-1', ?, '公告', '2026-11-10T00:00:00.000Z')`).run(user.userId); // 公告
    const first = backfillUnifiedContentMessaging(db); // 第一次
    expect(first.content).toBeGreaterThan(0); // 有写入
    const second = backfillUnifiedContentMessaging(db); // 第二次
    expect(second).toEqual({ content: 0, conversations: 0, messages: 0 }); // 唯一键保证零新增
  });
});
