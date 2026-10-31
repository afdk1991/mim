/* ==========================================================================
 * Capacitor 适配器 —— Android / iOS 原生壳内的 WebView
 *
 * 与 Web 的差异只有两处真实存在的能力：
 *   1. 外链必须走 `@capacitor/browser`（WebView 内 window.open 会被系统拦掉）；
 *   2. 原生判定来自 `globalThis.Capacitor.isNativePlatform()`。
 * 其余（localStorage、navigator.clipboard、navigator.share）与 Web 完全一致，
 * 直接复用 `webStorage` / `webEnv` / `webHttp`，避免两套实现漂移。
 *
 * 注意：这里只读 `globalThis.Capacitor`，不静态 import `@capacitor/core`，
 * 这样纯 Web 构建不会因为该包注入而把自己误判成原生环境。
 * ======================================================================== */

import type { IPlatformAdapter, PlatformUi } from './types'
import { hostGlobals } from './types'
import {
  applyThemeMode,
  createWebLikeAdapter,
  defaultCopyText,
  defaultOpenExternal,
  defaultShare,
  webEnv,
  webHttp,
  webStorage,
} from './web'

/** 只在真机（Android/iOS）返回 true；浏览器里的 Capacitor 运行时返回 false */
export function isCapacitorNative(): boolean {
  const { capacitor } = hostGlobals()
  if (!capacitor?.isNativePlatform) return false
  try {
    return capacitor.isNativePlatform() === true
  } catch {
    return false
  }
}

/** `@capacitor/browser` 运行时的封装形态（只取我们用到的部分） */
export interface CapacitorBrowserModule {
  Browser: { open(opts: { url: string }): Promise<void> }
}

/**
 * 构造 Capacitor 适配器。
 * @param browserLoader 动态加载 `@capacitor/browser` 的函数，默认 `() => import('@capacitor/browser')`。
 *        测试可传入 fake loader 覆盖 `Browser.open`，或让 loader 抛错以验证回退 Web 行为。
 */
export function createCapacitorAdapter(
  browserLoader?: () => Promise<CapacitorBrowserModule>,
): IPlatformAdapter {
  const loader = browserLoader ?? (() => import('@capacitor/browser') as unknown as Promise<CapacitorBrowserModule>)

  const ui: PlatformUi = {
    applyTheme: applyThemeMode,
    async copyText(text) {
      adapter._lastCopied = text
      return defaultCopyText(text)
    },
    async share(payload) {
      const ok = await defaultShare(payload)
      if (!ok) adapter._lastShareFallback = 'share_unsupported'
      return ok
    },
    async openExternal(url) {
      try {
        const mod = await loader()
        await mod.Browser.open({ url })
        return true
      } catch {
        /* 插件不可用（如 ios 未 sync / 浏览器调试）→ 退回 Web 行为 */
        const ok = await defaultOpenExternal(url)
        if (!ok) adapter._lastOpenExternalFallback = 'open_unsupported'
        return ok
      }
    },
  }

  // 一次成型、不再事后赋值：IPlatformAdapter 的 ui / http 是 readonly，
  // 事后 `adapter.ui = …` 会报 TS2540；ui 的方法体引用 adapter 属闭包延迟求值，安全。
  const adapter: IPlatformAdapter = {
    kind: 'capacitor',
    storage: webStorage,
    env: webEnv,
    http: webHttp,
    _lastCopied: '',
    _lastShareFallback: '',
    _lastOpenExternalFallback: '',
    ui,
  }
  return adapter
}

/** 供契约测试使用的纯 Web 语义版本（不做 openExternal 的原生分支） */
export function createCapacitorAdapterForTest(): IPlatformAdapter {
  return createWebLikeAdapter('capacitor')
}
