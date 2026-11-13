/** 虎皮椒（xunhupay V3）适配：MD5 签名聚合支付，JSON 下单 / form 回调 / JSON 退款 */

import { AppError } from '@mim/core-domain'; // 引入依赖：声明本文件使用的外部能力
import type { ChannelAdapter, ExtIntentRow, NotifyPayload, RefundOutcome, RefundRequest } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import { // 引入依赖：声明本文件使用的外部能力
  assembleUrl, // 业务步骤：推进当前流程的下一项处理
  canonicalSorted, // 业务步骤：推进当前流程的下一项处理
  centsToYuan, // 业务步骤：推进当前流程的下一项处理
  missingEnv, // 业务步骤：推进当前流程的下一项处理
  md5Hex, // 业务步骤：推进当前流程的下一项处理
  nonce, // 业务步骤：推进当前流程的下一项处理
  parseNotifyBody, // 业务步骤：推进当前流程的下一项处理
  requireConfigured, // 业务步骤：推进当前流程的下一项处理
  secureEqualHex, // 业务步骤：推进当前流程的下一项处理
  trimBase, // 业务步骤：推进当前流程的下一项处理
  upstreamJson, // 业务步骤：推进当前流程的下一项处理
  yuanToCents, // 业务步骤：推进当前流程的下一项处理
} from '../util.js'; // 结束代码块：本层作用域收尾

const ORDER_PATH = '/payment/do.html'; // 发起付款（官方文档网关）
const REFUND_PATH = '/payment/refund.html'; // 发起退款（官方文档网关）

const baseOf = (env: Record<string, string | undefined>): string => // 保存 baseOf：承载本步骤的计算结果供后续使用
  trimBase(env.MIM_HUPIJIAO_API_BASE?.trim() || 'https://api.xunhupay.com'); // 调用 trimBase 并处理其返回结果

/** 签名：字典序 k=v 拼接后直接尾部拼接 APPSECRET，MD5 小写（官方 PHP SDK 同款） */
function sign(params: Record<string, unknown>, secret: string): string { // 定义函数 sign：封装可复用业务步骤
  return md5Hex(`${canonicalSorted(params)}${secret}`); // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

function requiredKeys(env: Record<string, string | undefined>): string[] { // 定义函数 requiredKeys：封装可复用业务步骤
  const notifyUrl = assembleUrl(env, env.MIM_HUPIJIAO_NOTIFY_URL, '/api/v1/payments/hupijiao/notify'); // 保存 notifyUrl：承载本步骤的计算结果供后续使用
  return ['MIM_HUPIJIAO_APP_ID', 'MIM_HUPIJIAO_APP_KEY', ...(notifyUrl ? [] : ['MIM_HUPIJIAO_NOTIFY_URL']) ]; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

export const hupijiaoAdapter: ChannelAdapter = { // 业务步骤：推进当前流程的下一项处理
  id: 'hupijiao', // 对象字段：声明结构中的一项数据
  label: '虎皮椒聚合支付（微信 / 支付宝扫码）', // 对象字段：声明结构中的一项数据
  ack: 'text-success', // 对象字段：声明结构中的一项数据

  configured(env) { // 业务步骤：推进当前流程的下一项处理
    return missingEnv(env, requiredKeys(env)).length === 0; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾

  sandbox() { // 业务步骤：推进当前流程的下一项处理
    return false; // 虎皮椒无独立沙箱环境；生产凭证即生产环境
  }, // 结束代码块：本层作用域收尾

  async createOrder(env, intent, opts) { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '虎皮椒'); // 业务步骤：推进当前流程的下一项处理
    const appid = env.MIM_HUPIJIAO_APP_ID!.trim(); // 保存 appid：承载本步骤的计算结果供后续使用
    const secret = env.MIM_HUPIJIAO_APP_KEY!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
    const notifyUrl = assembleUrl(env, env.MIM_HUPIJIAO_NOTIFY_URL, '/api/v1/payments/hupijiao/notify'); // 保存 notifyUrl：承载本步骤的计算结果供后续使用
    const returnUrl = assembleUrl(env, env.MIM_HUPIJIAO_RETURN_URL, '/payments/return'); // 保存 returnUrl：承载本步骤的计算结果供后续使用
    const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
      version: '1.1', // 对象字段：声明结构中的一项数据
      appid, // 业务步骤：推进当前流程的下一项处理
      trade_order_id: intent.id, // 对象字段：声明结构中的一项数据
      total_fee: centsToYuan(intent.amount_cents), // 对象字段：声明结构中的一项数据
      title: `Mim 订单 ${intent.id}`, // 对象字段：声明结构中的一项数据
      time: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
      notify_url: notifyUrl, // 对象字段：声明结构中的一项数据
      nonce_str: nonce(), // 对象字段：声明结构中的一项数据
      attach: intent.purpose, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    if (returnUrl) params.return_url = returnUrl; // 条件分支：仅在满足业务前置条件时继续
    if (opts.channel === 'qr') params.trade_type = 'qr'; // 条件分支：仅在满足业务前置条件时继续
    params.hash = sign(params, secret); // 业务步骤：推进当前流程的下一项处理

    const { status, json } = await upstreamJson( // 解构依赖：从模块或上下文取出所需成员
      `${baseOf(env)}${ORDER_PATH}`, // 业务步骤：推进当前流程的下一项处理
      {}, // 业务步骤：推进当前流程的下一项处理
      JSON.stringify(params), // 业务步骤：推进当前流程的下一项处理
      'application/json', // 字面量：提供配置值或展示文案
    ); // 调用结束：参数列表与链式调用收尾
    const body = (json ?? {}) as { errcode?: number | string; errmsg?: string; url?: string; url_qrcode?: string; openid?: string }; // 保存 body：承载本步骤的计算结果供后续使用
    const errcode = Number(body.errcode ?? -1); // 保存 errcode：承载本步骤的计算结果供后续使用
    if (!statusOk(status) || errcode !== 0 || (!body.url && !body.url_qrcode)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('INTERNAL_ERROR', body.errmsg || '虎皮椒下单失败'); // 业务拒绝 INTERNAL_ERROR：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    return { // 返回结果：把本步骤产物交给调用方
      next: body.url ? 'redirect' : 'qrcode', // 对象字段：声明结构中的一项数据
      payUrl: body.url, // 对象字段：声明结构中的一项数据
      qrText: body.url_qrcode, // 对象字段：声明结构中的一项数据
      providerOrderId: body.openid, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  async parseNotify(env, _headers, rawBody): Promise<NotifyPayload> { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '虎皮椒'); // 业务步骤：推进当前流程的下一项处理
    const secret = env.MIM_HUPIJIAO_APP_KEY!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
    const params = parseNotifyBody(rawBody); // 保存 params：承载本步骤的计算结果供后续使用
    const expected = sign(params, secret); // 保存 expected：承载本步骤的计算结果供后续使用
    if (!params.hash || !secureEqualHex(expected, params.hash)) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', '虎皮椒回调签名验证失败'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    const tradeOrderId = params.trade_order_id ?? ''; // 保存 tradeOrderId：承载本步骤的计算结果供后续使用
    if (!tradeOrderId) throw new AppError('VALIDATION_FAILED', '回调缺少商户订单号'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const status = params.status === 'OD' ? 'paid' : params.status === 'UD' ? 'failed' : 'pending'; // 保存 status：承载本步骤的计算结果供后续使用
    return { // 返回结果：把本步骤产物交给调用方
      intentId: tradeOrderId, // 对象字段：声明结构中的一项数据
      amountCents: yuanToCents(params.total_fee ?? '0'), // 对象字段：声明结构中的一项数据
      status, // 业务步骤：推进当前流程的下一项处理
      providerTxnId: params.transaction_id || params.open_order_id || tradeOrderId, // 对象字段：声明结构中的一项数据
      raw: params, // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
  }, // 结束代码块：本层作用域收尾

  buildRefundRequest(env, intent, amountCents, reason): RefundRequest { // 业务步骤：推进当前流程的下一项处理
    requireConfigured(env, requiredKeys(env), '虎皮椒'); // 业务步骤：推进当前流程的下一项处理
    const secret = env.MIM_HUPIJIAO_APP_KEY!.trim(); // 保存 secret：承载本步骤的计算结果供后续使用
    const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
      appid: env.MIM_HUPIJIAO_APP_ID!.trim(), // 对象字段：声明结构中的一项数据
      trade_order_id: intent.id, // 对象字段：声明结构中的一项数据
      reason, // 业务步骤：推进当前流程的下一项处理
      time: String(Math.floor(Date.now() / 1000)), // 对象字段：声明结构中的一项数据
      nonce_str: nonce(), // 对象字段：声明结构中的一项数据
    }; // 结束代码块：本层作用域收尾
    if (amountCents !== intent.amount_cents) params.refund_fee = centsToYuan(amountCents); // 条件分支：仅在满足业务前置条件时继续
    params.hash = sign(params, secret); // 业务步骤：推进当前流程的下一项处理
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
    const body = (json ?? {}) as { errcode?: number | string; errmsg?: string; out_refund_no?: string }; // 保存 body：承载本步骤的计算结果供后续使用
    const ok = Number(body.errcode ?? -1) === 0; // 保存 ok：承载本步骤的计算结果供后续使用
    return { ok, providerRefundId: body.out_refund_no, raw: body }; // 返回结果：把本步骤产物交给调用方
  }, // 结束代码块：本层作用域收尾
}; // 结束代码块：本层作用域收尾

function statusOk(status: number): boolean { // 定义函数 statusOk：封装可复用业务步骤
  return status >= 200 && status < 300; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾
