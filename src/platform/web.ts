/* ==========================================================================
 * Web 适配器 —— 浏览器直跑，也是 Capacitor WebView 的存储兜底
 *
 * 存储策略：优先 localStorage；隐私模式 / 配额超限时自动退到进程内 Map，
 * 保证「写失败但本次会话内读写自洽」，不会出现「刚存进去就读不到」。
 * ======================================================================== */

import type { IPlatformAdapter, KeyValueStore, PlatformEnv, PlatformUi } from './types'
import { hostGlobals } from './types'

/** localStorage 不可用时的进程内兜底；随页面生命周期存在 */
const memory = new Map<string, string>()

function localStore(): Storage | null {
  const { win } = hostGlobals()
  if (!win) return null
  try {
    const s = win.localStorage
    // 隐私模式下连读取都可能抛，探针一次确认可用
    s.getItem('mim.__probe__')
    return s
  } catch {
    return null
  }
}

export const webStorage: KeyValueStore = {
  get(key) {
    const s = localStore()
    if (!s) return memory.has(key) ? (memory.get(key) as string) : null
    try {
      return s.getItem(key)
    } catch {
      return memory.has(key) ? (memory.get(key) as string) : null
    }
  },
  set(key, value) {
    const s = localStore()
    memory.set(key, value)
    if (!s) return
    try {
      s.setItem(key, value)
    } catch {
      /* 配额超限：内存态已写入，静默忽略 */
    }
  },
  remove(key) {
    memory.delete(key)
    const s = localStore()
    if (!s) return
    try {
      s.removeItem(key)
    } catch {
      /* 同上 */
    }
  },
  keys(prefix = '') {
    const out = new Set<string>()
    const s = localStore()
    if (s) {
      try {
        for (let i = 0; i < s.length; i += 1) {
          const k = s.key(i)
          if (k && k.startsWith(prefix)) out.add(k)
        }
      } catch {
        /* 遍历失败则只返回内存态 */
      }
    }
    for (const k of memory.keys()) {
      if (k.startsWith(prefix)) out.add(k)
    }
    return [...out]
  },
}

export const webEnv: PlatformEnv = {
  prefersDark() {
    const { win } = hostGlobals()
    if (!win || typeof win.matchMedia !== 'function') return false
    try {
      return win.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  },
  isOnline() {
    const { win } = hostGlobals()
    if (!win?.navigator) return true
    return typeof win.navigator.onLine === 'boolean' ? win.navigator.onLine : true
  },
  language() {
    const { win } = hostGlobals()
    const lang = win?.navigator?.language
    return typeof lang === 'string' && lang ? lang : 'zh-CN'
  },
  userAgent() {
    const { win } = hostGlobals()
    return win?.navigator?.userAgent ?? ''
  },
}

/** 复制：navigator.clipboard → execCommand 兜底（老 WebView 没有 clipboard API） */
async function copyViaDom(text: string): Promise<boolean> {
  const { doc, win } = hostGlobals()
  if (!doc || !win) return false
  try {
    const el = doc.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    doc.body.appendChild(el)
    el.select()
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false
    doc.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

async function copyText(text: string): Promise<boolean> {
  const { win } = hostGlobals()
  const clip = win?.navigator?.clipboard
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text)
      return true
    } catch {
      /* 非安全上下文 / 无权限：继续走 DOM 兜底 */
    }
  }
  return copyViaDom(text)
}

export const webUi: PlatformUi = {
  applyTheme(mode) {
    const { doc } = hostGlobals()
    if (!doc?.documentElement) return
    doc.documentElement.dataset.theme = mode
  },
  copyText,
  async share(payload) {
    const { win } = hostGlobals()
    const nav = win?.navigator
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share(payload)
        return true
      } catch {
        return false
      }
    }
    // 无原生分享：有链接就复制链接，视为「分享成功」，由调用方提示文案
    if (payload.url) return copyText(payload.url)
    return false
  },
  async openExternal(url) {
    const { win } = hostGlobals()
    if (!win) return false
    try {
      win.open(url, '_blank', 'noopener,noreferrer')
      return true
    } catch {
      return false
    }
  },
}

export const webAdapter: IPlatformAdapter = {
  kind: 'web',
  storage: webStorage,
  env: webEnv,
  ui: webUi,
}

/** Capacitor 复用同一份 WebView 语义，只是 kind 不同 */
export function createWebLikeAdapter(kind: 'web' | 'capacitor'): IPlatformAdapter {
  return { kind, storage: webStorage, env: webEnv, ui: webUi }
}
