/* 直播尖货会场：直播间列表 + 讲解中货架。
   本业务不自建交易链路：点商品跳统一商品详情（#/mall/goods/<id>），
   或用直播专享价直接下单 —— 下单/支付/订单全部复用既有商城链路，
   仅在主订单 ext 上挂「房间 / 主播 / 成交专享价」，不引入第二套订单状态机。 */

import { useState } from 'react'
import { Empty, useToast } from '../components'
import { useRouter } from '../router'
import { cx } from '../utils'
import { useMall } from './store'
import { roomStatusLabel, useLiveRooms, useLiveShelf } from './biz/live'
import type { LiveRoom } from './biz/types'

const ROOM_CLS: Record<string, string> = {
  live: 'mall-biz-locked',
  preview: 'mall-biz-pending',
  ended: 'mall-biz-closed',
}

export function MallLivePage() {
  const { rooms, loading, fromCloud } = useLiveRooms()
  const [roomId, setRoomId] = useState<string>('')
  const active: LiveRoom | undefined = rooms.find((r) => r.id === roomId) ?? rooms[0]
  const { items, loading: shelfLoading, fromCloud: shelfCloud } = useLiveShelf(active?.id ?? '')

  return (
    <div className="page-grid single">
      <div>
        <a className="mall-back" href="#/mall">
          ← 返回商城
        </a>
        <h1 className="page-title">📺 直播尖货</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          进入直播间看讲解，点商品跳统一详情下单；直播专享价仅在本会场生效。
        </p>

        {loading ? (
          <Empty text="正在加载直播间…" />
        ) : !fromCloud ? (
          <Empty text="直播业务表未就绪（需应用迁移 0012），暂不可用" />
        ) : rooms.length === 0 ? (
          <Empty text="暂无直播间" />
        ) : (
          <>
            <div className="mall-chips">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  className={cx('chip', active?.id === r.id && 'active')}
                  onClick={() => setRoomId(r.id)}
                >
                  {r.anchorEmoji} {r.title}
                </button>
              ))}
            </div>

            {active && (
              <div className="card mall-biz-card">
                <div className="mall-biz-head">
                  <span className="mall-biz-emoji">{active.anchorEmoji}</span>
                  <div className="mall-biz-title">
                    <b>{active.title}</b>
                    <small>
                      主播 {active.anchorName} · {active.viewers} 人在线
                    </small>
                  </div>
                  <span className={`mall-biz-status ${ROOM_CLS[active.status] ?? 'mall-biz-closed'}`}>
                    {roomStatusLabel(active.status)}
                  </span>
                </div>

                <h2 className="mall-biz-section">🧺 直播间货架</h2>
                {shelfLoading ? (
                  <Empty text="正在加载货架…" />
                ) : !shelfCloud ? (
                  <Empty text="货架表未就绪（需应用迁移 0012）" />
                ) : items.length === 0 ? (
                  <Empty text="该直播间暂无货架商品" />
                ) : (
                  items.map((it) => (
                    <ShelfRow
                      key={it.goodsId}
                      item={it}
                      room={{ id: active.id, title: active.title, anchorId: active.anchorId, anchorName: active.anchorName }}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* 货架行：讲解中置顶高亮；「查看详情」走统一商品页，「专享价下单」走统一结算链路。
   房间信息由父组件透传 —— 子组件不再自行拉取直播间列表，避免每行重复打云端。 */
function ShelfRow({
  item,
  room,
}: {
  item: { goodsId: string; title: string; emoji: string; livePrice: number; origPrice?: number; explaining: boolean }
  room: { id: string; title: string; anchorId: string; anchorName: string }
}) {
  const toast = useToast()
  const { navigate } = useRouter()
  const { placeBizOrder } = useMall()
  const [busy, setBusy] = useState(false)

  const buy = async () => {
    if (busy) return
    setBusy(true)
    try {
      const order = await placeBizOrder({
        goodsId: item.goodsId,
        title: item.title,
        emoji: item.emoji,
        price: item.livePrice,
        qty: 1,
        ext: {
          kind: 'live',
          roomId: room.id,
          roomTitle: room.title,
          anchorId: room.anchorId,
          anchorName: room.anchorName,
          livePrice: item.livePrice,
        },
      })
      if (order) {
        toast(`已按直播专享价 ¥${item.livePrice} 下单`)
        navigate('/mall/orders')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cx('card', 'mall-biz-card', item.explaining && 'mall-biz-explaining')}>
      <div className="mall-biz-head">
        <span className="mall-biz-emoji">{item.emoji}</span>
        <div className="mall-biz-title">
          <b>{item.title}</b>
          <small>{item.explaining ? '🔴 主播正在讲解' : '货架商品'}</small>
        </div>
        {item.explaining && <span className="mall-biz-status mall-biz-locked">讲解中</span>}
      </div>
      <div className="mall-biz-foot">
        <div className="mall-goods-price">
          <b>¥{item.livePrice}</b>
          {item.origPrice !== undefined && <s>¥{item.origPrice}</s>}
        </div>
        <div className="mall-biz-actions">
          <a className="btn btn-ghost btn-sm" href={`#/mall/goods/${item.goodsId}`}>
            查看详情
          </a>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={buy}>
            {busy ? '下单中…' : '专享价下单'}
          </button>
        </div>
      </div>
    </div>
  )
}
