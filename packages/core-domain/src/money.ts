/** 金额只以最小货币单位整数流转，禁止浮点运算 */

export function formatAmount(amountMinor: number, currency: string, locale = 'zh-CN'): string {
  const digits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 100);
}

export function assertAmountMinor(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('amount must be a non-negative integer in minor units');
  }
}
