/* ==========================================================================
 * 订单中心 —— 统一订单列表 + 双状态徽标 + 业务差异动作
 *
 * 双状态机正交（页面必须并列展示，不能互相替代）：
 *   status    管资金：unpaid → awaiting_confirm → paid → done
 *   bizStatus 管履约：locked / pending_verify / pending_ticket / ticketed …
 *
 * 业务差异只出现在「有 ext 的订单」上：
 *   秒杀  取消即释放库存（mall.cancelOrder 内部已调 seckill_release）
 *   本地  支付后可「取券码」→ 服务端发码（幂等，重复取返回原码）
 *   出行  已支付后可「出票」（pending_ticket → ticketed）；
 *         bizStatus==='ticketed' 才可「申请退票」，手续费按 ext.rule 快照算
 *
 * 金额铁律：travel_refund 返回的 amount / fee / refund 已经是「分」，
 *      页面只做展示，绝不再除一次 100（历史 bug）。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { useMall } from '@/app/state/mall'
import { getWalletState } from '@/app/state/wallet'
import { BIZ_STATUS_META, ORDER_STATUS_META, filterOrders } from '@/domain/commerce/order'
import { MALL_CHANNEL_META, travelRefundFee } from '@/domain/commerce/model'
import type { MallOrder, OrderStatus } from '@/domain/commerce/model'
import { availableChannels, qrcodePayInfo } from '@/domain/commerce/payment'
import { db } from '@/data/client'
import { errText } from '@/core/result'
import { subscribe, EVT } from '@/core/events'
import { Badge, Empty, Modal, TimeAgo, useToast } from '@/ui'
import { cx, formatDate, yuanText } from '@/core/utils'
import { asRecord, numOf, strOf } from './use-commerce-data'

type TabKey = OrderStatus | 'all'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unpaid', label: ORDER_STATUS_META.unpaid.label },
  { key: 'awaiting_confirm', label: ORDER_STATUS_META.awaiting_confirm.label },
  { key: 'paid', label: ORDER_STATUS_META.paid.label },
  { key: 'done', label: ORDER_STATUS_META.done.label },
]

const PAY_METHODS = ['微信', '支付宝', '银行卡']

function isPaid(o: MallOrder): boolean {
  return o.status === 'paid' || o.status === 'done'
}

/** 业务独有字段的展示文案；无 ext（普通实物订单）时整行不渲染 */
function bizLine(o: MallOrder): string {
  const ext = o.ext
  if (!ext) return ''
  switch (ext.kind) {
    case 'seckill':
      return `秒杀锁价 ¥${yuanText(ext.seckillPriceFen)} · 库存锁定至 ${formatDate(ext.lockExpireAt)}（超时未支付或取消自动释放）`
    case 'local':
      return `${ext.merchantName} · ${ext.voucherCode ? `券码 ${ext.voucherCode}` : '支付后取券码'} · 有效期至 ${formatDate(ext.expireAt)}`
    case 'live':
      return `${ext.roomTitle} · 主播 ${ext.anchorName} · 直播专享价 ¥${yuanText(ext.livePriceFen)}`
    case 'travel':
      return `${ext.kindLabel} ${ext.date} · ${ext.seatClass} · 乘客 ${ext.passengers.join('、') || '—'}`
  }
}

export function MallOrdersPage() {
  const { state, payOrder, submitPayProof, cancelOrder, confirmOrder, setBizStatus, setBizExt, retrySyncOrder } = useMall()
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>('all')
  const [payTarget, setPayTarget] = useState<MallOrder | null>(null)
  const [method, setMethod] = useState(PAY_METHODS[0]!)
  const [proofRef, setProofRef] = useState('')
  const [walletFen, setWalletFen] = useState(() => getWalletState().balanceFen)
  const [busy, setBusy] = useState(false)

  // 钱包余额存在 storage 里而非 React 状态，靠事件总线同步扣款/入账后的变化
  useEffect(() => subscribe(EVT.wallet, () => setWalletFen(getWalletState().balanceFen)), [])

  const list = filterOrders(state.orders, tab)
  const qrcodeOn = availableChannels().some((c) => c.id === 'qrcode-manual')
  const qr = qrcodePayInfo()

  /* ---------- 本地生活：支付后取券码 ---------- */

  const issueVoucher = async (o: MallOrder): Promise<void> => {
    const ext = o.ext
    if (ext?.kind !== 'local') return
    setBusy(true)
    const r = await db.rpc('issue_voucher_code', { p_order_id: o.id, p_voucher_id: ext.voucherId }, { write: true })
    setBusy(false)
    if (!r.ok) {
      toast(`取券码失败：${errText(r.error)}`)
      return
    }
    const code = strOf(asRecord(r.data), 'code')
    if (!code) {
      toast('取券码失败：服务端未返回券码')
      return
    }
    // 服务端幂等：重复点「取券码」返回同一个码，不会生成第二个
    setBizExt(o.id, { ...ext, voucherCode: code })
    setBizStatus(o.id, 'pending_verify')
    toast(`券码已生成：${code}`)
  }

  /* ---------- 出行：出票（AN-001：打通 pending_ticket → ticketed，退票链路才可达） ---------- */

  const issueTravel = async (o: MallOrder): Promise<void> => {
    setBusy(true)
    const r = await db.rpc('travel_issue', { p_order_id: o.id }, { write: true })
    setBusy(false)
    if (!r.ok) {
      toast(`出票失败：${errText(r.error)}`)
      return
    }
    // 服务端事务内已把 biz_status 置 ticketed；本地同步推进，退票闸口随即开放
    setBizStatus(o.id, 'ticketed')
    toast('出票成功，可申请退票')
  }

  /* ---------- 出行：申请退票 ---------- */

  const refundTravel = async (o: MallOrder): Promise<void> => {
    setBusy(true)
    const r = await db.rpc('travel_refund', { p_order_id: o.id }, { write: true })
    setBusy(false)
    if (!r.ok) {
      toast(`退票失败：${errText(r.error)}`)
      return
    }
    const d = asRecord(r.data)
    // 服务端 travel_refund 回包字段为 fee_fen / refund_fen（rpc.js:284-291），
    // 本身已是以「分」为单位的整数，禁止再除 100
    const feeFen = numOf(d, 'fee_fen')
    const refundFen = numOf(d, 'refund_fen')
    setBizStatus(o.id, 'refunded')
    // 不在这里给钱包加钱：服务端已在事务内把退款以 income 流水入钱包（rpc.js:250-266）
    toast(`退票已受理：手续费 ¥${yuanText(feeFen)}，应退 ¥${yuanText(refundFen)}，退款将退回至 Mim 钱包`)
  }

  const closePay = (): void => {
    setPayTarget(null)
    setProofRef('')
  }

  const submitProof = (): void => {
    if (!payTarget) return
    const ref = proofRef.trim()
    if (!ref) {
      toast('请填写交易单号 / 付款备注')
      return
    }
    submitPayProof(payTarget.id, method, ref)
    closePay()
    toast('凭证已提交，等待管理员核销')
  }

  return (
    <div className="page">
      <h1 className="page-title">🧾 订单中心</h1>

      <div className="chip-row">
        {TABS.map((t) => (
          <button key={t.key} className={cx('chip', t.key === tab && 'active')} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <>
          <Empty emoji="🧾" text={tab === 'all' ? '还没有订单，去商城逛逛吧' : '该状态下暂无订单'} />
          <a className="btn btn-primary btn-block" href="#/mall">
            去逛逛
          </a>
        </>
      ) : null}

      {list.map((o) => {
        const ext = o.ext
        return (
          <article className="card mall-order-card" key={o.id}>
            <div className="mall-biz-head">
              <span className="mall-biz-emoji">{o.emoji}</span>
              <div className="mall-biz-title">
                <b>{o.title}</b>
                <small>
                  {o.id} · ×{o.qty} · <TimeAgo ts={o.at} /> · {MALL_CHANNEL_META[o.channel].label}
                </small>
              </div>
              <div className="mall-order-side">
                <Badge cls={ORDER_STATUS_META[o.status].cls}>{ORDER_STATUS_META[o.status].label}</Badge>
                {o.bizStatus ? (
                  <Badge cls={BIZ_STATUS_META[o.bizStatus].cls}>{BIZ_STATUS_META[o.bizStatus].label}</Badge>
                ) : null}
                {state.syncErrors[o.id] ? <Badge cls="unpaid">云端同步失败</Badge> : null}
              </div>
            </div>

            {state.syncErrors[o.id] ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                本地已更新，但服务端写入失败：{state.syncErrors[o.id]}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 8 }}
                  onClick={() => void retrySyncOrder(o.id)}
                >
                  重试
                </button>
              </div>
            ) : null}

            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="mall-goods-price" style={{ fontSize: 18 }}>
                ¥{yuanText(o.amountFen)}
              </span>
              <div className="row wrap">
                {o.status === 'unpaid' ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (payOrder(o.id)) toast('支付成功')
                      }}
                    >
                      钱包支付
                    </button>
                    {qrcodeOn ? (
                      <button className="btn btn-sm" disabled={busy} onClick={() => setPayTarget(o)}>
                        扫码支付
                      </button>
                    ) : null}
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void cancelOrder(o.id)}>
                      取消订单
                    </button>
                  </>
                ) : null}

                {o.status === 'awaiting_confirm' ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {o.proof ? `凭证 ${o.proof.method} · ${o.proof.ref} · ` : ''}等待管理员核销
                  </span>
                ) : null}

                {o.status === 'paid' ? (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => confirmOrder(o.id)}>
                    确认收货
                  </button>
                ) : null}
              </div>
            </div>

            {ext ? (
              <div className="mall-biz-line">
                <span>{bizLine(o)}</span>
                {ext.kind === 'local' && isPaid(o) ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => void issueVoucher(o)}>
                    {ext.voucherCode ? '重新取码' : '取券码'}
                  </button>
                ) : null}
                {ext.kind === 'travel' && isPaid(o) && o.bizStatus === 'pending_ticket' ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => void issueTravel(o)}>
                    出票
                  </button>
                ) : null}
                {ext.kind === 'travel' && o.bizStatus === 'ticketed' ? (
                  <>
                    <span>手续费 ¥{yuanText(travelRefundFee(o.amountFen, ext.rule))}</span>
                    <button className="btn btn-sm" disabled={busy} onClick={() => void refundTravel(o)}>
                      申请退票
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </article>
        )
      })}

      {payTarget ? (
        <Modal
          title={`扫码支付 · ${payTarget.title}`}
          onClose={closePay}
          footer={
            <>
              <button className="btn btn-ghost btn-sm" onClick={closePay}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={submitProof}>
                提交凭证
              </button>
            </>
          }
        >
          <div className="col">
            <div className="row-between">
              <span className="muted">应付金额</span>
              <b className="mall-goods-price">¥{yuanText(payTarget.amountFen)}</b>
            </div>
            <div className="row-between">
              <span className="muted">钱包余额（可直接扣款）</span>
              <span>¥{yuanText(walletFen)}</span>
            </div>
            {qr.qrcodeUrl ? (
              <div className="center">
                <img className="mall-qrcode" src={qr.qrcodeUrl} alt="收款码" />
              </div>
            ) : null}
            {qr.note ? <small className="muted">{qr.note}</small> : null}
            <div className="row wrap">
              {PAY_METHODS.map((m) => (
                <button key={m} className={cx('chip', m === method && 'active')} onClick={() => setMethod(m)}>
                  {m}
                </button>
              ))}
            </div>
            <input
              className="input"
              value={proofRef}
              placeholder="付款交易单号 / 备注"
              onChange={(e) => setProofRef(e.target.value)}
            />
            <small className="muted">提交后订单进入「待确认」，管理员核销收款后自动置为已支付。</small>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
