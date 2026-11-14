/**
 * 收银台入口辅助：创建支付意图并跳转到收银台深链接。
 * 组合 api 端点与路由工具，供资产 / VIP / 商城订单 / 充值各入口复用。
 */

import { api } from '../api';
import type { PaymentIntent, PaymentProvider } from '../api';
import { navigatePath, pathOf } from '../router';
import type { Locale } from '@mim/i18n';

/** 渠道展示名（中英） */
const PROVIDER_LABELS: Record<string, { zh: string; en: string }> = {
  alipay: { zh: '支付宝', en: 'Alipay' },
  wechat: { zh: '微信支付', en: 'WeChat Pay' },
  manual: { zh: '线下转账', en: 'Manual transfer' },
  sandbox: { zh: '沙箱测试', en: 'Sandbox' },
};

/** 渠道本地化展示名；未知渠道回退原始标识 */
export function providerLabel(locale: Locale, provider: string): string {
  const entry = PROVIDER_LABELS[provider];
  if (!entry) return provider;
  return locale === 'en-US' ? entry.en : entry.zh;
}

/** 创建支付意图（金额一律以后端服务端定价为准，前端只传用途 / 关联对象 / 渠道） */
export async function createCheckoutIntent(payload: {
  purpose: 'shop_order' | 'vip' | 'asset' | 'recharge';
  refId: string;
  provider: PaymentProvider;
  amountCents?: number;
}): Promise<PaymentIntent> {
  const result = await api.commerce.createIntent({
    purpose: payload.purpose,
    ref_id: payload.refId,
    provider: payload.provider,
    amount_cents: payload.amountCents,
  });
  return result.intent;
}

/** 由意图编号构造收银台查询串 */
export function checkoutQuery(intentId: string, extras: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  params.set('intent', intentId);
  for (const [key, value] of Object.entries(extras)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** 跳转到收银台页（带意图与辅助参数） */
export function goCheckout(intentId: string, extras?: Record<string, string | undefined>): void {
  navigatePath(pathOf('checkout', '', checkoutQuery(intentId, extras)));
}

/** 一站式：创建意图并进入收银台，返回刚创建的意图 */
export async function startCheckout(payload: {
  purpose: 'shop_order' | 'vip' | 'asset' | 'recharge';
  refId: string;
  provider: PaymentProvider;
  amountCents?: number;
  extras?: Record<string, string | undefined>;
}): Promise<PaymentIntent> {
  const intent = await createCheckoutIntent(payload);
  goCheckout(intent.id, payload.extras);
  return intent;
}
