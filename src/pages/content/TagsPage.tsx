/* ==========================================================================
 * TagsPage 标签聚合 —— 文章标签 → 计数 → 点选后列出该主题下全部文章
 *
 * 计数口径：每篇文章的每个标签各计一次（与原实现一致）。
 * 选中态写在 query 上（#/tags?tag=xxx）：可分享、可后退，刷新后不丢。
 * ======================================================================== */

import { useMemo } from 'react'
import { Empty } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx } from '@/core/utils'
import { useFirstPaint } from './content-data'
import { AsyncState } from './content-parts'
import { ArticleRow } from './ArticlesPage'

export function TagsPage() {
  const app = useApp()
  const { query, navigate } = useRouter()
  const ready = useFirstPaint()
  const activeTag = query.get('tag')

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of app.state.articles) {
      for (const t of a.tags) map.set(t, (map.get(t) ?? 0) + 1)
    }
    return Array.from(map.entries()).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'zh'))
  }, [app.state.articles])

  const list = useMemo(() => {
    if (!activeTag) return []
    return app.state.articles.filter((a) => a.tags.includes(activeTag)).sort((a, b) => b.createdAt - a.createdAt)
  }, [app.state.articles, activeTag])

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🏷 标签聚合</h2>
        <AsyncState
          loading={!ready}
          skeletonRows={2}
          empty={counts.length === 0 && <Empty emoji="🏷" text="还没有标签，去写一篇带标签的文章即可在这里聚合" />}
        >
          <div className="card chip-row">
            {counts.map(([t, n]) => (
              <button
                key={t}
                className={cx('chip', activeTag === t && 'active')}
                onClick={() => navigate(activeTag === t ? '/tags' : `/tags?tag=${encodeURIComponent(t)}`)}
              >
                {t} · {n}
              </button>
            ))}
          </div>
        </AsyncState>

        {activeTag ? (
          <AsyncState
            loading={!ready}
            empty={list.length === 0 && <Empty emoji="📄" text={`标签「${activeTag}」下暂无文章`} />}
          >
            <div className="row-between" style={{ margin: '4px 0 10px' }}>
              <b>「{activeTag}」下的文章（{list.length}）</b>
              <a className="btn btn-ghost btn-sm" href="#/tags">
                查看全部标签
              </a>
            </div>
            {list.map((a) => (
              <ArticleRow key={a.id} article={a} />
            ))}
          </AsyncState>
        ) : counts.length > 0 ? (
          <Empty emoji="👆" text="点击上方标签，查看该主题下的全部文章" />
        ) : null}
      </div>
    </div>
  )
}
