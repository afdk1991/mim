/**
 * cloud-doc 单元测试（node 环境，无 jsdom）
 *
 * 通过 vi.mock 模拟 './supabase' 模块，覆盖：
 * - 未登录会话：get 返回 null / set 返回 true，且不发起任何表请求（跳过语义）
 * - 已登录读：有行返回 data、无行返回 null
 * - 已登录写：upsert 成功 true、失败 false
 * node 环境无 document，失败路径的 toast 依赖 cloud-doc 内部 try/catch 静默。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { supabase } from './supabase'
import { cloudDocGet, cloudDocSet } from './cloud-doc'

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    from: vi.fn(),
  },
  cloudEnabled: true,
}))

const getSession = (supabase as unknown as { auth: { getSession: Mock } }).auth.getSession
const from = (supabase as unknown as { from: Mock }).from

/** 构造 select 链式 mock：.select().eq().eq().maybeSingle() -> result */
function selectChain(result: { data: unknown; error: unknown }) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  q.select.mockReturnValue(q)
  q.eq.mockReturnValue(q)
  return q
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('未登录会话（跳过语义）', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } })
  })

  it('cloudDocGet 返回 null 且不发请求', async () => {
    await expect(cloudDocGet('mim-price-v1')).resolves.toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('cloudDocSet 返回 true 且不发请求', async () => {
    await expect(cloudDocSet('mim-price-v1', { a: 1 })).resolves.toBe(true)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('已登录读', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } } })
  })

  it('有行：返回 data 字段内容', async () => {
    from.mockReturnValue(selectChain({ data: { data: { wallet: 9 } }, error: null }))
    await expect(cloudDocGet<Record<string, number>>('k')).resolves.toEqual({ wallet: 9 })
  })

  it('无行：返回 null（而非报错）', async () => {
    from.mockReturnValue(selectChain({ data: null, error: null }))
    await expect(cloudDocGet('k')).resolves.toBeNull()
  })

  it('读失败：返回 null', async () => {
    from.mockReturnValue(selectChain({ data: null, error: { message: 'rls denied' } }))
    await expect(cloudDocGet('k')).resolves.toBeNull()
  })
})

describe('已登录写', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } } })
  })

  it('upsert 成功返回 true，且带上 user_id/key 与 onConflict', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    from.mockReturnValue({ upsert })
    await expect(cloudDocSet('k', { v: 1 })).resolves.toBe(true)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u-1', key: 'k', data: { v: 1 } }),
      { onConflict: 'user_id,key' },
    )
  })

  it('upsert 失败返回 false', async () => {
    from.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: { message: 'boom' } }) })
    await expect(cloudDocSet('k', { v: 1 })).resolves.toBe(false)
  })
})
