import { useEffect, useState } from 'react'
import './vip.css'
import { useToast } from './components'
import { getCurrentUserId, useAuth } from './auth'
import { pullToolState, pushToolState } from './lib/tool-cloud'
import { walletConsume } from './wallet'

/* ================= VIP 会员中心（订阅收入闭环） =================
   自包含模式：本地存档按登录身份隔离（mim-vip-v1:<userId>），云端快照 key 不变。
   闭环链路：选档 → 统一钱包真实扣费 → 权益生效 → 到期续费叠加 → 订单留痕 → 可退订。
   轮 14 打通：购买不再「假支付」，扣费走 mim-wallet-v1（余额不足自动中止订单）。
   轮 16 打通：本地存档按真实登录身份隔离 + 一次性迁移旧全局 key；切号即重载。 */

type PlanId = 'monthly' | 'quarterly' | 'yearly'

interface VipPlan {
  id: PlanId
  label: string
  price: number
  days: number
  perMonth: string
  tag?: string
  highlight?: boolean
}

const PLANS: VipPlan[] = [
  { id: 'monthly', label: '月卡', price: 25, days: 30, perMonth: '¥25/月' },
  { id: 'quarterly', label: '季卡', price: 68, days: 90, perMonth: '约 ¥22.7/月', tag: '立省 9%' },
  { id: 'yearly', label: '年卡', price: 198, days: 365, perMonth: '约 ¥16.5/月', tag: '立省 34%', highlight: true },
]

const BENEFITS: Array<{ icon: string; title: string; desc: string }> = [
  { icon: '🚫', title: '全站去广告', desc: '信息流与文章页零广告干扰' },
  { icon: '⬇️', title: '资源加速下载', desc: '资源下载台高速通道不限速' },
  { icon: '🎬', title: '漫剧会员专映', desc: '专属片单抢先看、高清片源' },
  { icon: '🪙', title: '签到金币 ×2', desc: '多端商城每日签到双倍金币' },
  { icon: '👑', title: '专属身份标识', desc: 'VIP 徽章与专属昵称头框' },
  { icon: '🎧', title: '优先客服通道', desc: '工单优先响应 7×24 支持' },
]

interface VipOrder {
  id: string
  plan: PlanId
  amount: number
  at: number
}

interface VipState {
  plan: PlanId | null
  expireAt: number
  orders: VipOrder[]
}

/** 云端快照 key（轮 6 语义不变：云表按 RLS user_id 隔离，跨身份共用同一 key） */
const KEY = 'mim-vip-v1'
/* 轮 16 打通：本地存档按登录身份分 key 隔离 */
const vipKeyFor = (userId: string) => `mim-vip-v1:${userId}`
const DAY = 24 * 60 * 60 * 1000

/** 校验并解析 VIP 存档（缺失/非法返回 null） */
function parseVip(raw: string | null): VipState | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    const plan = o.plan === 'monthly' || o.plan === 'quarterly' || o.plan === 'yearly' ? o.plan : null
    const expireAt = typeof o.expireAt === 'number' ? o.expireAt : 0
    const orders: VipOrder[] = Array.isArray(o.orders)
      ? (o.orders as unknown[]).flatMap((v) => {
          if (!v || typeof v !== 'object') return []
          const r = v as Record<string, unknown>
          if (typeof r.id !== 'string' || typeof r.amount !== 'number' || typeof r.at !== 'number') return []
          if (r.plan !== 'monthly' && r.plan !== 'quarterly' && r.plan !== 'yearly') return []
          return [{ id: r.id, plan: r.plan, amount: r.amount, at: r.at }]
        })
      : []
    return { plan, expireAt, orders }
  } catch {
    return null
  }
}

/** 读取当前身份的 VIP 存档（页面重载场景显式传 userId，避免与身份单例同步竞态） */
function loadVip(userId: string = getCurrentUserId()): VipState {
  const localKey = vipKeyFor(userId)
  const own = parseVip(localStorage.getItem(localKey))
  if (own) return own
  return { plan: null, expireAt: 0, orders: [] }
}

function saveVip(s: VipState): void {
  try {
    localStorage.setItem(vipKeyFor(getCurrentUserId()), JSON.stringify(s))
  } catch {
    /* 隐私模式下忽略 */
  }
}

function planLabel(id: PlanId): string {
  return PLANS.find((p) => p.id === id)?.label ?? id
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function uid(): string {
  return 'vo' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function VipCenterPage() {
  const toast = useToast()
  /* 轮 16 打通：登录身份切换时重载对应身份的本地存档（显式传 userId 防竞态） */
  const { auth } = useAuth()
  const [state, setState] = useState<VipState>(loadVip)
  const [payPlan, setPayPlan] = useState<VipPlan | null>(null)
  const [paying, setPaying] = useState(false)

  const now = Date.now()
  const active = state.plan !== null && state.expireAt > now
  const leftDays = active ? Math.max(1, Math.ceil((state.expireAt - now) / DAY)) : 0

  const update = (s: VipState) => {
    saveVip(s)
    pushToolState(KEY, s) // 云端整包快照（未登录/未配置时静默跳过）
    setState(s)
  }

  /* 轮 16 打通：切号（登录/登出）即重载对应身份的 VIP 状态 */
  useEffect(() => {
    setState(loadVip(auth.userId))
  }, [auth.userId])

  /* 云端恢复（轮 6）：mount/切身份后拉取快照 → 写回当前身份本地档 → 重载
     （幂等触发上方保存回推；云端快照 key 不变，云表按 RLS user_id 隔离） */
  useEffect(() => {
    void pullToolState(KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(vipKeyFor(getCurrentUserId()), JSON.stringify(d)) } catch { /* ignore */ }
      setState(loadVip())
    })
  }, [auth.userId])

  const confirmPay = () => {
    if (!payPlan || paying) return
    setPaying(true)
    /* 轮 14 打通：先走统一钱包真实扣费（余额不足内部已 toast 并中止订单） */
    const fen = payPlan.price * 100
    if (!walletConsume(fen, `VIP 会员 · ${payPlan.label}（${payPlan.days} 天）`)) {
      setPaying(false)
      return
    }
    /* 支付通道处理耗时（无真实网关，以定时器占位网关往返） */
    window.setTimeout(() => {
      const base = state.plan !== null && state.expireAt > Date.now() ? state.expireAt : Date.now()
      update({
        plan: payPlan.id,
        expireAt: base + payPlan.days * DAY,
        orders: [{ id: uid(), plan: payPlan.id, amount: payPlan.price, at: Date.now() }, ...state.orders].slice(0, 20),
      })
      setPaying(false)
      setPayPlan(null)
      toast(`🎉 支付成功，${payPlan.label}已生效`)
    }, 900)
  }

  const unsubscribe = () => {
    if (!window.confirm('确定退订吗？会员权益将立即失效，已支付费用不予退回。')) return
    update({ ...state, plan: null, expireAt: 0 })
    toast('已退订，期待您再次开通')
  }

  return (
    <div className="page-grid single">
      <div className="vip-wrap">
        <h2 className="page-title">👑 VIP 会员中心</h2>

        {/* 会员状态卡 */}
        <section className={active ? 'vip-status vip-on' : 'vip-status'}>
          <div className="vip-status-main">
            <i className="vip-crown" aria-hidden>{active ? '👑' : '💫'}</i>
            <div>
              <b>{active ? `${planLabel(state.plan!)} · 生效中` : '尚未开通会员'}</b>
              <small>
                {active
                  ? `有效期至 ${fmtDate(state.expireAt)} · 剩余 ${leftDays} 天`
                  : '开通即享 6 大权益，解锁全站最佳体验'}
              </small>
            </div>
          </div>
          {active && (
            <button className="vip-ghost" onClick={unsubscribe}>
              退订
            </button>
          )}
        </section>

        {/* 套餐选择 */}
        <section className="vip-plans">
          {PLANS.map((p) => (
            <button
              key={p.id}
              className={p.highlight ? 'vip-plan vip-hot' : 'vip-plan'}
              onClick={() => setPayPlan(p)}
            >
              {p.tag && <em className="vip-plan-tag">{p.tag}</em>}
              <b className="vip-plan-name">{p.label}</b>
              <span className="vip-plan-price">
                <i>¥</i>
                {p.price}
              </span>
              <small className="vip-plan-per">{p.perMonth}</small>
              <span className="vip-plan-cta">立即开通</span>
            </button>
          ))}
        </section>

        {/* 权益一览 */}
        <section className="card">
          <h3 className="vip-sec-title">会员专属权益</h3>
          <div className="vip-benefits">
            {BENEFITS.map((b) => (
              <div key={b.title} className="vip-benefit">
                <i aria-hidden>{b.icon}</i>
                <div>
                  <b>{b.title}</b>
                  <small>{b.desc}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 订单记录 */}
        <section className="card">
          <h3 className="vip-sec-title">开通记录</h3>
          {state.orders.length === 0 ? (
            <p className="vip-empty">暂无开通记录，选择上方套餐即可体验完整购买闭环</p>
          ) : (
            <div className="vip-orders">
              {state.orders.map((o) => (
                <div key={o.id} className="vip-order">
                  <span className="vip-order-plan">{planLabel(o.plan)}</span>
                  <small>{fmtTime(o.at)}</small>
                  <b>¥{o.amount}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="vip-note">本页为商业化方向演示：订阅收入模型（月/季/年卡 + 到期续费叠加），扣费走统一钱包（mim-wallet-v1），余额不足时订单中止，可在钱包页充值后重试。</p>
      </div>

      {/* 模拟支付弹层 */}
      {payPlan && (
        <div className="vip-overlay" onClick={() => !paying && setPayPlan(null)}>
          <div className="vip-pay" onClick={(e) => e.stopPropagation()}>
            <h3>确认订单</h3>
            <div className="vip-pay-row">
              <span>套餐</span>
              <b>{payPlan.label}{payPlan.tag ? `（${payPlan.tag}）` : ''}</b>
            </div>
            <div className="vip-pay-row">
              <span>有效期</span>
              <b>{payPlan.days} 天</b>
            </div>
            <div className="vip-pay-row">
              <span>支付方式</span>
              <b>统一钱包扣费（mim-wallet-v1）</b>
            </div>
            <div className="vip-pay-amount">
              应付 <b>¥{payPlan.price}</b>
            </div>
            <button className="vip-pay-btn" disabled={paying} onClick={confirmPay}>
              {paying ? '支付中…' : `确认支付 ¥${payPlan.price}`}
            </button>
            <button className="vip-pay-cancel" disabled={paying} onClick={() => setPayPlan(null)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
