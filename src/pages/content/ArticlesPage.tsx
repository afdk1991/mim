/* ==========================================================================
 * ArticlesPage 文章列表 —— 标签筛选 + 最新/最热 排序
 *
 * 卡片沿用原实现的文章行：摘要 / 作者 / 阅读 / 收藏。
 * 收藏走状态层唯一的 toggleFavorite('article', id) 出口。
 * 遗留：文章点赞在重建后的状态层没有出口（toggleArticleLike 缺失），
 *       这里只展示真实计数，不做点了会「假成功」的按钮。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar, Empty, Tag, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount, timeAgo } from '@/core/utils'
import type { Article } from '@/domain/content/model'
import { useFirstPaint } from './content-data'
import { AsyncState } from './content-parts'
import { authorOf } from './content-lib'

export function ArticlesPage() {
  const app = useApp()
  const ready = useFirstPaint()
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')

  const articles = app.state.articles
  const allTags = useMemo(() => Array.from(new Set(articles.flatMap((a) => a.tags))), [articles])
  const list = useMemo(() => {
    const rows = tag ? articles.filter((a) => a.tags.includes(tag)) : [...articles]
    return rows.sort((a, b) => (sort === 'latest' ? b.createdAt - a.createdAt : b.likes - a.likes))
  }, [articles, tag, sort])

  return (
    <div className="page-grid single">
      <div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2 className="page-title">📄 知识文库</h2>
          <a className="btn btn-primary btn-sm" href="#/write">
            ✍️ 写文章
          </a>
        </div>

        {allTags.length > 0 ? (
          <div className="card chip-row">
            <button className={cx('chip', tag === null && 'active')} onClick={() => setTag(null)}>
              全部
            </button>
            {allTags.map((t) => (
              <button key={t} className={cx('chip', tag === t && 'active')} onClick={() => setTag(t)}>
                {t}
              </button>
            ))}
          </div>
        ) : null}

        <div className="tabs">
          <button className={cx('tab-btn', sort === 'latest' && 'active')} onClick={() => setSort('latest')}>
            🆕 最新
          </button>
          <button className={cx('tab-btn', sort === 'hot' && 'active')} onClick={() => setSort('hot')}>
            🔥 最热
          </button>
          <span className="grow" />
          <a className="btn btn-ghost btn-sm tab-link" href="#/tags">
            🏷 标签聚合
          </a>
        </div>

        <AsyncState
          loading={!ready}
          empty={
            list.length === 0 && (
              <Empty
                emoji="📄"
                text={tag ? `标签「${tag}」下暂无文章，换个标签或去写一篇` : '还没有文章，去写一篇知识内容吧'}
              />
            )
          }
        >
          {list.map((a) => (
            <ArticleRow key={a.id} article={a} />
          ))}
        </AsyncState>
      </div>
    </div>
  )
}

/** 文章行：列表页 / 我的博客 / 标签页共用同一套呈现，避免三处样式漂移 */
export function ArticleRow({ article, manage }: { article: Article; manage?: ReactNode }): ReactNode {
  const app = useApp()
  const toast = useToast()
  const author = authorOf(app.state.users, article.authorId)
  const fav = app.state.favorites.some((f) => f.type === 'article' && f.targetId === article.id)

  return (
    <article className="card article-row">
      <div className="article-row-main">
        <a className="article-title" href={`#/article/${article.id}`}>
          {article.title}
        </a>
        <p className="article-summary">{article.summary}</p>
        <div className="article-meta">
          <a className="row" href={article.authorId === app.meId ? '#/my' : `#/user/${article.authorId}`}>
            <Avatar emoji={author.emoji} color={author.color} size={20} />
            {author.name}
          </a>
          <span className="muted">{timeAgo(article.createdAt)}</span>
          <span className="muted">👀 {formatCount(article.views)}</span>
          <span className="muted">👍 {formatCount(article.likes)}</span>
          <span className="muted">💬 {article.comments.length}</span>
          <div className="chip-row">
            {article.tags.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
          {manage ? <div className="article-manage row">{manage}</div> : null}
        </div>
      </div>
      <button
        className={cx('icon-btn star-btn', fav && 'active')}
        title={fav ? '取消收藏' : '收藏'}
        aria-label={fav ? '取消收藏' : '收藏'}
        onClick={() => {
          app.toggleFavorite('article', article.id)
          toast(fav ? '已取消收藏' : '已收藏 ⭐')
        }}
      >
        {fav ? '⭐' : '☆'}
      </button>
    </article>
  )
}
