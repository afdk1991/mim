/* ==========================================================================
 * 直播尖货业务 —— 直播间货架与跳转下单
 *
 * 刻意不自建交易链路：点商品跳统一商品详情，「专享价下单」走统一结算，
 * 只在订单 ext 上挂直播间归属。这是四业务里最轻的一块，
 * 目的就是避免为一个频道引入第二套订单状态机。
 * ======================================================================== */

import type { LiveRoom, LiveRoomStatus, LiveShelfItem } from '../model'

export interface RoomRow {
  id?: unknown
  title?: unknown
  anchor_id?: unknown
  anchor_name?: unknown
  anchor_emoji?: unknown
  status?: unknown
  started_at?: unknown
  viewers?: unknown
  cover?: unknown
}

export interface ShelfRow {
  room_id?: unknown
  goods_id?: unknown
  title?: unknown
  emoji?: unknown
  live_cents?: unknown
  orig_cents?: unknown
  seq?: unknown
  explaining?: unknown
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
/** started_at 是 bigint 毫秒列，直接按毫秒读 */
const ms = (v: unknown): number => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const t = Date.parse(String(v ?? ''))
  return Number.isFinite(t) ? t : 0
}

export function mapRoom(r: RoomRow): LiveRoom | null {
  if (typeof r.id !== 'string' || !r.id) return null
  const status: LiveRoomStatus =
    r.status === 'live' || r.status === 'ended' ? r.status : 'preview'
  return {
    id: r.id,
    title: str(r.title, '直播间'),
    anchorId: str(r.anchor_id),
    anchorName: str(r.anchor_name, '主播'),
    anchorEmoji: str(r.anchor_emoji, '🎥'),
    status,
    startedAt: ms(r.started_at),
    viewers: Math.max(0, num(r.viewers, 0)),
    ...(typeof r.cover === 'string' && r.cover ? { cover: r.cover } : {}),
  }
}

export function mapShelfItem(r: ShelfRow): LiveShelfItem | null {
  if (typeof r.goods_id !== 'string' || !r.goods_id) return null
  const orig = num(r.orig_cents, 0)
  const live = num(r.live_cents, 0)
  return {
    roomId: str(r.room_id),
    goodsId: r.goods_id,
    title: str(r.title, '直播商品'),
    emoji: str(r.emoji, '📦'),
    livePriceFen: live,
    ...(orig > live ? { origPriceFen: orig } : {}),
    seq: num(r.seq, 0),
    explaining: r.explaining === true,
  }
}

export const ROOM_STATUS_TEXT: Record<LiveRoomStatus, string> = {
  preview: '预告',
  live: '直播中',
  ended: '已结束',
}

/** 排序权重：直播中 > 预告 > 已结束 */
const ROOM_ORDER: Record<LiveRoomStatus, number> = { live: 0, preview: 1, ended: 2 }

export function sortRooms(rooms: LiveRoom[]): LiveRoom[] {
  return [...rooms].sort((a, b) => {
    const d = ROOM_ORDER[a.status] - ROOM_ORDER[b.status]
    return d !== 0 ? d : b.startedAt - a.startedAt
  })
}

/** 货架排序：讲解中置顶，其次按讲解序 */
export function sortShelf(items: LiveShelfItem[]): LiveShelfItem[] {
  return [...items].sort((a, b) => {
    if (a.explaining !== b.explaining) return a.explaining ? -1 : 1
    return a.seq - b.seq
  })
}
