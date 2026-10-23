import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/* ============================================================
 * useStickyBar —— 顶部细搜索栏的「滚动联动」显隐（替代原来的条件渲染硬切换）
 * ------------------------------------------------------------
 * 原实现：`setFixedBar(window.scrollY > heroHeight)` —— 两个坑：
 *   1) 硬切换：顶栏凭空出现/消失，观感突兀，和微博 H5 的滑动跟手感不一致；
 *   2) 边界永不成立：可滚动距离恰好等于 hero 高度时（内容不足以再往下滚），
 *      scrollY 最大值 == heroHeight，`>` 永远为 false，固定条 **一次都不会出现**
 *      （本机 1280×900 实测：heroH=193，maxScroll=193，实测 fixedbar 恒为空）。
 *
 * 现策略（微博 H5 语义）：
 *   - hero 尚未滚出视口(scrollY < heroH - 8) → 隐藏，搜索由 hero 自己承担，避免双份搜索框；
 *   - 已滚过 hero → 下滑隐藏、上滑滑入（方向由累计位移判定，带 6px 死区，
 *     避免慢速滚动时每帧位移过小而永远检测不到方向）；
 *   - 用 translateY 而不是挂载/卸载，配合 CSS transition，位移只跑合成层。
 * ============================================================ */

export interface StickyBarOptions {
  /** 方向翻转所需累计位移(px)，即死区 */
  delta?: number
  /** hero 滚出多少 px 后允许顶栏出现（默认 8，留一点点余量避免临界反复） */
  lead?: number
}

export function useStickyBar(heroRef: RefObject<HTMLElement | null>, opts: StickyBarOptions = {}): boolean {
  const delta = opts.delta ?? 6
  const lead = opts.lead ?? 8
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let last = window.scrollY || document.documentElement.scrollTop || 0
    let acc = 0
    let current = false
    let raf = 0

    const apply = (next: boolean) => {
      if (next === current) return
      current = next
      setVisible(next)
    }

    const update = () => {
      raf = 0
      const y = window.scrollY || document.documentElement.scrollTop || 0
      const heroH = heroRef.current?.offsetHeight ?? 0
      acc += y - last
      last = y

      /* hero 未滚出：一律隐藏（此刻 hero 自带搜索，顶栏出来就是两份） */
      if (y < Math.max(0, heroH - lead)) {
        acc = 0
        apply(false)
        return
      }
      if (Math.abs(acc) < delta) return
      apply(acc < 0)
      acc = 0
    }

    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [heroRef, delta, lead])

  return visible
}
