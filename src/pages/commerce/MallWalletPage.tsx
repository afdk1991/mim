/* ==========================================================================
 * 商城钱包 —— 余额 / 流水 / 充值申请
 *
 * 资金红线（刻意不提供「点一下就加钱」的实现）：
 *   充值只能「提交申请」：扫码付款后填金额 + 交易单号 → 生成申请邮件发给客服，
 *   由管理员核对收款、在服务端核销后才入账。页面绝不直接给余额加数，
 *   也绝不渲染伪造的收款码（未配置 payQrCodeUrl 时整块关闭）。
 *
 * 余额真源：getWalletState()（本机快照，云端 wallet_state 权威回拉覆盖）。
 *      它不是 React 状态，所以靠订阅 EVT.wallet 同步刷新。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { getWalletState } from '@/app/state/wallet'
import type { PlanCode, TxKind, WalletTx } from '@/domain/commerce/model'
import { manualConfirmEnabled, qrcodePayInfo } from '@/domain/commerce/payment'
import { SITE_CONFIG } from '@/core/config'
import { subscribe, EVT } from '@/core/events'
import { Empty, useToast } from '@/ui'
import { formatDate, yuanText } from '@/core/utils'

const PLAN_TEXT: Record<PlanCode, string> = {
  BASIC: '基础版',
  SUPER: '超级版',
  DOWNLOAD_PACK: '下载包',
  ENTERPRISE: '企业版',
}

const TX_META: Record<TxKind, { label: string; sign: string; icon: string }> = {
  recharge: { label: '充值', sign: '＋', icon: '🪙' },
  consume: { label: '消费', sign: '－', icon: '💸' },
  income: { label: '收益', sign: '＋', icon: '🎁' },
}

export function MallWalletPage() {
  const [wallet, setWallet] = useState(() => getWalletState())
  const toast = useToast()
  const [amountYuan, setAmountYuan] = useState('')
  const [refNo, setRefNo] = useState('')

  // 钱包余额存在 storage 里，扣款/入账后靠事件总线把新值拉回来
  useEffect(() => subscribe(EVT.wallet, () => setWallet(getWalletState())), [])

  const channelOn = manualConfirmEnabled()
  const qr = qrcodePayInfo()

  const amountFen = Math.round((Number(amountYuan) || 0) * 100)

  /** 充值申请走邮件人工核销，前端不产生任何入账 */
  const mailtoHref = (): string => {
    const subject = encodeURIComponent(`钱包充值申请 ¥${yuanText(amountFen)}`)
    const body = encodeURIComponent(
      [
        `申请充值金额：¥${yuanText(amountFen)}`,
        `付款备注 / 交易单号：${refNo.trim() || '（未填写）'}`,
        '付款方式：扫码支付',
        '',
        '（由管理员核对收款后在服务端入账）',
      ].join('\n'),
    )
    return `mailto:${SITE_CONFIG.contactEmail}?subject=${subject}&body=${body}`
  }

  const openMail = (): void => {
    if (!Number.isFinite(amountFen) || amountFen <= 0) {
      toast('请输入正确的充值金额')
      return
    }
    window.location.href = mailtoHref()
    toast('已生成充值申请，发送后等待管理员核销入账')
  }

  return (
    <div className="page">
      <h1 className="page-title">💰 商城钱包</h1>

      <div className="card mall-wallet-head">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>
            账户余额
          </div>
          <div style={{ fontSize: 26, fontWeight: 600 }}>¥{yuanText(wallet.balanceFen)}</div>
        </div>
        <div className="right">
          <div className="muted" style={{ fontSize: 12 }}>
            当前套餐
          </div>
          <div className="tag">{PLAN_TEXT[wallet.plan]}</div>
        </div>
      </div>

      <div className="section-title">充值</div>
      <div className="card col">
        {!channelOn ? (
          <>
            <Empty emoji="🚫" text="暂不提供自助充值：站点未配置收款码" />
            <small className="muted">
              如需充值请联系客服邮箱 {SITE_CONFIG.contactEmail}，由管理员核销收款后入账。
            </small>
          </>
        ) : (
          <>
            {qr.qrcodeUrl ? (
              <div className="center">
                <img className="mall-qrcode" src={qr.qrcodeUrl} alt="收款码" />
              </div>
            ) : null}
            {qr.note ? <small className="muted">{qr.note}</small> : null}
            <div className="row wrap">
              <input
                className="mall-biz-input"
                inputMode="decimal"
                value={amountYuan}
                placeholder="充值金额（元）"
                onChange={(e) => setAmountYuan(e.target.value)}
              />
              <input
                className="mall-biz-input"
                value={refNo}
                placeholder="付款交易单号 / 备注"
                onChange={(e) => setRefNo(e.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-block" onClick={openMail}>
              生成充值申请邮件
            </button>
            <small className="muted">
              充值不会自动到账：管理员核对收款后才会入账，届时可在本页流水查看。
            </small>
          </>
        )}
      </div>

      <div className="section-title">流水（最近 {wallet.txs.length} 条）</div>
      {wallet.txs.length === 0 ? (
        <Empty emoji="🧾" text="暂无钱包流水：下单支付后这里会出现消费记录" />
      ) : (
        wallet.txs.map((t) => <TxRow key={t.id} tx={t} />)
      )}
    </div>
  )
}

function TxRow({ tx }: { tx: WalletTx }) {
  const meta = TX_META[tx.kind]
  // 流水 fen 一律正数，方向由 kind 决定，展示时只加减不动数值
  const negative = tx.kind === 'consume'
  return (
    <div className="card notif-row">
      <span className="notif-icon">{meta.icon}</span>
      <div className="notif-body">
        <div className="row-between">
          <b>{meta.label}</b>
          <span style={{ color: negative ? 'var(--text-3)' : 'var(--success)', fontWeight: 600 }}>
            {meta.sign}¥{yuanText(tx.fen)}
          </span>
        </div>
        <small className="muted">
          {tx.note || '—'} · {formatDate(tx.at)}
        </small>
      </div>
    </div>
  )
}
