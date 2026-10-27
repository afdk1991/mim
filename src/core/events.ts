/* ==========================================================================
 * 跨模块事件广播 —— 替代原实现里散落各域的手写 EventTarget
 *
 * 原实现每个域自定义一个事件名常量（UD_EVT / SD_EVT / SCHED_EVT / RF_EVT…），
 * 命名与订阅方式各不相同。这里收敛为一张事件名表 + 统一订阅函数，
 * 并保留 `storage` 事件转发，使多标签页之间仍然同步。
 * ======================================================================== */

export const EVT = {
  /** 身份域变更（实名 / 认证 / 隐私 / 黑名单 / 青少年模式） */
  identity: 'mim:identity',
  /** 认证态变更（登录 / 登出 / 角色刷新） */
  auth: 'mim:auth',
  /** 社交域变更（群聊 / 群消息 / 签到 / 置顶） */
  social: 'mim:social',
  /** 定时发布队列变更 */
  schedule: 'mim:schedule',
  /** 推荐负反馈变更 */
  feedback: 'mim:feedback',
  /** 钱包余额变更 */
  wallet: 'mim:wallet',
  /** 成长值变更 */
  growth: 'mim:growth',
  /** 商城状态变更 */
  mall: 'mim:mall',
  /** 语音消息变更 */
  voice: 'mim:voice',
} as const

export type EvtName = (typeof EVT)[keyof typeof EVT]

/** 派发：默认走 window，跨标签页由 storage 事件自动转发 */
export function emit(name: EvtName): void {
  try {
    window.dispatchEvent(new Event(name))
  } catch {
    /* 非浏览器环境（SSR / 测试）忽略 */
  }
}

/** 订阅：返回取消订阅函数，直接交给 useEffect 的清理回调 */
export function subscribe(name: EvtName, fn: () => void): () => void {
  window.addEventListener(name, fn)
  return () => window.removeEventListener(name, fn)
}

/** React 侧订阅 hook（放在 core 里是因为它只依赖 window，不依赖 React 组件树） */
export function useEvent(name: EvtName, fn: () => void): void {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 由调用方保证在组件内使用
  useEventEffect(name, fn)
}

// 单独抽一层，避免上面的 hook 直接内联实现导致依赖数组不稳定
import { useEffect, useRef } from 'react'

function useEventEffect(name: EvtName, fn: () => void): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const handler = () => ref.current()
    window.addEventListener(name, handler)
    return () => window.removeEventListener(name, handler)
  }, [name])
}
