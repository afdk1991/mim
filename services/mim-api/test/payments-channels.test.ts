/**
 * 支付渠道全量接入：九渠道矩阵 + 扩展渠道适配器契约测试。
 * supertest 打真实路由 + 内存库；覆盖：签名正确 / 错误、金额不符、订单号校验、回调重放幂等、
 * 未配置降级 503、下单与退款。上游网络用本地 stub HTTP 服务替身，不打真实商户。
 */

import { createServer, type Server } from 'node:http'; // 引入依赖：声明本文件使用的外部能力
import { randomUUID } from 'node:crypto'; // 引入依赖：声明本文件使用的外部能力
import { beforeEach, afterEach, describe, expect, it } from 'vitest'; // 引入依赖：声明本文件使用的外部能力
import express from 'express'; // 引入依赖：声明本文件使用的外部能力
import request from 'supertest'; // 引入依赖：声明本文件使用的外部能力
import type { Express } from 'express'; // 引入依赖：声明本文件使用的外部能力
import { createDatabase } from '../src/db.js'; // 引入依赖：声明本文件使用的外部能力
import { createPaymentChannelRouter } from '../src/payments/router.js'; // 引入依赖：声明本文件使用的外部能力
import { requestId, errorHandler, notFound } from '../src/middleware.js'; // 引入依赖：声明本文件使用的外部能力
import { issueAccessToken } from '../src/auth.js'; // 引入依赖：声明本文件使用的外部能力
import type { ApiDeps } from '../src/types.js'; // 引入依赖：声明本文件使用的外部能力
import type { ExtChannelId, ExtIntentRow } from '../src/payments/types.js'; // 引入依赖：声明本文件使用的外部能力
import { canonicalSorted, hmacSha256Hex, md5Hex } from '../src/payments/util.js'; // 引入依赖：声明本文件使用的外部能力

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // 与既有测试同一固定密钥
const ADMIN_TOKEN = 'test-admin-token'; // 保存 ADMIN_TOKEN：承载本步骤的计算结果供后续使用

const HP_ENV = { // 保存 HP_ENV：承载本步骤的计算结果供后续使用
  MIM_HUPIJIAO_APP_ID: 'app-hp-1', // 对象字段：声明结构中的一项数据
  MIM_HUPIJIAO_APP_KEY: 'hp-secret-key', // 对象字段：声明结构中的一项数据
  MIM_HUPIJIAO_NOTIFY_URL: 'http://localhost/api/v1/payments/hupijiao/notify',
}; // 结束代码块：本层作用域收尾

const STRIPE_ENV = { // 保存 STRIPE_ENV：承载本步骤的计算结果供后续使用
  MIM_STRIPE_SECRET_KEY: 'sk_test_abc123', // 对象字段：声明结构中的一项数据
  MIM_STRIPE_WEBHOOK_SECRET: 'whsec_test_secret', // 对象字段：声明结构中的一项数据
}; // 结束代码块：本层作用域收尾

interface Harness { // 声明类型 Harness：约束跨模块数据结构
  app: Express; // 对象字段：声明结构中的一项数据
  db: ReturnType<typeof createDatabase>; // 对象字段：声明结构中的一项数据
  deps: ApiDeps; // 对象字段：声明结构中的一项数据
  server?: Server; // 业务步骤：推进当前流程的下一项处理
} // 结束代码块：本层作用域收尾

/** 起一个本地 stub 上游，按回调返回固定报文 */
function startStub(handler: (body: string, path: string) => unknown): Promise<{ server: Server; base: string }> { // 定义函数 startStub：封装可复用业务步骤
  return new Promise((resolve) => { // 返回结果：把本步骤产物交给调用方
    const server = createServer((req, res) => { // 保存 server：承载本步骤的计算结果供后续使用
      let chunks = ''; // 保存 chunks：承载本步骤的计算结果供后续使用
      req.on('data', (chunk) => { chunks += chunk; }); // 读取请求：取得入参、身份或上下文
      req.on('end', () => { // 读取请求：取得入参、身份或上下文
        res.setHeader('content-type', 'application/json'); // 输出响应：把处理结果写回 HTTP 客户端
        res.end(JSON.stringify(handler(chunks, req.url ?? ''))); // 输出响应：把处理结果写回 HTTP 客户端
      }); // 结束函数体：本层作用域收尾
    }); // 结束函数体：本层作用域收尾
    server.listen(0, '127.0.0.1', () => { // 业务步骤：推进当前流程的下一项处理
      const addr = server.address(); // 保存 addr：承载本步骤的计算结果供后续使用
      const port = typeof addr === 'object' && addr ? addr.port : 0; // 保存 port：承载本步骤的计算结果供后续使用
      resolve({ server, base: `http://127.0.0.1:${port}` });
    }); // 结束函数体：本层作用域收尾
  }); // 结束函数体：本层作用域收尾
} // 结束代码块：本层作用域收尾

function makeApp(env: Record<string, string | undefined>): Harness { // 定义函数 makeApp：封装可复用业务步骤
  const db = createDatabase(':memory:'); // 保存 db：承载本步骤的计算结果供后续使用
  const deps: ApiDeps = { db, jwtSecret: JWT_SECRET, env }; // 保存 deps：承载本步骤的计算结果供后续使用
  const app = express(); // 保存 app：承载本步骤的计算结果供后续使用
  app.disable('x-powered-by'); // 业务步骤：推进当前流程的下一项处理
  app.use(requestId); // 业务步骤：推进当前流程的下一项处理
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as { rawBody?: string }).rawBody = buf.toString('utf8'); } })); // 业务步骤：推进当前流程的下一项处理
  app.use((req, _res, next) => { req.deps = deps; next(); }); // 业务步骤：推进当前流程的下一项处理
  app.use('/api/v1', createPaymentChannelRouter(deps)); // 业务步骤：推进当前流程的下一项处理
  app.use(notFound); // 业务步骤：推进当前流程的下一项处理
  app.use(errorHandler); // 业务步骤：推进当前流程的下一项处理
  return { app, db, deps }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

function seedUser(db: Harness['db'], id = 'u-probe'): string { // 定义函数 seedUser：封装可复用业务步骤
  const ts = new Date().toISOString(); // 保存 ts：承载本步骤的计算结果供后续使用
  db.prepare("INSERT INTO users (id, region, status, display_name, locale, timezone, created_at, updated_at) VALUES (?, 'cn', 'active', 'probe', 'zh-CN', 'Asia/Shanghai', ?, ?)") // 预编译 SQL：固定语句结构后绑定参数执行
    .run(id, ts, ts); // 执行写入：把参数落库并返回影响结果
  return issueAccessToken(id, 'cn', JWT_SECRET); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

function seedIntent( // 定义函数 seedIntent：封装可复用业务步骤
  db: Harness['db'], // 对象字段：声明结构中的一项数据
  overrides: Partial<ExtIntentRow> & { provider: ExtChannelId; amountCents: number }, // 对象字段：声明结构中的一项数据
): ExtIntentRow { // 调用结束：参数列表与链式调用收尾
  const ts = new Date().toISOString(); // 保存 ts：承载本步骤的计算结果供后续使用
  const id = overrides.id ?? `pext-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
  db.prepare( // 预编译 SQL：固定语句结构后绑定参数执行
    `INSERT INTO payment_ext_intents
       (id, user_id, purpose, ref_id, provider, amount_cents, currency, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run( // 执行写入：把参数落库并返回影响结果
    id, // 业务步骤：推进当前流程的下一项处理
    overrides.user_id ?? 'u-probe', // 业务步骤：推进当前流程的下一项处理
    overrides.purpose ?? 'recharge', // 业务步骤：推进当前流程的下一项处理
    overrides.ref_id ?? 'ref-1', // 业务步骤：推进当前流程的下一项处理
    overrides.provider, // 业务步骤：推进当前流程的下一项处理
    overrides.amountCents, // 业务步骤：推进当前流程的下一项处理
    overrides.currency ?? 'CNY', // 业务步骤：推进当前流程的下一项处理
    overrides.status ?? 'pending', // 业务步骤：推进当前流程的下一项处理
    new Date(Date.now() + 30 * 60000).toISOString(), // 业务步骤：推进当前流程的下一项处理
    ts, // 业务步骤：推进当前流程的下一项处理
  ); // 调用结束：参数列表与链式调用收尾
  return db.prepare('SELECT * FROM payment_ext_intents WHERE id = ?').get(id) as ExtIntentRow; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

function walletBalance(db: Harness['db'], userId: string): number { // 定义函数 walletBalance：封装可复用业务步骤
  const row = db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(userId) as { balance_cents: number } | undefined; // 保存 row：承载本步骤的计算结果供后续使用
  return row?.balance_cents ?? 0; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

function eventCount(db: Harness['db'], intentId: string): number { // 定义函数 eventCount：封装可复用业务步骤
  const row = db.prepare('SELECT COUNT(*) AS n FROM payment_ext_events WHERE intent_id = ?').get(intentId) as { n: number }; // 保存 row：承载本步骤的计算结果供后续使用
  return row.n; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 虎皮椒签名：canonical 尾部直拼秘钥 MD5（与适配器同口径） */
function hpSign(params: Record<string, string>, secret: string): string { // 定义函数 hpSign：封装可复用业务步骤
  return md5Hex(`${canonicalSorted(params)}${secret}`); // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

describe('九渠道矩阵 GET /payments/channels', () => { // 用例「九渠道矩阵 GET /payments/channels」：覆盖对应业务契约
  it('空 env：九渠道齐全，仅 manual configured=true，其余显式 configured=false', async () => { // 用例「空 env：九渠道齐全，仅 manual configured=true，其余显式 configured=false」：覆盖对应业务契约
    const h = makeApp({}); // 保存 h：承载本步骤的计算结果供后续使用
    const token = seedUser(h.db); // 保存 token：承载本步骤的计算结果供后续使用
    const res = await request(h.app).get('/api/v1/payments/channels').set({ authorization: `Bearer ${token}` }); // 保存 res：承载本步骤的计算结果供后续使用
    expect(res.status).toBe(200); // 断言：校验接口返回符合契约
    const channels = res.body.channels as Array<Record<string, unknown>>; // 保存 channels：承载本步骤的计算结果供后续使用
    expect(channels).toHaveLength(9); // 断言：校验接口返回符合契约
    const byId = Object.fromEntries(channels.map((c) => [c.id, c])); // 保存 byId：承载本步骤的计算结果供后续使用
    expect(byId.manual.configured).toBe(true); // 断言：校验接口返回符合契约
    for (const id of ['alipay', 'wechat', 'sandbox', 'hupijiao', 'xunhu', 'paypal', 'stripe', 'alipay_ent']) { // 循环处理：逐项完成批量数据操作
      expect(byId[id].configured).toBe(false); // 断言：校验接口返回符合契约
      expect(typeof byId[id].enabled).toBe('boolean'); // 断言：校验接口返回符合契约
      expect(typeof byId[id].sandbox).toBe('boolean'); // 断言：校验接口返回符合契约
    } // 结束循环体：本层作用域收尾
  }); // 结束函数体：本层作用域收尾

  it('配齐虎皮椒凭证后对应渠道 configured=true，其余仍为 false', async () => { // 用例「配齐虎皮椒凭证后对应渠道 configured=true，其余仍为 false」：覆盖对应业务契约
    const h = makeApp({ ...HP_ENV }); // 保存 h：承载本步骤的计算结果供后续使用
    const token = seedUser(h.db); // 保存 token：承载本步骤的计算结果供后续使用
    const res = await request(h.app).get('/api/v1/payments/channels').set({ authorization: `Bearer ${token}` }); // 保存 res：承载本步骤的计算结果供后续使用
    const byId = Object.fromEntries((res.body.channels as Array<{ id: string; configured: boolean }>).map((c) => [c.id, c])); // 保存 byId：承载本步骤的计算结果供后续使用
    expect(byId.hupijiao.configured).toBe(true); // 断言：校验接口返回符合契约
    expect(byId.paypal.configured).toBe(false); // 断言：校验接口返回符合契约
    expect(byId.stripe.configured).toBe(false); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('未配置降级：下单 / 回调 / 退款一律 503，不伪造成功', () => { // 用例「未配置降级：下单 / 回调 / 退款一律 503，不伪造成功」：覆盖对应业务契约
  it('未配置渠道下单 → 503 PROVIDER_NOT_CONFIGURED', async () => { // 用例「未配置渠道下单 → 503 PROVIDER_NOT_CONFIGURED」：覆盖对应业务契约
    const h = makeApp({}); // 保存 h：承载本步骤的计算结果供后续使用
    const token = seedUser(h.db); // 保存 token：承载本步骤的计算结果供后续使用
    const res = await request(h.app) // 保存 res：承载本步骤的计算结果供后续使用
      .post('/api/v1/payments/ext/intents') // 链式调用：在上一步结果上继续处理
      .set({ authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }) // 链式调用：在上一步结果上继续处理
      .send({ purpose: 'recharge', ref_id: 'ref-1', provider: 'paypal', amount_cents: 1000 }); // 链式调用：在上一步结果上继续处理
    expect(res.status).toBe(503); // 断言：校验接口返回符合契约
    expect(res.body.code).toBe('PROVIDER_NOT_CONFIGURED'); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('未配置渠道回调 → 503 PAYMENT_NOTIFY_NOT_CONFIGURED', async () => { // 用例「未配置渠道回调 → 503 PAYMENT_NOTIFY_NOT_CONFIGURED」：覆盖对应业务契约
    const h = makeApp({}); // 保存 h：承载本步骤的计算结果供后续使用
    const res = await request(h.app).post('/api/v1/payments/paypal/notify').send({}); // 保存 res：承载本步骤的计算结果供后续使用
    expect(res.status).toBe(503); // 断言：校验接口返回符合契约
    expect(res.body.code).toBe('PAYMENT_NOTIFY_NOT_CONFIGURED'); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('未知渠道回调 → 404', async () => { // 用例「未知渠道回调 → 404」：覆盖对应业务契约
    const h = makeApp({}); // 保存 h：承载本步骤的计算结果供后续使用
    const res = await request(h.app).post('/api/v1/nope/notify').send({}); // 保存 res：承载本步骤的计算结果供后续使用
    expect(res.status).toBe(404); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('未配置渠道退款 → 503', async () => { // 用例「未配置渠道退款 → 503」：覆盖对应业务契约
    const h = makeApp({ MIM_ADMIN_TOKEN: ADMIN_TOKEN }); // 保存 h：承载本步骤的计算结果供后续使用
    seedUser(h.db, 'u-admin'); // 业务步骤：推进当前流程的下一项处理
    const intent = seedIntent(h.db, { provider: 'paypal', amountCents: 1000, status: 'paid', user_id: 'u-admin' }); // 保存 intent：承载本步骤的计算结果供后续使用
    const token = issueAccessToken('u-admin', 'cn', JWT_SECRET); // 保存 token：承载本步骤的计算结果供后续使用
    const res = await request(h.app) // 保存 res：承载本步骤的计算结果供后续使用
      .post(`/api/v1/payments/ext/intents/${intent.id}/refund`) // 链式调用：在上一步结果上继续处理
      .set({ authorization: `Bearer ${token}`, 'x-admin-token': ADMIN_TOKEN, 'idempotency-key': randomUUID() }) // 链式调用：在上一步结果上继续处理
      .send({ reason: 'test' }); // 链式调用：在上一步结果上继续处理
    expect(res.status).toBe(503); // 断言：校验接口返回符合契约
    expect(res.body.code).toBe('PROVIDER_NOT_CONFIGURED'); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('虎皮椒回调：验签 / 金额校验 / 重放幂等', () => { // 用例「虎皮椒回调：验签 / 金额校验 / 重放幂等」：覆盖对应业务契约
  let h: Harness; // 保存 h：承载本步骤的计算结果供后续使用

  beforeEach(() => { // 业务步骤：推进当前流程的下一项处理
    h = makeApp({ ...HP_ENV, MIM_ADMIN_TOKEN: ADMIN_TOKEN }); // 赋值：更新当前作用域中的状态
    seedUser(h.db); // 业务步骤：推进当前流程的下一项处理
  }); // 结束函数体：本层作用域收尾

  it('签名正确 → 充值入账；同一报文重放不重复加钱', async () => { // 用例「签名正确 → 充值入账；同一报文重放不重复加钱」：覆盖对应业务契约
    const intent = seedIntent(h.db, { provider: 'hupijiao', amountCents: 1000 }); // 保存 intent：承载本步骤的计算结果供后续使用
    const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
      appid: HP_ENV.MIM_HUPIJIAO_APP_ID, // 对象字段：声明结构中的一项数据
      trade_order_id: intent.id, // 对象字段：声明结构中的一项数据
      total_fee: '10.00', // 对象字段：声明结构中的一项数据
      transaction_id: 'txn-hp-1', // 对象字段：声明结构中的一项数据
      status: 'OD', // 对象字段：声明结构中的一项数据
      time: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
      nonce_str: 'nonce-1', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    params.hash = hpSign(params, HP_ENV.MIM_HUPIJIAO_APP_KEY!); // 业务步骤：推进当前流程的下一项处理

    const ok = await request(h.app).post('/api/v1/payments/hupijiao/notify').send(params); // 保存 ok：承载本步骤的计算结果供后续使用
    expect(ok.status).toBe(200); // 断言：校验接口返回符合契约
    expect(ok.text).toBe('success'); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, intent.user_id)).toBe(1000); // 断言：校验接口返回符合契约
    expect(eventCount(h.db, intent.id)).toBe(1); // 断言：校验接口返回符合契约

    const replay = await request(h.app).post('/api/v1/payments/hupijiao/notify').send(params); // 保存 replay：承载本步骤的计算结果供后续使用
    expect(replay.status).toBe(200); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, intent.user_id)).toBe(1000); // 未重复入账
    expect(eventCount(h.db, intent.id)).toBe(2); // 重放留痕，但不产生第二笔权益
  }); // 结束函数体：本层作用域收尾

  it('签名错误 → 403，不入账', async () => { // 用例「签名错误 → 403，不入账」：覆盖对应业务契约
    const intent = seedIntent(h.db, { provider: 'hupijiao', amountCents: 1000 }); // 保存 intent：承载本步骤的计算结果供后续使用
    const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
      trade_order_id: intent.id, // 对象字段：声明结构中的一项数据
      total_fee: '10.00', // 对象字段：声明结构中的一项数据
      transaction_id: 'txn-hp-bad', // 对象字段：声明结构中的一项数据
      status: 'OD', // 对象字段：声明结构中的一项数据
      hash: 'f'.repeat(32), // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    const res = await request(h.app).post('/api/v1/payments/hupijiao/notify').send(params); // 保存 res：承载本步骤的计算结果供后续使用
    expect(res.status).toBe(403); // 断言：校验接口返回符合契约
    expect(res.body.code).toBe('FORBIDDEN'); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, intent.user_id)).toBe(0); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('金额不符 → 409 CONFLICT，不入账', async () => { // 用例「金额不符 → 409 CONFLICT，不入账」：覆盖对应业务契约
    const intent = seedIntent(h.db, { provider: 'hupijiao', amountCents: 1000 }); // 保存 intent：承载本步骤的计算结果供后续使用
    const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
      appid: HP_ENV.MIM_HUPIJIAO_APP_ID, // 对象字段：声明结构中的一项数据
      trade_order_id: intent.id, // 对象字段：声明结构中的一项数据
      total_fee: '9.00', // 少 1 元
      transaction_id: 'txn-hp-2', // 对象字段：声明结构中的一项数据
      status: 'OD', // 对象字段：声明结构中的一项数据
      time: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
      nonce_str: 'nonce-2', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    params.hash = hpSign(params, HP_ENV.MIM_HUPIJIAO_APP_KEY!); // 业务步骤：推进当前流程的下一项处理
    const res = await request(h.app).post('/api/v1/payments/hupijiao/notify').send(params); // 保存 res：承载本步骤的计算结果供后续使用
    expect(res.status).toBe(409); // 断言：校验接口返回符合契约
    expect(res.body.code).toBe('CONFLICT'); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, intent.user_id)).toBe(0); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('订单号不存在 → 404；渠道不匹配 → 409', async () => { // 用例「订单号不存在 → 404；渠道不匹配 → 409」：覆盖对应业务契约
    const missing: Record<string, string> = { // 保存 missing：承载本步骤的计算结果供后续使用
      appid: HP_ENV.MIM_HUPIJIAO_APP_ID, // 对象字段：声明结构中的一项数据
      trade_order_id: 'pext-not-exist', // 对象字段：声明结构中的一项数据
      total_fee: '10.00', // 对象字段：声明结构中的一项数据
      transaction_id: 'txn-hp-3', // 对象字段：声明结构中的一项数据
      status: 'OD', // 对象字段：声明结构中的一项数据
      time: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
      nonce_str: 'nonce-3', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    missing.hash = hpSign(missing, HP_ENV.MIM_HUPIJIAO_APP_KEY!); // 业务步骤：推进当前流程的下一项处理
    const notFound = await request(h.app).post('/api/v1/payments/hupijiao/notify').send(missing); // 保存 notFound：承载本步骤的计算结果供后续使用
    expect(notFound.status).toBe(404); // 断言：校验接口返回符合契约

    const stripeIntent = seedIntent(h.db, { provider: 'stripe', amountCents: 1000, id: 'pext-stripe-1' }); // 保存 stripeIntent：承载本步骤的计算结果供后续使用
    const mismatched: Record<string, string> = { // 保存 mismatched：承载本步骤的计算结果供后续使用
      appid: HP_ENV.MIM_HUPIJIAO_APP_ID, // 对象字段：声明结构中的一项数据
      trade_order_id: stripeIntent.id, // 对象字段：声明结构中的一项数据
      total_fee: '10.00', // 对象字段：声明结构中的一项数据
      transaction_id: 'txn-hp-4', // 对象字段：声明结构中的一项数据
      status: 'OD', // 对象字段：声明结构中的一项数据
      time: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
      nonce_str: 'nonce-4', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    mismatched.hash = hpSign(mismatched, HP_ENV.MIM_HUPIJIAO_APP_KEY!); // 业务步骤：推进当前流程的下一项处理
    const conflict = await request(h.app).post('/api/v1/payments/hupijiao/notify').send(mismatched); // 保存 conflict：承载本步骤的计算结果供后续使用
    expect(conflict.status).toBe(409); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾
}); // 结束函数体：本层作用域收尾

describe('Stripe Webhook：HMAC 验签 / 重放幂等', () => { // 用例「Stripe Webhook：HMAC 验签 / 重放幂等」：覆盖对应业务契约
  let h: Harness; // 保存 h：承载本步骤的计算结果供后续使用

  beforeEach(() => { // 业务步骤：推进当前流程的下一项处理
    h = makeApp({ ...STRIPE_ENV }); // 赋值：更新当前作用域中的状态
    seedUser(h.db); // 业务步骤：推进当前流程的下一项处理
  }); // 结束函数体：本层作用域收尾

  function signedEvent(intentId: string, amount: number, currency: string) { // 定义函数 signedEvent：封装可复用业务步骤
    const body = { // 保存 body：承载本步骤的计算结果供后续使用
      type: 'payment_intent.succeeded', // 对象字段：声明结构中的一项数据
      data: { object: { id: 'pi-1', amount, currency, metadata: { order_id: intentId } } }, // 对象字段：声明结构中的一项数据
    }; // 结束函数体：本层作用域收尾
    const rawBody = JSON.stringify(body); // 保存 rawBody：承载本步骤的计算结果供后续使用
    const timestamp = String(Math.floor(Date.now() / 1000)); // 保存 timestamp：承载本步骤的计算结果供后续使用
    const v1 = hmacSha256Hex(STRIPE_ENV.MIM_STRIPE_WEBHOOK_SECRET!, `${timestamp}.${rawBody}`); // 保存 v1：承载本步骤的计算结果供后续使用
    return { rawBody, headers: { 'stripe-signature': `t=${timestamp},v1=${v1}` } }; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾

  it('签名正确 → 入账；重放不重复加钱', async () => { // 用例「签名正确 → 入账；重放不重复加钱」：覆盖对应业务契约
    const intent = seedIntent(h.db, { provider: 'stripe', amountCents: 2000, currency: 'USD' }); // 保存 intent：承载本步骤的计算结果供后续使用
    const event = signedEvent(intent.id, 2000, 'usd'); // 保存 event：承载本步骤的计算结果供后续使用
    const ok = await request(h.app) // 保存 ok：承载本步骤的计算结果供后续使用
      .post('/api/v1/payments/stripe/notify') // 链式调用：在上一步结果上继续处理
      .set(event.headers) // 链式调用：在上一步结果上继续处理
      .send(JSON.parse(event.rawBody)); // 链式调用：在上一步结果上继续处理
    expect(ok.status).toBe(200); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, intent.user_id)).toBe(2000); // 断言：校验接口返回符合契约

    const replay = await request(h.app) // 保存 replay：承载本步骤的计算结果供后续使用
      .post('/api/v1/payments/stripe/notify') // 链式调用：在上一步结果上继续处理
      .set(event.headers) // 链式调用：在上一步结果上继续处理
      .send(JSON.parse(event.rawBody)); // 链式调用：在上一步结果上继续处理
    expect(replay.status).toBe(200); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, intent.user_id)).toBe(2000); // 断言：校验接口返回符合契约
  }); // 结束函数体：本层作用域收尾

  it('签名错误 → 403', async () => { // 用例「签名错误 → 403」：覆盖对应业务契约
    const intent = seedIntent(h.db, { provider: 'stripe', amountCents: 2000, currency: 'USD' }); // 保存 intent：承载本步骤的计算结果供后续使用
    const rawBody = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi-2', amount: 2000, currency: 'usd', metadata: { order_id: intent.id } } } }); // 保存 rawBody：承载本步骤的计算结果供后续使用
    const res = await request(h.app) // 保存 res：承载本步骤的计算结果供后续使用
      .post('/api/v1/payments/stripe/notify') // 链式调用：在上一步结果上继续处理
      .set({ 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'f'.repeat(64)}` }) // 链式调用：在上一步结果上继续处理
      .send(JSON.parse(rawBody)); // 链式调用：在上一步结果上继续处理
    expect(res.status).toBe(403); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, intent.user_id)).toBe(0); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾
}); // 结束代码块：本层作用域收尾

describe('下单与退款（本地 stub 上游）', () => { // 用例「下单与退款（本地 stub 上游）」：覆盖对应业务契约
  let h: Harness; // 保存 h：承载本步骤的计算结果供后续使用
  let stub: Server | undefined; // 保存 stub：承载本步骤的计算结果供后续使用

  afterEach(() => { stub?.close(); }); // 业务步骤：推进当前流程的下一项处理

  it('虎皮椒下单 → 201 并落跳转串；退款成功 → 余额冲正，幂等回放不重复退款', async () => { // 用例「虎皮椒下单 → 201 并落跳转串；退款成功 → 余额冲正，幂等回放不重复退款」：覆盖对应业务契约
    const { server, base } = await startStub((_body, path) => { // 解构依赖：从模块或上下文取出所需成员
      if (path.includes('/payment/refund.html')) return { errcode: 0, out_refund_no: 'rf-1', refund_status: 'OD' }; // 条件分支：仅在满足业务前置条件时继续
      return { errcode: 0, url: 'https://pay.example/hp', url_qrcode: 'qr://hp-1', openid: 'hp-order-1' };
    }); // 结束函数体：本层作用域收尾
    stub = server; // 赋值：更新当前作用域中的状态
    h = makeApp({ ...HP_ENV, MIM_HUPIJIAO_API_BASE: base, MIM_ADMIN_TOKEN: ADMIN_TOKEN }); // 赋值：更新当前作用域中的状态
    const token = seedUser(h.db); // 保存 token：承载本步骤的计算结果供后续使用

    const created = await request(h.app) // 保存 created：承载本步骤的计算结果供后续使用
      .post('/api/v1/payments/ext/intents') // 链式调用：在上一步结果上继续处理
      .set({ authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }) // 链式调用：在上一步结果上继续处理
      .send({ purpose: 'recharge', ref_id: 'ref-1', provider: 'hupijiao', amount_cents: 1000 }); // 链式调用：在上一步结果上继续处理
    expect(created.status).toBe(201); // 断言：校验接口返回符合契约
    expect(created.body.intent.pay_url).toBe('https://pay.example/hp');

    // 直接把意图置为已支付并模拟入账，再走退款
    const intentId = created.body.intent.id as string; // 保存 intentId：承载本步骤的计算结果供后续使用
    h.db.prepare("UPDATE payment_ext_intents SET status = 'paid', provider_txn_id = 'txn-hp-ok', paid_at = ? WHERE id = ?").run(new Date().toISOString(), intentId); // 预编译 SQL：固定语句结构后绑定参数执行
    h.db.prepare('UPDATE wallets SET balance_cents = 1000 WHERE user_id = ?').run('u-probe'); // 预编译 SQL：固定语句结构后绑定参数执行

    const refundRes = await request(h.app) // 保存 refundRes：承载本步骤的计算结果供后续使用
      .post(`/api/v1/payments/ext/intents/${intentId}/refund`) // 链式调用：在上一步结果上继续处理
      .set({ authorization: `Bearer ${token}`, 'x-admin-token': ADMIN_TOKEN, 'idempotency-key': 'refund-key-1' }) // 链式调用：在上一步结果上继续处理
      .send({ reason: '用户申请退款' }); // 链式调用：在上一步结果上继续处理
    expect(refundRes.status).toBe(200); // 断言：校验接口返回符合契约
    expect(refundRes.body.ok).toBe(true); // 断言：校验接口返回符合契约
    expect(walletBalance(h.db, 'u-probe')).toBe(0); // 断言：校验接口返回符合契约

    const refundRows = h.db.prepare('SELECT COUNT(*) AS n FROM payment_ext_refunds WHERE intent_id = ?').get(intentId) as { n: number }; // 保存 refundRows：承载本步骤的计算结果供后续使用
    expect(refundRows.n).toBe(1); // 断言：校验接口返回符合契约

    const replay = await request(h.app) // 保存 replay：承载本步骤的计算结果供后续使用
      .post(`/api/v1/payments/ext/intents/${intentId}/refund`) // 链式调用：在上一步结果上继续处理
      .set({ authorization: `Bearer ${token}`, 'x-admin-token': ADMIN_TOKEN, 'idempotency-key': 'refund-key-1' }) // 链式调用：在上一步结果上继续处理
      .send({ reason: '用户申请退款' }); // 链式调用：在上一步结果上继续处理
    expect(replay.status).toBe(200); // 幂等回放
    const refundRowsAfter = h.db.prepare('SELECT COUNT(*) AS n FROM payment_ext_refunds WHERE intent_id = ?').get(intentId) as { n: number }; // 保存 refundRowsAfter：承载本步骤的计算结果供后续使用
    expect(refundRowsAfter.n).toBe(1); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾

  it('上游退款失败 → 502 且退款记录置 failed', async () => { // 用例「上游退款失败 → 502 且退款记录置 failed」：覆盖对应业务契约
    const { server, base } = await startStub(() => ({ errcode: 500, errmsg: 'refund failed' })); // 解构依赖：从模块或上下文取出所需成员
    stub = server; // 赋值：更新当前作用域中的状态
    h = makeApp({ ...HP_ENV, MIM_HUPIJIAO_API_BASE: base, MIM_ADMIN_TOKEN: ADMIN_TOKEN }); // 赋值：更新当前作用域中的状态
    const token = seedUser(h.db); // 保存 token：承载本步骤的计算结果供后续使用
    const intent = seedIntent(h.db, { provider: 'hupijiao', amountCents: 1000, status: 'paid' }); // 保存 intent：承载本步骤的计算结果供后续使用
    h.db.prepare('UPDATE wallets SET balance_cents = 1000 WHERE user_id = ?').run(intent.user_id); // 预编译 SQL：固定语句结构后绑定参数执行

    const res = await request(h.app) // 保存 res：承载本步骤的计算结果供后续使用
      .post(`/api/v1/payments/ext/intents/${intent.id}/refund`) // 链式调用：在上一步结果上继续处理
      .set({ authorization: `Bearer ${token}`, 'x-admin-token': ADMIN_TOKEN, 'idempotency-key': randomUUID() }) // 链式调用：在上一步结果上继续处理
      .send({ reason: 'bad' }); // 链式调用：在上一步结果上继续处理
    expect(res.status).toBe(502); // 断言：校验接口返回符合契约
    const row = h.db.prepare('SELECT status FROM payment_ext_refunds WHERE intent_id = ?').get(intent.id) as { status: string }; // 保存 row：承载本步骤的计算结果供后续使用
    expect(row.status).toBe('failed'); // 断言：校验接口返回符合契约
  }); // 结束代码块：本层作用域收尾
}); // 结束代码块：本层作用域收尾
