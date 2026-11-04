/**
 * 订阅套餐与 features 映射（07 §5.2 / FR-02）。
 * 价格一律用「最小货币单位」的整数表示（分 / cent），禁止浮点。
 */

export type Region = 'cn' | 'global';
export type BillingCycle = 'monthly' | 'yearly';
export type PlanId = 'free' | 'basic' | 'pro';
export type ViewKind = 'list' | 'today' | 'calendar' | 'kanban';

export interface PlanFeatures {
  /** -1 表示不限额 */
  projectsLimit: number;
  /** 除 owner 之外的协作者上限，-1 表示不限额 */
  collaboratorsLimit: number;
  views: ViewKind[];
  reminders: boolean;
  csvExport: boolean;
  advancedFilters: boolean;
  customTheme: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  features: PlanFeatures;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    nameZh: '免费版',
    nameEn: 'Free',
    descriptionZh: '单人使用，3 个项目，列表与今日视图',
    descriptionEn: 'Solo use, 3 projects, list and today views',
    features: {
      projectsLimit: 3,
      collaboratorsLimit: 0,
      views: ['list', 'today'],
      reminders: false,
      csvExport: false,
      advancedFilters: false,
      customTheme: false,
    },
  },
  basic: {
    id: 'basic',
    nameZh: '基础版',
    nameEn: 'Basic',
    descriptionZh: '无限项目、日历视图、截止日提醒、3 名协作者、CSV 导出',
    descriptionEn: 'Unlimited projects, calendar view, reminders, 3 collaborators, CSV export',
    features: {
      projectsLimit: -1,
      collaboratorsLimit: 3,
      views: ['list', 'today', 'calendar'],
      reminders: true,
      csvExport: true,
      advancedFilters: false,
      customTheme: false,
    },
  },
  pro: {
    id: 'pro',
    nameZh: '专业版',
    nameEn: 'Pro',
    descriptionZh: '在基础版之上增加看板视图、无限协作者、高级筛选与自定义主题',
    descriptionEn: 'Adds kanban view, unlimited collaborators, advanced filters and custom themes',
    features: {
      projectsLimit: -1,
      collaboratorsLimit: -1,
      views: ['list', 'today', 'calendar', 'kanban'],
      reminders: true,
      csvExport: true,
      advancedFilters: true,
      customTheme: true,
    },
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

export function hasFeature(features: PlanFeatures, flag: keyof Omit<PlanFeatures, 'views' | 'projectsLimit' | 'collaboratorsLimit'>): boolean {
  return features[flag] === true;
}

export function hasView(features: PlanFeatures, view: ViewKind): boolean {
  return features.views.includes(view);
}

/** 不限额返回 true；否则与现有数量比较 */
export function withinLimit(limit: number, currentCount: number): boolean {
  return limit < 0 || currentCount < limit;
}
