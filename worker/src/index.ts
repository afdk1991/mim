// worker/src/index.ts —— Mim 可选边缘网关 v2（Cloudflare Workers）
//
// 【定位说明】这是**可选边缘层**，不是 Mim 主路线。
// Mim 主路线 = 自托管 systemd + nginx（见 deploy/README.md），不依赖本目录。
// 仅当需要「境外用户就近接入 / 多运行时容灾 / 边缘只读副本」时才启用：
//   cd worker && wrangler deploy
//
// v2 升级（对齐「全栈全站部署架构手册」边缘层分工）：
//   1. /api/health 拨测端点：探测全部上游，带密钥鉴权
//   2. 主请求转发：按 CF 地理（cf.country）+ 上游健康状态选路
//        - 中国大陆/HK/MO/TW 用户：优先 EdgeOne Makers 境内节点 → 国内备案只读入口 → Makers 亚太兜底（只读）
//        - 其他地区用户：优先 OCI 主站 → Makers 亚太 → 国内入口兜底（只读）
//      健康状态在 KV 缓存 60s，避免每个请求都探测
//   3. 只读降级：兜底路径（非首选上游）拒绝写操作，引导用户切主站域名
//   4. Cron：每天 03:00 UTC 拉主站 /api/sync/posts 增量，幂等写 D1 只读副本
//
// 单向数据流：主站 PostgreSQL 是唯一可写源，D1 只是只读副本，不做任何写回。
// 运行时需要的绑定见 worker/wrangler.jsonc。

type OriginHealth = {
  oci: boolean
  makers: boolean
  cn: boolean
  ts: number
}

type Env = {
  // 上游自托管主站（Cloudflare Tunnel 后的 OCI 服务器，必填）
  OCI_TUNNEL: string
  // EdgeOne Makers 亚太节点（境外用户容灾用，可选）
  MAKERS_ORIGIN?: string
  // EdgeOne Makers 境内节点（大陆用户首选，可选）
  CN_MAKERS_ORIGIN?: string
  // 国内备案域名只读入口（CloudBase/FC 等，可选）
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

const HEALTH_TTL_MS = 60_000

// ===== 健康检查端点（供外部拨测） =====
async function handleHealth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (env.HEALTH_CHECK_SECRET && secret !== env.HEALTH_CHECK_SECRET) {
    return json({ error: 'unauthorized' }, 401)
  }

  // 拨测时强制重新探测，不读缓存
  const [oci, makers, cn] = await Promise.all([
    probe(env.OCI_TUNNEL),
    probe(env.MAKERS_ORIGIN ?? ''),
    probe(env.CN_ORIGIN ?? ''),
  ])
  return json({
    status: [oci, makers, cn].some(Boolean) ? (oci ? 'healthy' : 'degraded') : 'down',
    upstreams: { oci, makers, cn },
    env: env.APP_ENV,
    ts: Date.now(),
  }, 200)
}

// ===== 主请求：地理 + 健康状态选路 =====
async function handleFetch(request: Request, env: Env): Promise<Response> {
  if (env.MAINTENANCE_MODE) {
    return new Response(await maintenancePage(env), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const url = new URL(request.url)
  const country = (request.cf?.country as string | undefined) ?? 'XX'
  const isCN = ['CN', 'HK', 'MO', 'TW'].includes(country)

  const health = await getHealth(env)

  // 选路决策
  let target = ''
  let readOnly = false
  if (isCN) {
    // 大陆用户：Makers 境内节点 → 国内备案入口 → Makers 亚太（只读兜底）
    if (env.CN_MAKERS_ORIGIN && health.makers) {
      target = env.CN_MAKERS_ORIGIN
    } else if (env.CN_ORIGIN && health.cn) {
      target = env.CN_ORIGIN
    } else if (env.MAKERS_ORIGIN && health.makers) {
      target = env.MAKERS_ORIGIN
      readOnly = true
    } else if (health.oci) {
      target = env.OCI_TUNNEL
    } else {
      return await fallbackError(request, env)
    }
  } else {
    // 境外用户：OCI 主站 → Makers 亚太（只读兜底）→ 国内入口（只读兜底）
    if (health.oci) {
      target = env.OCI_TUNNEL
    } else if (env.MAKERS_ORIGIN && health.makers) {
      target = env.MAKERS_ORIGIN
      readOnly = true
    } else if (env.CN_ORIGIN && health.cn) {
      target = env.CN_ORIGIN
      readOnly = true
    } else {
      return await fallbackError(request, env)
    }
  }

  // 只读降级路径拒绝写操作
  if (readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return json({
      error: 'read_only_region',
      hint: '当前区域仅支持读取，请切换主站域名提交',
    }, 503)
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
    console.error('上游请求失败:', target, err)
    return await fallbackError(request, env)
  }
}

// ===== 健康状态缓存（60s TTL） =====
async function getHealth(env: Env): Promise<OriginHealth> {
  const cached = await env.CACHE.get('upstream:health', 'json') as OriginHealth | null
  if (cached && Date.now() - cached.ts < HEALTH_TTL_MS) return cached

  const [oci, makers, cn] = await Promise.all([
    probe(env.OCI_TUNNEL),
    probe(env.MAKERS_ORIGIN ?? ''),
    probe(env.CN_ORIGIN ?? ''),
  ])
  const next: OriginHealth = { oci, makers, cn, ts: Date.now() }
  await env.CACHE.put('upstream:health', JSON.stringify(next), { expirationTtl: 120 })
  return next
}

// ===== Cron：从主站拉取只读增量，幂等写入 D1 副本 =====
async function syncPosts(env: Env): Promise<void> {
  const cursor = (await env.CACHE.get('sync:posts:cursor')) ?? '0'
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
    // next 为 "毫秒,id" 复合游标（BE-005 修复后），透传给下一次 since
    const body = (await r.json()) as {
      data: {
        rows: Array<{ id: string; content: string; created_at: number; updated_at: number }>
        next: string
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
    await env.CACHE.put('sync:posts:cursor', String(data.next))
    console.log(`同步完成: ${data.rows.length} 条, 游标: ${data.next}`)
  } catch (err) {
    console.error('同步任务异常:', err)
  }
}

// ===== 辅助 =====
async function probe(url: string): Promise<boolean> {
  if (!url) return false
  try {
    const r = await fetch(url + '/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'mim-edge-probe/2.0' },
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

async function maintenancePage(env: Env): Promise<string> {
  const cached = await env.CACHE.get('maintenance-page')
  if (cached) return cached
  return '<!DOCTYPE html><html lang="zh-CN"><body><h1>系统维护中</h1><p>我们正在升级服务，请稍后再试。</p></body></html>'
}

async function fallbackError(request: Request, env: Env): Promise<Response> {
  // GET/HEAD 请求优先返回缓存的静态错误页，避免整站空白
  if (['GET', 'HEAD'].includes(request.method)) {
    const cached = await env.CACHE.get('error-page')
    if (cached) return new Response(cached, { status: 502 })
  }
  return json({
    error: 'upstream_unavailable',
    message: '服务暂时不可用，请稍后重试',
  }, 502)
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
