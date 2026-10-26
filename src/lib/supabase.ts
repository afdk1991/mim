/* ============================================================================
   云端客户端适配层（三态后端，按优先级自动选择）

   ① Supabase（主后端，2026-10-24 接入）
      配置 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY 时启用，
      使用 @supabase/supabase-js 真实客户端，直接消费平台原生能力：
        · Auth：GoTrue 账号体系。应用账号用「用户名」，GoTrue 只认邮箱，
          故用户名映射为合成邮箱 <username>@mim.app（mailer_autoconfirm
          已开启，不会真发邮件）；含 @ 的输入按邮箱直通（兼容邮箱老账号）。
          真实姓名经 user_metadata 传给 auth.users 触发器自动建档 profiles。
        · OAuth：GitHub 等 provider 在后台开启即自动出现在登录页
          （authSettingsUrl / anonKeyExport 驱动探测）。
        · 数据库：PostgREST + RLS 行级安全（schema.sql 全表启用），
          权限由数据库策略承担，无需服务端注入 owner 过滤。
        · 存储：Storage 私有桶 mim-media，RLS 限定 <uid>/ 前缀（见迁移 0002）。
        · Realtime：messages 表已加入 publication，私信实时推送开箱即用。
      publishable key 按设计可暴露于客户端（安全由 RLS 保证），
      故与 CloudBase 入口一样内置兜底，
      保证 EdgeOne Makers 等读不到仓库环境变量的构建也能带上云端配置。

     CloudBase ↔ Supabase 账号桥（两套账号体系合并为同一用户名空间）：
       · 注册：Supabase 注册前先调 RPC username_taken 全局查重（迁移 0003），
         成功后 fire-and-forget 双写 CloudBase /auth/register；
         CloudBase 侧注册同样先查 Supabase，成功后把 用户名/哈希/salt/uid
         登记进 account_bridge（claim_username）。
       · 登录：原生登录失败 → Edge Function /auth/bridge-login 验 PBKDF2 旧
         哈希（与 CloudBase 版同参）→ 通过则 Admin API 自动落户 → 原密码重试。
         桥接只可新建账号，绝不改已存在账号的密码（防同名账号接管）。

   ② CloudBase（备后端）
      仅配 VITE_MIM_API_BASE 时走原 HTTP 适配器（自建 PBKDF2 账号 +
      mim-api 云函数代理）。存在原因（平台硬限制）：
        1) CloudBase 不允许「用户名 + 密码」自助注册（signup 恒返回 501），
           邮箱与自定义登录 provider 均无法启用，因此账号体系改为自建：
           mim-api 持有 service_role Key，在服务端完成注册与登录。
        2) CloudBase 网关 CORS 只放行安全域名白名单，而体验版套餐不允许
           添加域名，导致 GitHub Pages / EdgeOne Pages 等线上域名一律 403。
           mim-api 自行回写 Access-Control-Allow-Origin: *。
      由于 service_role 会绕过数据库 RLS，权限由 mim-api 强制注入：
      读私有表自动追加 owner 过滤，写入自动改写 owner 列为当前 uid，
      改删自动按 owner 过滤，app_users / audit_logs 永不代理。

   ③ 两者都未配置 → null。项目已移除本地模式：
      此时 main.tsx 直接渲染配置错误页，应用不可用（不再回退 localStorage 演示）。

   选择逻辑：VITE_MIM_BACKEND 可强制指定 'supabase' / 'cloudbase'；
   默认 'auto' = Supabase 优先，其次 CloudBase。
   本文件把两种后端都包装成与 Supabase 同形的链式客户端，
   使 cloud-read / cloud-write / cloud-iam / cloud-msg / auth.tsx 无需改动。
   ============================================================================ */

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, Session, User as SupabaseUser } from '@supabase/supabase-js'

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

/** 两个后端共用的客户端形态（与 Supabase 同形，cloud-* 各模块只依赖此接口） */
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

/* ---------------------------------------------------------------------------
 * 后端选择
 * ------------------------------------------------------------------------- */

/** 当前生效的后端模式（供存储适配层等分支使用） */
export type CloudBackend = 'supabase' | 'cloudbase'

/* 内置示例后端（原作者个人的公开 Supabase / CloudBase 入口）
 *
 * 为什么还保留：EdgeOne Makers 是**远端构建**（`edgeone makers deploy` 在云端
 * 检出自仓库代码后自行 build），构建环境读不到仓库环境变量/Secrets
 * （CI 日志：`No environment variables found`）。若完全删除内置值，
 * 该链路产出的 dist 会缺失云端地址、无法启动（错误页）。
 *
 * 为什么必须能关：源码内置他人后端 = 交付/二次分发时买家不配 .env 也会连到
 * 示例数据库（数据互通、可被示例项目运营方清库）。因此这里提供显式开关：
 *   VITE_MIM_BUILTIN_BACKEND=0   → 彻底禁用内置值（此时必须自行配置云端，否则应用不可用）
 * 默认仍启用，是为了不打断上述远端构建链路；二次分发时务必置 0 并改写下值。 */

/** 生产 Supabase 项目（公开信息：publishable key 按设计可暴露，安全由 RLS 保证） */
const PROD_SUPABASE_URL = 'https://sepfobukokrrivwyvhnd.supabase.co'
const PROD_SUPABASE_ANON_KEY = 'sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg'

/** 用户名 ↔ 合成邮箱 的映射域名（GoTrue 只认邮箱；mailer_autoconfirm 已开启） */
const SYNTHETIC_DOMAIN = 'mim.app'

const env = (k: string): string => {
  const v = (import.meta.env as Record<string, string | undefined>)[k]
  return typeof v === 'string' ? v.trim() : ''
}

/** 内置示例后端开关（见上方 PROD_SUPABASE_URL 处注释）：
 *  VITE_MIM_BUILTIN_BACKEND=0 时禁用内置值，未配置云端即启动错误页。
 *
 *  这里刻意用**静态**属性访问（而非 env('…') 动态取键）：Vite 只能在静态形态下
 *  把 `import.meta.env.VITE_X` 折叠成字面量，从而让 `BUILTIN_ENABLED` 成为常量、
 *  进而把 PROD_* 三个内置地址整段 tree-shake 掉——否则地址字符串仍会出现在
 *  买家产物里（虽不生效，但交付时是隐患）。 */
const BUILTIN_ENABLED = import.meta.env.VITE_MIM_BUILTIN_BACKEND !== '0'

const SB_URL = env('VITE_SUPABASE_URL') || (BUILTIN_ENABLED ? PROD_SUPABASE_URL : '')
const SB_ANON = env('VITE_SUPABASE_ANON_KEY') || (BUILTIN_ENABLED ? PROD_SUPABASE_ANON_KEY : '')

/** 生产云端后端（CloudBase 云函数 mim-api）的固定入口。
 *
 *    为何内置兜底：EdgeOne Makers 走 .edgeone 目录自动构建，构建环境读不到
 *    仓库环境变量（CI 日志：`No environment variables found`），若仅依赖
 *    VITE_MIM_API_BASE 会导致线上产物缺失云端地址、无法启动（错误页）。
 *    该地址是公开 HTTP 端点（不含任何密钥，权限由云函数服务端强制校验）；
 *    需要用自建后端时仍可用 VITE_MIM_API_BASE 覆盖，或用 VITE_MIM_BUILTIN_BACKEND=0
 *    关闭全部内置值（详见 PROD_SUPABASE_URL 处注释与 INSTALL.md）。 */
const PROD_API_BASE = 'https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mim-api'

const API_BASE = (env('VITE_MIM_API_BASE') || (BUILTIN_ENABLED ? PROD_API_BASE : '')).replace(/\/+$/, '')

const FORCED = env('VITE_MIM_BACKEND')
const hasSupabaseConfig = !!SB_URL && !!SB_ANON
const hasCloudbaseConfig = !!API_BASE

/** 解析后端：只返回云端主/备后端；两者都未配置 → null（启动错误页，不回退本地模式） */
function resolveBackend(): CloudBackend | null {
  if (FORCED === 'supabase') return hasSupabaseConfig ? 'supabase' : null
  if (FORCED === 'cloudbase') return hasCloudbaseConfig ? 'cloudbase' : null
  return hasSupabaseConfig ? 'supabase' : hasCloudbaseConfig ? 'cloudbase' : null
}

const resolvedBackend = resolveBackend()

/** 云端后端配置缺失：main.tsx 直接渲染错误页，应用不可用（本地模式已移除） */
export const cloudConfigMissing = resolvedBackend === null

/** 当前后端模式：'supabase' | 'cloudbase'（cloudConfigMissing 时应用不会渲染） */
export const cloudBackend: CloudBackend = resolvedBackend ?? 'supabase'

/** 是否正在使用「内置示例后端」：既未自行配置任何云端地址，又未关闭内置开关。
 *  二次分发/交付场景应确保此项为 false——否则买家站点会连到示例项目的数据库。 */
export const usingBuiltinBackend =
  BUILTIN_ENABLED && !env('VITE_SUPABASE_URL') && !env('VITE_SUPABASE_ANON_KEY') && !env('VITE_MIM_API_BASE')

if (usingBuiltinBackend && import.meta.env.DEV) {
  console.warn(
    '[mim] 当前使用内置示例后端（他人 Supabase/CloudBase 项目），数据会写入示例库。\n' +
      '生产部署请在 .env 配置 VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY。' +
      '（本项目已无本地模式：未配置云端将无法启动）详见 INSTALL.md。',
  )
}

/* ---------------------------------------------------------------------------
 * Supabase 后端（主）
 * ------------------------------------------------------------------------- */

/** 应用账号（用户名）→ GoTrue 登录邮箱。
 *  含 @ 的输入按邮箱直通（兼容历史上用邮箱注册的账号）；
 *  否则拼接合成邮箱，mailer_autoconfirm 已开启故无需真收信。 */
export function toAuthEmail(usernameOrEmail: string): string {
  const v = String(usernameOrEmail || '').trim()
  if (!v) return ''
  return v.includes('@') ? v : `${v}@${SYNTHETIC_DOMAIN}`
}

/** 合成邮箱 → 展示用用户名；非合成邮箱（邮箱直通登录）原样返回 */
export function fromAuthEmail(email: string | null | undefined, fallback = ''): string {
  const e = String(email || '')
  const suffix = `@${SYNTHETIC_DOMAIN}`
  if (e.endsWith(suffix)) return e.slice(0, -suffix.length) || fallback
  return e || fallback
}

/** GoTrue User → 应用 CloudUser（username 优先取 user_metadata，其次反解合成邮箱） */
function normalizeUser(u: SupabaseUser | null | undefined): CloudUser | null {
  if (!u) return null
  const meta = (u.user_metadata ?? {}) as { username?: string; name?: string }
  const username = (meta.username && String(meta.username)) || fromAuthEmail(u.email) || meta.name || null
  return { id: u.id, email: u.email ?? null, username, is_anonymous: !!u.is_anonymous }
}

/** Supabase 模式的模块级会话快照：onAuthStateChange + getSession 双保险刷新，
 *  供 cloudToken() / cloudUid() 同步读取（存储就绪判断需要）。 */
let sbSession: Session | null = null

/* ---------------------------------------------------------------------------
 * CloudBase ↔ Supabase 账号桥（迁移 0003 + Edge Function /auth/bridge-login）
 * ------------------------------------------------------------------------- */

/** 注册前全局用户名查重：RPC username_taken（auth.users + account_bridge 合并视图）。
 *  RPC 未部署（迁移 0003 未应用）或网络异常时返回 false 放行，由 GoTrue 唯一约束兜底。 */
export async function usernameTakenGlobally(raw: SupabaseClient, login: string): Promise<boolean> {
  const username = login.includes('@') ? '' : login.trim()
  if (!username) return false
  try {
    const { data, error } = await raw.rpc('username_taken', { p_username: username })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

/** 双写 CloudBase 注册（fire-and-forget）：切回备后端时账号仍在；
 *  mim-api 会把该用户名登记进 Supabase 账号桥。失败不阻塞 Supabase 主流程。
 *  带 mirror=true：镜像写入语义——跳过「Supabase 全局查重」，
 *  否则刚在 Supabase 建号的同名账号必被判为已占用（409），备后端账号永远建不出来。 */
export function dualWriteCloudbase(username: string, password: string): void {
  if (cloudBackend !== 'supabase' || !username) return
  void fetch(`${PROD_API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, mirror: true }),
  }).catch(() => {
    /* 双写失败仅影响备后端可用性，不阻断主流程 */
  })
}

type BridgeResult = 'upgraded' | 'locked' | 'none'

/** CloudBase 老账号桥接登录：Edge Function 验 PBKDF2 旧哈希，通过则自动落户 GoTrue。
 *  邮箱账号不走桥（CloudBase 侧只有用户名账号）；函数未部署/无记录/网络异常 → 'none'。 */
export async function bridgeLogin(login: string, password: string): Promise<BridgeResult> {
  if (!login || login.includes('@')) return 'none'
  try {
    const res = await fetch(`${SB_URL}/functions/v1/mim-api/auth/bridge-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SB_ANON,
        Authorization: `Bearer ${SB_ANON}`,
      },
      body: JSON.stringify({ username: login, password }),
    })
    if (res.status === 200) {
      const json = (await res.json().catch(() => null)) as { upgraded?: boolean } | null
      return json?.upgraded === true ? 'upgraded' : 'none'
    }
    if (res.status === 423) return 'locked'
    return 'none'
  } catch {
    return 'none'
  }
}

function createSupabaseClient(): { client: CloudClient; raw: SupabaseClient } {
  const raw = createClient(SB_URL, SB_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // 固定 storageKey：云函数代理分支之外的同步会话读取依赖它
      storageKey: 'mim-sb-auth',
    },
  })

  void raw.auth.getSession().then(({ data }) => {
    sbSession = data.session
  })
  raw.auth.onAuthStateChange((_event, session) => {
    sbSession = session
  })

  const client: CloudClient = {
    from: (table: string) => raw.from(table),
    rpc: (fn: string, params?: Record<string, unknown>) => raw.rpc(fn, params ?? {}),
    channel: (name: string) => raw.channel(name) as unknown as CloudChannel,
    removeChannel: (channel: CloudChannel) => {
      void raw.removeChannel(channel as unknown as Parameters<typeof raw.removeChannel>[0])
    },
    auth: {
      async getSession() {
        const { data } = await raw.auth.getSession()
        const user = normalizeUser(data.session?.user)
        return { data: { session: user ? { user } : null }, error: null }
      },
      async signUp({ username, email, password }) {
        const login = String(email || username || '').trim()
        const displayName = String(username || '').trim() || fromAuthEmail(login)
        // 全局用户名查重（迁移 0003 的 username_taken RPC，覆盖 CloudBase 账号桥；
        // RPC 未部署时静默放行，由 GoTrue 自身唯一约束兜底）
        if (await usernameTakenGlobally(raw, login)) {
          return { data: null, error: { message: '该用户名已被注册' } }
        }
        const { data, error } = await raw.auth.signUp({
          email: toAuthEmail(login),
          password,
          options: { data: { username: displayName, name: displayName } },
        })
        if (error) return { data: null, error: { message: error.message } }
        const user = normalizeUser(data.user ?? data.session?.user)
        // 双写 CloudBase（fire-and-forget）：使切回备后端时该账号仍在，
        // 同时由 mim-api 把用户名登记进 Supabase 账号桥（失败不阻塞主流程）
        dualWriteCloudbase(displayName, password)
        return { data: { user, session: user ? { user } : null }, error: null }
      },
      async signInWithPassword({ username, email, password }) {
        const login = String(email || username || '').trim()
        const { data, error } = await raw.auth.signInWithPassword({
          email: toAuthEmail(login),
          password,
        })
        if (!error) {
          const user = normalizeUser(data.user ?? data.session?.user)
          return { data: { user, session: user ? { user } : null }, error: null }
        }
        // CloudBase 老账号桥接登录：原生失败 → Edge Function 验 PBKDF2 旧哈希 →
        // 自动落户 GoTrue → 原密码重试一次（函数未部署 / 无桥接记录时静默跳过）
        const bridged = await bridgeLogin(login, password)
        if (bridged === 'upgraded') {
          const retry = await raw.auth.signInWithPassword({
            email: toAuthEmail(login),
            password,
          })
          if (!retry.error) {
            const user = normalizeUser(retry.data.user ?? retry.data.session?.user)
            return { data: { user, session: user ? { user } : null }, error: null }
          }
        } else if (bridged === 'locked') {
          return { data: null, error: { message: '尝试次数过多，请 15 分钟后再试' } }
        }
        return { data: null, error: { message: error.message } }
      },
      async signInWithOAuth({ provider, options }) {
        const { error } = await raw.auth.signInWithOAuth({
          provider: provider as 'github',
          options: options as { redirectTo?: string } | undefined,
        })
        return { error: error ? { message: error.message } : null }
      },
      async signOut() {
        const { error } = await raw.auth.signOut()
        return { error: error ? { message: error.message } : null }
      },
      onAuthStateChange(callback) {
        const ret = raw.auth.onAuthStateChange((event, session) => {
          const user = normalizeUser(session?.user)
          callback(event, user ? { user } : null)
        // supabase-js 各版本返回形态不一（{ data: { subscription } } 或 { subscription }），
        // 这里兼容两种并归一化为 CloudClient 的 { data: { subscription } }
        }) as {
          data?: { subscription: { unsubscribe: () => void } }
          subscription?: { unsubscribe: () => void }
        }
        const sub = ret.data?.subscription ?? ret.subscription
        return { data: { subscription: { unsubscribe: () => sub?.unsubscribe() } } }
      },
    },
  }

  return { client, raw }
}

/* ---------------------------------------------------------------------------
 * CloudBase 后端（备）：HTTP 适配器
 * ------------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------------
 * 导出
 * ------------------------------------------------------------------------- */

const supabaseBackend = cloudBackend === 'supabase' ? createSupabaseClient() : null

/** 云端客户端：仅在后端配置缺失时为 null（此时应用由 main.tsx 拦截并显示错误页） */
export const supabase: CloudClient | null =
  supabaseBackend?.client ?? (cloudBackend === 'cloudbase' ? createCloudClient() : null)

/** 真实 Supabase 客户端（仅 Supabase 模式；供存储适配层直连 Storage） */
export const sbClient: SupabaseClient | null = supabaseBackend?.raw ?? null

/** 云端后端地址（供存储等子模块拼自己的接口路径） */
export const cloudApiBase = cloudBackend === 'supabase' ? SB_URL : API_BASE

/** 当前会话令牌（供存储等子模块自行携带鉴权头；Supabase 模式为 JWT） */
export function cloudToken(): string {
  if (cloudBackend === 'supabase') return sbSession?.access_token ?? ''
  return getToken()
}

/** 当前登录用户 id（Supabase 模式取自会话；CloudBase 模式从令牌 payload 反解） */
export function cloudUid(): string {
  if (cloudBackend === 'supabase') return sbSession?.user?.id ?? ''
  const token = getToken()
  if (!token) return ''
  try {
    const payload = JSON.parse(atob(token.slice(0, token.lastIndexOf('.'))))
    return typeof payload?.uid === 'string' ? payload.uid : ''
  } catch {
    return ''
  }
}

/** GoTrue settings 端点（Supabase 模式驱动 OAuth provider 探测；自建后端无此端点） */
export const authSettingsUrl: string | null =
  cloudBackend === 'supabase' ? `${SB_URL}/auth/v1/settings` : null

/** 匿名凭据（Supabase 模式为 publishable key，供 settings 探测使用） */
export const anonKeyExport: string | null = cloudBackend === 'supabase' ? SB_ANON : null
