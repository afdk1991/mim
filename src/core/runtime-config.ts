/* ==========================================================================
 * 运行期站点配置合并 —— 默认值真源 + 服务端覆盖
 *
 * 设计（F6）：
 *   1. `src/core/config.ts` 的 `SITE_CONFIG` 仍是默认值真源（构建期可审、
 *      无后端时也能跑）。
 *   2. 启动时壳层调用 `loadRuntimeConfig()`，通过 `config_get` RPC 拉取
 *      运营方在后台配置页写入的键值表，逐键覆盖默认值。
 *   3. 未配置 / 后端未就绪 / RPC 失败 → 回退默认值，不报错。
 *   4. 变更后 emit `EVT.siteConfig`，组件用 `useEvent(EVT.siteConfig, ...)`
 *      或直接 `getSiteConfig()` 重渲染。
 *
 * 敏感键（商户号 / 收款码 URL）由后端按约定脱敏回显，前端不缓存明文、
 * 也不在本层做二次脱敏——后端返回什么就渲染什么。
 * ======================================================================== */

import { SITE_CONFIG, isBackendConfigured } from './config'
import { db } from '../data/client'
import { emit, EVT } from './events'

/** 与 SITE_CONFIG 同形状的可写副本（默认值启动） */
export type RuntimeConfig = typeof SITE_CONFIG

let current: RuntimeConfig = { ...SITE_CONFIG }

/** 非组件场景直接读当前快照 */
export function getSiteConfig(): RuntimeConfig {
  return current
}

/**
 * 启动期拉取并合并。幂等：可重复调用，后到的结果覆盖先到的。
 * 后端未配置 / RPC 失败时静默保留默认值，调用方不 catch。
 */
export async function loadRuntimeConfig(): Promise<void> {
  if (!isBackendConfigured()) return
  const r = await db.rpc<Record<string, unknown>>('config_get', {})
  if (!r.ok) return
  const row = r.data
  if (!row || typeof row !== 'object') return
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(row)) {
    // 只允许覆盖 SITE_CONFIG 已知键，避免后端脏键污染前端
    if (!(k in SITE_CONFIG)) continue
    if (typeof v === 'string') next[k] = v
  }
  current = next as RuntimeConfig
  emit(EVT.siteConfig)
}

/** 供后台设置页保存后立即覆盖本地快照（不等待下次启动） */
export function applyRuntimeConfigPatch(patch: Record<string, string>): void {
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in SITE_CONFIG)) continue
    next[k] = v
  }
  current = next as RuntimeConfig
  emit(EVT.siteConfig)
}

/** 扫码支付通道是否开放（读运行期合并结果，而不是构建期常量） */
export function qrcodePayEnabled(): boolean {
  return current.payQrCodeUrl.trim() !== ''
}
