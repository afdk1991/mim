import './wallet.css'
import { useEffect, useState } from 'react'
import { Empty, TimeAgo, emitToast, useToast } from './components'
import { getCurrentUserId, useAuth } from './auth'
import { cx } from './utils'

/** 统一钱包 + 权益矩阵（开发吧.md 4.2 entitlement_matrix / 4.3 revenue_rule）
 *  金额一律存「分」整数（结算铁律）；收益入账携带 revenue_rule 下单时刻快照；
 *  单态（2026-10-23）：统一钱包不分域，权益项不再按域打标。
 *  轮 14 打通：对外暴露模块级钱包 API（walletConsume/walletIncome/revenueSnapshot），
 *  VIP 购买、内容分成等跨模块链路统一走 mim-wallet-v1 入账/扣费，
 *  钱包页监听更新事件实时同步外部变更。
 *  轮 15 打通：新增 walletRecharge（充值通道，kind=recharge 非收益），
 *  商城钱包充值并轨到统一钱包，全站余额唯一源。
 *  轮 16 打通：存档按真实登录身份隔离（mim-wallet-v1:<userId>），切号即重载。 */

type PlanCode = 'BASIC' | 'SUPER' | 'DOWNLOAD_PACK' | 'ENTERPRISE'

/** 权益项（单态：不再按域打标，全站统一权益池） */
interface Entitlement {
  benefit: string
  quota: string
  label: string
}

/** entitlement_matrix 全量（对齐开发吧.md 4.2，❌ 两条为禁止项不进权益池） */
const ENTITLEMENTS: Record<PlanCode, Entitlement[]> = {
  BASIC: [
    { benefit: 'no_ads', quota: '∞', label: '免广告' },
    { benefit: 'decoration_theme', quota: '∞', label: '装扮主题' },
    { benefit: 'post_top', quota: '5/月', label: '动态置顶' },
    { benefit: 'edit_published', quota: '∞', label: '编辑已发内容' },
  ],
  SUPER: [
    { benefit: 'column_library', quota: '∞', label: '订阅专栏库' },
    { benefit: 'course_discount', quota: '∞', label: '购课 8 折' },
    { benefit: 'geo_report', quota: '3/月', label: 'GEO 检测' },
    { benefit: 'video_hd', quota: '∞', label: '高清视频' },
  ],
  DOWNLOAD_PACK: [
    { benefit: 'download_quota', quota: '30/月', label: '下载配额（可单独售卖，不绑会员）' },
  ],
  ENTERPRISE: [
    { benefit: 'brand_zone', quota: '∞', label: '品牌号 + 舆情' },
    { benefit: 'tech_promo', quota: '∞', label: '技术推广 + 简历库' },
  ],
}

const PLAN_META: Record<PlanCode, { label: string; desc: string }> = {
  BASIC: { label: '基础版', desc: '免广告 + 基础创作权益' },
  SUPER: { label: '超级会员', desc: '订阅/课程/检测全家桶' },
  DOWNLOAD_PACK: { label: '下载包', desc: '独立售卖，不绑会员' },
  ENTERPRISE: { label: '企业版', desc: '品牌 + 技术推广' },
}

/** revenue_rule 全量（费率可配置化，代码不硬编码；floor_price 单位分） */
const REVENUE_RULES: {
  contentType: string
  sku: string
  rate: string
  floor: string
  settle: string
}[] = [
  { contentType: '20 博文', sku: 'ad_cpc', rate: '60%', floor: '30分', settle: 'T+1' },
  { contentType: '21 专栏', sku: 'column_buy', rate: '70%', floor: '0', settle: 'T+3' },
  { contentType: '22 资源', sku: 'resource_buy', rate: '80%', floor: '0', settle: 'T+3' },
  { contentType: '20 博文(VIP)', sku: 'vip_read', rate: '20%', floor: '0', settle: 'T+1' },
  { contentType: '25 回答', sku: 'bounty', rate: '100%', floor: '0', settle: 'T+0' },
  { contentType: '23 课程', sku: 'course_buy', rate: '60%', floor: '0', settle: 'T+7' },
  { contentType: '10 动态', sku: 'ad_cpm_share', rate: '50%', floor: '0', settle: 'T+1' },
  { contentType: '12 视频', sku: 'video_play', rate: '55%', floor: '0', settle: 'T+1' },
  { contentType: '13 直播', sku: 'gift', rate: '45%', floor: '0', settle: 'T+7' },
]

/** 钱包流水：income 携带 revenue_rule 快照（下单时刻冻结，改费率不影响历史） */
interface Tx {
  id: number
  kind: 'recharge' | 'consume' | 'income'
  fen: number // 一律为正数金额（分），方向由 kind 决定
  note: string
  at: number
  snapshot?: {
    content_type: number
    sku_type: string
    rate_pct: string
    settle_tn: string
  }
}

interface WalletState {
  balanceFen: number
  plan: PlanCode
  txs: Tx[]
}

/* 轮 16 打通：真实数据按登录身份分 key 隔离 */
const walletKeyFor = (userId: string) => `mim-wallet-v1:${userId}`

/** 校验并解析钱包快照（缺失/非法返回 null） */
function parseWallet(raw: string | null): WalletState | null {
  try {
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<WalletState>
    if (
      typeof p.balanceFen === 'number' && p.balanceFen >= 0 &&
      (p.plan && p.plan in ENTITLEMENTS) &&
      Array.isArray(p.txs)
    ) {
      return { balanceFen: p.balanceFen, plan: p.plan as PlanCode, txs: p.txs }
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 读取当前身份的钱包（页面重载场景显式传 userId，避免与身份单例同步竞态） */
function loadWallet(userId: string = getCurrentUserId()): WalletState {
  const key = walletKeyFor(userId)
  const own = parseWallet(localStorage.getItem(key))
  if (own) return own
  return { balanceFen: 0, plan: 'BASIC', txs: [] }
}

/** 分 → 元展示（仅展示层转换，存储永远是分） */
const yuan = (fen: number) => (fen / 100).toFixed(2)

/* ---------- 轮 14 打通：模块级统一钱包 API ---------- */

/** 钱包更新事件：外部模块入账/扣费后派发，钱包页监听同步 */
export const WALLET_UPDATE_EVT = 'mim-wallet-update'

/** 落盘并广播（外部链路写 localStorage 后通知钱包页重读） */
function persistWallet(next: WalletState): void {
  try {
    localStorage.setItem(walletKeyFor(getCurrentUserId()), JSON.stringify(next))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(WALLET_UPDATE_EVT))
}

/** 外部模块查询钱包快照（余额/当前套餐） */
export function getWalletState(): WalletState {
  return loadWallet()
}

/** 统一扣费入口：余额不足返回 false（内部已 toast，调用方应中止订单） */
export function walletConsume(fen: number, note: string): boolean {
  if (!Number.isFinite(fen) || fen <= 0) return false
  const s = loadWallet()
  if (s.balanceFen < fen) {
    emitToast(`余额不足：需 ¥${yuan(fen)}，当前 ¥${yuan(s.balanceFen)}，请到商城钱包扫码付款并等待管理员核销到账`)
    return false
  }
  const tx: Tx = { id: Date.now(), kind: 'consume', fen, note, at: Date.now() }
  persistWallet({
    ...s,
    balanceFen: s.balanceFen - fen,
    txs: [tx, ...s.txs].slice(0, 50),
  })
  emitToast(`已扣费 ¥${yuan(fen)}：${note}`)
  return true
}

/** 统一充值入口：仅由「真实收款渠道人工核销」调用（kind=recharge，非收益，不携快照）；
 *  禁止任何无凭证自助入账——余额只能来自已确认到账的款项或真实内容收益。 */
export function walletRecharge(fen: number, note: string): void {
  if (!Number.isFinite(fen) || fen <= 0) return
  const s = loadWallet()
  const tx: Tx = { id: Date.now(), kind: 'recharge', fen, note, at: Date.now() }
  persistWallet({
    ...s,
    balanceFen: s.balanceFen + fen,
    txs: [tx, ...s.txs].slice(0, 50),
  })
  emitToast(`充值到账 +¥${yuan(fen)}`)
}

/** 统一收益入账入口：携带 revenue_rule 下单时刻快照（域/类型/sku/费率/结算周期） */
export function walletIncome(
  fen: number,
  note: string,
  snap: NonNullable<Tx['snapshot']>,
): void {
  if (!Number.isFinite(fen) || fen <= 0) return
  const s = loadWallet()
  const tx: Tx = { id: Date.now(), kind: 'income', fen, note, at: Date.now(), snapshot: snap }
  persistWallet({
    ...s,
    balanceFen: s.balanceFen + fen,
    txs: [tx, ...s.txs].slice(0, 50),
  })
  emitToast(`收益到账 +¥${yuan(fen)}：${note}`)
}

/** 按 sku 取 revenue_rule 快照（运营改表后新订单生效，历史流水快照不变） */
export function revenueSnapshot(sku: string): NonNullable<Tx['snapshot']> | null {
  const r = REVENUE_RULES.find((x) => x.sku === sku)
  if (!r) return null
  return {
    content_type: Number.parseInt(r.contentType, 10),
    sku_type: r.sku,
    rate_pct: r.rate,
    settle_tn: r.settle,
  }
}

const KIND_META: Record<Tx['kind'], { icon: string; label: string }> = {
  recharge: { icon: '🪙', label: '充值' },
  consume: { icon: '💳', label: '消费' },
  income: { icon: '📈', label: '收益' },
}

export function WalletPage() {
  const toast = useToast()
  /* 轮 16 打通：登录身份切换时重载对应身份的钱包存档（显式传 userId 防竞态） */
  const { auth } = useAuth()
  const [state, setState] = useState<WalletState>(loadWallet)
  const { balanceFen, plan, txs } = state

  /* 轮 14 打通：外部链路（VIP 扣费/资源分成）写入钱包后，本页实时同步 */
  useEffect(() => {
    const sync = () => setState(loadWallet())
    window.addEventListener(WALLET_UPDATE_EVT, sync)
    return () => window.removeEventListener(WALLET_UPDATE_EVT, sync)
  }, [])

  /* 轮 16 打通：切号（登录/登出）即重载对应身份的钱包 */
  useEffect(() => {
    setState(loadWallet(auth.userId))
  }, [auth.userId])

  const save = (next: WalletState) => {
    setState(next)
    /* 轮 16 打通：统一走 persistWallet 落盘（按当前身份 key 写入并广播，
       商城等外部镜像随之同步；页内监听事件后重读同一份数据，幂等） */
    persistWallet(next)
  }

  const switchPlan = (p: PlanCode) => {
    if (p === plan) return
    save({ ...state, plan: p })
    toast(`已切换为 ${PLAN_META[p].label}（${PLAN_META[p].desc}）`)
  }

  const clearAll = () => {
    save({ balanceFen: 0, plan: 'BASIC', txs: [] })
    toast('已清空钱包数据')
  }

  const benefits = ENTITLEMENTS[plan]

  return (
    <div className="page-grid single">
      <div className="wl-page">
        <header className="wl-head">
          <h2>💰 统一钱包 + 权益矩阵</h2>
          <p className="wl-sub">
            entitlement_matrix（开发吧.md 4.2）——单态下统一权益池，不再按域打标；
            所有权益全站通用，不再区分广场/知识边界
          </p>
        </header>

        {/* 余额大卡：存储分 / 展示元 */}
        <div className="wl-balance-card">
          <div className="wl-balance-label">统一钱包余额（plan：{PLAN_META[plan].label}）</div>
          <div className="wl-balance-num">
            ¥{yuan(balanceFen)}
            <span className="wl-fen"> = {balanceFen} 分（存储铁律：金额存「分」整数）</span>
          </div>
        </div>

        {/* 套餐切换 */}
        <h3 className="wl-sec-title">套餐切换（plan_code × benefit_code × quota）</h3>
        <div className="wl-plans">
          {(Object.keys(PLAN_META) as PlanCode[]).map((p) => (
            <button
              key={p}
              type="button"
              className={cx('wl-plan', plan === p && 'active')}
              onClick={() => switchPlan(p)}
            >
              <b>{PLAN_META[p].label}</b>
              <code>{p}</code>
              <i>{PLAN_META[p].desc}</i>
            </button>
          ))}
        </div>

        {/* 当前可用权益（单态：统一权益池） */}
        <h3 className="wl-sec-title">当前可用权益（{benefits.length} 项）</h3>
        <div className="wl-benefits">
          {benefits.map((b) => (
            <div key={b.benefit} className="wl-benefit">
              <div className="wl-benefit-main">
                <b>{b.label}</b>
                <i>
                  <code>{b.benefit}</code> · 额度 {b.quota}
                </i>
              </div>
            </div>
          ))}
        </div>

        {/* 入账说明：本站未接入在线支付，余额只能来自真实到账或真实内容收益，不提供自助加钱入口 */}
        <h3 className="wl-sec-title">余额从哪来（无自助入账）</h3>
        <div className="wl-actions">
          <a className="wl-act recharge" href="#/mall/wallet">
            💳 去商城钱包提交付款凭证
          </a>
        </div>
        <p className="wl-sub" style={{ marginTop: 8 }}>
          充值需在商城钱包提交付款凭证，由管理员凭核销口令确认到账后，才会记入本页余额；
          内容分成（资源下载 / 广告结算）由结算链路写入。本站不提供「点一下余额就增加」的自助入口。
        </p>

        {/* 流水列表 */}
        <h3 className="wl-sec-title">钱包流水（最近 {Math.min(txs.length, 50)} 条）</h3>
        {txs.length === 0 ? (
          <Empty text="还没有流水，充值到账或内容分成结算后会显示在这里" />
        ) : (
          <div className="wl-txs">
            {txs.map((t) => {
              const meta = KIND_META[t.kind]
              const sign = t.kind === 'consume' ? '-' : '+'
              return (
                <div key={t.id} className="wl-tx">
                  <span className="wl-tx-icon">{meta.icon}</span>
                  <div className="wl-tx-main">
                    <b>{t.note}</b>
                    <i>
                      {meta.label} · <TimeAgo ts={t.at} />
                      {t.snapshot && (
                        <em className="wl-snap">
                          快照：{t.snapshot.sku_type} {t.snapshot.rate_pct} ·
                          类型{t.snapshot.content_type} · {t.snapshot.settle_tn}
                        </em>
                      )}
                    </i>
                  </div>
                  <b className={cx('wl-tx-amount', t.kind === 'consume' ? 'out' : 'in')}>
                    {sign}¥{yuan(t.fen)}
                  </b>
                </div>
              )
            })}
          </div>
        )}

        {/* revenue_rule 配置表 */}
        <h3 className="wl-sec-title">revenue_rule 费率表（运营后台可改，代码不硬编码）</h3>
        <div className="wl-table-wrap">
          <table className="wl-table">
            <thead>
              <tr>
                <th>content_type</th>
                <th>sku_type</th>
                <th>费率</th>
                <th>保底</th>
                <th>结算</th>
              </tr>
            </thead>
            <tbody>
              {REVENUE_RULES.map((r) => (
                <tr key={r.sku}>
                  <td>{r.contentType}</td>
                  <td><code>{r.sku}</code></td>
                  <td>{r.rate}</td>
                  <td>{r.floor}</td>
                  <td>{r.settle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="wl-clear" onClick={clearAll}>
          清空钱包数据
        </button>

        {/* 两条禁止红线 */}
        <p className="wl-warn">
          ⚠️ 红线（开发吧.md 4.2）：<b>❌ auto_expert_from_v —— 大V 自动变专家</b>
          （广场 V 认证与知识专家认证并存，互不转化）；<b>❌ free_download_for_vip —— 会员通兑破墙</b>
          （VIP 权益不得跨内容类型兑换）。铁律：费率取下单时刻快照写入 revenue_record.snapshot，
          运营改费率不影响历史订单；每日对账 diff≠0 即冻结该渠道结算。
        </p>
      </div>
    </div>
  )
}
