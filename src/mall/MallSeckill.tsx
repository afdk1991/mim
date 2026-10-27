/* 秒杀特惠会场：限时场次 + 库存进度 + 一键抢购。
   抢购不预扣本地库存 —— 直接调服务端 seckill_grab（行锁 + 条件更新 + 限购唯一约束），
   服务端裁定成功才建单，从根上杜绝超卖与「下单成功但没库存」。 */

import { useState } from 'react'
import { Empty, useToast } from '../components'
import { useRouter } from '../router'
import { cx } from '../utils'
import { useMall } from './store'
import { countdownText, seckillPhase } from './biz/types'
import { grabSeckill, groupSessions, useSeckillSessions } from './biz/seckill'
import type { SeckillSession } from './biz/types'

const PHASE_META: Record<string, { label: string; cls: string }> = {
  upcoming: { label: '未开始', cls: 'mall-biz-pending' },
  ongoing: { label: '抢购中', cls: 'mall-biz-locked' },
  sold_out: { label: '已售罄', cls: 'mall-biz-closed' },
  ended: { label: '已结束', cls: 'mall-biz-closed' },
}

/** 单个场次卡片 */
function SessionCard({ s, now }: { s: SeckillSession; now: number }) {
  const toast = useToast()
  const { navigate } = useRouter()
  const { placeBizOrder } = useMall()
  const [busy, setBusy] = useState(false)
  const phase = seckillPhase(s, now)
  const buyable = phase === 'ongoing'
  const sold = Math.max(0, s.total - s.remaining)
  const pct = s.total > 0 ? Math.min(100, Math.round((sold / s.total) * 100)) : 0
  const meta = PHASE_META[phase] ?? PHASE_META.ended

  const grab = async () => {
    if (!buyable || busy) return
    setBusy(true)
    try {
      const order = await placeBizOrder({
        goodsId: s.goodsId,
        title: s.title,
        emoji: s.emoji,
        price: s.price,
        qty: 1,
        ext: {
          kind: 'seckill',
          sessionId: s.id,
          seckillPrice: s.price,
          lockExpireAt: now + 15 * 60 * 1000,
        },
        // 服务端原子抢购：售罄/未开抢/已结束/超限购都会抛错，此时不建单
        hold: (orderId) => grabSeckill(s.id, 1, orderId).then(() => undefined),
      })
      if (order) {
        toast(`抢购成功 · 已锁定库存，请在 15 分钟内支付 ¥${s.price}`)
        navigate('/mall/orders')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mall-biz-card">
      <div className="mall-biz-head">
        <span className="mall-biz-emoji">{s.emoji}</span>
        <div className="mall-biz-title">
          <b>{s.title}</b>
          <small>
            限购 {s.limitPerUser} 件 · 剩余 {s.remaining}/{s.total}
          </small>
        </div>
        <span className={`mall-biz-status ${meta.cls}`}>{meta.label}</span>
      </div>

      <div className="mall-biz-progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="mall-biz-foot">
        <div className="mall-goods-price">
          <b>¥{s.price}</b>
          {s.origPrice !== undefined && <s>¥{s.origPrice}</s>}
        </div>
        <div className="mall-biz-actions">
          {phase === 'upcoming' && <span className="muted">{countdownText(s.startAt, now) || '即将开始'}</span>}
          {phase === 'ongoing' && <span className="muted">距结束 {countdownText(s.endAt, now)}</span>}
          <button className={cx('btn', 'btn-primary', 'btn-sm')} disabled={!buyable || busy} onClick={grab}>
            {busy ? '抢购中…' : phase === 'upcoming' ? '未开始' : phase === 'ended' ? '已结束' : '立即抢购'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MallSeckillPage() {
  const { sessions, loading, fromCloud, now } = useSeckillSessions()
  const { ongoing, upcoming, ended } = groupSessions(sessions, now)

  return (
    <div className="page-grid single">
      <div>
        <a className="mall-back" href="#/mall">
          ← 返回商城
        </a>
        <h1 className="page-title">⚡ 秒杀特惠</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          限时场次抢购，库存由服务端原子扣减并锁单 15 分钟，超时未支付自动释放。
        </p>

        {loading ? (
          <Empty text="正在加载场次…" />
        ) : !fromCloud ? (
          <Empty text="秒杀业务表未就绪（需应用迁移 0012），暂不可用" />
        ) : sessions.length === 0 ? (
          <Empty text="暂无秒杀场次" />
        ) : (
          <>
            {ongoing.length > 0 && (
              <>
                <h2 className="mall-biz-section">🔥 正在抢购</h2>
                {ongoing.map((s) => (
                  <SessionCard key={s.id} s={s} now={now} />
                ))}
              </>
            )}
            {upcoming.length > 0 && (
              <>
                <h2 className="mall-biz-section">⏰ 即将开抢</h2>
                {upcoming.map((s) => (
                  <SessionCard key={s.id} s={s} now={now} />
                ))}
              </>
            )}
            {ended.length > 0 && (
              <>
                <h2 className="mall-biz-section">✅ 已结束</h2>
                {ended.map((s) => (
                  <SessionCard key={s.id} s={s} now={now} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
