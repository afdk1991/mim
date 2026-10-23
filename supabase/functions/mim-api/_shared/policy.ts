/* ============================================================================
 * Mim · Supabase Edge Function mim-api —— 纯策略模块（无 Deno 依赖，可单测）
 *
 * 与 CloudBase 云函数 mim-api（cloudfunctions/mim-api/index.js）同契约：
 *   /auth/register | /auth/login | /auth/me
 *   /db/rest/<table> | /db/rpc/<fn>
 *   /storage/upload | /storage/url | /storage/list | /storage/delete
 *
 * 安全模型（与 CloudBase 版一致，全部由服务端强制，不接受客户端指定）：
 *   · 数据库以 service_role Key 访问（绕过 RLS）⇒ 权限由本模块的策略表注入：
 *     读私有表追加 owner 过滤；写强制改写 owner 列；改删按 owner 过滤。
 *   · 账号存于 GoTrue auth.users（注册走 Admin API，登录走 password grant），
 *     本函数另签发 30 天 HMAC 令牌（前端 x-mim-token 头携带）。
 *   · 存储 key 首段必须等于自己的 uid ⇒ 无法读写他人文件。
 * ============================================================================ */

/** 应用账号（用户名）→ GoTrue 邮箱。含 @ 直通（兼容邮箱账号），否则合成邮箱。 */
export const SYNTHETIC_DOMAIN = 'mim.app'

export function toAuthEmail(usernameOrEmail: string): string {
  const v = String(usernameOrEmail || '').trim()
  if (!v) return ''
  return v.includes('@') ? v : `${v}@${SYNTHETIC_DOMAIN}`
}

/* ---------------------------------------------------------------------------
 * 表访问策略（与 CloudBase 版保持一致）
 * ------------------------------------------------------------------------- */

/** 匿名与登录用户均可读（社区公开内容） */
export const PUBLIC_READ = new Set([
  'posts', 'post_comments', 'articles', 'article_comments', 'snippets',
  'profiles', 'topics', 'hot_searches', 'resources',
])
/** 登录用户可读的参考数据；user_roles 额外按 uid 收敛 */
export const AUTH_READ = new Set(['roles', 'permissions', 'role_permissions'])
/** 私有表 → 所属者列名 */
export const OWNER_COL: Record<string, string> = {
  notifications: 'user_id',
  messages: 'owner_id',
  favorites: 'user_id',
  post_drafts: 'user_id',
  article_drafts: 'user_id',
  documents: 'user_id',
  post_likes: 'user_id',
  comment_likes: 'user_id',
  article_likes: 'user_id',
  snippet_likes: 'user_id',
  user_roles: 'user_id',
}
/** 内容表 → 作者列名（写时强制，改删时按此过滤） */
export const AUTHOR_COL: Record<string, string> = {
  posts: 'author_id',
  articles: 'author_id',
  snippets: 'author_id',
  post_comments: 'author_id',
  article_comments: 'author_id',
}
/** 以自身主键归属的表（profiles.id = 用户 uid） */
export const SELF_ID_COL: Record<string, string> = { profiles: 'id' }
/** 仅服务端使用，禁止通过代理访问 */
export const SERVER_ONLY = new Set(['app_users', 'audit_logs'])
/** 世界观点数据，禁止客户端写入 */
export const READ_ONLY_TABLES = new Set(['topics', 'hot_searches', 'resources', 'roles', 'permissions', 'role_permissions'])

export const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** RPC 白名单（send_message 在入口特判，不走通用代理） */
export const RPC_ALLOW = new Set(['bump_article_views', 'send_message'])

/** 拼接 postgREST 过滤子句 */
export function appendFilter(query: string, col: string, uid: string): string {
  const clause = `${col}=eq.${encodeURIComponent(uid)}`
  return query ? `${query}&${clause}` : clause
}

/* ---------------------------------------------------------------------------
 * 令牌（HMAC-SHA256，30 天有效；与 CloudBase 版同格式）
 * ------------------------------------------------------------------------- */

export const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 签发令牌：base64url(payload).base64url(hmac)。
 *  payload 可显式携带 iat（毫秒时间戳）以便测试过期分支；缺省为当前时间。 */
export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const iat = typeof payload.iat === 'number' ? payload.iat : Date.now()
  const body = b64urlEncode(JSON.stringify({ ...payload, iat }))
  return `${body}.${await hmac(secret, body)}`
}

/** 校验令牌；过期 / 篡改 / 缺 uid 一律 null */
export async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  if (!token || !secret) return null
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const body = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expect = await hmac(secret, body)
  if (sig.length !== expect.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const p = JSON.parse(b64urlDecode(body))
    if (!p || !p.uid) return null
    if (typeof p.iat === 'number' && Date.now() - p.iat > TOKEN_TTL_MS) return null
    return p
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
 * 存储 key 与扩展名（与 CloudBase 版一致）
 * ------------------------------------------------------------------------- */

/** 单文件上限：3MB（HTTP 请求体 ~6MB，base64 膨胀 33% 后留余量） */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/** 允许的类型（按 MIME 前缀放行）。svg 可内嵌脚本存在 XSS 面，显式排除 */
export const MIME_ALLOW = ['image/', 'video/', 'audio/']
export const MIME_DENY = new Set(['image/svg+xml'])

export const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-msvideo': 'avi',
}

/** 从原始文件名取扩展名并做白名单收敛，避免 ../ 与双扩展名等路径问题 */
export function safeExt(name: string, mime: string): string {
  const byMime = EXT_BY_MIME[mime]
  if (byMime) return byMime
  const m = String(name || '').match(/\.([a-zA-Z0-9]{1,8})$/)
  const ext = m ? m[1].toLowerCase() : ''
  if (/^[a-zA-Z0-9]{1,8}$/.test(ext) && !/^(php|jsp|asp|aspx|sh|exe|html?|js)$/.test(ext)) return ext
  return 'bin'
}

/** key 首段必须等于自己的 uid —— 无法读写他人文件 */
export function ownKey(uid: string, key: unknown): boolean {
  return typeof key === 'string' && key.startsWith(`${uid}/`) && !key.includes('..')
}

/** 生成对象 key：<uid>/<yyyy-mm>/<uuid>.<ext>（uuid 可注入以便测试） */
export function buildMediaKey(uid: string, name: string, mime: string, uuid?: string, now = new Date()): string {
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const id = uuid ?? crypto.randomUUID()
  return `${uid}/${ym}/${id}.${safeExt(name, mime)}`
}

/* ---------------------------------------------------------------------------
 * 注册 / 登录输入校验（与 CloudBase 版一致）
 * ------------------------------------------------------------------------- */

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/

export function validateUsername(username: unknown): string | null {
  const u = String(username || '').trim()
  if (!USERNAME_RE.test(u)) return '用户名需为 3-32 位字母、数字、下划线、点或连字符'
  return null
}

export function validatePassword(password: unknown): string | null {
  const p = String(password || '')
  if (p.length < 8 || p.length > 72) return '密码长度需为 8-72 位'
  return null
}
