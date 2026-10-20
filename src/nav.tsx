import { useEffect, useState } from 'react'
import { useToast } from './components'
import { cx, timeAgo, uid } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'

/* 路线导航：地址簿选择 → 路线规划（伪优化）→ turn-by-turn 导航推进。
   地图零图片依赖：CSS 网格 + SVG 连线 + emoji 地标，坐标为百分比网格。 */

interface Place { id: string; name: string; emoji: string; x: number; y: number }
interface RouteStep { text: string; distKm: number }
interface PlannedRoute {
  id: string; fromId: string; toId: string; viaIds: string[]
  steps: RouteStep[]; distKm: number; mins: number; done: boolean; createdAt: number
}
interface NavState { routes: PlannedRoute[]; current: { routeId: string; stepIndex: number } | null }

const STORAGE_KEY = 'mim-nav-v1'

const PLACES: Place[] = [
  { id: 'home', name: '家', emoji: '🏠', x: 18, y: 78 },
  { id: 'office', name: '公司', emoji: '🏢', x: 76, y: 26 },
  { id: 'cafe', name: '拾光咖啡', emoji: '☕', x: 40, y: 55 },
  { id: 'gym', name: '燃力健身', emoji: '🏋️', x: 62, y: 68 },
  { id: 'library', name: '市图书馆', emoji: '📚', x: 30, y: 20 },
  { id: 'metro', name: '中心地铁站', emoji: '🚇', x: 55, y: 42 },
  { id: 'park', name: '滨江公园', emoji: '🌳', x: 84, y: 58 },
  { id: 'mall', name: '星悦广场', emoji: '🛍️', x: 12, y: 38 },
]

function place(id: string): Place { return PLACES.find((p) => p.id === id) ?? PLACES[0] }

function loadNav(): NavState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as NavState
      if (parsed && Array.isArray(parsed.routes)) {
        // 元素级校验：剔除脏数据，避免损坏存档导致路线列表/导航渲染异常
        const routes = parsed.routes.filter(
          (r): r is PlannedRoute =>
            !!r && typeof r === 'object' &&
            typeof r.id === 'string' && typeof r.fromId === 'string' && typeof r.toId === 'string' &&
            Array.isArray(r.viaIds) && r.viaIds.every((v): v is string => typeof v === 'string') &&
            Array.isArray(r.steps) && r.steps.every(
              (s): s is RouteStep => !!s && typeof s === 'object' &&
                typeof s.text === 'string' && typeof s.distKm === 'number' && Number.isFinite(s.distKm),
            ) &&
            typeof r.distKm === 'number' && Number.isFinite(r.distKm) &&
            typeof r.mins === 'number' && Number.isFinite(r.mins) &&
            typeof r.done === 'boolean' &&
            typeof r.createdAt === 'number' && Number.isFinite(r.createdAt),
        )
        const current =
          parsed.current && typeof parsed.current === 'object' &&
          typeof parsed.current.routeId === 'string' &&
          typeof parsed.current.stepIndex === 'number' && Number.isInteger(parsed.current.stepIndex)
            ? parsed.current
            : null
        return { routes, current }
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return { routes: [], current: null }
}

/** 伪优化：按已选途经点顺序连线，按网格坐标估算距离时长并生成转向文案 */
function planRoute(fromId: string, toId: string, viaIds: string[]): PlannedRoute {
  const ids = [fromId, ...viaIds.filter((v) => v !== fromId && v !== toId), toId]
  const points = ids.map(place)
  let total = 0
  const steps: RouteStep[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const dx = cur.x - prev.x
    const dy = cur.y - prev.y
    const seg = Math.round(Math.hypot(dx, dy) * 0.42 * 10) / 10
    total += seg
    const dir = dy >= 0 ? (dx >= 0 ? '东南' : '西南') : dx >= 0 ? '东北' : '西北'
    steps.push({ text: `向${dir}方向行驶 ${seg} km`, distKm: seg })
    steps.push({
      text: i === points.length - 1 ? `到达目的地：${cur.name} ${cur.emoji}` : `途经 ${cur.name} ${cur.emoji}，继续前进`,
      distKm: 0,
    })
  }
  return {
    id: uid('rt'), fromId, toId, viaIds: ids.slice(1, -1), steps,
    distKm: Math.round(total * 10) / 10,
    mins: Math.max(6, Math.round(total * 2.4)),
    done: false, createdAt: Date.now(),
  }
}

export function RouteNavPage() {
  const toast = useToast()
  const [state, setState] = useState<NavState>(loadNav)
  const [fromId, setFromId] = useState('home')
  const [toId, setToId] = useState<string | null>(null)
  const [viaIds, setViaIds] = useState<string[]>([])

  const save = (next: NavState) => {
    setState(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    pushToolState(STORAGE_KEY, next) // 云端整包快照（未登录/未配置时静默跳过）
  }

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 重载（幂等触发上方保存回推） */
  useEffect(() => {
    void pullToolState(STORAGE_KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
      setState(loadNav())
    })
  }, [])

  const current = state.current ? state.routes.find((r) => r.id === state.current?.routeId) ?? null : null
  const curStep = state.current?.stepIndex ?? 0

  const plan = () => {
    if (!toId || toId === fromId) { toast('请选择一个不同于起点的目的地 🗺'); return }
    const route = planRoute(fromId, toId, viaIds)
    save({ routes: [route, ...state.routes].slice(0, 8), current: null })
    toast(`路线已规划：全程 ${route.distKm} km / 约 ${route.mins} 分钟`)
  }

  const startNav = (routeId: string) => {
    save({ ...state, current: { routeId, stepIndex: 0 } })
    toast('导航开始，出发 🚗')
  }

  const advance = () => {
    if (!state.current || !current) return
    const next = state.current.stepIndex + 1
    if (next >= current.steps.length) {
      save({ routes: state.routes.map((r) => (r.id === current.id ? { ...r, done: true } : r)), current: null })
      toast(`已到达 ${place(current.toId).name} ${place(current.toId).emoji}`)
      return
    }
    save({ ...state, current: { routeId: state.current.routeId, stepIndex: next } })
  }

  const cancelNav = () => { save({ ...state, current: null }); toast('已退出导航') }

  const toggleVia = (id: string) => {
    setViaIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🗺 路线导航</h2>

        {/* 地图区 */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="nav-map">
            <svg className="nav-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
              {current && current.steps.length > 0 && (
                <polyline
                  points={[current.fromId, ...current.viaIds, current.toId].map(place).map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="var(--primary)" strokeWidth="1.4" strokeDasharray="3 2" strokeLinejoin="round"
                />
              )}
            </svg>
            {PLACES.map((p) => (
              <span
                key={p.id}
                className={cx('map-place', toId === p.id && 'dest', fromId === p.id && 'start')}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={p.name}
              >
                <i>{p.emoji}</i>
                <em>{p.name}</em>
              </span>
            ))}
          </div>
        </div>

        {/* 规划面板 */}
        <div className="card">
          <div className="board-toolbar">
            <b>路线规划</b>
            <div className="toolbar-actions">
              <button className="btn btn-primary btn-sm" onClick={plan}>🚀 规划路线</button>
            </div>
          </div>
          <p className="ko-line muted" style={{ marginTop: 8 }}>
            起点：<b style={{ color: 'var(--text)' }}>{place(fromId).name}</b>，点击下方地点设为目的地，再点一次可设为途经点。
          </p>
          <div className="rider-strip">
            {PLACES.filter((p) => p.id !== fromId).map((p) => (
              <span
                key={p.id}
                className={cx('rider-chip', toId === p.id && 'busy', viaIds.includes(p.id) && 'via')}
                onClick={() => {
                  if (toId === p.id) setToId(null)
                  else { setToId(p.id); setViaIds((v) => v.filter((x) => x !== p.id)) }
                }}
                onDoubleClick={() => toId !== p.id && toggleVia(p.id)}
              >
                <i>{p.emoji}</i>
                <span>{p.name}{viaIds.includes(p.id) ? '（途经）' : ''}</span>
              </span>
            ))}
          </div>
          <p className="ko-line muted">双击地点 = 加为途经点；单点 chip = 设为目的地。</p>
        </div>

        {/* 导航进行中 */}
        {current && state.current && (
          <div className="card">
            <div className="board-toolbar">
              <b>🚗 正在导航：{place(current.fromId).name} → {place(current.toId).name}</b>
              <div className="toolbar-actions">
                <button className="btn btn-ghost btn-sm" onClick={cancelNav}>退出</button>
                <button className="btn btn-primary btn-sm" onClick={advance}>
                  {curStep >= current.steps.length - 1 ? '🏁 完成导航' : '前进 →'}
                </button>
              </div>
            </div>
            <div className="progress-track" style={{ margin: '10px 0' }}>
              {current.steps.map((_, i) => (
                <i key={i} className={cx('progress-seg', i <= curStep && 'done')} />
              ))}
            </div>
            <div className="step-list">
              {current.steps.map((s, i) => (
                <div key={i} className={cx('step', i === curStep && 'active', i < curStep && 'done')}>
                  <span className="step-no">{i < curStep ? '✓' : i + 1}</span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 历史路线 */}
        <div className="card">
          <div className="board-toolbar"><b>路线记录</b></div>
          {state.routes.length === 0 && (
            <p className="muted" style={{ margin: '12px 0' }}>还没有路线，规划一条试试 🧭</p>
          )}
          {state.routes.map((r) => (
            <div key={r.id} className="task-row">
              <span className="price-emoji">{place(r.toId).emoji}</span>
              <div className="res-main">
                <b>{place(r.fromId).name} → {place(r.toId).name}{r.viaIds.length > 0 && `（途经 ${r.viaIds.length} 站）`}</b>
                <p className="muted">{r.distKm} km · 约 {r.mins} 分钟 · {timeAgo(r.createdAt)}{r.done ? ' · 已走完' : ''}</p>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => startNav(r.id)}
              >
                开始导航
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}