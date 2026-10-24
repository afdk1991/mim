/* 开放授权媒体检索网络层（Openverse + Wikimedia Commons）
   ------------------------------------------------------------------
   路由策略（审计结论驱动）：
   · Openverse：浏览器 CORS 支持不稳定（外部实测称未启用）+ 匿名限流
     5 次/小时 → 走自家 mim-api 的 /openverse/* 代理（服务端缓存 + 可选
     注册客户端提额）；仅当无代理（纯本地模式）才回退直连。
   · Wikimedia Commons：MediaWiki API 原生支持 origin=* CORS 且限流宽松，
     直接检索；文件直链在 upload.wikimedia.org，可被 <video> 直接播放。
   所有请求统一走 fetchWithTimeout（AbortController + 15s），与 coze/ardot
   模块的超时约定一致；429 抛 OvRateLimitError 供 UI 给出针对性文案。 */
import { cloudApiBase, cloudBackend } from './supabase'

export type OvMedia = 'videos' | 'audio'

export const OPENVERSE_DIRECT_BASE = 'https://api.openverse.org/v1'
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/** 检索失败类型：rate_limit = 上游限流（429），network = 其他网络/解析失败 */
export class OvRateLimitError extends Error {
  readonly kind = 'rate_limit' as const
}

/** mim-api 代理基座：Supabase 模式拼 /functions/v1/mim-api；本地模式无代理（返回 ''） */
export function openverseProxyBase(): string {
  if (cloudBackend === 'supabase') return `${cloudApiBase}/functions/v1/mim-api`
  if (cloudBackend === 'cloudbase') return cloudApiBase
  return ''
}

/** 带超时的 fetch（与 coze.tsx / ardot.tsx 的约定一致） */
export async function fetchWithTimeout(
  url: string,
  ms = 15000,
  init: RequestInit = {},
): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 与 fetch 兼容的最小签名（便于测试注入） */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/* ------------------------------------------------------------------ */
/* 纯函数（可单测）                                                    */
/* ------------------------------------------------------------------ */

export function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return dflt
  return Math.min(Math.max(Math.trunc(n), min), max)
}

/** license 码 + 版本 → 展示名（cc-by + 4.0 → "CC-BY 4.0"；缺失 → "CC/PD"） */
export function licenseLabel(license?: unknown, version?: unknown): string {
  const code = typeof license === 'string' ? license.trim().toLowerCase() : ''
  if (!code) return 'CC/PD'
  const names: Record<string, string> = {
    cc0: 'CC0',
    by: 'CC-BY',
    'by-sa': 'CC-BY-SA',
    'by-nd': 'CC-BY-ND',
    'by-nc': 'CC-BY-NC',
    'by-nc-sa': 'CC-BY-NC-SA',
    'by-nc-nd': 'CC-BY-NC-ND',
    pdm: 'Public Domain Mark',
  }
  const name = names[code] ?? code.toUpperCase()
  const v = typeof version === 'string' ? version.trim() : ''
  return v && /^\d/.test(v) ? `${name} ${v}` : name
}

/** Openverse 检索参数（代理与直连共用同一套参数语义） */
export function openverseParams(
  q: string,
  opts: { media?: OvMedia; page?: number; pageSize?: number; licenseType?: string } = {},
): URLSearchParams {
  const usp = new URLSearchParams({
    q: q.trim(),
    page: String(clampInt(opts.page, 1, 1000, 1)),
    page_size: String(clampInt(opts.pageSize, 1, 50, 12)),
    license_type: opts.licenseType === 'modification' ? 'modification' : 'commercial',
  })
  return usp
}

/** 上游响应 → 统一检索结果（字段缺失安全兜底） */
export function normalizeSearch<T>(
  json: unknown,
  pick: (r: unknown) => T | null,
  fallbackPage: number,
): { results: T[]; page: number; pageCount: number; resultCount: number } {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)
  const raw = Array.isArray(o.results) ? o.results : []
  const results: T[] = []
  for (const r of raw) {
    const it = pick(r)
    if (it) results.push(it)
  }
  return {
    results,
    page: num(o.page, fallbackPage),
    pageCount: Math.max(num(o.page_count, 1), 1),
    resultCount: num(o.result_count, results.length),
  }
}

/** Commons 检索 URL（generator=search + prop=videoinfo 单请求取直链与授权） */
export function commonsUrl(q: string, pageSize = 12): string {
  const usp = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${q.trim()} filetype:video`,
    gsrnamespace: '6',
    gsrlimit: String(clampInt(pageSize, 1, 50, 12)),
    prop: 'videoinfo',
    viprop: 'url|extmetadata',
    iiurlwidth: '320',
  })
  return `${COMMONS_API}?${usp.toString()}`
}

/** Commons query.pages（对象）→ 数组（按 index 排序，缺省 0） */
export function commonsPages(json: unknown): Array<Record<string, unknown>> {
  const pages = (json as { query?: { pages?: unknown } })?.query?.pages
  if (!pages || typeof pages !== 'object') return []
  return (Object.values(pages) as Array<Record<string, unknown>>).sort(
    (a, b) => (typeof a.index === 'number' ? a.index : 0) - (typeof b.index === 'number' ? b.index : 0),
  )
}

/* ------------------------------------------------------------------ */
/* 网络请求                                                            */
/* ------------------------------------------------------------------ */

export interface SearchOpts {
  media?: OvMedia
  page?: number
  pageSize?: number
  licenseType?: string
  fetchFn?: FetchLike
  /** 代理基座；传 '' 表示强制直连（测试/本地模式用）。不传则自动解析 */
  proxyBase?: string
  timeoutMs?: number
}

async function getJson(url: string, fetchFn: FetchLike, timeoutMs: number): Promise<unknown> {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } })
  if (res.status === 429) throw new OvRateLimitError('rate limited')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as unknown
}

/**
 * Openverse 检索：优先 mim-api 代理；代理基座为空（本地模式）时直连。
 * 返回统一结构；结果映射（→ MjExtItem）由调用方负责。
 */
export async function searchOpenverse(
  q: string,
  opts: SearchOpts = {},
): Promise<ReturnType<typeof normalizeSearch>> {
  const media: OvMedia = opts.media ?? 'videos'
  const params = openverseParams(q, opts)
  const base = opts.proxyBase !== undefined ? opts.proxyBase : openverseProxyBase()
  const url = base
    ? `${base}/openverse/${media}?${params.toString()}`
    : `${OPENVERSE_DIRECT_BASE}/${media}/?${params.toString()}`
  const fetchFn: FetchLike =
    opts.fetchFn ?? ((u, init) => fetchWithTimeout(u, opts.timeoutMs ?? 15000, init))
  const json = await getJson(url, fetchFn, opts.timeoutMs ?? 15000)
  return normalizeSearch(json, (r) => r, clampInt(opts.page, 1, 1000, 1))
}

export interface CommonsOpts {
  pageSize?: number
  fetchFn?: FetchLike
  timeoutMs?: number
}

/** Wikimedia Commons 视频检索（CORS 友好直连；单页，无分页） */
export async function searchCommons(
  q: string,
  opts: CommonsOpts = {},
): Promise<ReturnType<typeof normalizeSearch>> {
  const url = commonsUrl(q, opts.pageSize)
  const fetchFn: FetchLike =
    opts.fetchFn ?? ((u, init) => fetchWithTimeout(u, opts.timeoutMs ?? 15000, init))
  const json = await getJson(url, fetchFn, opts.timeoutMs ?? 15000)
  // Commons 的返回是 {query:{pages:{...}}}（无 results 数组），先摊平再走统一归一化
  return normalizeSearch({ results: commonsPages(json) }, (r) => r, 1)
}
