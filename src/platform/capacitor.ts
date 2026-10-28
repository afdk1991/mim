/* ==========================================================================
 * Capacitor 适配器 —— Android / iOS 原生壳内的 WebView
 *
 * 与 Web 的差异只有两处真实存在的能力：
 *   1. 外链必须走 `@capacitor/browser`（WebView 内 window.open 会被系统拦掉）；
 *   2. 原生判定来自 `globalThis.Capacitor.isNativePlatform()`。
 * 其余（localStorage、navigator.clipboard、navigator.share）与 Web 完全一致，
 * 直接复用 `webStorage` / `webEnv`，避免两套实现漂移。
 *
 * 注意：这里只读 `globalThis.Capacitor`，不静态 import `@capacitor/core`，
 * 这样纯 Web 构建不会因为该包注入而把自己误判成原生环境。
 * ======================================================================== */

import type { IPlatformAdapter, PlatformUi } from './types'
import { hostGlobals } from './types'
import { createWebLikeAdapter, webEnv, webStorage, webUi } from './web'

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

const ui: PlatformUi = {
  applyTheme: webUi.applyTheme,
  copyText: webUi.copyText,
  share: webUi.share,
  async openExternal(url) {
    try {
      const mod = await import('@capacitor/browser')
      await mod.Browser.open({ url })
      return true
    } catch {
      /* 插件不可用（如 ios 未 sync / 浏览器调试）→ 退回 Web 行为 */
      return webUi.openExternal(url)
    }
  },
}

export function createCapacitorAdapter(): IPlatformAdapter {
  return {
    kind: 'capacitor',
    storage: webStorage,
    env: webEnv,
    ui,
  }
}

/** 供契约测试使用的纯 Web 语义版本（不做 openExternal 的原生分支） */
export function createCapacitorAdapterForTest(): IPlatformAdapter {
  return createWebLikeAdapter('capacitor')
}
