/* ==========================================================================
 * 微信小程序适配器 —— 小程序目标端（WeChat Mini Program）
 *
 * 与 Web 的语义差异（都是平台客观限制，不做伪造）：
 *   1. 无 localStorage → 全走 `wx.*StorageSync`；
 *   2. 无 document → 无法写 `<html data-theme>`，applyTheme 是空实现（主题由
 *      小程序全局配置决定，页面内部只能通过 CSS 变量切换）；
 *   3. 无「打开外链」能力 → openExternal 恒为 false（除页面内 web-view）；
 *   4. 分享必须由页面 `onShareAppMessage` 承接，本层只负责把内容交给系统剪贴板
 *      并返回 false，由调用方提示「请用右上角菜单分享」。
 * ======================================================================== */

import type { IPlatformAdapter, KeyValueStore, PlatformEnv, PlatformUi, WxLike } from './types'
import { hostGlobals } from './types'

function resolveWx(injected?: WxLike | null): WxLike | null {
  if (injected !== undefined) return injected
  return hostGlobals().wx
}

/** wx.getStorageSync 在键不存在时返回 ''，需归一成 null */
function toNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

export function createMiniprogramAdapter(injectedWx?: WxLike | null): IPlatformAdapter {
  const wx = resolveWx(injectedWx)
  // 非小程序环境（如 Node 里跑契约测试）退到内存，保证同一份用例可执行
  const memory = new Map<string, string>()

  const storage: KeyValueStore = {
    get(key) {
      if (!wx) return memory.has(key) ? (memory.get(key) as string) : null
      try {
        return toNull(wx.getStorageSync(key))
      } catch {
        return null
      }
    },
    set(key, value) {
      memory.set(key, value)
      if (!wx) return
      try {
        wx.setStorageSync(key, value)
      } catch {
        /* 超出 10MB 配额：内存态已写入，静默忽略 */
      }
    },
    remove(key) {
      memory.delete(key)
      if (!wx) return
      try {
        wx.removeStorageSync(key)
      } catch {
        /* 同上 */
      }
    },
    keys(prefix = '') {
      const out = new Set<string>()
      if (wx) {
        try {
          const all = wx.getStorageInfoSync().keys
          for (const k of all ?? []) if (k.startsWith(prefix)) out.add(k)
        } catch {
          /* 读不到清单则只返回内存态 */
        }
      }
      for (const k of memory.keys()) if (k.startsWith(prefix)) out.add(k)
      return [...out]
    },
  }

  const systemInfo = (): Record<string, unknown> => {
    if (!wx) return {}
    try {
      return wx.getSystemInfoSync() ?? {}
    } catch {
      return {}
    }
  }

  const env: PlatformEnv = {
    prefersDark() {
      const info = systemInfo()
      // WeChat 提供 theme: 'light' | 'dark'
      return info.theme === 'dark'
    },
    isOnline() {
      const net = systemInfo().networkType
      return net !== 'none'
    },
    language() {
      const lang = systemInfo().language
      return typeof lang === 'string' && lang ? lang : 'zh-CN'
    },
    userAgent() {
      const info = systemInfo()
      const parts = [info.system, info.model, info.platform].filter((x) => typeof x === 'string' && x)
      return parts.join(' ') || 'wechat-miniprogram'
    },
  }

  const ui: PlatformUi = {
    applyTheme() {
      /* 小程序无 document：主题由 app.json / 全局配置决定，这里刻意不做任何事 */
    },
    copyText(text) {
      if (!wx?.setClipboardData) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        try {
          wx.setClipboardData!({
            data: text,
            success: () => resolve(true),
            fail: () => resolve(false),
          })
        } catch {
          resolve(false)
        }
      })
    },
    async share(payload) {
      // 分享必须由页面 onShareAppMessage 实现；这里只把可分享文本交给剪贴板
      const text = payload.url || payload.text || payload.title
      if (!text) return false
      await ui.copyText(text)
      return false
    },
    async openExternal() {
      // 小程序禁止直接打开外部链接
      return false
    },
  }

  return { kind: 'miniprogram', storage, env, ui }
}
