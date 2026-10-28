// worker/src/index.ts —— Mim 可选边缘网关（Cloudflare Workers）
//
// 【定位说明】这是**可选边缘层**，不是 Mim 主路线。
// Mim 主路线 = 自托管 systemd + nginx（见 deploy/README.md），不依赖本目录。
// 仅当需要「境外用户就近接入 / 多运行时容灾 / 边缘只读副本」时才启用：
//   cd worker && wrangler deploy
//
// 职责（对齐 3.txt 架构手册的边缘层分工）：
//   1. /api/health 拨测端点：探测上游自托管主站，带密钥鉴权
//   2. 主请求转发：按地理与上游健康状态路由到主站（OCI_TUNNEL），故障时降级
//   3. Cron：拉取主站只读增量同步端点 server/src/sync.js（/api/sync/posts），
//      幂等写入 D1 只读副本（INSERT ... ON CONFLICT(id) DO UPDATE）
//
// 单向数据流：主站 PostgreSQL 是唯一可写源，D1 只是只读副本，不做任何写回。
// 运行时需要的绑定见 worker/wrangler.jsonc。

type Env = {
  // 上游自托管主站（如 Cloudflare Tunnel 地址，创建后在 wrangler 变量中填写）
  OCI_TUNNEL: string
  // 国内只读入口（可选；不需要境内层时留空字符串）
  CN_ORIGIN?: string

  // 存储绑定
  CACHE: KVNamespace      // 健康状态缓存、同步游标
  DB: D1Database           // 只读副本

  // 密钥
  SYNC_TOKEN: string       // 与主站 server/.env 的 SYNC_TOKEN 一致
  HEALTH_CHECK_SECRET: string

  APP_ENV: 'development' | 'production'
  MAINTENANCE_MODE?: boolean
}

// ===== 健康检查端点（供外部拨测） =====
async function handleHealth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (env.HEALTH_CHECK_SECRET && secret !== env.HEALTH_CHECK_SECRET) {
    return json({ error: 'unauthorized' }, 401)
  }

  const upstream = await probe(env.OCI_TUNNEL)
  return json({
    status: upstream ? 'healthy' : 'degraded',
    upstreams: { origin: upstream },
    env: env.APP_ENV,
    ts: Date.now(),
  }, 200)
}

// ===== 主请求：按健康状态转发到主站 =====
async function handleFetch(request: Request, env: Env): Promise<Response> {
  if (env.MAINTENANCE_MODE) {
    return new Response(
      '<!DOCTYPE html><html><body><h1>系统维护中</h1><p>我们正在升级服务，请稍后再试。</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  const url = new URL(request.url)

  // 健康状态缓存 60s，避免每个请求都探测一次
  const cached = await env.CACHE.get('upstream:health', 'json') as { healthy: boolean; ts: number } | null
  let originHealthy = cached?.healthy ?? true
  if (!cached || Date.now() - cached.ts > 60_000) {
    originHealthy = await probe(env.OCI_TUNNEL)
    await env.CACHE.put('upstream:health', JSON.stringify({ healthy: originHealthy, ts: Date.now() }), { expirationTtl: 120 })
  }

  // 路由决策：境外/默认走主站；主站挂了才考虑境内只读入口
  let target = env.OCI_TUNNEL
  let readOnly = false
  if (!originHealthy) {
    if (env.CN_ORIGIN) {
      target = env.CN_ORIGIN
      readOnly = true
    } else {
      return json({ error: 'upstream_unavailable', message: '服务暂时不可用，请稍后重试' }, 502)
    }
  }

  // 只读降级路径拒绝写操作
  if (readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return json({ error: 'read_only_region', hint: '当前区域仅支持读取，请切换主站域名提交' }, 503)
  }

  try {
    const upstream = await fetch(target + url.pathname + url.search, {
      method: request.method,
      headers: filterHeaders(request.headers),
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      signal: AbortSignal.timeout(15_000),
    })
    const headers = new Headers()
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
        headers.set(key, value)
      }
    })
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (err) {
    console.error('上游请求失败:', err)
    return json({ error: 'upstream_unavailable', message: '服务暂时不可用，请稍后重试' }, 502)
  }
}

// ===== Cron：从主站拉取只读增量，幂等写入 D1 副本 =====
async function syncPosts(env: Env): Promise<void> {
  const cursor = (await env.CACHE.get('sync:posts:cursor')) ?? '0'
  let next = cursor
  try {
    const r = await fetch(`${env.OCI_TUNNEL}/api/sync/posts?since=${cursor}&limit=500`, {
      headers: { 'x-sync-token': env.SYNC_TOKEN },
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) {
      console.warn(`同步失败: HTTP ${r.status}`)
      return
    }
    // Mim 主站响应外层是统一契约的 data 字段（main.js ok() 包装为 { data }）
    const body = (await r.json()) as {
      data: {
        rows: Array<{ id: string; content: string; created_at: number; updated_at: number }>
        next: number
      }
    }
    const { data } = body
    for (const row of data.rows) {
      await env.DB.prepare(
        `INSERT INTO posts (id, content, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET content=?2, created_at=?3, updated_at=?4`,
      )
        .bind(row.id, row.content, row.created_at, row.updated_at)
        .run()
    }
    next = String(data.next)
    await env.CACHE.put('sync:posts:cursor', next)
    console.log(`同步完成: ${data.rows.length} 条, 游标: ${next}`)
  } catch (err) {
    console.error('同步任务异常:', err)
  }
}

// ===== 辅助 =====
async function probe(url: string): Promise<boolean> {
  try {
    const r = await fetch(url + '/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'mim-edge-probe/1.0' },
    })
    return r.ok
  } catch {
    return false
  }
}

function filterHeaders(original: Headers): Headers {
  const filtered = new Headers()
  original.forEach((value, key) => {
    if (!['host', 'connection', 'transfer-encoding'].includes(key.toLowerCase())) {
      filtered.set(key, value)
    }
  })
  return filtered
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return handleHealth(request, env)
    return handleFetch(request, env)
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncPosts(env))
  },
}
