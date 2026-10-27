/* 出行服务会场：票种 + 日期库存 + 退改规则。
   出行按「日期」而非「件数」售卖：库存真源是 travel_date_stock(ticket_id, date)，
   占座走服务端 travel_book（条件更新防超卖）；退改规则在下单时快照进订单 ext，
   运营事后改规则不影响已成交订单。 */

import { useState } from 'react'
import { Empty, useToast } from '../components'
import { useRouter } from '../router'
import { cx } from '../utils'
import { useMall } from './store'
import { dayOffset, travelRefundAmount, travelRefundFee } from './biz/types'
import { TRAVEL_KIND_META, bookTravel, useTravelRules, useTravelStock, useTravelTickets } from './biz/travel'
import type { TravelRule, TravelTicket } from './biz/types'

export function MallTravelPage() {
  const { tickets, loading, fromCloud } = useTravelTickets()
  const { rules, fromCloud: ruleCloud } = useTravelRules()
  const [ticketId, setTicketId] = useState<string>('')
  const active: TravelTicket | undefined = tickets.find((t) => t.id === ticketId) ?? tickets[0]
  const { stock, loading: stockLoading, fromCloud: stockCloud } = useTravelStock(active?.id ?? '')

  return (
    <div className="page-grid single">
      <div>
        <a className="mall-back" href="#/mall">
          ← 返回商城
        </a>
        <h1 className="page-title">🚗 出行服务</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          机票 / 火车票 / 酒店 / 景区门票按日期选库存下单，退改规则下单即快照，行程有变可在线退。
        </p>

        {loading ? (
          <Empty text="正在加载票种…" />
        ) : !fromCloud ? (
          <Empty text="出行业务表未就绪（需应用迁移 0012），暂不可用" />
        ) : tickets.length === 0 ? (
          <Empty text="暂无可售票种" />
        ) : (
          <>
            <div className="mall-chips">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  className={cx('chip', active?.id === t.id && 'active')}
                  onClick={() => setTicketId(t.id)}
                >
                  {t.emoji} {TRAVEL_KIND_META[t.kind].label} · {t.title}
                </button>
              ))}
            </div>

            {active && (
              <BookPanel
                key={active.id}
                ticket={active}
                stock={stock}
                stockLoading={stockLoading}
                stockCloud={stockCloud}
                rule={rules[active.id]}
                ruleCloud={ruleCloud}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* 预订面板：选日期 → 选席别 → 填乘客 → 占座下单 */
function BookPanel({
  ticket,
  stock,
  stockLoading,
  stockCloud,
  rule,
  ruleCloud,
}: {
  ticket: TravelTicket
  stock: { date: string; remaining: number; price: number }[]
  stockLoading: boolean
  stockCloud: boolean
  rule?: TravelRule
  ruleCloud: boolean
}) {
  const toast = useToast()
  const { navigate } = useRouter()
  const { placeBizOrder } = useMall()
  /* 只展示有库存的日期：售罄日不占用用户注意力（与携程/12306 的日历一致） */
  const dates = stock.filter((s) => s.remaining > 0)
  const [date, setDate] = useState<string>('')
  const [seat, setSeat] = useState<string>(ticket.seatClasses[0] ?? '标准')
  const [who, setWho] = useState('')
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)

  const picked = stock.find((s) => s.date === date) ?? dates[0]
  const unit = picked?.price ?? ticket.price
  const amount = unit * qty
  const fee = rule ? travelRefundFee(amount, rule) : 0
  const refund = rule ? travelRefundAmount(amount, rule) : amount

  const book = async () => {
    if (!picked) {
      toast('请选择出行日期')
      return
    }
    if (!who.trim()) {
      toast('请填写乘客 / 入住人姓名')
      return
    }
    setBusy(true)
    try {
      const order = await placeBizOrder({
        goodsId: ticket.id,
        title: `${ticket.fromCity}→${ticket.toCity} ${ticket.title}`,
        emoji: ticket.emoji,
        price: unit,
        qty,
        ext: {
          kind: 'travel',
          ticketId: ticket.id,
          kindLabel: TRAVEL_KIND_META[ticket.kind].label,
          date: picked.date,
          passengers: [who.trim()],
          seatClass: seat,
          rule: rule ?? {
            ticketId: ticket.id,
            refundable: true,
            changeable: true,
            feeRate: 0,
            cutoffHours: 0,
            note: '未配置退改规则',
          },
        },
        // 服务端原子占座：该日期售罄即抛错，不建单
        hold: (orderId) => bookTravel(ticket.id, picked.date, qty, orderId).then(() => undefined),
      })
      if (order) {
        toast(`已占座 · ${picked.date} ${ticket.title} x${qty}`)
        navigate('/mall/orders')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mall-biz-card">
      <div className="mall-biz-head">
        <span className="mall-biz-emoji">{ticket.emoji}</span>
        <div className="mall-biz-title">
          <b>
            {ticket.fromCity} → {ticket.toCity}
          </b>
          <small>
            {TRAVEL_KIND_META[ticket.kind].label} · {ticket.title} · 基准价 ¥{ticket.price}
          </small>
        </div>
      </div>

      <h2 className="mall-biz-section">📅 选择出行日期（{dayOffset(0)} 起）</h2>
      {stockLoading ? (
        <Empty text="正在加载日期库存…" />
      ) : !stockCloud ? (
        <Empty text="日期库存表未就绪（需应用迁移 0012）" />
      ) : dates.length === 0 ? (
        <Empty text="该票种暂无可售日期" />
      ) : (
        <div className="mall-chips">
          {dates.map((s) => (
            <button
              key={s.date}
              className={cx('chip', picked?.date === s.date && 'active')}
              onClick={() => setDate(s.date)}
            >
              {s.date.slice(5)} · ¥{s.price} · 余{s.remaining}
            </button>
          ))}
        </div>
      )}

      <h2 className="mall-biz-section">💺 席别 / 房型</h2>
      <div className="mall-chips">
        {(ticket.seatClasses.length > 0 ? ticket.seatClasses : ['标准']).map((c) => (
          <button key={c} className={cx('chip', seat === c && 'active')} onClick={() => setSeat(c)}>
            {c}
          </button>
        ))}
      </div>

      <h2 className="mall-biz-section">🧍 乘客 / 入住人</h2>
      <div className="mall-biz-form">
        <input
          className="mall-biz-input"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="姓名（与证件一致）"
        />
        <div className="mall-qty">
          <span>数量</span>
          <button className="btn btn-ghost btn-sm" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>
            -
          </button>
          <b>{qty}</b>
          <button className="btn btn-ghost btn-sm" disabled={qty >= 9} onClick={() => setQty(qty + 1)}>
            +
          </button>
        </div>
      </div>

      <h2 className="mall-biz-section">📋 退改规则</h2>
      {!ruleCloud ? (
        <p className="muted">规则表未就绪（需应用迁移 0012）</p>
      ) : !rule ? (
        <p className="muted">该票种未配置退改规则，下单后按默认可退处理。</p>
      ) : (
        <div className="mall-biz-rules">
          <span className="tag">{rule.refundable ? `可退 · 手续费 ${Math.round(rule.feeRate * 100)}%` : '不可退'}</span>
          <span className="tag">{rule.changeable ? '可改签' : '不可改签'}</span>
          {rule.cutoffHours > 0 && <span className="tag">出发前 {rule.cutoffHours} 小时内不可退改</span>}
          {rule.note && <span className="tag">{rule.note}</span>}
        </div>
      )}
      {rule && (
        <p className="muted" style={{ fontSize: 12 }}>
          按当前金额 ¥{amount} 预估：手续费 ¥{fee}，实退 ¥{refund}（最终以服务端裁定为准）。
        </p>
      )}

      <div className="mall-biz-foot">
        <div className="mall-goods-price">
          <b>¥{amount}</b>
        </div>
        <div className="mall-biz-actions">
          <button className="btn btn-primary btn-sm" disabled={busy || !picked} onClick={book}>
            {busy ? '占座中…' : '立即预订'}
          </button>
        </div>
      </div>
    </div>
  )
}
