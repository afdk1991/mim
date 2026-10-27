/* ==========================================================================
 * SearchPage 搜索结果 —— 本机索引检索（动态 + 文章）+ 关键词高亮
 *
 * 为什么是本地索引：重建后没有搜索服务，与其调一个不存在的接口再兜底演示结果，
 *   不如对本机真源做一次线性检索（数据量是本机几十条量级，线性扫描足够）。
 *   动态结果同样走 Feed 过滤链（快拍 / 仅自己可见 / 黑名单 / 青少年），
 *   保证「过滤掉了的内容不会因为搜索又冒出来」。
 * 搜索框：顶部输入 → navigate('/search?q=')，保持地址可分享、可后退。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import { Empty, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx, timeAgo } from '@/core/utils'
import { feedFilter } from '@/domain/content/rules'
import { useFirstPaint } from './content-data'
import { useFeedPrefs } from './content-prefs'
import { AsyncState, Highlight } from './content-parts'
import { CITY_PRESETS, authorOf, matchArticle, matchPost } from './content-lib'

export interface SearchPageProps {
  q: string
}

export function SearchPage({ q }: SearchPageProps) {
  const app = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const ready = useFirstPaint()
  const prefs = useFeedPrefs(app.meId, CITY_PRESETS[0])
  const [input, setInput] = useState(q)
  const [tab, setTab] = useState<'all' | 'post' | 'article'>('all')

  const kw = q.trim().toLowerCase()

  const posts = useMemo(
    () => app.state.posts.filter((p) => feedFilter(p, app.meId, prefs.filter) && matchPost(p, kw)),
    [app.state.posts, app.meId, prefs.filter, kw],
  )
  const articles = useMemo(
    () => app.state.articles.filter((a) => matchArticle(a, kw)),
    [app.state.articles, kw],
  )
  const hasAny = posts.length > 0 || articles.length > 0

  const tabs = [
    { key: 'all' as const, label: `综合` },
    { key: 'post' as const, label: `动态 (${posts.length})` },
    { key: 'article' as const, label: `文章 (${articles.length})` },
  ]

  return (
    <div className="page-grid single">
      <div>
        <form
          className="row search-bar"
          onSubmit={(e) => {
            e.preventDefault()
            const next = input.trim()
            if (!next) {
              toast('输入关键词再搜索')
              return
            }
            navigate(`/search?q=${encodeURIComponent(next)}`)
          }}
        >
          <input
            className="input"
            placeholder="搜索动态与文章…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" type="submit">
            搜索
          </button>
        </form>

        <div className="tabs">
          {tabs.map((t) => (
            <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {!kw ? <Empty emoji="🔎" text="输入关键词开始搜索" /> : null}

        {kw && !hasAny ? <Empty emoji="🕳" text={`没有找到与「${q.trim()}」相关的内容，换个词试试`} /> : null}

        {kw && hasAny && (tab === 'all' || tab === 'post') && posts.length > 0 ? (
          <AsyncState loading={!ready}>
            <h3 className="section-title">🕊 动态</h3>
            {(tab === 'all' ? posts.slice(0, 5) : posts).map((p) => (
              <a key={p.id} className="card search-card" href={`#/post/${p.id}`}>
                <div className="row">
                  <b>{authorOf(app.state.users, p.authorId).name}</b>
                  <small className="muted">{timeAgo(p.createdAt)}</small>
                </div>
                <p>
                  <Highlight text={p.content.slice(0, 140)} kw={q.trim()} />
                </p>
                {p.topic ? (
                  <small className="muted">
                    <Highlight text={`#${p.topic}#`} kw={q.trim()} />
                  </small>
                ) : null}
              </a>
            ))}
          </AsyncState>
        ) : null}

        {kw && hasAny && (tab === 'all' || tab === 'article') && articles.length > 0 ? (
          <AsyncState loading={!ready}>
            <h3 className="section-title">📄 文章</h3>
            {(tab === 'all' ? articles.slice(0, 5) : articles).map((a) => (
              <a key={a.id} className="card search-card" href={`#/article/${a.id}`}>
                <b>
                  <Highlight text={a.title} kw={q.trim()} />
                </b>
                <p className="muted">
                  <Highlight text={a.summary} kw={q.trim()} />
                </p>
                <small className="muted">{authorOf(app.state.users, a.authorId).name}</small>
              </a>
            ))}
          </AsyncState>
        ) : null}
      </div>
    </div>
  )
}
