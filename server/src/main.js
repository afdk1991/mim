/* ============================================================================
 * HTTP 入口 —— node:http + 零框架依赖
 *
 * 响应契约（与前端 core/http.ts 严格对齐）：
 *   成功：HTTP 2xx + { data: … }（只允许这一个键，前端据此解包）
 *   失败：HTTP 状态码 + { error: { code, message } }，code 取自 core/result.ts 的 ErrCode
 * CORS：全开放 Origin + 允许 Authorization + OPTIONS 预检，否则前端跨域打不通。
 * ========================================================================== */

import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { close, ping } from './db.js'
import { authenticate, login, register, revokeToken } from './auth.js'
import * as rest from './rest.js'
import { callRpc, knownRpcs, sweepSeckillLocks } from './rpc.js'
import * as storage from './storage.js'
import { checkSyncToken, syncPosts } from './sync.js'
import { toApiError, badRequest } from './errors.js'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const MAX_BODY = Number(process.env.MAX_BODY_BYTES ?? 12 * 1024 * 1024)
const startedAt = Date.now()

/* ---------- 响应工具 ---------- */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Mim-Token,X-Sync-Token')
  res.setHeader('Access-Control-Max-Age', '86400')
  res.setHeader('Vary', 'Origin')
}

function json(res, status, payload, extra = {}) {
  cors(res)
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extra,
  })
  res.end(body)
}

const ok = (res, data, status = 200) => json(res, status, { data })

function fail(res, e) {
  const api = toApiError(e)
  if (api.status >= 500) console.error('[500]', api.cause ?? api.message)
  json(res, api.status, { error: { code: api.code, message: api.message } })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw badRequest('请求体过大')
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw badRequest('请求体不是合法 JSON')
  }
}

/* ---------- 路由 ---------- */

async function health() {
  let db = false
  try {
    db = await ping()
  } catch {
    db = false
  }
  return { ok: true, db, service: 'mim-server', uptime_ms: Date.now() - startedAt, rpcs: knownRpcs().length }
}

async function route(req, res, url) {
  const { pathname, searchParams } = url
  const path = pathname.replace(/\/+$/, '') || '/'
  const method = req.method ?? 'GET'

  if (!path.startsWith('/api')) {
    return json(res, 404, { error: { code: 'not_found', message: '未知接口，请带 /api 前缀' } })
  }
  const restPath = path.slice(4) // 去掉 /api

  /* --- 健康检查 --- */
  if (restPath === '/health' || restPath === '/healthz') return ok(res, await health())

  /* --- 认证 --- */
  if (restPath === '/auth/register') {
    const body = await readBody(req)
    return ok(res, await register(body), 201)
  }
  if (restPath === '/auth/login') return ok(res, await login(await readBody(req)))
  if (restPath === '/auth/logout') {
    const ctx = await tryAuth(req)
    if (ctx) await revokeToken(ctx)
    return ok(res, true)
  }
  if (restPath === '/auth/me') {
    const ctx = await authenticate(req)
    return ok(res, ctx.user)
  }

  /* --- 对象存储 --- */
  if (restPath === '/storage/upload' && method === 'POST') {
    await authenticate(req) // 上传必须登录：对象需要有可追溯的归属
    const { name, mime, body } = await readBody(req)
    return ok(res, await storage.put({ name, mime, body }), 201)
  }
  if (restPath.startsWith('/storage/') && method === 'GET') {
    const file = await storage.get(decodeURIComponent(restPath.slice('/storage/'.length)))
    cors(res)
    res.writeHead(200, {
      'Content-Type': file.mime,
      'Content-Length': file.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.end(file.body)
    return undefined
  }

  /* --- 只读增量同步：外部镜像按水位拉公开动态，令牌鉴权，无写能力 --- */
  if (restPath === '/sync/posts' && method === 'GET') {
    checkSyncToken(req)
    return ok(res, await syncPosts(searchParams))
  }

  /* --- RPC --- */
  if (restPath.startsWith('/rpc/')) {
    const fn = restPath.slice('/rpc/'.length)
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw badRequest(`非法函数名：${fn}`)
    const body = method === 'GET' ? Object.fromEntries(searchParams) : await readBody(req)
    const ctx = await authenticate(req)
    return ok(res, await callRpc(ctx, fn, body))
  }

  /* --- REST --- */
  if (restPath.startsWith('/rest/')) {
    const seg = restPath.slice('/rest/'.length).split('/').filter(Boolean)
    if (!seg.length) throw badRequest('缺少表名')
    const [table, id] = seg
    if (seg.length > 2) throw badRequest('路径过长')

    if (method === 'GET' && id === undefined) {
      const q = {
        select: searchParams.get('select') ?? undefined,
        eq: searchParams.getAll('eq'),
        order: searchParams.get('order') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        offset: searchParams.get('offset') ?? undefined,
      }
      return ok(res, await rest.list(await tryAuth(req), table, q))
    }

    const ctx = await authenticate(req)
    if (method === 'GET') return ok(res, await rest.one(ctx, table, decodeURIComponent(id)))
    if (method === 'POST') return ok(res, await rest.insert(ctx, table, await readBody(req)), 201)
    if (method === 'PATCH') return ok(res, await rest.update(ctx, table, decodeURIComponent(id), await readBody(req)))
    if (method === 'DELETE') return ok(res, await rest.remove(ctx, table, decodeURIComponent(id)))
    throw badRequest(`不支持的请求方法：${method}`)
  }

  return json(res, 404, { error: { code: 'not_found', message: `未知接口：${path}` } })
}

/** 读操作允许匿名（公共表），写操作由各模块自行鉴权；令牌损坏时按未登录处理 */
async function tryAuth(req) {
  if (!req.headers.authorization && !req.headers['x-mim-token']) return null
  return authenticate(req)
}

/* ---------- 服务器 ---------- */

/** AN-004：秒杀过期锁兜底定时器。主路径是 seckill_grab 事务内的懒清理，
 * 本定时器只兜底「无人再访问的老场次」；进程重启后丢失可接受（见 rpc.js）。 */
let sweepTimer

const server = http.createServer((req, res) => {
  const started = Date.now()
  const done = (status) => {
    const ms = Date.now() - started
    console.log(`${req.method} ${req.url} → ${status} ${ms}ms`)
  }

  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204, { 'Content-Length': 0 })
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  res.on('finish', () => done(res.statusCode))

  route(req, res, url).catch((e) => {
    const api = toApiError(e)
    done(api.status)
    if (res.writableEnded) return
    fail(res, e)
  })
})

export async function start(port = PORT, host = HOST) {
  server.listen(port, host)
  await once(server, 'listening')
  console.log(`[mim] 自托管后端已启动：http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/health`)
  console.log(`[mim] REST 表 ${rest.knownTables().length} 张，RPC ${knownRpcs().length} 个，上传目录 ${storage.uploadDir}`)

  // AN-004：启动即清理一次历史遗留的过期锁，之后每 60s 兜底一轮。
  // 清理失败只记日志，绝不影响服务本身（下次定时器/下次 grab 会再试）。
  void sweepSeckillLocks().catch((e) => console.error('[seckill] 启动清理过期锁失败', e.message))
  sweepTimer = setInterval(() => {
    void sweepSeckillLocks().catch((e) => console.error('[seckill] 清理过期锁失败', e.message))
  }, 60_000)
  return server
}

export async function stop() {
  if (sweepTimer) clearInterval(sweepTimer)
  server.close()
  await close()
}

/* 作为主模块时直接启动（npm run dev / node src/main.js）。
 * Windows 下 process.argv[1] 是反斜杠路径、import.meta.url 是 file:// URL，
 * 直接字符串比较会永远不相等 → 进程秒退（曾被误判为「启动失败」）。 */
const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entry && fileURLToPath(import.meta.url) === entry) {
  start().catch((e) => {
    console.error('[mim] 启动失败', e)
    process.exit(1)
  })
  const shutdown = async () => {
    await stop().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
