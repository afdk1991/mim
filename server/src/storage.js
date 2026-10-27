/* ============================================================================
 * 对象存储 —— 本地磁盘实现（贴合 core/config.ts 的体积上限，且不预置任何素材）
 *
 * 为什么不用 PG bytea：3MB 图片走 base64 进库会让表体积与 WAL 成倍膨胀，
 * 备份 Restore 时间不可控。本地目录 + 反向代理缓存是自托管场景的最小可用解，
 * 换成 S3/OSS 时只需替换本文件的 put/get 两个函数。
 * ========================================================================== */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { badRequest, notFound } from './errors.js'

const root = path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'data', 'uploads'))
const maxBytes = Number(process.env.UPLOAD_MAX_BYTES ?? 3 * 1024 * 1024)

const EXT_OF_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
}

function extOf(name, mime) {
  const fromName = path.extname(String(name ?? '')).toLowerCase()
  if (/^\.[a-z0-9]{1,5}$/.test(fromName)) return fromName
  return EXT_OF_MIME[String(mime ?? '').split(';')[0].trim()] ?? ''
}

/** key 只可含安全字符，且不允许 .. —— 防止读文件时越权穿越目录 */
function safeKey(key) {
  return typeof key === 'string' && /^[a-z0-9][a-z0-9._/-]*$/i.test(key) && !key.includes('..')
}

export async function put({ name, mime, body }) {
  const raw = typeof body === 'string' ? body : String(body ?? '')
  if (!raw) throw badRequest('缺少文件内容')
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw badRequest('文件内容需为 base64 编码')

  let buf
  try {
    buf = Buffer.from(raw, 'base64')
  } catch {
    throw badRequest('文件内容不是合法的 base64')
  }
  if (!buf.length) throw badRequest('文件内容为空')
  if (buf.length > maxBytes) {
    throw badRequest(`文件超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 上限，请压缩后再上传`)
  }

  const type = String(mime || 'application/octet-stream').split(';')[0].trim()
  const day = new Date().toISOString().slice(0, 10)
  const key = `${day}/${randomUUID()}${extOf(name, type)}`
  const target = path.join(root, key)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, buf)
  return { key, url: publicUrl(key), size: buf.length, mime: type }
}

export async function get(key) {
  if (!safeKey(key)) throw notFound('文件不存在')
  const target = path.join(root, key)
  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) throw notFound('文件不存在')
  const ext = path.extname(target).toLowerCase()
  const mime =
    Object.entries(EXT_OF_MIME).find(([, v]) => v === ext)?.[0] ?? 'application/octet-stream'
  return { body: await readFile(target), mime, size: info.size }
}

/** 未配置 PUBLIC_API_BASE 时返回同源绝对路径（配合 vite proxy 与网关反代） */
function publicUrl(key) {
  const base = (process.env.PUBLIC_API_BASE ?? '').replace(/\/+$/, '')
  return base ? `${base}/api/storage/${key}` : `/api/storage/${key}`
}

export const uploadDir = root
