/* 登录注册页（#/login）两态：
   1) 云端已登录 → 账号卡 + 退出登录；
   2) 云端未登录 → 登录 / 注册表单 + 第三方登录网格。
   （本地模式已移除，云端配置缺失时 main.tsx 直接渲染错误页。）
   第三方登录：oauthProviders（auth.tsx 探测后台已启用项）驱动——
   Supabase 控制台开启哪个 provider，这里就自动出现哪个按钮，零代码增删。
   身份模型见 auth.tsx：真实身份（userId，钱包/云端边界）即内容作者身份（登录后 meId = auth uuid）。 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useApp } from './store'
import { useAuth } from './auth'
import { useRouter } from './router'
import { cloudBackend } from './lib/supabase'
import { Avatar } from './components'
import { cx } from './utils'

/* 全量第三方平台注册表（Supabase Auth 原生支持的全部 provider）。
   mark=按钮上的单字标识，color=品牌色，dark=浅色底时用深色字。 */
const OAUTH_META: Record<string, { name: string; mark: string; color: string; dark?: boolean }> = {
  apple: { name: 'Apple', mark: '🍎', color: '#111111' },
  azure: { name: 'Microsoft', mark: 'M', color: '#00A4EF' },
  bitbucket: { name: 'Bitbucket', mark: 'B', color: '#0052CC' },
  discord: { name: 'Discord', mark: 'D', color: '#5865F2' },
  facebook: { name: 'Facebook', mark: 'f', color: '#1877F2' },
  figma: { name: 'Figma', mark: 'F', color: '#A259FF' },
  github: { name: 'GitHub', mark: 'GH', color: '#24292F' },
  gitlab: { name: 'GitLab', mark: 'G', color: '#FC6D26' },
  google: { name: 'Google', mark: 'G', color: '#4285F4' },
  kakao: { name: 'Kakao', mark: 'K', color: '#FEE500', dark: true },
  keycloak: { name: 'Keycloak', mark: 'K', color: '#008AAA' },
  linkedin_oidc: { name: 'LinkedIn', mark: 'in', color: '#0A66C2' },
  linkedin: { name: 'LinkedIn', mark: 'in', color: '#0A66C2' },
  notion: { name: 'Notion', mark: 'N', color: '#111111' },
  slack_oidc: { name: 'Slack', mark: '#', color: '#4A154B' },
  slack: { name: 'Slack', mark: '#', color: '#4A154B' },
  spotify: { name: 'Spotify', mark: '♫', color: '#1DB954' },
  twitch: { name: 'Twitch', mark: 'T', color: '#9146FF' },
  twitter: { name: 'X', mark: '𝕏', color: '#000000' },
  workos: { name: 'WorkOS', mark: 'W', color: '#6363F1' },
  zoom: { name: 'Zoom', mark: 'Z', color: '#2D8CFF' },
}

export function LoginPage() {
  const api = useApp()
  const { auth, oauthProviders, signIn, signUp, signInWithOAuth, signOut } = useAuth()
  const { navigate, query } = useRouter()
  /* 微博 newlogin 模式：?url= 携带来源页路径，登录成功后回跳；仅接受站内路径，防外链跳转 */
  const rawUrl = query.get('url') ?? ''
  const returnTo = rawUrl.startsWith('/') || rawUrl.startsWith('#/') ? rawUrl : ''
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [account, setAccount] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [oauthBusy, setOauthBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  if (auth.mode === 'cloud') {
    return (
      <div className="page-grid single">
        <div className="auth-wrap">
          <div className="card auth-card">
            <h2 className="page-title">✅ 已登录</h2>
            <div className="usermenu-head auth-head">
              <Avatar emoji={api.me.emoji} color={api.me.color} size={40} />
              <div>
                <b>{auth.username ?? auth.email ?? '云端账号'}</b>
                <small>云端账号 · {api.me.name}</small>
              </div>
            </div>
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
    if (busy || !account || !pwd) return
    setBusy(true)
    setErr(null)
    setOk(null)
    const r = tab === 'login' ? await signIn(account.trim(), pwd) : await signUp(account.trim(), pwd)
    setBusy(false)
    if (r) setErr(r)
    else if (tab === 'login') navigate(returnTo || '#/feed')
    else if (tab === 'register') setOk('注册成功，已自动登录')
  }

  /* 第三方登录：成功即整页跳转授权页，回跳后 onAuthStateChange 自动收会话 */
  async function oauth(provider: string) {
    if (oauthBusy) return
    setOauthBusy(provider)
    setErr(null)
    setOk(null)
    const r = await signInWithOAuth(provider)
    setOauthBusy(null)
    if (r) setErr(r)
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
              type="text"
              required
              placeholder="用户名"
              autoComplete="username"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
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
          <div className="auth-oauth">
            <div className="auth-oauth-title">第三方登录</div>
            {oauthProviders.length === 0 ? (
              <p className="auth-hint" style={{ margin: 0 }}>
                后台暂未启用第三方登录；在{' '}
                {cloudBackend === 'cloudbase'
                  ? 'CloudBase 控制台 → 身份认证 → 登录方式'
                  : 'Supabase 控制台 → Authentication → Providers'}{' '}
                中开启后，对应按钮会自动出现在这里。
              </p>
            ) : (
              <div className="auth-oauth-grid">
                {oauthProviders.map((p) => {
                  const m =
                    OAUTH_META[p] ??
                    { name: p, mark: p.charAt(0).toUpperCase(), color: 'var(--primary)' }
                  return (
                    <button
                      key={p}
                      type="button"
                      className="auth-oauth-btn"
                      disabled={oauthBusy !== null}
                      onClick={() => void oauth(p)}
                    >
                      <i
                        className="auth-oauth-ico"
                        style={{ background: m.color, color: m.dark ? '#111827' : '#fff' }}
                      >
                        {oauthBusy === p ? '…' : m.mark}
                      </i>
                      {m.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <p className="auth-hint" style={{ marginTop: 12 }}>
            登录后钱包与订单按云端账号隔离。
          </p>
        </div>
      </div>
    </div>
  )
}
