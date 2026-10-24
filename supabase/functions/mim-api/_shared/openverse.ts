/* Openverse 代理共享纯函数（Supabase Edge Function 与 CloudBase 云函数同契约）。
 *
 * 存在理由（审计结论）：
 *   · Openverse API 的浏览器 CORS 支持不稳定（外部实测称未启用），
 *     前端直连会被浏览器拦截 → 必须服务端转发；
 *   · 匿名限流仅 5 次/小时（100 次/天），注册客户端 10,000 次/天
 *     → 服务端集中缓存 + 可选注册凭证提额；
 *   · 查询参数白名单 + 类型钳制，防止把任意参数透传给上游。
 */

export const OPENVERSE_API = 'https://api.openverse.org/v1'
export const OPENVERSE_MEDIA = ['videos', 'audio'] as const
export type OpenverseMedia = (typeof OPENVERSE_MEDIA)[number]

/** 数值钳制：非数字 / 越界一律回落默认值 */
export function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return dflt
  return Math.min(Math.max(Math.trunc(n), min), max)
}

/** 关键词净化：去控制字符、压缩空白、限长（防注入与超长 URL） */
export function sanitizeQuery(q: unknown, maxLen = 120): string {
  if (typeof q !== 'string') return ''
  return q
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/** license_type 白名单（commercial=可商用 / modification=可修改 / 空=全部 CC） */
export function sanitizeLicenseType(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return s === 'commercial' || s === 'modification' ? s : 'commercial'
}

/** 构造上游检索 URL（参数白名单 + 钳制） */
export function buildOpenverseUrl(
  media: OpenverseMedia,
  params: {
    q: unknown
    page?: unknown
    pageSize?: unknown
    licenseType?: unknown
    license?: unknown
    source?: unknown
    extension?: unknown
  },
): string {
  const usp = new URLSearchParams()
  usp.set('q', sanitizeQuery(params.q))
  usp.set('page', String(clampInt(params.page, 1, 1000, 1)))
  usp.set('page_size', String(clampInt(params.pageSize, 1, 50, 12)))
  usp.set('license_type', sanitizeLicenseType(params.licenseType))
  const license = sanitizeQuery(params.license, 80)
  if (license) usp.set('license', license)
  const source = sanitizeQuery(params.source, 80)
  if (source) usp.set('source', source)
  const extension = sanitizeQuery(params.extension, 40)
  if (extension) usp.set('extension', extension)
  return `${OPENVERSE_API}/${media}/?${usp.toString()}`
}

/** 从上游响应提取分页元信息（字段缺失时安全兜底） */
export function openverseMeta(json: unknown, fallbackPage: number): {
  resultCount: number
  page: number
  pageCount: number
} {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)
  return {
    resultCount: num(o.result_count, 0),
    page: num(o.page, fallbackPage),
    pageCount: Math.max(num(o.page_count, 1), 1),
  }
}

/** 带 TTL 与容量上限的内存缓存（Edge 实例重启即自然失效，无需外部存储） */
export class TtlCache {
  private store = new Map<string, { at: number; body: unknown }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 50,
  ) {}

  get(key: string): unknown | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (Date.now() - hit.at > this.ttlMs) {
      this.store.delete(key)
      return undefined
    }
    // 命中后重置插入序（近似 LRU）
    this.store.delete(key)
    this.store.set(key, hit)
    return hit.body
  }

  set(key: string, body: unknown): void {
    this.store.set(key, { at: Date.now(), body })
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next()
      if (oldest.done) break
      this.store.delete(oldest.value)
    }
  }

  get size(): number {
    return this.store.size
  }
}

/** 注册客户端令牌响应（grant_type=client_credentials） */
export interface OvToken {
  access_token?: string
  expires_in?: number
}

/** 令牌是否仍有效（提前 60s 续期） */
export function tokenUsable(token: { token: string; exp: number } | null, now = Date.now()): boolean {
  return !!token && token.exp - now > 60_000
}
