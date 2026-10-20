/* 登录注册页（#/login）三态：
   1) 云端未配置 → 本地演示模式说明 + 演示身份切换；
   2) 云端已配置且已登录 → 账号卡 + 退出登录；
   3) 云端已配置且未登录 → 登录 / 注册表单。
   身份模型见 auth.tsx：真实身份（userId，钱包/云端边界）与演示身份（meId，内容作者视角）分离。 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useApp } from './store'
import { useAuth } from './auth'
import { Avatar } from './components'
import { cx } from './utils'

/* 演示身份切换网格：切换只影响「扮演谁发内容」，不影响钱包（绑真实身份） */
function DemoUsers() {
  const api = useApp()
  return (
    <div className="auth-users">
      {Object.values(api.state.users).map((u) => (
        <button
          key={u.id}
          className={cx('auth-user', u.id === api.state.meId && 'active')}
          onClick={() => api.switchDemoUser(u.id)}
        >
          <Avatar emoji={u.emoji} color={u.color} size={22} />
          {u.name}
        </button>
      ))}
    </div>
  )
}

export function LoginPage() {
  const api = useApp()
  const { auth, cloudEnabled, signIn, signUp, signOut } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  if (!cloudEnabled) {
    return (
      <div className="page-grid single">
        <div className="auth-wrap">
          <div className="card auth-card">
            <h2 className="page-title">🔐 账号与身份</h2>
            <p className="auth-hint">
              当前为<b>本地演示模式</b>：内容与钱包数据仅保存在本机浏览器，不会上传。配置 Supabase
              后即可注册登录，由云端按账号隔离数据边界。
            </p>
            <div className="usermenu-sec auth-sec">切换演示身份（影响内容的作者视角）</div>
            <DemoUsers />
          </div>
        </div>
      </div>
    )
  }

  if (auth.mode === 'cloud') {
    return (
      <div className="page-grid single">
        <div className="auth-wrap">
          <div className="card auth-card">
            <h2 className="page-title">✅ 已登录</h2>
            <div className="usermenu-head auth-head">
              <Avatar emoji={api.me.emoji} color={api.me.color} size={40} />
              <div>
                <b>{auth.email ?? '云端账号'}</b>
                <small>云端账号 · 演示身份：{api.me.name}</small>
              </div>
            </div>
            <div className="usermenu-sec auth-sec">切换演示身份</div>
            <DemoUsers />
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 14 }}
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void signOut().finally(() => setBusy(false))
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !email || !pwd) return
    setBusy(true)
    setErr(null)
    setOk(null)
    const r = tab === 'login' ? await signIn(email.trim(), pwd) : await signUp(email.trim(), pwd)
    setBusy(false)
    if (r) setErr(r)
    else if (tab === 'register') setOk('注册成功。如未自动登录，请先到邮箱完成确认后再登录')
  }

  return (
    <div className="page-grid single">
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-tabs">
            <button
              className={cx('auth-tab', tab === 'login' && 'active')}
              onClick={() => {
                setTab('login')
                setErr(null)
                setOk(null)
              }}
            >
              登录
            </button>
            <button
              className={cx('auth-tab', tab === 'register' && 'active')}
              onClick={() => {
                setTab('register')
                setErr(null)
                setOk(null)
              }}
            >
              注册
            </button>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <input
              type="email"
              required
              placeholder="邮箱"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="密码（至少 6 位）"
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
            {err && <p className="auth-err">{err}</p>}
            {ok && <p className="auth-ok">{ok}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? '请稍候…' : tab === 'login' ? '登录' : '注册'}
            </button>
          </form>
          <p className="auth-hint" style={{ marginTop: 12 }}>
            登录后钱包与订单按云端账号隔离；演示身份切换仍在本机生效。
          </p>
        </div>
      </div>
    </div>
  )
}
