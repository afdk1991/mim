/* 云端客户端适配层（后端：CloudBase 腾讯云 · PostgreSQL 模式）。
   2026-10-23 迁移说明：本项目原以 Supabase 为后端，现接入 CloudBase 环境
   cs-1-d5g815slocb5a611a（ap-shanghai，RuntimeMode=postgresql）。

   之所以能平滑替换：CloudBase JS SDK v3 的 `app.rdb()` 是 postgREST 风格链式查询，
   与 Supabase 的 .from().select().eq().order().limit().insert().update().delete()
   方法名与参数形态一致；auth 模块同样是 Supabase-like（signInWithPassword / signUp /
   signOut / getSession / onAuthStateChange），因此上层 cloud-write / cloud-read /
   cloud-iam / cloud-msg / auth.tsx 的调用链保持原样。

   与 Supabase 的差异：
   · 初始化用 env + region + accessKey（Publishable Key），而非 url + anonKey；
   · auth.uid() 返回 text（JWT sub），故库表 owner 列一律 text，不再引用 auth.users；
   · 本环境仅启用 usernamePassword 登录（email / phone / anonymous 均关闭），
     登录注册改用用户名（见 auth.tsx / login.tsx）。

   未配置 env 或 accessKey 时为 null，应用整体回退纯本地模式（localStorage）。 */
import cloudbase from '@cloudbase/js-sdk'

/** 云端会话中的用户标识（CloudBase 的 uid 为 JWT sub，字符串） */
export interface CloudUser {
  id: string
  email?: string | null
  username?: string | null
  is_anonymous?: boolean
}

/** Realtime 通道形态（与 Supabase 的 channel().on().subscribe() 链式同形） */
export interface CloudChannel {
  on: (...args: any[]) => CloudChannel
  subscribe: (...args: any[]) => CloudChannel
  unsubscribe: () => void
}

/** 云端客户端：rdb 提供 postgREST 链式查询，auth 提供 Supabase-like 认证 */
export interface CloudClient {
  from: (table: string) => any
  rpc: (fn: string, params?: Record<string, unknown>) => any
  channel: (name: string) => CloudChannel
  removeChannel: (channel: CloudChannel) => void
  auth: {
    getSession: () => Promise<{
      data: { session: { user?: CloudUser | null } | null }
      error: { message: string } | null
    }>
    signUp: (params: { username?: string; email?: string; password: string }) => Promise<{
      data: { user?: CloudUser | null; session?: { user?: CloudUser | null } | null } | null
      error: { message: string } | null
    }>
    signInWithPassword: (params: {
      username?: string
      email?: string
      password: string
    }) => Promise<{
      data: { user?: CloudUser | null; session?: { user?: CloudUser | null } | null } | null
      error: { message: string } | null
    }>
    signInWithOAuth: (params: { provider: string; options?: Record<string, unknown> }) => Promise<{
      error: { message: string } | null
    }>
    signOut: () => Promise<{ error: { message: string } | null }>
    onAuthStateChange: (
      callback: (event: string, session: { user?: CloudUser | null } | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } }
  }
}

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID
const accessKey = import.meta.env.VITE_CLOUDBASE_ACCESS_KEY
const region = import.meta.env.VITE_CLOUDBASE_REGION ?? 'ap-shanghai'

/** Realtime 通道存根：CloudBase 未提供与 Supabase Realtime 同形的 channel/on/subscribe API，
    且本库未配置 CDC publication，故订阅降级为 no-op。私信的发送（send_message RPC）与
    拉取（读路径）均不受影响，仅「对方来信实时推送」退化为进入会话时拉取。 */
function makeNoopChannel(_name: string): CloudChannel {
  const ch: CloudChannel = {
    on: () => ch,
    subscribe: () => ch,
    unsubscribe: () => {},
  }
  return ch
}

function createCloudClient(): CloudClient {
  const app = (cloudbase as any).init({
    env: envId,
    region,
    accessKey,
    auth: { detectSessionInUrl: true },
  })
  const db = (app as any).rdb()
  return {
    from: (table: string) => db.from(table),
    rpc: (fn: string, params?: Record<string, unknown>) => db.rpc(fn, params),
    channel: (name: string) => makeNoopChannel(name),
    removeChannel: (_channel: CloudChannel) => {},
    auth: (app as any).auth,
  }
}

/**
 * 云端客户端：未配置 VITE_CLOUDBASE_ENV_ID / VITE_CLOUDBASE_ACCESS_KEY 时为 null，
 * 应用整体回退纯本地模式，保证无云端配置也能随时安全构建上线。
 */
export const supabase: CloudClient | null =
  envId && accessKey ? createCloudClient() : null

/** 是否已接入云端（true 时读路径/写路径走 CloudBase PG） */
export const cloudEnabled = supabase !== null

/* CloudBase 未提供 Supabase 的 /auth/v1/settings 公开端点，第三方登录探测改为静态空数组：
   本环境未启用任何 OAuth provider，仅用户名密码登录（见 auth.tsx 的 oauthProviders 使用处）。 */
export const authSettingsUrl: string | null = null

/** 匿名凭据导出（CloudBase 用 accessKey 初始化，无需在请求头单独携带，保持 null） */
export const anonKeyExport: string | null = null
