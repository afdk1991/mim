/* 云端适配层单测：用户名↔合成邮箱映射、后端选择逻辑、CloudBase↔Supabase 账号桥。
   注意：本文件 import supabase.ts 会触发模块级客户端创建（Supabase 模式），
   用于同时验证「真实环境下适配层可正常初始化」。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bridgeLogin,
  cloudApiBase,
  cloudBackend,
  cloudEnabled,
  dualWriteCloudbase,
  fromAuthEmail,
  supabase,
  toAuthEmail,
  usernameTakenGlobally,
} from './supabase'

describe('用户名 ↔ GoTrue 合成邮箱映射', () => {
  it('用户名映射为 <username>@mim.app', () => {
    expect(toAuthEmail('alice')).toBe('alice@mim.app')
    expect(toAuthEmail('  alice  ')).toBe('alice@mim.app')
  })
  it('邮箱输入直通（兼容邮箱老账号）', () => {
    expect(toAuthEmail('bob@example.com')).toBe('bob@example.com')
  })
  it('空值安全', () => {
    expect(toAuthEmail('')).toBe('')
    expect(toAuthEmail(null as unknown as string)).toBe('')
  })
})

describe('合成邮箱反解为展示用户名', () => {
  it('合成邮箱去掉域名后缀', () => {
    expect(fromAuthEmail('alice@mim.app')).toBe('alice')
  })
  it('非合成邮箱原样返回', () => {
    expect(fromAuthEmail('bob@example.com')).toBe('bob@example.com')
  })
  it('空邮箱回退到 fallback', () => {
    expect(fromAuthEmail(null, 'anon')).toBe('anon')
    expect(fromAuthEmail('')).toBe('')
  })
})

describe('后端选择（三态）', () => {
  it('默认（auto）解析为已配置的后端之一', () => {
    expect(['supabase', 'cloudbase', 'local']).toContain(cloudBackend)
  })
  it('Supabase 模式下客户端可用且 cloudEnabled 为真', () => {
    if (cloudBackend !== 'supabase') return
    expect(supabase).not.toBeNull()
    expect(cloudEnabled).toBe(true)
    expect(cloudApiBase).toContain('supabase.co')
  })
  it('CloudBase 模式下 cloudApiBase 指向 mim-api', () => {
    if (cloudBackend !== 'cloudbase') return
    expect(cloudApiBase).toContain('/mim-api')
  })
})

describe('适配层客户端形态（Supabase 同形契约）', () => {
  it('from / rpc / channel / auth 齐备', () => {
    if (!supabase) return
    expect(typeof supabase.from).toBe('function')
    expect(typeof supabase.rpc).toBe('function')
    expect(typeof supabase.channel).toBe('function')
    expect(typeof supabase.removeChannel).toBe('function')
    expect(typeof supabase.auth.getSession).toBe('function')
    expect(typeof supabase.auth.signUp).toBe('function')
    expect(typeof supabase.auth.signInWithPassword).toBe('function')
    expect(typeof supabase.auth.signInWithOAuth).toBe('function')
    expect(typeof supabase.auth.onAuthStateChange).toBe('function')
  })
})

describe('账号桥 · bridgeLogin 响应映射', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const mockFetch = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue({
      status,
      json: async () => body,
    })

  it('200 + upgraded → upgraded（随后原密码重试原生登录）', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { upgraded: true }))
    expect(await bridgeLogin('alice', 'pw12345678')).toBe('upgraded')
  })

  it('200 但无 upgraded → none', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { upgraded: false }))
    expect(await bridgeLogin('alice', 'pw12345678')).toBe('none')
  })

  it('423 锁定 → locked', async () => {
    vi.stubGlobal('fetch', mockFetch(423, { error: '尝试次数过多' }))
    expect(await bridgeLogin('alice', 'pw12345678')).toBe('locked')
  })

  it('404 无桥接记录 / 409 已注册 / 502 异常 → none', async () => {
    for (const status of [404, 409, 502]) {
      vi.stubGlobal('fetch', mockFetch(status, { error: 'x' }))
      expect(await bridgeLogin('alice', 'pw12345678')).toBe('none')
    }
  })

  it('邮箱账号不走桥（直接 none，不发请求）', async () => {
    const fetchMock = mockFetch(200, { upgraded: true })
    vi.stubGlobal('fetch', fetchMock)
    expect(await bridgeLogin('bob@example.com', 'pw12345678')).toBe('none')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('网络异常 → none（静默跳过，不影响原生登录报错）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await bridgeLogin('alice', 'pw12345678')).toBe('none')
  })
})

describe('账号桥 · usernameTakenGlobally 查重', () => {
  it('RPC 返回 true → true', async () => {
    const raw = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) } as never
    expect(await usernameTakenGlobally(raw, 'alice')).toBe(true)
  })
  it('RPC 返回 false → false', async () => {
    const raw = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) } as never
    expect(await usernameTakenGlobally(raw, 'alice')).toBe(false)
  })
  it('RPC 不存在（迁移 0003 未应用）→ 放行 false', async () => {
    const raw = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Could not find function' } }) } as never
    expect(await usernameTakenGlobally(raw, 'alice')).toBe(false)
  })
  it('网络异常 → 放行 false（由 GoTrue 唯一约束兜底）', async () => {
    const raw = { rpc: vi.fn().mockRejectedValue(new Error('boom')) } as never
    expect(await usernameTakenGlobally(raw, 'alice')).toBe(false)
  })
  it('邮箱输入不查桥（GoTrue 自身处理）', async () => {
    const rpc = vi.fn()
    const raw = { rpc } as never
    expect(await usernameTakenGlobally(raw, 'bob@example.com')).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('账号桥 · dualWriteCloudbase 双写注册', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Supabase 模式下向 CloudBase /auth/register 发请求（fire-and-forget 不抛错）', async () => {
    if (cloudBackend !== 'supabase') return
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    expect(() => dualWriteCloudbase('alice', 'pw12345678')).not.toThrow()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/auth/register')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ username: 'alice', password: 'pw12345678' })
  })

  it('请求失败被吞掉（不抛未处理异常）', async () => {
    if (cloudBackend !== 'supabase') return
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('cloudbase down')))
    expect(() => dualWriteCloudbase('alice', 'pw12345678')).not.toThrow()
    await Promise.resolve()
  })
})
