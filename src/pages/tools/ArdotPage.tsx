/* ==========================================================================
 * 多源聚合监控台 —— 6 个公开数据源（无密钥 / 支持浏览器跨域直连）
 *
 * 机制（全部保留真实语义，无一模拟）：
 *   - TTL 缓存：未过期且非强制回源时直接命中本地缓存，不发起请求。
 *   - 陈旧回退：回源失败时展示上一次真实数据并打「陈旧」标记，绝不补假数值。
 *   - 健康探针：基于各源最近一次真实回源结果汇总，不额外请求。
 *   - 审计日志：每次聚合/回源/探针/清缓存落一条，保留 ARDOT_LOG_MAX 条。
 *
 * 换源记录：汇率源用 open.er-api.com（响应带 access-control-allow-origin:*），
 *      原 Frankfurter(ECB) 不带 CORS 头，浏览器直连必被拦，线上表现是「恒为降级态」。
 * ======================================================================== */

import { useEffect, useRef, useState } from 'react'
import { ARDOT_LOG_MAX, ARDOT_TIMEOUT_MS } from '@/domain/tools/model'
import type { ArdotItem, LogEntry, SourceRuntime } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { cx, timeAgo, uid } from '@/core/utils'
import { Badge, Skeleton, useToast } from '@/ui'

const SCOPE = 'tools.ardot'

interface SourceDef {
  id: string
  label: string
  emoji: string
  provider: string
  endpoint: string
  ttlSec: number
  desc: string
  parse: (raw: unknown) => ArdotItem[]
}

interface ArdotState {
  sources: Record<string, SourceRuntime>
  logs: LogEntry[]
  cacheHits: number
  originFetches: number
}

/* ---------- 解析小工具 ---------- */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 数据源 parse 的统一失败出口：抛错由 fetchOne 捕获后走陈旧回退 */
function fail(msg: string): never {
  throw new Error(msg)
}

/** 取对象：不是对象就直接抛（后面 parse 里就不必到处判空） */
const mustRecord = (v: unknown, msg: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(msg)
  return v as Record<string, unknown>
}

const mustNumber = (v: unknown, msg: string): number => {
  const n = num(v)
  if (n === null) fail(msg)
  return n
}

const localTime = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Open-Meteo weathercode 对照表（WMO 标准码） */
const WX_CODES: Record<number, string> = {
  0: '晴', 1: '基本晴', 2: '局部多云', 3: '阴天', 45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '中阵雨', 82: '强阵雨', 85: '小阵雪', 86: '大阵雪',
  95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹',
}

const SOURCE_DEFS: SourceDef[] = [
  {
    id: 'fx', label: '汇率', emoji: '💱', provider: 'ExchangeRate-API',
    endpoint: 'https://open.er-api.com/v6/latest/USD', ttlSec: 900,
    desc: 'USD 基准每日参考汇率（CNY / EUR / JPY / GBP / HKD）',
    parse: (raw) => {
      const o = mustRecord(raw, '数据格式异常')
      if (o.result !== 'success') fail('汇率源返回失败')
      const rates = mustRecord(o.rates, '数据格式异常')
      const items: ArdotItem[] = []
      for (const k of ['CNY', 'EUR', 'JPY', 'GBP', 'HKD']) {
        const v = num(rates[k])
        if (v !== null) items.push({ title: `USD → ${k}`, value: v.toFixed(4) })
      }
      if (items.length === 0) fail('无有效汇率数据')
      // 原始值形如 "Sat, 24 Oct 2026 00:02:31 +0000"，去掉时区尾缀以免过长
      const updated = o.time_last_update_utc
      if (typeof updated === 'string' && updated) {
        items.push({ title: '报价时间', value: updated.replace(/\s+\+\d{4}$/, '') })
      }
      return items
    },
  },
  {
    id: 'weather', label: '天气', emoji: '🌤️', provider: 'Open-Meteo · 北京',
    endpoint: 'https://api.open-meteo.com/v1/forecast?latitude=39.9042&longitude=116.4074&current_weather=true', ttlSec: 600,
    desc: '北京当前气温 / 风速 / 天气现象（WMO 码）',
    parse: (raw) => {
      const cw = mustRecord(mustRecord(raw, '数据格式异常').current_weather, '缺少 current_weather')
      const t = mustNumber(cw.temperature, '缺少气温字段')
      const w = mustNumber(cw.windspeed, '缺少风速字段')
      const dir = mustNumber(cw.winddirection, '缺少风向字段')
      const code = mustNumber(cw.weathercode, '缺少天气代码字段')
      const items: ArdotItem[] = [
        { title: '气温', value: `${t}°C` },
        { title: '天气现象', value: WX_CODES[code] ?? `代码 ${code}` },
        { title: '风速', value: `${w} km/h` },
        { title: '风向', value: `${dir}°` },
      ]
      const tm = localTime(cw.time)
      if (tm) items.push({ title: '观测时间', value: tm })
      return items
    },
  },
  {
    id: 'github', label: 'GitHub 指标', emoji: '🐙', provider: 'api.github.com · facebook/react',
    endpoint: 'https://api.github.com/repos/facebook/react', ttlSec: 300,
    desc: '开源仓库 Stars / Forks / Open Issues 等公开指标',
    parse: (raw) => {
      const o = mustRecord(raw, '数据格式异常')
      const items: ArdotItem[] = []
      const add = (k: string, title: string): void => {
        const v = num(o[k])
        if (v !== null) items.push({ title, value: v.toLocaleString() })
      }
      add('stargazers_count', 'Stars')
      add('forks_count', 'Forks')
      add('open_issues_count', 'Open Issues')
      add('subscribers_count', 'Watchers')
      if (items.length === 0) fail('缺少仓库指标字段')
      const pushedAt = typeof o.pushed_at === 'string' ? o.pushed_at : ''
      const ts = pushedAt ? new Date(pushedAt).getTime() : NaN
      if (!Number.isNaN(ts)) items.push({ title: '最近推送', value: timeAgo(ts) })
      return items
    },
  },
  {
    id: 'iss', label: 'ISS 轨道', emoji: '🛰️', provider: 'WhereTheISS.at',
    endpoint: 'https://api.wheretheiss.at/v1/satellites/25544', ttlSec: 30,
    desc: '国际空间站实时位置（经纬度 / 高度 / 速度）',
    parse: (raw) => {
      const o = mustRecord(raw, '数据格式异常')
      const lat = mustNumber(o.latitude, '缺少纬度字段')
      const lon = mustNumber(o.longitude, '缺少经度字段')
      const alt = num(o.altitude)
      const vel = num(o.velocity)
      const items: ArdotItem[] = [
        { title: '纬度', value: `${lat.toFixed(3)}°` },
        { title: '经度', value: `${lon.toFixed(3)}°` },
      ]
      if (alt !== null) items.push({ title: '高度', value: `${alt.toFixed(1)} km` })
      if (vel !== null) items.push({ title: '速度', value: `${Math.round(vel).toLocaleString()} km/h` })
      return items
    },
  },
  {
    id: 'sun', label: '日出日落', emoji: '🌅', provider: 'Sunrise-Sunset.org · 北京',
    endpoint: 'https://api.sunrise-sunset.org/json?lat=39.9042&lng=116.4074&formatted=0', ttlSec: 3600,
    desc: '北京今日日出 / 日落 / 昼长（UTC 转本地时区）',
    parse: (raw) => {
      const r = mustRecord(mustRecord(raw, '数据格式异常').results, '缺少 results')
      const sunrise = localTime(r.sunrise)
      const sunset = localTime(r.sunset)
      if (!sunrise || !sunset) fail('缺少日出日落字段')
      const items: ArdotItem[] = [
        { title: '日出（本地时区）', value: sunrise },
        { title: '日落（本地时区）', value: sunset },
      ]
      if (typeof r.day_length === 'string' && r.day_length) items.push({ title: '昼长', value: r.day_length })
      return items
    },
  },
  {
    id: 'crypto', label: '加密货币行情', emoji: '₿', provider: 'Coinbase · BTC 基准',
    endpoint: 'https://api.coinbase.com/v2/exchange-rates?currency=BTC', ttlSec: 120,
    desc: 'Coinbase 公开牌价（BTC 对 USD / EUR / CNY 等）',
    parse: (raw) => {
      // Coinbase 的 rates 值是字符串数字 {"CNY":"123.45"}
      const rates = mustRecord(mustRecord(mustRecord(raw, '数据格式异常').data, '缺少 data').rates, '缺少 rates')
      const items: ArdotItem[] = []
      for (const k of ['USD', 'EUR', 'CNY', 'JPY', 'ETH']) {
        const rawValue = rates[k]
        const n = typeof rawValue === 'string' ? Number.parseFloat(rawValue) : NaN
        if (Number.isFinite(n)) {
          items.push({ title: `BTC → ${k}`, value: n.toLocaleString(undefined, { maximumFractionDigits: 2 }) })
        }
      }
      if (items.length === 0) fail('无有效牌价数据')
      return items
    },
  },
]

const DEF_MAP: Record<string, SourceDef> = {}
for (const d of SOURCE_DEFS) DEF_MAP[d.id] = d

type Phase = 'ok' | 'error' | 'pending'
const PHASE_TEXT: Record<Phase, string> = { ok: '正常', error: '异常', pending: '待采集' }

const emptyRuntime = (): SourceRuntime => ({ status: 'ok', items: [], message: '', fetchedAt: 0, stale: false, ms: 0 })

const phaseOf = (rt: SourceRuntime): Phase => (rt.fetchedAt === 0 ? 'pending' : rt.status)

/* ---------- 持久化 ---------- */

function defaultState(): ArdotState {
  const sources: Record<string, SourceRuntime> = {}
  for (const d of SOURCE_DEFS) sources[d.id] = emptyRuntime()
  return { sources, logs: [], cacheHits: 0, originFetches: 0 }
}

function parseRuntime(v: unknown): SourceRuntime | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (r.status !== 'ok' && r.status !== 'error') return null
  if (typeof r.fetchedAt !== 'number' || !Number.isFinite(r.fetchedAt)) return null
  const items = Array.isArray(r.items) ? r.items : []
  return {
    status: r.status,
    fetchedAt: r.fetchedAt,
    stale: r.stale === true,
    ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? r.ms : 0,
    message: typeof r.message === 'string' ? r.message : '',
    items: items
      .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
      .map((it) => ({ title: String(it.title ?? ''), value: String(it.value ?? '') }))
      .filter((it): it is ArdotItem => it.title !== '' && it.value !== ''),
  }
}

function parseLog(v: unknown): LogEntry | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.at !== 'number') return null
  if (r.result !== '成功' && r.result !== '失败' && r.result !== '拒绝') return null
  return {
    id: r.id,
    at: r.at,
    action: typeof r.action === 'string' ? r.action : '聚合读取',
    source: typeof r.source === 'string' ? r.source : '全部',
    result: r.result,
    detail: typeof r.detail === 'string' ? r.detail : '',
    ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? r.ms : 0,
  }
}

function parseState(raw: unknown): ArdotState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.cacheHits !== 'number' || typeof r.originFetches !== 'number') return null
  if (!Array.isArray(r.logs) || !r.sources || typeof r.sources !== 'object') return null
  const sources: Record<string, SourceRuntime> = {}
  for (const d of SOURCE_DEFS) {
    sources[d.id] = parseRuntime((r.sources as Record<string, unknown>)[d.id]) ?? emptyRuntime()
  }
  const logs: LogEntry[] = []
  for (const v of r.logs) {
    const l = parseLog(v)
    if (l) logs.push(l)
  }
  return { sources, logs: logs.slice(-ARDOT_LOG_MAX), cacheHits: r.cacheHits, originFetches: r.originFetches }
}

/** 带超时的真实 JSON 请求：超时或非 2xx 均抛错，交给调用方做陈旧回退 */
async function fetchJson(url: string): Promise<unknown> {
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), ARDOT_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    window.clearTimeout(timer)
  }
}

const LOG_FILTERS = ['全部', '成功', '失败', '拒绝'] as const

export function ArdotPage() {
  const toast = useToast()
  const [state, setState] = useState<ArdotState>(() => loadSnapshot(SCOPE, parseState, defaultState()))
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [probe, setProbe] = useState<{ at: number; ok: number; down: number } | null>(null)
  const [logFilter, setLogFilter] = useState<(typeof LOG_FILTERS)[number]>('全部')

  const stateRef = useRef(state)
  stateRef.current = state
  const mounted = useRef(true)

  useEffect(() => {
    saveSnapshot(SCOPE, state)
  }, [state])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const pushLog = (entry: Omit<LogEntry, 'id' | 'at'>): void => {
    setState((prev) => ({
      ...prev,
      logs: [...prev.logs, { id: uid('lg'), at: Date.now(), ...entry }].slice(-ARDOT_LOG_MAX),
    }))
  }

  /** 单源回源：失败时回退上一次真实数据并标记陈旧（不补任何假数值） */
  const fetchOne = async (def: SourceDef): Promise<SourceRuntime> => {
    const start = Date.now()
    try {
      const raw = await fetchJson(def.endpoint)
      const items = def.parse(raw)
      return { status: 'ok', items, message: '', fetchedAt: Date.now(), stale: false, ms: Date.now() - start }
    } catch (e) {
      const prev = stateRef.current.sources[def.id] ?? emptyRuntime()
      const reason = e instanceof Error ? e.message : '未知错误'
      return {
        status: 'error',
        items: prev.items,
        message: prev.items.length > 0 ? '回源失败，正在展示陈旧缓存' : `请求失败：${reason}`,
        fetchedAt: prev.fetchedAt,
        stale: prev.items.length > 0,
        ms: Date.now() - start,
      }
    }
  }

  const fetchAll = (fresh: boolean): void => {
    const now = Date.now()
    const hits: string[] = []
    const misses: string[] = []
    for (const d of SOURCE_DEFS) {
      const rt = stateRef.current.sources[d.id] ?? emptyRuntime()
      const need = fresh || rt.fetchedAt === 0 || now - rt.fetchedAt > d.ttlSec * 1000
      ;(need ? misses : hits).push(d.id)
    }
    if (hits.length > 0) setState((prev) => ({ ...prev, cacheHits: prev.cacheHits + hits.length }))
    if (misses.length === 0) {
      pushLog({ action: fresh ? '强制回源' : '聚合读取', source: '全部', result: '成功', detail: `${hits.length} 个源全部命中缓存`, ms: 0 })
      return
    }
    setBusy(Object.fromEntries(misses.map((id) => [id, true])))
    void Promise.all(misses.map((id) => fetchOne(DEF_MAP[id]!))).then((rts) => {
      if (!mounted.current) return
      let ok = 0
      setState((prev) => {
        const sources = { ...prev.sources }
        misses.forEach((id, i) => {
          sources[id] = rts[i]!
          if (rts[i]!.status === 'ok') ok += 1
        })
        return { ...prev, originFetches: prev.originFetches + misses.length, sources }
      })
      setBusy({})
      const failed = misses.length - ok
      pushLog({
        action: fresh ? '强制回源' : '聚合读取',
        source: '全部',
        result: failed > 0 ? '失败' : '成功',
        detail: `回源 ${misses.length} 源 · 命中缓存 ${hits.length} 源${failed > 0 ? ` · ${failed} 源异常` : ''}`,
        ms: Math.max(...rts.map((r) => r.ms)),
      })
      if (failed > 0) toast(`⚠ ${failed} 个数据源回源失败，已回退缓存`)
    })
  }

  const flushCache = (): void => {
    setState((prev) => {
      const sources: Record<string, SourceRuntime> = {}
      for (const d of SOURCE_DEFS) sources[d.id] = { ...(prev.sources[d.id] ?? emptyRuntime()), fetchedAt: 0, stale: false }
      return { ...prev, sources }
    })
    pushLog({ action: '清空缓存', source: '全部', result: '成功', detail: '已清除本地缓存，下次聚合将重新回源', ms: 0 })
    toast('已清除全部数据源缓存')
  }

  /** 健康探针：只读本地最近回源结果，不额外发请求，避免把探针变成压力源 */
  const runProbe = (): void => {
    const phases = SOURCE_DEFS.map((d) => phaseOf(stateRef.current.sources[d.id] ?? emptyRuntime()))
    const ok = phases.filter((p) => p === 'ok').length
    const down = phases.filter((p) => p === 'error').length
    setProbe({ at: Date.now(), ok, down })
    pushLog({
      action: '健康探针', source: '全部', result: down > 0 ? '失败' : '成功',
      detail: `正常 ${ok} · 异常 ${down}（基于各源最近一次真实回源结果）`, ms: 0,
    })
    toast(down > 0 ? `健康检查未通过：${down} 个源异常` : '健康检查通过：全部已采集源正常')
  }

  // 首屏主动聚合一次（TTL 未过期的源会直接命中本地上次真实结果）
  useEffect(() => {
    fetchAll(false)
  }, [])

  const anyBusy = Object.keys(busy).length > 0
  const runtimes = SOURCE_DEFS.map((d) => ({ def: d, rt: state.sources[d.id] ?? emptyRuntime() }))
  const errCount = runtimes.filter((x) => phaseOf(x.rt) === 'error').length
  const okCount = runtimes.filter((x) => phaseOf(x.rt) === 'ok').length
  const pendingCount = runtimes.filter((x) => phaseOf(x.rt) === 'pending').length
  const staleCount = runtimes.filter((x) => x.rt.stale).length
  const logs = state.logs.filter((l) => logFilter === '全部' || l.result === logFilter).slice(-9).reverse()

  return (
    <div className="page">
      <h1 className="page-title">🛰 多源聚合监控台</h1>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        正常 {okCount} · 异常 {errCount} · 待采集 {pendingCount} · 数据源为 {SOURCE_DEFS.length} 个真实公开 API（无密钥）
      </p>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" disabled={anyBusy} onClick={() => fetchAll(false)}>
          {anyBusy ? '聚合中…' : '⟳ 刷新数据'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={anyBusy} onClick={() => fetchAll(true)}>强制回源</button>
        <button className="btn btn-ghost btn-sm" disabled={anyBusy} onClick={flushCache}>🧹 清空缓存</button>
        <button className="btn btn-ghost btn-sm" disabled={anyBusy} onClick={runProbe}>💓 健康探针</button>
      </div>

      {errCount > 0 ? (
        <div className="card ardot-banner danger">
          ⚠ {errCount} 个数据源回源异常{staleCount > 0 ? ` · ${staleCount} 个源已回退陈旧缓存` : ' · 请检查网络或稍后重试'}
        </div>
      ) : null}
      {errCount === 0 && pendingCount > 0 && !anyBusy ? (
        <div className="card ardot-banner warn">⏳ {pendingCount} 个数据源待采集，点击「刷新数据」回源</div>
      ) : null}
      {probe ? (
        <div className="card ardot-banner ok">✔ 上次探针：正常 {probe.ok} / 异常 {probe.down} · {timeAgo(probe.at)}</div>
      ) : null}

      <div className="mall-goods-grid">
        {runtimes.map(({ def, rt }) => {
          const phase = phaseOf(rt)
          const loading = busy[def.id] === true
          const expired = rt.fetchedAt === 0 || Date.now() - rt.fetchedAt > def.ttlSec * 1000
          return (
            <div key={def.id} className={cx('card', 'mall-goods-card', phase === 'error' && 'ardot-err')}>
              <div className="row-between">
                <span style={{ fontSize: 24 }}>{def.emoji}</span>
                <Badge cls={phase === 'ok' ? 'done' : phase === 'error' ? 'unpaid' : 'closed'}>{PHASE_TEXT[phase]}</Badge>
              </div>
              <b>{def.label}</b>
              <small className="muted">{def.provider}</small>
              <p className="dim" style={{ margin: '4px 0 0', fontSize: 12 }}>{def.desc}</p>
              <div className="row wrap" style={{ marginTop: 6 }}>
                <span className="tag">{expired ? '缓存过期' : `缓存生效 · TTL ${def.ttlSec}s`}</span>
                {rt.stale ? <span className="tag">陈旧回退</span> : null}
              </div>

              {loading ? (
                <Skeleton rows={3} height={16} />
              ) : rt.items.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 12 }}>
                  {rt.items.map((it, i) => (
                    <li key={i} className="row-between">
                      <span className="muted">{it.title}</span>
                      <b>{it.value}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  {phase === 'error' ? '回源失败，暂无可用数据' : '缓存已清除，点击「刷新数据」回源'}
                </p>
              )}

              {!loading && rt.message ? <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>✕ {rt.message}（{rt.ms}ms）</p> : null}
              <small className="muted" style={{ fontSize: 12 }}>
                {rt.fetchedAt > 0 ? `更新于 ${timeAgo(rt.fetchedAt)}` : '尚未采集'}
              </small>
            </div>
          )
        })}
      </div>

      <div className="section-title">📋 审计日志（最近 {ARDOT_LOG_MAX} 条）</div>
      <div className="chip-row" style={{ marginBottom: 8 }}>
        {LOG_FILTERS.map((f) => (
          <button key={f} className={cx('chip', logFilter === f && 'active')} onClick={() => setLogFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      {logs.length === 0 ? (
        <p className="muted">暂无{logFilter === '全部' ? '' : logFilter}审计记录，聚合一次试试</p>
      ) : (
        logs.map((l) => (
          <div key={l.id} className="notif-row">
            <span className={cx('notif-icon', l.result === '成功' ? 'coze-ok' : 'coze-fail')}>{l.result === '成功' ? '✓' : '✗'}</span>
            <div className="notif-body">
              <p style={{ margin: 0 }}>
                {l.action} · {l.source}
                <Badge cls={l.result === '成功' ? 'done' : l.result === '失败' ? 'unpaid' : 'closed'}>{l.result}</Badge>
              </p>
              <small className="muted">
                {timeAgo(l.at)}{l.ms > 0 ? ` · ${l.ms}ms` : ''} · {l.detail}
              </small>
            </div>
          </div>
        ))
      )}

      <div className="section-title">📈 聚合概况</div>
      <div className="stat-row">
        <span><b>{SOURCE_DEFS.length} 个（{okCount} 正常）</b> 数据源</span>
        <span><b>{state.cacheHits} / {state.originFetches}</b> 缓存命中 / 回源次数</span>
        <span><b>{ARDOT_TIMEOUT_MS / 1000}s</b> 接口超时</span>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        回源失败时展示上一次真实数据并标记「陈旧回退」，从不编造数值。
      </p>
    </div>
  )
}
