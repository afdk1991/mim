/* ============================================================================
 * 只读增量同步拉取 —— node scripts/sync-pull.mjs
 *
 * 与后端 GET /api/sync/posts 配对的调用方实现：
 *   1. 从本地 state.json 读上次水位 since（首次为 0）
 *   2. 按 since → next 循环翻页，直到 has_more === false
 *   3. 按 id 合并进 posts.json（同一 id 用新版本覆盖），再原子写回
 *   4. 水位单独落盘，因此进程中断后重跑会从断点继续，不会重拉全量
 *
 * 用法：
 *   SYNC_TOKEN=xxxx node scripts/sync-pull.mjs
 *   SYNC_TOKEN=xxxx node scripts/sync-pull.mjs https://mim.example.com
 *   SYNC_TOKEN=xxxx SYNC_OUT=data/sync/posts.json node scripts/sync-pull.mjs
 *
 * 环境变量：
 *   SYNC_TOKEN       必填，与服务端 .env 的 SYNC_TOKEN 一致（留空则不发请求）
 *   MIM_API_BASE     后端地址，默认 http://127.0.0.1:8787
 *   SYNC_OUT         输出文件，默认 data/sync/posts.json
 *   SYNC_STATE       水位文件，默认与输出同目录的 state.json
 *   SYNC_LIMIT       单页条数，默认 200（服务端上限 500）
 *   SYNC_MAX_PAGES   单次运行最多翻多少页，默认 50（防止异常时死循环）
 *   SYNC_TIMEOUT_MS  单请求超时，默认 15000
 *
 * 刻意不做的事：
 *   - 不发送任何写请求（该端点本来就只读）
 *   - 不删除本地已存在但服务端已过期的条目：服务端过滤的是"此刻可见"，
 *     本地保留历史对镜像站更合适；需要清理请自行按 expires_at 处理
 * ========================================================================== */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const BASE = (process.argv[2] ?? process.env.MIM_API_BASE ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const TOKEN = process.env.SYNC_TOKEN ?? ''
const OUT_FILE = resolve(process.env.SYNC_OUT ?? 'data/sync/posts.json')
const STATE_FILE = resolve(process.env.SYNC_STATE ?? join(dirname(OUT_FILE), 'state.json'))
const LIMIT = clampInt(process.env.SYNC_LIMIT, 200, 1, 500)
const MAX_PAGES = clampInt(process.env.SYNC_MAX_PAGES, 50, 1, 1000)
const TIMEOUT_MS = clampInt(process.env.SYNC_TIMEOUT_MS, 15000, 1000, 120000)
const ATTEMPTS = 2

function clampInt(raw, fallback, min, max) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.floor(n), min), max)
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/** 拉一页；失败时把 HTTP 状态挂在 error.status 上，供重试判断 */
async function fetchPage(since) {
  const url = `${BASE}/api/sync/posts?since=${since}&limit=${LIMIT}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'x-sync-token': TOKEN },
      signal: ctrl.signal,
    })
    const text = await res.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!res.ok) {
      const inner = payload?.error
      const hint =
        res.status === 403
          ? '（403 表示端点未启用或令牌不符：服务端 .env 的 SYNC_TOKEN 必须非空且与本机一致）'
          : ''
      const e = new Error(
        `HTTP ${res.status}${inner?.code ? ` ${inner.code}` : ''} ${inner?.message ?? text.slice(0, 160)}${hint}`,
      )
      e.status = res.status
      throw e
    }

    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
    if (!data || !Array.isArray(data.rows) || !Number.isFinite(Number(data.next))) {
      throw new Error(`响应结构不符预期：${text.slice(0, 160)}`)
    }
    return { rows: data.rows, next: Number(data.next), hasMore: data.has_more === true }
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`请求超时（${TIMEOUT_MS}ms）：${url}`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 网络错误与 5xx 重试一次；4xx（令牌/参数）不重试 */
async function withRetry(fn) {
  let last
  for (let i = 0; i < ATTEMPTS; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const retriable = e?.status == null || e.status >= 500
      if (!retriable || i === ATTEMPTS - 1) throw e
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw last
}

async function main() {
  if (!TOKEN) {
    console.error('缺少 SYNC_TOKEN：请提供与服务端 .env 一致的同步令牌（openssl rand -hex 32 生成的那份）')
    process.exitCode = 2
    return
  }

  const state = await readJson(STATE_FILE)
  let since = Number.isFinite(state?.next) && state.next >= 0 ? Number(state.next) : 0
  const startedAt = since

  const existing = await readJson(OUT_FILE)
  const posts = new Map()
  if (Array.isArray(existing?.posts)) {
    for (const p of existing.posts) if (p?.id != null) posts.set(String(p.id), p)
  }

  console.log(`Mim 增量同步 → ${BASE}`)
  console.log(`  起点水位 ${since}，单页 ${LIMIT}，本次最多 ${MAX_PAGES} 页`)

  let pages = 0
  let pulled = 0
  while (pages < MAX_PAGES) {
    const page = await withRetry(() => fetchPage(since))
    pages += 1
    pulled += page.rows.length
    for (const row of page.rows) posts.set(String(row.id), row)

    if (!page.hasMore) {
      since = page.next
      break
    }
    if (page.next <= since) {
      console.warn(`  ! 水位未前进（${since} → ${page.next}），停止翻页以免死循环`)
      since = page.next
      break
    }
    since = page.next
  }

  const list = [...posts.values()].sort((a, b) => {
    const wa = Number(a.updated_at ?? a.created_at ?? 0)
    const wb = Number(b.updated_at ?? b.created_at ?? 0)
    return wa - wb || String(a.id).localeCompare(String(b.id))
  })
  const syncedAt = new Date().toISOString()

  await writeJsonAtomic(OUT_FILE, { synced_at: syncedAt, next: since, count: list.length, posts: list })
  await writeJsonAtomic(STATE_FILE, { next: since, synced_at: syncedAt })

  console.log(`✓ ${pages} 页 / 本次 ${pulled} 条 / 累计 ${list.length} 条`)
  console.log(`  水位 ${startedAt} → ${since}${pages >= MAX_PAGES ? '（已达单次页数上限，可再跑一次继续追）' : ''}`)
  console.log(`  输出 ${OUT_FILE}`)
}

main().catch((e) => {
  console.error(`✗ 同步失败：${e?.message ?? e}`)
  process.exitCode = 1
})
