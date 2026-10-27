/* ==========================================================================
 * 本地生活业务 —— 商户门店 / 套餐券 / 到店核销
 *
 * 安全设计（服务端强制，前端不得构造）：
 *   1. 券码由服务端生成（md5(order_id||voucher_id||now) 截取），前端只展示
 *   2. 发码幂等：同一订单重复取码返回原码，不会生成第二个
 *   3. 核销一次性：update … where status='unused' 条件更新，一码不可能销两次
 *   4. 未支付订单禁止取码
 * ======================================================================== */

import type { LocalMerchant, LocalVoucher, VoucherCode } from '../model'
import { voucherUsable } from '../model'

export interface MerchantRow {
  id?: unknown
  name?: unknown
  address?: unknown
  category?: unknown
  emoji?: unknown
  lng?: unknown
  lat?: unknown
  hours?: unknown
  phone?: unknown
}

export interface VoucherRow {
  id?: unknown
  merchant_id?: unknown
  goods_id?: unknown
  title?: unknown
  emoji?: unknown
  price_cents?: unknown
  value_cents?: unknown
  valid_until?: unknown
  rules?: unknown
  remaining?: unknown
}

export interface VoucherCodeRow {
  code?: unknown
  order_id?: unknown
  voucher_id?: unknown
  merchant_id?: unknown
  status?: unknown
  expire_at?: unknown
  used_at?: unknown
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const ms = (v: unknown): number => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const t = Date.parse(String(v ?? ''))
  return Number.isFinite(t) ? t : 0
}
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function mapMerchant(r: MerchantRow): LocalMerchant | null {
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    name: str(r.name, '未命名门店'),
    address: str(r.address),
    category: str(r.category, '其他'),
    emoji: str(r.emoji, '🏪'),
    ...(typeof r.lng === 'number' ? { lng: r.lng } : {}),
    ...(typeof r.lat === 'number' ? { lat: r.lat } : {}),
    ...(typeof r.hours === 'string' && r.hours ? { hours: r.hours } : {}),
    ...(typeof r.phone === 'string' && r.phone ? { phone: r.phone } : {}),
  }
}

export function mapVoucher(r: VoucherRow): LocalVoucher | null {
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    merchantId: str(r.merchant_id),
    goodsId: str(r.goods_id),
    title: str(r.title, '套餐券'),
    emoji: str(r.emoji, '🎫'),
    priceFen: num(r.price_cents, 0),
    valueFen: num(r.value_cents, 0),
    validUntil: ms(r.valid_until),
    rules: strList(r.rules),
    remaining: Math.max(0, num(r.remaining, 0)),
  }
}

export const VOUCHER_STATUS_TEXT: Record<VoucherCode['status'], string> = {
  unused: '待使用',
  used: '已核销',
  expired: '已过期',
  refunding: '退款中',
  refunded: '已退款',
}

export function mapVoucherCode(r: VoucherCodeRow): VoucherCode | null {
  if (typeof r.code !== 'string' || !r.code) return null
  const status = r.status
  const s: VoucherCode['status'] =
    status === 'used' || status === 'expired' || status === 'refunding' || status === 'refunded' ? status : 'unused'
  return {
    code: r.code,
    orderId: str(r.order_id),
    voucherId: str(r.voucher_id),
    merchantId: str(r.merchant_id),
    status: s,
    expireAt: ms(r.expire_at),
    ...(typeof r.used_at === 'number' || typeof r.used_at === 'string' ? { usedAt: ms(r.used_at) } : {}),
  }
}

/** 按门店归组券 */
export function vouchersByMerchant(vouchers: LocalVoucher[]): Array<{ merchantId: string; vouchers: LocalVoucher[] }> {
  const map = new Map<string, LocalVoucher[]>()
  for (const v of vouchers) {
    const list = map.get(v.merchantId)
    if (list) list.push(v)
    else map.set(v.merchantId, [v])
  }
  return Array.from(map, ([merchantId, list]) => ({ merchantId, vouchers: list }))
}

/** 券是否可用（未用过且未过期） */
export function localVoucherUsable(c: VoucherCode, now = Date.now()): boolean {
  return voucherUsable(c, now)
}

/** 券码有效期上限：套餐有效期与 90 天取小 */
export function voucherExpireAt(validUntil: number, now = Date.now(), maxDays = 90): number {
  return Math.min(validUntil || Infinity, now + maxDays * 86_400_000)
}
