/* 身份层：Supabase Auth 会话单一来源。
   - cloudEnabled（配置了 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）时监听 onAuthStateChange；
     挂载即回调 INITIAL_SESSION，天然避免与 getSession 的竞态，不要再另调 getSession。
   - 未配置或未登录：mode='local'，userId 恒为 'local'（钱包等真实身份数据以此隔离）。
   - userId（真实身份锚点）与 meId（扮演的演示身份，见 store.tsx）分离；
     轮 3+ 云端写路径时 userId 将作为作者锚点接入 RLS。 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, cloudEnabled } from './lib/supabase'
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
  signUp: (email: string, password: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthApi | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(LOCAL_AUTH)

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

  const api = useMemo<AuthApi>(
    () => ({
      auth,
      cloudEnabled,
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
      async signOut() {
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }),
    [auth],
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
