/**
 * 收银台入口辅助：创建支付意图并跳转到收银台深链接。
 * 组合 api 端点与路由工具，供资产 / VIP / 商城订单 / 充值各入口复用。
 */

import { api } from '../api'; // 统一后端调用入口
import type { PaymentIntent, PaymentProvider } from '../api'; // 支付意图与渠道类型
import { navigatePath, pathOf } from '../router'; // 前端路由跳转与路径拼接
import type { Locale } from '@mim/i18n'; // 语言标识类型

/** 渠道展示名（中英） */
const PROVIDER_LABELS: Record<string, { zh: string; en: string }> = { // 渠道标识到中英展示名的映射
  alipay: { zh: '支付宝', en: 'Alipay' }, // 支付宝
  wechat: { zh: '微信支付', en: 'WeChat Pay' }, // 微信支付
  manual: { zh: '线下转账', en: 'Manual transfer' }, // 人工转账
  sandbox: { zh: '沙箱测试', en: 'Sandbox' }, // 测试渠道
}; // 映射表结束

/** 渠道本地化展示名；未知渠道回退原始标识 */
export function providerLabel(locale: Locale, provider: string): string { // 按语言取渠道名
  const entry = PROVIDER_LABELS[provider]; // 查映射
  if (!entry) return provider; // 未知渠道原样返回
  return locale === 'en-US' ? entry.en : entry.zh; // 英文环境取 en，其余取中文
} // 函数结束

/** 创建支付意图（金额一律以后端服务端定价为准，前端只传用途 / 关联对象 / 渠道） */
export async function createCheckoutIntent(payload: { // 入参：用途、关联对象、渠道、可选金额
  purpose: 'shop_order' | 'vip' | 'asset' | 'recharge'; // 支付用途
  refId: string; // 关联对象标识（订单号 / 套餐 / 资产）
  provider: PaymentProvider; // 支付渠道
  amountCents?: number; // 可选金额（服务端会以定价覆盖）
}): Promise<PaymentIntent> { // 返回后端签发的支付意图
  const result = await api.commerce.createIntent({ // 调后端创建意图
    purpose: payload.purpose, // 透传用途
    ref_id: payload.refId, // 透传关联对象
    provider: payload.provider, // 透传渠道
    amount_cents: payload.amountCents, // 透传金额（可空）
  }); // 请求结束
  return result.intent; // 只交回意图主体
} // 函数结束

/** 由意图编号构造收银台查询串 */
export function checkoutQuery(intentId: string, extras: Record<string, string | undefined> = {}): string { // 拼查询串
  const params = new URLSearchParams(); // 复用浏览器原生编码
  params.set('intent', intentId); // 必带意图编号
  for (const [key, value] of Object.entries(extras)) { // 逐个附加辅助参数
    if (value) params.set(key, value); // 空值不写入，避免出现 key=
  } // 循环结束
  return params.toString(); // 交回编码后的查询串
} // 函数结束

/** 跳转到收银台页（带意图与辅助参数） */
export function goCheckout(intentId: string, extras?: Record<string, string | undefined>): void { // 无返回值，只做跳转
  navigatePath(pathOf('checkout', '', checkoutQuery(intentId, extras))); // 拼出 /checkout?intent=… 并跳转
} // 函数结束

/** 一站式：创建意图并进入收银台，返回刚创建的意图 */
export async function startCheckout(payload: { // 入参比 createCheckoutIntent 多一个 extras
  purpose: 'shop_order' | 'vip' | 'asset' | 'recharge'; // 支付用途
  refId: string; // 关联对象标识
  provider: PaymentProvider; // 支付渠道
  amountCents?: number; // 可选金额
  extras?: Record<string, string | undefined>; // 跳转时附加的查询参数
}): Promise<PaymentIntent> { // 返回已创建的意图，便于调用方展示
  const intent = await createCheckoutIntent(payload); // 先建意图
  goCheckout(intent.id, payload.extras); // 再跳收银台
  return intent; // 交回意图
} // 函数结束
