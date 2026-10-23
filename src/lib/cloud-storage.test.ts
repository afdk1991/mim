/**
 * 云存储适配层单测（node 环境，无 jsdom）
 *
 * 只测纯判定逻辑 canUploadToCloud —— 它与服务端 MIME_ALLOW / MIME_DENY /
 * MAX_UPLOAD_BYTES 必须保持一致，否则会发出必然被拒（415/413）的请求。
 * 真实链路回归见 scripts/smoke-storage.mjs（打线上 API）。
 */
import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, canUploadToCloud } from './cloud-storage'

/** 构造指定大小与类型的文件（Node 20+ 提供全局 File） */
function fakeFile(size: number, type: string, name = 'x.bin'): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('canUploadToCloud', () => {
  it('放行图片 / 音频 / 视频', () => {
    expect(canUploadToCloud(fakeFile(1024, 'image/png'))).toBe(true)
    expect(canUploadToCloud(fakeFile(1024, 'audio/mpeg'))).toBe(true)
    expect(canUploadToCloud(fakeFile(1024, 'video/mp4'))).toBe(true)
  })

  it('拒绝非媒体类型（与服务端 415 一致）', () => {
    expect(canUploadToCloud(fakeFile(10, 'text/plain'))).toBe(false)
    expect(canUploadToCloud(fakeFile(10, 'application/pdf'))).toBe(false)
    expect(canUploadToCloud(fakeFile(10, ''))).toBe(false)
  })

  it('拒绝 svg（可内嵌脚本，服务端显式排除）', () => {
    expect(canUploadToCloud(fakeFile(10, 'image/svg+xml'))).toBe(false)
  })

  it('大小边界：等于上限放行，超过 1 字节即拒绝', () => {
    expect(canUploadToCloud(fakeFile(MAX_UPLOAD_BYTES, 'image/png'))).toBe(true)
    expect(canUploadToCloud(fakeFile(MAX_UPLOAD_BYTES + 1, 'image/png'))).toBe(false)
  })

  it('上限为 3MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(3 * 1024 * 1024)
  })
})
