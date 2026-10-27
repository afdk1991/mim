/* ==========================================================================
 * 秒杀业务 —— 限时场次、库存扣减、防超卖
 *
 * 防超卖由服务端三重保障（前端只做展示，不得自行裁定）：
 *   1. 场次行锁（select … for update）串行化并发
 *   2. 条件更新（remaining >= qty）库存不足即失败
 *   3. (session_id, user_id) 主键唯一约束兜底限购
 * 前端铁律：先占库存（hold）成功才建单 —— 绝不允许「下单成功但没库存」。
 * ======================================================================== */

import type { SeckillSession } from '../model'
import { seckillPhase, seckillBuyable } from '../model'

export interface SeckillRow {
  id?: unknown
  goods_id?: unknown
  title?: unknown
  emoji?: unknown
  price_cents?: unknown
  orig_cents?: unknown
  start_at?: unknown
  end_at?: unknown
  remaining?: unknown
  total?: unknown
  limit_per_user?: unknown
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
/** 时间列可能是秒 / 毫秒 / ISO 字符串；<1e12 视为秒 */
const ms = (v: unknown): number => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const t = Date.parse(String(v ?? ''))
  return Number.isFinite(t) ? t : 0
}

export function mapSession(r: SeckillRow): SeckillSession | null {
  if (typeof r.id !== 'string' || !r.id) return null
  const orig = num(r.orig_cents, 0)
  const price = num(r.price_cents, 0)
  return {
    id: r.id,
    goodsId: str(r.goods_id),
    title: str(r.title, '秒杀商品'),
    emoji: str(r.emoji, '⚡'),
    priceFen: price,
    ...(orig > price ? { origPriceFen: orig } : {}),
    startAt: ms(r.start_at),
    endAt: ms(r.end_at),
    remaining: Math.max(0, num(r.remaining, 0)),
    total: Math.max(0, num(r.total, 0)),
    limitPerUser: Math.max(1, num(r.limit_per_user, 1)),
  }
}

export interface SessionGroups {
  ongoing: SeckillSession[]
  upcoming: SeckillSession[]
  ended: SeckillSession[]
}

export function groupSessions(sessions: SeckillSession[], now = Date.now()): SessionGroups {
  const g: SessionGroups = { ongoing: [], upcoming: [], ended: [] }
  for (const s of sessions) {
    const p = seckillPhase(s, now)
    if (p === 'ongoing') g.ongoing.push(s)
    else if (p === 'upcoming') g.upcoming.push(s)
    else g.ended.push(s)
  }
  const byStart = (a: SeckillSession, b: SeckillSession): number => a.startAt - b.startAt
  g.ongoing.sort(byStart)
  g.upcoming.sort(byStart)
  g.ended.sort(byStart)
  return g
}

/** 倒计时文案：>1 天显示天，否则 hh:mm:ss */
export function countdownText(targetAt: number, now = Date.now()): string {
  const diff = targetAt - now
  if (diff <= 0) return '已结束'
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff % 86_400_000) / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1000)
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return d > 0 ? `${d}天 ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`
}

/** 库存进度百分比（0~100） */
export function soldPercent(s: SeckillSession): number {
  if (s.total <= 0) return 0
  return Math.min(100, Math.round(((s.total - s.remaining) / s.total) * 100))
}

export { seckillPhase, seckillBuyable }
