/** 扩展支付渠道路由：九渠道矩阵、新渠道下单 / 回调 / 退款（独立工厂，主控统一挂载） */

import { randomUUID } from 'node:crypto'; // 引入依赖：声明本文件使用的外部能力
import { Router } from 'express'; // 引入依赖：声明本文件使用的外部能力
import { z } from 'zod'; // 引入依赖：声明本文件使用的外部能力
import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 引入依赖：声明本文件使用的外部能力
import { parse } from '../validate.js'; // 引入依赖：声明本文件使用的外部能力
import type { ApiDeps } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import type { ExtChannelId, ExtIntentRow } from './types.js'; // 引入依赖：声明本文件使用的外部能力
import { channelMatrix, getAdapter } from './registry.js'; // 引入依赖：声明本文件使用的外部能力
import { // 引入依赖：声明本文件使用的外部能力
  createExtIntent, // 业务步骤：推进当前流程的下一项处理
  fulfillExtIntent, // 业务步骤：推进当前流程的下一项处理
  getExtIntent, // 业务步骤：推进当前流程的下一项处理
  markIntentRefunded, // 业务步骤：推进当前流程的下一项处理
  recordExtEvent, // 业务步骤：推进当前流程的下一项处理
  recordRefund, // 业务步骤：推进当前流程的下一项处理
} from './fulfill.js'; // 结束代码块：本层作用域收尾

const EXT_PROVIDERS: ExtChannelId[] = ['hupijiao', 'xunhu', 'paypal', 'stripe', 'alipay_ent']; // 保存 EXT_PROVIDERS：承载本步骤的计算结果供后续使用

/** 币种按渠道缺省：国际渠道走各自环境变量，国内聚合渠道默认 CNY */
function currencyFor(provider: ExtChannelId, env: Record<string, string | undefined>): string { // 定义函数 currencyFor：封装可复用业务步骤
  if (provider === 'paypal') return (env.MIM_PAYPAL_CURRENCY ?? 'USD').trim().toUpperCase(); // 条件分支：仅在满足业务前置条件时继续
  if (provider === 'stripe') return (env.MIM_STRIPE_CURRENCY ?? 'usd').trim().toUpperCase(); // 条件分支：仅在满足业务前置条件时继续
  return 'CNY'; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 金额一律以服务端商品 / 订单价格为准，不接受前端传金额（与既有支付路由同口径） */
function resolveAmount(deps: ApiDeps, userId: string, purpose: string, refId: string, bodyAmount?: number): number { // 定义函数 resolveAmount：封装可复用业务步骤
  if (purpose === 'recharge') { // 条件分支：仅在满足业务前置条件时继续
    if (!bodyAmount || bodyAmount < 100 || bodyAmount > 200000) throw new AppError('VALIDATION_FAILED', '充值金额需在 1–2000 元之间'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    return bodyAmount; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾
  if (purpose === 'asset') { // 条件分支：仅在满足业务前置条件时继续
    const asset = deps.db.prepare("SELECT id, price_cents, vip_free FROM paid_assets WHERE code = ? AND status = 'published'").get(refId) as // 保存 asset：承载本步骤的计算结果供后续使用
      | { id: string; price_cents: number; vip_free: number } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!asset) throw new AppError('NOT_FOUND', '资产不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (deps.db.prepare('SELECT 1 AS ok FROM asset_purchases WHERE user_id = ? AND asset_id = ?').get(userId, asset.id)) throw new AppError('CONFLICT', '已购买该资产'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    return asset.price_cents; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾
  if (purpose === 'vip') { // 条件分支：仅在满足业务前置条件时继续
    const plan = deps.db.prepare('SELECT price_cents FROM vip_plans WHERE code = ? AND active = 1').get(refId) as { price_cents: number } | undefined; // 保存 plan：承载本步骤的计算结果供后续使用
    if (!plan) throw new AppError('NOT_FOUND', 'VIP 套餐不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    return plan.price_cents; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾
  const order = deps.db.prepare('SELECT user_id, status, payable_cents FROM shop_orders WHERE id = ?').get(refId) as // 保存 order：承载本步骤的计算结果供后续使用
    | { user_id: string; status: string; payable_cents: number } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (!order || order.user_id !== userId) throw new AppError('NOT_FOUND', '订单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
  if (order.status !== 'pending') throw new AppError('CONFLICT', '当前订单无需在线支付'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
  return order.payable_cents; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 退款冲正：充值类退款扣回余额并记流水；其余目的仅留退款记录 */
function reverseRecharge(deps: ApiDeps, intent: ExtIntentRow): void { // 定义函数 reverseRecharge：封装可复用业务步骤
  if (intent.purpose !== 'recharge') return; // 条件分支：仅在满足业务前置条件时继续
  const wallet = deps.db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(intent.user_id) as { balance_cents: number } | undefined; // 保存 wallet：承载本步骤的计算结果供后续使用
  const balance = wallet?.balance_cents ?? 0; // 保存 balance：承载本步骤的计算结果供后续使用
  const next = Math.max(0, balance - intent.amount_cents); // 保存 next：承载本步骤的计算结果供后续使用
  deps.db.prepare('UPDATE wallets SET balance_cents = ?, updated_at = ? WHERE user_id = ?').run(next, new Date().toISOString(), intent.user_id); // 预编译 SQL：固定语句结构后绑定参数执行
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'refund', ?, 'payment', ?, '渠道退款冲正', ?)") // 预编译 SQL：固定语句结构后绑定参数执行
    .run(`wt-${randomUUID()}`, intent.user_id, -intent.amount_cents, intent.id, new Date().toISOString()); // 执行写入：把参数落库并返回影响结果
} // 结束函数体：本层作用域收尾

export function createPaymentChannelRouter(deps: ApiDeps): Router { // 定义函数 createPaymentChannelRouter：封装可复用业务步骤
  const router = Router(); // 保存 router：承载本步骤的计算结果供后续使用

  /** 九渠道矩阵：只回配置 / 沙箱状态，不回密钥 */
  router.get('/payments/channels', requireAuth, (_req, res) => { // 路由 GET /payments/channels：注册入口并绑定鉴权与处理逻辑
    res.json({ channels: channelMatrix(deps.env) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 新渠道下单：鉴权 + 写操作幂等；未配置凭证返回 503，不伪造成功 */
  router.post('/payments/ext/intents', requireAuth, idempotency, async (req, res) => { // 路由 POST /payments/ext/intents：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        purpose: z.enum(['shop_order', 'vip', 'asset', 'recharge']), // 对象字段：声明结构中的一项数据
        ref_id: z.string().min(1).max(80), // 对象字段：声明结构中的一项数据
        provider: z.enum(EXT_PROVIDERS), // 对象字段：声明结构中的一项数据
        channel: z.enum(['qr', 'wap', 'page', 'app']).optional(), // 对象字段：声明结构中的一项数据
        amount_cents: z.number().int().min(0).max(200000).optional(), // 对象字段：声明结构中的一项数据
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    const adapter = getAdapter(body.provider); // 保存 adapter：承载本步骤的计算结果供后续使用
    if (!adapter) throw new AppError('VALIDATION_FAILED', '不支持的支付渠道'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    if (!adapter.configured(deps.env)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('PROVIDER_NOT_CONFIGURED', `${adapter.label}未配置`, { provider: body.provider }); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
    } // 结束函数体：本层作用域收尾
    const amount = resolveAmount(deps, userId, body.purpose, body.ref_id, body.amount_cents); // 保存 amount：承载本步骤的计算结果供后续使用
    if (amount <= 0) throw new AppError('VALIDATION_FAILED', '该对象无需支付'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求

    const intent = createExtIntent(deps, { // 保存 intent：承载本步骤的计算结果供后续使用
      userId, // 业务步骤：推进当前流程的下一项处理
      purpose: body.purpose, // 对象字段：声明结构中的一项数据
      refId: body.ref_id, // 对象字段：声明结构中的一项数据
      provider: body.provider, // 对象字段：声明结构中的一项数据
      amountCents: amount, // 对象字段：声明结构中的一项数据
      currency: currencyFor(body.provider, deps.env), // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    const result = await adapter.createOrder(deps.env, intent, { channel: body.channel }); // 保存 result：承载本步骤的计算结果供后续使用
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare('UPDATE payment_ext_intents SET pay_url = ?, qr_text = ?, client_secret = ?, provider_txn_id = ? WHERE id = ?') // 预编译 SQL：固定语句结构后绑定参数执行
      .run(result.payUrl ?? null, result.qrText ?? null, result.clientSecret ?? null, result.providerOrderId ?? null, intent.id); // 执行写入：把参数落库并返回影响结果
    const updated = getExtIntent(deps, intent.id)!; // 保存 updated：承载本步骤的计算结果供后续使用
    res.status(201).json({ intent: updated, next: result.next, pay_url: result.payUrl }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 查询本人扩展渠道支付单 */
  router.get('/payments/ext/intents/:id', requireAuth, (req, res) => { // 路由 GET /payments/ext/intents/:id：注册入口并绑定鉴权与处理逻辑
    const intent = deps.db.prepare('SELECT * FROM payment_ext_intents WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as ExtIntentRow | undefined; // 保存 intent：承载本步骤的计算结果供后续使用
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    res.json({ intent }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 渠道回调：验签 → 订单号 / 金额 / 币种校验 → 幂等履约；公开端点，不挂 requireAuth */
  router.post('/payments/:channel/notify', async (req, res) => { // 路由 POST /payments/:channel/notify：注册入口并绑定鉴权与处理逻辑
    const channel = req.params.channel as ExtChannelId; // 保存 channel：承载本步骤的计算结果供后续使用
    const adapter = getAdapter(channel); // 保存 adapter：承载本步骤的计算结果供后续使用
    if (!adapter) throw new AppError('NOT_FOUND', '不支持的支付渠道'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (!adapter.configured(deps.env)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('PAYMENT_NOTIFY_NOT_CONFIGURED', `${adapter.label}回调未配置`, { provider: channel }); // 业务拒绝 PAYMENT_NOTIFY_NOT_CONFIGURED：以统一错误码终止当前请求
    } // 结束函数体：本层作用域收尾
    const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}); // 保存 rawBody：承载本步骤的计算结果供后续使用
    const headers: Record<string, string | undefined> = { // 保存 headers：承载本步骤的计算结果供后续使用
      'paypal-transmission-id': req.header('paypal-transmission-id'), // 字面量：提供配置值或展示文案
      'paypal-transmission-time': req.header('paypal-transmission-time'), // 字面量：提供配置值或展示文案
      'paypal-cert-url': req.header('paypal-cert-url'), // 字面量：提供配置值或展示文案
      'paypal-auth-algo': req.header('paypal-auth-algo'), // 字面量：提供配置值或展示文案
      'paypal-cert-serial': req.header('paypal-cert-serial'), // 字面量：提供配置值或展示文案
      'paypal-transmission-sig': req.header('paypal-transmission-sig'), // 字面量：提供配置值或展示文案
      'stripe-signature': req.header('stripe-signature'), // 字面量：提供配置值或展示文案
    }; // 结束代码块：本层作用域收尾

    const payload = await adapter.parseNotify(deps.env, headers, rawBody, req.body); // 保存 payload：承载本步骤的计算结果供后续使用
    const intent = getExtIntent(deps, payload.intentId); // 保存 intent：承载本步骤的计算结果供后续使用
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (intent.provider !== adapter.id) throw new AppError('CONFLICT', '支付单渠道不匹配'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    if (intent.amount_cents !== payload.amountCents) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('CONFLICT', '回调金额与支付单不一致', { expected: intent.amount_cents, actual: payload.amountCents }); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    if (payload.currency && intent.currency !== payload.currency) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('CONFLICT', '回调币种与支付单不一致', { expected: intent.currency, actual: payload.currency }); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾

    if (intent.status === 'paid') { // 条件分支：仅在满足业务前置条件时继续
      recordExtEvent(deps, intent.id, adapter.id, 'replay', { providerTxnId: payload.providerTxnId }); // 业务步骤：推进当前流程的下一项处理
      ack(adapter, res, { ok: true, replayed: true }); // 业务步骤：推进当前流程的下一项处理
      return; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    if (payload.status !== 'paid') { // 条件分支：仅在满足业务前置条件时继续
      recordExtEvent(deps, intent.id, adapter.id, 'ignored', { status: payload.status }); // 业务步骤：推进当前流程的下一项处理
      ack(adapter, res, { ok: true, replayed: false, ignored: true }); // 业务步骤：推进当前流程的下一项处理
      return; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    const { replayed } = fulfillExtIntent(deps, intent, payload.providerTxnId); // 解构依赖：从模块或上下文取出所需成员
    ack(adapter, res, { ok: true, replayed }); // 业务步骤：推进当前流程的下一项处理
  }); // 结束代码块：本层作用域收尾

  /** 退款：运营权限 + 幂等；未配置渠道 503，已退款 409 */
  router.post('/payments/ext/intents/:id/refund', requireAuth, requirePermission('commerce:write'), idempotency, async (req, res) => { // 路由 POST /payments/ext/intents/:id/refund：注册入口并绑定鉴权与处理逻辑
    const intent = getExtIntent(deps, String(req.params.id)); // 保存 intent：承载本步骤的计算结果供后续使用
    if (!intent) throw new AppError('NOT_FOUND', '支付单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    const adapter = getAdapter(intent.provider); // 保存 adapter：承载本步骤的计算结果供后续使用
    if (!adapter) throw new AppError('VALIDATION_FAILED', '该渠道不支持在线退款'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    if (!adapter.configured(deps.env)) throw new AppError('PROVIDER_NOT_CONFIGURED', `${adapter.label}未配置`, { provider: intent.provider }); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
    if (intent.status !== 'paid') throw new AppError('CONFLICT', '仅已支付订单可退款'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    if (intent.refund_status === 'processed') throw new AppError('CONFLICT', '订单已退款，请勿重复操作'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求

    const body = parse(z.object({ reason: z.string().max(128).optional() }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const reason = body.reason?.trim() || '用户申请退款'; // 保存 reason：承载本步骤的计算结果供后续使用
    const request = adapter.buildRefundRequest(deps.env, intent, intent.amount_cents, reason); // 保存 request：承载本步骤的计算结果供后续使用
    const outcome = await adapter.executeRefund(deps.env, request); // 保存 outcome：承载本步骤的计算结果供后续使用

    const refund = recordRefund(deps, { // 保存 refund：承载本步骤的计算结果供后续使用
      intentId: intent.id, // 对象字段：声明结构中的一项数据
      provider: intent.provider, // 对象字段：声明结构中的一项数据
      amountCents: intent.amount_cents, // 对象字段：声明结构中的一项数据
      status: outcome.ok ? 'processed' : 'failed', // 对象字段：声明结构中的一项数据
      providerRefundId: outcome.providerRefundId ?? null, // 对象字段：声明结构中的一项数据
      reason, // 业务步骤：推进当前流程的下一项处理
      payload: outcome.raw, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    if (outcome.ok) { // 条件分支：仅在满足业务前置条件时继续
      markIntentRefunded(deps, intent.id, 'processed'); // 业务步骤：推进当前流程的下一项处理
      reverseRecharge(deps, intent); // 业务步骤：推进当前流程的下一项处理
    } else { // 其他分支：处理不满足前置条件的路径
      markIntentRefunded(deps, intent.id, 'failed'); // 业务步骤：推进当前流程的下一项处理
    } // 结束条件分支：本层作用域收尾
    res.status(outcome.ok ? 200 : 502).json({ ok: outcome.ok, refund: { id: refund.id, replayed: refund.replayed, provider_refund_id: outcome.providerRefundId ?? null } }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾

  return router; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 按适配器应答形态回复：聚合支付回纯文本 success，国际渠道回 JSON */
function ack(adapter: { ack: 'text-success' | 'json' }, res: { type(t: string): unknown; send(b: unknown): unknown; json(b: unknown): unknown }, body: Record<string, unknown>): void { // 定义函数 ack：封装可复用业务步骤
  if (adapter.ack === 'text-success') { // 条件分支：仅在满足业务前置条件时继续
    res.type('text/plain'); // 输出响应：把处理结果写回 HTTP 客户端
    res.send('success'); // 输出响应：把处理结果写回 HTTP 客户端
    return; // 返回结果：把本步骤产物交给调用方
  } // 结束条件分支：本层作用域收尾
  res.json(body); // 输出响应：把处理结果写回 HTTP 客户端
} // 结束代码块：本层作用域收尾
