/* ==========================================================================
 * 平台适配层契约 —— 全工程唯一允许直接触碰宿主环境的地方
 *
 * 分层位置：platform 是最底层，只依赖语言本身，**不得** import core / data /
 * domain / app / pages，也不得 import 任何 React。
 *
 * 为什么要有它：Web、Capacitor 原生壳、微信小程序三端共用同一份业务代码，
 * 差异只在「存储 / 环境探测 / 界面能力」这三类宿主接口上。上层一律通过
 * `getPlatform()` 取能力，禁止再直接写 localStorage / window / document /
 * navigator / wx —— 否则三端必然分叉。
 * ======================================================================== */

/** 当前实现的平台种类；新增端必须同时补进 `createAdapter()` 与契约测试 */
export type PlatformKind = 'web' | 'mock' | 'capacitor' | 'miniprogram'

export type ThemeMode = 'light' | 'dark'

/** 键值存储：同步接口。读失败返回 null，写失败静默降级，绝不抛异常 */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  /** 列出全部键，可按前缀过滤（调用方负责传入带命名空间的前缀） */
  keys(prefix?: string): string[]
}

export interface SharePayload {
  title?: string
  text?: string
  url?: string
}

/** 宿主环境探测：全部同步、永不抛异常、无副作用 */
export interface PlatformEnv {
  /** 系统是否为深色偏好 */
  prefersDark(): boolean
  /** 当前是否联网（离线时业务层应走本地优先路径） */
  isOnline(): boolean
  /** BCP-47 语言标签，取不到时返回 'zh-CN' */
  language(): string
  userAgent(): string
}

/** 宿主界面能力：全部返回布尔结果，失败即 false，由调用方决定降级文案 */
export interface PlatformUi {
  applyTheme(mode: ThemeMode): void
  copyText(text: string): Promise<boolean>
  share(payload: SharePayload): Promise<boolean>
  openExternal(url: string): Promise<boolean>
}

export interface IPlatformAdapter {
  readonly kind: PlatformKind
  readonly storage: KeyValueStore
  readonly env: PlatformEnv
  readonly ui: PlatformUi
}

/* ---------- 宿主全局对象的最小声明（不引入 @types/wx-server 之类依赖） ---------- */

export interface WxLike {
  getStorageSync(key: string): unknown
  setStorageSync(key: string, value: unknown): void
  removeStorageSync(key: string): void
  getStorageInfoSync(): { keys?: string[] }
  getSystemInfoSync(): Record<string, unknown>
  setClipboardData?(opts: { data: string; success?: () => void; fail?: () => void }): void
  vibrateShort?(opts?: Record<string, unknown>): void
  showToast?(opts: { title: string; icon?: string }): void
}

export interface CapacitorLike {
  isNativePlatform?(): boolean
  getPlatform?(): string
}

/** 宿主全局读取的唯一入口：Node/构建期可能完全没有 window，必须容错 */
export function hostGlobals(): {
  wx: WxLike | null
  capacitor: CapacitorLike | null
  win: (Window & typeof globalThis) | null
  doc: Document | null
} {
  const g = globalThis as unknown as Record<string, unknown>
  const wx = g.wx as WxLike | undefined
  const capacitor = g.Capacitor as CapacitorLike | undefined
  const win = typeof g.window === 'undefined' ? null : (g.window as Window & typeof globalThis)
  const doc = typeof g.document === 'undefined' ? null : (g.document as Document)
  return {
    wx: wx && typeof wx.getStorageSync === 'function' ? wx : null,
    capacitor: capacitor && typeof capacitor === 'object' ? capacitor : null,
    win,
    doc,
  }
}
