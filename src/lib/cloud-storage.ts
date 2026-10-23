/* 云端对象存储适配层（经 mim-api 代理 → CloudBase PG 存储桶 mim-media）。

   为什么不是浏览器直传：
     1) CloudBase 客户端 SDK 的上传依赖 SDK 自身登录态，而本环境匿名/邮箱通道关闭，
        账号体系为自建 ⇒ 浏览器拿不到可用于直传的凭据。
     2) 网关 CORS 只放行安全域名白名单（体验版不可加域名），直传会被 403。
   因此统一由云函数代理：它持有 service_role 凭据、自行回写 CORS，
   并把对象 key 强制收敛到 <uid>/… ⇒ 用户无法读写他人文件。

   本模块只做「上传 / 取签名链接 / 列目录 / 删除」四个动作；
   未登录或云端不可用时全部返回 ok:false，调用方应保持本地预览降级。
*/

import { cloudApiBase, cloudEnabled, cloudToken } from './supabase'

/** 单文件上限（与云函数 MAX_UPLOAD_BYTES 保持一致） */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/** 允许的类型前缀（与云函数 MIME_ALLOW 保持一致） */
const MIME_ALLOW = ['image/', 'video/', 'audio/']
/** 显式排除（与云函数 MIME_DENY 保持一致）：svg 可内嵌脚本，存在 XSS 面 */
const MIME_DENY = new Set(['image/svg+xml'])

export interface MediaObject {
  key: string
  name: string
  size: number
  mime: string | null
  updated: string | null
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** 云端存储是否可用：已接入云端且当前有登录令牌 */
export function cloudStorageReady(): boolean {
  return cloudEnabled && !!cloudToken()
}

/** 该文件是否满足云端上传条件（类型 + 体积）。与服务端规则一致，避免必然 415 的请求 */
export function canUploadToCloud(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  if (MIME_DENY.has(mime)) return false
  return MIME_ALLOW.some((p) => mime.startsWith(p)) && file.size <= MAX_UPLOAD_BYTES
}

async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  if (!cloudEnabled) return { ok: false, error: '未接入云端' }
  const token = cloudToken()
  if (!token) return { ok: false, error: '请先登录后再上传到云端' }
  try {
    const res = await fetch(`${cloudApiBase}${path}`, {
      ...init,
      headers: { 'x-mim-token': token, ...(init.headers || {}) },
    })
    const text = await res.text()
    let payload: any = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }
    if (res.status >= 400) {
      const msg =
        (payload && typeof payload === 'object' && (payload.error || payload.message)) ||
        `云端请求失败（HTTP ${res.status}）`
      return { ok: false, error: String(msg) }
    }
    return { ok: true, data: payload as T }
  } catch (e) {
    return { ok: false, error: `云端请求异常：${String((e as Error)?.message ?? e)}` }
  }
}

/** 读文件为 base64（不含 data: 前缀） */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const raw = String(fr.result || '')
      const idx = raw.indexOf(',')
      resolve(idx >= 0 ? raw.slice(idx + 1) : raw)
    }
    fr.onerror = () => reject(new Error('文件读取失败'))
    fr.readAsDataURL(file)
  })
}

/** 上传到云端，返回对象 key（形如 <uid>/<yyyy-mm>/<uuid>.<ext>） */
export async function uploadMedia(file: File): Promise<Result<{ key: string; bucket: string }>> {
  if (!canUploadToCloud(file)) {
    return { ok: false, error: file.size > MAX_UPLOAD_BYTES ? '文件超过 3MB 上限' : '仅支持图片 / 音频 / 视频' }
  }
  const data = await readAsBase64(file)
  return call<{ key: string; bucket: string }>('/storage/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', data }),
  })
}

/** 取临时可访问链接（默认 1 小时）。链接会过期，需展示时再取 */
export async function mediaUrl(key: string, expiresIn = 3600): Promise<Result<{ url: string }>> {
  return call<{ url: string }>(`/storage/url?key=${encodeURIComponent(key)}&expiresIn=${expiresIn}`)
}

/** 列出自己目录下的文件 */
export async function listMedia(prefix = ''): Promise<Result<{ items: MediaObject[] }>> {
  return call<{ items: MediaObject[] }>(`/storage/list${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`)
}

/** 删除自己的文件（keys 为对象 key 数组） */
export async function deleteMedia(keys: string[]): Promise<Result<{ deleted: number }>> {
  return call<{ deleted: number }>('/storage/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  })
}

/** 签名链接缓存：同一 key 在会话内复用，避免重复请求 */
const urlCache = new Map<string, { url: string; expiresAt: number }>()

/** 取展示用链接（带缓存，过期前 60s 重新取） */
export async function resolveMediaUrl(key: string): Promise<string | null> {
  const hit = urlCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.url
  const r = await mediaUrl(key)
  if (!r.ok || !r.data?.url) return null
  urlCache.set(key, { url: r.data.url, expiresAt: Date.now() + 3600_000 - 60_000 })
  return r.data.url
}
