/** 契约测试：社区论坛 / 付费阅读 / VIP / 钱包积分 / 独立商城 / 优惠码 / 推广分成 */

import { randomUUID } from 'node:crypto'; // 引入依赖、类型或本地模块绑定
import { beforeEach, describe, expect, it } from 'vitest'; // 引入依赖、类型或本地模块绑定
import request from 'supertest'; // 引入：声明测试所需依赖
import type { Express } from 'express'; // 引入：声明测试所需依赖
import { createApp } from '../src/app.js'; // 引入依赖、类型或本地模块绑定
import { createDatabase, seedCommunity } from '../src/db.js'; // 引入依赖、类型或本地模块绑定
import { loginHeaders } from './_auth-helper.js'; // 注册 + 口令登录辅助（SEC-01）

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 构造：准备本用例需要的输入、句柄或期望值
let app: Express; // 状态：保存跨步骤复用的值

beforeEach(() => { // 调用 beforeEach 并处理其返回结果
  app = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: {} }); // 赋值：更新变量 app 的取值
}); // 代码块结束

async function login(identifier = '13800000001'): Promise<Record<string, string>> { // 函数 login：封装一段可复用的处理逻辑
  return loginHeaders(app, identifier); // 注册真实账号后走口令登录
} // 代码块结束

function writeHeaders(auth: Record<string, string>): Record<string, string> { // 函数 writeHeaders：封装一段可复用的处理逻辑
  return { ...auth, 'idempotency-key': randomUUID() }; // 返回：交回本步骤结果供断言使用
} // 代码块结束

describe('社区与变现', () => { // 调用 describe 并处理其返回结果
  it('匿名可读社区公开接口，写操作仍 401', async () => { // 调用 it 并处理其返回结果
    const guarded = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_FORCE_LOGIN: '1' } }); // 显式开启门禁
    const overview = await request(guarded).get('/api/v1/community/overview'); // 匿名读社区首页
    expect(overview.status).toBe(200); // 匿名可读
    expect(overview.body.wallet).toMatchObject({ balance_cents: 0, points: 0 }); // 匿名不建钱包行
    const threads = await request(guarded).get('/api/v1/community/threads'); // 匿名读帖子列表
    expect(threads.status).toBe(200); // 匿名可读
    const write = await request(guarded).post('/api/v1/community/threads').send({}); // 同一前缀下的写操作
    expect(write.status).toBe(401); // 写操作仍要求登录
  }); // 代码块结束

  it('板块详情：匿名可读存在板块，不存在返回 404 而非 401（缺陷 D6 回归）', async () => {
    const guarded = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_FORCE_LOGIN: '1' } }); // 显式开启门禁
    const ok = await request(guarded).get('/api/v1/community/boards/guides'); // 命中存在的板块
    expect(ok.status).toBe(200); // 匿名公开读放行
    expect(ok.body.board.slug).toBe('guides'); // 回显板块别名
    const missing = await request(guarded).get('/api/v1/community/boards/does-not-exist'); // 不存在的 slug
    expect(missing.status).toBe(404); // 404 不被鉴权中间件掩盖成 401
  });

  it('热榜对锁帖脱敏封面：未解锁付费帖 cover_url 为空串（缺陷 D5 回归）', async () => {
    const guarded = createApp({ db: createDatabase(':memory:'), jwtSecret: JWT_SECRET, env: { MIM_FORCE_LOGIN: '1' } }); // 匿名访客视角
    const res = await request(guarded).get('/api/v1/community/trending?limit=50'); // 读热榜（拉满候选窗口，确保低热度种子帖也在样本内）
    expect(res.status).toBe(200); // 公开只读
    const paid = res.body.items.find((item: { id: string }) => item.id === 'thread-paid-store'); // 1900 分付费帖
    expect(paid).toBeTruthy(); // 热榜候选内
    expect(paid.locked).toBe(true); // 匿名未解锁
    expect(paid.cover_url).toBe(''); // 封面不随热榜透出
    const free = res.body.items.find((item: { id: string }) => item.id === 'thread-guide-forum'); // 免费指南帖
    expect(free.cover_url).not.toBe(''); // 免费帖封面正常下发
  });

  it('种子数据齐备：7 板块 / 17 帖 / 3 VIP / 3 商品 / 2 优惠码，新用户 100 积分', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const overview = await request(app).get('/api/v1/community/overview').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(overview.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(overview.body.boards).toHaveLength(7); // 使用指南板块 + 原有 6 个板块
    expect(overview.body.stats.threads).toBe(17); // 6 条原有种子 + 11 条指南/示例帖
    expect(overview.body.wallet.points).toBe(100); // 断言：校验响应字段与冻结契约一致
    const plans = await request(app).get('/api/v1/vip/plans').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(plans.body.plans).toHaveLength(3); // 断言：校验响应字段与冻结契约一致
    const products = await request(app).get('/api/v1/shop/products').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(products.body.products).toHaveLength(3); // 断言：校验响应字段与冻结契约一致
    expect(products.body.products.find((p: { code: string }) => p.code === 'pixi-pack').available).toBe(3); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('公告板块旧「全站免登录」文案在再播种后对齐当前强制登录口径', () => { // 存量库校正只针对旧种子原文
    const db = createDatabase(':memory:'); // 独立内存库，避免影响本组共享 app
    db.prepare("UPDATE community_threads SET title = ?, summary = ?, body = ? WHERE id = 'thread-announce'").run( // 还原线上旧公告帖
      '2026-11-12 更新：全站免登录 + 商城商品视觉上线', // 旧标题
      '门禁解除、商品封面与参数详情图、访客交易链路。', // 旧摘要
      '本轮更新：\n1. 全站移除“此功能需登录后使用”，访客会话自动建立。', // 旧正文：校正按标题+摘要命中，正文片段足够
    );
    seedCommunity(db); // 模拟服务重启再播种
    const row = db.prepare("SELECT title, summary, body FROM community_threads WHERE id = 'thread-announce'").get() as { title: string; summary: string; body: string }; // 读回公告帖
    expect(row.title).not.toContain('免登录'); // 标题不再宣称免登录
    expect(row.summary).not.toContain('访客'); // 摘要不再描述访客交易
    expect(row.body).not.toContain('访客'); // 正文同步校正
  }); // 代码块结束

  it('运营改过的公告帖不会被种子校正覆盖', () => { // 只有旧标题 + 旧摘要同时命中才替换
    const db = createDatabase(':memory:'); // 独立内存库
    db.prepare("UPDATE community_threads SET title = ?, summary = ? WHERE id = 'thread-announce'").run('运营自定义公告', '运营自定义摘要'); // 模拟运营改名
    seedCommunity(db); // 再播种
    const row = db.prepare("SELECT title, summary FROM community_threads WHERE id = 'thread-announce'").get() as { title: string; summary: string }; // 读回
    expect(row.title).toBe('运营自定义公告'); // 标题保持运营版本
    expect(row.summary).toBe('运营自定义摘要'); // 摘要保持运营版本
  }); // 代码块结束

  it('付费帖未解锁隐藏正文；充值卡兑换后可解锁并读到正文，余额正确扣减', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const before = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(before.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(before.body.unlocked).toBe(false); // 断言：校验响应字段与冻结契约一致
    expect(before.body.thread.body).toBe(''); // 断言：校验响应字段与冻结契约一致
    expect(before.body.thread.locked).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(before.body.posts).toHaveLength(0); // 断言：校验响应字段与冻结契约一致

    const redeem = await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(redeem.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(redeem.body.amount_cents).toBe(10000); // 断言：校验响应字段与冻结契约一致

    const unlock = await request(app).post('/api/v1/community/threads/thread-paid-store/unlock').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(unlock.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(unlock.body.charged_cents).toBe(1900); // 断言：校验响应字段与冻结契约一致

    const after = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(after.body.unlocked).toBe(true); // 断言：校验响应字段与冻结契约一致
    expect(after.body.thread.body.length).toBeGreaterThan(10); // 断言：校验响应字段与冻结契约一致

    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(8100); // 断言：校验响应字段与冻结契约一致
    expect(wallet.body.transactions[0].note).toBe('解锁付费帖'); // 最近一条为消费
  }); // 代码块结束

  it('回复与点赞写回计数；未解锁的付费帖回复被 403 拒绝', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const forbidden = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/community/threads/thread-paid-store/reply') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(auth)) // 执行当前业务步骤
      .send({ content: '还没买就想回复' }); // 执行当前业务步骤
    expect(forbidden.status).toBe(403); // 断言：校验响应字段与冻结契约一致

    const reply = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/community/threads/thread-store-visual/reply') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(auth)) // 执行当前业务步骤
      .send({ content: '封面复用策略很实用。' }); // 执行当前业务步骤
    expect(reply.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const detail = await request(app).get('/api/v1/community/threads/thread-store-visual').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(detail.body.posts).toHaveLength(1); // 断言：校验响应字段与冻结契约一致
    expect(detail.body.thread.reply_count).toBe(1); // 断言：校验响应字段与冻结契约一致

    const like = await request(app).post('/api/v1/community/threads/thread-store-visual/like').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(like.body.liked).toBe(true); // 断言：校验响应字段与冻结契约一致
    const unlike = await request(app).post('/api/v1/community/threads/thread-store-visual/like').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(unlike.body.liked).toBe(false); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('VIP 开通扣余额并直接解锁付费帖', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-500' }); // 执行：等待接口或数据库操作返回
    const subscribe = await request(app).post('/api/v1/vip/subscribe').set(writeHeaders(auth)).send({ code: 'vip-yearly' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(subscribe.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(subscribe.body.level).toBe(2); // 断言：校验响应字段与冻结契约一致

    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(20200); // 断言：校验响应字段与冻结契约一致
    expect(wallet.body.vip_level).toBe(2); // 断言：校验响应字段与冻结契约一致

    const unlock = await request(app).post('/api/v1/community/threads/thread-paid-store/unlock').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(unlock.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(unlock.body.via).toBe('vip'); // 断言：校验响应字段与冻结契约一致
    const detail = await request(app).get('/api/v1/community/threads/thread-paid-store').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(detail.body.unlocked).toBe(true); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('实物订单：优惠码立减、地址必填、确认收货；自动发卡订单返回真实卡密并可退款', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(auth)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回

    const missingShipping = await request(app).post('/api/v1/shop/orders').set(writeHeaders(auth)).send({ product_code: 'mim-keycap' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(missingShipping.status).toBe(400); // 断言：校验响应字段与冻结契约一致

    const physical = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/shop/orders') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(auth)) // 执行当前业务步骤
      .send({ // 执行当前业务步骤
        product_code: 'mim-keycap', // 对象字段 product_code：记录一项配置或数据
        coupon_code: 'MIM10', // 对象字段 coupon_code：记录一项配置或数据
        shipping: { name: '张三', phone: '13800000001', address: '浙江省宁波市测试路 1 号' }, // 对象字段 shipping：记录一项配置或数据
      }); // 代码块结束
    expect(physical.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    expect(physical.body.discount_cents).toBe(1000); // 断言：校验响应字段与冻结契约一致
    expect(physical.body.payable_cents).toBe(5900); // 断言：校验响应字段与冻结契约一致

    const orders = await request(app).get('/api/v1/shop/orders').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(orders.body.items[0].status).toBe('paid'); // 断言：校验响应字段与冻结契约一致
    expect(orders.body.items[0].coupon_code).toBe('MIM10'); // 断言：校验响应字段与冻结契约一致

    const confirm = await request(app).post(`/api/v1/shop/orders/${physical.body.order_id}/confirm`).set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(confirm.status).toBe(200); // 断言：校验响应字段与冻结契约一致

    const auto = await request(app).post('/api/v1/shop/orders').set(writeHeaders(auth)).send({ product_code: 'pixi-pack' }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(auto.status).toBe(201); // 断言：校验响应字段与冻结契约一致
    const autoOrder = (await request(app).get('/api/v1/shop/orders').set(auth)).body.items.find((o: { delivery_kind: string }) => o.delivery_kind === 'virtual_auto'); // 构造：准备本用例需要的输入、句柄或期望值
    expect(autoOrder.status).toBe('delivered'); // 断言：校验响应字段与冻结契约一致
    expect(autoOrder.delivered_content).toMatch(/^PIXI-MIM-\d{2}-2026$/); // 断言：校验响应字段与冻结契约一致

    const refund = await request(app).post(`/api/v1/shop/orders/${autoOrder.id}/refund`).set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(refund.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const wallet = await request(app).get('/api/v1/wallet').set(auth); // 构造：准备本用例需要的输入、句柄或期望值
    expect(wallet.body.wallet.balance_cents).toBe(4100); // 10000 - 5900 实物 + 1900 自动发卡退款
  }); // 代码块结束

  it('优惠码门槛与重复签到冲突都被明确拒绝', async () => { // 调用 it 并处理其返回结果
    const auth = await login(); // 构造：准备本用例需要的输入、句柄或期望值
    const coupon = await request(app).post('/api/v1/coupons/validate').set(writeHeaders(auth)).send({ code: 'MIM10', amount_cents: 1900 }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(coupon.status).toBe(400); // 断言：校验响应字段与冻结契约一致
    expect(coupon.body.details.reason).toBe('COUPON_MIN_AMOUNT'); // 断言：校验响应字段与冻结契约一致

    const first = await request(app).post('/api/v1/wallet/checkin').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(first.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    const again = await request(app).post('/api/v1/wallet/checkin').set(writeHeaders(auth)).send({}); // 构造：准备本用例需要的输入、句柄或期望值
    expect(again.status).toBe(409); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束

  it('推广绑定：邀请人获得被邀请人首单 5% 佣金', async () => { // 调用 it 并处理其返回结果
    const a = await login('13800000001'); // 构造：准备本用例需要的输入、句柄或期望值
    const b = await login('13800000002'); // 构造：准备本用例需要的输入、句柄或期望值
    const invite = await request(app).get('/api/v1/referral').set(b); // 构造：准备本用例需要的输入、句柄或期望值
    expect(invite.status).toBe(200); // 断言：校验响应字段与冻结契约一致
    expect(invite.body.code).toMatch(/^MIM/); // 断言：校验响应字段与冻结契约一致

    const bind = await request(app).post('/api/v1/referral/bind').set(writeHeaders(a)).send({ code: invite.body.code }); // 构造：准备本用例需要的输入、句柄或期望值
    expect(bind.status).toBe(200); // 断言：校验响应字段与冻结契约一致

    await request(app).post('/api/v1/wallet/redeem').set(writeHeaders(a)).send({ code: 'MIM-DEMO-100' }); // 执行：等待接口或数据库操作返回
    const order = await request(app) // 构造：准备本用例需要的输入、句柄或期望值
      .post('/api/v1/shop/orders') // 注册 POST 路由 / 中间件处理器
      .set(writeHeaders(a)) // 执行当前业务步骤
      .send({ // 执行当前业务步骤
        product_code: 'mim-keycap', // 对象字段 product_code：记录一项配置或数据
        coupon_code: 'MIM10', // 对象字段 coupon_code：记录一项配置或数据
        shipping: { name: '李四', phone: '13800000001', address: '浙江省宁波市测试路 2 号' }, // 对象字段 shipping：记录一项配置或数据
      }); // 代码块结束
    expect(order.status).toBe(201); // 断言：校验响应字段与冻结契约一致

    const walletB = await request(app).get('/api/v1/wallet').set(b); // 构造：准备本用例需要的输入、句柄或期望值
    expect(walletB.body.wallet.balance_cents).toBe(295); // 5900 * 5%
    const referralB = await request(app).get('/api/v1/referral').set(b); // 构造：准备本用例需要的输入、句柄或期望值
    expect(referralB.body.invited.count).toBe(1); // 断言：校验响应字段与冻结契约一致
    expect(referralB.body.commission_cents).toBe(295); // 断言：校验响应字段与冻结契约一致
  }); // 代码块结束
}); // 代码块结束
