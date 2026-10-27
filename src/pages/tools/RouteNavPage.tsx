/* ==========================================================================
 * 路线导航 —— 地址簿选点 / 路线规划 / 分步推进
 *
 * 地图零图片依赖：CSS 网格底纹 + SVG polyline 连线 + emoji 地标，
 *      坐标是百分比网格；距离、时长、方向文案一律走 domain/tools 的纯规则，
 *      页面里不做任何距离估算的重复实现。
 *
 * 说明：这是本机演示用的坐标估算导航，不是真实路网导航（不接任何地图服务）。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import {
  NAV_ROUTE_MAX,
  directionText,
  estimateDistance,
  estimateMinutes,
} from '@/domain/tools/model'
import type { NavState, Place, PlannedRoute, RouteStep } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { cx, timeAgo, uid } from '@/core/utils'
import { Empty, useToast } from '@/ui'

const SCOPE = 'tools.nav'

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

const PLACE_MAP: Record<string, Place> = {}
for (const p of PLACES) PLACE_MAP[p.id] = p

const placeOf = (id: string): Place => PLACE_MAP[id] ?? PLACES[0]!

const EMPTY_STATE: NavState = { routes: [], current: null }

function parseStep(v: unknown): RouteStep | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.text !== 'string') return null
  if (typeof r.distKm !== 'number' || !Number.isFinite(r.distKm)) return null
  return { text: r.text, distKm: r.distKm }
}

function parseRoute(v: unknown): PlannedRoute | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const steps = Array.isArray(r.steps) ? r.steps : []
  if (typeof r.id !== 'string' || typeof r.fromId !== 'string' || typeof r.toId !== 'string') return null
  if (typeof r.distKm !== 'number' || typeof r.mins !== 'number') return null
  if (typeof r.createdAt !== 'number' || typeof r.done !== 'boolean') return null
  const list: RouteStep[] = []
  for (const s of steps) {
    const st = parseStep(s)
    if (st) list.push(st)
  }
  if (list.length === 0) return null
  return {
    id: r.id,
    fromId: r.fromId,
    toId: r.toId,
    viaIds: Array.isArray(r.viaIds) ? r.viaIds.filter((x): x is string => typeof x === 'string') : [],
    steps: list,
    distKm: r.distKm,
    mins: r.mins,
    done: r.done,
    createdAt: r.createdAt,
  }
}

function parseState(raw: unknown): NavState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.routes)) return null
  const routes: PlannedRoute[] = []
  for (const v of r.routes) {
    const rt = parseRoute(v)
    if (rt) routes.push(rt)
  }
  const cur = r.current
  const current =
    cur && typeof cur === 'object' &&
    typeof (cur as Record<string, unknown>).routeId === 'string' &&
    typeof (cur as Record<string, unknown>).stepIndex === 'number'
      ? { routeId: String((cur as Record<string, unknown>).routeId), stepIndex: Number((cur as Record<string, unknown>).stepIndex) }
      : null
  return { routes, current }
}

/** 规划：起点 → 途经点 → 终点逐段估算，方向文案由 directionText 统一生成 */
function planRoute(fromId: string, toId: string, viaIds: string[]): PlannedRoute {
  const ids = [fromId, ...viaIds.filter((v) => v !== fromId && v !== toId), toId]
  const points = ids.map(placeOf)
  const steps: RouteStep[] = []
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!
    const cur = points[i]!
    const seg = Math.round(estimateDistance(prev, cur) * 10) / 10
    total += seg
    // 屏幕坐标 y 向下为正，所以 dy>0 视作「往南」
    const dir = directionText(cur.x - prev.x, cur.y - prev.y)
    steps.push({ text: `向${dir}方向行驶 ${seg} km`, distKm: seg })
    steps.push({
      text: i === points.length - 1 ? `到达目的地：${cur.name} ${cur.emoji}` : `途经 ${cur.name} ${cur.emoji}，继续前进`,
      distKm: 0,
    })
  }
  const distKm = Math.round(total * 10) / 10
  return {
    id: uid('rt'),
    fromId,
    toId,
    viaIds: ids.slice(1, -1),
    steps,
    distKm,
    mins: estimateMinutes(distKm),
    done: false,
    createdAt: Date.now(),
  }
}

export function RouteNavPage() {
  const toast = useToast()
  const [state, setState] = useState<NavState>(() => loadSnapshot(SCOPE, parseState, EMPTY_STATE))
  const [fromId, setFromId] = useState(PLACES[0]!.id)
  const [toId, setToId] = useState<string | null>(null)
  const [viaIds, setViaIds] = useState<string[]>([])

  useEffect(() => {
    saveSnapshot(SCOPE, state)
  }, [state])

  const current = state.current ? (state.routes.find((r) => r.id === state.current?.routeId) ?? null) : null
  const curStep = state.current?.stepIndex ?? 0

  const plan = (): void => {
    if (!toId || toId === fromId) {
      toast('请选择一个不同于起点的目的地')
      return
    }
    const route = planRoute(fromId, toId, viaIds)
    setState({ routes: [route, ...state.routes].slice(0, NAV_ROUTE_MAX), current: null })
    toast(`路线已规划：全程 ${route.distKm} km / 约 ${route.mins} 分钟`)
  }

  const advance = (): void => {
    if (!state.current || !current) return
    const next = state.current.stepIndex + 1
    if (next >= current.steps.length) {
      setState({
        routes: state.routes.map((r) => (r.id === current.id ? { ...r, done: true } : r)),
        current: null,
      })
      toast(`已到达 ${placeOf(current.toId).name} ${placeOf(current.toId).emoji}`)
      return
    }
    setState({ ...state, current: { routeId: state.current.routeId, stepIndex: next } })
  }

  const toggleVia = (id: string): void => {
    setViaIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))
  }

  return (
    <div className="page">
      <h1 className="page-title">🗺 路线导航</h1>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="nav-map">
          <svg className="nav-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {current ? (
              <polyline
                points={[current.fromId, ...current.viaIds, current.toId].map((id) => {
                  const p = placeOf(id)
                  return `${p.x},${p.y}`
                }).join(' ')}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={1.4}
                strokeDasharray="3 2"
                strokeLinejoin="round"
              />
            ) : null}
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

      <div className="card">
        <div className="row-between">
          <b>路线规划</b>
          <button className="btn btn-primary btn-sm" onClick={plan}>🚀 规划路线</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0' }}>
          起点：<b style={{ color: 'var(--text)' }}>{placeOf(fromId).name}</b>。点击下方地点设为目的地（单点），双击设为途经点。
        </p>
        <div className="chip-row">
          {PLACES.filter((p) => p.id !== fromId).map((p) => (
            <button
              key={p.id}
              className={cx('chip', toId === p.id && 'active', viaIds.includes(p.id) && 'via')}
              onClick={() => {
                if (toId === p.id) {
                  setToId(null)
                  return
                }
                setToId(p.id)
                setViaIds((v) => v.filter((x) => x !== p.id))
              }}
              onDoubleClick={() => toId !== p.id && toggleVia(p.id)}
            >
              {p.emoji} {p.name}
              {viaIds.includes(p.id) ? '（途经）' : ''}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>换起点：</span>
          {PLACES.map((p) => (
            <button key={p.id} className={cx('chip', fromId === p.id && 'active')} onClick={() => setFromId(p.id)}>
              {p.emoji}
            </button>
          ))}
        </div>
      </div>

      {current && state.current ? (
        <div className="card">
          <div className="row-between">
            <b>🚗 正在导航：{placeOf(current.fromId).name} → {placeOf(current.toId).name}</b>
            <span className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => setState({ ...state, current: null })}>退出</button>
              <button className="btn btn-primary btn-sm" onClick={advance}>
                {curStep >= current.steps.length - 1 ? '🏁 完成导航' : '前进 →'}
              </button>
            </span>
          </div>
          <div className="progress-track" style={{ margin: '10px 0' }}>
            {current.steps.map((_, i) => (
              <span key={i} className={cx('progress-seg', i <= curStep && 'on')} />
            ))}
          </div>
          <div className="step-list">
            {current.steps.map((s, i) => (
              <div key={i} className={cx('step', i === curStep && 'on')}>
                <span className="step-no">{i < curStep ? '✓' : i + 1}</span>
                <span>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="section-title">路线记录（最多 {NAV_ROUTE_MAX} 条）</div>
      {state.routes.length === 0 ? (
        <Empty emoji="🧭" text="还没有路线，选好起点与目的地后点「规划路线」" />
      ) : (
        state.routes.map((r) => (
          <div key={r.id} className="notif-row">
            <span className="notif-icon">{placeOf(r.toId).emoji}</span>
            <div className="notif-body">
              <p style={{ margin: 0 }}>
                {placeOf(r.fromId).name} → {placeOf(r.toId).name}
                {r.viaIds.length > 0 ? `（途经 ${r.viaIds.length} 站）` : ''}
              </p>
              <small className="muted">
                {r.distKm} km · 约 {r.mins} 分钟 · {timeAgo(r.createdAt)}{r.done ? ' · 已走完' : ''}
              </small>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setState({ ...state, current: { routeId: r.id, stepIndex: 0 } })}>
              开始导航
            </button>
          </div>
        ))
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        距离为网格坐标估算值，仅用于演示导航推进，不能当作真实行车距离使用。
      </p>
    </div>
  )
}
