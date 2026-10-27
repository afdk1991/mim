/* ============================================================================
 * 秒杀特惠（频道 gexm）：限时场次 + 库存扣减 + 防超卖
 *
 * 边界：本模块只负责「会场展示 + 发起抢购」，不持有库存真源。
 * 库存扣减 / 限购 / 锁库存 全部由服务端 seckill_grab 一条 SQL 内完成
 * （行锁 + 条件更新 + 主键唯一约束三重保障），前端任何预扣都会在并发下超卖。
 * ========================================================================== */

import { mallBizRpc } from '../../lib/bizApi'
import { ms, useBizRows, useNow, yuan } from './shared'
import { seckillPhase } from './types'
import type { SeckillSession } from './types'

/** 云端行 → 秒杀场次；缺关键字段（id/goods_id）视为脏数据丢弃 */
export function mapSession(r: Record<string, unknown>): SeckillSession | null {
  const id = typeof r.id === 'string' ? r.id : ''
  const goodsId = typeof r.goods_id === 'string' ? r.goods_id : ''
  if (!id || !goodsId) return null
  const session: SeckillSession = {
    id,
    goodsId,
    title: String(r.title ?? '未命名场次'),
    emoji: String(r.emoji ?? '⚡'),
    price: yuan(r.price_cents),
    startAt: ms(r.start_at),
    endAt: ms(r.end_at),
    remaining: Math.max(0, Number(r.remaining) || 0),
    total: Math.max(0, Number(r.total) || 0),
    limitPerUser: Math.max(1, Number(r.limit_per_user) || 1),
  }
  const orig = yuan(r.orig_cents)
  // 原价不高于秒杀价时无展示意义（脏数据防护）
  if (orig > session.price) session.origPrice = orig
  return session
}

/**
 * 秒杀会场：取在售场次（status='active'，按开抢时间正序）。
 * 云端不可用 → 空态（不兜底演示场次）。
 */
export function useSeckillSessions(): {
  sessions: SeckillSession[]
  loading: boolean
  fromCloud: boolean
  now: number
} {
  const { rows, loading, fromCloud } = useBizRows<SeckillSession>(
    'seckill_sessions',
    mapSession,
    { eq: [['status', 'active']], order: { col: 'start_at', asc: true }, limit: 60 },
  )
  const now = useNow()
  return { sessions: rows, loading, fromCloud, now }
}

/** 场次分组：进行中优先，其次未开始，已结束沉底 */
export function groupSessions(
  sessions: SeckillSession[],
  now: number,
): { ongoing: SeckillSession[]; upcoming: SeckillSession[]; ended: SeckillSession[] } {
  const ongoing: SeckillSession[] = []
  const upcoming: SeckillSession[] = []
  const ended: SeckillSession[] = []
  for (const s of sessions) {
    const p = seckillPhase(s, now)
    if (p === 'ongoing') ongoing.push(s)
    else if (p === 'upcoming') upcoming.push(s)
    else ended.push(s)
  }
  return { ongoing, upcoming, ended }
}

/**
 * 发起抢购（服务端原子扣库存 + 建锁）。
 * @returns 剩余库存与本人累计锁定件数
 * @throws 中文错误（还没开抢 / 已结束 / 已售罄 / 超限量 …），由页面 toast
 */
export async function grabSeckill(
  sessionId: string,
  qty: number,
  orderId: string,
): Promise<{ remaining: number; qty: number }> {
  const j = await mallBizRpc<Record<string, unknown>>('seckill_grab', {
    p_session_id: sessionId,
    p_qty: qty,
    p_order_id: orderId,
  })
  return { remaining: Number(j.remaining) || 0, qty: Number(j.qty) || qty }
}

/** 释放锁库存（取消订单 / 超时未支付）：服务端幂等，无锁也返回成功 */
export async function releaseSeckill(sessionId: string, orderId: string): Promise<void> {
  await mallBizRpc('seckill_release', { p_session_id: sessionId, p_order_id: orderId })
}
