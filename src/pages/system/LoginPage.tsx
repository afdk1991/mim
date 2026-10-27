/* ==========================================================================
 * 登录 / 注册 —— 用户名 + 密码（非邮箱）
 *
 * 数据：data/session 的 signIn / signUp / signOut，底层走 /auth/*。
 * 坑：
 *  1. 登录态存在会话单例里，不是 React state —— 必须订阅 EVT.auth 才会重渲染。
 *  2. ?url= 回跳只接受站内路径（'/' 或 '#/' 开头），否则开放重定向会被钓鱼利用。
 *  3. 失败一律展示 Result.error.message（后端已按错误码映射中文），不在这里二次翻译。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { useRouter } from '../../app/router'
import { EVT, subscribe } from '../../core/events'
import { getSession, isSignedIn, signIn, signOut, signUp } from '../../data/session'
import type { Session } from '../../data/session'
import { Avatar, Tag, useToast } from '../../ui'

type Mode = 'signin' | 'signup'

const MIN_PASSWORD = 6
const HOME = '#/feed'

/** 回跳白名单：只放行站内路径，杜绝 ?url=https://evil.com 类开放重定向 */
function safeRedirect(raw: string | null): string {
  if (!raw) return HOME
  const target = raw.trim()
  if (target.startsWith('#/')) return target
  if (target.startsWith('/')) return `#${target}`
  return HOME
}

export function LoginPage() {
  const { query, navigate } = useRouter()
  const toast = useToast()
  const [session, setSession] = useState<Session>(getSession)
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribe(EVT.auth, () => setSession(getSession())), [])

  const signed = isSignedIn()

  async function submit(): Promise<void> {
    const name = username.trim()
    if (!name) {
      toast('请输入用户名')
      return
    }
    if (password.length < MIN_PASSWORD) {
      toast(`密码至少 ${MIN_PASSWORD} 位`)
      return
    }
    setBusy(true)
    const r = mode === 'signin' ? await signIn(name, password) : await signUp(name, password)
    setBusy(false)
    if (!r.ok) {
      toast(r.error.message)
      return
    }
    toast(mode === 'signin' ? '登录成功' : '注册成功')
    setPassword('')
    navigate(safeRedirect(query.get('url')))
  }

  async function onSignOut(): Promise<void> {
    setBusy(true)
    await signOut()
    setBusy(false)
    toast('已退出登录')
  }

  return (
    <div className="page page-grid single">
      <h1 className="page-title">{signed ? '我的账号' : mode === 'signin' ? '登录' : '注册'}</h1>

      {signed ? (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <Avatar emoji={session.emoji} color="var(--primary-weak)" size={48} />
            <div className="grow">
              <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                <b>{session.name}</b>
                {session.roles.map((r) => (
                  <Tag key={r}>{r}</Tag>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                @{session.username || '未设置用户名'}
              </div>
            </div>
          </div>
          <div className="stat-row" style={{ marginTop: 12 }}>
            <span>
              权限 <b>{session.permissions.length}</b>
            </span>
            <span>
              角色 <b>{session.roles.length}</b>
            </span>
          </div>
          {session.permissions.length > 0 ? (
            <div className="chip-row" style={{ marginTop: 10 }}>
              {session.permissions.map((p) => (
                <span key={p} className="tag">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              当前账号未被授予任何后台权限。
            </p>
          )}
          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            <a className="btn" href="#/settings">
              账号设置
            </a>
            <button className="btn btn-danger" onClick={() => void onSignOut()} disabled={busy}>
              {busy ? '处理中…' : '退出登录'}
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="tabs">
            <button
              className={mode === 'signin' ? 'tab-btn active' : 'tab-btn'}
              onClick={() => setMode('signin')}
            >
              登录
            </button>
            <button
              className={mode === 'signup' ? 'tab-btn active' : 'tab-btn'}
              onClick={() => setMode('signup')}
            >
              注册
            </button>
          </div>

          <div className="col" style={{ gap: 10 }}>
            <label className="form-field">
              <span className="form-label">用户名</span>
              <input
                className="input"
                value={username}
                autoComplete="username"
                placeholder="字母 / 数字，注册后不可随意更改"
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span className="form-label">密码（至少 {MIN_PASSWORD} 位）</span>
              <input
                className="input"
                type="password"
                value={password}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder="••••••"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="btn btn-primary btn-block" onClick={() => void submit()} disabled={busy}>
              {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册并登录'}
            </button>
          </div>

          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            账号由本站后端签发，密码经后端哈希存储。后端未部署或不可达时会直接提示原因，不会静默失败。
          </p>
        </div>
      )}
    </div>
  )
}
