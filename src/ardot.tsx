import './ardot.css'
import { useEffect, useRef, useState } from 'react'
import { useToast } from './components'
import { cx, uid, timeAgo } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'

/* 多源聚合监控台：重实现自母本 ardot-audit（WordPress 项目004）的 saas-aggregator 聚合看板主链路——
   6 个微服务数据源（网关状态/业务核心/AI 洞察/决策分析/合规审计/电商商品）→ TTL 缓存与强制回源 →
   回源失败陈旧回退 + 健康探针（异常返回 503）→ 租户隔离缓存 → 审计日志与权限门禁。
   真实 HTTP / WordPress / 登录不在范围，全部会话内模拟；emoji 图标零图片依赖。 */

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
  layer: string
  endpoint: string
  method: 'GET' | 'POST'
  ttl: number
  baseLatency: number
  desc: string
  gen: () => ArdotItem[]
}

interface LogEntry {
  id: string
  at: number
  tenant: string
  source: string
  action: string
  result: '成功' | '失败' | '拒绝'
  detail: string
  ms: number
}

interface ArdotState {
  tenant: string
  sources: Record<string, SourceRuntime>
  logs: LogEntry[]
  cacheHits: number
  originFetches: number
}

const STORAGE_KEY = 'mim-ardot-v1'
const LOG_MAX = 40

const TENANTS = [
  { id: 't-fin', name: '租户 A · 金融', manage: true },
  { id: 't-retail', name: '租户 B · 零售', manage: true },
  { id: 'demo', name: '演示模式 · 只读', manage: false },
]

const rnd = (min: number, max: number) => Math.round(min + Math.random() * (max - min))

const emptyRuntime = (): SourceRuntime => ({ status: 'ok', items: [], message: '', fetchedAt: 0, stale: false, ms: 0 })

const SOURCE_DEFS: SourceDef[] = [
  {
    id: 'gateway_status', label: '网关状态', emoji: '🚦', layer: '接入层 · Go', method: 'GET',
    endpoint: 'gateway-go:8080/api/gateway/status', ttl: 120, baseLatency: 120,
    desc: '实时网关路由、限流与节点存活巡检',
    gen: () => [
      { title: 'P99 网关延迟', value: `${rnd(28, 52)} ms` },
      { title: '当前 QPS', value: `${(rnd(60, 99) / 10).toFixed(1)}k` },
      { title: '活跃路由', value: `${rnd(42, 58)} 条` },
      { title: '限流拦截（近 1 分钟）', value: `${rnd(0, 6)} 次` },
    ],
  },
  {
    id: 'business_core', label: '业务核心', emoji: '🧾', layer: '业务层 · Java', method: 'GET',
    endpoint: 'gateway-go:8080/api/orders', ttl: 300, baseLatency: 260,
    desc: '订单与支付主链路（Seata 分布式事务）',
    gen: () => [
      { title: '待发货订单', value: rnd(1100, 1500).toLocaleString() },
      { title: '支付成功率', value: `99.${rnd(0, 9)}%` },
      { title: 'TCC 事务（今日）', value: `成功 ${rnd(320, 380)} · 失败 0` },
      { title: '库存同步延迟', value: `${rnd(1, 4)} s` },
    ],
  },
  {
    id: 'ai_insights', label: 'AI 洞察', emoji: '🧠', layer: '智能层 · Python', method: 'POST',
    endpoint: 'ai-python:8000/api/ai/rag', ttl: 600, baseLatency: 420,
    desc: 'RAG 检索增强问答与引用溯源',
    gen: () => [
      { title: 'RAG 知识库命中', value: `${rnd(80, 94)}%` },
      { title: '今日生成摘要', value: `${rnd(120, 260)} 篇` },
      { title: '引用溯源覆盖率', value: '100%' },
      { title: '向量检索 P95', value: `${rnd(40, 90)} ms` },
    ],
  },
  {
    id: 'analytics', label: '决策分析', emoji: '📊', layer: '数据层 · 分析', method: 'GET',
    endpoint: 'ai-python:8000/api/analytics/dashboard', ttl: 900, baseLatency: 520,
    desc: 'ClickHouse 聚合指标与经营看板',
    gen: () => [
      { title: '日活跃用户', value: `${(rnd(110, 140) / 10).toFixed(1)}万` },
      { title: '下单转化率', value: `3.${rnd(0, 9)}%` },
      { title: '查询 P95', value: `${rnd(200, 600)} ms` },
      { title: '报表任务队列', value: `${rnd(2, 18)} 个` },
    ],
  },
  {
    id: 'compliance', label: '合规审计', emoji: '🛡️', layer: '合规层 · 审计', method: 'GET',
    endpoint: 'ai-python:8000/api/compliance/status', ttl: 600, baseLatency: 300,
    desc: '操作留痕、脱敏拦截与等保状态',
    gen: () => [
      { title: '操作审计覆盖率', value: '100%' },
      { title: '敏感字段脱敏拦截', value: `${rnd(3, 15)} 次` },
      { title: '租户越权尝试', value: '0 次' },
      { title: '等保 2.0 三级', value: '达标' },
    ],
  },
  {
    id: 'ecommerce', label: '电商商品', emoji: '🛒', layer: '电商层 · Node', method: 'GET',
    endpoint: 'node-api:3001/api/products', ttl: 180, baseLatency: 380,
    desc: 'BFF 商品与秒杀库存水位',
    gen: () => [
      { title: '在售商品', value: rnd(820, 960).toLocaleString() },
      { title: '今日 GMV', value: `¥${rnd(28, 52)} 万` },
      { title: '秒杀库存水位', value: `${rnd(30, 90)}%` },
      { title: 'BFF 接口错误率', value: `0.0${rnd(1, 9)}%` },
    ],
  },
]

const DEF_MAP: Record<string, SourceDef> = {}
SOURCE_DEFS.forEach((d) => { DEF_MAP[d.id] = d })

const LOG_FILTERS = ['全部', '成功', '失败', '拒绝'] as const
type LogFilter = (typeof LOG_FILTERS)[number]

const defaultState = (): ArdotState => {
  const sources: Record<string, SourceRuntime> = {}
  SOURCE_DEFS.forEach((d) => { sources[d.id] = emptyRuntime() })
  return { tenant: TENANTS[0].id, sources, logs: [], cacheHits: 0, originFetches: 0 }
}

function loadArdot(): ArdotState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as ArdotState
      if (
        p && typeof p.tenant === 'string' && TENANTS.some((t) => t.id === p.tenant) &&
        typeof p.cacheHits === 'number' && typeof p.originFetches === 'number' &&
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
        return { tenant: p.tenant, sources, logs, cacheHits: p.cacheHits, originFetches: p.originFetches }
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return defaultState()
}

type SrcPhase = 'ok' | 'error' | 'pending'
const srcPhase = (rt: SourceRuntime): SrcPhase => (rt.fetchedAt === 0 ? 'pending' : rt.status)

const PHASE_TEXT: Record<SrcPhase, string> = { ok: '正常', error: '异常', pending: '待采集' }

export function ArdotPage() {
  const toast = useToast()
  const [state, setState] = useState<ArdotState>(loadArdot)
  const [booting, setBooting] = useState(true)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [faults, setFaults] = useState<Record<string, boolean>>({})
  const [probe, setProbe] = useState<{ at: number; ok: number; down: number; ms: number } | null>(null)
  const [logFilter, setLogFilter] = useState<LogFilter>('全部')

  const stateRef = useRef(state)
  const faultsRef = useRef(faults)
  const timersRef = useRef<number[]>([])
  const failsRef = useRef(0)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => () => { timersRef.current.forEach((t) => window.clearTimeout(t)) }, [])

  const later = (fn: () => void, ms: number) => { timersRef.current.push(window.setTimeout(fn, ms)) }

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

  const pushLog = (entry: Omit<LogEntry, 'id' | 'at' | 'tenant'>) => {
    setState((prev) => ({
      ...prev,
      logs: [...prev.logs, { id: uid('lg'), at: Date.now(), tenant: prev.tenant, ...entry }].slice(-LOG_MAX),
    }))
  }

  /* 聚合读取：TTL 内命中缓存；强制回源或过期才发起（模拟）请求，失败保留旧数据 */
  const fetchAll = (fresh: boolean, snap?: ArdotState) => {
    const cur = snap ?? stateRef.current
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
    let maxLatency = 0
    misses.forEach((id) => {
      const def = DEF_MAP[id]
      const latency = def.baseLatency + rnd(0, 260)
      if (latency > maxLatency) maxLatency = latency
      later(() => {
        const fault = !!faultsRef.current[id]
        const prevRt = stateRef.current.sources[id] ?? emptyRuntime()
        const nextRt: SourceRuntime = fault
          ? {
              status: 'error',
              items: prevRt.items,
              message: prevRt.items.length ? '回源失败，正在展示陈旧缓存' : `请求失败：${def.endpoint} 无法连接`,
              fetchedAt: prevRt.fetchedAt,
              stale: prevRt.items.length > 0,
              ms: latency,
            }
          : { status: 'ok', items: def.gen(), message: '', fetchedAt: Date.now(), stale: false, ms: latency }
        failsRef.current += fault ? 1 : 0
        setState((prev) => ({
          ...prev,
          originFetches: prev.originFetches + 1,
          sources: { ...prev.sources, [id]: nextRt },
        }))
        setBusy((b) => { const n = { ...b }; delete n[id]; return n })
      }, latency)
    })
    later(() => {
      const failCount = failsRef.current
      failsRef.current = 0
      pushLog({
        action: fresh ? '强制回源' : '聚合读取',
        source: '全部',
        result: failCount ? '失败' : '成功',
        detail: `回源 ${misses.length} 源 · 命中缓存 ${hits.length} 源${failCount ? ` · ${failCount} 源异常` : ''}`,
        ms: maxLatency,
      })
      if (failCount) toast(`⚠ ${failCount} 个数据源回源失败，已回退缓存`)
    }, maxLatency + 30)
  }

  const flushCache = (id?: string) => {
    const cur = stateRef.current
    const target = id ? DEF_MAP[id].label : '全部'
    if (!TENANTS.find((t) => t.id === cur.tenant)?.manage) {
      toast('演示模式只读：清缓存需要管理权限')
      pushLog({ action: '清空缓存', source: target, result: '拒绝', detail: '权限不足（manage_options），访问门禁拦截', ms: 0 })
      return
    }
    setState((prev) => {
      const sources = { ...prev.sources }
      ;(id ? [id] : SOURCE_DEFS.map((d) => d.id)).forEach((k) => {
        sources[k] = { ...(sources[k] ?? emptyRuntime()), fetchedAt: 0, stale: false }
      })
      return { ...prev, sources }
    })
    pushLog({ action: '清空缓存', source: target, result: '成功', detail: '已清除 Transients 缓存，下次聚合将回源', ms: rnd(3, 12) })
    toast(id ? `已清除「${target}」缓存` : '已清除全部数据源缓存')
  }

  const runProbe = () => {
    const cur = stateRef.current
    const phases = SOURCE_DEFS.map((d) => srcPhase(cur.sources[d.id] ?? emptyRuntime()))
    const ok = phases.filter((s) => s === 'ok').length
    const down = phases.filter((s) => s === 'error').length
    const ms = rnd(6, 24)
    setProbe({ at: Date.now(), ok, down, ms })
    pushLog({
      action: '健康探针', source: '全部', result: down ? '失败' : '成功',
      detail: `正常 ${ok} · 异常 ${down}${down ? ' · 返回 503' : ' · 返回 200'}`, ms,
    })
    toast(down ? `健康检查未通过：${down} 个源异常` : '健康检查通过：全部源正常')
  }

  const switchTenant = (id: string) => {
    const cur = stateRef.current
    if (id === cur.tenant) return
    const tname = TENANTS.find((t) => t.id === id)?.name ?? id
    const sources: Record<string, SourceRuntime> = {}
    SOURCE_DEFS.forEach((d) => { sources[d.id] = emptyRuntime() })
    const next: ArdotState = { ...cur, tenant: id, sources }
    save(next)
    pushLog({ action: '切换租户', source: tname, result: '成功', detail: '缓存键按租户隔离，全部数据源重新回源', ms: 0 })
    fetchAll(true, next)
  }

  const toggleFault = (id: string) => {
    setFaults((f) => {
      const n = { ...f, [id]: !f[id] }
      faultsRef.current = n
      return n
    })
  }

  const reset = () => {
    if (!window.confirm('确定重置聚合看板演示数据吗？')) return
    const fresh = defaultState()
    save(fresh)
    setFaults(() => { faultsRef.current = {}; return {} })
    setProbe(null)
    setLogFilter('全部')
    fetchAll(true, fresh)
    toast('演示数据已重置')
  }

  /* 首屏：短暂加载态后执行首轮聚合 */
  useEffect(() => {
    later(() => { setBooting(false); fetchAll(false) }, 450)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 租户切换后自动回源（首挂载跳过） */
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    fetchAll(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tenant])

  const anyBusy = Object.keys(busy).length > 0
  const tenantInfo = TENANTS.find((t) => t.id === state.tenant) ?? TENANTS[0]
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
          正常 {okCount} · 异常 {errCount} · 租户 {tenantInfo.name.split(' · ')[0]}
        </p>

        <div className="ardot-toolbar">
          <div className="ardot-tenants">
            {TENANTS.map((t) => (
              <button
                key={t.id}
                className={cx('ardot-tenant', state.tenant === t.id && 'active')}
                disabled={booting || anyBusy}
                onClick={() => switchTenant(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="ardot-actions">
            <button className="btn btn-primary btn-sm" disabled={booting || anyBusy} onClick={() => fetchAll(false)}>
              {anyBusy ? '聚合中…' : '⟳ 刷新数据'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={booting || anyBusy} onClick={() => fetchAll(true)}>强制回源</button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={booting || anyBusy}
              title={tenantInfo.manage ? '清除全部数据源缓存' : '演示模式无管理权限'}
              onClick={() => flushCache()}
            >
              🧹 清空缓存
            </button>
            <button className="btn btn-ghost btn-sm" disabled={booting || anyBusy} onClick={runProbe}>💓 健康探针</button>
          </div>
        </div>

        {errCount > 0 && (
          <div className="ardot-banner danger">
            ⚠ {errCount} 个数据源异常，健康探针将返回 503{staleCount > 0 ? ` · ${staleCount} 个源已回退陈旧缓存` : ''}
          </div>
        )}
        {errCount === 0 && pendingCount > 0 && !booting && !anyBusy && (
          <div className="ardot-banner warn">⏳ {pendingCount} 个数据源待采集，点击「刷新数据」回源</div>
        )}
        {errCount === 0 && pendingCount === 0 && probe && (
          <div className="ardot-banner ok">
            ✔ 上次探针：正常 {probe.ok} / 异常 {probe.down} · {probe.ms}ms · {timeAgo(probe.at)}
          </div>
        )}

        {booting && <div className="ardot-banner warn ardot-pulse">⏳ 正在连接聚合服务 saas-aggregator/v1 …</div>}

        <div className="ardot-grid">
          {runtimes.map(({ def, rt }) => {
            const phase = srcPhase(rt)
            const loading = booting || !!busy[def.id]
            const cacheState = rt.fetchedAt === 0
              ? 'cleared'
              : Date.now() - rt.fetchedAt <= def.ttl * 1000 ? 'fresh' : 'expired'
            return (
              <div key={def.id} className={cx('ardot-src', phase === 'error' && 'err')}>
                <div className="ardot-src-top">
                  <span className="ardot-src-emoji">{def.emoji}</span>
                  <span className="ardot-src-title">
                    <b>{def.label}</b>
                    <small>{def.method} {def.endpoint}</small>
                  </span>
                  <span className={cx('ardot-badge', phase)}>{PHASE_TEXT[phase]}</span>
                </div>
                <p className="ardot-src-desc">{def.desc}</p>
                <p className="ardot-src-tags">
                  <span className="ardot-badge layer">{def.layer}</span>
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
                  <p className="ardot-srcremote">缓存已清除，点击「刷新数据」回源</p>
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
                    title="开启后该源回源必然失败，用于演示陈旧回退与健康降级"
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
          <div className="ardot-kpi"><span>当前租户</span><b>{tenantInfo.name}</b></div>
          <div className="ardot-kpi"><span>操作权限</span><b>{tenantInfo.manage ? '可管理' : '只读（无 manage_options）'}</b></div>
          <p className="muted" style={{ marginTop: 8 }}>缓存键含租户维度，切换租户即隔离重采；故障注入可演示错误隔离。</p>
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
                  <small className="muted">{timeAgo(l.at)} · {TENANTS.find((t) => t.id === l.tenant)?.name.split(' · ')[0] ?? l.tenant}{l.ms > 0 ? ` · ${l.ms}ms` : ''} · {l.detail}</small>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-ghost btn-sm" onClick={reset}>重置演示数据</button>
      </div>
    </div>
  )
}
