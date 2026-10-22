/* 订单中心：跨频道统一订单管理。
 * 状态机：unpaid →（钱包 payOrder / 扫码提交凭证 submitPayProof）→ paid / awaiting_confirm
 *         awaiting_confirm →（管理员凭口令 confirmManualPay 核销）→ paid
 *         paid →（确认收货 confirmOrder）→ done。
 * 支付通道见 src/mall/payment.ts（钱包余额 + 收款码扫码人工确认）。 */

import { useState } from 'react'
import { Empty, useToast } from '../components'
import { cx } from '../utils'
import { MALL_CHANNEL_META, useMall } from './store'
import type { MallOrder } from './store'
import { PAY_CHANNELS, qrcodePayInfo } from './payment'
import type { PayChannelId } from './payment'

const STATUS_META: Record<MallOrder['status'], { label: string; cls: string }> = {
  unpaid: { label: '待支付', cls: 'mall-order-unpaid' },
  awaiting_confirm: { label: '待确认', cls: 'mall-order-unpaid' },
  paid: { label: '待收货', cls: 'mall-order-paid' },
  done: { label: '已完成', cls: 'mall-order-done' },
}

type Filter = 'all' | MallOrder['status']

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'unpaid', label: '待支付' },
  { key: 'awaiting_confirm', label: '待确认' },
  { key: 'paid', label: '待收货' },
  { key: 'done', label: '已完成' },
]

const fmtTime = (at: number) => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const inputStyle = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid rgba(128,128,128,.3)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
}

/* 支付面板：通道 chip 选择 → 钱包直接扣费 / 扫码后提交付款凭证 */
function PayPanel({ order, onClose }: { order: MallOrder; onClose: () => void }) {
  const { payOrder, submitPayProof } = useMall()
  const toast = useToast()
  const usable = PAY_CHANNELS.filter((c) => c.available())
  const [chId, setChId] = useState<PayChannelId>(usable[0]?.id ?? 'wallet')
  const [method, setMethod] = useState('微信')
  const [ref, setRef] = useState('')
  const qr = qrcodePayInfo()

  const walletPay = () => {
    if (payOrder(order.id)) {
      toast(`支付成功 · ¥${order.amount}，返 ${Math.floor(order.amount * 0.05)} 积分`)
      onClose()
    } else {
      toast('余额不足，请先到钱包充值')
    }
  }

  const submitProof = () => {
    if (!ref.trim()) {
      toast('请填写付款凭证（如转账单号后 6 位）')
      return
    }
    submitPayProof(order.id, method, ref.trim())
    toast('已提交付款凭证，等待管理员确认收款')
    onClose()
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(128,128,128,.3)' }}>
      <div className="mall-chips">
        {usable.map((c) => (
          <button key={c.id} className={cx('chip', chId === c.id && 'active')} onClick={() => setChId(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {chId === 'wallet' && (
        <div>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            从统一钱包余额扣款 ¥{order.amount}，支付成功返 {Math.floor(order.amount * 0.05)} 积分。
          </p>
          <button className="btn btn-primary btn-sm" onClick={walletPay}>
            确认支付 ¥{order.amount}
          </button>
        </div>
      )}
      {chId === 'qrcode-manual' && (
        <div>
          {qr.qrcodeUrl ? (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0' }}>
                <img
                  src={qr.qrcodeUrl}
                  alt="收款码"
                  width={150}
                  height={150}
                  style={{ borderRadius: 8, objectFit: 'contain' }}
                />
                <div style={{ fontSize: 13 }}>
                  <b style={{ display: 'block', marginBottom: 4 }}>应付 ¥{order.amount}</b>
                  {qr.note && (
                    <span className="muted" style={{ display: 'block', marginBottom: 4 }}>
                      收款方：{qr.note}
                    </span>
                  )}
                  <span className="muted">扫码付款后，填写下方凭证提交，管理员确认后订单生效。</span>
                </div>
              </div>
              <div className="mall-chips">
                {['微信', '支付宝', '云闪付', '其他'].map((m) => (
                  <button key={m} className={cx('chip', method === m && 'active')} onClick={() => setMethod(m)}>
                    {m}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  style={inputStyle}
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="付款凭证：如转账单号后 6 位"
                />
                <button className="btn btn-primary btn-sm" onClick={submitProof}>
                  提交凭证
                </button>
              </div>
            </>
          ) : (
            <p className="muted" style={{ margin: '8px 0', fontSize: 12 }}>
              站点尚未配置收款码（site-config payQrCodeUrl），此通道暂不可用。
            </p>
          )}
        </div>
      )}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onClose}>
        收起
      </button>
    </div>
  )
}

/* 管理员核销面板：输入口令确认收款（口令配置于 site-config payConfirmKey） */
function AdminPanel({ order, onClose }: { order: MallOrder; onClose: () => void }) {
  const { confirmManualPay } = useMall()
  const toast = useToast()
  const [key, setKey] = useState('')

  const confirm = () => {
    if (confirmManualPay(order.id, key)) {
      toast(`已确认收款 ¥${order.amount}，返 ${Math.floor(order.amount * 0.05)} 积分`)
      onClose()
    } else {
      toast('核销口令错误（site-config payConfirmKey 未配置或不匹配）')
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(128,128,128,.3)' }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        管理员核销：输入收款确认口令，将订单标记为已支付并发放积分
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={inputStyle}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="核销口令"
          onKeyDown={(e) => e.key === 'Enter' && confirm()}
        />
        <button className="btn btn-primary btn-sm" onClick={confirm}>
          确认收款
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          收起
        </button>
      </div>
    </div>
  )
}

export function MallOrdersPage() {
  const { state, cancelOrder, confirmOrder } = useMall()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const [openPayId, setOpenPayId] = useState<string | null>(null)
  const [openAdminId, setOpenAdminId] = useState<string | null>(null)
  const orders = filter === 'all' ? state.orders : state.orders.filter((o) => o.status === filter)

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
            <div key={o.id} className="card" style={{ marginBottom: 10 }}>
              <div className="mall-order-row">
                <div className="mall-order-emoji">{o.emoji}</div>
                <div className="mall-order-info">
                  <b>{o.title}</b>
                  <small>
                    {MALL_CHANNEL_META[o.channel].emoji} {MALL_CHANNEL_META[o.channel].label} · x{o.qty} ·{' '}
                    {fmtTime(o.at)}
                  </small>
                  <b className="mall-order-amount">¥{o.amount}</b>
                </div>
                <div className="mall-order-side">
                  <span className={`mall-order-status ${STATUS_META[o.status].cls}`}>{STATUS_META[o.status].label}</span>
                  {o.status === 'unpaid' && (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setOpenPayId(openPayId === o.id ? null : o.id)}
                      >
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
                  {o.status === 'awaiting_confirm' && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setOpenAdminId(openAdminId === o.id ? null : o.id)}
                    >
                      管理员核销
                    </button>
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
              {openPayId === o.id && o.status === 'unpaid' && (
                <PayPanel order={o} onClose={() => setOpenPayId(null)} />
              )}
              {openAdminId === o.id && o.status === 'awaiting_confirm' && (
                <AdminPanel order={o} onClose={() => setOpenAdminId(null)} />
              )}
              {o.status === 'awaiting_confirm' && o.proof && openAdminId !== o.id && (
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  付款凭证：{o.proof.method} · {o.proof.ref} · {fmtTime(o.proof.at)}
                  （等待站点管理员确认收款）
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
