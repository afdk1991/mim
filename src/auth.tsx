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
import { supabase, cloudEnabled, cloudBackend, authSettingsUrl, anonKeyExport } from './lib/supabase'
import type { AuthMode } from './permissions'

export type AuthState = {
  mode: AuthMode
  userId: string
  email: string | null
  /** 用户名（CloudBase 本环境仅启用 usernamePassword 登录，email 可能为 null） */
  username: string | null
  /** RBAC：当前账号的角色名列表（未登录/本地模式恒为 []） */
  roles: string[]
  /** RBAC：当前账号的权限 key 列表（未登录/本地模式恒为 []） */
  permissions: string[]
}

const LOCAL_AUTH: AuthState = {
  mode: 'local',
  userId: 'local',
  email: null,
  username: null,
  roles: [],
  permissions: [],
}

/* ---------- IAM（Phase1 L1）：登录后从 user_roles + role_permissions 拉取 RBAC ----------
   roles/permissions/role_permissions 三表对登录用户可读（参考数据），
   user_roles 仅本人可读（RLS 已限定），所以这里直接两查即可，无需 RPC。 */
async function loadIam(userId: string): Promise<{ roles: string[]; permissions: string[] }> {
  if (!supabase) return { roles: [], permissions: [] }
  const { data: urs } = await supabase
    .from('user_roles')
    .select('role_id, roles(name)')
    .eq('user_id', userId)
  const rows = (urs ?? []) as unknown as { role_id: string; roles: { name: string } | null }[]
  const roles = rows.map((r) => r.roles?.name).filter((n): n is string => !!n)
  const roleIds = rows.map((r) => r.role_id)
  if (roleIds.length === 0) return { roles, permissions: [] }
  const { data: rps } = await supabase
    .from('role_permissions')
    .select('permissions(key)')
    .in('role_id', roleIds)
  const perms = ((rps ?? []) as unknown as { permissions: { key: string } | null }[])
    .map((r) => r.permissions?.key)
    .filter((k): k is string => !!k)
  return { roles, permissions: Array.from(new Set(perms)) }
}

/* ---------- 模块级身份单例（轮 16 打通：非 hook 场景）----------
   wallet/vip 等模块级 API 与 localStorage 读写无法使用 useAuth，
   这里维护一份与 AuthProvider 实时同步的当前真实身份锚点。 */
let currentUserId = LOCAL_AUTH.userId

/** 非 hook 场景获取当前真实身份（未登录恒为 'local'，登录后为云端 user.id） */
export function getCurrentUserId(): string {
  return currentUserId
}

export type AuthApi = {
  auth: AuthState
  cloudEnabled: boolean
  /** 后台已启用的第三方登录 provider id（未配置云端或探测失败时为 []） */
  oauthProviders: string[]
  signUp: (username: string, password: string) => Promise<string | null>
  signIn: (username: string, password: string) => Promise<string | null>
  signInWithOAuth: (provider: string) => Promise<string | null>
  signOut: () => Promise<void>
  /** RBAC：是否拥有指定角色（未登录/本地模式恒 false） */
  hasRole: (role: string) => boolean
  /** RBAC：是否拥有指定权限点（菜单+按钮级，未登录/本地模式恒 false） */
  hasPerm: (perm: string) => boolean
}

const AuthContext = createContext<AuthApi | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(LOCAL_AUTH)
  const [oauthProviders, setOauthProviders] = useState<string[]>([])

  /* 轮 16 打通：同步模块级身份单例（getCurrentUserId 的数据源） */
  useEffect(() => {
    currentUserId = auth.userId
  }, [auth.userId])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      if (!u) {
        setAuth(LOCAL_AUTH)
        return
      }
      setAuth({
        mode: 'cloud',
        userId: u.id,
        email: u.email ?? null,
        username: u.username ?? u.email ?? null,
        roles: [],
        permissions: [],
      })
      /* RBAC 异步拉取；alive + userId 双重守卫防会话切换期间旧请求回写 */
      loadIam(u.id)
        .then((iam) => {
          if (!alive) return
          setAuth((prev) => (prev.userId === u.id ? { ...prev, ...iam } : prev))
        })
        .catch(() => {}) // RBAC 拉取失败按无权限处理，不影响登录态
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  /* 探测后台已启用的第三方登录 provider：GoTrue settings 端点公开列出全部
     支持平台及启用状态（external.<provider> 为布尔值），仅需公开 anon key。 */
  useEffect(() => {
    if (!supabase || !authSettingsUrl || !anonKeyExport) return
    const ctrl = new AbortController()
    fetch(authSettingsUrl, {
      headers: { apikey: anonKeyExport },
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        const ext = s?.external as Record<string, boolean | { enabled?: boolean }> | undefined
        if (!ext) return
        setOauthProviders(
          Object.entries(ext)
            // 端点实际返回 provider → boolean（如 "github": true），兼容对象形态
            .filter(([, v]) => (typeof v === 'boolean' ? v : v?.enabled === true))
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
      /* 注册与登录统一走「用户名」：
         · Supabase 模式：用户名映射为合成邮箱 <username>@mim.app（适配层内转换），
           注册成功即自动登录（mailer_autoconfirm 已开启），档案由 auth.users
           触发器自动创建，无需应用层补写。
         · CloudBase 模式：仅启用 usernamePassword（email / phone / anonymous 均关闭），
           注册成功后由应用层补写 profiles（无 auth.users 触发器）。 */
      async signUp(username, password) {
        if (!supabase) return '云端未配置，当前为本地演示模式'
        const { data, error } = await supabase.auth.signUp({ username, password })
        if (error) return error.message
        const uid = data?.user?.id ?? data?.session?.user?.id
        /* 建档策略：
           · Supabase 模式：auth.users 触发器 on_auth_user_created 已自动建档
             （name 取自注册时传入的 user_metadata）；且 profiles 未建 insert 策略，
             upsert 会被 RLS 拒为 403 —— 故跳过，避免无谓的失败请求。
           · CloudBase 模式：无 auth.users 触发器，保留 upsert 兜底建档。 */
        if (uid && cloudBackend !== 'supabase') {
          try {
            await supabase.from('profiles').upsert({ id: uid, name: username })
          } catch {
            /* 建档失败不阻塞注册：若注册需验证而未拿到会话，RLS 会拒绝写入，登录后再补 */
          }
        }
        return null
      },
      async signIn(username, password) {
        if (!supabase) return '云端未配置，当前为本地演示模式'
        const { error } = await supabase.auth.signInWithPassword({ username, password })
        return error ? error.message : null
      },
      async signInWithOAuth(provider) {
        if (!supabase) return '云端未配置，当前为本地演示模式'
        // origin + pathname：子路径部署下回跳必须落在应用自身路径；hash 路由下 pathname 恒定。
        // 本环境未启用 OAuth provider，保留入口以便后台开启后自动可用。
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: window.location.origin + window.location.pathname },
        })
        return error ? error.message : null
      },
      async signOut() {
        if (!supabase) return
        await supabase.auth.signOut()
      },
      hasRole: (role) => auth.roles.includes(role),
      hasPerm: (perm) => auth.permissions.includes(perm),
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

/** RBAC 按钮级守卫 hook：当前账号是否拥有指定权限点（未登录/本地模式恒 false） */
export function usePermission(perm: string): boolean {
  return useAuth().hasPerm(perm)
}

/** RBAC 角色守卫 hook：当前账号是否拥有指定角色 */
export function useRole(role: string): boolean {
  return useAuth().hasRole(role)
}
