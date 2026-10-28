/* ==========================================================================
 * 秒杀会场 —— 场次分组 + 库存进度 + 倒计时 + 抢购
 *
 * 防超卖在前端这一半的落地方式：
 *   placeBizOrder 的 hold 回调先调服务端 seckill_grab，成功才建单。
 *   售罄 / 未开抢 / 已结束 / 超限购全由服务端裁定并抛错，
 *   前端收到即放弃建单 —— 永远不会产生「下单成功但没库存」的订单。
 *   页面上的「剩余 N」只是服务端快照的展示，前端不做任何预扣。
 *
 * 数据：seckill_sessions（status='active'），行 → 模型走 domain 层 mapSession。
 * ======================================================================== */

import { useState } from 'react'
import { useMall } from '@/app/state/mall'
import { useRouter } from '@/app/router'
import type { SeckillSession } from '@/domain/commerce/model'
import { countdownText, groupSessions, mapSession, soldPercent } from '@/domain/commerce/biz/seckill'
import type { SeckillRow } from '@/domain/commerce/biz/seckill'
import { db } from '@/data/client'
import { errText } from '@/core/result'
import { LIMITS } from '@/core/config'
import { Empty, Skeleton, useToast } from '@/ui'
import { formatDate, yuanText } from '@/core/utils'
import { useCloudList, useNow } from './use-commerce-data'

export function MallSeckillPage() {
  const sessions = useCloudList<SeckillRow, SeckillSession>('seckill_sessions', mapSession, {
    eq: [['status', 'active']],
    order: { col: 'start_at', asc: true },
    limit: 200,
  })
  const { placeBizOrder } = useMall()
  const { navigate } = useRouter()
  const toast = useToast()
  const now = useNow()
  const [qty, setQty] = useState(1)
  const [busyId, setBusyId] = useState('')

  const grab = async (s: SeckillSession): Promise<void> => {
    const n = Math.max(1, Math.min(qty, s.limitPerUser, s.remaining))
    setBusyId(s.id)
    const order = await placeBizOrder({
      goodsId: s.goodsId,
      title: s.title,
      emoji: s.emoji,
      priceFen: s.priceFen,
      qty: n,
      ext: {
        kind: 'seckill',
        sessionId: s.id,
        seckillPriceFen: s.priceFen,
        lockExpireAt: Date.now() + LIMITS.seckillLockMs,
      },
      // 先占库存，失败不建单：服务端唯一裁定
      hold: (orderId) =>
        db.rpc('seckill_grab', { p_session_id: s.id, p_qty: n, p_order_id: orderId }, { write: true }).then((r) => {
          if (!r.ok) throw new Error(errText(r.error))
        }),
    })
    setBusyId('')
    if (order) {
      // 锁时长取 LIMITS.seckillLockMs（与服务端 SECKILL_LOCK_MS 对齐），不写死 15 分钟
      toast(`抢购成功，请在 ${Math.round(LIMITS.seckillLockMs / 60_000)} 分钟内完成支付`)
      navigate('/mall/orders')
      sessions.reload()
    }
  }

  const groups = groupSessions(sessions.items, now)

  return (
    <div className="page">
      <h1 className="page-title">⚡ 秒杀特惠</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        限时场次 · 库存锁定 · 防超卖（库存与限购由服务端实时裁定）
      </p>

      <div className="card row-between">
        <span className="muted">下单数量</span>
        <div className="row">
          <button className="btn btn-sm" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="减少">
            －
          </button>
          <b style={{ minWidth: 24, textAlign: 'center' }}>{qty}</b>
          <button className="btn btn-sm" disabled={qty >= 9} onClick={() => setQty((n) => Math.min(9, n + 1))} aria-label="增加">
            ＋
          </button>
        </div>
      </div>

      {sessions.loading ? <Skeleton rows={3} height={110} /> : null}

      {!sessions.loading && sessions.error ? <Empty emoji="📭" text={`场次数据暂不可读：${sessions.error}`} /> : null}

      {!sessions.loading && !sessions.error && sessions.items.length === 0 ? (
        <Empty emoji="📭" text="暂无秒杀场次，稍后再来看看" />
      ) : null}

      {!sessions.loading && sessions.items.length > 0 ? (
        <>
          <SessionSection title="🔥 进行中" list={groups.ongoing} kind="ongoing" now={now} qty={qty} busyId={busyId} onGrab={grab} />
          <SessionSection title="⏰ 即将开始" list={groups.upcoming} kind="upcoming" now={now} qty={qty} busyId={busyId} onGrab={grab} />
          <SessionSection title="✅ 已结束" list={groups.ended} kind="ended" now={now} qty={qty} busyId={busyId} onGrab={grab} />
        </>
      ) : null}
    </div>
  )
}

type GroupKind = 'ongoing' | 'upcoming' | 'ended'

function SessionSection({
  title,
  list,
  kind,
  now,
  qty,
  busyId,
  onGrab,
}: {
  title: string
  list: SeckillSession[]
  kind: GroupKind
  now: number
  qty: number
  busyId: string
  onGrab: (s: SeckillSession) => Promise<void>
}) {
  if (list.length === 0) return null
  return (
    <>
      <div className="section-title">{title}</div>
      {list.map((s) => (
        <SessionCard key={s.id} s={s} kind={kind} now={now} qty={qty} busy={busyId === s.id} onGrab={onGrab} />
      ))}
    </>
  )
}

function SessionCard({
  s,
  kind,
  now,
  qty,
  busy,
  onGrab,
}: {
  s: SeckillSession
  kind: GroupKind
  now: number
  qty: number
  busy: boolean
  onGrab: (s: SeckillSession) => Promise<void>
}) {
  const pct = soldPercent(s)
  const willBuy = Math.max(1, Math.min(qty, s.limitPerUser, s.remaining))
  const left = s.remaining <= 0 ? '已售罄' : `已售 ${pct}%`
  const cd =
    kind === 'ongoing'
      ? `距结束 ${countdownText(s.endAt, now)}`
      : kind === 'upcoming'
        ? `距开始 ${countdownText(s.startAt, now)}`
        : '本场已结束'

  return (
    <div className="card mall-biz-card">
      <div className="mall-biz-head">
        <span className="mall-biz-emoji">{s.emoji}</span>
        <div className="mall-biz-title">
          <b>{s.title}</b>
          <small>
            {formatDate(s.startAt)} ~ {formatDate(s.endAt)} · 限购 {s.limitPerUser} 件
          </small>
        </div>
        <div className="right">
          <div className="mall-goods-price">¥{yuanText(s.priceFen)}</div>
          {s.origPriceFen !== undefined ? <div className="mall-goods-orig">¥{yuanText(s.origPriceFen)}</div> : null}
        </div>
      </div>

      <div className="mall-biz-progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="row-between">
        <small className="muted">
          {left} · 剩余 {s.remaining}/{s.total}
        </small>
        <small className="muted">{cd}</small>
      </div>

      <div className="mall-biz-foot">
        <span className="muted" style={{ fontSize: 12 }}>
          本次下单 {willBuy} 件 · 合计 ¥{yuanText(s.priceFen * willBuy)}
        </span>
        <button
          className="btn btn-primary btn-sm"
          disabled={kind !== 'ongoing' || busy}
          onClick={() => void onGrab(s)}
        >
          {busy ? '抢购中…' : s.remaining <= 0 ? '已售罄' : '立即抢购'}
        </button>
      </div>
    </div>
  )
}
