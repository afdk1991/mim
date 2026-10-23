import { useCallback, useEffect, useRef, useState } from 'react'

/* ============================================================
 * usePullReveal —— 微博式「下拉手势揭示」通用状态机
 * ------------------------------------------------------------
 * 复刻长文描述的核心机制：搜索栏从一开始就存在于布局中，只是被「卷」在可视区域
 * 之外（translateY(-100%)）；在列表顶部继续下拉时随手指位移逐步揭示，松手按阈值
 * 收敛到两个稳定态之一（完全展开 / 完全收起），并带阻尼系数让跟手不生硬。
 *
 * 状态机：idle → pulling → (settling → expanded | idle)
 * 手势来源：
 *   - 移动端（iOS/Android/Harmony/Capacitor webview）：window 级 touch 监听，
 *     仅当滚动位置在顶部 (scrollTop<=0) 时接管下拉，并 preventDefault 阻止原生橡皮筋。
 *   - 桌面（浏览器/桌面 Tauri 预览）：绑在 grip / fab 上的 pointer 拖拽，
 *     便于真实交互与自动化验证。
 * 与「下拉刷新」共存：轻拉(达到阈值)→展开搜索栏；若后续需要刷新，可在 onExpanded
 * 内触发刷新逻辑。本 hook 只负责揭示，刷新由调用方在回调中决定，避免职责耦合。
 * ============================================================ */

export type RevealState = 'idle' | 'pulling' | 'expanded' | 'settling'

export interface PullRevealOptions {
  /** 触发展开所需的下拉距离(px) */
  threshold?: number
  /** 最大可下拉距离(px)，超过后不再跟随 */
  maxPull?: number
  /** 阻尼系数 0..1，越小跟手越「重」 */
  damping?: number
  /** 返回当前滚动位置；>0 时不接管下拉手势 */
  getScrollTop?: () => number
  /** 完全展开后的回调（可在此触发下拉刷新等） */
  onExpanded?: () => void
  /** 完全收起后的回调 */
  onCollapsed?: () => void
}

export interface PullRevealApi {
  state: RevealState
  /** 0..1 的揭示比例，写入 CSS 变量 --reveal 驱动 transform */
  reveal: number
  /** 绑定到 grip / fab 的 onPointerDown，onTap 为轻触(几乎未拖动)回调 */
  bindGrip: (onTap?: () => void) => { onPointerDown: (e: React.PointerEvent) => void }
  /** 直接展开（点击 fab / 轻触 grip） */
  expand: () => void
  /** 直接收起（点击遮罩 / 轻触 grip） */
  collapse: () => void
  /** 在 window 上挂载/卸载全局 touch 监听（移动端下拉手势） */
  attach: () => () => void
}

const SETTLE_MS = 260

export function usePullReveal(opts: PullRevealOptions = {}): PullRevealApi {
  const threshold = opts.threshold ?? 84
  const maxPull = opts.maxPull ?? 220
  const damping = opts.damping ?? 0.55
  const getScrollTop =
    opts.getScrollTop ?? (() => window.scrollY || document.documentElement.scrollTop || 0)
  const onExpanded = opts.onExpanded
  const onCollapsed = opts.onCollapsed

  const [state, setState] = useState<RevealState>('idle')
  const [reveal, setReveal] = useState(0)

  /* 用 ref 镜像 latest state，避免 attach / bindGrip 因 state 变化反复重挂 */
  const stateRef = useRef<RevealState>(state)
  stateRef.current = state
  const startY = useRef(0)
  const pulling = useRef(false)
  const dist = useRef(0)
  const transitioning = useRef(false)

  const settle = useCallback(() => {
    if (transitioning.current) return
    pulling.current = false
    const reached = dist.current >= threshold
    transitioning.current = true
    setState('settling')
    setReveal(reached ? 1 : 0)
    window.setTimeout(() => {
      transitioning.current = false
      dist.current = 0
      if (reached) {
        setState('expanded')
        onExpanded?.()
      } else {
        setState('idle')
        onCollapsed?.()
      }
    }, SETTLE_MS)
  }, [threshold, onExpanded, onCollapsed])

  const expand = useCallback(() => {
    if (transitioning.current) return
    transitioning.current = true
    setState('settling')
    setReveal(1)
    window.setTimeout(() => {
      transitioning.current = false
      setState('expanded')
      onExpanded?.()
    }, SETTLE_MS)
  }, [onExpanded])

  const collapse = useCallback(() => {
    if (transitioning.current) return
    transitioning.current = true
    setState('settling')
    setReveal(0)
    window.setTimeout(() => {
      transitioning.current = false
      setState('idle')
      onCollapsed?.()
    }, SETTLE_MS)
  }, [onCollapsed])

  /* ---------- 移动端：window 级 touch 监听 ---------- */
  const attach = useCallback(() => {
    const onStart = (e: TouchEvent) => {
      if (transitioning.current) return
      if (stateRef.current === 'expanded') return
      if (getScrollTop() > 0) return
      startY.current = e.touches[0].clientY
      pulling.current = true
      dist.current = 0
    }
    const onMove = (e: TouchEvent) => {
      if (!pulling.current || transitioning.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) {
        // 上滑：恢复初始，交还滚动
        if (dist.current !== 0) {
          dist.current = 0
          setReveal(0)
          setState('idle')
        }
        pulling.current = false
        return
      }
      const d = Math.min(dy * damping, maxPull)
      dist.current = d
      setReveal(d / maxPull)
      setState('pulling')
      // 顶部下拉时阻止原生滚动橡皮筋（监听以 passive:false 注册）
      if (getScrollTop() <= 0) e.preventDefault()
    }
    const onEnd = () => {
      if (pulling.current) settle()
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [getScrollTop, maxPull, damping, settle])

  /* ---------- 桌面：grip / fab 上的 pointer 拖拽 ---------- */
  const bindGrip = useCallback(
    (onTap?: () => void) => {
      const onPointerDown = (e: React.PointerEvent) => {
        if (transitioning.current) return
        e.preventDefault()
        startY.current = e.clientY
        pulling.current = true
        dist.current = 0
        let moved = false
        const move = (ev: PointerEvent) => {
          if (!pulling.current || transitioning.current) return
          // 展开态下拖拽无意义，交给 tap 收起处理
          if (stateRef.current === 'expanded') return
          const dy = ev.clientY - startY.current
          if (dy > 4) moved = true
          if (dy <= 0) {
            if (dist.current !== 0) {
              dist.current = 0
              setReveal(0)
              setState('idle')
            }
            return
          }
          const d = Math.min(dy, maxPull)
          dist.current = d
          setReveal(d / maxPull)
          setState('pulling')
        }
        const up = () => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', up)
          if (!pulling.current) return
          pulling.current = false
          // 几乎未移动 → 视为点击/轻触
          if (!moved || dist.current < 6) {
            onTap?.()
            return
          }
          settle()
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
      }
      return { onPointerDown }
    },
    [maxPull, settle],
  )

  return { state, reveal, bindGrip, expand, collapse, attach }
}
