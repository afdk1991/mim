/* 身份层：Supabase Auth 会话单一来源。
   - cloudEnabled（配置了 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）时监听 onAuthStateChange；
     挂载即回调 INITIAL_SESSION，天然避免与 getSession 的竞态，不要再另调 getSession。
   - 未配置或未登录：mode='local'，userId 恒为 'local'（钱包等真实身份数据以此隔离）。
   - userId（真实身份锚点）与 meId（扮演的演示身份，见 store.tsx）分离；
     轮 3+ 云端写路径时 userId 将作为作者锚点接入 RLS。
   - 第三方 OAuth：oauthProviders 从 GoTrue /auth/v1/settings 动态探测后台已启用的
     provider（Supabase 控制台开启哪个就显示哪个）；signInWithOAuth 走标准浏览器
     重定向流，回跳后 detectSessionInUrl 自动消费会话并触发 SIGNED_IN。 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, cloudEnabled, authSettingsUrl, anonKeyExport } from './lib/supabase'
import type { Provider } from '@supabase/supabase-js'
import type { AuthMode } from './permissions'

export type AuthState = {
  mode: AuthMode
  userId: string
  email: string | null
}

const LOCAL_AUTH: AuthState = { mode: 'local', userId: 'local', email: null }

export type AuthApi = {
  auth: AuthState
  cloudEnabled: boolean
  /** 后台已启用的第三方登录 provider id（未配置云端或探测失败时为 []） */
  oauthProviders: string[]
  signUp: (email: string, password: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
  signInWithOAuth: (provider: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthApi | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(LOCAL_AUTH)
  const [oauthProviders, setOauthProviders] = useState<string[]>([])

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(
        session?.user
          ? { mode: 'cloud', userId: session.user.id, email: session.user.email ?? null }
          : LOCAL_AUTH,
      )
    })
    return () => data.subscription.unsubscribe()
  }, [])

  /* 探测后台已启用的第三方登录 provider：GoTrue settings 端点公开列出全部
     支持平台及启用状态（external.<provider>.enabled），仅需公开 anon key。 */
  useEffect(() => {
    if (!supabase || !authSettingsUrl || !anonKeyExport) return
    const ctrl = new AbortController()
    fetch(authSettingsUrl, {
      headers: { apikey: anonKeyExport },
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        const ext = s?.external as Record<string, { enabled?: boolean }> | undefined
        if (!ext) return
        setOauthProviders(
          Object.entries(ext)
            .filter(([, v]) => v?.enabled === true)
            .map(([k]) => k),
        )
      })
      .catch(() => {}) // 探测失败按未启用处理，不影响邮箱登录
    return () => ctrl.abort()
  }, [])

  const api = useMemo<AuthApi>(
    () => ({
      auth,
      cloudEnabled,
      oauthProviders,
      async signUp(email, password) {
        if (!supabase) return '云端未配置，当前为本地演示模式'
        const { error } = await supabase.auth.signUp({ email, password })
        return error ? error.message : null
      },
      async signIn(email, password) {
        if (!supabase) return '云端未配置，当前为本地演示模式'
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? error.message : null
      },
      async signInWithOAuth(provider) {
        if (!supabase) return '云端未配置，当前为本地演示模式'
        const { error } = await supabase.auth.signInWithOAuth({
          provider: provider as Provider,
          options: { redirectTo: window.location.origin },
        })
        return error ? error.message : null
      },
      async signOut() {
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }),
    [auth, oauthProviders],
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
