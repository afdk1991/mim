import './wallet.css'
import { useState } from 'react'
import { Empty, TimeAgo, useToast } from './components'
import { cx } from './utils'

/** 统一钱包 + 权益矩阵（开发吧.md 4.2 entitlement_matrix / 4.3 revenue_rule）
 *  金额一律存「分」整数（结算铁律）；收益入账携带 revenue_rule 下单时刻快照，
 *  且永久保留 domain + content_type（广场靠广告 / 知识靠订阅，分部核算必需）；
 *  权益按域打标，两条禁止红线防「会员通兑破墙」。 */

type Domain = 1 | 2
type PlanCode = 'BASIC' | 'SUPER' | 'DOWNLOAD_PACK' | 'ENTERPRISE'

/** 权益项：domain=null 表示跨域通用（唯一真正通用的权益只有 no_ads） */
interface Entitlement {
  benefit: string
  domain: Domain | null
  quota: string
  label: string
}

/** entitlement_matrix 全量（对齐开发吧.md 4.2，❌ 两条为禁止项不进权益池） */
const ENTITLEMENTS: Record<PlanCode, Entitlement[]> = {
  BASIC: [
    { benefit: 'no_ads', domain: null, quota: '∞', label: '免广告' },
    { benefit: 'decoration_theme', domain: 1, quota: '∞', label: '装扮主题' },
    { benefit: 'post_top', domain: 1, quota: '5/月', label: '动态置顶' },
    { benefit: 'edit_published', domain: 1, quota: '∞', label: '编辑已发内容' },
  ],
  SUPER: [
    { benefit: 'column_library', domain: 2, quota: '∞', label: '订阅专栏库' },
    { benefit: 'course_discount', domain: 2, quota: '∞', label: '购课 8 折' },
    { benefit: 'geo_report', domain: 2, quota: '3/月', label: 'GEO 检测' },
    { benefit: 'video_hd', domain: 2, quota: '∞', label: '高清视频' },
  ],
  DOWNLOAD_PACK: [
    { benefit: 'download_quota', domain: 2, quota: '30/月', label: '下载配额（可单独售卖，不绑会员）' },
  ],
  ENTERPRISE: [
    { benefit: 'brand_zone', domain: 1, quota: '∞', label: '品牌号 + 舆情' },
    { benefit: 'tech_promo', domain: 2, quota: '∞', label: '技术推广 + 简历库' },
  ],
}

const PLAN_META: Record<PlanCode, { label: string; desc: string }> = {
  BASIC: { label: '基础版', desc: '免广告 + 广场基础权益' },
  SUPER: { label: '超级会员', desc: '知识态订阅/课程/检测全家桶' },
  DOWNLOAD_PACK: { label: '下载包', desc: '独立售卖，不绑会员' },
  ENTERPRISE: { label: '企业版', desc: '跨域品牌 + 技术推广' },
}

/** revenue_rule 全量（费率可配置化，代码不硬编码；floor_price 单位分） */
const REVENUE_RULES: {
  contentType: string
  domain: Domain
  sku: string
  rate: string
  floor: string
  settle: string
}[] = [
  { contentType: '20 博文', domain: 2, sku: 'ad_cpc', rate: '60%', floor: '30分', settle: 'T+1' },
  { contentType: '21 专栏', domain: 2, sku: 'column_buy', rate: '70%', floor: '0', settle: 'T+3' },
  { contentType: '22 资源', domain: 2, sku: 'resource_buy', rate: '80%', floor: '0', settle: 'T+3' },
  { contentType: '20 博文(VIP)', domain: 2, sku: 'vip_read', rate: '20%', floor: '0', settle: 'T+1' },
  { contentType: '25 回答', domain: 2, sku: 'bounty', rate: '100%', floor: '0', settle: 'T+0' },
  { contentType: '23 课程', domain: 2, sku: 'course_buy', rate: '60%', floor: '0', settle: 'T+7' },
  { contentType: '10 动态', domain: 1, sku: 'ad_cpm_share', rate: '50%', floor: '0', settle: 'T+1' },
  { contentType: '12 视频', domain: 1, sku: 'video_play', rate: '55%', floor: '0', settle: 'T+1' },
  { contentType: '13 直播', domain: 1, sku: 'gift', rate: '45%', floor: '0', settle: 'T+7' },
]

/** 钱包流水：income 携带 revenue_rule 快照（下单时刻冻结，改费率不影响历史） */
interface Tx {
  id: number
  kind: 'recharge' | 'consume' | 'income'
  fen: number // 一律为正数金额（分），方向由 kind 决定
  note: string
  at: number
  snapshot?: {
    domain: Domain
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

const WL_KEY = 'mim-wallet-v1'

function loadWallet(): WalletState {
  try {
    const raw = localStorage.getItem(WL_KEY)
    if (!raw) throw new Error('empty')
    const p = JSON.parse(raw) as Partial<WalletState>
    if (
      typeof p.balanceFen === 'number' && p.balanceFen >= 0 &&
      (p.plan && p.plan in ENTITLEMENTS) &&
      Array.isArray(p.txs)
    ) {
      return { balanceFen: p.balanceFen, plan: p.plan as PlanCode, txs: p.txs }
    }
    throw new Error('bad')
  } catch {
    return { balanceFen: 0, plan: 'BASIC', txs: [] }
  }
}

/** 分 → 元展示（仅展示层转换，存储永远是分） */
const yuan = (fen: number) => (fen / 100).toFixed(2)

const KIND_META: Record<Tx['kind'], { icon: string; label: string }> = {
  recharge: { icon: '🪙', label: '充值' },
  consume: { icon: '💳', label: '消费' },
  income: { icon: '📈', label: '收益' },
}

export function WalletPage() {
  const toast = useToast()
  const [state, setState] = useState<WalletState>(loadWallet)
  const { balanceFen, plan, txs } = state

  const save = (next: WalletState) => {
    setState(next)
    try {
      localStorage.setItem(WL_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  /* 追加一条流水（金额校验 > 0） */
  const push = (tx: Tx) => {
    const delta = tx.kind === 'consume' ? -tx.fen : tx.fen
    const nextFen = balanceFen + delta
    if (nextFen < 0) {
      toast('余额不足（demo 不透支）')
      return
    }
    save({ ...state, balanceFen: nextFen, txs: [tx, ...state.txs].slice(0, 50) })
  }

  const recharge = (fen: number) =>
    push({ id: Date.now(), kind: 'recharge', fen, note: `充值 ¥${yuan(fen)}（模拟渠道到账）`, at: Date.now() })

  const consume = (fen: number, note: string) =>
    push({ id: Date.now(), kind: 'consume', fen, note, at: Date.now() })

  /* 收益：费率快照取「下单时刻」——demo 直接把规则表当前值冻结进流水 */
  const income = (
    fen: number,
    note: string,
    snap: NonNullable<Tx['snapshot']>,
  ) => push({ id: Date.now(), kind: 'income', fen, note, at: Date.now(), snapshot: snap })

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
            entitlement_matrix 按域打标（开发吧.md 4.2）——广场权益（域1）/ 知识权益（域2）/ 通用（NULL），
            <code>domain</code> 防止「买了 VIP 却能在广场看直播」的逻辑漏洞
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
        <h3 className="wl-sec-title">套餐切换（plan_code × benefit_code × domain × quota）</h3>
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

        {/* 当前可用权益：按域打标 */}
        <h3 className="wl-sec-title">当前可用权益（{benefits.length} 项）</h3>
        <div className="wl-benefits">
          {benefits.map((b) => (
            <div key={b.benefit} className="wl-benefit">
              <span className="wl-domain-tag" data-d={b.domain === null ? '0' : String(b.domain)}>
                {b.domain === null ? '通用' : b.domain === 1 ? '广场' : '知识'}
              </span>
              <div className="wl-benefit-main">
                <b>{b.label}</b>
                <i>
                  <code>{b.benefit}</code> · 额度 {b.quota}
                </i>
              </div>
            </div>
          ))}
        </div>

        {/* 模拟操作 */}
        <h3 className="wl-sec-title">模拟操作（income 携带费率快照入账）</h3>
        <div className="wl-actions">
          <button type="button" className="wl-act recharge" onClick={() => recharge(3000)}>
            🪙 充值 ¥30.00
          </button>
          <button type="button" className="wl-act recharge" onClick={() => recharge(10000)}>
            🪙 充值 ¥100.00
          </button>
          <button
            type="button"
            className="wl-act income"
            onClick={() =>
              income(1800, '博文广告 CPC 结算（20 博文 · 知识态）', {
                domain: 2, content_type: 20, sku_type: 'ad_cpc', rate_pct: '60%', settle_tn: 'T+1',
              })
            }
          >
            📈 博文广告结算 +¥18.00
          </button>
          <button
            type="button"
            className="wl-act income"
            onClick={() =>
              income(2400, '资源购买分成（22 资源 · 知识态）', {
                domain: 2, content_type: 22, sku_type: 'resource_buy', rate_pct: '80%', settle_tn: 'T+3',
              })
            }
          >
            📈 资源分成 +¥24.00
          </button>
          <button
            type="button"
            className="wl-act income"
            onClick={() =>
              income(600, '动态广告 CPM 分成（10 动态 · 广场态）', {
                domain: 1, content_type: 10, sku_type: 'ad_cpm_share', rate_pct: '50%', settle_tn: 'T+1',
              })
            }
          >
            📈 动态分成 +¥6.00
          </button>
          <button type="button" className="wl-act consume" onClick={() => consume(1500, 'VIP 会员月费（消费）')}>
            💳 VIP 月费 -¥15.00
          </button>
        </div>

        {/* 流水列表 */}
        <h3 className="wl-sec-title">钱包流水（最近 {Math.min(txs.length, 50)} 条）</h3>
        {txs.length === 0 ? (
          <Empty text="还没有流水，点上面的模拟操作试试" />
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
                          快照：{t.snapshot.sku_type} {t.snapshot.rate_pct} · 域{t.snapshot.domain} ·
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
                <th>domain</th>
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
                  <td>{r.domain === 1 ? '广场' : '知识'}</td>
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
          ⚠️ 两条禁止红线（开发吧.md 4.2）：<b>❌ auto_expert_from_v —— 大V 自动变专家</b>
          （广场 V 认证与知识专家认证并存，互不转化）；<b>❌ free_download_for_vip_in_plaza —— 会员通兑破墙</b>
          （VIP 权益不得穿越 domain 边界兑换广场权益）。铁律：费率取下单时刻快照写入 revenue_record.snapshot，
          运营改费率不影响历史订单；每日对账 diff≠0 即冻结该渠道结算。
        </p>
      </div>
    </div>
  )
}
