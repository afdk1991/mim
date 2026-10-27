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
import { BIZ_STATUS_META, bizStatusLabel, readOrderExt } from './biz/registry'
import { fmtDate } from './biz/types'
import { issueVoucherCode } from './biz/local'
import { refundTravel } from './biz/travel'
import { releaseSeckill } from './biz/seckill'
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

/* 业务差异行：展示各业务独有字段，并提供该业务的履约动作。
   主订单状态（资金）与履约状态（bizStatus）同时展示 —— 二者正交，不互相替代。 */
function BizLine({ order }: { order: MallOrder }) {
  const toast = useToast()
  const { setBizStatus, setBizExt } = useMall()
  const [busy, setBusy] = useState(false)
  const ext = readOrderExt(order.ext)
  if (!ext) return null
  /* 联合类型收窄：闭包内直接判 ext.kind 会被 TS 的收窄规则漏掉，这里先落变量 */
  const localExt = ext.kind === 'local' ? ext : null
  const travelExt = ext.kind === 'travel' ? ext : null
  const seckillExt = ext.kind === 'seckill' ? ext : null
  const liveExt = ext.kind === 'live' ? ext : null

  let summary = ''
  if (seckillExt) summary = `秒杀价 ¥${seckillExt.seckillPrice} · 库存锁定至 ${fmtTime(seckillExt.lockExpireAt)}`
  if (localExt) {
    summary = `${localExt.merchantName} · 券码 ${localExt.voucherCode || '待支付后发放'} · 有效期至 ${fmtDate(new Date(localExt.expireAt))}`
  }
  if (liveExt) summary = `${liveExt.roomTitle} · 主播 ${liveExt.anchorName} · 专享价 ¥${liveExt.livePrice}`
  if (travelExt) {
    summary = `${travelExt.kindLabel} ${travelExt.date} · ${travelExt.passengers.join('、')} · ${travelExt.seatClass} · ${
      travelExt.rule.refundable ? `可退（手续费 ${Math.round(travelExt.rule.feeRate * 100)}%）` : '不可退'
    }`
  }

  const takeCode = async () => {
    if (!localExt || busy) return
    setBusy(true)
    try {
      const code = await issueVoucherCode(order.id, localExt.voucherId)
      if (!code) {
        toast('取码失败：服务端未返回券码')
        return
      }
      setBizExt(order.id, { ...localExt, voucherCode: code })
      setBizStatus(order.id, 'pending_verify')
      toast(`券码 ${code} · 到店出示即可核销`)
    } catch (e) {
      toast(`取码失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const doRefund = async () => {
    if (!travelExt || busy) return
    setBusy(true)
    try {
      const r = await refundTravel(order.id)
      setBizStatus(order.id, 'refunded')
      toast(`已退票 · 实退 ¥${r.refund}（手续费 ¥${r.fee}）`)
    } catch (e) {
      toast(`退票失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mall-biz-line">
      <span className="muted">{summary}</span>
      {localExt && !localExt.voucherCode && (order.status === 'paid' || order.status === 'done') && (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={takeCode}>
          {busy ? '取码中…' : '取券码'}
        </button>
      )}
      {travelExt && order.bizStatus === 'ticketed' && (
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doRefund}>
          {busy ? '退票中…' : '申请退票'}
        </button>
      )}
      {seckillExt && order.status === 'unpaid' && <span className="muted">请在锁定期内完成支付，超时自动释放</span>}
    </div>
  )
}

/* 管理员核销面板：输入口令确认收款（口令配置于 site-config payConfirmKey） */
function AdminPanel({ order, onClose }: { order: MallOrder; onClose: () => void }) {
  const { confirmManualPay } = useMall()
  const toast = useToast()
  const [key, setKey] = useState('')

  const confirm = async () => {
    const ok = await confirmManualPay(order.id, key)
    if (ok) {
      toast(`已确认收款 ¥${order.amount}，返 ${Math.floor(order.amount * 0.05)} 积分`)
      onClose()
    } else {
      toast('核销失败（口令错误 / 无权限 / 订单状态不正确）')
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
  const [canceling, setCanceling] = useState<string | null>(null)
  const orders = filter === 'all' ? state.orders : state.orders.filter((o) => o.status === filter)

  /**
   * 取消订单：秒杀单要先向服务端释放锁库存，否则库存会被「幽灵锁」占住到超时。
   * 释放失败不阻断取消（锁本身有 15 分钟过期兜底，服务端幂等）。
   */
  const cancel = async (o: MallOrder) => {
    const ext = readOrderExt(o.ext)
    setCanceling(o.id)
    try {
      if (ext?.kind === 'seckill') {
        try {
          await releaseSeckill(ext.sessionId, o.id)
        } catch {
          /* 锁已过期/无锁：服务端幂等，忽略 */
        }
      }
      cancelOrder(o.id)
      toast('已取消订单')
    } finally {
      setCanceling(null)
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
                  {/* 履约状态：与主状态并列展示（资金归资金、交付归交付） */}
                  {o.bizStatus && (
                    <span
                      className={`mall-biz-status ${BIZ_STATUS_META[o.bizStatus]?.cls ?? 'mall-biz-pending'}`}
                    >
                      {bizStatusLabel(o.bizStatus)}
                    </span>
                  )}
                  {o.status === 'unpaid' && (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setOpenPayId(openPayId === o.id ? null : o.id)}
                      >
                        去支付
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={canceling === o.id} onClick={() => cancel(o)}>
                        {canceling === o.id ? '取消中…' : '取消订单'}
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
              {/* 业务差异化：独有字段 + 该业务的履约动作（取券码 / 退票 …） */}
              <BizLine order={o} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
