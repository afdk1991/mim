/** 契约测试：付费板块内免费帖的媒体锁定回归——匿名 / 未加入不下发任何媒体地址，加入后可见；免费板块不退化。 */

import { beforeEach, describe, expect, it } from 'vitest'; // 测试框架
import request from 'supertest'; // 真实 HTTP 调用
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 被测应用
import { createDatabase } from '../src/db.js'; // 内存库 + 种子
import { loginHeaders, registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 测试密钥
const PAID_THREAD = 'thread-cover-design'; // 付费板块 paid 内的免费帖（price_cents=0），种子挂 3 条图集媒体
const FREE_THREAD = 'thread-demo-gallery'; // 免费板块 guides 内图集帖，3 条媒体，匿名应可见

let app: Express; // 应用句柄
let db: ReturnType<typeof createDatabase>; // 直接查库核对会员落表

beforeEach(() => {
  db = createDatabase(':memory:'); // 全新内存库，种子与生产口径对齐
  app = createApp({ db, jwtSecret: JWT_SECRET, env: {} }); // 挂载完整路由与中间件
});

/** 取付费板块主键：直接插会员记录绕开余额支付，与 community-limits 测试同一口径 */
function paidBoardId(): string { // 返回板块主键
  return (db.prepare("SELECT id FROM community_boards WHERE slug = 'paid'").get() as { id: string }).id;
} // paidBoardId 结束

describe('付费板块媒体锁定回归（板块准入口径）', () => {
  it('匿名：付费板块内免费帖 media 不含任何 url、board_locked=true、正文为空', async () => {
    const detail = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`); // 匿名请求详情
    expect(detail.status).toBe(200); // 匿名可读详情壳，但内容受付费墙约束
    const thread = detail.body.thread; // 常量 thread：保存详情响应体
    expect(thread.board_locked).toBe(true); // 板块未加入：板块级锁定标记必须为真
    expect(thread.locked).toBe(true); // 综合锁定标记同样为真
    expect(thread.body).toBe(''); // 正文不下发
    expect(Array.isArray(thread.media)).toBe(true); // 媒体字段必须是数组（空数组也算通过）
    for (const item of thread.media) { // 逐条核对：不得出现任何可访问 url
      expect(String(item.url || '')).toBe(''); // 锁定态 url 必须为空串，对象键也不得外泄
    }
  });

  it('已登录未加入：媒体同样不下发 url，board_locked=true', async () => {
    const auth = await loginHeaders(app, '13820000101'); // 注册并登录一个未加入板块的普通用户
    const detail = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set(auth); // 带会话请求详情
    expect(detail.status).toBe(200); // 已登录未加入仍受板块门槛约束
    const thread = detail.body.thread; // 常量 thread：保存详情响应体
    expect(thread.board_locked).toBe(true); // 板块级锁定标记为真
    expect(thread.locked).toBe(true); // 综合锁定标记为真
    for (const item of thread.media) { // 逐条核对媒体地址
      expect(String(item.url || '')).toBe(''); // 未加入不得拿到任何媒体 url
    }
  });

  it('已加入板块：媒体可见且 url 非空，正文解锁', async () => {
    const member = await registerTestAccount(app, '13820000102'); // 注册会员用户
    db.prepare('INSERT INTO community_board_memberships (board_id, user_id, amount_cents, created_at) VALUES (?, ?, 0, ?)') // 直接落会员记录，绕开余额支付
      .run(paidBoardId(), member.userId, new Date().toISOString()); // 绑定到付费板块
    const auth = { authorization: `Bearer ${member.token}`, 'content-type': 'application/json' }; // 鉴权头
    const detail = await request(app).get(`/api/v1/community/threads/${PAID_THREAD}`).set(auth); // 会员请求详情
    expect(detail.status).toBe(200); // 会员可读
    expect(detail.body.unlocked).toBe(true); // 综合解锁标记为真
    const thread = detail.body.thread; // 常量 thread：保存详情响应体
    expect(thread.board_locked).toBe(false); // 板块准入已通过
    expect(thread.locked).toBe(false); // 综合锁定解除
    expect(thread.media).toHaveLength(3); // 种子 3 条图集媒体全部下发
    for (const item of thread.media) { // 逐条核对媒体地址
      expect(String(item.url)).not.toBe(''); // 加入后 url 必须非空
    }
    expect(thread.body.length).toBeGreaterThan(10); // 正文随板块准入一并解锁
  });

  it('免费板块帖：匿名媒体仍可见，不退化锁定', async () => {
    const detail = await request(app).get(`/api/v1/community/threads/${FREE_THREAD}`); // 匿名请求免费板块图集帖
    expect(detail.status).toBe(200); // 免费板块匿名可读
    const thread = detail.body.thread; // 常量 thread：保存详情响应体
    expect(thread.board_locked).toBe(false); // 免费板块不应被误锁
    expect(thread.locked).toBe(false); // 综合锁定标记为假
    expect(thread.media.length).toBeGreaterThan(0); // 图集媒体仍在
    for (const item of thread.media) { // 逐条核对媒体地址
      expect(String(item.url)).not.toBe(''); // 免费媒体不得被清空地址
    }
  });
});
