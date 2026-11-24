/**
 * 收银台渠道展示名辅助：把后端渠道代号翻译成当前语言可读名。
 * 意图创建与跳转由收银台视图（Checkout / PaymentReturn）直接调用 api 与路由工具，本文件不再保留编排函数。
 */

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
