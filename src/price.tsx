import { useEffect, useState } from 'react'
import { Modal, useToast } from './components'
import { cx, timeAgo, uid } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'
import { priceLatest, priceRefresh } from './lib/bizApi'

/* ============================================================
 * 价格监控 —— 行情数据来自 CoinGecko 公开 API（真实数据源，无需密钥）
 * 监控标的：加密资产人民币计价实时价；打开页面自动同步一次，
 * 「立即采集」重新拉取；降价预警基于真实价格与预警线判定，localStorage 持久化。
 * ============================================================ */

interface PricePoint {
  at: number
  price: number
}

interface WatchProduct {
  id: string
  name: string
  emoji: string
  platform: string
  threshold: number
  /** 最近一次同步的 24h 涨跌幅（%），来自 CoinGecko；未同步过为 0 */
  dayChange: number
  prices: PricePoint[]
}

interface CrawlTask {
  productId: string
  freq: string
  enabled: boolean
  lastRunAt: number
}

interface PriceAlert {
  id: string
  productId: string
  from: number
  to: number
  at: number
}

interface PriceBoard {
  products: WatchProduct[]
  tasks: CrawlTask[]
  alerts: PriceAlert[]
}

const STORAGE_KEY = 'mim-price-v2'

/* CoinGecko 实时行情已后端化（P1-1）：优先由服务端 priceRefresh() 回源 CoinGecko 写入
   price_quotes 表，前端只读 priceLatest() 快照（消除限流 / 行情被篡改的面）。
   但若服务端所在区域无法出网到 CoinGecko（如 ap-shanghai 对境外金融源出网被阻断），
   云端快照为空 —— 此时回退浏览器直连 CoinGecko（其 API 已开 CORS，用户浏览器可正常
   访问）以保住功能。两种路径任一成功即渲染。 */
const DEFAULT_CG_IDS = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'dogecoin']

interface CgQuote {
  price: number
  change: number
}

/* 浏览器直连 CoinGecko 的回退通道（仅当云端快照不可用、且浏览器可直连时使用） */
async function fetchCnyQuotesDirect(ids: string[]): Promise<Record<string, { price: number; change: number; at: number }>> {
  const unique = Array.from(new Set(ids.map((s) => s.trim()).filter(Boolean)))
  if (!unique.length) throw new Error('no watch ids')
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), 10000)
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${unique.join(',')}&vs_currencies=cny&include_24hr_change=true`,
      { signal: ctl.signal },
    )
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const raw = (await res.json()) as Record<string, { cny?: number; cny_24h_change?: number }>
    const out: Record<string, { price: number; change: number; at: number }> = {}
    for (const [id, v] of Object.entries(raw)) {
      if (v && typeof v.cny === 'number' && Number.isFinite(v.cny) && v.cny > 0) {
        out[id] = { price: v.cny, change: typeof v.cny_24h_change === 'number' ? v.cny_24h_change : 0, at: 0 }
      }
    }
    if (!Object.keys(out).length) throw new Error('empty quotes')
    return out
  } finally {
    window.clearTimeout(timer)
  }
}

/* 默认监控清单：仅定义标的元信息（名称/图标），价格全部来自真实 API 同步，
   不预置任何价格/预警数据。 */
const DEFAULT_WATCHES: Array<[string, string, string]> = [
  ['bitcoin', '比特币 BTC', '₿'],
  ['ethereum', '以太坊 ETH', 'Ξ'],
  ['solana', 'Solana SOL', '◎'],
  ['binancecoin', 'BNB 币安币', '🔶'],
  ['dogecoin', '狗狗币 DOGE', '🐕'],
]

function seedData(): PriceBoard {
  const mk = (id: string, name: string, emoji: string): WatchProduct => ({
    id, name, emoji, platform: 'CoinGecko 实时', threshold: 0, dayChange: 0, prices: [],
  })
  return {
    products: DEFAULT_WATCHES.map(([id, name, emoji]) => mk(id, name, emoji)),
    tasks: DEFAULT_CG_IDS.map((productId) => ({
      productId, freq: '打开页面 / 手动同步', enabled: true, lastRunAt: 0,
    })),
    alerts: [],
  }
}

function loadBoard(): PriceBoard {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PriceBoard
      if (parsed && Array.isArray(parsed.products) && Array.isArray(parsed.tasks) && Array.isArray(parsed.alerts)) {
        // 元素级校验：剔除脏数据，避免损坏存档导致看板/曲线渲染异常
        const products = parsed.products.filter(
          (p): p is WatchProduct =>
            !!p && typeof p === 'object' &&
            typeof p.id === 'string' && typeof p.name === 'string' &&
            typeof p.emoji === 'string' && typeof p.platform === 'string' &&
            typeof p.threshold === 'number' && Number.isFinite(p.threshold) &&
            (typeof (p as WatchProduct).dayChange === 'undefined' ||
              (typeof p.dayChange === 'number' && Number.isFinite(p.dayChange))) &&
            Array.isArray(p.prices) && p.prices.every(
              (pt): pt is PricePoint => !!pt && typeof pt === 'object' &&
                typeof pt.at === 'number' && Number.isFinite(pt.at) &&
                typeof pt.price === 'number' && Number.isFinite(pt.price),
            ),
        )
        const tasks = parsed.tasks.filter(
          (t): t is CrawlTask =>
            !!t && typeof t === 'object' &&
            typeof t.productId === 'string' && typeof t.freq === 'string' &&
            typeof t.enabled === 'boolean' &&
            typeof t.lastRunAt === 'number' && Number.isFinite(t.lastRunAt),
        )
        const alerts = parsed.alerts.filter(
          (a): a is PriceAlert =>
            !!a && typeof a === 'object' &&
            typeof a.id === 'string' && typeof a.productId === 'string' &&
            typeof a.from === 'number' && Number.isFinite(a.from) &&
            typeof a.to === 'number' && Number.isFinite(a.to) &&
            typeof a.at === 'number' && Number.isFinite(a.at),
        )
        return { products: products.map((p) => ({ ...p, dayChange: p.dayChange ?? 0 })), tasks, alerts }
      }
    }
  } catch {
    /* 忽略损坏的本地数据，重新播种 */
  }
  return seedData()
}

function fmtPrice(n: number): string {
  return '¥' + (Number.isInteger(n) ? String(n) : n.toFixed(1))
}

function Spark({ prices }: { prices: PricePoint[] }) {
  const slice = prices.slice(-10)
  const values = slice.map((p) => p.price)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  return (
    <div className="spark">
      {slice.map((p, i) => {
        const prev = i > 0 ? slice[i - 1].price : p.price
        const dropped = p.price < prev
        return (
          <i
            key={p.at + '-' + i}
            className={cx(dropped && 'down', i === slice.length - 1 && 'last')}
            style={{ height: Math.max(10, Math.round(((p.price - min) / span) * 86 + 14)) + '%' }}
            title={`${fmtPrice(p.price)} · ${timeAgo(p.at)}`}
          />
        )
      })}
    </div>
  )
}

export function PriceMonitorPage() {
  const [board, setBoard] = useState<PriceBoard>(loadBoard)
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState('')
  const [addDraft, setAddDraft] = useState<null | { id: string; name: string; emoji: string; threshold: string }>(null)
  const toast = useToast()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board))
    } catch {
      /* ignore */
    }
    pushToolState(STORAGE_KEY, board) // 云端整包快照（未登录/未配置时静默跳过）
  }, [board])

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 重载（幂等触发上方保存钩子回推） */
  useEffect(() => {
    void pullToolState(STORAGE_KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
      setBoard(loadBoard())
    })
  }, [])

  const { products, tasks, alerts } = board

  /* 行情已后端化（P1-1）：读云端快照 priceLatest()；首次/未采集时快照为空，
     触发服务端 priceRefresh() 回源 CoinGecko，再回读快照。浏览器不再直连上游。 */
  async function syncAll() {
    if (syncing) return
    const enabledIds = board.products
      .filter((p) => board.tasks.find((t) => t.productId === p.id)?.enabled !== false)
      .map((p) => p.id)
    if (!enabledIds.length) {
      toast('没有启用中的采集任务，请先在下方启用')
      return
    }
    setSyncing(true)
    setLastError('')
    try {
      let quotes: Record<string, { price: number; change: number; at: number }> = await priceLatest(enabledIds)
      const haveAll = enabledIds.every((id) => quotes[id])
      // 快照不全（首次/未采集）→ 触发服务端回源一次，再读快照（回源失败不致命，走回退）
      if (!haveAll) {
        await priceRefresh().catch(() => {})
        quotes = await priceLatest(enabledIds).catch(() => quotes)
      }
      // 云端仍无数据（如服务端区域无法出网到 CoinGecko）→ 回退浏览器直连，保住功能
      if (!enabledIds.some((id) => quotes[id])) {
        quotes = await fetchCnyQuotesDirect(enabledIds)
      }
      const now = Date.now()
      let fetched = 0
      setBoard((b) => {
        const newAlerts: PriceAlert[] = []
        const products = b.products.map((p) => {
          const q = quotes[p.id]
          if (!q) return p
          fetched++
          const last = p.prices.length ? p.prices[p.prices.length - 1].price : null
          const threshold = p.threshold > 0 ? p.threshold : Math.round(q.price * 0.9)
          const dropped = last !== null && q.price < last
          const pct = last ? (q.price - last) / last : 0
          if (last !== null && dropped && (q.price <= threshold || -pct >= 0.05)) {
            newAlerts.push({ id: uid('al'), productId: p.id, from: last, to: q.price, at: now })
          }
          const at = typeof q.at === 'number' && q.at > 0 ? q.at : now
          return { ...p, threshold, dayChange: q.change, prices: [...p.prices, { at, price: q.price }].slice(-30) }
        })
        return {
          products,
          tasks: b.tasks.map((t) => (quotes[t.productId] ? { ...t, lastRunAt: now } : t)),
          alerts: [...newAlerts, ...b.alerts],
        }
      })
      toast(fetched ? `📊 已同步 ${fetched} 项实时价格（CNY）` : '未获取到行情数据')
      if (!fetched) setLastError('行情快照为空，请稍后重试（服务端回源可能受限流）')
    } catch (e) {
      console.warn('[price] 行情同步失败', e)
      setLastError('行情获取失败：' + (e instanceof Error ? e.message : '网络异常'))
      toast('⚠️ 行情获取失败，请稍后重试')
    } finally {
      setSyncing(false)
    }
  }

  /* 新增监控标的：CoinGecko 资产 id 必填且唯一；名称缺省时用 id 顶格显示 */
  function addWatch() {
    const id = addDraft!.id.trim().toLowerCase()
    if (!id) {
      toast('请填写 CoinGecko 资产 id（如 bitcoin）')
      return
    }
    if (products.some((p) => p.id === id)) {
      toast('该标的已在监控列表中')
      return
    }
    const th = Number(addDraft!.threshold)
    const product: WatchProduct = {
      id,
      name: addDraft!.name.trim() || id.toUpperCase(),
      emoji: addDraft!.emoji.trim() || '🪙',
      platform: 'CoinGecko 实时',
      threshold: Number.isFinite(th) && th > 0 ? Math.round(th * 10) / 10 : 0,
      dayChange: 0,
      prices: [],
    }
    setBoard((b) => ({
      ...b,
      products: [...b.products, product],
      tasks: [...b.tasks, { productId: id, freq: '打开页面 / 手动同步', enabled: true, lastRunAt: 0 }],
    }))
    setAddDraft(null)
    toast('已加入监控，点击「立即采集」获取实时价')
  }

  /* 移除监控标的：连带清理其采集任务与相关预警 */
  function removeWatch(pid: string) {
    if (!window.confirm('确定移除该监控标的吗？其价格曲线与预警将一并删除。')) return
    setBoard((b) => ({
      products: b.products.filter((p) => p.id !== pid),
      tasks: b.tasks.filter((t) => t.productId !== pid),
      alerts: b.alerts.filter((a) => a.productId !== pid),
    }))
    toast('已移除监控标的')
  }

  /* 首次进入（或迁移到 v2 存档）时自动同步一次实时行情 */
  const needsFetch = products.some((p) => p.prices.length === 0)
  useEffect(() => {
    if (needsFetch) void syncAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleTask(pid: string) {
    setBoard((b) => ({
      ...b,
      tasks: b.tasks.map((t) => (t.productId === pid ? { ...t, enabled: !t.enabled } : t)),
    }))
  }

  function clearAlerts() {
    setBoard((b) => ({ ...b, alerts: [] }))
    toast('预警已清空')
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📉 价格监控</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
          行情来自 CoinGecko 公开 API · 加密资产人民币实时价 · 首次打开自动同步
        </p>

        <div className="stat-row">
          <div className="stat-box"><b>{products.length}</b><span>监控商品</span></div>
          <div className="stat-box"><b>{tasks.filter((t) => t.enabled).length}</b><span>运行中任务</span></div>
          <div className="stat-box"><b>{alerts.length}</b><span>降价预警</span></div>
          <div className="stat-box"><b>{new Set(products.map((p) => p.platform)).size}</b><span>覆盖平台</span></div>
        </div>

        <div className="board-toolbar" style={{ marginBottom: 12 }}>
          <b>监控看板</b>
          <div className="toolbar-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setAddDraft({ id: '', name: '', emoji: '', threshold: '' })}
            >
              + 新增监控
            </button>
          </div>
        </div>

        {lastError && (
          <div className="card" style={{ marginBottom: 12, borderColor: 'var(--danger, #e5484d)' }}>
            <div className="task-row" style={{ borderBottom: 'none' }}>
              <span className="notif-icon">⚠️</span>
              <div className="res-main">
                <b>同步失败</b>
                <p>{lastError}</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => syncAll()} disabled={syncing}>
                {syncing ? '同步中…' : '重试'}
              </button>
            </div>
          </div>
        )}

        {products.length === 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="muted" style={{ margin: '8px 0' }}>
              监控列表为空，点击「+ 新增监控」添加任意 CoinGecko 资产（如 bitcoin、ethereum）。
            </p>
          </div>
        )}

        <div className="price-grid">
          {products.map((p) => {
            const last = p.prices.length ? p.prices[p.prices.length - 1] : null
            const prev = p.prices.length > 1 ? p.prices[p.prices.length - 2] : null
            const delta = last && prev ? last.price - prev.price : 0
            const pct = last && prev && prev.price > 0 ? ((last.price - prev.price) / prev.price) * 100 : 0
            const task = tasks.find((t) => t.productId === p.id)
            return (
              <div key={p.id} className="card">
                <div className="price-card-head">
                  <span className="price-emoji">{p.emoji}</span>
                  <div className="price-card-name">
                    <b>{p.name}</b>
                    <small>
                      {p.platform} · 预警线 {p.threshold > 0 ? fmtPrice(p.threshold) : '待采集'}
                      {p.dayChange !== 0 && (
                        <span className={p.dayChange < 0 ? 'price-drop' : 'price-up'}>
                          {' · 24h '}{p.dayChange > 0 ? '+' : ''}{p.dayChange.toFixed(1)}%
                        </span>
                      )}
                    </small>
                  </div>
                  {task && (
                    <span className={cx('tag', !task.enabled && 'tag-off')}>
                      {task.enabled ? '监控中' : '已停用'}
                    </span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    title="移除该监控标的"
                    onClick={() => removeWatch(p.id)}
                  >
                    ✕
                  </button>
                </div>
                <div className="price-now-row">
                  {last ? (
                    <b className="price-now">{fmtPrice(last.price)}</b>
                  ) : (
                    <b className="price-now muted">—</b>
                  )}
                  {last && prev && (
                    <span className={delta < 0 ? 'price-drop' : delta > 0 ? 'price-up' : 'muted'}>
                      {delta < 0 ? '↓' : delta > 0 ? '↑' : '—'} {Math.abs(delta).toFixed(0)}
                      （{pct > 0 ? '+' : ''}{pct.toFixed(1)}%）
                    </span>
                  )}
                </div>
                {!last && <p className="muted" style={{ margin: '8px 0' }}>暂无数据，点击「立即采集」获取实时价</p>}
                <Spark prices={p.prices} />
                <div className="price-foot">
                  <small>上次同步 {last ? timeAgo(last.at) : '—'}</small>
                  <button className="btn btn-primary btn-sm" onClick={() => syncAll()} disabled={syncing}>
                    {syncing ? '同步中…' : '立即采集'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="card">
          <div className="board-toolbar"><b>采集任务</b></div>
          {tasks.map((t) => {
            const p = products.find((x) => x.id === t.productId)
            if (!p) return null
            return (
              <div key={t.productId} className="task-row">
                <span className="price-emoji">{p.emoji}</span>
                <div className="res-main">
                  <b>{p.name} · {p.platform}</b>
                  <p>频率 {t.freq} · 上次运行 {t.lastRunAt ? timeAgo(t.lastRunAt) : '—'}</p>
                </div>
                <button
                  className={cx('btn btn-sm', t.enabled ? 'btn-ghost' : 'btn-primary')}
                  onClick={() => toggleTask(t.productId)}
                >
                  {t.enabled ? '停用' : '启用'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="card">
          <div className="board-toolbar">
            <b>降价预警（{alerts.length}）</b>
            {alerts.length > 0 && (
              <div className="toolbar-actions">
                <button className="btn btn-ghost btn-sm" onClick={clearAlerts}>清空</button>
              </div>
            )}
          </div>
          {alerts.length === 0 && <p className="muted" style={{ margin: '12px 0' }}>暂无预警，继续蹲个好价 🐦</p>}
          {alerts.map((a) => {
            const p = products.find((x) => x.id === a.productId)
            const pct = a.from > 0 ? ((a.to - a.from) / a.from) * 100 : 0
            return (
              <div key={a.id} className="task-row">
                <span className="price-emoji">{p?.emoji ?? '🏷️'}</span>
                <div className="res-main">
                  <b>{p?.name ?? '已下架商品'} 降价提醒</b>
                  <p>
                    {fmtPrice(a.from)} → <span className="price-drop">{fmtPrice(a.to)}</span>（{pct.toFixed(1)}%）
                  </p>
                </div>
                <small className="muted">{timeAgo(a.at)}</small>
              </div>
            )
          })}
        </div>
      </div>

      {addDraft && (
        <Modal title="新增监控标的" onClose={() => setAddDraft(null)}>
          <input
            className="input"
            placeholder="CoinGecko 资产 id（必填，如 bitcoin）"
            value={addDraft.id}
            onChange={(e) => setAddDraft({ ...addDraft, id: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input"
            placeholder="显示名称（可选，默认可用 id）"
            value={addDraft.name}
            onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input"
            placeholder="图标 emoji（可选，默认 🪙）"
            value={addDraft.emoji}
            onChange={(e) => setAddDraft({ ...addDraft, emoji: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input"
            type="number"
            placeholder="降价预警线（元，可选）"
            value={addDraft.threshold}
            onChange={(e) => setAddDraft({ ...addDraft, threshold: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={addWatch}>加入监控</button>
        </Modal>
      )}
    </div>
  )
}
