/* 开放授权媒体检索网络层（Openverse + Wikimedia Commons）
   ------------------------------------------------------------------
   路由策略（审计结论驱动）：
   · Openverse：浏览器 CORS 支持不稳定（外部实测称未启用）+ 匿名限流
     5 次/小时 → 走自家 mim-api 的 /openverse/* 代理（服务端缓存 + 可选
     注册客户端提额）；仅当无代理（纯本地模式）才回退直连。
   · Wikimedia Commons：MediaWiki API 原生支持 origin=* CORS 且限流宽松，
     直接检索；文件直链在 upload.wikimedia.org，可被 <video>/<audio> 直接播放。
   所有请求统一走 fetchWithTimeout（AbortController + 15s），与 coze/ardot
   模块的超时约定一致；错误按类型细分（rate_limit/network/upstream/parse），
   供 UI 给出针对性文案。

   合规要点（审计 P1/P2）：
   · license_type 强制 commercial（仅收录可商用授权条目）；
   · 缺授权信息的条目一律标注「授权未知」，绝不冒充 CC/PD；
   · 结果做前端缓存（sessionStorage，5 分钟 TTL），降低上游压力、翻页即时。 */
import { cloudApiBase, cloudBackend } from './supabase'

export type OvMedia = 'videos' | 'audio'

export const OPENVERSE_DIRECT_BASE = 'https://api.openverse.org/v1'
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/* ------------------------------------------------------------------ */
/* 错误细分                                                            */
/* ------------------------------------------------------------------ */

export type OvErrorKind = 'rate_limit' | 'network' | 'upstream' | 'parse' | 'unknown'

export class OvError extends Error {
  readonly kind: OvErrorKind
  readonly status?: number
  constructor(kind: OvErrorKind, message: string, status?: number) {
    super(message)
    this.kind = kind
    this.status = status
    this.name = 'OvError'
  }
}

/** 限流（429）：开放 API 匿名仅 5 次/小时 */
export class OvRateLimitError extends OvError {
  constructor(message = 'rate limited') {
    super('rate_limit', message, 429)
    this.name = 'OvRateLimitError'
  }
}

/** 网络层失败：断网 / 跨域(CORS) / 超时(AbortError) */
export class OvNetworkError extends OvError {
  constructor(message = 'network error') {
    super('network', message)
    this.name = 'OvNetworkError'
  }
}

/** 上游返回非 2xx（代理透传的 5xx / 502 等） */
export class OvUpstreamError extends OvError {
  constructor(message = 'upstream error', status?: number) {
    super('upstream', message, status)
    this.name = 'OvUpstreamError'
  }
}

/** 响应体非合法 JSON（上游格式变更 / 网关返回 HTML 错误页） */
export class OvParseError extends OvError {
  constructor(message = 'parse error') {
    super('parse', message)
    this.name = 'OvParseError'
  }
}

/** 将任意异常归一到用户可理解的 { kind, message } */
export function classifyDiscError(e: unknown): { kind: OvErrorKind; message: string } {
  if (e instanceof OvRateLimitError) {
    return { kind: 'rate_limit', message: '检索太频繁（开放 API 限流），请稍后再试；也可手动添加片源。' }
  }
  if (e instanceof OvNetworkError) {
    return { kind: 'network', message: '网络或跨域限制，无法连接检索服务；可稍后重试，或手动添加片源。' }
  }
  if (e instanceof OvUpstreamError) {
    return { kind: 'upstream', message: `上游服务暂不可用（HTTP ${e.status ?? ''}），请稍后再试。` }
  }
  if (e instanceof OvParseError) {
    return { kind: 'parse', message: '返回数据解析失败，可能是上游格式变更；请稍后重试。' }
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      return { kind: 'network', message: '检索超时，请稍后再试。' }
    }
    if (/failed to fetch|networkerror|timeout|aborterror|cors|load failed/i.test(e.message)) {
      return { kind: 'network', message: '网络或跨域限制，无法连接检索服务；可稍后重试，或手动添加片源。' }
    }
  }
  return { kind: 'unknown', message: '在线发现暂不可用，可稍后重试，或手动添加片源。' }
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

/** 缺授权信息时返回空串（调用方显式显示「授权未知」，绝不冒充 CC/PD） */
export const UNKNOWN_LICENSE = '授权未知'

/** license 码 + 版本 → 展示名（cc-by + 4.0 → "CC-BY 4.0"；缺失 → 空串） */
export function licenseLabel(license?: unknown, version?: unknown): string {
  const code = typeof license === 'string' ? license.trim().toLowerCase() : ''
  if (!code) return ''
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

/** 授权信息是否已明确（非空串即视为已知） */
export function isLicenseKnown(label: string): boolean {
  return !!label && label !== UNKNOWN_LICENSE
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
    // 合规强制：默认仅收录可商用授权（commercial）
    license_type: opts.licenseType === 'modification' ? 'modification' : 'commercial',
  })
  return usp
}

/** 上游响应 → 统一检索结果（字段缺失安全兜底） */
export interface OvSearchResult {
  results: unknown[]
  page: number
  pageCount: number
  resultCount: number
  hasMore: boolean
}

export function normalizeSearch(
  json: unknown,
  pick: (r: unknown) => unknown | null,
  fallbackPage: number,
): OvSearchResult {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)
  const raw = Array.isArray(o.results) ? o.results : []
  const results: unknown[] = []
  for (const r of raw) {
    const it = pick(r)
    if (it) results.push(it)
  }
  const page = num(o.page, fallbackPage)
  const pageCount = Math.max(num(o.page_count, 1), 1)
  return {
    results,
    page,
    pageCount,
    resultCount: num(o.result_count, results.length),
    hasMore: page < pageCount,
  }
}

/** Commons 检索 URL（generator=search + prop=videoinfo 单请求取直链与授权）。
 *  offset>0 时追加 gsroffset 实现翻页（Commons generator 续查）。 */
export function commonsUrl(q: string, pageSize = 12, offset = 0): string {
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
  if (offset > 0) usp.set('gsroffset', String(clampInt(offset, 0, 100000, 0)))
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

/** Commons 是否还有更多页（query.continue.gsroffset 存在即表示可续查） */
export function commonsHasMore(json: unknown): boolean {
  const cont = (json as { query?: { continue?: { gsroffset?: unknown } } })?.query?.continue
  return !!cont && typeof cont.gsroffset === 'number'
}

/* ------------------------------------------------------------------ */
/* 前端结果缓存（sessionStorage，5 分钟 TTL）                          */
/* ------------------------------------------------------------------ */

const OV_CACHE_TTL_MS = 5 * 60 * 1000

function ovCacheKey(scope: string, q: string, page: number, offset: number): string {
  return `mim-ov-cache:${scope}:${q.trim().slice(0, 120)}:${page}:${offset}`
}

function ovCacheGet(key: string): OvSearchResult | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const o = JSON.parse(raw) as { at: number; payload: OvSearchResult }
    if (Date.now() - o.at > OV_CACHE_TTL_MS) return null
    return o.payload
  } catch {
    return null
  }
}

function ovCacheSet(key: string, payload: OvSearchResult): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), payload }))
  } catch {
    /* 隐私模式 / 配额满：缓存降级为不缓存，不影响主流程 */
  }
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
  let res: Response
  try {
    res = await fetchFn(url, { headers: { Accept: 'application/json' } })
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
      throw new OvNetworkError('timeout')
    }
    throw new OvNetworkError(e instanceof Error ? e.message : String(e))
  }
  if (res.status === 429) throw new OvRateLimitError('rate limited')
  if (!res.ok) throw new OvUpstreamError(`HTTP ${res.status}`, res.status)
  try {
    return await res.json()
  } catch {
    throw new OvParseError('invalid json')
  }
}

/**
 * Openverse 检索：优先 mim-api 代理；代理基座为空（本地模式）时直连。
 * 返回统一结构；结果映射（→ MjExtItem）由调用方负责。
 */
export async function searchOpenverse(
  q: string,
  opts: SearchOpts = {},
): Promise<OvSearchResult> {
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
  /** 翻页偏移（(page-1)*pageSize），由调用方计算 */
  offset?: number
  fetchFn?: FetchLike
  timeoutMs?: number
}

/** Wikimedia Commons 视频检索（CORS 友好直连，支持 gsroffset 翻页） */
export async function searchCommons(
  q: string,
  opts: CommonsOpts = {},
): Promise<OvSearchResult> {
  const offset = clampInt(opts.offset, 0, 100000, 0)
  const url = commonsUrl(q, opts.pageSize, offset)
  const fetchFn: FetchLike =
    opts.fetchFn ?? ((u, init) => fetchWithTimeout(u, opts.timeoutMs ?? 15000, init))
  const json = await getJson(url, fetchFn, opts.timeoutMs ?? 15000)
  // Commons 的返回是 {query:{pages:{...}}}（无 results 数组），先摊平再走统一归一化
  const norm = normalizeSearch({ results: commonsPages(json) }, (r) => r, 1)
  return { ...norm, hasMore: commonsHasMore(json) }
}

/* ----------------------------- 缓存封装 ----------------------------- */

/** 带前端缓存的 Openverse 检索（命中则跳过网络，翻页即时） */
export async function searchOpenverseCached(
  q: string,
  opts: SearchOpts = {},
): Promise<OvSearchResult> {
  const media = opts.media ?? 'videos'
  const page = clampInt(opts.page, 1, 1000, 1)
  const key = ovCacheKey(`ov:${media}`, q, page, 0)
  const hit = ovCacheGet(key)
  if (hit) return { ...hit, hasMore: hit.hasMore }
  const r = await searchOpenverse(q, opts)
  ovCacheSet(key, r)
  return r
}

/** 带前端缓存的 Commons 检索 */
export async function searchCommonsCached(q: string, opts: CommonsOpts = {}): Promise<OvSearchResult> {
  const offset = clampInt(opts.offset, 0, 100000, 0)
  const key = ovCacheKey('wc', q, Math.floor(offset / (opts.pageSize ?? 12)) + 1, offset)
  const hit = ovCacheGet(key)
  if (hit) return hit
  const r = await searchCommons(q, opts)
  ovCacheSet(key, r)
  return r
}
