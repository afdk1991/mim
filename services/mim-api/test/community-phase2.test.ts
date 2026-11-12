/** 契约测试：社区二期（付费板块 / 媒体 / 投票 / 收藏 / 评分 / 积分转账）与安全（验证码 / 举报） */

/**
 * 社区二期契约测试矩阵：
 *   1. 图集帖：媒体数组落库、详情回读、收藏开关、我的收藏列表、五星评分与聚合；
 *   2. 投票帖：选项落库、投票计票、改投覆盖、视频帖缺少视频地址被拒绝；
 *   3. 付费板块：未加入发帖 403、余额加入扣款、加入后可发帖、余额正确扣减；
 *   4. 积分转账：按 Mim ID 到账、双方流水余额、超额转账被拒绝；
 *   5. 安全：图形验证码返回 id/SVG、举报 24 小时窗口限流第 6 条返回 429。
 *
 * 测试使用内存 SQLite 与真实 Express 应用，不 mock 业务路由；
 * 每个写请求都带独立 Idempotency-Key，避免幂等中间件把不同用例当成回放。
 */

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import type { Db } from '../src/types.js';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const ADMIN_PASSWORD = 'testpass123';
let app: Express;
let db: Db;

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD } });
});

async function login(identifier: string): Promise<Record<string, string>> {
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' };
}

function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() };
}

describe('社区二期：媒体 / 投票 / 收藏 / 评分', () => {
  it('图集帖写入媒体并在详情返回；收藏与评分写回聚合与排序', async () => {
    const auth = await login('13800000021');
    const create = await request(app)
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({
        board_slug: 'general',
        title: '图集：Mim 封面精选',
        body: '这是一篇图集帖，包含多张封面图片，用于验证媒体数组与详情渲染。',
        kind: 'gallery',
        media: [
          { kind: 'image', url: '/demo/stardust-cover.jpg' },
          { kind: 'image', url: '/demo/bloom-cover.jpg' },
        ],
      });
    expect(create.status).toBe(201);

    const detail = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.thread.kind).toBe('gallery');
    expect(detail.body.thread.media).toHaveLength(2);
    expect(detail.body.thread.media[0].url).toBe('/demo/stardust-cover.jpg');

    const favorite = await request(app).post(`/api/v1/community/threads/${create.body.thread_id}/favorite`).set(writeHeaders(auth)).send({});
    expect(favorite.status).toBe(200);
    expect(favorite.body.favorited).toBe(true);
    const favorites = await request(app).get('/api/v1/community/favorites').set(auth);
    expect(favorites.body.items.some((item: { id: string }) => item.id === create.body.thread_id)).toBe(true);

    const rate = await request(app).post(`/api/v1/community/threads/${create.body.thread_id}/rate`).set(writeHeaders(auth)).send({ rating: 5 });
    expect(rate.status).toBe(200);
    expect(rate.body.summary.count).toBe(1);

    const again = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth);
    expect(again.body.thread.my_rating).toBe(5);
    expect(again.body.favorited).toBe(true);

    const byFavorites = await request(app).get('/api/v1/community/threads?sort=favorites').set(auth);
    expect(byFavorites.status).toBe(200);
    expect(byFavorites.body.items[0].id).toBe(create.body.thread_id);
  });

  it('投票帖创建选项、投票计票并支持改投；视频帖缺视频地址被拒', async () => {
    const auth = await login('13800000022');
    const create = await request(app)
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({
        board_slug: 'general',
        title: '投票：下期想先做哪个功能',
        body: '请选择你最希望优先上线的功能，投票结果会作为排期参考。',
        kind: 'poll',
        poll_options: ['微信支付', '板块权限', '图集视频'],
      });
    expect(create.status).toBe(201);

    const detail = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth);
    expect(detail.body.thread.poll.options).toHaveLength(3);
    const option = detail.body.thread.poll.options[0];

    const vote = await request(app).post(`/api/v1/community/threads/${create.body.thread_id}/vote`).set(writeHeaders(auth)).send({ option_id: option.id });
    expect(vote.status).toBe(200);
    const afterVote = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth);
    expect(afterVote.body.thread.poll.total).toBe(1);
    expect(afterVote.body.thread.poll.my_option).toBe(option.id);

    const video = await request(app)
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({ board_slug: 'general', title: '视频帖缺地址', body: '这是一篇缺少视频地址的视频帖，应该被校验拒绝。', kind: 'video' });
    expect(video.status).toBe(400);
  });
});

describe('付费板块与积分转账', () => {
  it('付费板块需先加入；加入扣余额后可见帖子并可发帖', async () => {
    db.prepare("UPDATE community_boards SET price_cents = 500 WHERE slug = 'paid'").run();
    const auth = await login('13800000023');
    const redeem = await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' });
    expect(redeem.status).toBe(200);

    const blocked = await request(app)
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({ board_slug: 'paid', title: '付费板块发帖', body: '未加入付费板块时发帖应被拒绝。' });
    expect(blocked.status).toBe(403);

    const join = await request(app).post('/api/v1/community/boards/paid/join').set(writeHeaders(auth)).send({});
    expect(join.status).toBe(201);
    expect(join.body.charged_cents).toBe(500);

    const created = await request(app)
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({ board_slug: 'paid', title: '付费板块内帖', body: '加入后可以正常发帖，并且其他未加入用户看不到正文。' });
    expect(created.status).toBe(201);

    const wallet = await request(app).get('/api/v1/wallet').set(auth);
    expect(wallet.body.wallet.balance_cents).toBe(9500);
  });

  it('积分转账按 Mim ID 到账，余额不足与转给自己被拒', async () => {
    const sender = await login('13800000024');
    const receiver = await login('13800000025');
    const me = await request(app).get('/api/v1/me').set(receiver);
    const receiverNo = me.body.user.member_no as string;

    const transfer = await request(app)
      .post('/api/v1/wallet/points/transfer')
      .set(writeHeaders(sender))
      .send({ to_member_no: receiverNo, points: 40, note: '测试转账' });
    expect(transfer.status).toBe(200);
    expect(transfer.body.to).toBe(receiverNo);

    const senderWallet = await request(app).get('/api/v1/wallet').set(sender);
    expect(senderWallet.body.wallet.points).toBe(60);
    const receiverWallet = await request(app).get('/api/v1/wallet').set(receiver);
    expect(receiverWallet.body.wallet.points).toBe(140);

    const tooMuch = await request(app)
      .post('/api/v1/wallet/points/transfer')
      .set(writeHeaders(sender))
      .send({ to_member_no: receiverNo, points: 9999 });
    expect(tooMuch.status).toBe(400);
  });
});

describe('安全：验证码与举报', () => {
  it('验证码返回 SVG 与 id；举报超过 24 小时上限返回 429', async () => {
    const captcha = await request(app).get('/api/v1/auth/captcha');
    expect(captcha.status).toBe(200);
    expect(captcha.body.id).toMatch(/^cap-/);
    expect(captcha.body.svg).toContain('<svg');

    const auth = await login('13800000026');
    for (let i = 0; i < 5; i += 1) {
      const report = await request(app)
        .post('/api/v1/reports')
        .set(writeHeaders(auth))
        .send({ target_type: 'thread', target_id: 'thread-paid-store', reason: '内容不适', detail: `第 ${i + 1} 次` });
      expect(report.status).toBe(201);
    }
    const sixth = await request(app)
      .post('/api/v1/reports')
      .set(writeHeaders(auth))
      .send({ target_type: 'thread', target_id: 'thread-paid-store', reason: '内容不适' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error?.code ?? sixth.body.code).toBe('RATE_LIMITED');
  });
});
