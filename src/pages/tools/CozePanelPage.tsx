/* ==========================================================================
 * 智能体小程序面板 —— 后端连通性检测
 *
 * 不伪造原则（重点）：
 *   - 检测结果来自真实请求 {base}/api/health 与 {base}/api/hello，
 *     任一失败即判定离线；未填写地址时只显示接入引导，绝不显示「在线」。
 *   - 旧实现用定时假延迟 + 假欢迎语模拟响应，这里整体删除。
 *
 * 数据落地：saveSnapshot('tools.coze')，历史保留 HEALTH_HISTORY_MAX 条。
 * ======================================================================== */

import { useEffect, useRef, useState } from 'react'
import { HEALTH_HISTORY_MAX, HEALTH_TIMEOUT_MS } from '@/domain/tools/model'
import type { CozeState, HealthRecord, HealthStatus } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { cx, timeAgo } from '@/core/utils'
import { Empty, Skeleton, useToast } from '@/ui'

const SCOPE = 'tools.coze'

const EMPTY_STATE: CozeState = { baseUrl: '', history: [] }

function parseRecord(v: unknown): HealthRecord | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  if (typeof r.ok !== 'boolean') return null
  if (typeof r.latency !== 'number' || !Number.isFinite(r.latency)) return null
  return { at: r.at, ok: r.ok, latency: r.latency }
}

function parseState(raw: unknown): CozeState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const list = Array.isArray(r.history) ? r.history : []
  const history: HealthRecord[] = []
  for (const v of list) {
    const rec = parseRecord(v)
    if (rec) history.push(rec)
  }
  return {
    baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : '',
    history: history.slice(0, HEALTH_HISTORY_MAX),
  }
}

/** 带超时的真实请求：超时/非 2xx 一律抛错，由调用方判定离线 */
async function probeFetch(url: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    window.clearTimeout(timer)
  }
}

const STATUS_TEXT: Record<HealthStatus, string> = {
  idle: '待检测',
  loading: '检测中',
  online: '服务正常',
  offline: '连接失败',
}

const STATUS_ICON: Record<HealthStatus, string> = {
  idle: '⚪',
  loading: '🟡',
  online: '🟢',
  offline: '🔴',
}

export function CozePanelPage() {
  const toast = useToast()
  const [state, setState] = useState<CozeState>(() => loadSnapshot(SCOPE, parseState, EMPTY_STATE))
  const [draft, setDraft] = useState<string>(() => state.baseUrl)
  const [status, setStatus] = useState<HealthStatus>('idle')
  const [body, setBody] = useState('')
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

  const save = (next: CozeState): void => setState(next)

  const storeResult = (ok: boolean, latency: number): void => {
    setState((prev) => ({
      ...prev,
      history: [{ at: Date.now(), ok, latency }, ...prev.history].slice(0, HEALTH_HISTORY_MAX),
    }))
  }

  const runCheck = (): void => {
    const base = state.baseUrl.replace(/\/+$/, '')
    if (!base) {
      toast('请先填写后端服务地址')
      return
    }
    setStatus('loading')
    setBody('')
    const start = Date.now()
    // 串行探测：health 先通，再验证 hello；任一环节失败即判定离线
    void probeFetch(`${base}/api/health`, HEALTH_TIMEOUT_MS)
      .then((t) => {
        setBody(t.slice(0, 200))
        return probeFetch(`${base}/api/hello`, HEALTH_TIMEOUT_MS)
      })
      .then((msg) => {
        if (!mounted.current) return
        setBody(msg.slice(0, 200))
        setStatus('online')
        storeResult(true, Date.now() - start)
        toast('服务正常')
      })
      .catch((e: unknown) => {
        if (!mounted.current) return
        setBody('')
        setStatus('offline')
        storeResult(false, Date.now() - start)
        toast(`连接失败（${HEALTH_TIMEOUT_MS / 1000}s 超时或接口不可用）：${e instanceof Error ? e.message : '未知错误'}`)
      })
  }

  const history = state.history
  const avg = history.length > 0 ? Math.round(history.reduce((s, h) => s + h.latency, 0) / history.length) : 0

  return (
    <div className="page">
      <h1 className="page-title">🤖 智能体小程序</h1>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        服务连接状态面板 · 实际请求后端 /api/health 与 /api/hello 检测可用性（上限 {HEALTH_TIMEOUT_MS / 1000}s）
      </p>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <b>服务地址</b>
          <span className="muted" style={{ fontSize: 12 }}>服务端需允许跨域访问（CORS）</span>
        </div>
        <div className="row">
          <input
            className="input"
            placeholder="如：https://your-server.example.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={!draft.trim() || draft.trim() === state.baseUrl}
            onClick={() => {
              save({ ...state, baseUrl: draft.trim().replace(/\/+$/, '') })
              setStatus('idle')
              toast('服务地址已保存')
            }}
          >
            保存
          </button>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 12 }}>
        <span>
          <b>{STATUS_ICON[status]}</b> {STATUS_TEXT[status]}
        </span>
        <span>
          <b>{history[0] ? `${history[0].latency} ms` : '--'}</b> 最近耗时
        </span>
        <span>
          <b>{avg > 0 ? `${avg} ms` : '--'}</b> 平均耗时（{history.length} 次）
        </span>
      </div>

      {!state.baseUrl ? (
        <Empty emoji="🔌" text="尚未配置后端服务地址：填写上方地址并保存后，即可发起真实连通性检测" />
      ) : (
        <>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <button className="btn btn-primary btn-sm" disabled={status === 'loading'} onClick={runCheck}>
              {status === 'loading' ? '检测中…' : '重新检测'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={history.length === 0} onClick={() => save({ ...state, history: [] })}>
              清空历史
            </button>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="notif-row">
              <span className="notif-icon">📡</span>
              <div className="notif-body">
                <p style={{ margin: 0 }}>
                  <span className="tag">接口返回</span>{' '}
                  {status === 'loading' ? (
                    <Skeleton rows={1} height={20} />
                  ) : status === 'online' ? (
                    body || '（空响应）'
                  ) : status === 'offline' ? (
                    <span className="muted">暂时无法连接服务器，请检查地址或稍后重试</span>
                  ) : (
                    <span className="muted">尚未检测，点击「重新检测」发起真实请求</span>
                  )}
                </p>
              </div>
            </div>
            <div className="notif-row" style={{ borderBottom: 'none' }}>
              <span className="notif-icon">🔌</span>
              <div className="notif-body">
                <div className="row">
                  <span className="tag">GET</span>
                  <code>{state.baseUrl.replace(/\/+$/, '')}/api/health</code>
                </div>
                <div className="row" style={{ marginTop: 4 }}>
                  <span className="tag">GET</span>
                  <code>{state.baseUrl.replace(/\/+$/, '')}/api/hello</code>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="row-between" style={{ marginBottom: 4 }}>
              <b>检测历史</b>
              <span className="muted" style={{ fontSize: 12 }}>最近 {HEALTH_HISTORY_MAX} 条</span>
            </div>
            {history.length === 0 ? (
              <Empty emoji="📡" text="还没有检测记录，点击「重新检测」试试" />
            ) : (
              history.map((h, i) => (
                <div key={`${h.at}-${i}`} className="notif-row">
                  <span className={cx('notif-icon', h.ok ? 'coze-ok' : 'coze-fail')}>{h.ok ? '✓' : '✗'}</span>
                  <div className="notif-body">
                    <p style={{ margin: 0 }}>
                      {h.ok ? '服务正常' : '连接失败'}
                      <span className="muted"> · 耗时 {h.latency} ms</span>
                    </p>
                    <small className="muted">{timeAgo(h.at)}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
