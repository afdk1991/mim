/** 支付宝企业支付适配：电脑网站 page.pay + 手机网站 wap.pay，RSA2 签名 / 验签 / 退款 */

import { sign, verify } from 'node:crypto'; // 引入依赖：声明本文件使用的外部能力
import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import type { ChannelAdapter, ExtIntentRow, NotifyPayload, RefundOutcome, RefundRequest } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import { // 引入依赖：声明本文件使用的外部能力
  assembleUrl, // 业务步骤：推进当前流程的下一项处理
  canonicalSorted, // 业务步骤：推进当前流程的下一项处理
  centsToYuan, // 业务步骤：推进当前流程的下一项处理
  missingEnv, // 业务步骤：推进当前流程的下一项处理
  requireConfigured, // 业务步骤：推进当前流程的下一项处理
  upstreamJson, // 业务步骤：推进当前流程的下一项处理
  yuanToCents, // 业务步骤：推进当前流程的下一项处理
} from '../util.js'; // 结束代码块：本层作用域收尾

const defaultGateway = 'https://openapi.alipay.com/gateway.do'; // 常量 defaultGateway：保存固定配置或一次性派生值

const gatewayOf = (env: Record<string, string | undefined>): string => // 保存 gatewayOf：承载本步骤的计算结果供后续使用
  (env.MIM_ALIPAY_ENT_GATEWAY ?? '').trim() || defaultGateway; // 业务步骤：推进当前流程的下一项处理

function requiredKeys(env: Record<string, string | undefined>): string[] { // 定义函数 requiredKeys：封装可复用业务步骤
  const notifyUrl = assembleUrl(env, env.MIM_ALIPAY_ENT_NOTIFY_URL, '/api/v1/payments/alipay_ent/notify'); // 保存 notifyUrl：承载本步骤的计算结果供后续使用
  return ['MIM_ALIPAY_ENT_APP_ID', 'MIM_ALIPAY_ENT_PRIVATE_KEY', 'MIM_ALIPAY_ENT_PUBLIC_KEY', ...(notifyUrl ? [] : ['MIM_ALIPAY_ENT_NOTIFY_URL'])]; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

const normalizeKey = (value: string | undefined): string => (value ?? '').replace(/\\n/g, '\n'); // 保存 normalizeKey：承载本步骤的计算结果供后续使用

/** RSA2 签名：canonical 串 RSA-SHA256 后 base64 */
function rsaSign(params: Record<string, string>, privateKey: string): string { // 定义函数 rsaSign：封装可复用业务步骤
  const unsigned = canonicalSorted(params); // 保存 unsigned：承载本步骤的计算结果供后续使用
  return sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64'); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** RSA2 验签：用支付宝公钥校验回调签名 */
function rsaVerify(params: Record<string, string>, publicKey: string, signature: string): boolean { // 定义函数 rsaVerify：封装可复用业务步骤
  const unsigned = canonicalSorted(params); // 保存 unsigned：承载本步骤的计算结果供后续使用
  try { // 异常保护：确保失败路径可回收资源
    return verify('RSA-SHA256', Buffer.from(unsigned), publicKey, Buffer.from(signature, 'base64')); // 返回结果：把本步骤产物交给调用方
  } catch { // 结束代码块：本层作用域收尾
    return false; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
} // 结束函数体：本层作用域收尾

function signedParams( // 定义函数 signedParams：封装可复用业务步骤
  env: Record<string, string | undefined>, // 对象字段：声明结构中的一项数据
  method: string, // 对象字段：声明结构中的一项数据
  bizContent: string, // 对象字段：声明结构中的一项数据
): Record<string, string> { // 调用结束：参数列表与链式调用收尾
  const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
    app_id: env.MIM_ALIPAY_ENT_APP_ID!.trim(), // 对象字段：声明结构中的一项数据
    method, // 业务步骤：推进当前流程的下一项处理
    format: 'JSON', // 对象字段：声明结构中的一项数据
    charset: 'utf-8', // 对象字段：声明结构中的一项数据
    sign_type: 'RSA2', // 对象字段：声明结构中的一项数据
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), // 对象字段：声明结构中的一项数据
    version: '1.0', // 对象字段：声明结构中的一项数据
    notify_url: assembleUrl(env, env.MIM_ALIPAY_ENT_NOTIFY_URL, '/api/v1/payments/alipay_ent/notify'), // 对象字段：声明结构中的一项数据
    biz_content: bizContent, // 对象字段：声明结构中的一项数据
  }; // 结束代码块：本层作用域收尾
  const returnUrl = assembleUrl(env, env.MIM_ALIPAY_ENT_RETURN_URL, '/payments/return'); // 保存 returnUrl：承载本步骤的计算结果供后续使用
  if (returnUrl) params.return_url = returnUrl; // 条件分支：仅在满足业务前置条件时继续
  params.sign = rsaSign(params, normalizeKey(env.MIM_ALIPAY_ENT_PRIVATE_KEY)); // 业务步骤：推进当前流程的下一项处理
  return params; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

export const alipayEntAdapter: ChannelAdapter = { // 业务步骤：推进当前流程的下一项处理
  id: 'alipay_ent', // 对象字段：声明结构中的一项数据
  label: '支付宝企业支付（电脑网站 / 手机网站）', // 对象字段：声明结构中的一项数据
  ack: 'json', // 对象字段：声明结构中的一项数据

  configured(env) { // 业务步骤：推进当前流程的下一项处理
    return missingEnv(env, requiredKeys(env)).length === 0; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  sandbox(env) { // 业务步骤：推进当前流程的下一项处理
    const gateway = gatewayOf(env); // 保存 gateway：承载本步骤的计算结果供后续使用
    return env.MIM_ALIPAY_ENT_SANDBOX === '1' || gateway.includes('sandbox') || gateway.includes('digitalfutures'); // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  async createOrder(env, intent, opts) { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '支付宝企业支付'); // 业务步骤：推进当前流程的下一项处理
    const useWap = opts.channel === 'wap' || opts.channel === 'app'; // 保存 useWap：承载本步骤的计算结果供后续使用
    const method = useWap ? 'alipay.trade.wap.pay' : 'alipay.trade.page.pay'; // 保存 method：承载本步骤的计算结果供后续使用
    const biz = JSON.stringify({ // 保存 biz：承载本步骤的计算结果供后续使用
      out_trade_no: intent.id, // 对象字段：声明结构中的一项数据
      total_amount: centsToYuan(intent.amount_cents), // 对象字段：声明结构中的一项数据
      subject: `Mim 订单 ${intent.id}`, // 对象字段：声明结构中的一项数据
      product_code: useWap ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY', // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    const params = signedParams(env, method, biz); // 保存 params：承载本步骤的计算结果供后续使用
    const payUrl = `${gatewayOf(env)}?${Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')}`;
    return { next: 'redirect', payUrl }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  async parseNotify(env, _headers, rawBody, body): Promise<NotifyPayload> { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '支付宝企业支付'); // 业务步骤：推进当前流程的下一项处理
    const publicKey = normalizeKey(env.MIM_ALIPAY_ENT_PUBLIC_KEY); // 保存 publicKey：承载本步骤的计算结果供后续使用
    const params = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) as Record<string, string>; // 保存 params：承载本步骤的计算结果供后续使用
    const raw = rawBody.trim(); // 保存 raw：承载本步骤的计算结果供后续使用
    if (raw && !Object.keys(params).length) { // 条件分支：仅在满足业务前置条件时继续
      const parsed = new URLSearchParams(raw); // 保存 parsed：承载本步骤的计算结果供后续使用
      for (const [key, value] of parsed.entries()) params[key] = value; // 循环处理：逐项完成批量数据操作
    } // 结束条件分支：本层作用域收尾
    const signature = params.sign ?? ''; // 保存 signature：承载本步骤的计算结果供后续使用
    if (!signature || !rsaVerify(params, publicKey, signature)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', '支付宝企业支付回调验签失败'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    const outTradeNo = params.out_trade_no ?? ''; // 保存 outTradeNo：承载本步骤的计算结果供后续使用
    if (!outTradeNo) throw new AppError('VALIDATION_FAILED', '回调缺少商户订单号'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const paid = params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED'; // 保存 paid：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      intentId: outTradeNo, // 对象字段：声明结构中的一项数据
      amountCents: yuanToCents(params.total_amount ?? '0'), // 对象字段：声明结构中的一项数据
      status: paid ? 'paid' : 'pending', // 对象字段：声明结构中的一项数据
      providerTxnId: params.trade_no || outTradeNo, // 对象字段：声明结构中的一项数据
      raw: params, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  buildRefundRequest(env, intent, amountCents, reason): RefundRequest { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '支付宝企业支付'); // 业务步骤：推进当前流程的下一项处理
    const biz = JSON.stringify({ // 保存 biz：承载本步骤的计算结果供后续使用
      out_trade_no: intent.id, // 对象字段：声明结构中的一项数据
      refund_amount: centsToYuan(amountCents), // 对象字段：声明结构中的一项数据
      refund_reason: reason, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
    const params = signedParams(env, 'alipay.trade.refund', biz); // 保存 params：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      method: 'POST', // 对象字段：声明结构中的一项数据
      url: gatewayOf(env), // 对象字段：声明结构中的一项数据
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, // 对象字段：声明结构中的一项数据
      body: new URLSearchParams(params).toString(), // 对象字段：声明结构中的一项数据
      contentType: 'application/x-www-form-urlencoded', // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  async executeRefund(_env, request): Promise<RefundOutcome> { // 业务步骤：推进当前流程的下一项处理
    const { status, json } = await upstreamJson(request.url, request.headers, request.body, request.contentType); // 解构依赖：从模块或上下文取出所需成员
    const body = (json ?? {}) as { alipay_trade_refund_response?: { code?: string; trade_no?: string; msg?: string } }; // 保存 body：承载本步骤的计算结果供后续使用
    const response = body.alipay_trade_refund_response; // 保存 response：承载本步骤的计算结果供后续使用
    const ok = status >= 200 && status < 300 && response?.code === '10000'; // 保存 ok：承载本步骤的计算结果供后续使用
    return { ok, providerRefundId: response?.trade_no, raw: body }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾
}; // 结束代码块：本层作用域收尾
