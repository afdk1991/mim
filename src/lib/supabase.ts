/* 云端客户端适配层（后端：CloudBase 云函数 mim-api → CloudBase PostgreSQL）。

   2026-10-23 架构说明（为什么要绕一圈）：
   1) CloudBase 不允许「用户名 + 密码」自助注册（/auth/v1/signup 恒返回 501，
      即使使用 service_role Key 也一样），邮箱与自定义登录 provider 均无法启用，
      因此账号体系改为自建：mim-api 持有 service_role Key，在服务端完成
      注册（PBKDF2 密码哈希）与登录（HMAC 签名令牌）。
   2) CloudBase 网关 CORS 只放行安全域名白名单，而体验版套餐不允许添加域名，
      导致 GitHub Pages / EdgeOne Pages 等线上域名一律 403。mim-api 自行回写
      Access-Control-Allow-Origin: *，使任意部署域名都能访问云端。

   由于 service_role 会绕过数据库 RLS，权限由 mim-api 强制注入：
   读私有表自动追加 owner 过滤，写入自动改写 owner 列为当前 uid，
   改删自动按 owner 过滤，app_users / audit_logs 永不代理。

   本文件把上述 HTTP 接口包装成与 Supabase 同形的链式查询，
   使 cloud-read / cloud-write / cloud-iam / cloud-msg / auth.tsx 无需改动。

   未配置 VITE_MIM_API_BASE 时为 null，应用整体回退纯本地模式（localStorage）。 */

/** 云端会话中的用户标识 */
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

/** 生产云端后端（CloudBase 云函数 mim-api）的固定入口。

    为何内置兜底：EdgeOne Makers 走 .edgeone 目录自动构建，构建环境读不到
    仓库环境变量（CI 日志：`No environment variables found`），若仅依赖
    VITE_MIM_API_BASE 会导致线上产物缺失云端地址、回退本地演示模式。
    该地址是公开 HTTP 端点（不含任何密钥，权限由云函数服务端强制校验），
    因此内置安全；需要用自建后端时仍可用 VITE_MIM_API_BASE 覆盖。 */
const PROD_API_BASE = 'https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mim-api'

const API_BASE = ((import.meta.env.VITE_MIM_API_BASE ?? '').trim() || PROD_API_BASE).replace(/\/+$/, '')

const TOKEN_KEY = 'mim.cloud.token'
const USER_KEY = 'mim.cloud.user'

function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function setSession(token: string, user: CloudUser) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* 隐私模式下 localStorage 不可用：降级为仅内存态，刷新后需重新登录 */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    /* 忽略 */
  }
}

function readUser(): CloudUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw)
    return u && typeof u.id === 'string' ? (u as CloudUser) : null
  } catch {
    return null
  }
}

type QueryResult = { data: any; error: { message: string } | null }

/** postgREST 值转义：点/逗号/括号等在 postgREST 语法里有含义，非数字需加引号 */
function encodeFilterValue(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  return encodeURIComponent(s)
}

/**
 * 与 Supabase 同形的查询构建器：链式收集条件，await 时发起请求。
 * 实现 PromiseLike 以便直接 `await supabase.from('posts').select()`。
 */
class QueryBuilder implements PromiseLike<QueryResult> {
  private table: string
  private method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET'
  private params: string[] = []
  private body: unknown = undefined
  private prefer: string[] = []
  private singleMode: 'none' | 'single' | 'maybeSingle' = 'none'

  constructor(table: string) {
    this.table = table
  }

  select(cols = '*') {
    this.params.push(`select=${encodeURIComponent(cols)}`)
    // 写操作后的 select 表示需要返回变更后的行
    if (this.method !== 'GET') this.prefer.push('return=representation')
    return this
  }

  insert(rows: unknown) {
    this.method = 'POST'
    this.body = rows
    return this
  }

  upsert(rows: unknown) {
    this.method = 'POST'
    this.body = rows
    this.prefer.push('return=representation', 'resolution=merge-duplicates')
    return this
  }

  update(patch: unknown) {
    this.method = 'PATCH'
    this.body = patch
    this.prefer.push('return=representation')
    return this
  }

  delete() {
    this.method = 'DELETE'
    this.prefer.push('return=representation')
    return this
  }

  eq(col: string, value: unknown) {
    this.params.push(`${encodeURIComponent(col)}=eq.${encodeFilterValue(value)}`)
    return this
  }

  neq(col: string, value: unknown) {
    this.params.push(`${encodeURIComponent(col)}=neq.${encodeFilterValue(value)}`)
    return this
  }

  in(col: string, values: unknown[]) {
    this.params.push(`${encodeURIComponent(col)}=in.(${values.map(encodeFilterValue).join(',')})`)
    return this
  }

  /** 数组列包含：postgREST 的 cs 操作符，如 tags=cs.{前端} */
  contains(col: string, values: unknown) {
    const list = Array.isArray(values) ? values : [values]
    this.params.push(`${encodeURIComponent(col)}=cs.{${list.map(encodeFilterValue).join(',')}}`)
    return this
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.params.push(`order=${encodeURIComponent(col)}.${opts?.ascending === false ? 'desc' : 'asc'}`)
    return this
  }

  limit(n: number) {
    this.params.push(`limit=${n}`)
    return this
  }

  single() {
    this.singleMode = 'single'
    return this
  }

  maybeSingle() {
    this.singleMode = 'maybeSingle'
    return this
  }

  async execute(): Promise<QueryResult> {
    const qs = this.params.join('&')
    const url = `${API_BASE}/db/rest/${encodeURIComponent(this.table)}${qs ? `?${qs}` : ''}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) headers['x-mim-token'] = token
    if (this.prefer.length) headers['Prefer'] = this.prefer.join(',')

    try {
      const res = await fetch(url, {
        method: this.method,
        headers,
        body: this.body === undefined ? undefined : JSON.stringify(this.body),
      })
      const text = await res.text()
      let payload: any = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = text
      }

      if (res.status >= 400) {
        const msg =
          (payload && typeof payload === 'object' && (payload.message || payload.error || payload.error_description)) ||
          `云端请求失败（HTTP ${res.status}）`
        return { data: null, error: { message: String(msg) } }
      }

      if (this.singleMode === 'maybeSingle') {
        return { data: Array.isArray(payload) ? (payload[0] ?? null) : payload, error: null }
      }
      if (this.singleMode === 'single') {
        if (!Array.isArray(payload) || payload.length === 0) {
          return { data: null, error: { message: '未查询到对应记录' } }
        }
        return { data: payload[0], error: null }
      }
      return { data: payload, error: null }
    } catch (e) {
      return { data: null, error: { message: `云端请求异常：${String((e as Error)?.message ?? e)}` } }
    }
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

/** RPC 调用（白名单由服务端控制：send_message / bump_article_views） */
function callRpc(fn: string, params?: Record<string, unknown>): PromiseLike<QueryResult> {
  const url = `${API_BASE}/db/rpc/${encodeURIComponent(fn)}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['x-mim-token'] = token

  const run = async (): Promise<QueryResult> => {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(params ?? {}) })
      const text = await res.text()
      let payload: any = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = text
      }
      if (res.status >= 400) {
        const msg = payload?.message || payload?.error || `云端 RPC 失败（HTTP ${res.status}）`
        return { data: null, error: { message: String(msg) } }
      }
      return { data: payload, error: null }
    } catch (e) {
      return { data: null, error: { message: `云端 RPC 异常：${String((e as Error)?.message ?? e)}` } }
    }
  }
  return { then: (a: any, b: any) => run().then(a, b) }
}

async function postAuth(path: string, payload: Record<string, unknown>) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (res.status >= 400 || !data || data.error) {
      const message = String(data?.error || data?.message || `认证失败（HTTP ${res.status}）`)
      return { data: null, error: { message } } as const
    }
    const user: CloudUser = { id: data.uid, username: data.username, email: null }
    setSession(data.token, user)
    return { data: { user, session: { user } }, error: null } as const
  } catch (e) {
    return { data: null, error: { message: `认证请求异常：${String((e as Error)?.message ?? e)}` } } as const
  }
}

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

/** Realtime 通道存根：本后端无 CDC 推送，订阅降级为 no-op。
    私信的发送与拉取均正常，仅「对方来信实时推送」退化为进入会话时拉取。 */
function makeNoopChannel(_name: string): CloudChannel {
  const ch: CloudChannel = {
    on: () => ch,
    subscribe: () => ch,
    unsubscribe: () => {},
  }
  return ch
}

function createCloudClient(): CloudClient {
  return {
    from: (table: string) => new QueryBuilder(table),
    rpc: (fn: string, params?: Record<string, unknown>) => callRpc(fn, params),
    channel: (name: string) => makeNoopChannel(name),
    removeChannel: (_channel: CloudChannel) => {},
    auth: {
      async getSession() {
        const token = getToken()
        const user = readUser()
        if (!token || !user) return { data: { session: null }, error: null }
        return { data: { session: { user } }, error: null }
      },
      signUp: ({ username, password }) => postAuth('/auth/register', { username, password }),
      signInWithPassword: ({ username, password }) => postAuth('/auth/login', { username, password }),
      async signInWithOAuth() {
        return { error: { message: '本环境未启用第三方登录' } }
      },
      async signOut() {
        clearSession()
        return { error: null }
      },
      onAuthStateChange(_callback) {
        // 自建会话无服务端推送；登录态变化由组件在登录/登出后自行刷新
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  }
}

/**
 * 云端客户端：未配置 VITE_MIM_API_BASE 时为 null，
 * 应用整体回退纯本地模式，保证无云端配置也能随时安全构建上线。
 */
export const supabase: CloudClient | null = API_BASE ? createCloudClient() : null

/** 是否已接入云端（true 时读路径/写路径走 CloudBase PG） */
export const cloudEnabled = supabase !== null

/** 云端后端地址（供存储等子模块拼自己的接口路径） */
export const cloudApiBase = API_BASE

/** 当前会话令牌（供存储等子模块自行携带鉴权头） */
export function cloudToken(): string {
  return getToken()
}

/* 自建账号体系不提供 OAuth provider 探测端点，保持 null 以跳过探测。 */
export const authSettingsUrl: string | null = null

/** 匿名凭据导出（自建后端用签名令牌，无需单独携带 anon key） */
export const anonKeyExport: string | null = null
