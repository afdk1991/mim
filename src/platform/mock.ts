/* ==========================================================================
 * Mock 适配器 —— 纯内存、无任何宿主依赖
 *
 * 用途：单元测试、SSR / 构建期、以及完全没有宿主环境的脚本里跑同一份业务代码。
 * 全部能力都有确定行为（不返回随机值），保证断言可复现。
 * ======================================================================== */

import type { IPlatformAdapter, KeyValueStore, PlatformEnv, PlatformUi, ThemeMode } from './types'

export interface MockOptions {
  prefersDark?: boolean
  online?: boolean
  language?: string
  userAgent?: string
  copyOk?: boolean
  shareOk?: boolean
  openOk?: boolean
  /** 预置键值，便于构造「已登录 / 已有草稿」等初始态 */
  seed?: Record<string, string>
}

export interface MockAdapter extends IPlatformAdapter {
  /** 最近一次 applyTheme 的入参；未调用过为 null */
  themeMode(): ThemeMode | null
  /** 按调用顺序记录的能力名，便于断言「有没有真的走适配层」 */
  calls(): string[]
}

export function createMockAdapter(opts: MockOptions = {}): MockAdapter {
  const data = new Map<string, string>(Object.entries(opts.seed ?? {}))
  const log: string[] = []
  let theme: ThemeMode | null = null

  const storage: KeyValueStore = {
    get(key) {
      log.push(`storage.get:${key}`)
      return data.has(key) ? (data.get(key) as string) : null
    },
    set(key, value) {
      log.push(`storage.set:${key}`)
      data.set(key, value)
    },
    remove(key) {
      log.push(`storage.remove:${key}`)
      data.delete(key)
    },
    keys(prefix = '') {
      return [...data.keys()].filter((k) => k.startsWith(prefix))
    },
  }

  const env: PlatformEnv = {
    prefersDark: () => opts.prefersDark === true,
    isOnline: () => opts.online !== false,
    language: () => opts.language || 'zh-CN',
    userAgent: () => opts.userAgent ?? 'mock',
  }

  const ui: PlatformUi = {
    applyTheme(mode) {
      log.push(`ui.applyTheme:${mode}`)
      theme = mode
    },
    async copyText(text) {
      log.push(`ui.copyText:${text.length}`)
      return opts.copyOk !== false
    },
    async share(payload) {
      log.push(`ui.share:${payload.url ?? payload.title ?? ''}`)
      return opts.shareOk !== false
    },
    async openExternal(url) {
      log.push(`ui.openExternal:${url}`)
      return opts.openOk !== false
    },
  }

  return {
    kind: 'mock',
    storage,
    env,
    ui,
    themeMode: () => theme,
    calls: () => [...log],
  }
}
