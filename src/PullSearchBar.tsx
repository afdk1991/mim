import './search-box.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useApp } from './store'
import { useRouter } from './router'
import { useAuth } from './auth'
import { Avatar, useToast } from './components'
import { matchSearchPages } from './search-index'
import { cx, formatCount } from './utils'
import { usePullReveal } from './pull-reveal'

/* ============================================================
 * PullSearchBar —— 微博式「下拉揭示」搜索栏（全局，覆盖整个项目）
 * ------------------------------------------------------------
 * 平时整层 translateY(-100%) 卷在视口上方（仅常驻 fab 提示可展开）；
 * 在任意页面顶部下拉（移动端 touch / 桌面拖拽 fab·grip）即逐步揭示，
 * 松手按阈值吸附到「完全展开」或「完全收起」稳定态。
 * 搜索面板内容与 hero 搜索同源（历史 / 热搜 / 功能页·话题·用户·文章联想 / 清空），
 * 展开时不自动抢焦点弹键盘，用户点击输入框才聚焦（规避与下拉手势冲突）。
 * ============================================================ */

const HERO_HISTORY_KEY = 'mim-search-history'

function loadHeroHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HERO_HISTORY_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/* 热搜标签底色：沸红 / 热橙 / 爆黄 / 新蓝 */
const HERO_TAG_BG: Record<string, string> = {
  沸: '#e64340',
  热: '#ff8200',
  爆: '#f59e0b',
  新: '#2b9cf4',
}

export function PullSearchBar() {
  const api = useApp()
  const { navigate } = useRouter()
  const { auth } = useAuth()
  const toast = useToast()

  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hist, setHist] = useState<string[]>(loadHeroHistory)
  const boxRef = useRef<HTMLDivElement>(null)

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

  /* 展开时自动打开下拉（历史/热搜），收起时关闭 */
  useEffect(() => {
    setOpen(state === 'expanded')
  }, [state])

  /* 点击面板外部（遮罩已独立处理）关闭联想下拉 */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const saveHist = (t: string) => {
    setHist((h) => {
      const next = [t, ...h.filter((x) => x !== t)].slice(0, 8)
      try {
        localStorage.setItem(HERO_HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const removeHist = (t: string) => {
    setHist((h) => {
      const next = h.filter((x) => x !== t)
      try {
        localStorage.setItem(HERO_HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const clearHist = () => {
    setHist([])
    try {
      localStorage.removeItem(HERO_HISTORY_KEY)
    } catch {
      /* ignore */
    }
  }

  const go = (word?: string) => {
    const kw = (word ?? q).trim()
    if (!kw) return
    saveHist(kw)
    setOpen(false)
    collapse()
    navigate(`/search?q=${encodeURIComponent(kw)}`)
  }

  /* 输入联想：功能入口 + 话题 + 用户 + 文章（与 hero 搜索同源） */
  const kw = q.trim().toLowerCase()
  const pageHints = kw ? matchSearchPages(q).slice(0, 3) : []
  const topicHints = kw
    ? api.state.topics.filter((t) => t.name.toLowerCase().includes(kw)).slice(0, 4)
    : []
  const userHints = kw
    ? Object.values(api.state.users)
        .filter((u) => u.name.toLowerCase().includes(kw) || u.bio.toLowerCase().includes(kw))
        .slice(0, 4)
    : []
  const articleHints = kw
    ? api.state.articles.filter((a) => a.title.toLowerCase().includes(kw)).slice(0, 3)
    : []
  const noHint =
    kw.length > 0 &&
    pageHints.length === 0 &&
    topicHints.length === 0 &&
    userHints.length === 0 &&
    articleHints.length === 0

  const revealStyle = { ['--reveal']: reveal } as CSSProperties

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
          <span className="pull-grip-label">
            {state === 'refreshing'
              ? '正在刷新…'
              : refreshArmed
                ? '松开刷新 ↻'
                : state === 'expanded'
                  ? '收起搜索 ⌃'
                  : '下拉展开搜索 ⌄'}
          </span>
          {state === 'refreshing' && <span className="pull-spin" aria-hidden="true" />}
        </div>

        <div className="pull-search-body" ref={boxRef}>
          <div className="wb-hero-bar" style={{ flex: 1 }}>
            <span aria-hidden>🔍</span>
            <input
              type="search"
              className="pull-input"
              placeholder="搜索全站内容与功能"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go()
                if (e.key === 'Escape') collapse()
              }}
            />
            {q && (
              <button
                className="wb-hero-clear"
                aria-label="清空"
                onClick={() => {
                  setQ('')
                  setOpen(true)
                }}
              >
                ×
              </button>
            )}
          </div>
          <button className="wb-hero-btn" onClick={() => go()}>
            搜索
          </button>

          {/* 展开态强制显示下拉（历史/热搜），避免 open 状态时序导致下拉延迟出现 */}
          {(open || state === 'expanded' || state === 'settling') && (
            <div className="wb-hero-drop pull-drop">
              {!kw && (
                <>
                  {hist.length > 0 && (
                    <>
                      <div className="wb-hero-drop-title">
                        搜索历史
                        <button className="wb-hero-clear-all" onClick={clearHist}>
                          清空
                        </button>
                      </div>
                      <div className="wb-hero-chips">
                        {hist.map((h) => (
                          <span key={h} className="wb-hero-chip">
                            <button className="wb-hero-chip-word" onClick={() => go(h)}>
                              {h}
                            </button>
                            <button
                              className="wb-hero-chip-del"
                              aria-label="删除"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeHist(h)
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="wb-hero-drop-title">🔥 Mim 热搜</div>
                  <div className="wb-hero-drop-list">
                    {api.state.hotSearches.slice(0, 8).map((s) => (
                      <button key={s.id} className="wb-hero-drop-item" onClick={() => go(s.text)}>
                        <i className={cx('wb-hero-rank', s.rank <= 3 && 'top')}>{s.rank}</i>
                        <span className="wb-hero-drop-text">{s.text}</span>
                        {s.tag && (
                          <em className="wb-hero-tag" style={{ background: HERO_TAG_BG[s.tag] }}>
                            {s.tag}
                          </em>
                        )}
                        <small>{formatCount(s.heat)}</small>
                      </button>
                    ))}
                  </div>
                  {/* 数据层（热搜/历史）为空时的空态提示，保证下拉面板不空白；热搜由 seed/接口下发，与手势机制解耦 */}
                  {hist.length === 0 && api.state.hotSearches.length === 0 && (
                    <div className="wb-hero-drop-empty">输入关键词，搜索全站内容 / 功能 / 用户</div>
                  )}
                </>
              )}
              {kw && (
                <>
                  {pageHints.length > 0 && (
                    <>
                      <div className="wb-hero-drop-title">🧭 功能入口</div>
                      <div className="wb-hero-drop-list">
                        {pageHints.map((p) => (
                          <button
                            key={p.href}
                            className="wb-hero-drop-item"
                            onClick={() => {
                              saveHist(q.trim())
                              setOpen(false)
                              collapse()
                              navigate(p.href.slice(1))
                            }}
                          >
                            <i className="wb-hero-ico" aria-hidden>
                              {p.icon}
                            </i>
                            <span className="wb-hero-drop-text">
                              {p.name}
                              <small>{p.group}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {topicHints.length > 0 && (
                    <>
                      <div className="wb-hero-drop-title">相关话题</div>
                      <div className="wb-hero-drop-list">
                        {topicHints.map((t) => (
                          <button key={t.id} className="wb-hero-drop-item" onClick={() => go(t.name)}>
                            <i className="wb-hero-ico" aria-hidden>
                              💬
                            </i>
                            <span className="wb-hero-drop-text">#{t.name}#</span>
                            <small>{formatCount(t.heat)}</small>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {userHints.length > 0 && (
                    <>
                      <div className="wb-hero-drop-title">相关用户</div>
                      <div className="wb-hero-drop-list">
                        {userHints.map((u) => (
                          <button key={u.id} className="wb-hero-drop-item" onClick={() => go(u.name)}>
                            <Avatar emoji={u.emoji} color={u.color} size={28} />
                            <span className="wb-hero-drop-text">
                              {u.name}
                              <small>{u.bio}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {articleHints.length > 0 && (
                    <>
                      <div className="wb-hero-drop-title">📝 相关文章</div>
                      <div className="wb-hero-drop-list">
                        {articleHints.map((a) => (
                          <button
                            key={a.id}
                            className="wb-hero-drop-item"
                            onClick={() => {
                              saveHist(q.trim())
                              setOpen(false)
                              collapse()
                              navigate(`/article/${a.id}`)
                            }}
                          >
                            <i className="wb-hero-ico" aria-hidden>
                              📝
                            </i>
                            <span className="wb-hero-drop-text">{a.title}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {noHint && (
                    <div className="wb-hero-drop-empty">没有找到相关内容，按回车直接搜索「{q.trim()}」</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 展开态背景遮罩：点击收起 */}
      {state === 'expanded' && <div className="pull-mask" onClick={collapse} aria-hidden="true" />}
    </>
  )
}
