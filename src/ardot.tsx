import './ardot.css'
import { useEffect, useRef, useState } from 'react'
import { useToast } from './components'
import { cx, timeAgo } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'

/* 多源聚合监控台：聚合 6 个真实公开 API（无密钥、支持跨域）——
   汇率（ExchangeRate-API）/ 天气（Open-Meteo）/ GitHub 仓库指标 / ISS 轨道（WhereTheISS.at）/
   日出日落（Sunrise-Sunset.org）/ 加密货币行情（Coinbase）。
   保留 TTL 缓存与强制回源、回源失败陈旧回退、健康探针、审计日志的真实机制；
   故障注入仅用于演示降级路径，不伪造任何数据。 */

interface ArdotItem { title: string; value: string }

interface SourceRuntime {
  status: 'ok' | 'error'
  items: ArdotItem[]
  message: string
  fetchedAt: number
  stale: boolean
  ms: number
}

interface SourceDef {
  id: string
  label: string
  emoji: string
  provider: string
  endpoint: string
  ttl: number
  desc: string
  parse: (raw: unknown) => ArdotItem[]
}

interface LogEntry {
  id: string
  at: number
  action: string
  source: string
  result: '成功' | '失败' | '拒绝'
  detail: string
  ms: number
}

interface ArdotState {
  sources: Record<string, SourceRuntime>
  logs: LogEntry[]
  cacheHits: number
  originFetches: number
}

const STORAGE_KEY = 'mim-ardot-v1'
const LOG_MAX = 40
const TIMEOUT_MS = 8000

const emptyRuntime = (): SourceRuntime => ({ status: 'ok', items: [], message: '', fetchedAt: 0, stale: false, ms: 0 })

/* ---------- 解析工具 ---------- */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const requireItem = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg)
}

const fmtLocalTime = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/* Open-Meteo weathercode 对照表（WMO 标准码） */
const WX_CODES: Record<number, string> = {
  0: '晴', 1: '基本晴', 2: '局部多云', 3: '阴天', 45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '中阵雨', 82: '强阵雨', 85: '小阵雪', 86: '大阵雪',
  95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹',
}

const SOURCE_DEFS: SourceDef[] = [
  {
    id: 'fx', label: '汇率', emoji: '💱', provider: 'ExchangeRate-API · 公开汇率',
    /* 换源说明：原 Frankfurter(ECB) 响应不带 Access-Control-Allow-Origin，
       浏览器直连必被 CORS 拦截（线上控制台报 ERR_FAILED，汇率卡片恒为降级态）。
       open.er-api.com 返回 `access-control-allow-origin: *` 可直连，
       同为 USD 基准的每日参考汇率，字段结构 { result, rates, time_last_update_utc }。 */
    endpoint: 'open.er-api.com/v6/latest/USD', ttl: 900,
    desc: 'USD 基准每日参考汇率（CNY / EUR / JPY / GBP / HKD）',
    parse: (raw) => {
      const o = raw as
        | { result?: unknown; rates?: Record<string, unknown>; time_last_update_utc?: unknown }
        | null
      requireItem(o?.result === 'success', '汇率源返回失败')
      const rates = o?.rates
      requireItem(!!rates && typeof rates === 'object', '数据格式异常')
      const items: ArdotItem[] = []
      for (const k of ['CNY', 'EUR', 'JPY', 'GBP', 'HKD']) {
        const v = num(rates![k])
        if (v !== null) items.push({ title: `USD → ${k}`, value: v.toFixed(4) })
      }
      requireItem(items.length > 0, '无有效汇率数据')
      const updated = o?.time_last_update_utc
      // 原始值形如 "Sat, 24 Oct 2026 00:02:31 +0000"，去掉时区尾缀以免过长
      if (typeof updated === 'string' && updated) {
        items.push({ title: '报价时间', value: updated.replace(/\s+\+\d{4}$/, '') })
      }
      return items
    },
  },
  {
    id: 'weather', label: '天气', emoji: '🌤️', provider: 'Open-Meteo · 北京',
    endpoint: 'api.open-meteo.com/v1/forecast?latitude=39.9042&longitude=116.4074&current_weather=true', ttl: 600,
    desc: '北京当前气温 / 风速 / 天气现象（WMO 码）',
    parse: (raw) => {
      const cw = (raw as { current_weather?: Record<string, unknown> } | null)?.current_weather
      requireItem(!!cw, '数据格式异常')
      const t = num(cw!.temperature)
      const w = num(cw!.windspeed)
      const dir = num(cw!.winddirection)
      const code = num(cw!.weathercode)
      requireItem(t !== null && w !== null && dir !== null && code !== null, '缺少必要气象字段')
      const items: ArdotItem[] = [
        { title: '气温', value: `${t}°C` },
        { title: '天气现象', value: WX_CODES[code!] ?? `代码 ${code}` },
        { title: '风速', value: `${w} km/h` },
        { title: '风向', value: `${dir}°` },
      ]
      const tm = fmtLocalTime(cw!.time)
      if (tm) items.push({ title: '观测时间', value: tm })
      return items
    },
  },
  {
    id: 'github', label: 'GitHub 指标', emoji: '🐙', provider: 'api.github.com · facebook/react',
    endpoint: 'api.github.com/repos/facebook/react', ttl: 300,
    desc: '开源仓库 Stars / Forks / Issue 等公开指标',
    parse: (raw) => {
      const o = raw as Record<string, unknown> | null
      requireItem(!!o, '数据格式异常')
      const items: ArdotItem[] = []
      const add = (k: string, title: string, fmt: (v: number) => string = (v) => v.toLocaleString()) => {
        const v = num(o![k])
        if (v !== null) items.push({ title, value: fmt(v) })
      }
      add('stargazers_count', 'Stars')
      add('forks_count', 'Forks')
      add('open_issues_count', 'Open Issues')
      add('subscribers_count', 'Watchers')
      requireItem(items.length > 0, '缺少仓库指标字段')
      const pushedAt = typeof o!.pushed_at === 'string' ? o!.pushed_at : ''
      const ts = pushedAt ? new Date(pushedAt).getTime() : NaN
      if (!Number.isNaN(ts)) items.push({ title: '最近推送', value: timeAgo(ts) })
      return items
    },
  },
  {
    id: 'iss', label: 'ISS 轨道', emoji: '🛰️', provider: 'WhereTheISS.at',
    endpoint: 'api.wheretheiss.at/v1/satellites/25544', ttl: 30,
    desc: '国际空间站实时位置（经纬度 / 高度 / 速度）',
    parse: (raw) => {
      const o = raw as Record<string, unknown> | null
      requireItem(!!o, '数据格式异常')
      const lat = num(o!.latitude)
      const lon = num(o!.longitude)
      const alt = num(o!.altitude)
      const vel = num(o!.velocity)
      requireItem(lat !== null && lon !== null, '缺少轨道位置字段')
      const items: ArdotItem[] = [
        { title: '纬度', value: `${lat!.toFixed(3)}°` },
        { title: '经度', value: `${lon!.toFixed(3)}°` },
      ]
      if (alt !== null) items.push({ title: '高度', value: `${alt.toFixed(1)} km` })
      if (vel !== null) items.push({ title: '速度', value: `${Math.round(vel).toLocaleString()} km/h` })
      return items
    },
  },
  {
    id: 'sun', label: '日出日落', emoji: '🌅', provider: 'Sunrise-Sunset.org · 北京',
    endpoint: 'api.sunrise-sunset.org/json?lat=39.9042&lng=116.4074&formatted=0', ttl: 3600,
    desc: '北京今日日出 / 日落 / 昼长（UTC 转本地时区）',
    parse: (raw) => {
      const r = (raw as { results?: Record<string, unknown> } | null)?.results
      requireItem(!!r, '数据格式异常')
      const sunrise = fmtLocalTime(r!.sunrise)
      const sunset = fmtLocalTime(r!.sunset)
      requireItem(!!sunrise && !!sunset, '缺少日出日落字段')
      const items: ArdotItem[] = [
        { title: '日出（本地时区）', value: sunrise! },
        { title: '日落（本地时区）', value: sunset! },
      ]
      const dayLen = typeof r!.day_length === 'string' ? r!.day_length : ''
      if (dayLen) items.push({ title: '昼长', value: dayLen })
      return items
    },
  },
  {
    id: 'crypto', label: '加密货币行情', emoji: '₿', provider: 'Coinbase · BTC 基准',
    endpoint: 'api.coinbase.com/v2/exchange-rates?currency=BTC', ttl: 120,
    desc: 'Coinbase 公开牌价（BTC 对 USD / EUR / CNY 等）',
    parse: (raw) => {
      const rates = (raw as { data?: { rates?: Record<string, unknown> } } | null)?.data?.rates
      requireItem(!!rates && typeof rates === 'object', '数据格式异常')
      const items: ArdotItem[] = []
      for (const k of ['USD', 'EUR', 'CNY', 'JPY', 'ETH']) {
        const n = typeof rates![k] === 'string' ? Number.parseFloat(rates![k] as string) : NaN
        if (Number.isFinite(n)) items.push({ title: `BTC → ${k}`, value: n.toLocaleString(undefined, { maximumFractionDigits: 2 }) })
      }
      requireItem(items.length > 0, '无有效牌价数据')
      return items
    },
  },
]

const DEF_MAP: Record<string, SourceDef> = {}
SOURCE_DEFS.forEach((d) => { DEF_MAP[d.id] = d })

const LOG_FILTERS = ['全部', '成功', '失败', '拒绝'] as const
type LogFilter = (typeof LOG_FILTERS)[number]

const defaultState = (): ArdotState => {
  const sources: Record<string, SourceRuntime> = {}
  SOURCE_DEFS.forEach((d) => { sources[d.id] = emptyRuntime() })
  return { sources, logs: [], cacheHits: 0, originFetches: 0 }
}

function loadArdot(): ArdotState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as ArdotState
      if (
        p && typeof p.cacheHits === 'number' && typeof p.originFetches === 'number' &&
        Array.isArray(p.logs) && p.sources && typeof p.sources === 'object'
      ) {
        const sources: Record<string, SourceRuntime> = {}
        SOURCE_DEFS.forEach((d) => {
          const s = p.sources[d.id]
          if (s && (s.status === 'ok' || s.status === 'error') && Array.isArray(s.items) &&
            typeof s.fetchedAt === 'number' && typeof s.ms === 'number') {
            sources[d.id] = {
              status: s.status,
              items: s.items.filter((it) => it && typeof it.title === 'string' && typeof it.value === 'string'),
              message: typeof s.message === 'string' ? s.message : '',
              fetchedAt: s.fetchedAt,
              stale: !!s.stale,
              ms: s.ms,
            }
          } else {
            sources[d.id] = emptyRuntime()
          }
        })
        const logs = p.logs
          .filter((l) => l && typeof l.id === 'string' && typeof l.at === 'number' && typeof l.action === 'string')
          .slice(-LOG_MAX)
        return { sources, logs, cacheHits: p.cacheHits, originFetches: p.originFetches }
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return defaultState()
}

/** 带超时的真实 JSON 请求：超时或网络失败均 reject */
async function fetchJson(url: string, ms = TIMEOUT_MS): Promise<unknown> {
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(`https://${url}`, { signal: ac.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    window.clearTimeout(timer)
  }
}

type SrcPhase = 'ok' | 'error' | 'pending'
const srcPhase = (rt: SourceRuntime): SrcPhase => (rt.fetchedAt === 0 ? 'pending' : rt.status)

const PHASE_TEXT: Record<SrcPhase, string> = { ok: '正常', error: '异常', pending: '待采集' }

export function ArdotPage() {
  const toast = useToast()
  const [state, setState] = useState<ArdotState>(loadArdot)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [faults, setFaults] = useState<Record<string, boolean>>({})
  const [probe, setProbe] = useState<{ at: number; ok: number; down: number } | null>(null)
  const [logFilter, setLogFilter] = useState<LogFilter>('全部')

  const stateRef = useRef(state)
  const faultsRef = useRef(faults)
  const mountedRef = useRef(true)

  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => () => { mountedRef.current = false }, [])

  const save = (next: ArdotState) => {
    setState(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    pushToolState(STORAGE_KEY, next) // 云端整包快照（未登录/未配置时静默跳过）
  }

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 重载（幂等触发上方保存回推） */
  useEffect(() => {
    void pullToolState(STORAGE_KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
      setState(loadArdot())
    })
  }, [])

  const pushLog = (entry: Omit<LogEntry, 'id' | 'at'>) => {
    setState((prev) => ({
      ...prev,
      logs: [...prev.logs, { id: `lg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...entry }].slice(-LOG_MAX),
    }))
  }

  /* 单源真实回源：失败时回退到上一次的真实数据并标记陈旧 */
  const fetchOne = async (def: SourceDef): Promise<SourceRuntime> => {
    const start = Date.now()
    try {
      if (faultsRef.current[def.id]) throw new Error('已注入故障')
      const raw = await fetchJson(def.endpoint)
      const items = def.parse(raw)
      return { status: 'ok', items, message: '', fetchedAt: Date.now(), stale: false, ms: Date.now() - start }
    } catch (e) {
      const prevRt = stateRef.current.sources[def.id] ?? emptyRuntime()
      const reason = e instanceof Error ? e.message : '未知错误'
      return {
        status: 'error',
        items: prevRt.items,
        message: prevRt.items.length ? '回源失败，正在展示陈旧缓存' : `请求失败：${reason}`,
        fetchedAt: prevRt.fetchedAt,
        stale: prevRt.items.length > 0,
        ms: Date.now() - start,
      }
    }
  }

  /* 聚合读取：TTL 内命中缓存；强制回源或过期才发起真实请求，失败保留旧数据 */
  const fetchAll = (fresh: boolean, snap?: ArdotState) => {
    const cur = snap ?? stateRef.current
    stateRef.current = cur
    const now = Date.now()
    const hits: string[] = []
    const misses: string[] = []
    SOURCE_DEFS.forEach((d) => {
      const rt = cur.sources[d.id] ?? emptyRuntime()
      const need = fresh || rt.fetchedAt === 0 || now - rt.fetchedAt > d.ttl * 1000
      ;(need ? misses : hits).push(d.id)
    })
    if (hits.length > 0) {
      setState((prev) => ({ ...prev, cacheHits: prev.cacheHits + hits.length }))
    }
    if (misses.length === 0) {
      pushLog({ action: fresh ? '强制回源' : '聚合读取', source: '全部', result: '成功', detail: `${hits.length} 个源全部命中缓存`, ms: 0 })
      if (fresh) toast('全部命中缓存，本次未回源')
      return
    }
    misses.forEach((id) => setBusy((b) => ({ ...b, [id]: true })))
    void Promise.all(misses.map((id) => fetchOne(DEF_MAP[id]))).then((rts) => {
      if (!mountedRef.current) return
      let ok = 0
      setState((prev) => {
        const sources = { ...prev.sources }
        misses.forEach((id, i) => {
          sources[id] = rts[i]
          if (rts[i].status === 'ok') ok += 1
        })
        return { ...prev, originFetches: prev.originFetches + misses.length, sources }
      })
      setBusy((b) => {
        const n = { ...b }
        misses.forEach((id) => delete n[id])
        return n
      })
      const fail = misses.length - ok
      pushLog({
        action: fresh ? '强制回源' : '聚合读取',
        source: '全部',
        result: fail ? '失败' : '成功',
        detail: `回源 ${misses.length} 源 · 命中缓存 ${hits.length} 源${fail ? ` · ${fail} 源异常` : ''}`,
        ms: Math.max(...rts.map((r) => r.ms)),
      })
      if (fail) toast(`⚠ ${fail} 个数据源回源失败，已回退缓存`)
    })
  }

  const flushCache = (id?: string) => {
    const target = id ? DEF_MAP[id].label : '全部'
    setState((prev) => {
      const sources = { ...prev.sources }
      ;(id ? [id] : SOURCE_DEFS.map((d) => d.id)).forEach((k) => {
        sources[k] = { ...(sources[k] ?? emptyRuntime()), fetchedAt: 0, stale: false }
      })
      return { ...prev, sources }
    })
    pushLog({ action: '清空缓存', source: target, result: '成功', detail: '已清除本地缓存，下次聚合将重新回源', ms: 0 })
    toast(id ? `已清除「${target}」缓存` : '已清除全部数据源缓存')
  }

  /* 健康探针：基于各源最近一次真实回源结果汇总 */
  const runProbe = () => {
    const cur = stateRef.current
    const phases = SOURCE_DEFS.map((d) => srcPhase(cur.sources[d.id] ?? emptyRuntime()))
    const ok = phases.filter((s) => s === 'ok').length
    const down = phases.filter((s) => s === 'error').length
    setProbe({ at: Date.now(), ok, down })
    pushLog({
      action: '健康探针', source: '全部', result: down ? '失败' : '成功',
      detail: `正常 ${ok} · 异常 ${down}（基于各源最近回源结果）`, ms: 0,
    })
    toast(down ? `健康检查未通过：${down} 个源异常` : '健康检查通过：全部已采集源正常')
  }

  const toggleFault = (id: string) => {
    setFaults((f) => {
      const n = { ...f, [id]: !f[id] }
      faultsRef.current = n
      return n
    })
  }

  const reset = () => {
    if (!window.confirm('清空缓存与审计记录，并重新回源？')) return
    const fresh = defaultState()
    save(fresh)
    stateRef.current = fresh
    setFaults(() => { faultsRef.current = {}; return {} })
    setProbe(null)
    setLogFilter('全部')
    fetchAll(true, fresh)
    toast('本地记录已清空，正在重新回源')
  }

  /* 首屏：直接发起首轮真实聚合 */
  useEffect(() => {
    fetchAll(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anyBusy = Object.keys(busy).length > 0
  const runtimes = SOURCE_DEFS.map((d) => ({ def: d, rt: state.sources[d.id] ?? emptyRuntime() }))
  const errCount = runtimes.filter((x) => srcPhase(x.rt) === 'error').length
  const okCount = runtimes.filter((x) => srcPhase(x.rt) === 'ok').length
  const pendingCount = runtimes.filter((x) => srcPhase(x.rt) === 'pending').length
  const staleCount = runtimes.filter((x) => x.rt.stale).length
  const shownLogs = state.logs.filter((l) => logFilter === '全部' || l.result === logFilter).slice(-9).reverse()

  return (
    <div className="page-grid">
      <div>
        <h2 className="page-title">🛰 多源聚合监控台</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          正常 {okCount} · 异常 {errCount} · 待采集 {pendingCount} · 全部为真实公开 API 数据
        </p>

        <div className="ardot-toolbar">
          <div className="ardot-tenants">
            <span className="muted" style={{ alignSelf: 'center' }}>数据源：6 个公开 API（无密钥 / 支持跨域）</span>
          </div>
          <div className="ardot-actions">
            <button className="btn btn-primary btn-sm" disabled={anyBusy} onClick={() => fetchAll(false)}>
              {anyBusy ? '聚合中…' : '⟳ 刷新数据'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={anyBusy} onClick={() => fetchAll(true)}>强制回源</button>
            <button className="btn btn-ghost btn-sm" disabled={anyBusy} onClick={() => flushCache()}>🧹 清空缓存</button>
            <button className="btn btn-ghost btn-sm" disabled={anyBusy} onClick={runProbe}>💓 健康探针</button>
          </div>
        </div>

        {errCount > 0 && (
          <div className="ardot-banner danger">
            ⚠ {errCount} 个数据源回源异常{staleCount > 0 ? ` · ${staleCount} 个源已回退陈旧缓存` : ' · 请检查网络或稍后重试'}
          </div>
        )}
        {errCount === 0 && pendingCount > 0 && !anyBusy && (
          <div className="ardot-banner warn">⏳ {pendingCount} 个数据源待采集，点击「刷新数据」回源</div>
        )}
        {errCount === 0 && probe && (
          <div className="ardot-banner ok">
            ✔ 上次探针：正常 {probe.ok} / 异常 {probe.down} · {timeAgo(probe.at)}
          </div>
        )}

        <div className="ardot-grid">
          {runtimes.map(({ def, rt }) => {
            const phase = srcPhase(rt)
            const loading = !!busy[def.id]
            const cacheState = rt.fetchedAt === 0
              ? 'cleared'
              : Date.now() - rt.fetchedAt <= def.ttl * 1000 ? 'fresh' : 'expired'
            return (
              <div key={def.id} className={cx('ardot-src', phase === 'error' && 'err')}>
                <div className="ardot-src-top">
                  <span className="ardot-src-emoji">{def.emoji}</span>
                  <span className="ardot-src-title">
                    <b>{def.label}</b>
                    <small>{def.endpoint}</small>
                  </span>
                  <span className={cx('ardot-badge', phase)}>{PHASE_TEXT[phase]}</span>
                </div>
                <p className="ardot-src-desc">{def.desc}</p>
                <p className="ardot-src-tags">
                  <span className="ardot-badge layer">{def.provider}</span>
                  <span className={cx('ardot-badge', 'cache', cacheState === 'expired' && 'expired')}>
                    {cacheState === 'fresh' ? `缓存生效 · TTL ${def.ttl}s` : cacheState === 'expired' ? '缓存过期' : '已清空'}
                  </span>
                  {rt.stale && <span className="ardot-badge error">陈旧回退</span>}
                </p>
                {loading ? (
                  <div className="ardot-skel"><i /><i /><i /><i /></div>
                ) : rt.items.length > 0 ? (
                  <ul className="ardot-items">
                    {rt.items.map((it, i) => (
                      <li key={i}><span>{it.title}</span><b>{it.value}</b></li>
                    ))}
                  </ul>
                ) : (
                  <p className="ardot-srcremote">{phase === 'error' ? '回源失败，暂无可用数据' : '缓存已清除，点击「刷新数据」回源'}</p>
                )}
                {!loading && rt.message && <p className="ardot-errmsg">✕ {rt.message}（{rt.ms}ms）</p>}
                <div className="ardot-src-foot">
                  <span className="muted">
                    {rt.fetchedAt ? `更新于 ${timeAgo(rt.fetchedAt)}` : '未采集'}
                    {rt.ms > 0 && rt.fetchedAt > 0 ? ` · 回源 ${rt.ms}ms` : ''}
                  </span>
                  <button
                    className={cx('ardot-fault', faults[def.id] && 'on')}
                    disabled={!!busy[def.id]}
                    title="演示：注入回源失败，测试陈旧回退与降级路径（不伪造数据）"
                    onClick={() => toggleFault(def.id)}
                  >
                    ⚡ 故障注入{faults[def.id] ? '：开' : '：关'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div className="side-card">
          <h3>📈 聚合概况</h3>
          <div className="ardot-kpi"><span>数据源</span><b>{SOURCE_DEFS.length} 个（{okCount} 正常）</b></div>
          <div className="ardot-kpi"><span>缓存命中 / 回源</span><b>{state.cacheHits} / {state.originFetches} 次</b></div>
          <div className="ardot-kpi"><span>接口超时</span><b>{TIMEOUT_MS / 1000} s</b></div>
          <p className="muted" style={{ marginTop: 8 }}>
            数据来源：ExchangeRate-API、Open-Meteo、GitHub API、WhereTheISS.at、Sunrise-Sunset.org、Coinbase；
            回源失败时回退展示上一次真实数据并标记「陈旧回退」，绝不伪造数据。
          </p>
        </div>

        <div className="side-card">
          <h3>📋 审计日志</h3>
          <div className="ardot-filters">
            {LOG_FILTERS.map((f) => (
              <button
                key={f}
                className={cx('ardot-fchip', logFilter === f && 'active')}
                onClick={() => setLogFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {shownLogs.length === 0 ? (
            <p className="muted">暂无{logFilter === '全部' ? '' : logFilter}审计记录，聚合一次试试</p>
          ) : (
            <div className="ardot-logs">
              {shownLogs.map((l) => (
                <div key={l.id} className="ardot-log">
                  <div className="ardot-log-top">
                    <b>{l.action} · {l.source}</b>
                    <span className={cx('ardot-log-res', l.result === '成功' ? 'ok' : l.result === '失败' ? 'fail' : 'deny')}>
                      {l.result}
                    </span>
                  </div>
                  <small className="muted">{timeAgo(l.at)}{l.ms > 0 ? ` · ${l.ms}ms` : ''} · {l.detail}</small>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-ghost btn-sm" onClick={reset}>清空本地记录</button>
      </div>
    </div>
  )
}
