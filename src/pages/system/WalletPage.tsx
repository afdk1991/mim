/* ==========================================================================
 * 统一钱包 —— 余额 / 流水 / 权益矩阵
 *
 * 数据：app/state/wallet 的 getWalletState()（本机真源 + 云端回拉）；金额一律「分」。
 * 坑：
 *  1. 展示一律走 yuanText()，禁止 fen/100 的浮点拼装。
 *  2. 权益矩阵的每一行都必须由真实状态判定（会话 / 权限 / VIP / 青少年模式），
 *     不允许写死「已开通」，否则会误导用户。
 *  3. 充值红线：不提供自助充值，页面只说明核销路径，不做「点一下余额就变多」的入口。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { LIMITS, SITE_CONFIG, isSet } from '../../core/config'
import { EVT, subscribe } from '../../core/events'
import { formatDate, yuanText } from '../../core/utils'
import { getSession, hasPerm, hasRole, isSignedIn } from '../../data/session'
import { vipActive } from '../../domain/growth/growth'
import { getWalletState } from '../../app/state/wallet'
import type { TxKind, WalletState } from '../../domain/commerce/model'
import { Badge, Empty, Tag, useToast } from '../../ui'
import { getTeen } from '@/app/state/identity'
import { getVipState } from './vip-store'

const TX_LABEL: Record<TxKind, string> = { recharge: '充值', consume: '消费', income: '收益' }
const TX_BADGE: Record<TxKind, string> = { recharge: 'paid', consume: 'unpaid', income: 'done' }
const TX_SIGN: Record<TxKind, string> = { recharge: '+', consume: '-', income: '+' }

export function WalletPage() {
  const toast = useToast()
  const [wallet, setWallet] = useState<WalletState>(getWalletState)
  const [, setTick] = useState(0)

  // 余额由钱包事件驱动；会话与身份域变化会改变权益矩阵，也要跟着刷新
  useEffect(() => {
    const refresh = (): void => {
      setWallet(getWalletState())
      setTick((t) => t + 1)
    }
    const offs = [subscribe(EVT.wallet, refresh), subscribe(EVT.auth, refresh), subscribe(EVT.identity, refresh)]
    return () => {
      for (const off of offs) off()
    }
  }, [])

  const session = getSession()
  const vip = getVipState()
  const teen = getTeen()
  const signed = isSignedIn()

  const matrix: Array<[string, boolean, string]> = [
    [
      '登录状态',
      signed,
      signed ? `已登录：${session.name}` : '未登录，本机数据换设备即丢失',
    ],
    ['后台管理', hasRole('admin'), hasRole('admin') ? '已授予 admin 角色' : '需运营方授予 admin 角色'],
    ['审计日志查看', hasPerm('audit:view'), hasPerm('audit:view') ? '已授予 audit:view' : '缺少 audit:view 权限'],
    ['角色管理', hasPerm('role:manage'), hasPerm('role:manage') ? '已授予 role:manage' : '缺少 role:manage 权限'],
    ['VIP 权益', vipActive(vip), vipActive(vip) ? `${vip.plan} 生效中` : '未开通 VIP'],
    ['青少年模式', teen.enabled, teen.enabled ? '已开启，内容按青少年口径过滤' : '未开启'],
    ['钱包消费', wallet.balanceFen > 0, `可用余额 ¥${yuanText(wallet.balanceFen)}`],
  ]

  return (
    <div className="page page-grid single">
      <h1 className="page-title">💰 统一钱包</h1>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          账户余额
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: 24 }}>¥{yuanText(wallet.balanceFen)}</b>
          <Tag>套餐码 {wallet.plan}</Tag>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          钱包不提供自助充值：需扫码付款后由运营方核销入账，本页面没有「一键加钱」入口。
          {isSet(SITE_CONFIG.contactEmail) ? ` 核销与对账请联系 ${SITE_CONFIG.contactEmail}。` : ''}
        </p>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          权益矩阵
        </div>
        <div className="kv-table">
          {matrix.map(([label, on, note]) => (
            <div className="kv-row" key={label}>
              <span>{label}</span>
              <span className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {note}
                </span>
                <Badge cls={on ? 'paid' : 'closed'}>{on ? '可用' : '不可用'}</Badge>
              </span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          以上全部由当前会话与本机状态实时判定；套餐码 {wallet.plan} 的具体权益项由服务端下发，未下发时不展示明细。
        </p>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          流水记录（最近 {LIMITS.walletTxMax} 条）
        </div>
        {wallet.txs.length === 0 ? (
          <Empty emoji="🧾" text="还没有流水：消费或运营方核销入账后会在这里出现" />
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {wallet.txs.map((t) => (
              <div className="notif-row" key={t.id}>
                <span className="notif-icon">{t.kind === 'consume' ? '➖' : '➕'}</span>
                <div className="notif-body">
                  <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                    <span>{t.note}</span>
                    <Badge cls={TX_BADGE[t.kind] ?? 'closed'}>{TX_LABEL[t.kind] ?? t.kind}</Badge>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatDate(t.at) || '—'}
                  </div>
                </div>
                <b>
                  {TX_SIGN[t.kind] ?? ''}¥{yuanText(t.fen)}
                </b>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <a className="btn btn-sm" href="#/vip">
            去 VIP 会员中心
          </a>
          <button className="btn btn-sm" onClick={() => toast('流水以服务端核销记录为准，如有出入请联系运营方对账')}>
            对账有疑问？
          </button>
        </div>
      </div>
    </div>
  )
}
