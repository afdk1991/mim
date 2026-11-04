/**
 * 订单状态机（FR-02 / 08 §3.3）。
 * pending → paid | failed | closed；paid → refunded。
 */

import { AppError } from './errors.js';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'closed' | 'refunded';
export type PaymentDriverId = 'mock' | 'wechat' | 'alipay' | 'stripe';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'failed', 'closed'],
  paid: ['refunded'],
  failed: [],
  closed: [],
  refunded: [],
};

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    throw new AppError('ORDER_INVALID_TRANSITION', `order transition ${from} -> ${to} is not allowed`, {
      from,
      to,
    });
  }
}

/** 支付驱动所需密钥（与 09 清单变量名一一对应） */
export const DRIVER_REQUIRED_ENV: Record<Exclude<PaymentDriverId, 'mock'>, string[]> = {
  wechat: [
    'MIM_PAY_WECHAT_MCH_ID',
    'MIM_PAY_WECHAT_APP_ID',
    'MIM_PAY_WECHAT_API_V3_KEY',
    'MIM_PAY_WECHAT_CERT_SERIAL',
    'MIM_PAY_WECHAT_PRIVATE_KEY',
  ],
  alipay: ['MIM_PAY_ALIPAY_APP_ID', 'MIM_PAY_ALIPAY_PRIVATE_KEY', 'MIM_PAY_ALIPAY_PUBLIC_KEY'],
  stripe: ['MIM_PAY_STRIPE_SECRET_KEY', 'MIM_PAY_STRIPE_WEBHOOK_SECRET'],
};

export function missingDriverEnv(driver: PaymentDriverId, env: Record<string, string | undefined>): string[] {
  if (driver === 'mock') return [];
  return DRIVER_REQUIRED_ENV[driver].filter((name) => !env[name]);
}
