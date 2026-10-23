import { useCallback, useRef, useState } from 'react'

/* ============================================================
 * usePullReveal —— 微博式「下拉手势揭示」通用状态机（含下拉刷新共存）
 * ------------------------------------------------------------
 * 复刻长文描述的核心机制：搜索栏从一开始就存在于布局中，只是被「卷」在可视区域
 * 之外（translateY(-100%)）；在列表顶部继续下拉时随手指位移逐步揭示，松手按阈值
 * 收敛到稳定态，并带阻尼系数让跟手不生硬。
 *
 * 双阈值共存（长文重点：同一手势要与「下拉刷新」分流）：
 *   - 轻拉 dist >= threshold（默认 80）         → 松手吸附「完全展开」搜索栏
 *   - 重拉 dist >= refreshThreshold（默认 170） → 松手触发「下拉刷新」（onRefresh），
 *     刷新期间保持揭示并展示刷新指示器，调用方完成刷新后调 finishRefresh() 收起
 *   - 未达 threshold                            → 回到「完全收起」，避免半截中间态
 * 手势来源：
 *   - 移动端（iOS/Android/Harmony/Capacitor webview）：window 级 touch 监听，
 *     仅当滚动位置在顶部 (scrollTop<=0) 时接管下拉，并 preventDefault 阻止原生橡皮筋。
 *     刷新仅由该路径触发（真实「在列表顶部下拉」语义）。
 *   - 桌面：绑在 grip / fab 上的 pointer 拖拽，仅用于揭示搜索栏（不触发刷新），
 *     便于真实交互与自动化验证。
 * 刷新由调用方在 onRefresh 内执行、完成后调 finishRefresh()，hook 不耦合数据来源。
 * ============================================================ */

export type RevealState = 'idle' | 'pulling' | 'expanded' | 'settling' | 'refreshing'

export interface PullRevealOptions {
  /** 触发展开搜索栏所需的下拉距离(px) */
  threshold?: number
  /** 触发下拉刷新所需的下拉距离(px)，须大于 threshold */
  refreshThreshold?: number
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
  /** 重拉触发刷新时的回调；刷新完成后需调用 finishRefresh() */
  onRefresh?: () => void
}

export interface PullRevealApi {
  state: RevealState
  /** 0..1 的揭示比例，写入 CSS 变量 --reveal 驱动 transform */
  reveal: number
  /** 下拉过程中是否已越过刷新阈值（用于「松开刷新」提示） */
  refreshArmed: boolean
  /** 绑定到 grip / fab 的 onPointerDown，onTap 为轻触(几乎未拖动)回调 */
  bindGrip: (onTap?: () => void) => { onPointerDown: (e: React.PointerEvent) => void }
  /** 直接展开（点击 fab / 轻触 grip） */
  expand: () => void
  /** 直接收起（点击遮罩 / 轻触 grip） */
  collapse: () => void
  /** 在 window 上挂载/卸载全局 touch 监听（移动端下拉手势） */
  attach: () => () => void
  /** 刷新完成后调用：从 refreshing 收敛回 idle */
  finishRefresh: () => void
}

const SETTLE_MS = 260

export function usePullReveal(opts: PullRevealOptions = {}): PullRevealApi {
  const threshold = opts.threshold ?? 84
  const refreshThreshold = opts.refreshThreshold ?? 170
  const maxPull = opts.maxPull ?? 220
  const damping = opts.damping ?? 0.55
  const getScrollTop =
    opts.getScrollTop ?? (() => window.scrollY || document.documentElement.scrollTop || 0)
  const onExpanded = opts.onExpanded
  const onCollapsed = opts.onCollapsed
  const onRefresh = opts.onRefresh

  const [state, setState] = useState<RevealState>('idle')
  const [reveal, setReveal] = useState(0)
  const [refreshArmed, setRefreshArmed] = useState(false)

  /* 用 ref 镜像 latest state，避免 attach / bindGrip 因 state 变化反复重挂 */
  const stateRef = useRef<RevealState>(state)
  stateRef.current = state
  const startY = useRef(0)
  const pulling = useRef(false)
  const dist = useRef(0)
  const transitioning = useRef(false)

  /**
   * 松手收敛：按位移判定最终稳定态。
   * allowRefresh 为真（仅来自移动端顶部 touch 下拉）时才可能进入刷新分支。
   */
  const settle = useCallback(
    (allowRefresh: boolean) => {
      if (transitioning.current) return
      pulling.current = false
      const d = dist.current
      const goRefresh = allowRefresh && d >= refreshThreshold
      const reached = d >= threshold
      transitioning.current = true
      setState('settling')
      setReveal(goRefresh || reached ? 1 : 0)
      window.setTimeout(() => {
        transitioning.current = false
        dist.current = 0
        setRefreshArmed(false)
        if (goRefresh) {
          setState('refreshing')
          onRefresh?.()
        } else if (reached) {
          setState('expanded')
          onExpanded?.()
        } else {
          setState('idle')
          onCollapsed?.()
        }
      }, SETTLE_MS)
    },
    [threshold, refreshThreshold, onExpanded, onCollapsed, onRefresh],
  )

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

  /* 刷新完成：保持揭示 → 收起，回到 idle */
  const finishRefresh = useCallback(() => {
    if (transitioning.current) return
    transitioning.current = true
    setState('settling')
    setReveal(0)
    window.setTimeout(() => {
      transitioning.current = false
      dist.current = 0
      setRefreshArmed(false)
      setState('idle')
      onCollapsed?.()
    }, SETTLE_MS)
  }, [onCollapsed])

  /* ---------- 移动端：window 级 touch 监听（唯一可触发刷新的路径） ---------- */
  const attach = useCallback(() => {
    const onStart = (e: TouchEvent) => {
      if (transitioning.current) return
      if (stateRef.current === 'expanded' || stateRef.current === 'refreshing') return
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
        setRefreshArmed(false)
        pulling.current = false
        return
      }
      const d = Math.min(dy * damping, maxPull)
      dist.current = d
      setReveal(d / maxPull)
      setState('pulling')
      setRefreshArmed(d >= refreshThreshold)
      // 顶部下拉时阻止原生滚动橡皮筋（监听以 passive:false 注册）
      if (getScrollTop() <= 0) e.preventDefault()
    }
    const onEnd = () => {
      if (pulling.current) settle(true)
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
  }, [getScrollTop, maxPull, damping, refreshThreshold, settle])

  /* ---------- 桌面：grip / fab 上的 pointer 拖拽（仅揭示，不触发刷新） ---------- */
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
          settle(false)
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
      }
      return { onPointerDown }
    },
    [maxPull, settle],
  )

  return { state, reveal, refreshArmed, bindGrip, expand, collapse, attach, finishRefresh }
}
