/* 订单中心：跨频道统一订单管理。
   待支付 → 去支付（payOrder，余额不足提示充值）；已支付 → 确认收货（confirmOrder）。 */

import { useState } from 'react'
import { Empty, useToast } from '../components'
import { cx } from '../utils'
import { MALL_CHANNEL_META, useMall } from './store'
import type { MallOrder } from './store'

const STATUS_META: Record<MallOrder['status'], { label: string; cls: string }> = {
  unpaid: { label: '待支付', cls: 'mall-order-unpaid' },
  paid: { label: '待收货', cls: 'mall-order-paid' },
  done: { label: '已完成', cls: 'mall-order-done' },
}

type Filter = 'all' | MallOrder['status']

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'unpaid', label: '待支付' },
  { key: 'paid', label: '待收货' },
  { key: 'done', label: '已完成' },
]

const fmtTime = (at: number) => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function MallOrdersPage() {
  const { state, payOrder, cancelOrder, confirmOrder } = useMall()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const orders = filter === 'all' ? state.orders : state.orders.filter((o) => o.status === filter)

  const pay = (id: string) => {
    const order = state.orders.find((x) => x.id === id)
    if (payOrder(id)) {
      toast(`支付成功 · ¥${order?.amount ?? 0}，返 ${Math.floor((order?.amount ?? 0) * 0.05)} 积分`)
    } else {
      toast('余额不足，请先到钱包充值')
    }
  }

  return (
    <div className="page-grid single">
      <div>
        <h1 className="page-title">🧾 订单中心</h1>

        <div className="mall-chips">
          {FILTERS.map((f) => (
            <button key={f.key} className={cx('chip', filter === f.key && 'active')} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {orders.length === 0 ? (
          <Empty text="暂无订单" />
        ) : (
          orders.map((o) => (
            <div key={o.id} className="card mall-order-row">
              <div className="mall-order-emoji">{o.emoji}</div>
              <div className="mall-order-info">
                <b>{o.title}</b>
                <small>
                  {MALL_CHANNEL_META[o.channel].emoji} {MALL_CHANNEL_META[o.channel].label} · x{o.qty} · {fmtTime(o.at)}
                </small>
                <b className="mall-order-amount">¥{o.amount}</b>
              </div>
              <div className="mall-order-side">
                <span className={`mall-order-status ${STATUS_META[o.status].cls}`}>{STATUS_META[o.status].label}</span>
                {o.status === 'unpaid' && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => pay(o.id)}>
                      去支付
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        cancelOrder(o.id)
                        toast('已取消订单')
                      }}
                    >
                      取消订单
                    </button>
                  </>
                )}
                {o.status === 'paid' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      confirmOrder(o.id)
                      toast('已确认收货')
                    }}
                  >
                    确认收货
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
