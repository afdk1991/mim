/** 用户侧售后：仅订单本人、仅已支付订单、同类型不可重复提交；后台审批后用户可见处理结果 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排：每例重建内存库
import request from 'supertest'; // 进程内驱动 Express
import type { Express } from 'express'; // 应用类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import { registerTestAccount } from './_auth-helper.js'; // 自助注册建独立账号

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 固定测试密钥
const ADMIN_TOKEN = 'test-admin-token'; // 运营引导令牌

let app: Express; // 待测应用
let db: ReturnType<typeof createDatabase>; // 同生命周期数据库

beforeEach(() => { // 每例重建，避免用例间数据互相污染
  db = createDatabase(':memory:'); // 内存库
  app = createApp({ db, jwtSecret: JWT_SECRET, env: { MIM_ADMIN_TOKEN: ADMIN_TOKEN } }); // 装配应用
});

let userSeq = 0; // 账号序号：保证手机号唯一

/** 建一个独立正式账号 */
async function newUser() {
  const identifier = `137${String(10_000_000 + (userSeq += 1))}`; // 11 位手机号
  return registerTestAccount(app, identifier); // 返回令牌与用户 id
}

/** 直接落一条商城订单：绕过支付通道，只保留状态与金额这两个本用例关心的事实 */
function seedOrder(id: string, userId: string, status: string): string {
  const product = db.prepare('SELECT id, price_cents FROM shop_products LIMIT 1').get() as { id: string; price_cents: number }; // 取种子商品
  db.prepare(
    `INSERT INTO shop_orders (id, user_id, product_id, quantity, amount_cents, discount_cents, payable_cents, status, created_at, paid_at)
     VALUES (?, ?, ?, 1, ?, 0, ?, ?, '2026-11-15T00:00:00.000Z', ?)`,
  ).run(id, userId, product.id, product.price_cents, product.price_cents, status, status === 'pending' ? null : '2026-11-15T00:00:30.000Z'); // 写入订单
  return id; // 回传订单主键
}

/** 售后申请请求头：登录态 + 幂等键 */
function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'idempotency-key': `as-${Math.random().toString(36).slice(2)}` }; // 每次随机键，避免用例间回放
}

describe('用户侧售后申请', () => {
  it('匿名访问查询与提交都被 401 拦下，证明路由已挂载', async () => {
    const list = await request(app).get('/api/v1/after-sales'); // 匿名查我的售后
    expect(list.status).toBe(401); // 登录态接口
    const submit = await request(app).post('/api/v1/shop/orders/so-x/after-sales').send({ kind: 'refund_only', reason: '质量问题' }); // 匿名提交
    expect(submit.status).toBe(401); // 未登录直接拒绝
  });

  it('本人已支付订单可提交；同类型重复提交 409，换类型可再提交', async () => {
    const { token, userId } = await newUser(); // 订单本人
    const orderId = seedOrder('so-as-1', userId, 'paid'); // 已支付订单
    const first = await request(app).post(`/api/v1/shop/orders/${orderId}/after-sales`).set(authHeaders(token)).send({ kind: 'refund_only', reason: '质量问题', detail: '外包装破损', evidence: '已拍照，可联系客服提供' }); // 首次申请
    expect(first.status).toBe(201); // 创建成功
    expect(first.body.status).toBe('pending'); // 初始状态与后台待处理对齐
    const duplicated = await request(app).post(`/api/v1/shop/orders/${orderId}/after-sales`).set(authHeaders(token)).send({ kind: 'refund_only', reason: '质量问题' }); // 同类型重复
    expect(duplicated.status).toBe(409); // 拒绝重复提交
    expect(duplicated.body.code).toBe('CONFLICT'); // 统一错误码
    const another = await request(app).post(`/api/v1/shop/orders/${orderId}/after-sales`).set(authHeaders(token)).send({ kind: 'repair', reason: '其他', detail: '需要维修' }); // 换一种类型
    expect(another.status).toBe(201); // 不同类型可以再提交
    const list = await request(app).get('/api/v1/after-sales').set('Authorization', `Bearer ${token}`); // 我的售后
    expect(list.status).toBe(200); // 登录后可读
    expect(list.body.items).toHaveLength(2); // 两条申请都在
    expect(list.body.items[0].product_name).toBeTruthy(); // 联表带出商品名
    expect(list.body.items[0].reason).toContain('说明：'); // 说明合并入 reason 落库
  });

  it('他人订单按 404 处理；未支付订单 409；非法类型 400', async () => {
    const owner = await newUser(); // 订单本人
    const other = await newUser(); // 另一位用户
    const orderId = seedOrder('so-as-2', owner.userId, 'paid'); // 本人已支付订单
    const foreign = await request(app).post(`/api/v1/shop/orders/${orderId}/after-sales`).set(authHeaders(other.token)).send({ kind: 'refund_only', reason: '质量问题' }); // 他人尝试提交
    expect(foreign.status).toBe(404); // 不泄露他人订单存在性
    const unpaidId = seedOrder('so-as-3', owner.userId, 'pending'); // 待支付订单
    const unpaid = await request(app).post(`/api/v1/shop/orders/${unpaidId}/after-sales`).set(authHeaders(owner.token)).send({ kind: 'refund_only', reason: '质量问题' }); // 未支付提交
    expect(unpaid.status).toBe(409); // 只允许已支付订单
    const badKind = await request(app).post(`/api/v1/shop/orders/${orderId}/after-sales`).set(authHeaders(owner.token)).send({ kind: 'bogus', reason: '质量问题' }); // 非法售后类型
    expect(badKind.status).toBe(400); // 校验拦截
    expect(badKind.body.code).toBe('VALIDATION_FAILED'); // 统一校验错误信封
  });

  it('后台审批通过后，用户在「我的售后」看到 approved 与处理结果', async () => {
    const { token, userId } = await newUser(); // 订单本人
    const orderId = seedOrder('so-as-4', userId, 'paid'); // 已支付订单
    const created = await request(app).post(`/api/v1/shop/orders/${orderId}/after-sales`).set(authHeaders(token)).send({ kind: 'refund_only', reason: '质量问题', detail: '无法使用' }); // 提交申请
    expect(created.status).toBe(201); // 创建成功
    const pendingList = await request(app).get('/api/v1/admin/after-sales').set({ 'x-admin-token': ADMIN_TOKEN }); // 后台待处理列表
    expect(pendingList.status).toBe(200); // 后台可读
    expect(pendingList.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true); // 后台真能看到用户提交的申请
    const handled = await request(app).post(`/api/v1/admin/after-sales/${created.body.id}/handle`).set({ 'x-admin-token': ADMIN_TOKEN }).send({ action: 'approve', note: '核实属实，已退款' }); // 后台同意
    expect(handled.status).toBe(200); // 处理成功
    expect(handled.body.status).toBe('approved'); // 状态流转到已通过
    const mine = await request(app).get('/api/v1/after-sales').set('Authorization', `Bearer ${token}`); // 用户侧回读
    expect(mine.body.items[0].status).toBe('approved'); // 用户看到已通过
    expect(mine.body.items[0].admin_note).toBe('核实属实，已退款'); // 处理结果可见
    expect(mine.body.items[0].handled_at).toBeTruthy(); // 处理时间已落库
    const refunded = db.prepare('SELECT status FROM shop_orders WHERE id = ?').get(orderId) as { status: string }; // 订单状态
    expect(refunded.status).toBe('refunded'); // 审批通过后订单同步置退款
  });
});
