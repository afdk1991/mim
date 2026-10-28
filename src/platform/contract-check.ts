/* ==========================================================================
 * 适配器契约测试 —— 任何一个端实现都必须通过的通用用例集
 *
 * 为什么放在 src 而不是 tests：新增端（如鸿蒙 / Tauri）的人也应当能在业务
 * 代码里直接 import 它自测，而不必等 CI。它是纯函数，无副作用。
 *
 * 判定标准只有一条：**同一份用例对任意 kind 都必须全绿**。任何一条红了，
 * 说明该端的能力语义和 Web 不一致，上层的本地优先逻辑会在这端失效。
 * ======================================================================== */

import type { IPlatformAdapter } from './types'

export interface ContractCase {
  name: string
  ok: boolean
  detail?: string
}

const KIND_WHITELIST = ['web', 'mock', 'capacitor', 'miniprogram']

export async function runAdapterContract(adapter: IPlatformAdapter): Promise<ContractCase[]> {
  const cases: ContractCase[] = []
  const tag = `mim.__contract__.${adapter.kind}.${Date.now()}`

  async function check(name: string, fn: () => boolean | Promise<boolean>, detail?: string): Promise<void> {
    try {
      const ok = await fn()
      cases.push({ name, ok, detail: ok ? undefined : detail })
    } catch (e) {
      cases.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }

  await check('kind 在允许列表内', () => KIND_WHITELIST.includes(adapter.kind), `未知 kind: ${adapter.kind}`)

  await check('storage.set → storage.get 读到同一值', () => {
    adapter.storage.set(tag, 'v1')
    return adapter.storage.get(tag) === 'v1'
  }, '写入后再读不一致')

  await check('storage 同键二次写入覆盖旧值', () => {
    adapter.storage.set(tag, 'v2')
    return adapter.storage.get(tag) === 'v2'
  }, '覆盖写入未生效')

  await check('storage.keys(prefix) 只返回带前缀的键', () => {
    const hit = adapter.storage.keys(tag)
    const all = adapter.storage.keys('')
    return hit.includes(tag) && !hit.some((k) => !k.startsWith(tag)) && all.includes(tag)
  }, '前缀过滤不成立')

  await check('storage.remove 后读回 null', () => {
    adapter.storage.remove(tag)
    return adapter.storage.get(tag) === null
  }, '删除后仍能读到值')

  await check('storage 未写入的键读回 null', () => adapter.storage.get(`${tag}.absent`) === null, '缺失键未返回 null')

  await check('env.prefersDark 返回 boolean', () => typeof adapter.env.prefersDark() === 'boolean', '返回类型不是 boolean')

  await check('env.isOnline 返回 boolean', () => typeof adapter.env.isOnline() === 'boolean', '返回类型不是 boolean')

  await check(
    'env.language 返回非空字符串',
    () => typeof adapter.env.language() === 'string' && adapter.env.language() !== '',
    '返回空字符串',
  )

  await check('env.userAgent 返回字符串', () => typeof adapter.env.userAgent() === 'string', '返回类型不是 string')

  await check('ui.applyTheme 不抛异常', () => {
    adapter.ui.applyTheme('dark')
    adapter.ui.applyTheme('light')
    return true
  })

  await check('ui.copyText 返回 boolean', async () => typeof (await adapter.ui.copyText('mim')) === 'boolean', '返回类型不是 boolean')

  await check(
    'ui.share 返回 boolean',
    async () => typeof (await adapter.ui.share({ title: 'Mim', url: 'https://example.com' })) === 'boolean',
    '返回类型不是 boolean',
  )

  await check(
    'ui.openExternal 返回 boolean',
    async () => typeof (await adapter.ui.openExternal('https://example.com')) === 'boolean',
    '返回类型不是 boolean',
  )

  return cases
}

/** 全绿才返回 null，否则返回一句话原因（供 CI / 脚本直接打印） */
export function contractFailure(cases: ContractCase[]): string | null {
  const bad = cases.filter((c) => !c.ok)
  if (bad.length === 0) return null
  return bad.map((c) => `${c.name}${c.detail ? `（${c.detail}）` : ''}`).join('；')
}
