/* ============================================================================
 * Mim · Supabase Edge Function mim-api（Deno）
 *
 * 与 CloudBase 云函数 mim-api 完全同契约的后端 API，使同一前端可以：
 *   · 直连 Supabase（主路径：anon key + PostgREST + RLS + Storage + Realtime）
 *   · 或走本函数（备路径：VITE_MIM_API_BASE 指向本函数，自建 HMAC 令牌）
 *
 * 平台差异处理：
 *   · 账号存于 GoTrue auth.users：注册走 Admin API（service_role），
 *     登录走 password grant；本函数另签发 30 天 HMAC 令牌（x-mim-token）。
 *   · 数据库以 service_role 访问 postgREST（/rest/v1），权限由 _shared/policy.ts
 *     的策略表在服务端强制注入（与 CloudBase 版同一套规则）。
 *   · 存储走 Storage HTTP API（/storage/v1），私有桶 + 签名链接。
 *
 * 部署（需 Supabase Access Token，见 DEPLOY.md）：
 *   supabase functions deploy mim-api --project-ref <ref>
 *   supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... MIM_TOKEN_SECRET=...
 * ============================================================================ */

import {
  toAuthEmail,
  validateUsername,
  validatePassword,
  signToken,
  verifyToken,
  TABLE_NAME_RE,
  SERVER_ONLY,
  PUBLIC_READ,
  AUTH_READ,
  OWNER_COL,
  AUTHOR_COL,
  SELF_ID_COL,
  READ_ONLY_TABLES,
  RPC_ALLOW,
  appendFilter,
  ownKey,
  buildMediaKey,
  MAX_UPLOAD_BYTES,
  MIME_ALLOW,
  MIME_DENY,
  bridgeLoginPlan,
  bridgeFailState,
  pbkdf2Hex,
  constantTimeEqualHex,
  BRIDGE_LOCK_MINUTES,
  type BridgeRow,
} from './_shared/policy.ts'

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TOKEN_SECRET = Deno.env.get('MIM_TOKEN_SECRET') ?? ''
const STORAGE_BUCKET = Deno.env.get('MIM_STORAGE_BUCKET') || 'mim-media'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,apikey,x-mim-token,Prefer,Accept',
  'Access-Control-Max-Age': '86400',
}

/** 统一 JSON 响应（自带 CORS，任意部署域名可用） */
function resp(status: number, obj: unknown): Response {
  return new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** 带 service_role 的 Supabase 请求（postgREST / Auth Admin / Storage） */
async function sb(path: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  return { status: r.status, text: await r.text() }
}

function parseJson(text: string, status: number): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return status >= 400 ? { message: text } : text
  }
}

/* ---------------------------------------------------------------------------
 * 鉴权 API（GoTrue Admin + password grant + 自建 HMAC 令牌）
 * ------------------------------------------------------------------------- */

async function register(body: Record<string, unknown>): Promise<Response> {
  const u = String(body.username || '').trim()
  const p = String(body.password || '')
  const bad = validateUsername(u) || validatePassword(p)
  if (bad) return resp(400, { error: bad })

  const email = toAuthEmail(u)
  const displayName = String(body.name || '').trim() || u

  // Admin 建号（email_confirm: true —— mailer_autoconfirm 环境无需验证邮件）
  const created = await sb('/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: p,
      email_confirm: true,
      user_metadata: { username: u, name: displayName },
    }),
  })
  if (created.status >= 400) {
    const detail = parseJson(created.text, created.status) as { error_code?: string; msg?: string } | null
    const code = detail?.error_code ?? ''
    if (created.status === 422 && (code === 'email_exists' || code === 'user_already_exists')) {
      return resp(409, { error: '该用户名已被注册' })
    }
    return resp(502, { error: '创建账号失败', detail: created.text.slice(0, 300) })
  }
  const user = parseJson(created.text, created.status) as { id: string } | null
  if (!user?.id) return resp(502, { error: '创建账号失败', detail: created.text.slice(0, 300) })

  // 触发器 on_auth_user_created 自动建档 profiles；此处只签发令牌
  const token = await signToken({ uid: user.id, username: u }, TOKEN_SECRET)
  return resp(200, { token, uid: user.id, username: u, name: displayName })
}

async function login(body: Record<string, unknown>): Promise<Response> {
  const u = String(body.username || '').trim()
  const p = String(body.password || '')
  if (!u || !p) return resp(400, { error: '请输入用户名和密码' })

  const r = await sb('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: toAuthEmail(u), password: p }),
  })
  if (r.status >= 400) return resp(401, { error: '用户名或密码不正确' })
  const data = parseJson(r.text, r.status) as {
    user?: { id: string; email?: string; user_metadata?: { username?: string; name?: string } }
  } | null
  const uid = data?.user?.id
  if (!uid) return resp(401, { error: '用户名或密码不正确' })

  const username = data?.user?.user_metadata?.username || u
  const token = await signToken({ uid, username }, TOKEN_SECRET)
  return resp(200, {
    token,
    uid,
    username,
    name: data?.user?.user_metadata?.name || username,
  })
}

async function me(token: string): Promise<Response> {
  const payload = await verifyToken(token, TOKEN_SECRET)
  if (!payload) return resp(401, { error: '登录已失效，请重新登录' })
  const r = await sb(`/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(String(payload.uid))}`)
  const rows = parseJson(r.text, r.status)
  return resp(200, {
    uid: payload.uid,
    username: payload.username,
    profile: Array.isArray(rows) && rows[0] ? rows[0] : null,
  })
}

/* ---------------------------------------------------------------------------
 * 账号桥登录（CloudBase 老账号在 Supabase 首次登录自动落户）
 *
 * 安全模型（重要）：
 *   · 验通过后只允许「新建」GoTrue 账号；若合成邮箱账号已存在（422 email_exists），
 *     一律返回 409 且绝不修改对方密码 —— 否则知道 CloudBase 旧密码的人可以
 *     接管同名 Supabase 账号。
 *   · 防爆破：同一用户名连续失败 BRIDGE_MAX_ATTEMPTS 次锁定 BRIDGE_LOCK_MINUTES 分钟。
 *   · 成功后 bridge.migrated = true，后续登录走原生通道，不再过桥。
 * ------------------------------------------------------------------------- */
async function bridgeLogin(body: Record<string, unknown>): Promise<Response> {
  const u = String(body.username || '').trim()
  const p = String(body.password || '')
  if (!u || !p) return resp(400, { error: '请输入用户名和密码' })
  if (u.includes('@')) return resp(400, { error: '邮箱账号请直接登录' })

  // 1. 查桥接记录（service_role 绕过 RLS；account_bridge 对客户端禁 select）
  const q = await sb(
    `/rest/v1/account_bridge?select=username,cloudbase_uid,password_hash,salt,migrated,failed_attempts,locked_until&username=eq.${encodeURIComponent(u)}`,
  )
  if (q.status >= 400) return resp(502, { error: '账号桥查询失败', detail: q.text.slice(0, 300) })
  const rows = parseJson(q.text, q.status) as BridgeRow[] | null
  const row = Array.isArray(rows) ? (rows[0] ?? null) : null

  const plan = bridgeLoginPlan(row)
  if (plan === 'gone') return resp(404, { error: 'no_bridge_account' })
  if (plan === 'locked') return resp(423, { error: `尝试次数过多，请 ${BRIDGE_LOCK_MINUTES} 分钟后再试` })
  if (plan === 'migrated') return resp(409, { error: '该账号已升级，请使用原密码直接登录' })

  // 2. 验 PBKDF2 旧哈希（与 CloudBase 版同参）
  const computed = await pbkdf2Hex(p, row!.salt)
  if (!constantTimeEqualHex(computed, row!.password_hash)) {
    const state = bridgeFailState(row!.failed_attempts)
    await sb(`/rest/v1/account_bridge?username=eq.${encodeURIComponent(u)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    })
    return resp(401, { error: '用户名或密码不正确' })
  }

  // 3. Admin API 落户：仅新建；已存在则拒绝（防同名账号接管）
  const created = await sb('/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: toAuthEmail(u),
      password: p,
      email_confirm: true,
      user_metadata: { username: u, name: u, bridged_from: 'cloudbase' },
    }),
  })
  if (created.status >= 400) {
    const detail = parseJson(created.text, created.status) as { error_code?: string } | null
    const code = detail?.error_code ?? ''
    if (created.status === 422 && (code === 'email_exists' || code === 'user_already_exists')) {
      return resp(409, { error: '该用户名已在 Supabase 注册，请直接用原密码登录' })
    }
    return resp(502, { error: '账号落户失败', detail: created.text.slice(0, 300) })
  }

  // 4. 清零失败计数并标记已升级
  await sb(`/rest/v1/account_bridge?username=eq.${encodeURIComponent(u)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ migrated: true, failed_attempts: 0, locked_until: null }),
  })

  return resp(200, { upgraded: true, username: u })
}

/* ---------------------------------------------------------------------------
 * 数据代理（service_role + 服务端强制权限注入）
 * ------------------------------------------------------------------------- */

async function proxyDb(req: {
  table: string
  method: string
  query: string
  body: unknown
  uid?: string
  prefer?: string
}): Promise<Response> {
  const { table, method, uid } = req
  if (!TABLE_NAME_RE.test(table)) return resp(400, { error: '非法表名' })
  if (SERVER_ONLY.has(table)) return resp(403, { error: '该表不允许访问' })

  const isRead = method === 'GET' || method === 'HEAD'
  const owner = OWNER_COL[table]
  const author = AUTHOR_COL[table]
  let query = req.query

  // 匿名：只允许读公开表
  if (!uid && !isRead) return resp(401, { error: '请先登录' })
  if (!uid && !PUBLIC_READ.has(table)) return resp(401, { error: '请先登录' })

  // 读
  if (isRead) {
    if (!PUBLIC_READ.has(table) && !AUTH_READ.has(table)) {
      if (owner) query = appendFilter(query, owner, uid!)
      else return resp(403, { error: '该表不允许访问' })
    }
    if (table === 'user_roles') query = appendFilter(query, 'user_id', uid!)
    const r = await sb(`/rest/v1/${table}${query ? `?${query}` : ''}`, {
      method,
      headers: req.prefer ? { Prefer: req.prefer } : {},
    })
    return resp(r.status, parseJson(r.text, r.status))
  }

  // 写：只读表拒绝
  if (READ_ONLY_TABLES.has(table)) return resp(403, { error: '该表为只读数据' })

  const headers: Record<string, string> = {}
  if (req.prefer) headers.Prefer = req.prefer

  if (method === 'POST') {
    let payload = req.body
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload)
      } catch {
        payload = null
      }
    }
    if (payload === null || payload === undefined) return resp(400, { error: '缺少请求体' })
    const stamp = (obj: unknown) => {
      if (!obj || typeof obj !== 'object') return obj
      const o = obj as Record<string, unknown>
      if (author) o[author] = uid
      if (owner) o[owner] = uid
      const selfCol = SELF_ID_COL[table]
      if (selfCol) o[selfCol] = uid
      return o
    }
    payload = Array.isArray(payload) ? payload.map(stamp) : stamp(payload)
    const r = await sb(`/rest/v1/${table}${query ? `?${query}` : ''}`, {
      method,
      headers,
      body: JSON.stringify(payload),
    })
    return resp(r.status, parseJson(r.text, r.status))
  }

  // PATCH / PUT / DELETE：强制归属过滤
  if (method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    const col = owner || author || SELF_ID_COL[table]
    if (!col) return resp(403, { error: '该表不允许修改' })
    query = appendFilter(query, col, uid!)
    if (method !== 'DELETE' && req.body) {
      let payload = req.body
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload)
        } catch {
          payload = null
        }
      }
      if (payload && typeof payload === 'object') {
        // 不允许通过改归属来转移数据所有权
        delete (payload as Record<string, unknown>)[col]
        const r = await sb(`/rest/v1/${table}?${query}`, {
          method,
          headers,
          body: JSON.stringify(payload),
        })
        return resp(r.status, parseJson(r.text, r.status))
      }
    }
    const r = await sb(`/rest/v1/${table}?${query}`, { method, headers })
    return resp(r.status, parseJson(r.text, r.status))
  }

  return resp(405, { error: '不支持的方法' })
}

/** 私信写入：service_role 直接写「双行模型」两条记录（send_message RPC 依赖
 *  auth.uid()，service_role 下为空会抛错，故不走 RPC） */
async function sendMessage(uid: string | undefined, body: Record<string, unknown>): Promise<Response> {
  if (!uid) return resp(401, { error: '请先登录' })
  const peer = String(body.p_peer ?? body.peer ?? '')
  const text = String(body.p_content ?? body.content ?? '').trim()
  if (!peer || !text) return resp(400, { error: '参数不完整' })
  if (peer === uid) return resp(400, { error: '不能给自己发消息' })

  const msgId = `m${crypto.randomUUID().replace(/-/g, '')}`
  const r = await sb('/rest/v1/messages', {
    method: 'POST',
    headers: { Prefer: 'return=minimal', 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { id: msgId, owner_id: uid, peer_id: peer, from_me: true, content: text, read: true },
      { id: msgId, owner_id: peer, peer_id: uid, from_me: false, content: text, read: false },
    ]),
  })
  if (r.status >= 400) return resp(502, { error: '发送失败', detail: r.text.slice(0, 300) })
  return resp(200, { ok: true, id: msgId })
}

async function proxyRpc(fn: string, body: unknown, uid?: string): Promise<Response> {
  if (!RPC_ALLOW.has(fn)) return resp(403, { error: '该函数不允许调用' })
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (fn === 'send_message') return sendMessage(uid, payload)
  const r = await sb(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return resp(r.status, parseJson(r.text, r.status))
}

/* ---------------------------------------------------------------------------
 * 云存储代理（Storage HTTP API，私有桶 + 签名链接）
 * ------------------------------------------------------------------------- */

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function storageUpload(uid: string | undefined, body: Record<string, unknown>): Promise<Response> {
  if (!uid) return resp(401, { error: '请先登录' })
  const dataB64 = typeof body.data === 'string' ? body.data : ''
  if (!dataB64) return resp(400, { error: '缺少文件数据（base64）' })

  const buf = b64ToBytes(dataB64)
  if (!buf.length) return resp(400, { error: '文件内容为空' })
  if (buf.length > MAX_UPLOAD_BYTES) {
    return resp(413, { error: `文件过大，单文件上限 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB（HTTP 请求体限制）` })
  }

  const mime = String(body.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase()
  if (MIME_DENY.has(mime) || !MIME_ALLOW.some((prefix) => mime.startsWith(prefix))) {
    return resp(415, { error: `不支持的文件类型：${mime}（仅支持图片 / 音频 / 视频）` })
  }

  const key = buildMediaKey(uid, String(body.name || ''), mime)
  const r = await sb(`/storage/v1/object/${STORAGE_BUCKET}/${key}`, {
    method: 'POST',
    headers: { 'Content-Type': mime },
    body: buf,
  })
  if (r.status >= 400) return resp(502, { error: '上传失败', detail: r.text.slice(0, 300) })
  return resp(200, {
    key,
    bucket: STORAGE_BUCKET,
    size: buf.length,
    mime,
    name: String(body.name || ''),
  })
}

async function storageUrl(uid: string | undefined, key: string, expiresIn: string): Promise<Response> {
  if (!uid) return resp(401, { error: '请先登录' })
  if (!ownKey(uid, key)) return resp(403, { error: '只能访问自己的文件' })
  const secs = Math.min(Math.max(Number(expiresIn) || 3600, 60), 86400)
  const r = await sb(`/storage/v1/object/sign/${STORAGE_BUCKET}/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: secs }),
  })
  if (r.status >= 400) return resp(404, { error: '取链失败（文件可能不存在）', detail: r.text.slice(0, 300) })
  const json = parseJson(r.text, r.status) as { signedURL?: string } | null
  const signed = json?.signedURL || ''
  if (!signed) return resp(404, { error: '取链失败', detail: r.text.slice(0, 300) })
  // Supabase 返回的 signedURL 可能是相对路径（/object/sign/...），需拼全
  const url = signed.startsWith('http') ? signed : `${SUPABASE_URL}/storage/v1${signed}`
  return resp(200, { key, url, expiresIn: secs })
}

async function storageList(uid: string | undefined, prefix: string): Promise<Response> {
  if (!uid) return resp(401, { error: '请先登录' })
  const sub = String(prefix || '').replace(/^\/+/, '').replace(/\.\./g, '')
  const dir = `${uid}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '')
  const r = await sb(`/storage/v1/object/list/${STORAGE_BUCKET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefix: dir,
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    }),
  })
  if (r.status >= 400) return resp(502, { error: '列目录失败', detail: r.text.slice(0, 300) })
  const objects = (parseJson(r.text, r.status) as Array<Record<string, unknown>> | null) ?? []
  return resp(200, {
    bucket: STORAGE_BUCKET,
    dir,
    items: objects.map((o) => {
      const meta = (o.metadata ?? {}) as { size?: number; mimetype?: string }
      return {
        key: `${dir}/${o.name}`.replace(/^\/+/, ''),
        name: o.name,
        size: meta.size ?? null,
        mime: meta.mimetype ?? null,
        updated: (o.updated_at as string) ?? (o.created_at as string) ?? null,
      }
    }),
  })
}

async function storageDelete(uid: string | undefined, body: Record<string, unknown>): Promise<Response> {
  if (!uid) return resp(401, { error: '请先登录' })
  const list = Array.isArray(body.keys) ? body.keys : [body.key]
  const targets = (list as unknown[]).filter((x) => ownKey(uid, x))
  if (targets.length === 0) return resp(403, { error: '未提供可删除的文件（只能删除自己的文件）' })
  const done: Array<{ key: unknown; ok: boolean; status: number }> = []
  for (const key of targets.slice(0, 20)) {
    const r = await sb(`/storage/v1/object/${STORAGE_BUCKET}/${encodeURIComponent(String(key))}`, {
      method: 'DELETE',
    })
    done.push({ key, ok: r.status < 400, status: r.status })
  }
  return resp(200, { ok: true, deleted: done.filter((d) => d.ok).length, detail: done })
}

/* ---------------------------------------------------------------------------
 * 入口
 * ------------------------------------------------------------------------- */

Deno.serve(async (req: Request) => {
  const method = req.method.toUpperCase()
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (!SERVICE_KEY || !TOKEN_SECRET || !SUPABASE_URL) {
    return resp(500, { error: '服务端未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MIM_TOKEN_SECRET' })
  }

  const url = new URL(req.url)
  let rest = url.pathname
  // 路径形如 /functions/v1/mim-api/<业务路径>，截取业务段
  const marker = Math.max(rest.indexOf('/auth/'), rest.indexOf('/db/'), rest.indexOf('/storage/'))
  if (marker >= 0) rest = rest.slice(marker)

  let body: unknown = null
  if (method !== 'GET' && method !== 'HEAD') {
    const text = await req.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
  }

  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v
  })
  const token = headers['x-mim-token'] || (headers.authorization || '').replace(/^Bearer\s+/i, '')
  const session = await verifyToken(token, TOKEN_SECRET)
  const uid = session?.uid as string | undefined

  // ---- 鉴权 ----
  if (rest.startsWith('/auth/')) {
    const route = rest.slice('/auth'.length)
    if (route === '/register' && method === 'POST') return register((body ?? {}) as Record<string, unknown>)
    if (route === '/login' && method === 'POST') return login((body ?? {}) as Record<string, unknown>)
    if (route === '/bridge-login' && method === 'POST') return bridgeLogin((body ?? {}) as Record<string, unknown>)
    if (route === '/me') return me(token)
    return resp(404, { error: 'auth 路由不存在' })
  }

  // ---- 数据代理 ----
  if (rest.startsWith('/db/')) {
    const route = rest.slice('/db'.length)
    const rpcMatch = route.match(/^\/rpc\/([a-zA-Z_][a-zA-Z0-9_]*)$/)
    if (rpcMatch) return proxyRpc(rpcMatch[1], body, uid)
    const m = route.match(/^\/rest\/([^/?]+)/)
    if (!m) return resp(400, { error: '路径格式应为 /db/rest/<表名>' })
    return proxyDb({
      table: decodeURIComponent(m[1]),
      method,
      query: url.searchParams.toString(),
      body,
      uid,
      prefer: headers['prefer'],
    })
  }

  // ---- 云存储代理 ----
  if (rest.startsWith('/storage/')) {
    const route = rest.slice('/storage'.length)
    const qp = url.searchParams
    if (route === '/upload' && method === 'POST') {
      return storageUpload(uid, (body ?? {}) as Record<string, unknown>)
    }
    if (route === '/url' && method === 'GET') {
      return storageUrl(uid, qp.get('key') ?? '', qp.get('expiresIn') ?? '')
    }
    if (route === '/list' && method === 'GET') return storageList(uid, qp.get('prefix') ?? '')
    if (route === '/delete' && (method === 'POST' || method === 'DELETE')) {
      return storageDelete(uid, (body ?? {}) as Record<string, unknown>)
    }
    return resp(404, { error: 'storage 路由不存在' })
  }

  return resp(200, {
    ok: true,
    service: 'mim-api',
    routes: [
      '/auth/register', '/auth/login', '/auth/bridge-login', '/auth/me',
      '/db/rest/<table>', '/db/rpc/<fn>',
      '/storage/upload', '/storage/url', '/storage/list', '/storage/delete',
    ],
  })
})
