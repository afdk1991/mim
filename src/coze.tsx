import { useEffect, useState } from 'react'
import { Empty, TimeAgo, useToast } from './components'
import { cx } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'

/* 智能体小程序面板：服务连接状态页。
   原实现用 fakeRequest 模拟 /api/health、/api/hello（假延迟、假欢迎语、假离线开关）。
   现改为真实检测：由用户填写后端服务地址，前端实际请求 {地址}/api/health 与 /api/hello，
   带超时与失败降级；未配置地址时展示空态与引导，不伪造任何检测结果。 */

interface HealthRecord { at: number; ok: boolean; latency: number }
interface CozeState { baseUrl: string; history: HealthRecord[] }

const STORAGE_KEY = 'mim-coze-v1'
const TIMEOUT_MS = 5000

type HealthStatus = 'idle' | 'loading' | 'online' | 'offline'

function loadCoze(): CozeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CozeState>
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.history) &&
        parsed.history.every(
          (h): h is HealthRecord =>
            !!h && typeof h === 'object' &&
            typeof h.at === 'number' && Number.isFinite(h.at) &&
            typeof h.ok === 'boolean' &&
            typeof h.latency === 'number' && Number.isFinite(h.latency),
        )
      ) {
        return { baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '', history: parsed.history.slice(0, 30) }
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return { baseUrl: '', history: [] }
}

/** 带超时的真实 fetch：超时或网络失败均 reject */
async function realFetch(url: string): Promise<string> {
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    window.clearTimeout(timer)
  }
}

export function CozePanelPage() {
  const toast = useToast()
  const [state, setState] = useState<CozeState>(loadCoze)
  const [draft, setDraft] = useState(state.baseUrl)
  const [status, setStatus] = useState<HealthStatus>('idle')
  const [bodyText, setBodyText] = useState('')

  const save = (next: CozeState) => {
    setState(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    pushToolState(STORAGE_KEY, next) // 云端整包快照（未登录/未配置时静默跳过）
  }

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 结构化重载（幂等触发上方保存回推） */
  useEffect(() => {
    void pullToolState(STORAGE_KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
      const next = loadCoze()
      setState(next)
      setDraft(next.baseUrl)
    })
  }, [])

  const runCheck = () => {
    const base = state.baseUrl.replace(/\/+$/, '')
    if (!base) {
      toast('请先填写后端服务地址')
      return
    }
    setStatus('loading')
    const start = Date.now()
    // 串行请求 health → hello，任一失败即判定连接失败
    realFetch(`${base}/api/health`)
      .then((t) => {
        setBodyText(t.slice(0, 200))
        return realFetch(`${base}/api/hello`)
      })
      .then((msg) => {
        setBodyText(msg.slice(0, 200))
        setStatus('online')
        save({
          ...state,
          history: [{ at: Date.now(), ok: true, latency: Date.now() - start }, ...state.history].slice(0, 30),
        })
        toast('服务正常 🟢')
      })
      .catch(() => {
        setStatus('offline')
        save({
          ...state,
          history: [{ at: Date.now(), ok: false, latency: Date.now() - start }, ...state.history].slice(0, 30),
        })
        toast(`连接失败 🔴（超时或接口不可用，上限 ${TIMEOUT_MS / 1000}s）`)
      })
  }

  const statusLabel = status === 'online' ? '服务正常' : status === 'offline' ? '连接失败' : status === 'loading' ? '检测中' : '待检测'
  const history = state.history
  const avgLatency = history.length
    ? Math.round(history.reduce((s, h) => s + h.latency, 0) / history.length)
    : 0

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🤖 智能体小程序</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          服务连接状态面板 · 实际请求后端 /api/health 与 /api/hello 检测可用性
        </p>

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="board-toolbar" style={{ marginBottom: 8 }}>
            <b>服务地址</b>
            <span className="muted">需允许跨域访问（CORS）</span>
          </div>
          <div className="manju-addform-row">
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
                const base = draft.trim().replace(/\/+$/, '')
                save({ ...state, baseUrl: base })
                toast('服务地址已保存')
              }}
            >
              保存
            </button>
          </div>
        </div>

        <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat-box">
            <b>{status === 'online' ? '🟢' : status === 'offline' ? '🔴' : status === 'loading' ? '🟡' : '⚪'}</b>
            <span>{statusLabel}</span>
          </div>
          <div className="stat-box">
            <b>{history[0] ? history[0].latency + ' ms' : '--'}</b>
            <span>最近耗时</span>
          </div>
          <div className="stat-box">
            <b>{avgLatency ? avgLatency + ' ms' : '--'}</b>
            <span>平均耗时（{history.length} 次）</span>
          </div>
        </div>

        <div className="board-toolbar" style={{ marginBottom: 12 }}>
          <b>检测控制</b>
          <div className="toolbar-actions">
            <button
              className="btn btn-sm btn-primary"
              disabled={status === 'loading' || !state.baseUrl}
              onClick={runCheck}
            >
              {status === 'loading' ? '检测中…' : '重新检测'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={history.length === 0}
              onClick={() => { save({ ...state, history: [] }) }}
            >
              清空历史
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="task-row">
            <span className="notif-icon">�</span>
            <div className="notif-body">
              <p>
                <span className="tag">接口返回</span>
                {status === 'loading' ? (
                  <span className="skel" style={{ width: 240 }} />
                ) : status === 'online' ? (
                  bodyText || '（空响应）'
                ) : status === 'offline' ? (
                  <span className="muted">暂时无法连接服务器，请检查地址或稍后重试</span>
                ) : (
                  <span className="muted">尚未检测；请先保存服务地址后点击「重新检测」</span>
                )}
              </p>
            </div>
          </div>
          <div className="task-row" style={{ borderBottom: 'none' }}>
            <span className="notif-icon">🔌</span>
            <div className="notif-body">
              <div className="coze-endpoint">
                <span className="coze-method">GET</span>
                <code className="bom-code">/api/health</code>
                <span className="muted">健康检查（服务端需实现）</span>
              </div>
              <div className="coze-endpoint">
                <span className="coze-method">GET</span>
                <code className="bom-code">/api/hello</code>
                <span className="muted">服务端欢迎语（服务端需实现）</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="board-toolbar" style={{ marginBottom: 4 }}>
            <b>检测历史</b>
            <span className="muted">最近 30 条</span>
          </div>
          {history.length === 0 && <Empty emoji="📡" text="还没有检测记录，配置服务地址后点击「重新检测」试试" />}
          {history.map((h, i) => (
            <div key={h.at + '-' + i} className="task-row">
              <span className={cx('notif-icon', h.ok ? 'coze-ok' : 'coze-fail')}>
                {h.ok ? '✓' : '✗'}
              </span>
              <div className="notif-body">
                <p>
                  {h.ok ? '服务正常' : '连接失败'}
                  <span className="muted"> · 耗时 {h.latency} ms</span>
                </p>
                <small>
                  <TimeAgo ts={h.at} />
                </small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
