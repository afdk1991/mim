/* ============================================================================
 * 埋点摄取 —— POST /api/events
 *
 * 与前端 src/core/telemetry.ts 的分工：
 *   前端负责「最少打扰」：白名单、脱敏、批量、失败重传；
 *   服务端负责「不可被欺骗」：格式校验、二次脱敏、限流、幂等、归因回填。
 * 前端的任何保证都不可信（可被绕过），所以这里必须重新校验一遍。
 *
 * 三条不可动摇的约束：
 *   1. user_id 只取自令牌（ctx.uid），请求体里带什么 uid 都不认 ——
 *      否则任何人都能伪造「某用户的付费事件」，把数据口径彻底污染。
 *   2. 不存明文 IP，只存 HMAC 截断值。
 *   3. eid 唯一索引做重传幂等：同一批重复提交不重复计数。
 * ========================================================================== */

import { randomBytes } from 'node:crypto'
import { query } from './db.js'
import { badRequest, forbidden } from './errors.js'
import { hashIp } from './secrets.js'

/** 事件名格式：`域_对象_动作`，与规范 §3 一致。这里只校验命名格式，
 *  业务白名单由前端 src/core/telemetry.ts 的 TRACK_EVENTS 维护（避免两处同步） */
const NAME_RE = /^[a-z][a-z0-9_]{2,63}$/
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

const MAX_BATCH = Number(process.env.EVENTS_MAX_BATCH ?? 100)
const MAX_PROPS_BYTES = Number(process.env.EVENTS_MAX_PROPS_BYTES ?? 4096)
const MAX_TEXT_LEN = 200
/** 客户端时间可信度：超过这个偏移就用服务端时间夹逼，避免脏时间把趋势图拉歪 */
const MAX_SKEW_MS = 24 * 3600 * 1000

/* 敏感键：与服务前端 scrub 保持同一份词汇，服务端再洗一遍 */
const SENSITIVE = [
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'authorization',
  'credential',
  'phone',
  'mobile',
  'idcard',
  'id_card',
  'bank',
  'card_no',
  'cvv',
  'verify_code',
  'cookie',
  'session_key',
]

/* ---------- 内存令牌桶（单进程限流） ----------
 * 说明：本项目是单实例自托管，进程内限流足够挡住「写死循环上报」这类事故。
 * 将来多实例部署时应换成 Redis/网关层限流，这里刻意不引入外部依赖。 */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = Number(process.env.EVENTS_MAX_PER_MIN ?? 600)
const buckets = new Map()

function ipOf(meta) {
  const raw = String(meta?.ip ?? '')
  // 反向代理后的来源 IP：这里取代理传入值的第一个非空段，仅用于限流与哈希，不作为安全依据
  return raw.split(',')[0]?.trim() ?? ''
}

function allow(key, cost) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now - b.ts > WINDOW_MS) {
    buckets.set(key, { ts: now, left: Math.max(0, MAX_PER_WINDOW - cost) })
    return cost <= MAX_PER_WINDOW
  }
  if (b.left < cost) return false
  b.left -= cost
  return true
}

/* 定期清理过期桶，避免 Map 随时间无限增长 */
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of buckets) if (now - v.ts > WINDOW_MS) buckets.delete(k)
}, WINDOW_MS)
// 该定时器不得阻止进程退出
sweeper.unref?.()

function truncate(v) {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT_LEN) : ''
}

/** 深度清洗 props：丢敏感键、丢函数/undefined、统一标量类型，返回纯净对象 */
function scrub(input, depth = 0) {
  if (input === null || input === undefined) return null
  if (depth > 3) return '[deep]'
  const type = typeof input
  if (type === 'string') return input.length > MAX_TEXT_LEN ? input.slice(0, MAX_TEXT_LEN) : input
  if (type === 'number') return Number.isFinite(input) ? input : null
  if (type === 'boolean') return input
  if (Array.isArray(input)) {
    return input.slice(0, 20).map((x) => scrub(x, depth + 1))
  }
  if (type !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof k !== 'string' || k.length > 64) continue
    const lower = k.toLowerCase()
    if (SENSITIVE.some((s) => lower.includes(s))) continue
    const cleaned = scrub(v, depth + 1)
    if (cleaned === null || cleaned === undefined) continue
    out[k] = cleaned
  }
  return out
}

function propsBytes(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj ?? {}), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function pickClampedTs(raw, nowMs) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return nowMs
  if (Math.abs(n - nowMs) > MAX_SKEW_MS) return nowMs // 脏时间：夹逼到服务端时间
  return Math.round(n)
}

/** 单条事件 → 行；不合规返回 null（计入 rejected，不影响同批其它事件） */
function normalize(raw, nowMs) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.event ?? raw.name ?? '')
  if (!NAME_RE.test(name)) return null

  const props = scrub(raw.props ?? {})
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null
  if (propsBytes(props) > MAX_PROPS_BYTES) return null

  const eidRaw = String(raw.eid ?? '')
  const eid = ID_RE.test(eidRaw) ? eidRaw : randomBytes(16).toString('hex')

  return {
    eid,
    name,
    ts_ms: pickClampedTs(raw.ts ?? (raw.props ? raw.props.ts : undefined), nowMs),
    anon_id: truncate(props.anon_id) || '',
    session_id: truncate(props.session_id) || '',
    app_version: truncate(props.app_version) || '',
    platform: truncate(props.platform) || '',
    path: truncate(props.path) || '',
    referrer: truncate(props.referrer) || '',
    props,
  }
}

const COLUMNS = [
  'eid',
  'name',
  'ts_ms',
  'user_id',
  'anon_id',
  'session_id',
  'app_version',
  'platform',
  'path',
  'referrer',
  'props',
  'ip_hash',
]

async function insertEvents(rows, userId, ipHash) {
  const perRow = COLUMNS.length
  const tuples = rows.map((_, i) => `(${COLUMNS.map((__, j) => `$${i * perRow + j + 1}`).join(',')})`)
  const params = rows.flatMap((r) => [
    r.eid,
    r.name,
    r.ts_ms,
    userId,
    r.anon_id,
    r.session_id,
    r.app_version,
    r.platform,
    r.path,
    r.referrer,
    JSON.stringify(r.props),
    ipHash,
  ])
  const r = await query(
    `insert into telemetry_events (${COLUMNS.join(',')}) values ${tuples.join(',')}
     on conflict (eid) do nothing`,
    params,
  )
  return r.rowCount ?? 0
}

/**
 * 摄取一批事件。
 * @param ctx 可能为 null：允许匿名上报（app_launch/首帧都发生在登录之前）
 */
export async function ingest(ctx, body, meta = {}) {
  const list = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : null
  if (!list) throw badRequest('请求体需为 { events: [...] }')
  if (!list.length) return { accepted: 0, deduped: 0, rejected: 0 }
  if (list.length > MAX_BATCH) throw badRequest(`单批事件过多，上限 ${MAX_BATCH} 条`)

  const ip = ipOf(meta)
  const ipHash = hashIp(ip)
  const key = `${ipHash ?? 'unknown'}|${String(ctx?.uid ?? '')}`
  if (!allow(key, list.length)) {
    throw badRequest(`上报过于频繁（单窗口上限 ${MAX_PER_WINDOW} 条/分钟）`)
  }

  const nowMs = Date.now()
  const rows = []
  let rejected = 0
  for (const raw of list) {
    const row = normalize(raw, nowMs)
    if (row) rows.push(row)
    else rejected += 1
  }
  if (!rows.length) return { accepted: 0, deduped: 0, rejected }

  // 归因只认令牌，请求体无从插手
  const accepted = await insertEvents(rows, ctx?.uid ?? null, ipHash)
  return { accepted, deduped: rows.length - accepted, rejected }
}

/**
 * 管理员口径摘要：让落库的数据能被算出来（否则只有插入没有消费，口径永远出不了数）。
 */
export async function eventSummary(ctx, p = {}) {
  if (!ctx?.isAdmin?.()) throw forbidden('仅管理员可查询埋点统计')
  const days = Number(p.p_days ?? 7)
  const d = Number.isFinite(days) ? Math.min(90, Math.max(1, Math.round(days))) : 7
  const since = Date.now() - d * 24 * 3600 * 1000

  const [byName, totals, daily] = await Promise.all([
    query(
      `select name,
              count(*)::int as cnt,
              count(distinct coalesce(user_id::text, nullif(anon_id, '')))::int as actors
         from telemetry_events
        where ts_ms >= $1
        group by name
        order by cnt desc
        limit 50`,
      [since],
    ),
    query(
      `select count(*)::int as total,
              count(distinct user_id)::int as users,
              count(distinct nullif(anon_id, ''))::int as anons
         from telemetry_events where ts_ms >= $1`,
      [since],
    ),
    query(
      `select to_char(to_timestamp(ts_ms / 1000.0), 'YYYY-MM-DD') as day,
              count(*)::int as cnt,
              count(distinct coalesce(user_id::text, nullif(anon_id, '')))::int as actors
         from telemetry_events
        where ts_ms >= $1
        group by 1
        order by 1`,
      [since],
    ),
  ])

  return {
    days: d,
    since,
    total: totals.rows[0]?.total ?? 0,
    users: totals.rows[0]?.users ?? 0,
    anons: totals.rows[0]?.anons ?? 0,
    by_name: byName.rows,
    daily: daily.rows,
  }
}
