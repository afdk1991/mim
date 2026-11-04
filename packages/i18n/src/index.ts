/**
 * 双语文案与本地化格式化（FR-06 / 08 §4.4 多端一致性）。
 * 客户端禁止硬编码文案：所有展示文案由本包或服务端下发。
 */

import type { ErrorCode } from '@mim/core-domain';

export type Locale = 'zh-CN' | 'en-US';

export const SUPPORTED_LOCALES: Locale[] = ['zh-CN', 'en-US'];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

type Dict = Record<string, string>;

const zh: Dict = {
  'app.name': 'Mim',
  'app.tagline': '跨端任务与轻协作',
  'nav.settings': '设置',
  'nav.plans': '套餐',
  'action.create': '新建',
  'action.save': '保存',
  'action.cancel': '取消',
  'action.delete': '删除',
  'action.edit': '编辑',
  'action.complete': '完成',
  'action.reopen': '重新打开',
  'action.logout': '退出登录',
  'action.subscribe': '立即订阅',
  'action.pay': '去支付',
  'auth.title': '登录 / 注册',
  'auth.phone': '手机号',
  'auth.email': '邮箱',
  'auth.code': '验证码',
  'auth.password': '密码（可选）',
  'auth.sendCode': '获取验证码',
  'auth.codeSent': '验证码已生成（开发模式直接展示）',
  'auth.login': '登录',
  'auth.register': '注册',
  'settings.account': '账号',
  'settings.devices': '登录设备',
  'settings.deletion': '账号注销',
  'settings.deletionTip': '注销后进入 7 天冷静期，期间可撤销',
  'plan.current': '当前套餐',
  'plan.upgrade': '升级套餐',
  'plan.monthly': '按月',
  'plan.yearly': '按年',
  'plan.notConfigured': '该地区定价待配置',
  'common.loading': '加载中…',
  'common.confirm': '确认',
  'common.none': '无',
  'common.offline': '离线，变更将在恢复后同步',
  'common.error': '出错了',
  'plans.price': '价格',
  'plans.buy': '订阅',
  'plans.cancel': '取消订阅',
  'plans.orders': '订单记录',
  'plans.noOrders': '暂无订单',
  'plans.createdAt': '下单时间',
  'settings.displayName': '昵称',
  'settings.locale': '语言',
  'settings.timezone': '时区',
  'settings.save': '保存设置',
  'settings.region': '地区',
  'settings.plan': '套餐',
  'settings.requestDeletion': '申请注销',
  'settings.cancelDeletion': '撤销注销',
  'settings.deletionPending': '账号处于注销冷静期',
};

const en: Dict = {
  'app.name': 'Mim',
  'app.tagline': 'Tasks and light collaboration across devices',
  'nav.settings': 'Settings',
  'nav.plans': 'Plans',
  'action.create': 'New',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.complete': 'Complete',
  'action.reopen': 'Reopen',
  'action.logout': 'Sign out',
  'action.subscribe': 'Subscribe',
  'action.pay': 'Pay now',
  'auth.title': 'Sign in / Sign up',
  'auth.phone': 'Phone',
  'auth.email': 'Email',
  'auth.code': 'Verification code',
  'auth.password': 'Password (optional)',
  'auth.sendCode': 'Send code',
  'auth.codeSent': 'Code generated (shown in dev mode)',
  'auth.login': 'Sign in',
  'auth.register': 'Sign up',
  'settings.account': 'Account',
  'settings.devices': 'Devices',
  'settings.deletion': 'Delete account',
  'settings.deletionTip': 'Account enters a 7-day cooling-off period and can be restored',
  'plan.current': 'Current plan',
  'plan.upgrade': 'Upgrade',
  'plan.monthly': 'Monthly',
  'plan.yearly': 'Yearly',
  'plan.notConfigured': 'Pricing not configured for this region',
  'common.loading': 'Loading…',
  'common.confirm': 'Confirm',
  'common.none': 'None',
  'common.offline': 'Offline. Changes will sync when back online.',
  'common.error': 'Something went wrong',
  'plans.price': 'Price',
  'plans.buy': 'Subscribe',
  'plans.cancel': 'Cancel subscription',
  'plans.orders': 'Orders',
  'plans.noOrders': 'No orders yet',
  'plans.createdAt': 'Created at',
  'settings.displayName': 'Display name',
  'settings.locale': 'Language',
  'settings.timezone': 'Time zone',
  'settings.save': 'Save settings',
  'settings.region': 'Region',
  'settings.plan': 'Plan',
  'settings.requestDeletion': 'Request deletion',
  'settings.cancelDeletion': 'Cancel deletion',
  'settings.deletionPending': 'Account is pending deletion',
};

const ERROR_MESSAGES: Record<Locale, Record<ErrorCode, string>> = {
  'zh-CN': {
    VALIDATION_FAILED: '请求参数不合法',
    AUTH_UNAUTHORIZED: '请先登录',
    AUTH_CODE_INVALID: '验证码错误',
    AUTH_CODE_EXPIRED: '验证码已过期',
    AUTH_CODE_RATE_LIMITED: '验证码发送过于频繁，请稍后再试',
    AUTH_CHANNEL_NOT_CONFIGURED: '验证码通道未配置，请稍后再试',
    AUTH_ACCOUNT_LOCKED: '登录失败次数过多，账号已临时锁定',
    AUTH_REFRESH_INVALID: '登录状态已失效，请重新登录',
    ACCOUNT_NOT_FOUND: '账号不存在',
    ACCOUNT_REGION_MISMATCH: '该账号不属于当前地区',
    ACCOUNT_DELETION_PENDING: '账号处于注销冷静期，请先撤销注销',
    FORBIDDEN: '没有执行该操作的权限',
    NOT_FOUND: '资源不存在',
    CONFLICT: '数据冲突，请刷新后重试',
    IDEMPOTENCY_CONFLICT: '幂等键对应的请求内容不一致',
    PLAN_NOT_FOUND: '套餐不存在',
    PLAN_PRICE_NOT_CONFIGURED: '该地区暂未开放在线订阅',
    FEATURE_NOT_AVAILABLE: '当前套餐不包含该功能',
    SUBSCRIPTION_ALREADY_ACTIVE: '已存在生效中的订阅',
    SUBSCRIPTION_INVALID_TRANSITION: '订阅状态流转不合法',
    ORDER_NOT_FOUND: '订单不存在',
    ORDER_INVALID_TRANSITION: '订单状态流转不合法',
    PAYMENT_DRIVER_UNAVAILABLE: '支付通道未配置',
    RATE_LIMITED: '请求过于频繁，请稍后再试',
    INTERNAL_ERROR: '服务器内部错误',
  },
  'en-US': {
    VALIDATION_FAILED: 'Invalid request parameters',
    AUTH_UNAUTHORIZED: 'Please sign in first',
    AUTH_CODE_INVALID: 'Incorrect verification code',
    AUTH_CODE_EXPIRED: 'Verification code expired',
    AUTH_CODE_RATE_LIMITED: 'Too many code requests, try again later',
    AUTH_CHANNEL_NOT_CONFIGURED: 'Verification channel is not configured, please try again later',
    AUTH_ACCOUNT_LOCKED: 'Too many failed sign-ins, account temporarily locked',
    AUTH_REFRESH_INVALID: 'Session expired, please sign in again',
    ACCOUNT_NOT_FOUND: 'Account not found',
    ACCOUNT_REGION_MISMATCH: 'Account does not belong to this region',
    ACCOUNT_DELETION_PENDING: 'Account is pending deletion; cancel it first',
    FORBIDDEN: 'You are not allowed to perform this action',
    NOT_FOUND: 'Resource not found',
    CONFLICT: 'Data conflict, refresh and retry',
    IDEMPOTENCY_CONFLICT: 'Idempotency key was reused with a different payload',
    PLAN_NOT_FOUND: 'Plan not found',
    PLAN_PRICE_NOT_CONFIGURED: 'Online subscription is not yet open in this region',
    FEATURE_NOT_AVAILABLE: 'Your plan does not include this feature',
    SUBSCRIPTION_ALREADY_ACTIVE: 'An active subscription already exists',
    SUBSCRIPTION_INVALID_TRANSITION: 'Invalid subscription state transition',
    ORDER_NOT_FOUND: 'Order not found',
    ORDER_INVALID_TRANSITION: 'Invalid order state transition',
    PAYMENT_DRIVER_UNAVAILABLE: 'Payment channel not configured',
    RATE_LIMITED: 'Too many requests, try again later',
    INTERNAL_ERROR: 'Internal server error',
  },
};

const DICTS: Record<Locale, Dict> = { 'zh-CN': zh, 'en-US': en };

export function normalizeLocale(value: string | undefined | null): Locale {
  if (value === 'en-US' || value === 'en' || value === 'en_US') return 'en-US';
  return DEFAULT_LOCALE;
}

export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const template = DICTS[locale][key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function errorMessage(locale: Locale, code: ErrorCode): string {
  return ERROR_MESSAGES[locale][code] ?? ERROR_MESSAGES[DEFAULT_LOCALE][code] ?? code;
}

export function formatCurrency(amountMinor: number, currency: string, locale: Locale): string {
  const digits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 100);
}

export function formatDate(iso: string, locale: Locale, timeZone = 'Asia/Shanghai'): string {
  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeZone,
  }).format(new Date(iso));
}
