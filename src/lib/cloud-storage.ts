/* 云端对象存储适配层（双后端）。
 *
 *   Supabase 模式（主）：浏览器经 publishable key + 用户 JWT 直传 Storage 私有桶
 *     mim-media（RLS 限定 <uid>/ 前缀，见 supabase/migrations/0002_storage_media.sql），
 *     免去了服务端代理：Supabase Storage 原生开放 CORS，且 RLS 已在数据库侧强制隔离。
 *
 *   CloudBase 模式（备）：经 mim-api 代理上传。
 *     为什么 CloudBase 必须走代理（而不是浏览器直传 sdk）：
 *       1) CloudBase 客户端 SDK 的上传依赖 SDK 自身登录态，而本环境匿名/邮箱通道关闭，
 *          账号体系为自建 ⇒ 浏览器拿不到可用于直传的凭据。
 *       2) 网关 CORS 只放行安全域名白名单（体验版不可加域名），直传会被 403。
 *     云函数以服务端身份写入存储，并自行回写 CORS ⇒ 任意部署域名可用。
 *
 *   隔离模型（两个后端一致，全部由服务端/RLS 强制，不接受客户端指定）：
 *     对象 key 固定为 <uid>/<yyyy-mm>/<uuid>.<ext>，首段即当前登录者的 uid。
 *
 *   本模块只做「上传 / 取签名链接 / 列目录 / 删除」四个动作；
 *   未登录或云端不可用时全部返回 ok:false，调用方应保持本地预览降级。
 */

import { cloudApiBase, cloudBackend, cloudEnabled, cloudToken, cloudUid, sbClient } from './supabase'

/** 单文件上限（与云函数 MAX_UPLOAD_BYTES 保持一致；Supabase 桶侧同样设 3MB） */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/** 允许的类型前缀（与云函数 MIME_ALLOW 保持一致） */
const MIME_ALLOW = ['image/', 'video/', 'audio/']
/** 显式排除（与云函数 MIME_DENY 保持一致）：svg 可内嵌脚本，存在 XSS 面 */
const MIME_DENY = new Set(['image/svg+xml'])

/** 私有桶名（迁移 0002 中创建；RLS 限定 <uid>/ 前缀） */
const STORAGE_BUCKET = 'mim-media'

export interface MediaObject {
  key: string
  name: string
  size: number
  mime: string | null
  updated: string | null
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** 云端存储是否可用：已接入云端且当前有登录会话 */
export function cloudStorageReady(): boolean {
  if (!cloudEnabled) return false
  return cloudBackend === 'supabase' ? !!cloudUid() : !!cloudToken()
}

/** 该文件是否满足云端上传条件（类型 + 体积）。与服务端规则一致，避免必然 415 的请求 */
export function canUploadToCloud(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  if (MIME_DENY.has(mime)) return false
  return MIME_ALLOW.some((p) => mime.startsWith(p)) && file.size <= MAX_UPLOAD_BYTES
}

/* ---------------------------------------------------------------------------
 * CloudBase 代理分支（HTTP → mim-api → PG 存储）
 * ------------------------------------------------------------------------- */

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

/** 读文件为 base64（不含 data: 前缀）——CloudBase 代理接口需要 */
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

/* ---------------------------------------------------------------------------
 * Supabase 直传分支（Storage + RLS）
 * ------------------------------------------------------------------------- */

/** 从 MIME 收敛扩展名（白名单内）；与云函数 safeExt 同规则，防双扩展名/路径穿越 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-msvideo': 'avi',
}

function safeExt(name: string, mime: string): string {
  const byMime = EXT_BY_MIME[mime]
  if (byMime) return byMime
  const m = String(name || '').match(/\.([a-zA-Z0-9]{1,8})$/)
  const ext = m ? m[1].toLowerCase() : ''
  if (/^[a-zA-Z0-9]{1,8}$/.test(ext) && !/^(php|jsp|asp|aspx|sh|exe|html?|js)$/.test(ext)) return ext
  return 'bin'
}

/** 生成对象 key：<uid>/<yyyy-mm>/<uuid>.<ext>（首段即 uid，RLS 按前缀隔离） */
function buildKey(uid: string, file: File): string {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${uid}/${ym}/${uuid}.${safeExt(file.name, file.type || '')}`
}

/* ---------------------------------------------------------------------------
 * 统一动作（按后端分支）
 * ------------------------------------------------------------------------- */

/** 上传到云端，返回对象 key（形如 <uid>/<yyyy-mm>/<uuid>.<ext>） */
export async function uploadMedia(file: File): Promise<Result<{ key: string; bucket: string }>> {
  if (!canUploadToCloud(file)) {
    return { ok: false, error: file.size > MAX_UPLOAD_BYTES ? '文件超过 3MB 上限' : '仅支持图片 / 音频 / 视频' }
  }

  if (cloudBackend === 'supabase') {
    const sb = sbClient
    const uid = cloudUid()
    if (!sb || !uid) return { ok: false, error: '请先登录后再上传到云端' }
    const key = buildKey(uid, file)
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(key, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: { key, bucket: STORAGE_BUCKET } }
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
  if (cloudBackend === 'supabase') {
    const sb = sbClient
    if (!sb) return { ok: false, error: '未接入云端' }
    const secs = Math.min(Math.max(Number(expiresIn) || 3600, 60), 86400)
    const { data, error } = await sb.storage.from(STORAGE_BUCKET).createSignedUrls([key], secs)
    if (error) return { ok: false, error: error.message }
    const url = data?.[0]?.signedUrl
    if (!url) return { ok: false, error: '取链失败（文件可能不存在）' }
    return { ok: true, data: { url } }
  }
  return call<{ url: string }>(`/storage/url?key=${encodeURIComponent(key)}&expiresIn=${expiresIn}`)
}

/** 列出自己目录下的文件 */
export async function listMedia(prefix = ''): Promise<Result<{ items: MediaObject[] }>> {
  if (cloudBackend === 'supabase') {
    const sb = sbClient
    const uid = cloudUid()
    if (!sb || !uid) return { ok: false, error: '请先登录' }
    const sub = String(prefix || '').replace(/^\/+/, '').replace(/\.\./g, '')
    const dir = `${uid}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '')
    const { data, error } = await sb.storage
      .from(STORAGE_BUCKET)
      .list(dir, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
    if (error) return { ok: false, error: error.message }
    const items: MediaObject[] = (data ?? []).map((o) => ({
      key: dir ? `${dir}/${o.name}` : o.name,
      name: o.name,
      size: o.metadata?.size ?? 0,
      mime: o.metadata?.mimetype ?? null,
      updated: o.updated_at ?? o.created_at ?? null,
    }))
    return { ok: true, data: { items } }
  }
  return call<{ items: MediaObject[] }>(`/storage/list${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`)
}

/** 删除自己的文件（keys 为对象 key 数组） */
export async function deleteMedia(keys: string[]): Promise<Result<{ deleted: number }>> {
  if (cloudBackend === 'supabase') {
    const sb = sbClient
    const uid = cloudUid()
    if (!sb || !uid) return { ok: false, error: '请先登录' }
    // 双保险：客户端也只允许删自己的前缀（RLS 服务端同样强制）
    const own = keys.filter((k) => k.startsWith(`${uid}/`) && !k.includes('..'))
    if (own.length === 0) return { ok: false, error: '未提供可删除的文件（只能删除自己的文件）' }
    const { data, error } = await sb.storage.from(STORAGE_BUCKET).remove(own.slice(0, 20))
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: { deleted: (data ?? []).length } }
  }
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
