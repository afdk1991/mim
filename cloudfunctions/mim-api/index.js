/**
 * Mim 云端后端（CloudBase 云函数 · HTTP 访问服务）
 *
 * 存在的理由（平台硬限制）：
 *   1) CloudBase 不允许「用户名 + 密码」自助注册（signup 恒返回 501），
 *      且邮箱通道未启用、自定义登录 provider 无法注册 → 注册只能自建。
 *   2) CloudBase 网关 CORS 只放行安全域名白名单；体验版套餐不允许添加域名，
 *      导致 GitHub Pages / EdgeOne Pages 等线上域名一律 403。
 *      本函数自行回写 Access-Control-Allow-Origin: * → 全域名可用。
 *
 * 安全模型（重要）：
 *   数据库访问使用 service_role Key，它会**绕过 RLS**，
 *   因此所有权限必须由本函数强制注入：
 *     · 读：公开表放行；私有表强制追加 owner 列 = 当前 uid 过滤
 *     · 写：强制把 owner 列改写为当前 uid（无法通过伪造 body 越权）
 *     · 改/删：强制追加 owner 列 = 当前 uid 过滤
 *     · app_users / audit_logs 永远不代理（仅服务端使用）
 *   未登录请求只允许读公开表。
 */
const crypto = require('node:crypto')

const GW = 'https://cs-1-d5g815slocb5a611a.api.tcloudbasegateway.com'
const SERVICE_KEY = process.env.MIM_SERVICE_KEY || ''
const TOKEN_SECRET = process.env.MIM_TOKEN_SECRET || ''
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,apikey,x-mim-token,Prefer,Accept',
  'Access-Control-Max-Age': '86400',
}

// ---------------------------------------------------------------------------
// 表访问策略
// ---------------------------------------------------------------------------
/** 匿名与登录用户均可读（社区公开内容） */
const PUBLIC_READ = new Set([
  'posts', 'post_comments', 'articles', 'article_comments', 'snippets',
  'profiles', 'topics', 'hot_searches', 'resources',
])
/** 登录用户可读的参考数据；user_roles 额外按 uid 收敛 */
const AUTH_READ = new Set(['roles', 'permissions', 'role_permissions'])
/** 私有表 → 所属者列名 */
const OWNER_COL = {
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
const AUTHOR_COL = {
  posts: 'author_id',
  articles: 'author_id',
  snippets: 'author_id',
  post_comments: 'author_id',
  article_comments: 'author_id',
}
/**
 * 以自身主键归属的表（profiles.id = 用户 uid）。
 * 必须强制：否则已登录用户可伪造任意 id 建档或改他人资料。
 */
const SELF_ID_COL = { profiles: 'id' }
/** 仅服务端使用，禁止通过代理访问 */
const SERVER_ONLY = new Set(['app_users', 'audit_logs'])
/** 世界观点数据，禁止客户端写入 */
const READ_ONLY_TABLES = new Set(['topics', 'hot_searches', 'resources', 'roles', 'permissions', 'role_permissions'])

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function resp(status, obj, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }))
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyToken(token) {
  if (!token || !TOKEN_SECRET) return null
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const body = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expect = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url')
  if (sig.length !== expect.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!p || !p.uid) return null
    if (typeof p.iat === 'number' && Date.now() - p.iat > TOKEN_TTL_MS) return null
    return p
  } catch {
    return null
  }
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
}

function safeEqualHex(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** 调用 CloudBase PG（postgREST） */
async function pg(path, { method = 'GET', query = '', body, headers = {} } = {}) {
  const url = `${GW}${path}${query ? `?${query}` : ''}`
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  return { status: r.status, text, headers: r.headers }
}

function parsePg(text, status) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return status >= 400 ? { message: text } : text
  }
}

// ---------------------------------------------------------------------------
// 鉴权 API
// ---------------------------------------------------------------------------
async function register({ username, password, name }) {
  const u = String(username || '').trim()
  const p = String(password || '')
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) {
    return resp(400, { error: '用户名需为 3-32 位字母、数字、下划线、点或连字符' })
  }
  if (p.length < 8 || p.length > 72) {
    return resp(400, { error: '密码长度需为 8-72 位' })
  }

  const exist = await pg('/v1/rdb/rest/app_users', { query: `select=uid&username=eq.${encodeURIComponent(u)}` })
  if (exist.status >= 400) return resp(502, { error: '账号查询失败', detail: exist.text })
  const rows = parsePg(exist.text, exist.status) || []
  if (Array.isArray(rows) && rows.length > 0) return resp(409, { error: '该用户名已被注册' })

  const uid = `u_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
  const salt = crypto.randomBytes(16).toString('hex')
  const password_hash = hashPassword(p, salt)
  const displayName = String(name || '').trim() || u

  const ins = await pg('/v1/rdb/rest/app_users', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: { uid, username: u, password_hash, salt, name: displayName },
  })
  if (ins.status >= 400) return resp(502, { error: '创建账号失败', detail: ins.text })

  // 建档：profiles（失败不致命，前端会兜底显示用户名）
  await pg('/v1/rdb/rest/profiles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: { id: uid, name: displayName, emoji: '🙂', color: '#ff8200', bio: '' },
  })

  return resp(200, { token: signToken({ uid, username: u }), uid, username: u, name: displayName })
}

async function login({ username, password }) {
  const u = String(username || '').trim()
  const p = String(password || '')
  if (!u || !p) return resp(400, { error: '请输入用户名和密码' })

  const r = await pg('/v1/rdb/rest/app_users', {
    query: `select=uid,username,password_hash,salt,name,emoji&username=eq.${encodeURIComponent(u)}`,
  })
  if (r.status >= 400) return resp(502, { error: '账号查询失败', detail: r.text })
  const rows = parsePg(r.text, r.status)
  if (!Array.isArray(rows) || rows.length === 0) return resp(401, { error: '用户名或密码不正确' })

  const row = rows[0]
  const ok = safeEqualHex(hashPassword(p, row.salt), row.password_hash)
  if (!ok) return resp(401, { error: '用户名或密码不正确' })

  return resp(200, {
    token: signToken({ uid: row.uid, username: row.username }),
    uid: row.uid,
    username: row.username,
    name: row.name || row.username,
    emoji: row.emoji || '🙂',
  })
}

async function me(token) {
  const payload = verifyToken(token)
  if (!payload) return resp(401, { error: '登录已失效，请重新登录' })
  const r = await pg('/v1/rdb/rest/profiles', {
    query: `select=*&id=eq.${encodeURIComponent(payload.uid)}`,
  })
  const rows = parsePg(r.text, r.status)
  return resp(200, {
    uid: payload.uid,
    username: payload.username,
    profile: Array.isArray(rows) && rows[0] ? rows[0] : null,
  })
}

// ---------------------------------------------------------------------------
// 数据代理（强制权限注入）
// ---------------------------------------------------------------------------
function appendFilter(query, col, uid) {
  const clause = `${col}=eq.${encodeURIComponent(uid)}`
  return query ? `${query}&${clause}` : clause
}

async function proxyDb({ table, method, query, body, uid, prefer }) {
  if (!TABLE_NAME_RE.test(table)) return resp(400, { error: '非法表名' })
  if (SERVER_ONLY.has(table)) return resp(403, { error: '该表不允许访问' })

  const isRead = method === 'GET' || method === 'HEAD'
  const owner = OWNER_COL[table]
  const author = AUTHOR_COL[table]

  // 匿名：只允许读公开表
  if (!uid && !isRead) return resp(401, { error: '请先登录' })
  if (!uid && !PUBLIC_READ.has(table)) return resp(401, { error: '请先登录' })

  // 读
  if (isRead) {
    if (!PUBLIC_READ.has(table) && !AUTH_READ.has(table)) {
      if (owner) query = appendFilter(query, owner, uid)
      else return resp(403, { error: '该表不允许访问' })
    }
    if (table === 'user_roles') query = appendFilter(query, 'user_id', uid)
    const r = await pg(`/v1/rdb/rest/${table}`, { method, query, headers: prefer ? { Prefer: prefer } : {} })
    return resp(r.status, parsePg(r.text, r.status))
  }

  // 写：只读表拒绝
  if (READ_ONLY_TABLES.has(table)) return resp(403, { error: '该表为只读数据' })

  const headers = {}
  if (prefer) headers.Prefer = prefer

  if (method === 'POST') {
    let payload = body
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload)
      } catch {
        payload = null
      }
    }
    if (payload === null || payload === undefined) return resp(400, { error: '缺少请求体' })
    const stamp = (obj) => {
      if (!obj || typeof obj !== 'object') return obj
      if (author) obj[author] = uid
      if (owner) obj[owner] = uid
      const selfCol = SELF_ID_COL[table]
      if (selfCol) obj[selfCol] = uid
      return obj
    }
    payload = Array.isArray(payload) ? payload.map(stamp) : stamp(payload)
    const r = await pg(`/v1/rdb/rest/${table}`, { method, query, body: payload, headers })
    return resp(r.status, parsePg(r.text, r.status))
  }

  // PATCH / PUT / DELETE：强制归属过滤
  if (method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    const col = owner || author || SELF_ID_COL[table]
    if (!col) return resp(403, { error: '该表不允许修改' })
    query = appendFilter(query, col, uid)
    if (method !== 'DELETE' && body) {
      let payload = body
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload)
        } catch {
          payload = null
        }
      }
      if (payload && typeof payload === 'object') {
        // 不允许通过改归属来转移数据所有权
        delete payload[col]
        const r = await pg(`/v1/rdb/rest/${table}`, { method, query, body: payload, headers })
        return resp(r.status, parsePg(r.text, r.status))
      }
    }
    const r = await pg(`/v1/rdb/rest/${table}`, { method, query, headers })
    return resp(r.status, parsePg(r.text, r.status))
  }

  return resp(405, { error: '不支持的方法' })
}

/**
 * 私信写入：原库内 send_message RPC 依赖 auth.uid()，而本函数以 service_role 访问，
 * auth.uid() 为空会导致该函数抛错，故在服务端直接写「双行模型」两条记录。
 */
async function sendMessage({ uid, peer, content }) {
  if (!uid) return resp(401, { error: '请先登录' })
  const text = String(content || '').trim()
  if (!peer || !text) return resp(400, { error: '参数不完整' })
  if (peer === uid) return resp(400, { error: '不能给自己发消息' })

  const msgId = `m${crypto.randomUUID().replace(/-/g, '')}`
  const r = await pg('/v1/rdb/rest/messages', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: [
      { id: msgId, owner_id: uid, peer_id: peer, from_me: true, content: text, read: true },
      { id: msgId, owner_id: peer, peer_id: uid, from_me: false, content: text, read: false },
    ],
  })
  if (r.status >= 400) return resp(502, { error: '发送失败', detail: r.text })
  return resp(200, { ok: true, id: msgId })
}

/** RPC：仅允许白名单内的安全函数 */
const RPC_ALLOW = new Set(['bump_article_views', 'send_message'])
async function proxyRpc({ fn, body, uid }) {
  if (!RPC_ALLOW.has(fn)) return resp(403, { error: '该函数不允许调用' })
  let payload = body
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = {}
    }
  }
  payload = payload || {}

  if (fn === 'send_message') {
    return sendMessage({ uid, peer: payload.p_peer ?? payload.peer, content: payload.p_content ?? payload.content })
  }

  const r = await pg(`/v1/rdb/rest/rpc/${fn}`, { method: 'POST', body: payload })
  return resp(r.status, parsePg(r.text, r.status))
}

// ---------------------------------------------------------------------------
// 云存储代理（对象存储层）
// ---------------------------------------------------------------------------
/*
 * 为什么必须走云函数代理（而不是浏览器直传 sdk）：
 *   1) CloudBase 客户端 SDK 的 uploadFile 依赖 SDK 自身的登录态；
 *      本环境匿名登录与邮箱通道均关闭，注册为自建体系 ⇒ 浏览器拿不到可用于上传的登录态。
 *   2) 网关 CORS 只放行安全域名白名单（体验版不可加域名），浏览器直传会被 403。
 *   云函数以服务端身份写入存储，并自行回写 CORS ⇒ 任意部署域名可用。
 *
 * 存储形态：本环境为 CloudBase PostgreSQL 模式，旧 COS 接口（sdk 的 uploadFile /
 *   getTempFileURL）会直接报 STORAGE_NOT_SUPPORTED，必须走 PG 存储 HTTP API：
 *     POST   /v1/storages/object/<bucket>/<key>       上传（请求体即文件字节）
 *     POST   /v1/storages/object/sign/<bucket>/<key>  取签名下载链接 {expiresIn}
 *     POST   /v1/storages/object/list/<bucket>        列目录 {prefix,limit}
 *     DELETE /v1/storages/object/<bucket>/<key>       删除
 *   桶为私有（public=false），文件只能通过签名链接访问。
 *
 * 隔离模型（与数据库代理同构，全部由服务端强制，不接受客户端指定）：
 *   对象 key 固定为 <uid>/<yyyy-mm>/<uuid>.<ext>，首段即当前登录者的 uid。
 *   取链 / 删除前校验首段，越权 key 一律 403 —— 无法读写他人文件。
 */

/** 单文件上限：HTTP 访问服务请求体上限约 6MB，base64 膨胀 33%，取 3MB 留足余量 */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/** 允许的类型（按 MIME 前缀放行）。svg 可内嵌脚本存在 XSS 面，显式排除 */
const MIME_ALLOW = ['image/', 'video/', 'audio/']
const MIME_DENY = new Set(['image/svg+xml'])

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-msvideo': 'avi',
}

/** 从原始文件名取扩展名并做白名单收敛，避免 ../ 与双扩展名等路径问题 */
function safeExt(name, mime) {
  const byMime = EXT_BY_MIME[mime]
  if (byMime) return byMime
  const m = String(name || '').match(/\.([a-zA-Z0-9]{1,8})$/)
  const ext = m ? m[1].toLowerCase() : ''
  if (/^[a-zA-Z0-9]{1,8}$/.test(ext) && !/^(php|jsp|asp|aspx|sh|exe|html?|js)$/.test(ext)) return ext
  return 'bin'
}

/** 私有桶：文件只能通过签名链接访问（可由环境变量覆盖） */
const STORAGE_BUCKET = process.env.MIM_STORAGE_BUCKET || 'mim-media'

/** key 首段必须等于自己的 uid —— 无法读写他人文件 */
function ownKey(uid, key) {
  return typeof key === 'string' && key.startsWith(`${uid}/`) && !key.includes('..')
}

/** 调用 PG 存储 HTTP API（服务端 service_role 凭据） */
async function stor(path, { method = 'GET', body, contentType } = {}) {
  const headers = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }
  if (contentType) headers['Content-Type'] = contentType
  const r = await fetch(`${GW}${path}`, { method, headers, body })
  const text = await r.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: r.status, json, text }
}

async function storageUpload({ uid, body }) {
  if (!uid) return resp(401, { error: '请先登录' })
  const p = body && typeof body === 'object' ? body : {}
  const dataB64 = typeof p.data === 'string' ? p.data : ''
  if (!dataB64) return resp(400, { error: '缺少文件数据（base64）' })

  const buf = Buffer.from(dataB64, 'base64')
  if (!buf.length) return resp(400, { error: '文件内容为空' })
  if (buf.length > MAX_UPLOAD_BYTES) {
    return resp(413, { error: `文件过大，单文件上限 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB（HTTP 请求体限制）` })
  }

  const mime = String(p.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase()
  if (MIME_DENY.has(mime) || !MIME_ALLOW.some((prefix) => mime.startsWith(prefix))) {
    return resp(415, { error: `不支持的文件类型：${mime}（仅支持图片 / 音频 / 视频）` })
  }

  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const key = `${uid}/${ym}/${crypto.randomUUID()}.${safeExt(p.name, mime)}`

  const r = await stor(`/v1/storages/object/${STORAGE_BUCKET}/${key}`, {
    method: 'POST',
    body: buf,
    contentType: mime,
  })
  if (r.status >= 400) return resp(502, { error: '上传失败', detail: r.text.slice(0, 300) })
  return resp(200, {
    key,
    bucket: STORAGE_BUCKET,
    id: r.json && r.json.Id,
    size: buf.length,
    mime,
    name: String(p.name || ''),
  })
}

async function storageUrl({ uid, key, expiresIn }) {
  if (!uid) return resp(401, { error: '请先登录' })
  if (!ownKey(uid, key)) return resp(403, { error: '只能访问自己的文件' })
  const secs = Math.min(Math.max(Number(expiresIn) || 3600, 60), 86400)
  const r = await stor(`/v1/storages/object/sign/${STORAGE_BUCKET}/${key}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: secs }),
    contentType: 'application/json',
  })
  if (r.status >= 400) return resp(404, { error: '取链失败（文件可能不存在）', detail: r.text.slice(0, 300) })
  const url = (r.json && (r.json.fullSignedURL || r.json.signedURL)) || ''
  if (!url) return resp(404, { error: '取链失败', detail: r.text.slice(0, 300) })
  return resp(200, { key, url, expiresIn: secs })
}

async function storageList({ uid, prefix }) {
  if (!uid) return resp(401, { error: '请先登录' })
  // 前缀强制收敛到自己的目录：客户端传入的任何值都只作为自己的子目录使用
  const sub = String(prefix || '').replace(/^\/+/, '').replace(/\.\./g, '')
  const dir = `${uid}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '')
  const r = await stor(`/v1/storages/object/list/${STORAGE_BUCKET}`, {
    method: 'POST',
    body: JSON.stringify({ prefix: dir, limit: 100 }),
    contentType: 'application/json',
  })
  if (r.status >= 400) return resp(502, { error: '列目录失败', detail: r.text.slice(0, 300) })
  const objects = (r.json && r.json.objects) || []
  return resp(200, {
    bucket: STORAGE_BUCKET,
    dir,
    items: objects.map((o) => ({
      key: `${dir}/${o.name}`.replace(/^\/+/, ''),
      name: o.name,
      size: o.metadata ? o.metadata.size : (o.size ?? null),
      mime: o.metadata ? o.metadata.mimetype : null,
      updated: o.updated_at || o.created_at || null,
    })),
  })
}

async function storageDelete({ uid, body }) {
  if (!uid) return resp(401, { error: '请先登录' })
  const p = body && typeof body === 'object' ? body : {}
  const list = Array.isArray(p.keys) ? p.keys : [p.key]
  const targets = list.filter((x) => ownKey(uid, x))
  if (targets.length === 0) return resp(403, { error: '未提供可删除的文件（只能删除自己的文件）' })
  const done = []
  for (const key of targets.slice(0, 20)) {
    const r = await stor(`/v1/storages/object/${STORAGE_BUCKET}/${key}`, { method: 'DELETE' })
    done.push({ key, ok: r.status < 400, status: r.status })
  }
  return resp(200, { ok: true, deleted: done.filter((d) => d.ok).length, detail: done })
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
async function handler(event) {
  const method = (event.httpMethod || event.method || 'GET').toUpperCase()
  /* HTTP 头名大小写不敏感，但 CloudBase HTTP 访问服务透传的是原始大小写
     （curl 发 `Authorization`，浏览器可能发 `authorization`）。
     若直接读 headers.authorization，大小写不匹配时恒为 undefined
     ⇒ token 取空 ⇒ 所有需登录的接口一律 401。这里统一小写化后再读取。 */
  const headers = {}
  for (const k of Object.keys(event.headers || {})) headers[k.toLowerCase()] = (event.headers || {})[k]
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  let rawBody = event.body
  if (rawBody && event.isBase64Encoded) {
    try {
      rawBody = Buffer.from(rawBody, 'base64').toString('utf8')
    } catch {
      /* 保持原样 */
    }
  }
  let body = null
  if (rawBody) {
    try {
      body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody
    } catch {
      body = rawBody
    }
  }

  const path = String(event.path || event.requestContext?.path || '')
  // CloudBase HTTP 访问服务路径形如 /<函数名>/<业务路径>，这里截取业务段
  let rest = path
  const marker = Math.max(path.indexOf('/auth/'), path.indexOf('/db/'), path.indexOf('/storage/'))
  if (marker >= 0) rest = path.slice(marker)

  const qp = event.queryStringParameters || event.query || {}
  const query = Object.entries(qp)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
    .join('&')

  const token = headers['x-mim-token'] || headers['X-Mim-Token'] || (headers.authorization || '').replace(/^Bearer\s+/i, '')
  const session = verifyToken(token)

  if (!SERVICE_KEY || !TOKEN_SECRET) {
    return resp(500, { error: '服务端未配置 MIM_SERVICE_KEY / MIM_TOKEN_SECRET' })
  }

  // ---- 鉴权 ----
  if (rest.startsWith('/auth/')) {
    const route = rest.slice('/auth'.length)
    if (route === '/register' && method === 'POST') return register(body || {})
    if (route === '/login' && method === 'POST') return login(body || {})
    if (route === '/me') return me(token)
    return resp(404, { error: 'auth 路由不存在' })
  }

  // ---- 数据代理 ----
  if (rest.startsWith('/db/')) {
    const route = rest.slice('/db'.length)
    const rpcMatch = route.match(/^\/rpc\/([a-zA-Z_][a-zA-Z0-9_]*)$/)
    if (rpcMatch) return proxyRpc({ fn: rpcMatch[1], body, uid: session?.uid })
    const m = route.match(/^\/rest\/([^/?]+)/)
    if (!m) return resp(400, { error: '路径格式应为 /db/rest/<表名>' })
    return proxyDb({
      table: decodeURIComponent(m[1]),
      method,
      query,
      body,
      uid: session?.uid,
      prefer: headers['prefer'] || headers['Prefer'],
    })
  }

  // ---- 云存储代理 ----
  if (rest.startsWith('/storage/')) {
    const route = rest.slice('/storage'.length)
    if (route === '/upload' && method === 'POST') return storageUpload({ uid: session?.uid, body })
    if (route === '/url' && method === 'GET') return storageUrl({ uid: session?.uid, key: qp.key, expiresIn: qp.expiresIn })
    if (route === '/list' && method === 'GET') return storageList({ uid: session?.uid, prefix: qp.prefix })
    if (route === '/delete' && (method === 'POST' || method === 'DELETE')) return storageDelete({ uid: session?.uid, body })
    return resp(404, { error: 'storage 路由不存在' })
  }

  return resp(200, {
    ok: true,
    service: 'mim-api',
    routes: [
      '/auth/register', '/auth/login', '/auth/me',
      '/db/rest/<table>', '/db/rpc/<fn>',
      '/storage/upload', '/storage/url', '/storage/list', '/storage/delete',
    ],
  })
}

exports.main = async (event) => {
  try {
    return await handler(event || {})
  } catch (e) {
    return resp(500, { error: '服务端异常', detail: String(e && e.message ? e.message : e) })
  }
}
exports.main_handler = exports.main
