/* 我的钱包：余额 + 积分 + 充值。
   充值走真实人工核销流程：站点配置收款码 → 用户扫码付款并提交凭证 → 生成待核销申请（不入账）
   → 管理员凭 site-config.payConfirmKey 口令确认到账 → 才写入统一钱包余额。
   未配置收款码时充值通道关闭，不提供任何「点一下余额就增加」的自助入口。 */

import { useState } from 'react'
import { useToast } from '../components'
import { getCurrentUserId } from '../auth'
import { walletRecharge } from '../wallet'
import { useMall } from './store'
import { checkOperatorKey, qrcodePayInfo } from './payment'

const AMOUNTS = [50, 100, 200, 500]

/** 充值凭证申请（本机持久化，跨会话可查；真实到账以管理员核销为准） */
type RechargeReq = {
  id: string
  userId: string
  amount: number
  ref: string
  at: number
  status: 'pending' | 'confirmed'
}

const REQ_KEY = 'mim-recharge-req-v1'

function loadReqs(): RechargeReq[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(REQ_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is RechargeReq => typeof x === 'object' && x !== null && 'id' in x)
  } catch {
    return []
  }
}

function saveReqs(list: RechargeReq[]): void {
  try {
    localStorage.setItem(REQ_KEY, JSON.stringify(list.slice(-50)))
  } catch {
    /* ignore */
  }
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 13,
} as const

export function MallWalletPage() {
  const { state } = useMall()
  const toast = useToast()
  const uid = getCurrentUserId()
  const { qrcodeUrl, note } = qrcodePayInfo()
  const canRecharge = qrcodeUrl.trim() !== ''

  const [amount, setAmount] = useState(AMOUNTS[0] ?? 50)
  const [ref, setRef] = useState('')
  const [key, setKey] = useState('')
  const [reqs, setReqs] = useState<RechargeReq[]>(loadReqs)

  const submit = () => {
    const r = ref.trim()
    if (r === '') {
      toast('请填写付款凭证（转账单号 / 支付截图说明）')
      return
    }
    const req: RechargeReq = {
      id: `rc${Date.now()}`,
      userId: uid,
      amount,
      ref: r,
      at: Date.now(),
      status: 'pending',
    }
    const next = [...reqs, req]
    setReqs(next)
    saveReqs(next)
    setRef('')
    toast(`已提交 ¥${amount} 的付款凭证，等待管理员核销到账`)
  }

  /* 管理员核销：口令校验通过才真正把金额写入统一钱包 */
  const confirmReq = (req: RechargeReq) => {
    if (!checkOperatorKey(key)) {
      toast('核销口令错误（site-config payConfirmKey 未配置或不匹配）')
      return
    }
    walletRecharge(req.amount * 100, `充值 ¥${req.amount}（凭证 ${req.ref} 已人工核销）`)
    const next = reqs.map((x) => (x.id === req.id ? { ...x, status: 'confirmed' as const } : x))
    setReqs(next)
    saveReqs(next)
    setKey('')
    toast(`已确认到账 ¥${req.amount}，余额已入账`)
  }

  const pending = reqs.filter((r) => r.status === 'pending')

  return (
    <div className="page-grid single">
      <div>
        <h1 className="page-title">💰 我的钱包</h1>

        <div className="card mall-wallet-card">
          <div className="mall-wallet-balance">
            <small>钱包余额</small>
            <b>¥{state.wallet}</b>
          </div>
          <div className="mall-wallet-points">
            <span>
              🪙 积分 <b>{state.points}</b>
            </span>
            <small>支付时返 5% 积分</small>
          </div>
        </div>

        <div className="card">
          <h3>充值（扫码付款 + 人工核销）</h3>
          {canRecharge ? (
            <>
              <p className="muted" style={{ marginTop: 4 }}>
                扫码付款后提交凭证，管理员确认收款到账后才会记入余额。未确认前余额不变。
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0' }}>
                <img
                  src={qrcodeUrl}
                  alt="收款码"
                  style={{ width: 132, height: 132, borderRadius: 8, background: '#fff', objectFit: 'contain' }}
                />
                {note.trim() !== '' && <small className="muted">{note}</small>}
              </div>
              <div className="mall-wallet-amounts">
                {AMOUNTS.map((a) => (
                  <button
                    key={a}
                    className={cxBtn(amount === a)}
                    onClick={() => setAmount(a)}
                  >
                    ¥{a}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                  style={inputStyle}
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="付款凭证（转账单号 / 付款时间）"
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
                <button className="btn btn-primary btn-sm" onClick={submit} style={{ whiteSpace: 'nowrap' }}>
                  提交凭证
                </button>
              </div>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 6 }}>
              站点未配置收款码（site-config.payQrCodeUrl），充值通道未开通：
              本站不提供自助充值，余额只能来自已确认真实到账的款项或内容收益。
            </p>
          )}
        </div>

        {reqs.length > 0 && (
          <div className="card">
            <h3>充值凭证记录</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reqs
                .slice()
                .reverse()
                .map((r) => (
                  <div
                    key={r.id}
                    style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, flexWrap: 'wrap' }}
                  >
                    <b>¥{r.amount}</b>
                    <span className="muted">{r.ref}</span>
                    <em style={{ fontStyle: 'normal', color: r.status === 'confirmed' ? '#3a9e5f' : '#c08b2b' }}>
                      {r.status === 'confirmed' ? '已核销到账' : '待核销'}
                    </em>
                    {r.status === 'pending' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => confirmReq(r)}>
                        管理员核销
                      </button>
                    )}
                  </div>
                ))}
            </div>
            {pending.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  管理员核销口令（site-config.payConfirmKey，仅站方持有）
                </div>
                <input
                  style={inputStyle}
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="核销口令"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function cxBtn(active: boolean): string {
  return active ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'
}
