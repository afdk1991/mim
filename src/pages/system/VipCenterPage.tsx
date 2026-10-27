/* ==========================================================================
 * VIP 会员中心 —— 套餐选择 / 订阅 / 退订 / 订单记录
 *
 * 数据：套餐来自 domain/growth 的 VIP_PLANS；状态与订单写本机 mim.vip.<uid>.*。
 * 坑：
 *  1. 扣款必须成功才发权益 —— walletConsume 返回 false 时直接中止，一步都不能少。
 *  2. 续费用 vipRenew：未过期在原到期日叠加，已过期从当前时间重新起算。
 *  3. 退订只清空权益，订单记录保留，并明示「已支付费用不予退回」。
 *  4. 金额一律「分」，展示用 yuanText()。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { LIMITS } from '../../core/config'
import { EVT, subscribe } from '../../core/events'
import { cx, formatDate, formatDay, uid, yuanText } from '../../core/utils'
import { VIP_PLANS, vipActive, vipLeftDays, vipRenew } from '../../domain/growth/growth'
import type { VipPlan, VipState } from '../../domain/growth/growth'
import { getWalletState, walletConsume } from '../../app/state/wallet'
import { Badge, Empty, Tag, useToast } from '../../ui'
import { getVipOrders, getVipState, prependVipOrder, setVipState } from './vip-store'
import type { VipOrder } from './vip-store'

const MONTHLY = VIP_PLANS[0]

/** 与「按月续费」相比共省多少（分）；月卡本身为 0 */
function saveFen(plan: VipPlan): number {
  const months = Math.max(1, Math.round(plan.days / 30))
  return MONTHLY.perMonthFen * months - plan.priceFen
}

export function VipCenterPage() {
  const toast = useToast()
  const [vip, setVip] = useState<VipState>(getVipState)
  const [orders, setOrders] = useState<VipOrder[]>(getVipOrders)
  const [balanceFen, setBalanceFen] = useState(() => getWalletState().balanceFen)

  // 余额在别处变动（消费 / 核销入账）后要跟着刷新，否则会出现「钱够却提示不足」
  useEffect(() => subscribe(EVT.wallet, () => setBalanceFen(getWalletState().balanceFen)), [])

  const active = vipActive(vip)
  const leftDays = vipLeftDays(vip)
  const currentPlan = VIP_PLANS.find((p) => p.id === vip.plan) ?? null

  function onSubscribe(plan: VipPlan): void {
    // 扣款失败即中止：绝不先发权益再补扣
    if (!walletConsume(plan.priceFen, `开通${plan.label}`)) return
    const next = vipRenew(vip, plan)
    setVipState(next)
    setVip(next)
    const order: VipOrder = {
      id: uid('vip_'),
      planId: plan.id,
      label: plan.label,
      priceFen: plan.priceFen,
      days: plan.days,
      at: Date.now(),
    }
    setOrders(prependVipOrder(order))
    setBalanceFen(getWalletState().balanceFen)
    toast(`已开通${plan.label}，有效期至 ${formatDay(next.expireAt)}`)
  }

  function onCancel(): void {
    const confirmed = window.confirm('退订后 VIP 权益立即失效，已支付费用不予退回。确认退订？')
    if (!confirmed) return
    const next: VipState = { plan: null, expireAt: 0 }
    setVipState(next)
    setVip(next)
    // 订单是交易凭证，退订不清空
    toast('已退订，订单记录保留')
  }

  return (
    <div className="page page-grid single">
      <h1 className="page-title">👑 VIP 会员中心</h1>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          当前权益
        </div>
        {active && currentPlan ? (
          <>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <b>{currentPlan.label}</b>
              <Badge cls="paid">生效中</Badge>
              <Tag>剩余 {leftDays} 天</Tag>
            </div>
            <div className="kv-table" style={{ marginTop: 10 }}>
              <div className="kv-row">
                <span className="muted">到期日</span>
                <span>{formatDay(vip.expireAt)}</span>
              </div>
              <div className="kv-row">
                <span className="muted">续费规则</span>
                <span>未过期在原到期日叠加，已过期从续费当天重新起算</span>
              </div>
            </div>
            <button className="btn btn-danger btn-sm" style={{ marginTop: 12 }} onClick={onCancel}>
              退订
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              退订仅停止后续权益，已支付费用不予退回；下方订单记录会一直保留。
            </p>
          </>
        ) : (
          <Empty emoji="👑" text="当前没有生效中的 VIP，选择下方套餐即可开通" />
        )}
      </div>

      <div className="section-title">选择套餐</div>
      <div className="plan-grid">
        {VIP_PLANS.map((plan) => {
          const save = saveFen(plan)
          return (
            <div key={plan.id} className={cx('card', 'plan-card', plan.highlight && 'on')}>
              <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                <b>{plan.label}</b>
                {plan.tag ? <Tag>{plan.tag}</Tag> : null}
              </div>
              <div className="plan-price">¥{yuanText(plan.priceFen)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {plan.days} 天 · 约 ¥{yuanText(plan.perMonthFen)}/月
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {save > 0 ? `相比按月续费省 ¥${yuanText(save)}` : '按月续费，随时可停'}
              </div>
              <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={() => onSubscribe(plan)}>
                订阅
              </button>
            </div>
          )
        })}
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          钱包余额
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <b>¥{yuanText(balanceFen)}</b>
          <a className="btn btn-sm" href="#/wallet">
            去钱包
          </a>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          订阅直接从钱包余额扣款，余额不足时不会发放任何权益。钱包不提供自助充值，需扫码付款后由运营方核销入账。
        </p>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          订单记录（保留最近 {LIMITS.vipOrderMax} 条）
        </div>
        {orders.length === 0 ? (
          <Empty emoji="🧾" text="还没有 VIP 订单" />
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {orders.map((o) => (
              <div className="notif-row" key={o.id}>
                <span className="notif-icon">🧾</span>
                <div className="notif-body">
                  <div>
                    {o.label} · ¥{yuanText(o.priceFen)} · {o.days} 天
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatDate(o.at) || '—'} · 单号 {o.id}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
