/* ==========================================================================
 * BackendGate —— 后端状态守卫，杜绝「部分可用部分不可用」的模糊态
 *
 * 三态 UI：
 *   unknown  → 全屏加载（探测中，禁止业务页发请求）
 *   offline  → 顶部降级横幅 + 隐藏需登录/钱包入口（保留只读浏览）
 *   online    → 正常渲染
 *
 * 启动期 App → BackendGate → Shell + Page
 * ======================================================================== */

import { useEffect, type ReactNode } from 'react'
import { useBackendStatus, probeBackend, getBackendStatus } from '../core/backend-status'
import { API_BASE, isBackendConfigured } from '../core/config'
import { displayVersion } from '../core/version'

/** 启动期触发一次探测（仅 unknown 态时实际发请求） */
export function useBackendProbeOnMount(): void {
  useEffect(() => {
    void probeBackend()
  }, [])
}

/** 全屏加载页 —— 探测中 */
function ProbingScreen(): JSX.Element {
  return (
    <div className="backend-gate-probing">
      <div className="backend-gate-card">
        <div className="backend-gate-spinner" aria-hidden="true" />
        <div className="backend-gate-title">正在连接服务…</div>
        <div className="backend-gate-sub">Mim · {displayVersion()}</div>
      </div>
    </div>
  )
}

/**
 * 顶部降级横幅。纯本地模式（未配置）显示「本地模式」；
 * 已配置但探测失败显示「后端不可达」。
 */
function OfflineBanner(): JSX.Element {
  const configured = isBackendConfigured()
  const message = configured
    ? '后端不可达：仅可浏览本地缓存内容，登录 / 钱包 / 订单等云功能已暂停。'
    : '本地模式：未配置后端服务，所有数据存于本机，登录 / 钱包 / 订单等入口已隐藏。'
  const hint = configured
    ? `目标：${API_BASE || '/api'} · 将在恢复后自动重连`
    : '如需云功能，请在构建期设置 VITE_MIM_API_BASE 指向后端地址'

  return (
    <div className="backend-gate-banner" role="status" aria-live="polite">
      <span className="backend-gate-banner-icon" aria-hidden="true">⚠️</span>
      <div className="backend-gate-banner-content">
        <div className="backend-gate-banner-msg">{message}</div>
        <div className="backend-gate-banner-hint">{hint}</div>
      </div>
    </div>
  )
}

/**
 * 后端状态守卫。
 * - unknown → 显示探测页（不渲染子树，避免业务页面发请求）
 * - offline → 显示横幅 + 子树（保留只读浏览能力，但 UI 自身隐去云入口）
 * - online   → 直接渲染子树
 */
export function BackendGate({ children }: { children: ReactNode }): JSX.Element {
  useBackendProbeOnMount()
  const status = useBackendStatus()

  if (status === 'unknown') {
    return <ProbingScreen />
  }
  return (
    <>
      {status === 'offline' ? <OfflineBanner /> : null}
      {children}
    </>
  )
}

/**
 * 是否应当隐藏某项功能入口（云功能在 offline 态下不可用）。
 * 调用方据此决定导航项、按钮的渲染。
 */
export function shouldHideCloudFeature(): boolean {
  return getBackendStatus() === 'offline'
}