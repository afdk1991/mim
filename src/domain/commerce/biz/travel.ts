/* ==========================================================================
 * 出行服务业务 —— 票务预订、日期库存、退改规则
 *
 * 与秒杀的两点差异：
 *   1. 库存真源是 (票种, 日期) 组合，而非 SKU 总量 —— 不同日期独立库存
 *   2. 退改规则下单即快照进 ext.rule，运营事后改规则不影响已成交订单
 * 防重复退四道闸门（服务端）：非出行单 / 已在退款中 / 非已出票态 / 不可退
 * ======================================================================== */

import type { TravelDateStock, TravelKind, TravelRule, TravelTicket } from '../model'
import { TRAVEL_KIND_META, travelRefundAmount, travelRefundFee } from '../model'

export interface TicketRow {
  id?: unknown
  kind?: unknown
  title?: unknown
  emoji?: unknown
  from_city?: unknown
  to_city?: unknown
  price_cents?: unknown
  seat_classes?: unknown
}

export interface StockRow {
  ticket_id?: unknown
  date?: unknown
  remaining?: unknown
  price_cents?: unknown
}

export interface RuleRow {
  ticket_id?: unknown
  refundable?: unknown
  changeable?: unknown
  fee_rate?: unknown
  cutoff_hours?: unknown
  note?: unknown
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const KINDS: TravelKind[] = ['flight', 'train', 'bus', 'hotel', 'scenic']

export function mapTicket(r: TicketRow): TravelTicket | null {
  if (typeof r.id !== 'string' || !r.id) return null
  const kind: TravelKind = KINDS.includes(r.kind as TravelKind) ? (r.kind as TravelKind) : 'scenic'
  return {
    id: r.id,
    kind,
    title: str(r.title, '出行票'),
    emoji: str(r.emoji, TRAVEL_KIND_META[kind].emoji),
    fromCity: str(r.from_city),
    toCity: str(r.to_city),
    priceFen: num(r.price_cents, 0),
    seatClasses: strList(r.seat_classes),
  }
}

export function mapDateStock(r: StockRow): TravelDateStock | null {
  const date = str(r.date)
  if (!date || typeof r.ticket_id !== 'string') return null
  return {
    ticketId: r.ticket_id,
    date,
    remaining: Math.max(0, num(r.remaining, 0)),
    priceFen: num(r.price_cents, 0),
  }
}

export function mapRule(r: RuleRow): TravelRule | null {
  if (typeof r.ticket_id !== 'string' || !r.ticket_id) return null
  return {
    ticketId: r.ticket_id,
    // 缺省为可退可改（与原实现一致），费率钳到 [0,1]
    refundable: r.refundable !== false,
    changeable: r.changeable !== false,
    feeRate: Math.min(1, Math.max(0, num(r.fee_rate, 0))),
    cutoffHours: Math.max(0, num(r.cutoff_hours, 0)),
    note: str(r.note),
  }
}

/** 未配置退改规则时的兜底：全额可退，无手续费 */
export function fallbackRule(ticketId: string): TravelRule {
  return {
    ticketId,
    refundable: true,
    changeable: true,
    feeRate: 0,
    cutoffHours: 0,
    note: '未配置退改规则',
  }
}

export { travelRefundFee, travelRefundAmount }

/** 可选日期：只展示还有余票的日期 */
export function bookableDates(stock: TravelDateStock[]): TravelDateStock[] {
  return stock.filter((s) => s.remaining > 0)
}

export function pickStock(stock: TravelDateStock[], date: string | null): TravelDateStock | null {
  if (date) return stock.find((s) => s.date === date) ?? null
  return bookableDates(stock)[0] ?? null
}

/** 日期偏移 n 天，返回 YYYY-MM-DD */
export function dayOffset(n: number, from = Date.now()): string {
  const d = new Date(from + n * 86_400_000)
  const p = (x: number): string => (x < 10 ? `0${x}` : String(x))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
