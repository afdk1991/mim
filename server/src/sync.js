/* ============================================================================
 * 只读增量同步 —— GET /api/sync/posts
 *
 * 用途：外部镜像站 / 静态站按水位拉取"公开且未过期"的动态，只读、不可写。
 * 鉴权：请求头 x-sync-token 必须等于环境变量 SYNC_TOKEN（未配置则该端点关闭）。
 * 幂等：同一 since 反复请求返回同一批数据，调用方用返回的 next 作为下一次的 since。
 *
 * 刻意不做的事：
 *   - 不接受任何写操作，也没有分页游标以外的过滤条件（避免长成第二个 REST 面）
 *   - 不支持 visibility = 'self' 的内容（私密动态绝不出网关）
 * ========================================================================== */

import { createHash, timingSafeEqual } from 'node:crypto'
import { query } from './db.js'
import { badRequest, forbidden } from './errors.js'

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 200

/** 常量时间比较：长度不同时 timingSafeEqual 会直接抛错，故先各自摘要成等长缓冲 */
function sameToken(a, b) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * 校验同步令牌。
 * 未配置 SYNC_TOKEN 时视为"端点未启用"，而不是"谁都能访问"——
 * 漏配环境变量导致私密数据外泄，是这类接口最常见的事故。
 */
export function checkSyncToken(req) {
  const expected = process.env.SYNC_TOKEN ?? ''
  if (!expected) throw forbidden('同步接口未启用：服务端未配置 SYNC_TOKEN')
  const got = String(req.headers['x-sync-token'] ?? '')
  if (!got || !sameToken(got, expected)) throw forbidden('同步令牌不正确')
}

function parseSince(raw) {
  if (raw === null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw badRequest('since 必须是非负整数（毫秒时间戳）')
  return Math.floor(n)
}

function parseLimit(raw) {
  if (raw === null || raw === '') return DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) throw badRequest('limit 必须是正整数')
  return Math.min(Math.floor(n), MAX_LIMIT)
}

const COLUMNS = [
  'id',
  'author_id',
  'content',
  'images',
  'media',
  'topic',
  'source',
  'visibility',
  'created_at',
  'updated_at',
  'likes',
  'reposts',
  'views',
  'story',
  'expires_at',
  'pinned',
  'repost_of_id',
  'repost_comment',
  'vote',
  'lottery',
  'location',
].join(', ')

export async function syncPosts(searchParams) {
  const since = parseSince(searchParams.get('since'))
  const limit = parseLimit(searchParams.get('limit'))
  const now = Date.now()

  // 排序必须以"本次返回的水位"为准，且让 id 参与排序保证同一毫秒内也有稳定顺序，
  // 否则 next 游标会在并发写入时跳过行。
  const sql = `
    select ${COLUMNS}
      from posts
     where visibility = 'public'
       and coalesce(updated_at, created_at) > $1
       and (expires_at is null or expires_at > $2)
     order by coalesce(updated_at, created_at) asc, id asc
     limit $3`

  const rows = (await query(sql, [since, now, limit])).rows
  const last = rows.length ? rows[rows.length - 1] : null
  const next = last ? Number(last.updated_at ?? last.created_at) : since

  return {
    rows,
    next,
    has_more: rows.length === limit,
    server_time: now,
  }
}
