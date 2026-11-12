/** PayPal 适配：Orders v2 下单 / Webhook 回调验签 / 捕获退款 */

import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import type { ChannelAdapter, ExtIntentRow, NotifyPayload, RefundOutcome, RefundRequest } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import { centsToYuan, missingEnv, requireConfigured, trimBase, upstreamJson, yuanToCents } from '../util.js'; // 引入依赖：声明本文件使用的外部能力

const baseOf = (env: Record<string, string | undefined>): string => { // 保存 baseOf：承载本步骤的计算结果供后续使用
  const override = (env.MIM_PAYPAL_API_BASE ?? '').trim(); // 保存 override：承载本步骤的计算结果供后续使用
  if (override) return trimBase(override); // 条件分支：仅在满足业务前置条件时继续
  return env.MIM_PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}; // 结束函数体：本层作用域收尾

function requiredKeys(): string[] { // 定义函数 requiredKeys：封装可复用业务步骤
  return ['MIM_PAYPAL_CLIENT_ID', 'MIM_PAYPAL_CLIENT_SECRET', 'MIM_PAYPAL_WEBHOOK_ID']; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

async function accessToken(env: Record<string, string | undefined>): Promise<string> { // 定义函数 accessToken：封装可复用业务步骤
  const clientId = env.MIM_PAYPAL_CLIENT_ID!.trim(); // 保存 clientId：承载本步骤的计算结果供后续使用
  const secret = env.MIM_PAYPAL_CLIENT_SECRET!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64'); // 保存 basic：承载本步骤的计算结果供后续使用
  const { status, json } = await upstreamJson( // 解构依赖：从模块或上下文取出所需成员
    `${baseOf(env)}/v1/oauth2/token`, // 业务步骤：推进当前流程的下一项处理
    { authorization: `Basic ${basic}`, accept: 'application/json' }, // 业务步骤：推进当前流程的下一项处理
    'grant_type=client_credentials', // 字面量：提供配置值或展示文案
    'application/x-www-form-urlencoded', // 字面量：提供配置值或展示文案
  ); // 调用结束：参数列表与链式调用收尾
  const body = (json ?? {}) as { access_token?: string }; // 保存 body：承载本步骤的计算结果供后续使用
  if (status < 200 || status >= 300 || !body.access_token) { // 条件分支：仅在满足业务前置条件时继续
    throw new AppError('INTERNAL_ERROR', 'PayPal 获取访问令牌失败'); // 业务拒绝 INTERNAL_ERROR：以统一错误码终止当前请求
  } // 结束条件分支：本层作用域收尾
  return body.access_token; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

interface CaptureUnit { // 声明类型 CaptureUnit：约束跨模块数据结构
  reference_id?: string; // 业务步骤：推进当前流程的下一项处理
  custom_id?: string; // 业务步骤：推进当前流程的下一项处理
  amount?: { currency_code?: string; value?: string }; // 业务步骤：推进当前流程的下一项处理
} // 结束代码块：本层作用域收尾

function extractUnit(resource: Record<string, unknown>): CaptureUnit { // 定义函数 extractUnit：封装可复用业务步骤
  const units = (resource.purchase_units ?? []) as CaptureUnit[]; // 保存 units：承载本步骤的计算结果供后续使用
  return units[0] ?? {}; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

export const paypalAdapter: ChannelAdapter = { // 业务步骤：推进当前流程的下一项处理
  id: 'paypal', // 对象字段：声明结构中的一项数据
  label: 'PayPal 在线收银（国际卡 / 钱包）', // 对象字段：声明结构中的一项数据
  ack: 'json', // 对象字段：声明结构中的一项数据

  configured(env) { // 业务步骤：推进当前流程的下一项处理
    return missingEnv(env, requiredKeys()).length === 0; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  sandbox(env) { // 业务步骤：推进当前流程的下一项处理
    return env.MIM_PAYPAL_MODE !== 'live'; // 默认 sandbox；显式 live 才是生产
  }, // 结束代码块：本层作用域收尾

  async createOrder(env, intent, _opts) { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(), 'PayPal'); // 业务步骤：推进当前流程的下一项处理
    const token = await accessToken(env); // 保存 token：承载本步骤的计算结果供后续使用
    const currency = (env.MIM_PAYPAL_CURRENCY ?? 'USD').trim().toUpperCase(); // 保存 currency：承载本步骤的计算结果供后续使用
    const returnUrl = (env.MIM_PAYPAL_RETURN_URL ?? '').trim(); // 保存 returnUrl：承载本步骤的计算结果供后续使用
    const cancelUrl = (env.MIM_PAYPAL_CANCEL_URL ?? '').trim(); // 保存 cancelUrl：承载本步骤的计算结果供后续使用
    const payload = { // 保存 payload：承载本步骤的计算结果供后续使用
      intent: 'CAPTURE', // 对象字段：声明结构中的一项数据
      purchase_units: [ // 对象字段：声明结构中的一项数据
        { // 业务步骤：推进当前流程的下一项处理
          reference_id: intent.id, // 对象字段：声明结构中的一项数据
          custom_id: intent.id, // 对象字段：声明结构中的一项数据
          amount: { currency_code: currency, value: centsToYuan(intent.amount_cents) }, // 对象字段：声明结构中的一项数据
        }, // 结束代码块：本层作用域收尾
      ], // 集合结束：数组或索引表达式收尾
      application_context: returnUrl || cancelUrl ? { return_url: returnUrl, cancel_url: cancelUrl } : undefined, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    const { status, json } = await upstreamJson( // 解构依赖：从模块或上下文取出所需成员
      `${baseOf(env)}/v2/checkout/orders`, // 业务步骤：推进当前流程的下一项处理
      { authorization: `Bearer ${token}`, accept: 'application/json' }, // 业务步骤：推进当前流程的下一项处理
      JSON.stringify(payload), // 业务步骤：推进当前流程的下一项处理
      'application/json', // 字面量：提供配置值或展示文案
    ); // 调用结束：参数列表与链式调用收尾
    const body = (json ?? {}) as { id?: string; links?: Array<{ rel?: string; href?: string }> }; // 保存 body：承载本步骤的计算结果供后续使用
    const approve = body.links?.find((link) => link.rel === 'approve')?.href; // 保存 approve：承载本步骤的计算结果供后续使用
    if (status < 200 || status >= 300 || !body.id || !approve) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('INTERNAL_ERROR', 'PayPal 下单失败'); // 业务拒绝 INTERNAL_ERROR：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    return { next: 'redirect', payUrl: approve, providerOrderId: body.id }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  async parseNotify(env, headers, rawBody, body): Promise<NotifyPayload> { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(), 'PayPal'); // 业务步骤：推进当前流程的下一项处理
    const event = (body ?? {}) as { event_type?: string; resource?: Record<string, unknown> }; // 保存 event：承载本步骤的计算结果供后续使用
    const resource = event.resource ?? {}; // 保存 resource：承载本步骤的计算结果供后续使用
    // 官方验签：调 verify-webhook-signature 端点；传输头或 webhook id 缺失直接拒绝
    const transmissionId = headers['paypal-transmission-id'] ?? ''; // 保存 transmissionId：承载本步骤的计算结果供后续使用
    const transmissionTime = headers['paypal-transmission-time'] ?? ''; // 保存 transmissionTime：承载本步骤的计算结果供后续使用
    const certUrl = headers['paypal-cert-url'] ?? ''; // 保存 certUrl：承载本步骤的计算结果供后续使用
    const authAlgo = headers['paypal-auth-algo'] ?? ''; // 保存 authAlgo：承载本步骤的计算结果供后续使用
    const certSerial = headers['paypal-cert-serial'] ?? ''; // 保存 certSerial：承载本步骤的计算结果供后续使用
    const transmissionSig = headers['paypal-transmission-sig'] ?? ''; // 保存 transmissionSig：承载本步骤的计算结果供后续使用
    if (!transmissionId || !transmissionTime || !certUrl || !transmissionSig) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', 'PayPal 回调缺少验签传输头'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    const token = await accessToken(env); // 保存 token：承载本步骤的计算结果供后续使用
    const verifyBody = { // 保存 verifyBody：承载本步骤的计算结果供后续使用
      webhook_id: env.MIM_PAYPAL_WEBHOOK_ID!.trim(), // 对象字段：声明结构中的一项数据
      transmission_id: transmissionId, // 对象字段：声明结构中的一项数据
      transmission_time: transmissionTime, // 对象字段：声明结构中的一项数据
      cert_url: certUrl, // 对象字段：声明结构中的一项数据
      auth_algo: authAlgo, // 对象字段：声明结构中的一项数据
      cert_serial: certSerial, // 对象字段：声明结构中的一项数据
      transmission_sig: transmissionSig, // 对象字段：声明结构中的一项数据
      webhook_event: JSON.parse(rawBody || '{}') as unknown, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    const { json: verifyJson } = await upstreamJson( // 解构依赖：从模块或上下文取出所需成员
      `${baseOf(env)}/v1/notifications/verify-webhook-signature`, // 业务步骤：推进当前流程的下一项处理
      { authorization: `Bearer ${token}`, accept: 'application/json' }, // 业务步骤：推进当前流程的下一项处理
      JSON.stringify(verifyBody), // 业务步骤：推进当前流程的下一项处理
      'application/json', // 字面量：提供配置值或展示文案
    ); // 调用结束：参数列表与链式调用收尾
    const verify = (verifyJson ?? {}) as { verification_status?: string }; // 保存 verify：承载本步骤的计算结果供后续使用
    if (verify.verification_status !== 'SUCCESS') { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', 'PayPal 回调验签未通过'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    const unit = extractUnit(resource); // 保存 unit：承载本步骤的计算结果供后续使用
    const intentId = unit.reference_id || unit.custom_id || ''; // 保存 intentId：承载本步骤的计算结果供后续使用
    if (!intentId) throw new AppError('VALIDATION_FAILED', '回调缺少商户订单号'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const completed = event.event_type === 'PAYMENT.CAPTURE.COMPLETED' || event.event_type === 'CHECKOUT.ORDER.APPROVED'; // 保存 completed：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      intentId, // 业务步骤：推进当前流程的下一项处理
      amountCents: yuanToCents(unit.amount?.value ?? '0'), // 对象字段：声明结构中的一项数据
      currency: unit.amount?.currency_code, // 对象字段：声明结构中的一项数据
      status: completed ? 'paid' : 'pending', // 对象字段：声明结构中的一项数据
      providerTxnId: String(resource.id ?? intentId), // 对象字段：声明结构中的一项数据
      raw: event, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  buildRefundRequest(env, intent): RefundRequest { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(), 'PayPal'); // 业务步骤：推进当前流程的下一项处理
    const captureId = intent.provider_txn_id; // 保存 captureId：承载本步骤的计算结果供后续使用
    if (!captureId) throw new AppError('VALIDATION_FAILED', '缺少渠道交易号，无法发起退款'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const currency = (env.MIM_PAYPAL_CURRENCY ?? 'USD').trim().toUpperCase(); // 保存 currency：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      method: 'POST', // 对象字段：声明结构中的一项数据
      url: `${baseOf(env)}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, // 对象字段：声明结构中的一项数据
      headers: {}, // 令牌在 executeRefund 内补充
      body: JSON.stringify({ amount: { currency_code: currency, value: centsToYuan(intent.amount_cents) } }), // 对象字段：声明结构中的一项数据
      contentType: 'application/json', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  async executeRefund(env, request): Promise<RefundOutcome> { // 业务步骤：推进当前流程的下一项处理
    const token = await accessToken(env); // 保存 token：承载本步骤的计算结果供后续使用
    const { status, json } = await upstreamJson( // 解构依赖：从模块或上下文取出所需成员
      request.url, // 业务步骤：推进当前流程的下一项处理
      { ...request.headers, authorization: `Bearer ${token}`, accept: 'application/json' }, // 业务步骤：推进当前流程的下一项处理
      request.body, // 业务步骤：推进当前流程的下一项处理
      request.contentType, // 业务步骤：推进当前流程的下一项处理
    ); // 调用结束：参数列表与链式调用收尾
    const body = (json ?? {}) as { id?: string; status?: string }; // 保存 body：承载本步骤的计算结果供后续使用
    const ok = status >= 200 && status < 300 && body.status === 'COMPLETED'; // 保存 ok：承载本步骤的计算结果供后续使用
    return { ok, providerRefundId: body.id, raw: body }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾
}; // 结束代码块：本层作用域收尾
