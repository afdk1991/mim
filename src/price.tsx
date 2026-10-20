import { useEffect, useState } from 'react'
import { useToast } from './components'
import { cx, timeAgo, uid } from './utils'

/* ============================================================
 * 价格监控 —— 重新开发自合并源码 services/price-crawler（价格采集服务）
 * 纯前端 mock：商品价格曲线 / 采集任务 / 降价预警，localStorage 持久化
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

const STORAGE_KEY = 'mim-price-v1'

function seedData(): PriceBoard {
  const day = (n: number) => Date.now() - n * 86_400_000
  const hr = (n: number) => Date.now() - n * 3_600_000
  const min = (n: number) => Date.now() - n * 60_000
  const hist = (start: number, step: number, n: number): PricePoint[] => {
    const arr: PricePoint[] = []
    for (let i = n - 1; i >= 0; i--) arr.push({ at: day(i), price: start - (n - 1 - i) * step })
    return arr
  }
  return {
    products: [
      { id: 'p1', name: 'AirPods Pro 2', emoji: '🎧', platform: '京东', threshold: 1800, prices: hist(2099, 30, 8) },
      { id: 'p2', name: '小米手环 9', emoji: '📿', platform: '拼多多', threshold: 200, prices: hist(249, 4, 8) },
      { id: 'p3', name: '乌龙茶礼盒', emoji: '🍵', platform: '天猫', threshold: 80, prices: hist(99, 2, 8) },
      { id: 'p4', name: 'K87 机械键盘', emoji: '⌨️', platform: '淘宝', threshold: 280, prices: hist(349, 7, 8) },
      { id: 'p5', name: '健身环大冒险', emoji: '🎮', platform: '京东', threshold: 350, prices: hist(459, 10, 8) },
    ],
    tasks: [
      { productId: 'p1', freq: '每 30 分钟', enabled: true, lastRunAt: min(12) },
      { productId: 'p2', freq: '每小时', enabled: true, lastRunAt: min(47) },
      { productId: 'p4', freq: '每天 08:00', enabled: false, lastRunAt: day(1) },
      { productId: 'p5', freq: '每 30 分钟', enabled: true, lastRunAt: min(18) },
    ],
    alerts: [{ id: 'al0', productId: 'p5', from: 399, to: 389, at: hr(2) }],
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
        return { products, tasks, alerts }
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
  const toast = useToast()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board))
    } catch {
      /* ignore */
    }
  }, [board])

  const { products, tasks, alerts } = board

  function crawl(pid: string) {
    const product = board.products.find((p) => p.id === pid)
    if (!product) return
    const last = product.prices[product.prices.length - 1].price
    let next: number
    if (Math.random() < 0.12) {
      next = Math.round(last * (0.85 + Math.random() * 0.07)) // 偶发大降价
    } else {
      next = Math.round(last * (1 + (Math.random() * 0.08 - 0.045)))
    }
    next = Math.max(1, next)
    const now = Date.now()
    setBoard((b) => ({
      products: b.products.map((p) =>
        p.id === pid ? { ...p, prices: [...p.prices, { at: now, price: next }].slice(-30) } : p,
      ),
      tasks: b.tasks.map((t) => (t.productId === pid ? { ...t, lastRunAt: now } : t)),
      alerts:
        next < last && (next <= product.threshold || (last - next) / last >= 0.05)
          ? [{ id: uid('al'), productId: pid, from: last, to: next, at: now }, ...b.alerts]
          : b.alerts,
    }))
    toast(next < last ? `📉 采集完成：¥${last} → ¥${next}` : `📊 采集完成：¥${next}`)
  }

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

        <div className="stat-row">
          <div className="stat-box"><b>{products.length}</b><span>监控商品</span></div>
          <div className="stat-box"><b>{tasks.filter((t) => t.enabled).length}</b><span>运行中任务</span></div>
          <div className="stat-box"><b>{alerts.length}</b><span>降价预警</span></div>
          <div className="stat-box"><b>{new Set(products.map((p) => p.platform)).size}</b><span>覆盖平台</span></div>
        </div>

        <div className="price-grid">
          {products.map((p) => {
            const last = p.prices[p.prices.length - 1]
            const prev = p.prices.length > 1 ? p.prices[p.prices.length - 2] : null
            const delta = prev ? last.price - prev.price : 0
            const pct = prev && prev.price > 0 ? ((last.price - prev.price) / prev.price) * 100 : 0
            const task = tasks.find((t) => t.productId === p.id)
            return (
              <div key={p.id} className="card">
                <div className="price-card-head">
                  <span className="price-emoji">{p.emoji}</span>
                  <div className="price-card-name">
                    <b>{p.name}</b>
                    <small>{p.platform} · 预警线 {fmtPrice(p.threshold)}</small>
                  </div>
                  {task && (
                    <span className={cx('tag', !task.enabled && 'tag-off')}>
                      {task.enabled ? '监控中' : '已停用'}
                    </span>
                  )}
                </div>
                <div className="price-now-row">
                  <b className="price-now">{fmtPrice(last.price)}</b>
                  {prev && (
                    <span className={delta < 0 ? 'price-drop' : delta > 0 ? 'price-up' : 'muted'}>
                      {delta < 0 ? '↓' : delta > 0 ? '↑' : '—'} {Math.abs(delta).toFixed(0)}
                      （{pct > 0 ? '+' : ''}{pct.toFixed(1)}%）
                    </span>
                  )}
                </div>
                <Spark prices={p.prices} />
                <div className="price-foot">
                  <small>上次采集 {timeAgo(task?.lastRunAt ?? last.at)}</small>
                  <button className="btn btn-primary btn-sm" onClick={() => crawl(p.id)}>立即采集</button>
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
                  <p>频率 {t.freq} · 上次运行 {timeAgo(t.lastRunAt)}</p>
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
    </div>
  )
}
