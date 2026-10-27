/* ============================================================================
 * 出行服务（频道 laal）：票务预订 + 日期库存 + 退改规则
 *
 * 边界：出行按「日期」而非「件数」售卖 —— 库存真源是 travel_date_stock
 * (ticket_id, date)，占座与退票同样走服务端 RPC（travel_book / travel_refund），
 * 前端只做日期选择与规则展示，不参与库存计算。
 * 退改规则在下单时快照进订单 ext（防止运营事后改规则影响已成交订单）。
 * ========================================================================== */

import { mallBizRpc } from '../../lib/bizApi'
import { strList, useBizRows, yuan } from './shared'
import type { TravelKind, TravelRule, TravelTicket, TravelDateStock } from './types'

/* -------------------------------------------------------------------------- */
/* 行 → 模型                                                                   */
/* -------------------------------------------------------------------------- */

const TRAVEL_KINDS: TravelKind[] = ['flight', 'train', 'bus', 'hotel', 'scenic']

export const TRAVEL_KIND_META: Record<TravelKind, { emoji: string; label: string }> = {
  flight: { emoji: '✈️', label: '机票' },
  train: { emoji: '🚄', label: '火车票' },
  bus: { emoji: '🚌', label: '汽车票' },
  hotel: { emoji: '🏨', label: '酒店' },
  scenic: { emoji: '🎡', label: '景区门票' },
}

export function mapTicket(r: Record<string, unknown>): TravelTicket | null {
  const id = typeof r.id === 'string' ? r.id : ''
  if (!id) return null
  const raw = String(r.kind ?? 'flight')
  return {
    id,
    kind: (TRAVEL_KINDS as string[]).includes(raw) ? (raw as TravelKind) : 'flight',
    title: String(r.title ?? '未命名票种'),
    emoji: String(r.emoji ?? '🎫'),
    fromCity: String(r.from_city ?? ''),
    toCity: String(r.to_city ?? ''),
    price: yuan(r.price_cents),
    seatClasses: strList(r.seat_classes),
  }
}

/** 日期列可能是 'YYYY-MM-DD' 字符串或 Date 对象序列化结果，统一取前 10 位 */
function asDate(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 10)
  return ''
}

export function mapDateStock(r: Record<string, unknown>): TravelDateStock | null {
  const ticketId = typeof r.ticket_id === 'string' ? r.ticket_id : ''
  const date = asDate(r.date)
  if (!ticketId || !date) return null
  return {
    ticketId,
    date,
    remaining: Math.max(0, Number(r.remaining) || 0),
    price: yuan(r.price_cents),
  }
}

export function mapRule(r: Record<string, unknown>): TravelRule | null {
  const ticketId = typeof r.ticket_id === 'string' ? r.ticket_id : ''
  if (!ticketId) return null
  const rate = Number(r.fee_rate)
  return {
    ticketId,
    refundable: r.refundable !== false,
    changeable: r.changeable !== false,
    feeRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0,
    cutoffHours: Math.max(0, Number(r.cutoff_hours) || 0),
    note: String(r.note ?? ''),
  }
}

/* -------------------------------------------------------------------------- */
/* 读取                                                                        */
/* -------------------------------------------------------------------------- */

/** 在售票种 */
export function useTravelTickets(): {
  tickets: TravelTicket[]
  loading: boolean
  fromCloud: boolean
} {
  const { rows, loading, fromCloud } = useBizRows<TravelTicket>('travel_tickets', mapTicket, {
    eq: [['status', 'active']],
    limit: 200,
  })
  return { tickets: rows, loading, fromCloud }
}

/** 某票种的未来日期库存（按日期升序） */
export function useTravelStock(ticketId: string): {
  stock: TravelDateStock[]
  loading: boolean
  fromCloud: boolean
} {
  const { rows, loading, fromCloud } = useBizRows<TravelDateStock>(
    'travel_date_stock',
    mapDateStock,
    ticketId ? { eq: [['ticket_id', ticketId]], order: { col: 'date', asc: true }, limit: 60 } : undefined,
  )
  if (!ticketId) return { stock: [], loading: false, fromCloud: false }
  return { stock: rows, loading, fromCloud }
}

/** 全部退改规则 → 按票种索引（规则量小，一次取回避免逐票种打云端） */
export function useTravelRules(): {
  rules: Record<string, TravelRule>
  loading: boolean
  fromCloud: boolean
} {
  const { rows, loading, fromCloud } = useBizRows<TravelRule>('travel_rules', mapRule, { limit: 300 })
  const rules: Record<string, TravelRule> = {}
  for (const r of rows) rules[r.ticketId] = r
  return { rules, loading, fromCloud }
}

/* -------------------------------------------------------------------------- */
/* 履约操作（全部服务端）                                                       */
/* -------------------------------------------------------------------------- */

/** 占座（服务端原子扣该票种该日库存） */
export async function bookTravel(
  ticketId: string,
  date: string,
  qty: number,
  orderId: string,
): Promise<{ remaining: number }> {
  const j = await mallBizRpc<Record<string, unknown>>('travel_book', {
    p_ticket_id: ticketId,
    p_date: date,
    p_qty: qty,
    p_order_id: orderId,
  })
  return { remaining: Number(j.remaining) || 0 }
}

/**
 * 退票（服务端按退改规则算手续费、回滚日期库存、推进状态机）。
 * @returns 原金额 / 手续费 / 实退金额（元）
 */
export async function refundTravel(
  orderId: string,
): Promise<{ amount: number; fee: number; refund: number }> {
  const j = await mallBizRpc<Record<string, unknown>>('travel_refund', { p_order_id: orderId })
  return { amount: yuan(j.amount), fee: yuan(j.fee), refund: yuan(j.refund) }
}
