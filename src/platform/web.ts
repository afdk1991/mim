/* ==========================================================================
 * Web 适配器 —— 浏览器直跑，也是 Capacitor WebView 的存储兜底
 *
 * 存储策略：优先 localStorage；隐私模式 / 配额超限时自动退到进程内 Map，
 * 保证「写失败但本次会话内读写自洽」，不会出现「刚存进去就读不到」。
 * ======================================================================== */

import type { IPlatformAdapter, KeyValueStore, PlatformEnv, PlatformUi, PlatformHttp, SharePayload, ThemeMode } from './types'
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

/** 复制实现：navigator.clipboard → execCommand 兜底（老 WebView 没有 clipboard API） */
export async function copyViaDom(text: string): Promise<boolean> {
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

export async function defaultCopyText(text: string): Promise<boolean> {
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

export function applyThemeMode(mode: ThemeMode): void {
  const { doc } = hostGlobals()
  if (!doc?.documentElement) return
  doc.documentElement.dataset.theme = mode
}

export async function defaultShare(payload: SharePayload): Promise<boolean> {
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
  if (payload.url) return defaultCopyText(payload.url)
  return false
}

export async function defaultOpenExternal(url: string): Promise<boolean> {
  const { win } = hostGlobals()
  if (!win) return false
  try {
    win.open(url, '_blank', 'noopener,noreferrer')
    return true
  } catch {
    return false
  }
}

/** Web / Capacitor WebView 的 HTTP 实现：fetch + AbortController 超时 */
export const webHttp: PlatformHttp = {
  async request(method, url, opts) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000)
    try {
      const res = await fetch(url, {
        method,
        headers: opts.headers,
        ...(opts.body === undefined ? {} : { body: opts.body }),
        signal: controller.signal,
      })
      const text = await res.text()
      return { ok: res.ok, status: res.status, text }
    } catch {
      // 网络不可达 / 超时（AbortError）统一归为失败，status=0 交给 core 判定离线
      return { ok: false, status: 0, text: '' }
    } finally {
      clearTimeout(timer)
    }
  },
}

/**
 * 构造一个 Web 语义适配器（web / capacitor 浏览器态共用）。
 * 调试字段挂在返回的适配器对象上：copyText 记录 `_lastCopied`，share /
 * openExternal 降级（返回 false）时分别记录 `_lastShareFallback` / `_lastOpenExternalFallback`。
 */
export function createWebLikeAdapter(kind: 'web' | 'capacitor'): IPlatformAdapter {
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
      const ok = await defaultOpenExternal(url)
      if (!ok) adapter._lastOpenExternalFallback = 'open_unsupported'
      return ok
    },
  }

  // 一次成型、不再事后赋值：IPlatformAdapter 的 ui / http 是 readonly，
  // 事后 `adapter.ui = …` 会报 TS2540；ui 的方法体引用 adapter 属闭包延迟求值，安全。
  const adapter: IPlatformAdapter = {
    kind,
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

export const webAdapter: IPlatformAdapter = createWebLikeAdapter('web')
