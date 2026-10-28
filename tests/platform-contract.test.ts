import { afterEach, describe, expect, it } from 'vitest'
import {
  contractFailure,
  createMiniprogramAdapter,
  createMockAdapter,
  detectPlatformKind,
  getPlatform,
  runAdapterContract,
  setPlatform,
} from '../src/platform'
import type { ContractCase } from '../src/platform'
import type { WxLike } from '../src/platform/types'
import { createWebLikeAdapter } from '../src/platform/web'
import { createCapacitorAdapterForTest } from '../src/platform/capacitor'
import { listKeys, readRaw, writeRaw } from '../src/core/storage'
import { getTheme, setTheme } from '../src/core/theme'

/** 假 wx：只实现契约层声明的同步接口，行为与真机一致（缺键返回空串） */
function fakeWx(): WxLike {
  const data = new Map<string, string>()
  return {
    getStorageSync: (k) => (data.has(k) ? (data.get(k) as string) : ''),
    setStorageSync: (k, v) => {
      data.set(k, String(v))
    },
    removeStorageSync: (k) => {
      data.delete(k)
    },
    getStorageInfoSync: () => ({ keys: [...data.keys()] }),
    getSystemInfoSync: () => ({
      theme: 'dark',
      networkType: 'wifi',
      language: 'zh-CN',
      system: 'iOS 18',
      model: 'iPhone 16',
    }),
    setClipboardData: (opts) => opts.success?.(),
  }
}

async function assertContract(cases: ContractCase[], label: string): Promise<void> {
  const bad = cases.filter((c) => !c.ok)
  // 失败时把明细打出来，比只报一个 null/非 null 更容易定位是哪一端漏了能力
  expect(bad.map((c) => `${label} · ${c.name}${c.detail ? `（${c.detail}）` : ''}`)).toEqual([])
  expect(contractFailure(cases)).toBeNull()
}

describe('平台适配层契约（同一份用例对四端全绿）', () => {
  it('mock', async () => {
    await assertContract(await runAdapterContract(createMockAdapter()), 'mock')
  })

  it('web', async () => {
    await assertContract(await runAdapterContract(createWebLikeAdapter('web')), 'web')
  })

  it('capacitor（浏览器语义版本）', async () => {
    await assertContract(await runAdapterContract(createCapacitorAdapterForTest()), 'capacitor')
  })

  it('miniprogram（注入假 wx）', async () => {
    await assertContract(await runAdapterContract(createMiniprogramAdapter(fakeWx())), 'miniprogram')
  })

  it('miniprogram（无 wx 时退内存，仍须全绿）', async () => {
    await assertContract(await runAdapterContract(createMiniprogramAdapter(null)), 'miniprogram-no-wx')
  })

  it('contractFailure 能说清失败原因，全绿返回 null', () => {
    expect(
      contractFailure([
        { name: '故意失败', ok: false, detail: '示例原因' },
        { name: '通过项', ok: true },
      ]),
    ).toBe('故意失败（示例原因）')
    expect(contractFailure([{ name: '通过项', ok: true }])).toBeNull()
  })
})

describe('平台探测', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const savedWx = g.wx
  const savedCapacitor = g.Capacitor

  afterEach(() => {
    g.wx = savedWx
    g.Capacitor = savedCapacitor
    setPlatform(null)
  })

  it('存在 wx 时判定为 miniprogram', () => {
    g.wx = fakeWx()
    delete g.Capacitor
    expect(detectPlatformKind()).toBe('miniprogram')
  })

  it('Capacitor 原生时判定为 capacitor', () => {
    delete g.wx
    g.Capacitor = { isNativePlatform: () => true }
    expect(detectPlatformKind()).toBe('capacitor')
  })

  it('Capacitor 存在于浏览器（非原生）时仍为 web', () => {
    delete g.wx
    g.Capacitor = { isNativePlatform: () => false }
    expect(detectPlatformKind()).toBe('web')
  })

  it('什么宿主都没有时回退 web', () => {
    delete g.wx
    delete g.Capacitor
    expect(detectPlatformKind()).toBe('web')
    expect(getPlatform().kind).toBe('web')
  })

  it('显式注入优先于自动探测', () => {
    g.wx = fakeWx()
    setPlatform(createMockAdapter())
    expect(getPlatform().kind).toBe('mock')
    setPlatform(null)
    expect(getPlatform().kind).toBe('miniprogram')
  })
})

describe('上层存储 / 主题确实经过适配层', () => {
  afterEach(() => setPlatform(null))

  it('readRaw / writeRaw / listKeys 走注入的适配器', () => {
    const mock = createMockAdapter()
    setPlatform(mock)

    expect(readRaw('mim.probe')).toBeNull()
    writeRaw('mim.probe', 'v1')
    expect(readRaw('mim.probe')).toBe('v1')
    expect(listKeys('mim.')).toContain('mim.probe')
    expect(mock.calls()).toContain('storage.set:mim.probe')
  })

  it('未保存主题时采用系统偏好', () => {
    setPlatform(createMockAdapter({ prefersDark: true }))
    expect(getTheme()).toBe('dark')

    setPlatform(createMockAdapter({ prefersDark: false }))
    expect(getTheme()).toBe('light')
  })

  it('setTheme 同时落库并通知宿主应用主题', () => {
    const mock = createMockAdapter()
    setPlatform(mock)

    setTheme('dark')
    expect(readRaw('mim.theme')).toBe('dark')
    expect(mock.themeMode()).toBe('dark')
    expect(mock.calls()).toContain('storage.set:mim.theme')
    expect(getTheme()).toBe('dark')
  })
})
