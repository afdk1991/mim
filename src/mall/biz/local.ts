/* ============================================================================
 * 本地生活（频道 mix）：商户门店 + 套餐券 + 到店核销
 *
 * 边界：券码由服务端生成（issue_voucher_code）与核销（verify_voucher），
 * 前端不得自行构造码 —— 否则等于把「到店核销」这个履约凭证开放给客户端伪造。
 * 核销侧靠 status='unused' 的条件更新保证一码只能销一次。
 * ========================================================================== */

import { mallBizRpc } from '../../lib/bizApi'
import { ms, strList, useBizRows, yuan } from './shared'
import type { LocalMerchant, LocalVoucher, VoucherCode, VoucherStatus } from './types'

/* -------------------------------------------------------------------------- */
/* 行 → 模型                                                                   */
/* -------------------------------------------------------------------------- */

export function mapMerchant(r: Record<string, unknown>): LocalMerchant | null {
  const id = typeof r.id === 'string' ? r.id : ''
  if (!id) return null
  const m: LocalMerchant = {
    id,
    name: String(r.name ?? '未命名商户'),
    address: String(r.address ?? ''),
    category: String(r.category ?? '美食'),
    emoji: String(r.emoji ?? '🏪'),
  }
  const lng = Number(r.lng)
  const lat = Number(r.lat)
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    m.lng = lng
    m.lat = lat
  }
  if (typeof r.hours === 'string' && r.hours) m.hours = r.hours
  if (typeof r.phone === 'string' && r.phone) m.phone = r.phone
  return m
}

export function mapVoucher(r: Record<string, unknown>): LocalVoucher | null {
  const id = typeof r.id === 'string' ? r.id : ''
  const merchantId = typeof r.merchant_id === 'string' ? r.merchant_id : ''
  if (!id || !merchantId) return null
  return {
    id,
    merchantId,
    goodsId: typeof r.goods_id === 'string' ? r.goods_id : '',
    title: String(r.title ?? '未命名套餐'),
    emoji: String(r.emoji ?? '🎫'),
    price: yuan(r.price_cents),
    value: yuan(r.value_cents),
    validUntil: ms(r.valid_until),
    rules: strList(r.rules),
    remaining: Math.max(0, Number(r.remaining) || 0),
  }
}

const VOUCHER_STATUSES: VoucherStatus[] = ['unused', 'used', 'expired', 'refunding', 'refunded']

export function mapVoucherCode(r: Record<string, unknown>): VoucherCode | null {
  const code = typeof r.code === 'string' ? r.code : ''
  if (!code) return null
  const raw = String(r.status ?? 'unused')
  const c: VoucherCode = {
    code,
    orderId: String(r.order_id ?? ''),
    voucherId: String(r.voucher_id ?? ''),
    merchantId: String(r.merchant_id ?? ''),
    status: (VOUCHER_STATUSES as string[]).includes(raw) ? (raw as VoucherStatus) : 'unused',
    expireAt: ms(r.expire_at),
  }
  const usedAt = ms(r.used_at)
  if (usedAt > 0) c.usedAt = usedAt
  return c
}

/* -------------------------------------------------------------------------- */
/* 读取                                                                        */
/* -------------------------------------------------------------------------- */

/** 商户门店（公开可读，未登录也能逛） */
export function useLocalMerchants(): {
  merchants: LocalMerchant[]
  loading: boolean
  fromCloud: boolean
} {
  const { rows, loading, fromCloud } = useBizRows<LocalMerchant>('local_merchants', mapMerchant, {
    order: { col: 'name', asc: true },
    limit: 100,
  })
  return { merchants: rows, loading, fromCloud }
}

/** 在售套餐券（公开可读） */
export function useLocalVouchers(): {
  vouchers: LocalVoucher[]
  loading: boolean
  fromCloud: boolean
} {
  const { rows, loading, fromCloud } = useBizRows<LocalVoucher>('local_vouchers', mapVoucher, {
    eq: [['status', 'active']],
    limit: 200,
  })
  return { vouchers: rows, loading, fromCloud }
}

/** 我的券码（RLS 按 user_id 隔离，只可能读到自己的） */
export function useMyVoucherCodes(): {
  codes: VoucherCode[]
  loading: boolean
  fromCloud: boolean
} {
  const { rows, loading, fromCloud } = useBizRows<VoucherCode>('local_voucher_codes', mapVoucherCode, {
    order: { col: 'expire_at', asc: false },
    limit: 100,
  })
  return { codes: rows, loading, fromCloud }
}

/** 按门店归并套餐券（门店页展示用） */
export function vouchersByMerchant(vouchers: LocalVoucher[]): Map<string, LocalVoucher[]> {
  const m = new Map<string, LocalVoucher[]>()
  for (const v of vouchers) {
    const cur = m.get(v.merchantId)
    if (cur) cur.push(v)
    else m.set(v.merchantId, [v])
  }
  return m
}

/* -------------------------------------------------------------------------- */
/* 履约操作（全部服务端）                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 支付成功后取券码（服务端发码，幂等：重复调用返回同一个码）。
 * @returns 券码字符串
 * @throws 订单未支付 / 套餐不存在 等中文错误
 */
export async function issueVoucherCode(orderId: string, voucherId: string): Promise<string> {
  const j = await mallBizRpc<Record<string, unknown>>('issue_voucher_code', {
    p_order_id: orderId,
    p_voucher_id: voucherId,
  })
  return String(j.code ?? '')
}

/** 管理员 / 商户核销券码（一码一次，重复核销服务端拒绝） */
export async function verifyVoucher(code: string): Promise<{ code: string; orderId: string }> {
  const j = await mallBizRpc<Record<string, unknown>>('verify_voucher', { p_code: code })
  return { code: String(j.code ?? code), orderId: String(j.order_id ?? '') }
}
