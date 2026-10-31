/* ==========================================================================
 * 后端运行期状态机 —— 杜绝「部分功能可用、部分不可用」的模糊态
 *
 * 三态：
 *   unknown  → 启动期探测中（Shell 显示加载页，禁止业务页面发出请求）
 *   online   → 后端健康（健康检查通过 或 任意一次请求 2xx 接收过）
 *   offline  → 后端不可达 / 未配置（短路所有后端调用，UI 渲染降级提示）
 *
 * 与 config.ts 的关系：
 *   - isBackendConfigured()=false（off/none 或 留空）→ 直接 offline，不发探测请求
 *   - isBackendConfigured()=true（显式 /api 或绝对地址）→ 探测 /api/health
 *   - 探测通过 → online；探测失败 → offline（保留同源 /api 兜底以备后端迟启动）
 *
 * http.ts 在每个成功响应回灌 online、网络失败回灌 offline，形成持续监测。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { REQUEST_BASE, isBackendConfigured } from './config'
import { getPlatform } from '../platform'
import { emit, EVT, subscribe } from './events'

export type BackendStatus = 'unknown' | 'online' | 'offline'

let current: BackendStatus = isBackendConfigured() ? 'unknown' : 'offline'
let probeInflight = false

/** 当前状态快照 */
export function getBackendStatus(): BackendStatus {
  return current
}

/** 后端是否在线（仅 online 时为 true） */
export function isBackendOnline(): boolean {
  return current === 'online'
}

/** 后端是否处于纯本地模式（offline，UI 应展示降级提示并隐去需登录入口） */
export function isBackendOffline(): boolean {
  return current === 'offline'
}

/** 由 http.ts 在收到 2xx 时回调 */
export function markBackendOnline(): void {
  if (current !== 'online') {
    current = 'online'
    emit(EVT.backend)
  }
}

/** 由 http.ts 在网络层失败时回调 */
export function markBackendOffline(): void {
  if (current === 'online') {
    current = 'offline'
    emit(EVT.backend)
  }
}

/**
 * 启动期健康探测。幂等，多次调用只发一次请求。
 * - 未配置后端 → 直接置 offline，不发请求
 * - 已配置 → GET {REQUEST_BASE}/api/health，超时 5s
 *   成功（2xx）→ online；失败 → offline
 */
export async function probeBackend(): Promise<BackendStatus> {
  // 未配置后端：直接 offline，绝不发请求
  if (!isBackendConfigured()) {
    if (current !== 'offline') {
      current = 'offline'
      emit(EVT.backend)
    }
    return current
  }

  // 已在探测中 / 已确定 online：避免重复
  if (probeInflight || current === 'online') return current
  probeInflight = true

  try {
    const r = await getPlatform().http.request('GET', `${REQUEST_BASE}/api/health`, {
      headers: {},
      timeoutMs: 5_000,
    })
    if (r.ok) {
      current = 'online'
    } else {
      // 4xx/5xx 也算"后端存在但不健康"，仍记为 offline 让 UI 降级
      current = 'offline'
    }
  } catch {
    current = 'offline'
  } finally {
    probeInflight = false
  }
  emit(EVT.backend)
  return current
}

/**
 * React Hook：订阅后端状态变化，触发组件重渲染。
 * 启动期 Shell 用它判断该显示加载页 / 降级提示 / 正常应用。
 */
export function useBackendStatus(): BackendStatus {
  const [s, setS] = useState<BackendStatus>(current)
  useEffect(() => subscribe(EVT.backend, () => setS(current)), [])
  return s
}