/* ==========================================================================
 * 后端数据客户端 —— 面向自托管 server 的 thin client
 *
 * 路由约定（与 server/api 一一对应）：
 *   GET    /rest/:table                 列表（?select=&eq=col.val&order=col.asc&limit=）
 *   GET    /rest/:table/:id             单条
 *   POST   /rest/:table                 新增（返回整行）
 *   PATCH  /rest/:table/:id             局部更新
 *   DELETE /rest/:table/:id             删除
 *   POST   /rpc/:fn                     服务端过程（库存/核销/发码等，必须走服务端）
 *   POST   /auth/register|login|logout
 *   GET    /auth/me
 *
 * 设计约束：
 *  1. 所有方法返回 Result<T>，绝不抛异常。
 *  2. 「表不存在 / 缺列」统一映射为 code='schema'，上层据此降级而不是崩溃。
 *  3. 写操作不重试（避免重复下单），读操作重试 1 次。
 * ======================================================================== */

import { get, post, patch, del } from '../core/http'
import type { Result } from '../core/result'

export type OrderDir = 'asc' | 'desc'

export interface ListQuery {
  /** 逗号分隔列名，缺省 `*`。用作投影，服务端会做白名单校验 */
  select?: string
  /** 等值过滤，形如 [['status','active'],['channel','gexm']] */
  eq?: Array<[string, string | number | boolean]>
  /** 排序 */
  order?: { col: string; asc?: boolean }
  limit?: number
  offset?: number
}

export interface RpcOptions {
  /** 写类过程显式声明，便于服务端审计与限流 */
  write?: boolean
}

function buildQuery(q: ListQuery): string {
  const usp = new URLSearchParams()
  if (q.select) usp.set('select', q.select)
  for (const [col, val] of q.eq ?? []) usp.append('eq', `${col}.${String(val)}`)
  if (q.order) usp.set('order', `${q.order.col}.${q.order.asc === false ? 'desc' : 'asc'}`)
  if (typeof q.limit === 'number') usp.set('limit', String(q.limit))
  if (typeof q.offset === 'number') usp.set('offset', String(q.offset))
  const s = usp.toString()
  return s ? `?${s}` : ''
}

export const db = {
  async list<T>(table: string, q: ListQuery = {}): Promise<Result<T[]>> {
    const r = await get<unknown>(`/rest/${table}${buildQuery(q)}`)
    if (!r.ok) return r
    return { ok: true, data: Array.isArray(r.data) ? (r.data as T[]) : [] }
  },

  async one<T>(table: string, id: string): Promise<Result<T | null>> {
    const r = await get<unknown>(`/rest/${table}/${encodeURIComponent(id)}`)
    if (!r.ok) return r
    return { ok: true, data: (r.data as T) ?? null }
  },

  async insert<T>(table: string, row: Record<string, unknown>): Promise<Result<T | null>> {
    const r = await post<unknown>(`/rest/${table}`, row)
    if (!r.ok) return r
    return { ok: true, data: (r.data as T) ?? null }
  },

  async update(table: string, id: string, patchBody: Record<string, unknown>): Promise<Result<boolean>> {
    const r = await patch<unknown>(`/rest/${table}/${encodeURIComponent(id)}`, patchBody)
    if (!r.ok) return r
    return { ok: true, data: true }
  },

  async remove(table: string, id: string): Promise<Result<boolean>> {
    const r = await del<unknown>(`/rest/${table}/${encodeURIComponent(id)}`)
    if (!r.ok) return r
    return { ok: true, data: true }
  },

  /** 服务端过程：库存扣减 / 券码核销 / 发码 / 退票等必须由服务端裁定的操作 */
  async rpc<T>(fn: string, params: Record<string, unknown> = {}, opts: RpcOptions = {}): Promise<Result<T>> {
    return post<T>(`/rpc/${fn}`, params, { retry: opts.write ? 0 : 1 })
  },
}

/* ---------- 认证 ---------- */

export interface LoginPayload {
  username: string
  password: string
}

export interface AuthUser {
  id: string
  username: string
  name: string
  emoji: string
  roles: string[]
  permissions: string[]
}

export interface AuthResult {
  token: string
  user: AuthUser
}

export const auth = {
  async register(payload: LoginPayload): Promise<Result<AuthResult>> {
    return post<AuthResult>('/auth/register', payload)
  },
  async login(payload: LoginPayload): Promise<Result<AuthResult>> {
    return post<AuthResult>('/auth/login', payload)
  },
  async logout(): Promise<Result<boolean>> {
    return post<boolean>('/auth/logout', {})
  },
  async me(): Promise<Result<AuthUser>> {
    return get<AuthUser>('/auth/me')
  },
}

/* ---------- 对象存储 ---------- */

export interface UploadedObject {
  key: string
  url: string
  size: number
}

export const storage = {
  async upload(file: File): Promise<Result<UploadedObject>> {
    const body = await fileToBase64(file)
    return post<UploadedObject>('/storage/upload', {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      body,
    })
  },
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result ?? '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
