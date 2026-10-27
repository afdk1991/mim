/* ==========================================================================
 * 出行会场 —— 票种 / 日期库存 / 席别 / 乘客 / 退改规则
 *
 * 与秒杀的两点差异：
 *   1. 库存真源是 (票种, 日期) 组合，而非 SKU 总量 —— 不同日期独立库存，
 *      所以只展示 remaining>0 的日期（bookableDates）。
 *   2. 退改规则「下单即快照」进 ext.rule，运营事后改规则不影响已成交订单。
 *
 * 防超卖：hold 回调调 travel_book，服务端条件更新扣库存，
 *      库存不足即抛错，前端收到即放弃建单。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { useMall } from '@/app/state/mall'
import { useRouter } from '@/app/router'
import { TRAVEL_KIND_META } from '@/domain/commerce/model'
import type { TravelDateStock, TravelRule, TravelTicket } from '@/domain/commerce/model'
import {
  bookableDates,
  fallbackRule,
  mapDateStock,
  mapRule,
  mapTicket,
  travelRefundAmount,
  travelRefundFee,
} from '@/domain/commerce/biz/travel'
import type { RuleRow, StockRow, TicketRow } from '@/domain/commerce/biz/travel'
import { db } from '@/data/client'
import { errText } from '@/core/result'
import { Badge, Empty, Skeleton, useToast } from '@/ui'
import { cx, yuanText } from '@/core/utils'
import { useCloudList } from './use-commerce-data'

const MAX_QTY = 9

export function MallTravelPage() {
  const tickets = useCloudList<TicketRow, TravelTicket>('travel_tickets', mapTicket, {
    eq: [['status', 'active']],
    order: { col: 'price_cents', asc: true },
    limit: 200,
  })
  const stock = useCloudList<StockRow, TravelDateStock>('travel_date_stock', mapDateStock, {
    order: { col: 'date', asc: true },
    limit: 500,
  })
  const rules = useCloudList<RuleRow, TravelRule>('travel_rules', mapRule, { limit: 200 })

  const { placeBizOrder } = useMall()
  const { navigate } = useRouter()
  const toast = useToast()

  const [ticketId, setTicketId] = useState('')
  const [date, setDate] = useState('')
  const [seatClass, setSeatClass] = useState('')
  const [qty, setQty] = useState(1)
  const [passengers, setPassengers] = useState<string[]>([''])
  const [busy, setBusy] = useState(false)

  // 乘客输入框数量跟随购买数量，多退少补
  useEffect(() => {
    setPassengers((cur) => {
      const next = cur.slice(0, qty)
      while (next.length < qty) next.push('')
      return next
    })
  }, [qty])

  const selected = tickets.items.find((t) => t.id === ticketId) ?? tickets.items[0] ?? null
  const stockOf = selected ? stock.items.filter((s) => s.ticketId === selected.id) : []
  const dates = bookableDates(stockOf)
  // 选中的日期失效（售罄/切票种）时自动落到第一个可订日期
  const picked = dates.find((d) => d.date === date) ?? dates[0] ?? null
  const seat = selected && selected.seatClasses.includes(seatClass) ? seatClass : (selected?.seatClasses[0] ?? '')
  const rule: TravelRule | null = selected
    ? (rules.items.find((r) => r.ticketId === selected.id) ?? fallbackRule(selected.id))
    : null

  const unitFen = picked?.priceFen || selected?.priceFen || 0
  const totalFen = unitFen * qty

  const book = async (): Promise<void> => {
    if (!selected || !picked || !rule) return
    const names = passengers.map((p) => p.trim()).filter(Boolean)
    if (names.length === 0) {
      toast('请填写至少一位乘客姓名')
      return
    }
    setBusy(true)
    const order = await placeBizOrder({
      goodsId: selected.id,
      title: `${selected.title} ${picked.date}`,
      emoji: selected.emoji,
      priceFen: unitFen,
      qty,
      ext: {
        kind: 'travel',
        ticketId: selected.id,
        kindLabel: TRAVEL_KIND_META[selected.kind].label,
        date: picked.date,
        passengers: names,
        seatClass: seat,
        // 快照：运营事后改 travel_rules 不影响这张订单的退改裁定
        rule,
      },
      // 先占日期库存：某日无票即失败，不建单
      hold: (orderId) =>
        db
          .rpc(
            'travel_book',
            { p_ticket_id: selected.id, p_date: picked.date, p_qty: qty, p_order_id: orderId },
            { write: true },
          )
          .then((r) => {
            if (!r.ok) throw new Error(errText(r.error))
          }),
    })
    setBusy(false)
    if (order) {
      toast('占座成功，请完成支付')
      navigate('/mall/orders')
      stock.reload()
    }
  }

  const loading = tickets.loading || stock.loading || rules.loading
  const failed = tickets.error ?? stock.error ?? null

  return (
    <div className="page">
      <h1 className="page-title">🚗 出行服务</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        日期库存 · 在线选座 · 退改规则（按日期独立库存，下单即快照规则）
      </p>

      {loading ? <Skeleton rows={3} height={110} /> : null}

      {!loading && failed ? <Empty emoji="📭" text={`票种数据暂不可读：${failed}`} /> : null}

      {!loading && !failed && tickets.items.length === 0 ? (
        <Empty emoji="📭" text="暂无可售票种，稍后再来看看" />
      ) : null}

      {!loading && selected ? (
        <>
          <div className="section-title">选择票种</div>
          <div className="chip-row">
            {tickets.items.map((t) => (
              <button
                key={t.id}
                className={cx('chip', t.id === selected.id && 'active')}
                onClick={() => setTicketId(t.id)}
              >
                {t.emoji} {t.title}
              </button>
            ))}
          </div>

          <div className="section-title">出行日期</div>
          {dates.length === 0 ? (
            <Empty emoji="📅" text="该票种近期无可订日期" />
          ) : (
            <div className="chip-row">
              {dates.map((d) => (
                <button
                  key={d.date}
                  className={cx('chip', d.date === picked?.date && 'active')}
                  onClick={() => setDate(d.date)}
                >
                  {d.date} · ¥{yuanText(d.priceFen)} · 余 {d.remaining}
                </button>
              ))}
            </div>
          )}

          <div className="section-title">席别</div>
          {selected.seatClasses.length === 0 ? (
            <Empty emoji="💺" text="该票种未配置席别" />
          ) : (
            <div className="chip-row">
              {selected.seatClasses.map((c) => (
                <button key={c} className={cx('chip', c === seat && 'active')} onClick={() => setSeatClass(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="section-title">购买数量</div>
          <div className="card row-between">
            <div className="row">
              <button className="btn btn-sm" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="减少">
                －
              </button>
              <b style={{ minWidth: 24, textAlign: 'center' }}>{qty}</b>
              <button
                className="btn btn-sm"
                disabled={qty >= MAX_QTY || (picked ? qty >= picked.remaining : false)}
                onClick={() => setQty((n) => Math.min(MAX_QTY, n + 1))}
                aria-label="增加"
              >
                ＋
              </button>
            </div>
            <div className="right">
              <div className="muted" style={{ fontSize: 12 }}>
                合计
              </div>
              <div className="mall-goods-price">¥{yuanText(totalFen)}</div>
            </div>
          </div>

          <div className="section-title">乘客</div>
          <div className="card col">
            {passengers.map((p, i) => (
              <div className="row" key={i}>
                <span className="muted" style={{ width: 32 }}>
                  #{i + 1}
                </span>
                <input
                  className="mall-biz-input"
                  value={p}
                  placeholder="乘客姓名"
                  onChange={(e) => {
                    const v = e.target.value
                    setPassengers((cur) => cur.map((x, j) => (j === i ? v : x)))
                  }}
                />
              </div>
            ))}
          </div>

          {rule ? <RuleBlock rule={rule} amountFen={totalFen} /> : null}

          <button
            className="btn btn-primary btn-block"
            disabled={busy || !picked}
            onClick={() => void book()}
          >
            {busy ? '占座中…' : '立即预订'}
          </button>
        </>
      ) : null}
    </div>
  )
}

function RuleBlock({ rule, amountFen }: { rule: TravelRule; amountFen: number }) {
  const feeFen = travelRefundFee(amountFen, rule)
  const refundFen = travelRefundAmount(amountFen, rule)
  return (
    <div className="card col">
      <div className="section-title" style={{ margin: 0 }}>
        退改规则
      </div>
      <div className="mall-biz-rules">
        <Badge cls={rule.refundable ? 'done' : 'closed'}>{rule.refundable ? '可退' : '不可退'}</Badge>
        <Badge cls={rule.changeable ? 'done' : 'closed'}>{rule.changeable ? '可改' : '不可改'}</Badge>
        <span className="tag">手续费率 {Math.round(rule.feeRate * 100)}%</span>
        <span className="tag">
          {rule.cutoffHours > 0 ? `出发前 ${rule.cutoffHours} 小时内不可退改` : '无退改截止时间'}
        </span>
      </div>
      <small className="muted">
        按当前金额试算：手续费 ¥{yuanText(feeFen)}，应退 ¥{yuanText(refundFen)}（单位：分，服务端裁定为准）
      </small>
      {rule.note ? <small className="muted">{rule.note}</small> : null}
    </div>
  )
}
