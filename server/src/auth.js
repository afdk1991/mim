/* ============================================================================
 * 认证 —— 注册 / 登录 / 令牌签发校验 / 角色权限装载
 *
 * 密码：crypto.scrypt（N=16384, r=8, p=1）+ 每用户 16B 随机盐，
 *       存储串 `scrypt$N$r$p$saltHex$hashHex`，校验用 timingSafeEqual。
 * 令牌：自签 HMAC-SHA256，`base64url(payload).base64url(sig)`，
 *       payload = { uid, jti, iat, exp }；吊销按 jti 落 token_revocations，
 *       使「登出」对已签发令牌真正生效（无状态令牌 otherwise 登出后仍可继续用）。
 * ========================================================================== */

import { randomBytes, scrypt, createHmac, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { query, one } from './db.js'
import { badRequest, conflict, forbidden, noAuth } from './errors.js'

const scryptAsync = promisify(scrypt)

const N = 16_384
const r = 8
const p = 1
const KEYLEN = 64

const DEV_SECRET = 'mim-dev-secret-change-me'
const secret = process.env.JWT_SECRET || DEV_SECRET
const ttlMs = Number(process.env.TOKEN_TTL_MS ?? 7 * 24 * 3600 * 1000)

if (!process.env.JWT_SECRET) {
  console.warn('[auth] 未设置 JWT_SECRET，正在使用开发用默认密钥——生产部署必须显式设置')
}

/* ---------- 密码 ---------- */

export async function hashPassword(plain) {
  const salt = randomBytes(16)
  const key = await scryptAsync(plain, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`
}

async function derive(stored, plain) {
  const parts = String(stored).split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [, n, rr, pp, saltHex, keyHex] = parts
  const key = await scryptAsync(plain, Buffer.from(saltHex, 'hex'), Buffer.from(keyHex, 'hex').length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
    maxmem: 64 * 1024 * 1024,
  })
  return { expected: Buffer.from(keyHex, 'hex'), actual: key }
}

export async function verifyPassword(stored, plain) {
  const pair = await derive(stored, plain)
  if (!pair) return false
  if (pair.expected.length !== pair.actual.length) return false
  return timingSafeEqual(pair.expected, pair.actual)
}

/** 用户不存在时也做一次等价运算，避免「用户名不存在」被时序侧信道区分 */
const DUMMY_HASH = `scrypt$${N}$${r}$${p}$${'0'.repeat(32)}$${'0'.repeat(KEYLEN * 2)}`

/* ---------- 令牌 ---------- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

export function signToken(uid) {
  const payload = { uid, jti: randomBytes(16).toString('hex'), iat: Date.now(), exp: Date.now() + ttlMs }
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(body).digest()
  return `${body}.${b64url(sig)}`
}

export function parseToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expect = createHmac('sha256', secret).update(body).digest()
  const got = Buffer.from(sig, 'base64url')
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof payload?.uid !== 'string' || !payload.uid) return null
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

async function revoked(payload) {
  if (typeof payload.jti !== 'string' || !payload.jti) return false
  const row = await one('select 1 as hit from token_revocations where jti = $1', [payload.jti])
  return !!row
}

export async function revokeToken(payload) {
  if (!payload?.jti) return
  await query(
    `insert into token_revocations (jti, user_id, expires_at)
     values ($1, $2, to_timestamp($3 / 1000.0))
     on conflict (jti) do nothing`,
    [payload.jti, payload.uid, payload.exp ?? Date.now() + ttlMs],
  )
}

/* ---------- 身份装载 ---------- */

async function loadRoles(uid) {
  const [roles, perms] = await Promise.all([
    query('select r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1', [uid]),
    query(
      `select distinct p.key from user_roles ur
         join role_permissions rp on rp.role_id = ur.role_id
         join permissions p on p.id = rp.permission_id
        where ur.user_id = $1`,
      [uid],
    ),
  ])
  return { roles: roles.rows.map((x) => x.name), permissions: perms.rows.map((x) => x.key) }
}

/**
 * 首个管理员引导：全新库没有任何管理员时，运营方用 BOOTSTRAP_ADMIN_USERNAME
 * 指定账号，该账号下次装载身份时自动获得 admin 角色（一次性，有了管理员即失效）。
 * 这是「没有管理员就永远进不去后台」的唯一官方出口。
 */
async function bootstrapAdmin(uid, username) {
  const target = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim()
  if (!target || username !== target) return false
  const has = await one(
    `select 1 as hit from user_roles ur join roles r on r.id = ur.role_id
      where r.name = 'admin' limit 1`,
  )
  if (has) return false
  await query(
    `insert into user_roles (user_id, role_id)
     select $1, r.id from roles r where r.name = 'admin'
     on conflict do nothing`,
    [uid],
  )
  await query(
    `insert into audit_logs (actor_id, action, target_type, target_id, detail)
     values ($1, 'bootstrap_admin', 'user', $2, jsonb_build_object('source', 'env'))`,
    [uid, String(uid)],
  )
  console.warn(`[auth] BOOTSTRAP_ADMIN_USERNAME 命中，已授予 ${username} 首个管理员角色`)
  return true
}

export async function loadIdentity(uid) {
  const user = await one(
    'select id, username, name, emoji, status from users where id = $1',
    [uid],
  )
  if (!user) throw noAuth('账号不存在或已注销')
  if (user.status !== 'active') throw forbidden('账号已被停用')

  const base = {
    id: user.id,
    username: user.username,
    name: user.name || user.username,
    emoji: user.emoji || '🙂',
  }
  await bootstrapAdmin(uid, user.username)
  const { roles, permissions } = await loadRoles(uid)
  return { ...base, roles, permissions }
}

/** 每次请求鉴权：无令牌 → 401；令牌失效/吊销 → 401 */
export async function authenticate(req) {
  const raw = req.headers.authorization ?? ''
  const bearer = /^Bearer\s+(.+)$/i.exec(raw)?.[1] ?? req.headers['x-mim-token'] ?? ''
  if (!bearer) throw noAuth()
  const payload = parseToken(bearer)
  if (!payload) throw noAuth('登录已失效，请重新登录')
  if (await revoked(payload)) throw noAuth('令牌已失效，请重新登录')
  const user = await loadIdentity(payload.uid)
  const ctx = {
    uid: payload.uid,
    jti: payload.jti,
    user,
    isAdmin: () => user.roles.includes('admin'),
    hasRole: (name) => user.roles.includes(name),
    hasPerm: (key) => user.permissions.includes(key),
  }
  ctx.requireAdmin = () => {
    if (!ctx.isAdmin()) throw forbidden('仅管理员可执行该操作')
  }
  ctx.requirePerm = (key) => {
    if (!ctx.isAdmin() && !ctx.hasPerm(key)) throw forbidden(`缺少权限：${key}`)
  }
  return ctx
}

/* ---------- 注册 / 登录 ---------- */

const USERNAME_RE = /^[\w.@+-]{2,64}$/u

export async function register({ username, password }) {
  const name = String(username ?? '').trim()
  const pw = String(password ?? '')
  if (!USERNAME_RE.test(name)) throw badRequest('用户名需为 2~64 位字母、数字或 . _ - @ +')
  if (pw.length < 6 || pw.length > 128) throw badRequest('密码需为 6~128 位')

  const exist = await one('select 1 as hit from users where username = $1', [name])
  if (exist) throw conflict('用户名已被占用')

  const hash = await hashPassword(pw)
  const user = await one(
    `insert into users (username, password_hash, name, emoji)
     values ($1, $2, $3, $4) returning id, username, name, emoji`,
    [name, hash, name, '🙂'],
  )
  await query(
    `insert into profiles (id, username, name, emoji) values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [user.id, user.username, user.name, user.emoji],
  )
  await query(
    `insert into user_roles (user_id, role_id)
     select $1, r.id from roles r where r.name = 'user'
     on conflict do nothing`,
    [user.id],
  )
  await query(
    `insert into app_users (user_id, uid, username, source) values ($1, $2, $3, 'self')
     on conflict (user_id) do nothing`,
    [user.id, `u_${user.id.replaceAll('-', '')}`, user.username],
  )
  return issue(user)
}

export async function login({ username, password }) {
  const name = String(username ?? '').trim()
  const pw = String(password ?? '')
  if (!name || !pw) throw badRequest('用户名与密码不能为空')
  const user = await one(
    'select id, username, name, emoji, password_hash, status from users where username = $1',
    [name],
  )
  if (!user) {
    await verifyPassword(DUMMY_HASH, pw).catch(() => false)
    throw noAuth('用户名或密码错误')
  }
  if (!(await verifyPassword(user.password_hash, pw))) throw noAuth('用户名或密码错误')
  if (user.status !== 'active') throw forbidden('账号已被停用')
  return issue(user)
}

async function issue(user) {
  await bootstrapAdmin(user.id, user.username)
  const identity = await loadIdentity(user.id)
  return { token: signToken(user.id), user: identity }
}
