/* ==========================================================================
 * 直播尖货会场 —— 直播间 + 货架（讲解中置顶）
 *
 * 刻意不自建交易链路：点商品跳统一商品详情 #/mall/goods/<id>，
 * 「专享价下单」走统一 placeBizOrder（无 hold，直播间不占库存），
 * 只在订单 ext 上挂直播间归属。避免为一个频道引入第二套订单状态机。
 *
 * 性能坑：房间信息由父组件统一拉一次并透传给行组件，
 *      否则每个货架行各拉一次云端，行数一多就是 N+1 请求。
 * ======================================================================== */

import { useState } from 'react'
import { useMall } from '@/app/state/mall'
import { useRouter } from '@/app/router'
import type { LiveRoom, LiveShelfItem } from '@/domain/commerce/model'
import {
  ROOM_STATUS_TEXT,
  mapRoom,
  mapShelfItem,
  sortRooms,
  sortShelf,
} from '@/domain/commerce/biz/live'
import type { RoomRow, ShelfRow } from '@/domain/commerce/biz/live'
import { Badge, Empty, Skeleton, useToast } from '@/ui'
import { cx, formatCount, yuanText } from '@/core/utils'
import { useCloudList } from './use-commerce-data'

export function MallLivePage() {
  const rooms = useCloudList<RoomRow, LiveRoom>('live_rooms', mapRoom, {
    order: { col: 'started_at', asc: false },
    limit: 100,
  })
  const shelf = useCloudList<ShelfRow, LiveShelfItem>('live_shelf', mapShelfItem, {
    order: { col: 'seq', asc: true },
    limit: 200,
  })

  const { placeBizOrder } = useMall()
  const { navigate } = useRouter()
  const toast = useToast()
  const [roomId, setRoomId] = useState('')
  const [busyId, setBusyId] = useState('')

  const sorted = sortRooms(rooms.items)
  // 用「查不到就回退第一个」代替 effect 同步：切房间永远是合法值
  const current = sorted.find((r) => r.id === roomId) ?? sorted[0] ?? null
  const items = sortShelf(shelf.items.filter((i) => i.roomId === current?.id))

  const buy = async (item: LiveShelfItem, room: LiveRoom): Promise<void> => {
    setBusyId(item.goodsId)
    const order = await placeBizOrder({
      goodsId: item.goodsId,
      title: item.title,
      emoji: item.emoji,
      priceFen: item.livePriceFen,
      qty: 1,
      ext: {
        kind: 'live',
        roomId: room.id,
        roomTitle: room.title,
        anchorId: room.anchorId,
        anchorName: room.anchorName,
        livePriceFen: item.livePriceFen,
      },
      // 直播间商品走普通发货流程，无需占库存
    })
    setBusyId('')
    if (order) {
      toast('下单成功，请完成支付')
      navigate('/mall/orders')
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">📺 直播尖货</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        直播间货架 · 专享价直下（下单与订单复用统一链路）
      </p>

      {rooms.loading || shelf.loading ? <Skeleton rows={3} height={110} /> : null}

      {!rooms.loading && rooms.error ? <Empty emoji="📭" text={`直播间数据暂不可读：${rooms.error}`} /> : null}

      {!rooms.loading && !rooms.error && sorted.length === 0 ? (
        <Empty emoji="📭" text="暂无直播间，稍后再来看看" />
      ) : null}

      {!rooms.loading && sorted.length > 0 ? (
        <>
          <div className="section-title">直播间</div>
          <div className="chip-row">
            {sorted.map((r) => (
              <button
                key={r.id}
                className={cx('chip', r.id === current?.id && 'active')}
                onClick={() => setRoomId(r.id)}
              >
                {r.anchorEmoji} {r.title}
              </button>
            ))}
          </div>

          {current ? (
            <div className="card mall-biz-card">
              <div className="mall-biz-head">
                <span className="mall-biz-emoji">{current.anchorEmoji}</span>
                <div className="mall-biz-title">
                  <b>{current.title}</b>
                  <small>
                    主播 {current.anchorName} · 👀 {formatCount(current.viewers)}
                  </small>
                </div>
                <Badge cls={current.status === 'live' ? 'unpaid' : current.status === 'ended' ? 'closed' : 'pending'}>
                  {ROOM_STATUS_TEXT[current.status]}
                </Badge>
              </div>
            </div>
          ) : null}

          <div className="section-title">货架（{items.length}）</div>
          {items.length === 0 ? (
            <Empty emoji="📦" text="该直播间暂无货架商品" />
          ) : (
            items.map((i) => (
              <ShelfRow
                key={i.goodsId}
                room={current}
                item={i}
                busy={busyId === i.goodsId}
                onBuy={buy}
              />
            ))
          )}
        </>
      ) : null}
    </div>
  )
}

function ShelfRow({
  room,
  item,
  busy,
  onBuy,
}: {
  /** 由父组件透传，避免每行重复拉云端 */
  room: LiveRoom | null
  item: LiveShelfItem
  busy: boolean
  onBuy: (item: LiveShelfItem, room: LiveRoom) => Promise<void>
}) {
  return (
    <div className={cx('card', 'mall-biz-card', item.explaining && 'mall-biz-explaining')}>
      <div className="mall-biz-head">
        <span className="mall-biz-emoji">{item.emoji}</span>
        <div className="mall-biz-title">
          <b>{item.title}</b>
          <small>
            {room ? `${room.anchorEmoji} ${room.anchorName}` : '直播间'}
            {item.explaining ? ' · 讲解中' : ''}
          </small>
        </div>
        <div className="right">
          <div className="mall-goods-price">¥{yuanText(item.livePriceFen)}</div>
          {item.origPriceFen !== undefined ? <div className="mall-goods-orig">¥{yuanText(item.origPriceFen)}</div> : null}
        </div>
      </div>

      <div className="mall-biz-foot">
        <a className="btn btn-sm" href={`#/mall/goods/${item.goodsId}`}>
          查看详情
        </a>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || !room}
          onClick={() => {
            if (room) void onBuy(item, room)
          }}
        >
          {busy ? '下单中…' : '专享价下单'}
        </button>
      </div>
    </div>
  )
}
