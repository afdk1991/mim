import { useEffect, useState } from 'react'
import { Empty, TimeAgo, useToast } from './components'
import { cx } from './utils'

/* 智能体小程序面板：重实现自母本 coze-miniprogram（Taro 4 小程序 + NestJS 服务端）
   的服务连接状态页。纯前端模拟 /api/health、/api/hello 两个接口（{status,data} 契约
   + 随机延迟 + 可控离线），保留母本三态（检测中/服务正常/连接失败）与「重新检测」
   交互，并追加检测历史与统计。 */

interface HealthRecord { at: number; ok: boolean; latency: number }
interface CozeState { offline: boolean; history: HealthRecord[] }

const STORAGE_KEY = 'mim-coze-v1'
const HELLO_MSG = 'Hello, welcome to coze coding mini-program server!'

type HealthStatus = 'loading' | 'online' | 'offline'

function loadCoze(): CozeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as CozeState
      if (parsed && typeof parsed.offline === 'boolean' && Array.isArray(parsed.history)) return parsed
    }
  } catch { /* 忽略损坏数据 */ }
  return { offline: false, history: [] }
}

/** 模拟 Network.request：统一域名前缀语义 + {status,data} 契约，离线时直接 reject */
function fakeRequest<T>(path: string, offline: boolean, data: T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (offline) reject(new Error('ECONNREFUSED ' + path))
      else resolve(data)
    }, 350 + Math.round(Math.random() * 300))
  })
}

const formatIso = (iso: string): string => {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function CozePanelPage() {
  const toast = useToast()
  const [state, setState] = useState<CozeState>(loadCoze)
  const [status, setStatus] = useState<HealthStatus>('loading')
  const [serverTime, setServerTime] = useState('--')
  const [greeting, setGreeting] = useState('')

  const save = (next: CozeState) => {
    setState(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const runCheck = () => {
    setStatus('loading')
    const start = Date.now()
    // 对齐母本：串行请求 health → hello
    fakeRequest<string>('/api/health', state.offline, new Date().toISOString())
      .then((iso) => {
        setServerTime(formatIso(iso))
        return fakeRequest<string>('/api/hello', state.offline, HELLO_MSG)
      })
      .then((msg) => {
        setGreeting(msg)
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
        toast('连接失败 🔴')
      })
  }

  // 对齐母本 useLoad：进入页面自动检测一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runCheck() }, [])

  const statusLabel = status === 'online' ? '服务正常' : status === 'offline' ? '连接失败' : '检测中'
  const history = state.history
  const avgLatency = history.length
    ? Math.round(history.reduce((s, h) => s + h.latency, 0) / history.length)
    : 0

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🤖 智能体小程序</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          服务连接状态面板 · 通过 /api/health 与 /api/hello 实时检测后端可用性
        </p>

        <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat-box">
            <b>{status === 'online' ? '🟢' : status === 'offline' ? '🔴' : '🟡'}</b>
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
              className="btn btn-sm"
              disabled={status === 'loading'}
              onClick={runCheck}
            >
              {status === 'loading' ? '检测中…' : '重新检测'}
            </button>
            <button
              className={cx('btn btn-sm', state.offline ? '' : 'btn-ghost')}
              title="模拟后端服务不可用（故障演练）"
              onClick={() => {
                const next = !state.offline
                save({ ...state, offline: next })
                toast(next ? '已开启模拟离线，下次检测将失败 🟠' : '已恢复模拟在线 🟢')
              }}
            >
              🟠 模拟离线：{state.offline ? '开' : '关'}
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
            <span className="notif-icon">🕐</span>
            <div className="notif-body">
              <p>
                <span className="tag">服务器时间</span>
                {status === 'loading' ? <span className="skel" style={{ width: 160 }} /> : serverTime}
              </p>
            </div>
          </div>
          <div className="task-row">
            <span className="notif-icon">💬</span>
            <div className="notif-body">
              <p>
                <span className="tag">服务消息</span>
                {status === 'loading' ? (
                  <span className="skel" style={{ width: 240 }} />
                ) : status === 'online' ? (
                  greeting
                ) : (
                  <span className="muted">暂时无法连接服务器，请稍后重试</span>
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
                <span className="muted">返回服务器时间（ISO 8601）</span>
              </div>
              <div className="coze-endpoint">
                <span className="coze-method">GET</span>
                <code className="bom-code">/api/hello</code>
                <span className="muted">返回服务端欢迎语</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="board-toolbar" style={{ marginBottom: 4 }}>
            <b>检测历史</b>
            <span className="muted">最近 30 条</span>
          </div>
          {history.length === 0 && <Empty emoji="📡" text="还没有检测记录，点击「重新检测」试试" />}
          {history.map((h, i) => (
            <div key={h.at + '-' + i} className="task-row">
              <span className={cx('notif-icon', h.ok ? 'coze-ok' : 'coze-fail')}>
                {h.ok ? '✓' : '✗'}
              </span>
              <div className="notif-body">
                <p>
                  {h.ok ? '服务正常' : '连接失败'}
                  <span className="muted"> · 耗时 {h.latency} ms · 状态码 {h.ok ? 200 : 502}</span>
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
