/* ==========================================================================
 * OTA 客户端 —— 热更新 / 版本升级检测（最小可用）
 *
 * 设计约束：
 *  1. 地址为空或不可达时一律降级为「无更新」，绝不抛异常、不打断启动。
 *  2. 原生壳优先：若 window.Capacitor.Plugins.MimOta.check 存在则交给原生裁定。
 *  3. iOS 走 App Store 兜底（仅构造链接 / 日志，不强制跳转，不强依赖）。
 *  4. 鸿蒙：若配置了应用市场地址（VITE_APP_GALLERY_URL），提供 openAppGallery()
 *     跳转，使用平台层的 getPlatform().ui.openExternal。
 *  5. 全工程唯一允许直接读 window.Capacitor 的地方之一（另一处在 platform/）。
 * ======================================================================== */

import { createElement, useEffect, useState } from 'react'
import { APP_VERSION, isNewer } from './core/version'
import { getPlatform } from './platform'

export interface OtaInfo {
  /** 是否存在可用更新 */
  hasUpdate: boolean
  /** 远端最新版本 */
  latestVersion: string
  /** 更新地址（manifest 的 url，或平台兜底链接）；空表示「仅提示，去商店」 */
  url: string
}

/** 可配置地址（构建期注入；留空则关闭 OTA 检测，等价降级无操作） */
export const OTA_CONFIG = {
  manifestUrl: (import.meta.env.VITE_OTA_MANIFEST as string | undefined)?.trim() ?? '',
  appStoreUrl: (import.meta.env.VITE_APP_STORE_URL as string | undefined)?.trim() ?? '',
  appGalleryUrl: (import.meta.env.VITE_APP_GALLERY_URL as string | undefined)?.trim() ?? '',
}

/* ---------- 原生壳插件（可选，不强依赖） ---------- */

interface MimOtaPlugin {
  check(opts: { currentVersion: string; manifestUrl?: string }): Promise<{
    hasUpdate?: boolean
    latestVersion?: string
    url?: string
  }>
}

interface CapacitorGlobal {
  getPlatform?: () => string
  Plugins?: Record<string, unknown>
}

function capacitorGlobal(): CapacitorGlobal | undefined {
  const g = globalThis as unknown as { Capacitor?: CapacitorGlobal }
  return g.Capacitor
}

function mimOtaPlugin(): MimOtaPlugin | undefined {
  const plugins = capacitorGlobal()?.Plugins
  if (!plugins) return undefined
  const p = plugins.MimOta
  return (p as MimOtaPlugin | undefined) ?? undefined
}

/** 当前原生平台种类（capacitor 内部）；非原生返回 'web' */
function nativePlatform(): string {
  return capacitorGlobal()?.getPlatform?.() ?? 'web'
}

/* ---------- 核心检测 ---------- */

/**
 * 检测更新：
 *  - 原生壳插件存在 → 交给原生裁定（返回值优先）。
 *  - 否则拉取 manifest（绝对地址直连，相对地址走同源），比较版本。
 *  - 任何异常 / 空地址 / 不可达 → { hasUpdate:false, latestVersion: APP_VERSION, url:'' }
 */
export async function checkOta(): Promise<OtaInfo> {
  const fallback: OtaInfo = { hasUpdate: false, latestVersion: APP_VERSION, url: '' }

  // 1) 原生壳优先
  const plugin = mimOtaPlugin()
  if (plugin?.check) {
    try {
      const r = await plugin.check({ currentVersion: APP_VERSION, manifestUrl: OTA_CONFIG.manifestUrl || undefined })
      if (r && typeof r.hasUpdate === 'boolean') {
        return {
          hasUpdate: r.hasUpdate,
          latestVersion: r.latestVersion ?? APP_VERSION,
          url: r.url ?? '',
        }
      }
    } catch {
      /* 原生插件失败 → 退回 manifest 流程，不向外抛 */
    }
  }

  // 2) manifest 流程（地址为空直接降级，不发任何请求）
  const manifestUrl = OTA_CONFIG.manifestUrl
  if (!manifestUrl) return fallback

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(manifestUrl, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return fallback
    const data = (await res.json()) as Record<string, unknown>
    const latest = (data.version ?? data.latestVersion ?? '').toString()
    if (!latest) return fallback

    const hasUpdate = isNewer(APP_VERSION, latest)
    let url = (data.url ?? data.downloadUrl ?? data.appStoreUrl ?? '').toString()

    // iOS 原生壳：manifest 未给 url 时用 App Store 兜底（仅构造链接，不强制跳转）
    if (hasUpdate && !url && nativePlatform() === 'ios' && OTA_CONFIG.appStoreUrl) {
      url = OTA_CONFIG.appStoreUrl
    }
    return { hasUpdate, latestVersion: latest, url }
  } catch {
    // 网络不可达 / 解析失败 / 超时 → 降级无操作
    return fallback
  }
}

/** 鸿蒙应用市场跳转：仅当配置了 VITE_APP_GALLERY_URL 才可用 */
export async function openAppGallery(): Promise<boolean> {
  if (!OTA_CONFIG.appGalleryUrl) return false
  return getPlatform().ui.openExternal(OTA_CONFIG.appGalleryUrl)
}

/* ---------- React 接入 ---------- */

export interface UseOtaResult {
  checking: boolean
  hasUpdate: boolean
  info: OtaInfo | null
}

/** useOta：返回检查状态与「有更新」标志，供 UI 显示升级横幅（实现最小可用，不强制弹窗） */
export function useOta(): UseOtaResult {
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<OtaInfo | null>(null)

  useEffect(() => {
    let alive = true
    setChecking(true)
    void checkOta()
      .then((i) => {
        if (alive) setInfo(i)
      })
      .catch(() => {
        /* 吞错：UI 不应因 OTA 失败而崩溃 */
      })
      .finally(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return { checking, hasUpdate: info?.hasUpdate ?? false, info }
}

/** 升级横幅：有更新时展示，可忽略；点击更新走平台层 openExternal（不强制弹窗） */
export function OtaBanner(): JSX.Element | null {
  const { hasUpdate, info } = useOta()
  const [dismissed, setDismissed] = useState(false)
  if (!hasUpdate || dismissed || !info) return null

  const go = (): void => {
    if (info.url) void getPlatform().ui.openExternal(info.url)
  }

  return createElement(
    'div',
    { className: 'ota-banner' },
    createElement('span', null, `🚀 发现新版本 V${info.latestVersion}`),
    info.url
      ? createElement(
          'a',
          {
            className: 'btn btn-sm',
            href: info.url,
            onClick: (e: { preventDefault: () => void }) => {
              e.preventDefault()
              go()
            },
          },
          '更新',
        )
      : createElement('span', { className: 'muted' }, '请前往应用商店更新'),
    createElement(
      'button',
      { className: 'icon-btn', onClick: () => setDismissed(true), 'aria-label': '忽略更新' },
      '✕',
    ),
  )
}
