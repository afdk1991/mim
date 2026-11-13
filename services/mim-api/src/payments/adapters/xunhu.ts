/** 讯虎聚合支付适配：HMAC-SHA256 签名（通用聚合支付契约，待真实凭证联调） */

import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import type { ChannelAdapter, ExtIntentRow, NotifyPayload, RefundOutcome, RefundRequest } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import { // 引入依赖：声明本文件使用的外部能力
  assembleUrl, // 业务步骤：推进当前流程的下一项处理
  canonicalSorted, // 业务步骤：推进当前流程的下一项处理
  hmacSha256Hex, // 业务步骤：推进当前流程的下一项处理
  missingEnv, // 业务步骤：推进当前流程的下一项处理
  nonce, // 业务步骤：推进当前流程的下一项处理
  parseNotifyBody, // 业务步骤：推进当前流程的下一项处理
  requireConfigured, // 业务步骤：推进当前流程的下一项处理
  secureEqualHex, // 业务步骤：推进当前流程的下一项处理
  trimBase, // 业务步骤：推进当前流程的下一项处理
  upstreamJson, // 业务步骤：推进当前流程的下一项处理
  yuanToCents, // 业务步骤：推进当前流程的下一项处理
} from '../util.js'; // 结束代码块：本层作用域收尾

const ORDER_PATH = '/api/order/create'; // 通用聚合下单路径，可按渠道后台文档在 env 覆盖
const REFUND_PATH = '/api/refund'; // 通用聚合退款路径

const baseOf = (env: Record<string, string | undefined>): string => // 保存 baseOf：承载本步骤的计算结果供后续使用
  trimBase(env.MIM_XUNHU_API_BASE?.trim() || 'https://api.xunhu-pay.example'); // 调用 trimBase 并处理其返回结果

/** HMAC-SHA256：canonical 串以密钥做 HMAC，hex 输出 */
function sign(params: Record<string, unknown>, secret: string): string { // 定义函数 sign：封装可复用业务步骤
  return hmacSha256Hex(secret, canonicalSorted(params)); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

function requiredKeys(env: Record<string, string | undefined>): string[] { // 定义函数 requiredKeys：封装可复用业务步骤
  const notifyUrl = assembleUrl(env, env.MIM_XUNHU_NOTIFY_URL, '/api/v1/payments/xunhu/notify'); // 保存 notifyUrl：承载本步骤的计算结果供后续使用
  return ['MIM_XUNHU_APP_ID', 'MIM_XUNHU_APP_KEY', ...(notifyUrl ? [] : ['MIM_XUNHU_NOTIFY_URL'])]; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

export const xunhuAdapter: ChannelAdapter = { // 业务步骤：推进当前流程的下一项处理
  id: 'xunhu', // 对象字段：声明结构中的一项数据
  label: '讯虎聚合支付', // 对象字段：声明结构中的一项数据
  ack: 'text-success', // 对象字段：声明结构中的一项数据

  configured(env) { // 业务步骤：推进当前流程的下一项处理
    return missingEnv(env, requiredKeys(env)).length === 0; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  sandbox(env) { // 业务步骤：推进当前流程的下一项处理
    return env.MIM_PAYMENT_SANDBOX === '1'; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  async createOrder(env, intent, _opts) { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '讯虎'); // 业务步骤：推进当前流程的下一项处理
    const appid = env.MIM_XUNHU_APP_ID!.trim(); // 保存 appid：承载本步骤的计算结果供后续使用
    const secret = env.MIM_XUNHU_APP_KEY!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
    const notifyUrl = assembleUrl(env, env.MIM_XUNHU_NOTIFY_URL, '/api/v1/payments/xunhu/notify'); // 保存 notifyUrl：承载本步骤的计算结果供后续使用
    const returnUrl = assembleUrl(env, env.MIM_XUNHU_RETURN_URL, '/payments/return'); // 保存 returnUrl：承载本步骤的计算结果供后续使用
    const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
      appid, // 业务步骤：推进当前流程的下一项处理
      out_trade_no: intent.id, // 对象字段：声明结构中的一项数据
      amount_cents: String(intent.amount_cents), // 对象字段：声明结构中的一项数据
      currency: intent.currency, // 对象字段：声明结构中的一项数据
      title: `Mim 订单 ${intent.id}`, // 对象字段：声明结构中的一项数据
      notify_url: notifyUrl, // 对象字段：声明结构中的一项数据
      nonce: nonce(), // 对象字段：声明结构中的一项数据
      timestamp: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    if (returnUrl) params.return_url = returnUrl; // 条件分支：仅在满足业务前置条件时继续
    params.sign = sign(params, secret); // 业务步骤：推进当前流程的下一项处理

    const { status, json } = await upstreamJson(`${baseOf(env)}${ORDER_PATH}`, {}, JSON.stringify(params), 'application/json'); // 解构依赖：从模块或上下文取出所需成员
    const body = (json ?? {}) as { code?: number | string; message?: string; pay_url?: string; qr_code?: string; order_id?: string }; // 保存 body：承载本步骤的计算结果供后续使用
    const code = Number(body.code ?? -1); // 保存 code：承载本步骤的计算结果供后续使用
    if (status < 200 || status >= 300 || code !== 0 || (!body.pay_url && !body.qr_code)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('INTERNAL_ERROR', body.message || '讯虎下单失败'); // 业务拒绝 INTERNAL_ERROR：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    return { // 返回结果：把本步骤产物交给调用方
      next: body.pay_url ? 'redirect' : 'qrcode', // 对象字段：声明结构中的一项数据
      payUrl: body.pay_url, // 对象字段：声明结构中的一项数据
      qrText: body.qr_code, // 对象字段：声明结构中的一项数据
      providerOrderId: body.order_id, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  async parseNotify(env, _headers, rawBody): Promise<NotifyPayload> { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '讯虎'); // 业务步骤：推进当前流程的下一项处理
    const secret = env.MIM_XUNHU_APP_KEY!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
    const params = parseNotifyBody(rawBody); // 保存 params：承载本步骤的计算结果供后续使用
    const expected = sign(params, secret); // 保存 expected：承载本步骤的计算结果供后续使用
    if (!params.sign || !secureEqualHex(expected, params.sign)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', '讯虎回调签名验证失败'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    const outTradeNo = params.out_trade_no ?? ''; // 保存 outTradeNo：承载本步骤的计算结果供后续使用
    if (!outTradeNo) throw new AppError('VALIDATION_FAILED', '回调缺少商户订单号'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const paid = params.status === 'paid' || params.status === 'SUCCESS' || params.status === 'OD'; // 保存 paid：承载本步骤的计算结果供后续使用
    const failed = params.status === 'failed' || params.status === 'UD' || params.status === 'CD'; // 保存 failed：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      intentId: outTradeNo, // 对象字段：声明结构中的一项数据
      amountCents: params.amount_cents ? Number(params.amount_cents) : yuanToCents(params.amount ?? '0'), // 对象字段：声明结构中的一项数据
      status: paid ? 'paid' : failed ? 'failed' : 'pending', // 对象字段：声明结构中的一项数据
      providerTxnId: params.transaction_id || params.trade_no || outTradeNo, // 对象字段：声明结构中的一项数据
      raw: params, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  buildRefundRequest(env, intent, amountCents, reason): RefundRequest { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '讯虎'); // 业务步骤：推进当前流程的下一项处理
    const secret = env.MIM_XUNHU_APP_KEY!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
    const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
      appid: env.MIM_XUNHU_APP_ID!.trim(), // 对象字段：声明结构中的一项数据
      out_trade_no: intent.id, // 对象字段：声明结构中的一项数据
      amount_cents: String(amountCents), // 对象字段：声明结构中的一项数据
      reason, // 业务步骤：推进当前流程的下一项处理
      nonce: nonce(), // 对象字段：声明结构中的一项数据
      timestamp: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    params.sign = sign(params, secret); // 业务步骤：推进当前流程的下一项处理
    return { // 返回结果：把本步骤产物交给调用方
      method: 'POST', // 对象字段：声明结构中的一项数据
      url: `${baseOf(env)}${REFUND_PATH}`, // 对象字段：声明结构中的一项数据
      headers: {}, // 对象字段：声明结构中的一项数据
      body: JSON.stringify(params), // 对象字段：声明结构中的一项数据
      contentType: 'application/json', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  async executeRefund(_env, request): Promise<RefundOutcome> { // 业务步骤：推进当前流程的下一项处理
    const { json } = await upstreamJson(request.url, request.headers, request.body, request.contentType); // 解构依赖：从模块或上下文取出所需成员
    const body = (json ?? {}) as { code?: number | string; refund_id?: string; message?: string }; // 保存 body：承载本步骤的计算结果供后续使用
    const ok = Number(body.code ?? -1) === 0; // 保存 ok：承载本步骤的计算结果供后续使用
    return { ok, providerRefundId: body.refund_id, raw: body }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾
}; // 结束代码块：本层作用域收尾
