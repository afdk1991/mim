/* 我的钱包：余额 + 积分 + 充值。演示环境不接入真实支付。 */

import { useToast } from '../components'
import { useMall } from './store'

const AMOUNTS = [50, 100, 200, 500]

export function MallWalletPage() {
  const { state, recharge } = useMall()
  const toast = useToast()

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
          <h3>充值</h3>
          <div className="mall-wallet-amounts">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                className="btn btn-ghost"
                onClick={() => {
                  recharge(a)
                  toast(`充值成功 +¥${a}`)
                }}
              >
                ¥{a}
              </button>
            ))}
          </div>
          <small className="muted">充值立即到账（演示环境，不接入真实支付）</small>
        </div>
      </div>
    </div>
  )
}
