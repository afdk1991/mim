/* 云端适配层单测：用户名↔合成邮箱映射、后端选择逻辑。
   注意：本文件 import supabase.ts 会触发模块级客户端创建（Supabase 模式），
   用于同时验证「真实环境下适配层可正常初始化」。 */

import { describe, expect, it } from 'vitest'
import {
  cloudApiBase,
  cloudBackend,
  cloudEnabled,
  fromAuthEmail,
  supabase,
  toAuthEmail,
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
