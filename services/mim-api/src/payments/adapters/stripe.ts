/** Stripe 适配：PaymentIntent 下单 / Webhook HMAC 验签 / 退款 */

import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import type { ChannelAdapter, ExtIntentRow, NotifyPayload, RefundOutcome, RefundRequest } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import { hmacSha256Hex, missingEnv, requireConfigured, secureEqualHex, trimBase, upstreamJson } from '../util.js'; // 引入依赖：声明本文件使用的外部能力

const baseOf = (env: Record<string, string | undefined>): string => // 保存 baseOf：承载本步骤的计算结果供后续使用
  trimBase(env.MIM_STRIPE_API_BASE?.trim() || 'https://api.stripe.com');

const TOLERANCE_SECONDS = 300; // 时间戳漂移容忍 5 分钟，防重放

function requiredKeys(): string[] { // 定义函数 requiredKeys：封装可复用业务步骤
  return ['MIM_STRIPE_SECRET_KEY', 'MIM_STRIPE_WEBHOOK_SECRET']; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

function parseSignatureHeader(header: string | undefined): { timestamp: string; v1: string | null } { // 定义函数 parseSignatureHeader：封装可复用业务步骤
  if (!header) return { timestamp: '', v1: null }; // 条件分支：仅在满足业务前置条件时继续
  let timestamp = ''; // 保存 timestamp：承载本步骤的计算结果供后续使用
  let v1: string | null = null; // 保存 v1：承载本步骤的计算结果供后续使用
  for (const part of header.split(',')) { // 循环处理：逐项完成批量数据操作
    const [key, value] = part.split('='); // 业务步骤：推进当前流程的下一项处理
    if (key === 't') timestamp = value ?? ''; // 条件分支：仅在满足业务前置条件时继续
    if (key === 'v1') v1 = value ?? null; // 条件分支：仅在满足业务前置条件时继续
  } // 结束循环体：本层作用域收尾
  return { timestamp, v1 }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

export const stripeAdapter: ChannelAdapter = { // 业务步骤：推进当前流程的下一项处理
  id: 'stripe', // 对象字段：声明结构中的一项数据
  label: 'Stripe PaymentIntent（国际卡）', // 对象字段：声明结构中的一项数据
  ack: 'json', // 对象字段：声明结构中的一项数据

  configured(env) { // 业务步骤：推进当前流程的下一项处理
    return missingEnv(env, requiredKeys()).length === 0; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  sandbox(env) { // 业务步骤：推进当前流程的下一项处理
    const key = (env.MIM_STRIPE_SECRET_KEY ?? '').trim(); // 保存 key：承载本步骤的计算结果供后续使用
    return key.startsWith('sk_test_') || env.MIM_PAYMENT_SANDBOX === '1'; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  async createOrder(env, intent, _opts) { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(), 'Stripe'); // 业务步骤：推进当前流程的下一项处理
    const key = env.MIM_STRIPE_SECRET_KEY!.trim(); // 保存 key：承载本步骤的计算结果供后续使用
    const currency = (env.MIM_STRIPE_CURRENCY ?? 'usd').trim().toLowerCase(); // 保存 currency：承载本步骤的计算结果供后续使用
    const returnUrl = (env.MIM_STRIPE_RETURN_URL ?? '').trim(); // 保存 returnUrl：承载本步骤的计算结果供后续使用
    const params = new URLSearchParams({ // 保存 params：承载本步骤的计算结果供后续使用
      amount: String(intent.amount_cents), // 对象字段：声明结构中的一项数据
      currency, // 业务步骤：推进当前流程的下一项处理
      'metadata[order_id]': intent.id, // 字面量：提供配置值或展示文案
      description: `Mim 订单 ${intent.id}`, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    if (returnUrl) params.set('return_url', returnUrl); // 条件分支：仅在满足业务前置条件时继续
    const { status, json } = await upstreamJson( // 解构依赖：从模块或上下文取出所需成员
      `${baseOf(env)}/v1/payment_intents`, // 业务步骤：推进当前流程的下一项处理
      { authorization: `Bearer ${key}` }, // 业务步骤：推进当前流程的下一项处理
      params.toString(), // 业务步骤：推进当前流程的下一项处理
      'application/x-www-form-urlencoded', // 字面量：提供配置值或展示文案
    ); // 调用结束：参数列表与链式调用收尾
    const body = (json ?? {}) as { id?: string; client_secret?: string }; // 保存 body：承载本步骤的计算结果供后续使用
    if (status < 200 || status >= 300 || !body.id || !body.client_secret) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('INTERNAL_ERROR', 'Stripe 下单失败'); // 业务拒绝 INTERNAL_ERROR：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    return { next: 'redirect', providerOrderId: body.id, clientSecret: body.client_secret }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  async parseNotify(env, headers, rawBody, body): Promise<NotifyPayload> { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(), 'Stripe'); // 业务步骤：推进当前流程的下一项处理
    const secret = env.MIM_STRIPE_WEBHOOK_SECRET!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
    const { timestamp, v1 } = parseSignatureHeader(headers['stripe-signature']); // 解构依赖：从模块或上下文取出所需成员
    if (!timestamp || !v1) throw new AppError('FORBIDDEN', 'Stripe 回调缺少签名头'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    const ts = Number(timestamp); // 保存 ts：承载本步骤的计算结果供后续使用
    if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', 'Stripe 回调时间戳过期'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    const expected = hmacSha256Hex(secret, `${timestamp}.${rawBody}`); // 保存 expected：承载本步骤的计算结果供后续使用
    if (!secureEqualHex(expected, v1)) throw new AppError('FORBIDDEN', 'Stripe 回调签名验证失败'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求

    const event = (body ?? {}) as { type?: string; data?: { object?: Record<string, unknown> } }; // 保存 event：承载本步骤的计算结果供后续使用
    const object = event.data?.object ?? {}; // 保存 object：承载本步骤的计算结果供后续使用
    const metadata = (object.metadata ?? {}) as Record<string, string>; // 保存 metadata：承载本步骤的计算结果供后续使用
    const intentId = metadata.order_id ?? ''; // 保存 intentId：承载本步骤的计算结果供后续使用
    if (!intentId) throw new AppError('VALIDATION_FAILED', '回调缺少商户订单号'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const succeeded = event.type === 'payment_intent.succeeded' || event.type === 'checkout.session.completed'; // 保存 succeeded：承载本步骤的计算结果供后续使用
    const amount = Number(object.amount ?? 0); // 保存 amount：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      intentId, // 业务步骤：推进当前流程的下一项处理
      amountCents: Number.isFinite(amount) ? amount : 0, // 对象字段：声明结构中的一项数据
      currency: typeof object.currency === 'string' ? object.currency.toUpperCase() : undefined, // 对象字段：声明结构中的一项数据
      status: succeeded ? 'paid' : 'pending', // 对象字段：声明结构中的一项数据
      providerTxnId: String(object.id ?? intentId), // 对象字段：声明结构中的一项数据
      raw: event, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  buildRefundRequest(env, intent, amountCents, reason): RefundRequest { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(), 'Stripe'); // 业务步骤：推进当前流程的下一项处理
    const params = new URLSearchParams({ // 保存 params：承载本步骤的计算结果供后续使用
      payment_intent: intent.provider_txn_id ?? intent.id, // 对象字段：声明结构中的一项数据
      amount: String(amountCents), // 对象字段：声明结构中的一项数据
      reason, // 业务步骤：推进当前流程的下一项处理
    }); // 结束代码块：本层作用域收尾
    return { // 返回结果：把本步骤产物交给调用方
      method: 'POST', // 对象字段：声明结构中的一项数据
      url: `${baseOf(env)}/v1/refunds`, // 对象字段：声明结构中的一项数据
      headers: { 'Idempotency-Key': `${intent.id}:refund` }, // 对象字段：声明结构中的一项数据
      body: params.toString(), // 对象字段：声明结构中的一项数据
      contentType: 'application/x-www-form-urlencoded', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  async executeRefund(env, request): Promise<RefundOutcome> { // 业务步骤：推进当前流程的下一项处理
    const key = env.MIM_STRIPE_SECRET_KEY!.trim(); // 保存 key：承载本步骤的计算结果供后续使用
    const { status, json } = await upstreamJson( // 解构依赖：从模块或上下文取出所需成员
      request.url, // 业务步骤：推进当前流程的下一项处理
      { ...request.headers, authorization: `Bearer ${key}` }, // 业务步骤：推进当前流程的下一项处理
      request.body, // 业务步骤：推进当前流程的下一项处理
      request.contentType, // 业务步骤：推进当前流程的下一项处理
    ); // 调用结束：参数列表与链式调用收尾
    const body = (json ?? {}) as { id?: string; status?: string }; // 保存 body：承载本步骤的计算结果供后续使用
    const ok = status >= 200 && status < 300 && body.status === 'succeeded'; // 保存 ok：承载本步骤的计算结果供后续使用
    return { ok, providerRefundId: body.id, raw: body }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾
}; // 结束代码块：本层作用域收尾
