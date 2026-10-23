import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useApp } from './store'
import { useRouter } from './router'
import { Avatar } from './components'
import { matchSearchPages } from './search-index'
import { cx, formatCount } from './utils'

/* ============================================================
 * SearchField —— 全站搜索的单一实现（合并 WbHero / WbFixedBar / PullSearchBar 三处副本）
 * ------------------------------------------------------------
 * 之前三处各自实现了「输入 + 历史 + 热搜 + 功能/话题/用户/文章联想 + 清空」，
 * 约 300 行逻辑重复三遍，任何一处改动都会漏掉另外两处。现统一到本文件：
 *   variant = 'hero'  常驻落地 hero 区（宽面板：历史 chips + 热搜榜 + 联想）
 *   variant = 'fixed' 滚动后浮出的细顶栏（窄面板：紧凑联想）
 *   variant = 'pull'  下拉揭示的大搜索面板（同 hero 的富面板）
 * 状态（词、历史、联想、键盘/失焦）全部在本 hook 内，宿主只负责容器外壳。
 * ============================================================ */

export const HERO_HISTORY_KEY = 'mim-search-history'

/** 热搜标签底色：沸红 / 热橙 / 爆黄 / 新蓝 */
export const HERO_TAG_BG: Record<string, string> = {
  沸: '#e64340',
  热: '#ff8200',
  爆: '#f59e0b',
  新: '#2b9cf4',
}

export function loadHeroHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HERO_HISTORY_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export type SearchVariant = 'hero' | 'fixed' | 'pull'

/** 各形态的联想条数配额（fixed 更窄，少给一条） */
const LIMITS: Record<SearchVariant, { page: number; topic: number; user: number; article: number }> = {
  hero: { page: 3, topic: 4, user: 4, article: 3 },
  pull: { page: 3, topic: 4, user: 4, article: 3 },
  fixed: { page: 3, topic: 3, user: 3, article: 3 },
}

export interface SearchFieldProps {
  variant: SearchVariant
  /** 搜索后的额外收尾（如 pull 面板需要 collapse） */
  onAfterGo?: () => void
  /** 宿主强制常开联想下拉（如 pull 处于展开/吸附态） */
  forceOpen?: boolean
  /** 追加到最外层容器的 class */
  className?: string
  style?: CSSProperties
  /** 'pull' 形态下输入框之上的额外装饰节点（把手由宿主负责，此槽位留空即可） */
  children?: React.ReactNode
}

export function SearchField({ variant, onAfterGo, forceOpen, className, style }: SearchFieldProps) {
  const api = useApp()
  const { navigate } = useRouter()

  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hist, setHist] = useState<string[]>(loadHeroHistory)
  const boxRef = useRef<HTMLDivElement>(null)

  /* 点击面板外部关闭联想下拉 */
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
    onAfterGo?.()
    navigate(`/search?q=${encodeURIComponent(kw)}`)
  }

  const pickHref = (href: string) => {
    if (q.trim()) saveHist(q.trim())
    setOpen(false)
    onAfterGo?.()
    navigate(href.slice(1))
  }

  /* 输入联想：功能入口 + 话题 + 用户 + 文章（全站同源） */
  const kw = q.trim().toLowerCase()
  const lim = LIMITS[variant]
  const pageHints = kw ? matchSearchPages(q).slice(0, lim.page) : []
  const topicHints = kw
    ? api.state.topics.filter((t) => t.name.toLowerCase().includes(kw)).slice(0, lim.topic)
    : []
  const userHints = kw
    ? Object.values(api.state.users)
        .filter((u) => u.name.toLowerCase().includes(kw) || u.bio.toLowerCase().includes(kw))
        .slice(0, lim.user)
    : []
  const articleHints = kw
    ? api.state.articles.filter((a) => a.title.toLowerCase().includes(kw)).slice(0, lim.article)
    : []
  const noHint =
    kw.length > 0 &&
    pageHints.length === 0 &&
    topicHints.length === 0 &&
    userHints.length === 0 &&
    articleHints.length === 0

  const dropOpen = open || !!forceOpen

  const input = (
    <input
      type="search"
      className={variant === 'pull' ? 'pull-input' : undefined}
      placeholder="搜索全站内容与功能"
      value={q}
      onFocus={() => setOpen(true)}
      onChange={(e) => {
        setQ(e.target.value)
        setOpen(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') go()
        if (e.key === 'Escape') setOpen(false)
      }}
    />
  )

  const clearBtn = q && (
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
  )

  /* ---------- 紧凑形态（fixed 细顶栏） ---------- */
  if (variant === 'fixed') {
    return (
      <div className={cx('wb-fixedbar-inner', className)} ref={boxRef} style={style}>
        <span aria-hidden>🔍</span>
        {input}
        {clearBtn}
        {dropOpen && !kw && hist.length > 0 && (
          <div className="sidenav-search-drop wb-fixedbar-drop">
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
          </div>
        )}
        {dropOpen && kw && (
          <div className="sidenav-search-drop">
            {noHint ? (
              <button className="sidenav-search-item" onClick={() => go()}>
                没有匹配的内容，回车搜索「{q.trim()}」
              </button>
            ) : (
              <>
                {pageHints.map((p) => (
                  <button key={p.href} className="sidenav-search-item" onClick={() => pickHref(p.href)}>
                    <i aria-hidden="true">{p.icon}</i>
                    <span className="sidenav-search-name">{p.name}</span>
                    <em>{p.group}</em>
                  </button>
                ))}
                {topicHints.map((t) => (
                  <button key={t.id} className="sidenav-search-item" onClick={() => go(t.name)}>
                    <i aria-hidden="true">💬</i>
                    <span>#{t.name}#</span>
                    <em>话题</em>
                  </button>
                ))}
                {userHints.map((u) => (
                  <button key={u.id} className="sidenav-search-item" onClick={() => go(u.name)}>
                    <i aria-hidden="true">{u.emoji}</i>
                    <span className="sidenav-search-name">{u.name}</span>
                    <em>{u.bio}</em>
                  </button>
                ))}
                {articleHints.map((a) => (
                  <button
                    key={a.id}
                    className="sidenav-search-item"
                    onClick={() => pickHref(`#/article/${a.id}`)}
                  >
                    <i aria-hidden="true">📝</i>
                    <span>{a.title}</span>
                    <em>文章</em>
                  </button>
                ))}
                <button className="sidenav-search-item sidenav-search-all" onClick={() => go()}>
                  查看全部搜索结果
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  /* ---------- 富形态（hero 常驻区 / pull 下拉大面板） ---------- */
  return (
    <div
      className={cx(variant === 'hero' ? 'wb-hero-search' : 'wb-hero-bar', className)}
      ref={boxRef}
      style={{ flex: variant === 'pull' ? 1 : undefined, ...style }}
    >
      <div className="wb-hero-bar" style={{ flex: 1 }}>
        <span aria-hidden>🔍</span>
        {input}
        {clearBtn}
      </div>
      <button className="wb-hero-btn" onClick={() => go()}>
        搜索
      </button>

      {dropOpen && (
        <div className={cx('wb-hero-drop', variant === 'pull' && 'pull-drop')}>
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
                      <button key={p.href} className="wb-hero-drop-item" onClick={() => pickHref(p.href)}>
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
                        onClick={() => pickHref(`#/article/${a.id}`)}
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
  )
}
