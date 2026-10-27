/* ============================================================================
 * 直播尖货（频道 live）：直播间货架 + 跳转下单
 *
 * 边界：本业务不自建交易链路 —— 直播间只提供「货架 + 专享价 + 讲解位」，
 * 点商品即跳统一商品详情（#/mall/goods/<id>），下单/支付/订单全部复用既有
 * 商城链路，仅在主订单 ext 上挂 live 扩展（房间 / 主播 / 成交专享价）。
 * 这样直播间数量增长不会带来第二套订单状态机。
 * ========================================================================== */

import { useBizRows, yuan } from './shared'
import type { LiveRoom, LiveRoomStatus, LiveShelfItem } from './types'

/* -------------------------------------------------------------------------- */
/* 行 → 模型                                                                   */
/* -------------------------------------------------------------------------- */

const ROOM_STATUSES: LiveRoomStatus[] = ['preview', 'live', 'ended']

export function mapRoom(r: Record<string, unknown>): LiveRoom | null {
  const id = typeof r.id === 'string' ? r.id : ''
  if (!id) return null
  const raw = String(r.status ?? 'live')
  const room: LiveRoom = {
    id,
    title: String(r.title ?? '未命名直播间'),
    anchorId: String(r.anchor_id ?? ''),
    anchorName: String(r.anchor_name ?? '主播'),
    anchorEmoji: String(r.anchor_emoji ?? '🎤'),
    status: (ROOM_STATUSES as string[]).includes(raw) ? (raw as LiveRoomStatus) : 'live',
    startedAt: Number(r.started_at) || 0,
    viewers: Math.max(0, Number(r.viewers) || 0),
  }
  if (typeof r.cover === 'string' && r.cover) room.cover = r.cover
  return room
}

export function mapShelfItem(r: Record<string, unknown>): LiveShelfItem | null {
  const roomId = typeof r.room_id === 'string' ? r.room_id : ''
  const goodsId = typeof r.goods_id === 'string' ? r.goods_id : ''
  if (!roomId || !goodsId) return null
  const item: LiveShelfItem = {
    roomId,
    goodsId,
    title: String(r.title ?? '未命名商品'),
    emoji: String(r.emoji ?? '📦'),
    livePrice: yuan(r.live_cents),
    seq: Math.max(0, Number(r.seq) || 0),
    explaining: r.explaining === true,
  }
  const orig = yuan(r.orig_cents)
  if (orig > item.livePrice) item.origPrice = orig
  return item
}

/* -------------------------------------------------------------------------- */
/* 读取                                                                        */
/* -------------------------------------------------------------------------- */

/** 直播间列表：直播中优先，其次预告，已结束沉底 */
export function useLiveRooms(): { rooms: LiveRoom[]; loading: boolean; fromCloud: boolean } {
  const { rows, loading, fromCloud } = useBizRows<LiveRoom>('live_rooms', mapRoom, {
    order: { col: 'started_at', asc: false },
    limit: 60,
  })
  const rank: Record<LiveRoomStatus, number> = { live: 0, preview: 1, ended: 2 }
  const rooms = rows.slice().sort((a, b) => rank[a.status] - rank[b.status] || b.startedAt - a.startedAt)
  return { rooms, loading, fromCloud }
}

/**
 * 某直播间的货架（按讲解序号升序；正在讲解的置顶）。
 * roomId 为空时不查询（避免全表扫描），返回空列表。
 */
export function useLiveShelf(roomId: string): {
  items: LiveShelfItem[]
  loading: boolean
  fromCloud: boolean
} {
  const { rows, loading, fromCloud } = useBizRows<LiveShelfItem>(
    'live_shelf',
    mapShelfItem,
    roomId ? { eq: [['room_id', roomId]], order: { col: 'seq', asc: true }, limit: 100 } : undefined,
  )
  if (!roomId) return { items: [], loading: false, fromCloud: false }
  const items = rows
    .slice()
    .sort((a, b) => (a.explaining === b.explaining ? a.seq - b.seq : a.explaining ? -1 : 1))
  return { items, loading, fromCloud }
}

/** 房间状态文案（直播中 / 预告 / 已结束） */
export function roomStatusLabel(s: LiveRoomStatus): string {
  return s === 'live' ? '直播中' : s === 'preview' ? '预告' : '已结束'
}
