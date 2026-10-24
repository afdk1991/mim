import './search-box.css'
import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useApp } from './store'
import { useToast } from './components'
import { cx } from './utils'
import { usePullReveal } from './pull-reveal'
import { SearchField } from './SearchBox'

/* ============================================================
 * PullSearchBar —— 微博式「下拉揭示」搜索栏（全局，覆盖整个项目）
 * ------------------------------------------------------------
 * 平时整层 translateY(-100%) 卷在视口上方（仅常驻 fab 提示可展开）；
 * 在任意页面顶部下拉（移动端 touch / 桌面拖拽 fab·grip）即逐步揭示，
 * 松手按阈值吸附到「完全展开」或「完全收起」稳定态。
 * 展开时不自动抢焦点弹键盘，用户点击输入框才聚焦（规避与下拉手势冲突）。
 *
 * 本组件只负责「手势 + 容器」；搜索本身（输入 / 历史 / 热搜 / 功能·话题·
 * 用户·文章联想 / 清空）交由 <SearchField variant="pull">，与 hero 常驻区、
 * 顶部滚动联动细栏共用同一份实现（原先三份各自维护，改动极易漏）。
 * ============================================================ */

export function PullSearchBar() {
  const api = useApp()
  const toast = useToast()

  /* 下拉刷新：用 ref 持有最新引用，保证 onRefresh 稳定，避免手势监听反复重挂 */
  const apiRef = useRef(api)
  apiRef.current = api
  const toastRef = useRef(toast)
  toastRef.current = toast
  const finishRef = useRef<() => void>(() => {})

  const onRefresh = useCallback(() => {
    void (async () => {
      await new Promise((r) => setTimeout(r, 700)) // 模拟网络往返
      const n = apiRef.current.refreshFeed()
      toastRef.current(n > 0 ? `已更新 ${n} 条新动态` : '暂无新内容')
      finishRef.current()
    })()
  }, [])

  const { state, reveal, refreshArmed, bindGrip, expand, collapse, attach, finishRefresh } =
    usePullReveal({
      threshold: 80,
      refreshThreshold: 170,
      /* 阻尼后位移上限：132 ≈ 手指拉 240px 时的阻尼位移，即下拉 240px 完全揭示搜索栏。
         若按阻尼前理解写成 240，则需手指拉 436px 才能完全揭示，视觉严重滞后。 */
      maxPull: 132,
      damping: 0.55,
      onRefresh,
    })

  /* finishRefresh 由 hook 提供，用 ref 交给 onRefresh 回调（解开循环依赖） */
  useEffect(() => {
    finishRef.current = finishRefresh
  }, [finishRefresh])

  /* 挂载全局 touch 监听（移动端下拉手势） */
  useEffect(() => attach(), [attach])

  const revealStyle = { ['--reveal']: reveal } as CSSProperties

  const gripLabel =
    state === 'refreshing'
      ? '正在刷新…'
      : refreshArmed
        ? '松开刷新 ↻'
        : state === 'expanded'
          ? '收起搜索 ⌃'
          : '下拉展开搜索 ⌄'

  return (
    <>
      {/* 常驻入口：桌面/不便下拉的用户点此（或拖拽）展开；移动端靠顶部下拉手势 */}
      {state !== 'expanded' && state !== 'refreshing' && (
        <button
          type="button"
          className="pull-fab"
          aria-label="展开搜索栏"
          onPointerDown={bindGrip(expand).onPointerDown}
        >
          🔍 搜索
        </button>
      )}

      <section
        className={cx(
          'pull-search',
          state === 'pulling' && 'is-pulling',
          refreshArmed && 'is-armed',
          state === 'expanded' && 'is-open',
          state === 'refreshing' && 'is-refreshing',
        )}
        style={revealStyle}
        role="search"
        aria-label="下拉搜索栏"
      >
        {/* 把手：可拖拽揭示 / 轻触收起 */}
        <div
          className="pull-grip"
          {...bindGrip(() => state === 'expanded' && collapse())}
          aria-hidden="true"
        >
          <span className="pull-grip-bar" />
          <span className="pull-grip-label">{gripLabel}</span>
          {state === 'refreshing' && <span className="pull-spin" aria-hidden="true" />}
        </div>

        {/* 展开/吸附态强制常开联想面板，避免 open 状态时序导致下拉延迟出现 */}
        <SearchField
          variant="pull"
          forceOpen={state === 'expanded' || state === 'settling'}
          onAfterGo={collapse}
        />
      </section>

      {/* 展开态背景遮罩：点击收起 */}
      {state === 'expanded' && <div className="pull-mask" onClick={collapse} aria-hidden="true" />}
    </>
  )
}
