/**
 * 订阅套餐与定价（07 §5.2 / FR-02）。
 * 价格一律用「最小货币单位」的整数表示（分 / cent），禁止浮点。
 */

export type Region = 'cn' | 'global';
export type BillingCycle = 'monthly' | 'yearly';
export type PlanId = 'free' | 'basic' | 'pro';

export interface PlanDefinition {
  id: PlanId;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    nameZh: '免费版',
    nameEn: 'Free',
    descriptionZh: '免费体验，无需付费',
    descriptionEn: 'Free tier without charges',
  },
  basic: {
    id: 'basic',
    nameZh: '基础版',
    nameEn: 'Basic',
    descriptionZh: '基础版订阅，支持按月或按年付费',
    descriptionEn: 'Basic subscription, monthly or yearly',
  },
  pro: {
    id: 'pro',
    nameZh: '专业版',
    nameEn: 'Pro',
    descriptionZh: '专业版订阅，支持按月或按年付费',
    descriptionEn: 'Pro subscription, monthly or yearly',
  },
};

/**
 * 价格表（最小货币单位）。
 * 国内（cn）按 PRD 定价：¥29/月、¥290/年；¥99/月、¥990/年。
 * 海外（global）定价仍为待定开放项（OQ），此处不臆造数值：缺失即以 PLAN_PRICE_NOT_CONFIGURED 拒绝下单。
 */
export const PLAN_PRICES: Record<Region, Record<PlanId, Partial<Record<BillingCycle, number>>>> = {
  cn: {
    free: { monthly: 0, yearly: 0 },
    basic: { monthly: 2900, yearly: 29000 },
    pro: { monthly: 9900, yearly: 99000 },
  },
  global: {
    free: { monthly: 0, yearly: 0 },
    basic: {},
    pro: {},
  },
};

export const REGION_CURRENCY: Record<Region, 'CNY' | 'USD'> = {
  cn: 'CNY',
  global: 'USD',
};

export const PLAN_IDS: PlanId[] = ['free', 'basic', 'pro'];

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as string[]).includes(value);
}

export function getPlan(planId: string): PlanDefinition | null {
  return isPlanId(planId) ? PLANS[planId] : null;
}

export function priceOf(planId: PlanId, region: Region, cycle: BillingCycle): number | null {
  const value = PLAN_PRICES[region]?.[planId]?.[cycle];
  return typeof value === 'number' ? value : null;
}
