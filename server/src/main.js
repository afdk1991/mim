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
import { randomUUID } from 'node:crypto'
import { close } from './db.js'
import { authenticate, login, register, revokeToken } from './auth.js'
import * as rest from './rest.js'
import { callRpc, knownRpcs, sweepSeckillLocks } from './rpc.js'
import * as storage from './storage.js'
import { checkSyncToken, syncPosts } from './sync.js'
import * as iot from './iot.js'
import { ingest } from './events.js'
import { healthReport } from './health.js'
import { assertAllowed } from './rate-limit.js'
import { toApiError, badRequest } from './errors.js'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const MAX_BODY = Number(process.env.MAX_BODY_BYTES ?? 12 * 1024 * 1024)

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
  // 5xx 的详细错误已在 createServer 的 catch 里按结构化格式打过日志，这里不再重复打
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

async function route(req, res, url) {
  const { pathname, searchParams } = url
  const path = pathname.replace(/\/+$/, '') || '/'
  const method = req.method ?? 'GET'

  if (!path.startsWith('/api')) {
    return json(res, 404, { error: { code: 'not_found', message: '未知接口，请带 /api 前缀' } })
  }
  const restPath = path.slice(4) // 去掉 /api

  /* --- 健康检查（?full=1 深度检查：追加 migrations 明细）--- */
  if (restPath === '/health' || restPath === '/healthz') {
    const full = searchParams.get('full') === '1'
    return ok(res, await healthReport(full))
  }

  /* --- 无鉴权回声端点（GAP-02）：Coze 面板/连通性探测的第二探针 --- */
  if (restPath === '/hello') {
    return ok(res, { service: 'mim-server', hello: true, ts: Date.now() })
  }

  /* --- 埋点摄取：允许匿名（app_launch/首帧都发生在登录之前）---
   * 令牌坏了不连坐：降级为匿名上报，避免前端拿 401 反复重试刷爆日志。
   * user_id 由服务端按令牌回填，请求体里带什么 uid 都不认。 */
  if (restPath === '/events' && method === 'POST') {
    const ctx = await tryAuth(req).catch(() => null)
    const ip = req.socket?.remoteAddress ?? ''
    return ok(res, await ingest(ctx, await readBody(req), { ip }), 202)
  }

  /* --- 认证（限流：爆破重点，IP+auth 固定窗口） --- */
  if (restPath === '/auth/register') {
    assertAllowed(clientIp(req), 'auth')
    const body = await readBody(req)
    return ok(res, await register(body), 201)
  }
  if (restPath === '/auth/login') {
    assertAllowed(clientIp(req), 'auth')
    return ok(res, await login(await readBody(req)))
  }
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
    const headers = {
      'Content-Type': file.mime,
      'Content-Length': file.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
    // BE-003：SVG 内联脚本在同域回读时构成 stored-XSS 向量。
    // 方案：仅对 SVG 加 CSP default-src 'none'（内联脚本/样式失效，<img> 引用仍正常渲染）
    // + nosniff（浏览器不按 MIME 猜测执行）+ inline 提示；对图片/音视频不加，保持原有渲染行为。
    if (file.mime === 'image/svg+xml') {
      headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
      headers['X-Content-Type-Options'] = 'nosniff'
      headers['Content-Disposition'] = 'inline; filename="image.svg"'
    }
    res.writeHead(200, headers)
    res.end(file.body)
    return undefined
  }

  /* --- 只读增量同步：外部镜像按水位拉公开动态，令牌鉴权，无写能力 --- */
  if (restPath === '/sync/posts' && method === 'GET') {
    checkSyncToken(req)
    return ok(res, await syncPosts(searchParams))
  }

  /* --- IoT 长连接网关（10 号文 §2） ---
   * EMQX 钩子/上行用共享密钥鉴权，响应契约是 EMQX 约定的 { result }；
   * App 侧指令接口走用户鉴权 + 常规 { data } 包装。 */
  if (restPath === '/iot/hook/auth' && method === 'POST') {
    iot.checkHookToken(req)
    return json(res, 200, await iot.hookAuth(await readBody(req)))
  }
  if (restPath === '/iot/hook/acl' && method === 'POST') {
    iot.checkHookToken(req)
    return json(res, 200, await iot.hookAcl(await readBody(req)))
  }
  if (restPath === '/iot/hook/event' && method === 'POST') {
    iot.checkHookToken(req)
    return json(res, 200, await iot.hookEvent(await readBody(req)))
  }
  if (restPath === '/iot/uplink' && method === 'POST') {
    iot.checkHookToken(req)
    return ok(res, await iot.uplink(await readBody(req)))
  }
  if (restPath.startsWith('/iot/devices/')) {
    const seg = restPath.slice('/iot/devices/'.length).split('/').filter(Boolean).map(decodeURIComponent)
    if (seg.length === 2 && seg[1] === 'command' && method === 'POST') {
      const ctx = await authenticate(req)
      return ok(res, await iot.sendCommand(ctx, seg[0], await readBody(req)), 201)
    }
    if (seg.length === 3 && seg[1] === 'command' && method === 'GET') {
      const ctx = await authenticate(req)
      return ok(res, await iot.commandStatus(ctx, seg[0], seg[2]))
    }
    throw badRequest('未知设备接口')
  }

  /* --- RPC（限流：按 IP+函数名分桶，高频业务写另有更高阈值，见 rate-limit.js） --- */
  if (restPath.startsWith('/rpc/')) {
    const fn = restPath.slice('/rpc/'.length)
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw badRequest(`非法函数名：${fn}`)
    assertAllowed(clientIp(req), 'rpc', fn)
    const body = method === 'GET' ? Object.fromEntries(searchParams) : await readBody(req)
    // config_get 公开只读（登录前也要拿备案/客服等非敏感展示信息）；其余 RPC 一律需登录
    const ctx = fn === 'config_get' ? await tryAuth(req) : await authenticate(req)
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

    // BE-007：单条读与列表读权限对齐——公共表匿名可读，owner/admin 表在
    // rest.checkRead 内强制登录（原来单条强制 authenticate，与列表匿名可读不对称）。
    if (method === 'GET') {
      return ok(res, await rest.one(await tryAuth(req), table, decodeURIComponent(id)))
    }

    // 写操作：限流 + 强制登录
    assertAllowed(clientIp(req), 'rest')
    const ctx = await authenticate(req)
    if (method === 'POST') return ok(res, await rest.insert(ctx, table, await readBody(req)), 201)
    if (method === 'PATCH') return ok(res, await rest.update(ctx, table, decodeURIComponent(id), await readBody(req), searchParams))
    if (method === 'DELETE') return ok(res, await rest.remove(ctx, table, decodeURIComponent(id), searchParams))
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

/* ---------- 结构化日志 ----------
 * 请求访问日志统一 JSON 行（便于 journald / Loki 采集）：
 *   ts / level / request_id / method / path / status / ms / ip
 * 不记任何请求头（Authorization、Cookie、x-iot-hook-token 等敏感字段一律不落盘）。
 * request_id 每请求一个短 id，错误日志带同一个 id，可在 journalctl 里把
 * 「哪次请求、报了什么错」串起来。 */
function accessLog({ requestId, method, path, status, ms, ip }) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      request_id: requestId,
      method,
      path,
      status,
      ms,
      ip,
    }),
  )
}

function errorLog({ requestId, method, path, status, code, message, cause }) {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      request_id: requestId,
      method,
      path,
      status,
      code,
      message,
      cause,
    }),
  )
}

/** 取客户端 IP：nginx 反代后 socket 地址是 127.0.0.1，第一跳 X-Forwarded-For 才是真实来源 */
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return xff || req.socket?.remoteAddress || ''
}

const server = http.createServer((req, res) => {
  const started = Date.now()
  const requestId = randomUUID().slice(0, 8)
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const ip = clientIp(req)

  const done = (status) => {
    accessLog({ requestId, method, path: url.pathname, status, ms: Date.now() - started, ip })
  }

  if (method === 'OPTIONS') {
    cors(res)
    res.writeHead(204, { 'Content-Length': 0 })
    res.end()
    return
  }

  res.on('finish', () => done(res.statusCode))

  route(req, res, url).catch((e) => {
    const api = toApiError(e)
    done(api.status)
    errorLog({
      requestId,
      method,
      path: url.pathname,
      status: api.status,
      code: api.code,
      message: api.message,
      cause: api.cause?.message ?? '',
    })
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
