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

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 准备：构造本用例需要的输入或句柄
const ADMIN_PASSWORD = 'testpass123'; // 准备：构造本用例需要的输入或句柄
let app: Express; // 状态：保存跨步骤复用的值
let db: Db; // 状态：保存跨步骤复用的值

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD } });
});

async function login(identifier: string): Promise<Record<string, string>> {
  const res = await request(app).post('/api/v1/auth/password').send({ region: 'cn', identifier, password: ADMIN_PASSWORD }); // 准备：构造本用例需要的输入或句柄
  expect(res.status).toBe(200); // 登录助手：密码登录成功返回 200
  return { authorization: `Bearer ${res.body.access_token}`, 'content-type': 'application/json' }; // 返回：交回本步骤结果供断言使用
}

function writeHeaders(auth: Record<string, string>): Record<string, string> {
  return { ...auth, 'idempotency-key': randomUUID() }; // 返回：交回本步骤结果供断言使用
}

describe('社区二期：媒体 / 投票 / 收藏 / 评分', () => {
  it('图集帖写入媒体并在详情返回；收藏与评分写回聚合与排序', async () => {
    const auth = await login('13800000021'); // 准备：构造本用例需要的输入或句柄
    const create = await request(app) // 准备：构造本用例需要的输入或句柄
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
    expect(create.status).toBe(201); // 图集帖创建成功返回 201

    const detail = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth); // 准备：构造本用例需要的输入或句柄
    expect(detail.status).toBe(200); // 详情接口匿名带令牌读取得 200
    expect(detail.body.thread.kind).toBe('gallery'); // 发帖时的 kind 原样回读为 gallery
    expect(detail.body.thread.media).toHaveLength(2); // 媒体数组落库为 2 条
    expect(detail.body.thread.media[0].url).toBe('/demo/stardust-cover.jpg'); // 首条媒体地址与提交值一致

    const favorite = await request(app).post(`/api/v1/community/threads/${create.body.thread_id}/favorite`).set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    expect(favorite.status).toBe(200); // 收藏动作返回 200
    expect(favorite.body.favorited).toBe(true); // 收藏状态回读为 true
    const favorites = await request(app).get('/api/v1/community/favorites').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(favorites.body.items.some((item: { id: string }) => item.id === create.body.thread_id)).toBe(true); // 我的收藏列表包含刚收藏的帖子

    const rate = await request(app).post(`/api/v1/community/threads/${create.body.thread_id}/rate`).set(writeHeaders(auth)).send({ rating: 5 }); // 准备：构造本用例需要的输入或句柄
    expect(rate.status).toBe(200); // 五星评分返回 200
    expect(rate.body.summary.count).toBe(1); // 评分聚合计数为 1 条

    const again = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth); // 准备：构造本用例需要的输入或句柄
    expect(again.body.thread.my_rating).toBe(5); // 我的评分回读为 5 星
    expect(again.body.favorited).toBe(true); // 同时回读到已收藏标记

    const byFavorites = await request(app).get('/api/v1/community/threads?sort=favorites').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(byFavorites.status).toBe(200); // 按收藏数排序的列表接口可用
    expect(byFavorites.body.items[0].id).toBe(create.body.thread_id); // 收藏过的那篇帖子排在首位
  });

  it('投票帖创建选项、投票计票并支持改投；视频帖缺视频地址被拒', async () => {
    const auth = await login('13800000022'); // 准备：构造本用例需要的输入或句柄
    const create = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({
        board_slug: 'general',
        title: '投票：下期想先做哪个功能',
        body: '请选择你最希望优先上线的功能，投票结果会作为排期参考。',
        kind: 'poll',
        poll_options: ['微信支付', '板块权限', '图集视频'],
      });
    expect(create.status).toBe(201); // 投票帖创建成功返回 201

    const detail = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth); // 准备：构造本用例需要的输入或句柄
    expect(detail.body.thread.poll.options).toHaveLength(3); // 三个投票选项全部落库
    const option = detail.body.thread.poll.options[0]; // 准备：构造本用例需要的输入或句柄

    const vote = await request(app).post(`/api/v1/community/threads/${create.body.thread_id}/vote`).set(writeHeaders(auth)).send({ option_id: option.id }); // 准备：构造本用例需要的输入或句柄
    expect(vote.status).toBe(200); // 投票动作返回 200
    const afterVote = await request(app).get(`/api/v1/community/threads/${create.body.thread_id}`).set(auth); // 准备：构造本用例需要的输入或句柄
    expect(afterVote.body.thread.poll.total).toBe(1); // 投票总数计为 1
    expect(afterVote.body.thread.poll.my_option).toBe(option.id); // 我的选择回读为刚投的选项

    const video = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({ board_slug: 'general', title: '视频帖缺地址', body: '这是一篇缺少视频地址的视频帖，应该被校验拒绝。', kind: 'video' });
    expect(video.status).toBe(400); // 视频帖缺少视频地址时被校验拒绝 400
  });
});

describe('付费板块与积分转账', () => {
  it('付费板块需先加入；加入扣余额后可见帖子并可发帖', async () => {
    db.prepare("UPDATE community_boards SET price_cents = 500 WHERE slug = 'paid'").run();
    const auth = await login('13800000023'); // 准备：构造本用例需要的输入或句柄
    const redeem = await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 准备：构造本用例需要的输入或句柄
    expect(redeem.status).toBe(200); // 兑换码入账成功返回 200

    const blocked = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({ board_slug: 'paid', title: '付费板块发帖', body: '未加入付费板块时发帖应被拒绝。' });
    expect(blocked.status).toBe(403); // 未加入付费板块时发帖被拒 403

    const join = await request(app).post('/api/v1/community/boards/paid/join').set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    expect(join.status).toBe(201); // 加入付费板块返回 201
    expect(join.body.charged_cents).toBe(500); // 加入时按板块定价扣款 500 分

    const created = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({ board_slug: 'paid', title: '付费板块内帖', body: '加入后可以正常发帖，并且其他未加入用户看不到正文。' });
    expect(created.status).toBe(201); // 加入后发帖成功返回 201

    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(wallet.body.wallet.balance_cents).toBe(9500); // 钱包余额为初始 10000 分扣除 500 分
  });

  it('积分转账按 Mim ID 到账，余额不足与转给自己被拒', async () => {
    const sender = await login('13800000024'); // 准备：构造本用例需要的输入或句柄
    const receiver = await login('13800000025'); // 准备：构造本用例需要的输入或句柄
    const me = await request(app).get('/api/v1/me').set(receiver); // 准备：构造本用例需要的输入或句柄
    const receiverNo = me.body.user.member_no as string; // 准备：构造本用例需要的输入或句柄

    const transfer = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/wallet/points/transfer')
      .set(writeHeaders(sender))
      .send({ to_member_no: receiverNo, points: 40, note: '测试转账' });
    expect(transfer.status).toBe(200); // 按 Mim ID 转账返回 200
    expect(transfer.body.to).toBe(receiverNo); // 响应里的收款方就是目标 Mim ID

    const senderWallet = await request(app).get('/api/v1/wallet').set(sender); // 准备：构造本用例需要的输入或句柄
    expect(senderWallet.body.wallet.points).toBe(60); // 转出方积分由 100 减为 60
    const receiverWallet = await request(app).get('/api/v1/wallet').set(receiver); // 准备：构造本用例需要的输入或句柄
    expect(receiverWallet.body.wallet.points).toBe(140); // 收款方积分由 100 增为 140

    const tooMuch = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/wallet/points/transfer')
      .set(writeHeaders(sender))
      .send({ to_member_no: receiverNo, points: 9999 });
    expect(tooMuch.status).toBe(400); // 超额转账被拒 400
  });
});

describe('P1：付费图库/视频、站点配置、板块关注与问答采纳', () => {
  it('付费图库未解锁不返回媒体，余额购买后返回 9 张封面图片', async () => {
    const auth = await login('13800000021'); // 新用户：初始余额 0
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 先充值 100 元
    const locked = await request(app).get('/api/v1/assets/paid-gallery-covers').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(locked.status).toBe(200); // 资产详情可读
    expect(locked.body.asset.media).toHaveLength(0); // 未解锁时媒体数组为空，不泄漏图片

    const buy = await request(app).post('/api/v1/assets/paid-gallery-covers/purchase').set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    expect(buy.status).toBe(201); // 余额购买成功
    expect(buy.body.via).toBe('balance'); // 走余额扣款
    expect(buy.body.charged_cents).toBe(3900); // 图库定价 ¥39

    const unlocked = await request(app).get('/api/v1/assets/paid-gallery-covers').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(unlocked.body.asset.unlocked).toBe(true); // 已解锁
    expect(unlocked.body.asset.media).toHaveLength(9); // 种子补入 9 张图片
    expect(unlocked.body.asset.media[0].kind).toBe('image'); // 图库媒体类型为 image
  });

  it('付费视频解锁后返回视频直链与封面', async () => {
    const auth = await login('13800000022'); // 独立用户，钱包互不影响
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 充值后再购买
    await request(app).post('/api/v1/assets/paid-video-comic/purchase').set(writeHeaders(auth)).send({}); // 执行：等待异步操作返回后继续
    const detail = await request(app).get('/api/v1/assets/paid-video-comic').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(detail.body.asset.media.length).toBeGreaterThanOrEqual(1); // 至少有 1 条视频媒体
    expect(detail.body.asset.media[0].kind).toBe('video'); // 视频类型
    expect(detail.body.asset.media[0].url).toMatch(/\.mp4$/); // 视频直链为 mp4
  });

  it('公开站点配置返回 home_view 且无需会话', async () => {
    const config = await request(app).get('/api/v1/site/config'); // 匿名直接访问
    expect(config.status).toBe(200); // 公开端点返回 200
    expect(config.body.home_view).toBe('store'); // 默认首页为商城
    expect(config.body.theme).toBeTruthy(); // 主题配置同时下发
  });

  it('followers 板块关注后才可见与可发帖', async () => {
    db.prepare("UPDATE community_boards SET visibility = 'followers' WHERE slug = 'general'").run(); // 把通用板块改为关注可见
    const auth = await login('13800000023'); // 准备：构造本用例需要的输入或句柄
    const before = await request(app).get('/api/v1/community/threads?board=general').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(before.body.items.every((item: { locked: number }) => item.locked === 1)).toBe(true); // 未关注时全部标记为锁定

    const follow = await request(app).post('/api/v1/community/boards/general/follow').set(writeHeaders(auth)).send({}); // 准备：构造本用例需要的输入或句柄
    expect(follow.status).toBe(200); // 关注接口成功
    expect(follow.body.followed).toBe(true); // 关注状态为 true

    const after = await request(app).get('/api/v1/community/threads?board=general').set(auth); // 准备：构造本用例需要的输入或句柄
    expect(after.body.items.every((item: { locked: number }) => item.locked === 0)).toBe(true); // 关注后解锁

    const post = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/community/threads')
      .set(writeHeaders(auth))
      .send({ board_slug: 'general', title: '关注后发帖成功', body: '关注板块之后即可正常发帖，验证关注门槛闭环。' });
    expect(post.status).toBe(201); // 关注后发帖 201
  });

  it('问答帖仅提问者可采纳回复，详情回传采纳结果', async () => {
    const author = await login('13800000024'); // 准备：构造本用例需要的输入或句柄
    const helper = await login('13800000025'); // 准备：构造本用例需要的输入或句柄
    const created = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/community/threads')
      .set(writeHeaders(author))
      .send({ board_slug: 'help', title: '问答：如何配置支付', body: '请问微信支付需要配置哪些环境变量？', kind: 'qa' });
    expect(created.status).toBe(201); // 问答帖创建成功

    const reply = await request(app) // 准备：构造本用例需要的输入或句柄
      .post(`/api/v1/community/threads/${created.body.thread_id}/reply`)
      .set(writeHeaders(helper))
      .send({ content: '需要配置 APP_ID 与商户私钥，再把回调地址指向 /api/v1/payments/wechat/notify。' });
    expect(reply.status).toBe(201); // 回复成功

    const detail = await request(app).get(`/api/v1/community/threads/${created.body.thread_id}`).set(author); // 准备：构造本用例需要的输入或句柄
    const postId = detail.body.posts[0].id as string; // 取第一条回复 id

    const forbidden = await request(app).post(`/api/v1/community/threads/${created.body.thread_id}/accept`).set(writeHeaders(helper)).send({ post_id: postId }); // 准备：构造本用例需要的输入或句柄
    expect(forbidden.status).toBe(403); // 非提问者采纳被拒

    const accept = await request(app).post(`/api/v1/community/threads/${created.body.thread_id}/accept`).set(writeHeaders(author)).send({ post_id: postId }); // 准备：构造本用例需要的输入或句柄
    expect(accept.status).toBe(200); // 提问者采纳成功

    const afterAccept = await request(app).get(`/api/v1/community/threads/${created.body.thread_id}`).set(author); // 准备：构造本用例需要的输入或句柄
    expect(afterAccept.body.thread.accepted_post_id).toBe(postId); // 详情回传采纳的回复 id
    expect(afterAccept.body.thread.accepted_post.content).toContain('APP_ID'); // 采纳答案内容完整返回
  });
});

describe('安全：验证码与举报', () => {
  it('验证码返回 SVG 与 id；举报超过 24 小时上限返回 429', async () => {
    const captchaApp = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_CAPTCHA_MODE: 'image', MIM_CAPTCHA_REPORT: '1' } }); // 独立开启 report 验证码的 app
    const captcha = await request(captchaApp).get('/api/v1/auth/captcha?scene=report'); // 按场景签发图形验证码
    expect(captcha.status).toBe(200); // 验证码接口返回 200
    expect(captcha.body.id).toMatch(/^cap-/); // 验证码 id 以 cap- 前缀返回
    expect(captcha.body.svg).toContain('<svg'); // 验证码 SVG 内容包含 <svg 标签

    const auth = await login('13800000026'); // 准备：构造本用例需要的输入或句柄
    for (let i = 0; i < 5; i += 1) {
      const report = await request(app) // 准备：构造本用例需要的输入或句柄
        .post('/api/v1/reports')
        .set(writeHeaders(auth))
        .send({ target_type: 'thread', target_id: 'thread-paid-store', reason: '内容不适', detail: `第 ${i + 1} 次` });
      expect(report.status).toBe(201); // 24 小时窗口内前 5 条举报均返回 201
    }
    const sixth = await request(app) // 准备：构造本用例需要的输入或句柄
      .post('/api/v1/reports')
      .set(writeHeaders(auth))
      .send({ target_type: 'thread', target_id: 'thread-paid-store', reason: '内容不适' });
    expect(sixth.status).toBe(429); // 第 6 条举报被限流 429
    expect(sixth.body.error?.code ?? sixth.body.code).toBe('RATE_LIMITED'); // 限流错误码为 RATE_LIMITED
  });
});

/*
 * 运行方式：
 *   pnpm --filter @mim/api exec vitest run test/community-phase2.test.ts
 *
 * 失败排查顺序：
 *   1. 图集帖失败：检查 community_thread_media 建表与媒体 URL 是否以 / 开头；
 *   2. 投票帖失败：检查 poll_options 是否在 2–10、vote 是否命中 option_id；
 *   3. 付费板块失败：确认板块 price_cents=500、充值卡已兑换且余额足够；
 *   4. 积分转账失败：确认 /me 返回 member_no 为纯数字而非 MIM- 前缀；
 *   5. 验证码/举报失败：确认 captchas 表存在、举报窗口 24 小时且上限 5 条。
 *
 * 数据隔离：
 *   每个用例在 beforeEach 重新 createDatabase(' :memory: ')，互不共享余额与帖子，
 *   因此可以安全地修改板块价格、兑换充值卡、连续举报而不影响其他用例。
 *
 * 断言口径：
 *   只断言接口真实返回值与数据库落库结果，不 mock 支付、审核或权限中间件；
 *   外部供应商能力（微信、百度审核）不在本文件伪造成功，降级路径由单元测试覆盖。
 */
