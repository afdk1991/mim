/* ==========================================================================
 * 价格监控 —— 监控标的 + 价格序列 + 降价预警
 *
 * 数据源优先级：① 云端 price_quotes 快照（后端回源后写入）
 *             ② 浏览器直连 CoinGecko 公开行情（免密钥、已开 CORS）
 *             ③ 都不可用 → 显示错误态 + 空态，绝不编造价格。
 *
 * 金额：priceFen / thresholdFen 一律「分」整数；研判走 domain 的 alertTriggered
 *      （低于预警线 或 跌幅 ≥5%），页面不重复实现判定逻辑。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { PRICE_POINTS_MAX, PRICE_SPARK_POINTS, alertTriggered } from '@/domain/tools/model'
import type { PriceAlert, PricePoint, WatchProduct } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { db } from '@/data/client'
import { cx, timeAgo, uid, yuanText, yuanToFen } from '@/core/utils'
import { Empty, Modal, useToast } from '@/ui'

const SCOPE = 'tools.price'

const DEFAULT_WATCHES: Array<[string, string, string]> = [
  ['bitcoin', '比特币 BTC', '₿'],
  ['ethereum', '以太坊 ETH', 'Ξ'],
  ['solana', 'Solana SOL', '◎'],
  ['binancecoin', 'BNB 币安币', '🔶'],
  ['dogecoin', '狗狗币 DOGE', '🐕'],
]

interface BoardData {
  products: WatchProduct[]
  alerts: PriceAlert[]
}

interface Quote {
  yuan: number
  changePct: number
}

/* ---------- 持久化 ---------- */

function parsePoint(v: unknown): PricePoint | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  if (typeof r.priceFen !== 'number' || !Number.isFinite(r.priceFen)) return null
  return { at: r.at, priceFen: r.priceFen }
}

function parseProduct(v: unknown): WatchProduct | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  if (typeof r.emoji !== 'string' || typeof r.platform !== 'string') return null
  if (typeof r.thresholdFen !== 'number' || !Number.isFinite(r.thresholdFen)) return null
  const prices: PricePoint[] = []
  if (Array.isArray(r.prices)) {
    for (const p of r.prices) {
      const pt = parsePoint(p)
      if (pt) prices.push(pt)
    }
  }
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    platform: r.platform,
    thresholdFen: r.thresholdFen,
    prices: prices.slice(-PRICE_POINTS_MAX),
  }
}

function parseAlert(v: unknown): PriceAlert | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.productId !== 'string') return null
  if (typeof r.fromFen !== 'number' || typeof r.toFen !== 'number') return null
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  return { id: r.id, productId: r.productId, fromFen: r.fromFen, toFen: r.toFen, at: r.at }
}

function parseBoard(raw: unknown): BoardData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.products)) return null
  const products: WatchProduct[] = []
  for (const v of r.products) {
    const p = parseProduct(v)
    if (p) products.push(p)
  }
  const alerts: PriceAlert[] = []
  if (Array.isArray(r.alerts)) {
    for (const v of r.alerts) {
      const a = parseAlert(v)
      if (a) alerts.push(a)
    }
  }
  return { products, alerts }
}

function seedBoard(): BoardData {
  // 只播种「标的元信息」，不预置任何价格 —— 价格必须来自真实行情
  return {
    products: DEFAULT_WATCHES.map(([id, name, emoji]) => ({
      id,
      name,
      emoji,
      platform: 'CoinGecko 实时',
      thresholdFen: 0,
      prices: [],
    })),
    alerts: [],
  }
}

/* ---------- 行情获取 ---------- */

interface CloudRow {
  coin_id?: unknown
  price_cny?: unknown
  change_24h?: unknown
}

/** ① 云端快照：后端 cron 回源 CoinGecko 后写入，前端只读 */
async function fromCloud(): Promise<Record<string, Quote> | null> {
  const r = await db.list<CloudRow>('price_quotes', { order: { col: 'at', asc: false }, limit: 200 })
  if (!r.ok || r.data.length === 0) return null
  const out: Record<string, Quote> = {}
  for (const row of r.data) {
    const id = row.coin_id
    const price = Number(row.price_cny)
    if (typeof id !== 'string' || !Number.isFinite(price) || price <= 0) continue
    if (id in out) continue // 同一 coin 已按时间倒序排过，首条即最新
    const change = Number(row.change_24h)
    out[id] = { yuan: price, changePct: Number.isFinite(change) ? change : 0 }
  }
  return Object.keys(out).length > 0 ? out : null
}

/** ② 浏览器直连 CoinGecko：公开接口已带 CORS，可作为云端不可用时的备份通道 */
async function fromCoinGecko(ids: string[]): Promise<Record<string, Quote> | null> {
  const unique = Array.from(new Set(ids.map((s) => s.trim()).filter(Boolean)))
  if (unique.length === 0) return null
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), 10_000)
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${unique.join(',')}&vs_currencies=cny&include_24hr_change=true`
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = (await res.json()) as Record<string, { cny?: number; cny_24h_change?: number }>
    const out: Record<string, Quote> = {}
    for (const [id, v] of Object.entries(raw)) {
      if (v && typeof v.cny === 'number' && Number.isFinite(v.cny) && v.cny > 0) {
        out[id] = { yuan: v.cny, changePct: typeof v.cny_24h_change === 'number' ? v.cny_24h_change : 0 }
      }
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/* ---------- 迷你走势柱 ---------- */

function Spark({ prices }: { prices: PricePoint[] }) {
  const slice = prices.slice(-PRICE_SPARK_POINTS)
  if (slice.length === 0) return null
  const values = slice.map((p) => p.priceFen)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  return (
    <div className="row" style={{ alignItems: 'flex-end', gap: 3, height: 44 }}>
      {slice.map((p, i) => {
        const prev = i > 0 ? slice[i - 1]!.priceFen : p.priceFen
        return (
          <i
            key={`${p.at}-${i}`}
            title={`¥${yuanText(p.priceFen)} · ${timeAgo(p.at)}`}
            style={{
              width: 10,
              height: `${Math.max(12, Math.round(((p.priceFen - min) / span) * 30 + 12))}px`,
              borderRadius: 3,
              background: p.priceFen < prev ? 'var(--danger)' : 'var(--primary)',
            }}
          />
        )
      })}
    </div>
  )
}

/* ---------- 页面 ---------- */

interface AddDraft {
  id: string
  name: string
  emoji: string
  threshold: string
}

const emptyAdd = (): AddDraft => ({ id: '', name: '', emoji: '', threshold: '' })

export function PriceMonitorPage() {
  const toast = useToast()
  const [board, setBoard] = useState<BoardData>(() => loadSnapshot(SCOPE, parseBoard, seedBoard()))
  const [syncing, setSyncing] = useState(false)
  const [source, setSource] = useState<'未采集' | '云端快照' | 'CoinGecko 直连'>('未采集')
  const [err, setErr] = useState('')
  const [add, setAdd] = useState<AddDraft | null>(null)

  useEffect(() => {
    saveSnapshot(SCOPE, board)
  }, [board])

  const sync = async (): Promise<void> => {
    if (syncing || board.products.length === 0) return
    setSyncing(true)
    setErr('')
    const ids = board.products.map((p) => p.id)
    const cloud = await fromCloud()
    const quotes = cloud ?? (await fromCoinGecko(ids))
    if (!quotes) {
      setErr('行情不可用：云端快照为空且直连 CoinGecko 失败，请检查网络或稍后重试')
      setSyncing(false)
      return
    }
    setSource(cloud ? '云端快照' : 'CoinGecko 直连')
    const now = Date.now()
    const newAlerts: PriceAlert[] = []
    let fetched = 0

    const products = board.products.map((p) => {
      const q = quotes[p.id]
      if (!q) return p
      fetched += 1
      const prev = p.prices.length > 0 ? p.prices[p.prices.length - 1]! : null
      const last: PricePoint = { at: now, priceFen: yuanToFen(q.yuan) }
      // thresholdFen 为 0 时按现价 9 折自动推导预警线（入库前一次性算好）
      const thresholdFen = p.thresholdFen > 0 ? p.thresholdFen : Math.round(last.priceFen * 0.9)
      if (alertTriggered(last, prev, thresholdFen) && prev) {
        newAlerts.push({ id: uid('al'), productId: p.id, fromFen: prev.priceFen, toFen: last.priceFen, at: now })
      }
      return { ...p, thresholdFen, prices: [...p.prices, last].slice(-PRICE_POINTS_MAX) }
    })

    setBoard({ products, alerts: [...newAlerts, ...board.alerts] })
    toast(fetched > 0 ? `已同步 ${fetched} 项实时价格（CNY）` : '监控标的均无行情返回')
    setSyncing(false)
  }

  // 首次进入（或本机尚无价格）时自动采集一次
  const emptyPrices = board.products.some((p) => p.prices.length === 0)
  useEffect(() => {
    if (emptyPrices) void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addWatch = (): void => {
    if (!add) return
    const id = add.id.trim().toLowerCase()
    if (!id) {
      toast('请填写 CoinGecko 资产 id（如 bitcoin）')
      return
    }
    if (board.products.some((p) => p.id === id)) {
      toast('该标的已在监控列表中')
      return
    }
    const th = Number(add.threshold)
    const product: WatchProduct = {
      id,
      name: add.name.trim() || id.toUpperCase(),
      emoji: add.emoji.trim() || '🪙',
      platform: 'CoinGecko 实时',
      thresholdFen: Number.isFinite(th) && th > 0 ? yuanToFen(th) : 0,
      prices: [],
    }
    setBoard({ ...board, products: [...board.products, product] })
    setAdd(null)
    toast('已加入监控，点击「立即采集」获取实时价')
  }

  const removeWatch = (id: string): void => {
    if (!window.confirm('确定移除该监控标的吗？其价格序列与预警将一并删除。')) return
    setBoard({
      products: board.products.filter((p) => p.id !== id),
      alerts: board.alerts.filter((a) => a.productId !== id),
    })
    toast('已移除监控标的')
  }

  const alertCount = board.alerts.length

  return (
    <div className="page">
      <div className="row-between">
        <h1 className="page-title" style={{ margin: 0 }}>📉 价格监控</h1>
        <span className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setAdd(emptyAdd())}>+ 新增监控</button>
          <button className="btn btn-primary btn-sm" disabled={syncing} onClick={() => void sync()}>
            {syncing ? '采集…' : '⟳ 立即采集'}
          </button>
        </span>
      </div>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        人民币计价 · 数据源优先云端 price_quotes 快照，不可用时回落 CoinGecko 公开接口 · 当前来源：{source}
      </p>

      <div className="stat-row" style={{ marginBottom: 12 }}>
        <span><b>{board.products.length}</b> 监控标的</span>
        <span><b>{alertCount}</b> 降价预警</span>
        <span><b>{board.products.filter((p) => p.prices.length > 0).length}</b> 已有行情</span>
      </div>

      {err ? (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
          <b style={{ color: 'var(--danger)' }}>行情获取失败</b>
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: 13 }}>{err}</p>
          <button className="btn btn-primary btn-sm" disabled={syncing} onClick={() => void sync()}>重试</button>
        </div>
      ) : null}

      {board.products.length === 0 ? (
        <Empty emoji="📭" text="监控列表为空，点击「+ 新增监控」添加 CoinGecko 资产（如 bitcoin）" />
      ) : null}

      {board.products.map((p) => {
        const last = p.prices.length > 0 ? p.prices[p.prices.length - 1]! : null
        const prev = p.prices.length > 1 ? p.prices[p.prices.length - 2]! : null
        const dropPct = last && prev && prev.priceFen > 0 ? ((prev.priceFen - last.priceFen) / prev.priceFen) * 100 : 0
        const triggered = alertTriggered(last, prev, p.thresholdFen)
        return (
          <div key={p.id} className="card">
            <div className="row">
              <span style={{ fontSize: 28 }}>{p.emoji}</span>
              <div className="grow">
                <b>{p.name}</b>
                <div className="muted" style={{ fontSize: 12 }}>{p.platform} · 标的 {p.id}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => removeWatch(p.id)}>移除</button>
            </div>

            <div className="row wrap" style={{ marginTop: 8, gap: 16 }}>
              <span>
                <b style={{ fontSize: 18 }}>{last ? `¥${yuanText(last.priceFen)}` : '¥--'}</b>
                {prev && last ? (
                  <small className={cx(dropPct > 0 ? 'price-drop' : 'price-up')}>
                    {' '}{last.priceFen >= prev.priceFen ? '↑' : '↓'} ¥{yuanText(Math.abs(last.priceFen - prev.priceFen))}
                  </small>
                ) : null}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                预警线 {p.thresholdFen > 0 ? `¥${yuanText(p.thresholdFen)}` : '待采集后按现价 9 折推导'}
              </span>
              {triggered ? <span className="tag">已触发预警</span> : null}
            </div>

            {p.prices.length > 0 ? (
              <Spark prices={p.prices} />
            ) : (
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>尚无真实价格数据，点击「立即采集」获取</p>
            )}
            <small className="muted" style={{ fontSize: 12 }}>
              {last ? `更新于 ${timeAgo(last.at)} · 序列 ${p.prices.length}/${PRICE_POINTS_MAX} 点` : '未采集'}
            </small>
          </div>
        )
      })}

      {alertCount > 0 ? (
        <>
          <div className="section-title">🔔 预警记录</div>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>规则：低于预警线 或 跌幅 ≥5%</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setBoard({ ...board, alerts: [] })}>清空预警</button>
          </div>
          {board.alerts.slice(0, 20).map((a) => {
            const p = board.products.find((x) => x.id === a.productId)
            return (
              <div key={a.id} className="notif-row">
                <span className="notif-icon">📉</span>
                <div className="notif-body">
                  <p style={{ margin: 0 }}>
                    {p?.name ?? a.productId}：¥{yuanText(a.fromFen)} → ¥{yuanText(a.toFen)}
                  </p>
                  <small className="muted">{timeAgo(a.at)}</small>
                </div>
              </div>
            )
          })}
        </>
      ) : null}

      {add ? (
        <Modal title="新增监控标的" onClose={() => setAdd(null)}>
          <div className="col">
            <input className="input" placeholder="CoinGecko 资产 id（如 bitcoin）" value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })} />
            <input className="input" placeholder="显示名称（可选）" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            <input className="input" placeholder="图标 emoji（可选）" value={add.emoji} onChange={(e) => setAdd({ ...add, emoji: e.target.value })} />
            <input className="input" inputMode="decimal" placeholder="预警线（元，可选）" value={add.threshold} onChange={(e) => setAdd({ ...add, threshold: e.target.value })} />
            <button className="btn btn-primary" onClick={addWatch}>加入监控</button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
