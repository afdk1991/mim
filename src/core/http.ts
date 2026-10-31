/* ==========================================================================
 * HTTP 传输层 —— 全工程唯一的后端出入口
 *
 * 约定：
 *  1. 所有后端调用必须经本文件，页面与领域层不得直接 fetch，便于统一鉴权/重试/降级。
 *  2. 失败不抛异常，统一返回 Result<T>（见 core/result.ts），由调用方决定降级策略。
 *  3. 401 视为「未登录」而非错误，交给会话层处理刷新/登出。
 *  4. 超时默认 10s，写操作不重试（避免重复下单），读操作重试 1 次。
 * ======================================================================== */

import { ERR_CN, err, fail, isErrCode, ok } from './result'
import type { AppError, ErrCode, Result } from './result'
import { REQUEST_BASE, isBackendConfigured } from './config'
import { getPlatform } from '../platform'
import { markBackendOnline, markBackendOffline } from './backend-status'

const DEFAULT_TIMEOUT_MS = 10_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** 覆盖默认超时 */
  timeoutMs?: number
  /** 读操作失败重试次数（默认 1；写操作传 0） */
  retry?: number
  /** 附加请求头 */
  headers?: Record<string, string>
  /** 是否需要携带访问令牌（默认 true） */
  auth?: boolean
}

/** 令牌由会话层注入，避免 core 反向依赖 data 层造成循环 */
let tokenProvider: () => string | null = () => null

export function setTokenProvider(fn: () => string | null): void {
  tokenProvider = fn
}

function statusToCode(status: number): ErrCode {
  if (status === 401) return 'no_auth'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 400 || status === 422) return 'bad_request'
  if (status === 429 || status === 503) return 'busy'
  if (status >= 500) return 'server'
  return 'unknown'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

async function once(path: string, opts: RequestOptions): Promise<Result<unknown>> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false) {
    // 鉴权头由 core 层注入后再交给平台 http 能力；platform 层不得 import core
    const token = tokenProvider()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body)

  let raw: { ok: boolean; status: number; text: string }
  try {
    // 统一走平台适配层的 http 能力（web/capacitor 用 fetch，miniprogram 用 wx.request）
    raw = await getPlatform().http.request(method, `${REQUEST_BASE}${path}`, {
      headers,
      body,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  } catch (e) {
    markBackendOffline()
    return fail('offline', ERR_CN.offline, e)
  }

  // 网络层失败（status=0，如超时 / DNS 不可达）：统一视为离线
  if (!raw.ok && raw.status === 0) {
    markBackendOffline()
    return fail('offline', ERR_CN.offline)
  }

  // 任何 2xx 都视为后端在线（健康信号回流给 backend-status）
  if (raw.ok) markBackendOnline()

  const text = raw.text
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = null
    }
  }

  if (!raw.ok) {
    // 后端若返回 { error: { code, message } }，优先用它的文案
    const bodyObj = isRecord(payload) ? payload : null
    const inner = bodyObj && isRecord(bodyObj.error) ? bodyObj.error : null
    const code = inner && isErrCode(inner.code) ? inner.code : statusToCode(raw.status)
    const message =
      (inner && typeof inner.message === 'string' && inner.message) ||
      (bodyObj && typeof bodyObj.message === 'string' && bodyObj.message) ||
      ERR_CN[code]
    return fail(code, message, { status: raw.status })
  }

  // 后端约定：{ data: ... } 或裸数据
  if (isRecord(payload) && 'data' in payload && Object.keys(payload).length === 1) {
    return ok(payload.data)
  }
  return ok(payload ?? true)
}

/** 统一请求入口 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<Result<T>> {
  if (!isBackendConfigured()) {
    return fail('offline', ERR_CN.offline)
  }
  const retry = opts.retry ?? ((opts.method ?? 'GET') === 'GET' ? 1 : 0)
  let last: Result<unknown> = fail('unknown', ERR_CN.unknown)
  for (let i = 0; i <= retry; i += 1) {
    last = await once(path, opts)
    if (last.ok) return last as Result<T>
    // 鉴权/权限/参数类失败没必要重试
    if (last.error.code === 'no_auth' || last.error.code === 'forbidden' || last.error.code === 'bad_request') {
      return last as Result<T>
    }
  }
  return last as Result<T>
}

export const get = <T>(path: string, opts?: RequestOptions): Promise<Result<T>> =>
  request<T>(path, { ...opts, method: 'GET' })

export const post = <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<Result<T>> =>
  request<T>(path, { ...opts, method: 'POST', body: body ?? {}, retry: 0 })

export const patch = <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<Result<T>> =>
  request<T>(path, { ...opts, method: 'PATCH', body: body ?? {}, retry: 0 })

export const del = <T>(path: string, opts?: RequestOptions): Promise<Result<T>> =>
  request<T>(path, { ...opts, method: 'DELETE', retry: 0 })

/** 把 Result 折叠为可空值，供「失败即空态」的读取场景使用 */
export function orNull<T>(r: Result<T>): T | null {
  return r.ok ? r.data : null
}

export function toAppError(e: unknown): AppError {
  return err('unknown', e instanceof Error ? e.message : String(e), e)
}
