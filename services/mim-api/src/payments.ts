/** 支付适配层：渠道注册、下单、回调验签与履约分账 */

import { createDecipheriv, createHmac, randomBytes, randomUUID, sign, verify } from 'node:crypto'; // 沙箱 HMAC、支付宝/微信 RSA 签名与微信回调解密
import { AppError } from '@mim/core-domain'; // 统一业务异常
import type { ApiDeps } from './types.js'; // 依赖容器
import { channelMatrix } from './payments/registry.js'; // 九渠道矩阵（含既有四渠道配置判定）

export type PayProvider = 'alipay' | 'wechat' | 'manual' | 'sandbox'; // 四类渠道
export type PayPurpose = 'shop_order' | 'vip' | 'asset' | 'recharge'; // 四类支付目的

export interface PayIntentRow { // 声明类型 PayIntentRow：约束跨模块数据结构
  id: string; // 对象字段：声明结构中的一项数据
  user_id: string; // 对象字段：声明结构中的一项数据
  purpose: PayPurpose; // 对象字段：声明结构中的一项数据
  ref_id: string; // 对象字段：声明结构中的一项数据
  provider: PayProvider; // 对象字段：声明结构中的一项数据
  amount_cents: number; // 对象字段：声明结构中的一项数据
  status: 'pending' | 'paid' | 'failed' | 'cancelled'; // 对象字段：声明结构中的一项数据
  pay_url: string | null; // 对象字段：声明结构中的一项数据
  qr_text: string | null; // 对象字段：声明结构中的一项数据
  provider_txn_id: string | null; // 对象字段：声明结构中的一项数据
  expires_at: string | null; // 对象字段：声明结构中的一项数据
  created_at: string; // 对象字段：声明结构中的一项数据
  paid_at: string | null; // 对象字段：声明结构中的一项数据
} // 结束代码块：本层作用域收尾

const now = (deps: ApiDeps) => deps.now?.() ?? new Date().toISOString(); // 可注入时钟

/** 渠道元数据：九渠道矩阵（既有四渠道 + 扩展五渠道），前端据此置灰与展示说明，不暴露任何密钥。 */
export function paymentChannels(env: Record<string, string | undefined>) { // 定义函数 paymentChannels：封装可复用业务步骤
  return channelMatrix(env); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 支付宝 RSA2 签名：把参数按字典序拼接后签名，返回完整表单参数。 */
function alipaySignedParams(env: Record<string, string | undefined>, method: string, bizContent: string): Record<string, string> { // 定义函数 alipaySignedParams：封装可复用业务步骤
  const params: Record<string, string> = { // 保存 params：承载本步骤的计算结果供后续使用
    app_id: env.MIM_ALIPAY_APP_ID ?? '', // 对象字段：声明结构中的一项数据
    method, // 业务步骤：推进当前流程的下一项处理
    format: 'JSON', // 对象字段：声明结构中的一项数据
    charset: 'utf-8', // 对象字段：声明结构中的一项数据
    sign_type: 'RSA2', // 对象字段：声明结构中的一项数据
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), // 对象字段：声明结构中的一项数据
    version: '1.0', // 对象字段：声明结构中的一项数据
    notify_url: env.MIM_ALIPAY_NOTIFY_URL ?? '', // 对象字段：声明结构中的一项数据
    biz_content: bizContent, // 对象字段：声明结构中的一项数据
  }; // 结束代码块：本层作用域收尾
  const unsigned = Object.keys(params) // 保存 unsigned：承载本步骤的计算结果供后续使用
    .filter((key) => key !== 'sign' && params[key] !== '') // 链式调用：在上一步结果上继续处理
    .sort() // 链式调用：在上一步结果上继续处理
    .map((key) => `${key}=${params[key]}`) // 链式调用：在上一步结果上继续处理
    .join('&'); // 链式调用：在上一步结果上继续处理
  const privateKey = (env.MIM_ALIPAY_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'); // 保存 privateKey：承载本步骤的计算结果供后续使用
  params.sign = sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64'); // 业务步骤：推进当前流程的下一项处理
  return params; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 支付宝当面付预下单：返回二维码内容；网络失败按上游错误透出。 */
async function createAlipay(env: Record<string, string | undefined>, intent: PayIntentRow): Promise<{ qrText: string }> { // 定义函数 createAlipay：封装可复用业务步骤
  if (!env.MIM_ALIPAY_APP_ID || !env.MIM_ALIPAY_PRIVATE_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', '支付宝渠道未配置'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  const biz = JSON.stringify({ out_trade_no: intent.id, total_amount: (intent.amount_cents / 100).toFixed(2), subject: `Mim 订单 ${intent.id}` }); // 保存 biz：承载本步骤的计算结果供后续使用
  const params = alipaySignedParams(env, 'alipay.trade.precreate', biz); // 保存 params：承载本步骤的计算结果供后续使用
  const res = await fetch('https://openapi.alipay.com/gateway.do', { // 常量 res：保存固定配置或一次性派生值
    method: 'POST', // 对象字段：声明结构中的一项数据
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, // 对象字段：声明结构中的一项数据
    body: new URLSearchParams(params), // 对象字段：声明结构中的一项数据
  }); // 结束代码块：本层作用域收尾
  const json = (await res.json()) as { alipay_trade_precreate_response?: { code?: string; msg?: string; qr_code?: string } }; // 保存 json：承载本步骤的计算结果供后续使用
  const body = json.alipay_trade_precreate_response; // 保存 body：承载本步骤的计算结果供后续使用
  if (!res.ok || !body || body.code !== '10000' || !body.qr_code) throw new AppError('INTERNAL_ERROR', body?.msg ?? '支付宝下单失败'); // 业务拒绝 INTERNAL_ERROR：以统一错误码终止当前请求
  return { qrText: body.qr_code }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 支付宝手机网站支付：返回可直接跳转的网关地址，供移动端唤起支付宝。 */
function createAlipayWap(env: Record<string, string | undefined>, intent: PayIntentRow): { payUrl: string } { // 定义函数 createAlipayWap：封装可复用业务步骤
  if (!env.MIM_ALIPAY_APP_ID || !env.MIM_ALIPAY_PRIVATE_KEY) throw new AppError('PROVIDER_NOT_CONFIGURED', '支付宝渠道未配置'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  const biz = JSON.stringify({ // 保存 biz：承载本步骤的计算结果供后续使用
    out_trade_no: intent.id, // 对象字段：声明结构中的一项数据
    total_amount: (intent.amount_cents / 100).toFixed(2), // 对象字段：声明结构中的一项数据
    subject: `Mim 订单 ${intent.id}`, // 对象字段：声明结构中的一项数据
    product_code: 'QUICK_WAP_WAY', // 对象字段：声明结构中的一项数据
  }); // 结束代码块：本层作用域收尾
  const params = alipaySignedParams(env, 'alipay.trade.wap.pay', biz); // 保存 params：承载本步骤的计算结果供后续使用
  const query = Object.entries(params) // 保存 query：承载本步骤的计算结果供后续使用
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`) // 链式调用：在上一步结果上继续处理
    .join('&'); // 链式调用：在上一步结果上继续处理
  return { payUrl: `https://openapi.alipay.com/gateway.do?${query}` }; // 返回当前函数的处理结果
} // 结束代码块：本层作用域收尾

/** 微信支付 v3 请求签名：METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n。 */
function wechatAuthorization(env: Record<string, string | undefined>, method: string, path: string, body: string): string { // 定义函数 wechatAuthorization：封装可复用业务步骤
  const mchid = env.MIM_WECHAT_MCH_ID ?? ''; // 保存 mchid：承载本步骤的计算结果供后续使用
  const serialNo = env.MIM_WECHAT_SERIAL_NO ?? ''; // 保存 serialNo：承载本步骤的计算结果供后续使用
  const privateKey = (env.MIM_WECHAT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'); // 保存 privateKey：承载本步骤的计算结果供后续使用
  const timestamp = String(Math.floor(Date.now() / 1000)); // 保存 timestamp：承载本步骤的计算结果供后续使用
  const nonce = randomBytes(16).toString('hex'); // 保存 nonce：承载本步骤的计算结果供后续使用
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`; // 保存 message：承载本步骤的计算结果供后续使用
  const signature = sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64'); // 保存 signature：承载本步骤的计算结果供后续使用
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 微信 Native 下单：返回 code_url，前端渲染二维码。 */
async function createWechatNative(env: Record<string, string | undefined>, intent: PayIntentRow): Promise<{ qrText: string }> { // 定义函数 createWechatNative：封装可复用业务步骤
  const appid = env.MIM_WECHAT_APP_ID; // 保存 appid：承载本步骤的计算结果供后续使用
  const mchid = env.MIM_WECHAT_MCH_ID; // 保存 mchid：承载本步骤的计算结果供后续使用
  const serialNo = env.MIM_WECHAT_SERIAL_NO; // 保存 serialNo：承载本步骤的计算结果供后续使用
  const privateKey = env.MIM_WECHAT_PRIVATE_KEY; // 保存 privateKey：承载本步骤的计算结果供后续使用
  const notifyUrl = env.MIM_WECHAT_NOTIFY_URL; // 保存 notifyUrl：承载本步骤的计算结果供后续使用
  if (!appid || !mchid || !serialNo || !privateKey || !notifyUrl) throw new AppError('PROVIDER_NOT_CONFIGURED', '微信支付未配置 AppID / 商户号 / 证书 / 回调地址'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  const path = '/v3/pay/transactions/native'; // 保存 path：承载本步骤的计算结果供后续使用
  const body = JSON.stringify({ // 保存 body：承载本步骤的计算结果供后续使用
    appid, // 业务步骤：推进当前流程的下一项处理
    mchid, // 业务步骤：推进当前流程的下一项处理
    description: `Mim 订单 ${intent.id}`, // 对象字段：声明结构中的一项数据
    out_trade_no: intent.id, // 对象字段：声明结构中的一项数据
    notify_url: notifyUrl, // 对象字段：声明结构中的一项数据
    amount: { total: intent.amount_cents, currency: 'CNY' }, // 对象字段：声明结构中的一项数据
  }); // 结束代码块：本层作用域收尾
  const res = await fetch(`https://api.mch.weixin.qq.com${path}`, { // 常量 res：保存固定配置或一次性派生值
    method: 'POST', // 对象字段：声明结构中的一项数据
    headers: { // 对象字段：声明结构中的一项数据
      authorization: wechatAuthorization(env, 'POST', path, body), // 对象字段：声明结构中的一项数据
      'content-type': 'application/json', // 字面量：提供配置值或展示文案
      accept: 'application/json', // 对象字段：声明结构中的一项数据
    }, // 结束代码块：本层作用域收尾
    body, // 业务步骤：推进当前流程的下一项处理
  }); // 结束代码块：本层作用域收尾
  const json = (await res.json()) as { code_url?: string; message?: string; code?: string }; // 保存 json：承载本步骤的计算结果供后续使用
  if (!res.ok || !json.code_url) throw new AppError('INTERNAL_ERROR', json.message ?? json.code ?? '微信下单失败'); // 业务拒绝 INTERNAL_ERROR：以统一错误码终止当前请求
  return { qrText: json.code_url }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 微信回调验签：用平台公钥验证原始报文签名。 */
export function verifyWechatSignature( // 定义函数 verifyWechatSignature：封装可复用业务步骤
  env: Record<string, string | undefined>, // 对象字段：声明结构中的一项数据
  headers: { timestamp?: string; nonce?: string; signature?: string; serial?: string }, // 对象字段：声明结构中的一项数据
  rawBody: string, // 对象字段：声明结构中的一项数据
): boolean { // 调用结束：参数列表与链式调用收尾
  if (env.MIM_WECHAT_PLATFORM_SERIAL && headers.serial && env.MIM_WECHAT_PLATFORM_SERIAL !== headers.serial) return false; // 条件分支：仅在满足业务前置条件时继续
  const publicKey = (env.MIM_WECHAT_PLATFORM_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'); // 保存 publicKey：承载本步骤的计算结果供后续使用
  if (!publicKey || !headers.timestamp || !headers.nonce || !headers.signature) return false; // 条件分支：仅在满足业务前置条件时继续
  const message = `${headers.timestamp}\n${headers.nonce}\n${rawBody}\n`; // 保存 message：承载本步骤的计算结果供后续使用
  return verify('RSA-SHA256', Buffer.from(message), publicKey, Buffer.from(headers.signature, 'base64')); // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 微信回调资源解密：AES-256-GCM，key 为 APIv3 密钥。 */
export function decryptWechatResource( // 定义函数 decryptWechatResource：封装可复用业务步骤
  apiV3Key: string, // 对象字段：声明结构中的一项数据
  resource: { ciphertext: string; nonce: string; associated_data?: string }, // 对象字段：声明结构中的一项数据
): Record<string, unknown> { // 调用结束：参数列表与链式调用收尾
  const key = Buffer.from(apiV3Key); // 保存 key：承载本步骤的计算结果供后续使用
  if (key.length !== 32) throw new AppError('PROVIDER_NOT_CONFIGURED', '微信 APIv3 密钥必须是 32 字节'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce)); // 保存 decipher：承载本步骤的计算结果供后续使用
  decipher.setAuthTag(Buffer.from((resource as { ciphertext: string; nonce: string; associated_data?: string; tag?: string }).tag ?? '', 'base64')); // 业务步骤：推进当前流程的下一项处理
  if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data)); // 条件分支：仅在满足业务前置条件时继续
  const plain = Buffer.concat([decipher.update(Buffer.from(resource.ciphertext, 'base64')), decipher.final()]); // 保存 plain：承载本步骤的计算结果供后续使用
  return JSON.parse(plain.toString('utf8')) as Record<string, unknown>; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾
export async function createIntent( // 定义函数 createIntent：封装可复用业务步骤
  deps: ApiDeps, // 对象字段：声明结构中的一项数据
  input: { userId: string; purpose: PayPurpose; refId: string; provider: PayProvider; amountCents: number; channel?: 'qr' | 'wap' | 'app' }, // 对象字段：声明结构中的一项数据
) { // 调用结束：参数列表与链式调用收尾
  if (input.amountCents <= 0) throw new AppError('VALIDATION_FAILED', '支付金额必须大于 0'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
  const id = `pay-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
  const ts = now(deps); // 保存 ts：承载本步骤的计算结果供后续使用
  const expires = new Date(Date.now() + 30 * 60000).toISOString(); // 30 分钟未支付自动失效
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `INSERT INTO payment_intents (id, user_id, purpose, ref_id, provider, amount_cents, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ) // 调用结束：参数列表与链式调用收尾
    .run(id, input.userId, input.purpose, input.refId, input.provider, input.amountCents, expires, ts); // 执行写入：把参数落库并返回影响结果
  const intent = deps.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id) as PayIntentRow; // 保存 intent：承载本步骤的计算结果供后续使用
  if (input.provider === 'manual') { // 条件分支：仅在满足业务前置条件时继续
    const account = deps.env.MIM_MANUAL_PAY_ACCOUNT ?? '请联系客服获取收款账户'; // 保存 account：承载本步骤的计算结果供后续使用
    const qr = `人工转账：${account}；金额 ${(input.amountCents / 100).toFixed(2)} 元；备注 ${id}`; // 保存 qr：承载本步骤的计算结果供后续使用
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(qr, id); // 预编译 SQL：固定语句结构后绑定参数执行
    return { intent: { ...intent, qr_text: qr }, next: 'manual_confirm' as const }; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
  if (input.provider === 'sandbox') { // 条件分支：仅在满足业务前置条件时继续
    if (deps.env.MIM_PAYMENT_SANDBOX !== '1') throw new AppError('PROVIDER_NOT_CONFIGURED', '沙箱支付未启用'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
    const qr = `sandbox:${id}`; // 保存 qr：承载本步骤的计算结果供后续使用
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(qr, id); // 预编译 SQL：固定语句结构后绑定参数执行
    return { intent: { ...intent, qr_text: qr }, next: 'sandbox_confirm' as const }; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
  if (input.provider === 'alipay') { // 条件分支：仅在满足业务前置条件时继续
    if (input.channel === 'wap' || input.channel === 'app') { // 条件分支：仅在满足业务前置条件时继续
      const result = createAlipayWap(deps.env, intent); // 保存 result：承载本步骤的计算结果供后续使用
      deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(result.payUrl, id); // 预编译 SQL：固定语句结构后绑定参数执行
      return { intent: { ...intent, qr_text: result.payUrl }, next: 'redirect' as const, pay_url: result.payUrl }; // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    const result = await createAlipay(deps.env, intent); // 保存 result：承载本步骤的计算结果供后续使用
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(result.qrText, id); // 预编译 SQL：固定语句结构后绑定参数执行
    return { intent: { ...intent, qr_text: result.qrText }, next: 'qrcode' as const }; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
  if (input.provider === 'wechat') { // 条件分支：仅在满足业务前置条件时继续
    const result = await createWechatNative(deps.env, intent); // 保存 result：承载本步骤的计算结果供后续使用
    deps.db.prepare('UPDATE payment_intents SET qr_text = ? WHERE id = ?').run(result.qrText, id); // 预编译 SQL：固定语句结构后绑定参数执行
    return { intent: { ...intent, qr_text: result.qrText }, next: 'qrcode' as const }; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
  throw new AppError('PROVIDER_NOT_CONFIGURED', '不支持的支付渠道'); // 业务拒绝 PROVIDER_NOT_CONFIGURED：以统一错误码终止当前请求
} // 结束代码块：本层作用域收尾

/** 校验沙箱回调签名：HMAC-SHA256(`${intent}.${amount}.${status}`)。 */
export function verifySandboxSignature(intentId: string, amount: number, status: string, signature: string, secret: string): boolean { // 定义函数 verifySandboxSignature：封装可复用业务步骤
  const expected = createHmac('sha256', secret).update(`${intentId}.${amount}.${status}`).digest('hex'); // 保存 expected：承载本步骤的计算结果供后续使用
  return timingSafeEqualHex(expected, signature); // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 恒定时间比较十六进制签名，避免逐字节提前返回。 */
function timingSafeEqualHex(a: string, b: string): boolean { // 定义函数 timingSafeEqualHex：封装可复用业务步骤
  if (a.length !== b.length) return false; // 条件分支：仅在满足业务前置条件时继续
  let diff = 0; // 保存 diff：承载本步骤的计算结果供后续使用
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); // 循环处理：逐项完成批量数据操作
  return diff === 0; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 确保钱包行存在，支付履约时余额入账不会静默落空。 */
function ensureWallet(deps: ApiDeps, userId: string): { balance_cents: number; points: number } { // 定义函数 ensureWallet：封装可复用业务步骤
  const existing = deps.db.prepare('SELECT balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as // 保存 existing：承载本步骤的计算结果供后续使用
    | { balance_cents: number; points: number } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (existing) return existing; // 条件分支：仅在满足业务前置条件时继续
  deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, 0, 100, ?)').run(userId, now(deps)); // 预编译 SQL：固定语句结构后绑定参数执行
  return { balance_cents: 0, points: 100 }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 记一条创作者收益：平台抽 30%，作者得 70%，先记 pending。 */
export function recordEarning(deps: ApiDeps, userId: string | null, sourceType: string, sourceId: string, gross: number): void { // 定义函数 recordEarning：封装可复用业务步骤
  if (!userId || gross <= 0) return; // 平台自营资产不分账
  const net = Math.round(gross * 0.7); // 保存 net：承载本步骤的计算结果供后续使用
  const fee = gross - net; // 保存 fee：承载本步骤的计算结果供后续使用
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `INSERT OR IGNORE INTO creator_earnings (id, user_id, source_type, source_id, gross_cents, platform_fee_cents, net_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ) // 调用结束：参数列表与链式调用收尾
    .run(`ce-${randomUUID()}`, userId, sourceType, sourceId, gross, fee, net, now(deps)); // 执行写入：把参数落库并返回影响结果
} // 结束函数体：本层作用域收尾

/** 履约：把已支付意图落到对应业务；以条件更新抢占支付单，重复 / 并发回调只履约一次。 */
export function fulfillIntent(deps: ApiDeps, intent: PayIntentRow, providerTxnId: string | null): void { // 定义函数 fulfillIntent：封装可复用业务步骤
  const ts = now(deps); // 保存 ts：承载本步骤的计算结果供后续使用
  const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
    const marked = deps.db // 抢占支付单：只有 pending → paid 成功的那一次回调才继续履约
      .prepare("UPDATE payment_intents SET status = 'paid', provider_txn_id = COALESCE(?, provider_txn_id), paid_at = ? WHERE id = ? AND status = 'pending'") // 预编译 SQL：固定语句结构后绑定参数执行
      .run(providerTxnId, ts, intent.id); // 执行写入：把参数落库并返回影响结果
    if (marked.changes === 0) return; // 重放 / 并发回调：状态已落定，直接返回，不重复发货
    if (intent.purpose === 'recharge') { // 条件分支：仅在满足业务前置条件时继续
      ensureWallet(deps, intent.user_id); // 业务步骤：推进当前流程的下一项处理
      deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(intent.amount_cents, ts, intent.user_id); // 预编译 SQL：固定语句结构后绑定参数执行
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'recharge', ?, 'payment', ?, '在线充值', ?)") // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`wt-${randomUUID()}`, intent.user_id, intent.amount_cents, intent.id, ts); // 执行写入：把参数落库并返回影响结果
    } else if (intent.purpose === 'asset') { // 其他分支：处理不满足前置条件的路径
      const asset = deps.db.prepare("SELECT id, author_id, price_cents FROM paid_assets WHERE code = ? AND status = 'published'").get(intent.ref_id) as // 保存 asset：承载本步骤的计算结果供后续使用
        | { id: string; author_id: string | null; price_cents: number } // 业务步骤：推进当前流程的下一项处理
        | undefined; // 业务步骤：推进当前流程的下一项处理
      if (!asset) throw new AppError('NOT_FOUND', '资产不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare('INSERT OR IGNORE INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`ap-${randomUUID()}`, intent.user_id, asset.id, intent.amount_cents, ts); // 执行写入：把参数落库并返回影响结果
      deps.db.prepare('UPDATE paid_assets SET sales = sales + 1 WHERE id = ?').run(asset.id); // 预编译 SQL：固定语句结构后绑定参数执行
      recordEarning(deps, asset.author_id, 'asset', asset.id, intent.amount_cents); // 业务步骤：推进当前流程的下一项处理
    } else if (intent.purpose === 'vip') { // 其他分支：处理不满足前置条件的路径
      const plan = deps.db.prepare('SELECT id, level, duration_days FROM vip_plans WHERE code = ? AND active = 1').get(intent.ref_id) as // 保存 plan：承载本步骤的计算结果供后续使用
        | { id: string; level: number; duration_days: number } // 业务步骤：推进当前流程的下一项处理
        | undefined; // 业务步骤：推进当前流程的下一项处理
      if (!plan) throw new AppError('NOT_FOUND', 'VIP 套餐不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
      const current = deps.db // 保存 current：承载本步骤的计算结果供后续使用
        .prepare("SELECT expires_at FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1") // 预编译 SQL：固定语句结构后绑定参数执行
        .get(intent.user_id, ts) as { expires_at: string } | undefined; // 查询单行：读取一条记录供判定使用
      const start = current ? new Date(current.expires_at) : new Date(); // 保存 start：承载本步骤的计算结果供后续使用
      const expires = new Date(start.getTime() + plan.duration_days * 86400000).toISOString(); // 保存 expires：承载本步骤的计算结果供后续使用
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare("INSERT INTO vip_memberships (id, user_id, plan_id, level, starts_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)") // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`vip-${randomUUID()}`, intent.user_id, plan.id, plan.level, ts, expires, ts); // 执行写入：把参数落库并返回影响结果
    } else if (intent.purpose === 'shop_order') { // 其他分支：处理不满足前置条件的路径
      deliverShopOrder(deps, intent.ref_id, intent.amount_cents); // 实物 → 待发货；自动发卡 → 直接交付；人工 → 待客服交付
    } // 结束条件分支：本层作用域收尾
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare('INSERT INTO payment_events (id, intent_id, provider, event, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
      .run(`pe-${randomUUID()}`, intent.id, intent.provider, 'paid', providerTxnId ?? '', ts); // 执行写入：把参数落库并返回影响结果
  }); // 结束函数体：本层作用域收尾
  tx(); // 业务步骤：推进当前流程的下一项处理
} // 结束函数体：本层作用域收尾

/** 支付宝异步通知 RSA2 验签：剔除 sign / sign_type 后按字典序拼接原文。 */
export function verifyAlipaySignature( // 定义函数 verifyAlipaySignature：封装可复用业务步骤
  env: Record<string, string | undefined>, // 对象字段：声明结构中的一项数据
  params: Record<string, string>, // 支付宝 POST 表单参数
): boolean { // 调用结束：参数列表与链式调用收尾
  const publicKey = (env.MIM_ALIPAY_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'); // 保存 publicKey：承载本步骤的计算结果供后续使用
  const signature = params.sign; // 保存 signature：承载本步骤的计算结果供后续使用
  if (!publicKey || !signature) return false; // 未配置公钥或没有签名一律拒绝
  const unsigned = Object.keys(params) // 保存 unsigned：承载本步骤的计算结果供后续使用
    .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== undefined && params[key] !== '') // 链式调用：在上一步结果上继续处理
    .sort() // 链式调用：在上一步结果上继续处理
    .map((key) => `${key}=${params[key]}`) // 链式调用：在上一步结果上继续处理
    .join('&'); // 链式调用：在上一步结果上继续处理
  try { // 公钥格式错误按验签失败处理，不把异常透给回调方
    return verify('RSA-SHA256', Buffer.from(unsigned), publicKey, Buffer.from(signature, 'base64')); // 返回结果：把本步骤产物交给调用方
  } catch { // 结束代码块：本层作用域收尾
    return false; // 返回结果：把本步骤产物交给调用方
  } // 结束代码块：本层作用域收尾
} // 结束函数体：本层作用域收尾

/**
 * 在线支付落定后的商城履约：抢占订单 → 扣积分 / 核销优惠码 / 推广分成 → 发卡或扣库存。
 * 必须在支付事务内调用；订单已是 paid 时直接返回，重复回调不会二次发卡。
 */
export function deliverShopOrder(deps: ApiDeps, orderId: string, amountCents: number): void { // 定义函数 deliverShopOrder：封装可复用业务步骤
  const ts = now(deps); // 保存 ts：承载本步骤的计算结果供后续使用
  const order = deps.db // 保存 order：承载本步骤的计算结果供后续使用
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `SELECT o.id, o.user_id, o.product_id, o.quantity, o.payable_cents, o.discount_cents, o.coupon_code,
              o.points_spent, o.delivery_kind, p.name AS product_name
         FROM shop_orders o JOIN shop_products p ON p.id = o.product_id
        WHERE o.id = ?`,
    ) // 调用结束：参数列表与链式调用收尾
    .get(orderId) as // 查询单行：读取一条记录供判定使用
    | { id: string; user_id: string; product_id: string; quantity: number; payable_cents: number; discount_cents: number; coupon_code: string | null; points_spent: number; delivery_kind: string; product_name: string } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (!order) throw new AppError('NOT_FOUND', '订单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
  if (order.payable_cents !== amountCents) throw new AppError('CONFLICT', '支付金额与订单不一致'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
  const marked = deps.db // 抢占订单：pending → paid 只有一次成功
    .prepare("UPDATE shop_orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'") // 预编译 SQL：固定语句结构后绑定参数执行
    .run(ts, orderId); // 执行写入：把参数落库并返回影响结果
  if (marked.changes === 0) return; // 已由其他回调履约：不重复扣积分 / 发卡 / 分成

  if (order.points_spent > 0) { // 在线单的积分在支付成功后才真正扣除
    const spent = deps.db // 保存 spent：承载本步骤的计算结果供后续使用
      .prepare('UPDATE wallets SET points = points - ?, updated_at = ? WHERE user_id = ? AND points >= ?') // 预编译 SQL：固定语句结构后绑定参数执行
      .run(order.points_spent, ts, order.user_id, order.points_spent); // 执行写入：把参数落库并返回影响结果
    if (spent.changes === 0) throw new AppError('CONFLICT', '积分不足，无法完成支付履约'); // 业务拒绝 CONFLICT：整单回滚，支付单保持待履约
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare(`INSERT INTO wallet_transactions (id, user_id, kind, points, ref_type, ref_id, note, created_at) VALUES (?, ?, 'points', ?, 'shop_order', ?, ?, ?)`) // 预编译 SQL：固定语句结构后绑定参数执行
      .run(`wt-${randomUUID()}`, order.user_id, -order.points_spent, orderId, `积分抵扣 ${order.product_name}`, ts); // 执行写入：把参数落库并返回影响结果
  } // 结束条件分支：本层作用域收尾

  if (order.coupon_code) { // 优惠码在支付成功时核销，避免待支付单占用次数
    const coupon = deps.db.prepare('SELECT id FROM coupons WHERE code = ?').get(order.coupon_code) as { id: string } | undefined; // 保存 coupon：承载本步骤的计算结果供后续使用
    if (coupon) { // 条件分支：仅在满足业务前置条件时继续
      deps.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id); // 预编译 SQL：固定语句结构后绑定参数执行
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare('INSERT INTO coupon_redemptions (id, coupon_id, user_id, order_id, discount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`cr-${randomUUID()}`, coupon.id, order.user_id, orderId, order.discount_cents, ts); // 执行写入：把参数落库并返回影响结果
    } // 结束条件分支：本层作用域收尾
  } // 结束条件分支：本层作用域收尾

  const referral = deps.db // 推广分成：被邀请人首单，邀请人拿 5%
    .prepare("SELECT id, inviter_id FROM referrals WHERE invitee_id = ? AND status = 'bound'") // 预编译 SQL：固定语句结构后绑定参数执行
    .get(order.user_id) as { id: string; inviter_id: string } | undefined; // 查询单行：读取一条记录供判定使用
  if (referral) { // 条件分支：仅在满足业务前置条件时继续
    const commission = Math.round(order.payable_cents * 0.05); // 保存 commission：承载本步骤的计算结果供后续使用
    deps.db.prepare("UPDATE referrals SET commission_cents = ?, status = 'settled' WHERE id = ?").run(commission, referral.id); // 预编译 SQL：固定语句结构后绑定参数执行
    ensureWallet(deps, referral.inviter_id); // 业务步骤：推进当前流程的下一项处理
    deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(commission, ts, referral.inviter_id); // 预编译 SQL：固定语句结构后绑定参数执行
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare("INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'commission', ?, 'shop_order', ?, ?, ?)") // 预编译 SQL：固定语句结构后绑定参数执行
      .run(`wt-${randomUUID()}`, referral.inviter_id, commission, orderId, `推广首单分成（订单 ${orderId}）`, ts); // 执行写入：把参数落库并返回影响结果
  } // 结束条件分支：本层作用域收尾

  if (order.delivery_kind === 'virtual_auto') { // 自动发卡：支付成功即交付卡密
    const key = deps.db.prepare("SELECT id, code FROM shop_card_keys WHERE product_id = ? AND status = 'unused' LIMIT 1").get(order.product_id) as // 保存 key：承载本步骤的计算结果供后续使用
      | { id: string; code: string } | undefined; // 查询单行：读取一条记录供判定使用
    if (!key) throw new AppError('VALIDATION_FAILED', '该商品暂时缺货'); // 业务拒绝 VALIDATION_FAILED：整单回滚
    const taken = deps.db.prepare("UPDATE shop_card_keys SET status = 'used', used_by = ?, used_at = ? WHERE id = ? AND status = 'unused'").run(order.user_id, ts, key.id); // 预编译 SQL：固定语句结构后绑定参数执行
    if (taken.changes === 0) throw new AppError('CONFLICT', '卡密已被占用，请客服补发'); // 业务拒绝 CONFLICT：整单回滚
    deps.db.prepare("UPDATE shop_orders SET status = 'delivered', delivered_content = ?, delivered_at = ? WHERE id = ?").run(key.code, ts, orderId); // 预编译 SQL：固定语句结构后绑定参数执行
  } else { // 实物 / 人工：支付后进入待发货或待交付
    deps.db.prepare('UPDATE shop_products SET stock = MAX(0, stock - ?) WHERE id = ?').run(order.quantity, order.product_id); // 预编译 SQL：固定语句结构后绑定参数执行
    if (order.delivery_kind === 'virtual_manual') { // 条件分支：仅在满足业务前置条件时继续
      deps.db.prepare('UPDATE shop_orders SET delivered_content = ? WHERE id = ?').run('支付成功，客服将在 24 小时内联系你安排交付。', orderId); // 预编译 SQL：固定语句结构后绑定参数执行
    } // 结束条件分支：本层作用域收尾
  } // 结束条件分支：本层作用域收尾
} // 结束函数体：本层作用域收尾
