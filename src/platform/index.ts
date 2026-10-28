/* ==========================================================================
 * 平台适配层入口 —— 探测 / 注入 / 取用
 *
 * 上层只 import `getPlatform()`，全工程不允许再出现裸 localStorage / window /
 * document / navigator / wx。需要换端时改这里一处即可。
 *
 * 探测顺序（自上而下，命中即停）：
 *   1. 显式注入（测试 setPlatform / 宿主启动时手动指定，优先级最高）
 *   2. 微信小程序：存在 wx.getStorageSync
 *   3. Capacitor 原生：globalThis.Capacitor.isNativePlatform() === true
 *   4. 其余一律 Web（含 Capacitor 浏览器调试、纯静态站点）
 * ======================================================================== */

import type { IPlatformAdapter, PlatformKind } from './types'
import { hostGlobals } from './types'
import { createWebLikeAdapter, webAdapter } from './web'
import { createMockAdapter } from './mock'
import { createCapacitorAdapter, isCapacitorNative } from './capacitor'
import { createMiniprogramAdapter } from './miniprogram'

export type { IPlatformAdapter, PlatformKind, ThemeMode, KeyValueStore, SharePayload } from './types'
export { runAdapterContract, contractFailure } from './contract-check'
export type { ContractCase } from './contract-check'
export { createMockAdapter } from './mock'
export type { MockAdapter, MockOptions } from './mock'
export { createMiniprogramAdapter } from './miniprogram'
export { isCapacitorNative } from './capacitor'

export function detectPlatformKind(): PlatformKind {
  const { wx } = hostGlobals()
  if (wx) return 'miniprogram'
  if (isCapacitorNative()) return 'capacitor'
  return 'web'
}

/** 按 kind 造一个全新实例（mock 每次都是独立内存，其余端为无状态单例） */
export function createAdapter(kind: PlatformKind): IPlatformAdapter {
  switch (kind) {
    case 'mock':
      return createMockAdapter()
    case 'capacitor':
      return createCapacitorAdapter()
    case 'miniprogram':
      return createMiniprogramAdapter()
    case 'web':
    default:
      return createWebLikeAdapter('web')
  }
}

let active: IPlatformAdapter | null = null

/** 取当前适配器；首次调用才探测，模块导入期不碰任何宿主对象 */
export function getPlatform(): IPlatformAdapter {
  if (!active) active = detectPlatformKind() === 'web' ? webAdapter : createAdapter(detectPlatformKind())
  return active
}

/** 显式注入（测试 / 原生壳启动时）；传 null 恢复自动探测 */
export function setPlatform(adapter: IPlatformAdapter | null): void {
  active = adapter
}
