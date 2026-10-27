/* ==========================================================================
 * BlogHomePage 我的博客 —— 本人文章 + 草稿箱 + 创作统计
 *
 * 统计全部来自本机真源：阅读数 / 点赞数目前只会随真实收录增长（publishArticle 从 0 起算），
 *       不预铺任何「示例文章」或假计数。
 * 遗留：缺少 deleteArticle / deleteArticleDraft 接口，因此暂不提供删除按钮——
 *       与其放一个点了没反应的按钮，不如留到状态层补齐（见交付说明）。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import { Avatar, Empty, TimeAgo } from '@/ui'
import { Tag } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx, formatCount } from '@/core/utils'
import { useFirstPaint } from './content-data'
import { AsyncState } from './content-parts'
import { authorOf } from './content-lib'
import { ArticleRow } from './ArticlesPage'

export function BlogHomePage() {
  const app = useApp()
  const { navigate } = useRouter()
  const ready = useFirstPaint()
  const [tab, setTab] = useState<'published' | 'drafts'>('published')

  const mine = useMemo(() => app.state.articles.filter((a) => a.authorId === app.meId), [app.state.articles, app.meId])
  const drafts = app.state.articleDrafts
  const snippets = useMemo(
    () => app.state.snippets.filter((s) => s.authorId === app.meId),
    [app.state.snippets, app.meId],
  )
  const totalViews = mine.reduce((s, a) => s + a.views, 0)
  const totalLikes = mine.reduce((s, a) => s + a.likes, 0)
  const me = authorOf(app.state.users, app.meId)
  const meUser = app.state.users.find((u) => u.id === app.meId)

  return (
    <div className="page-grid single">
      <div>
        <div className="card blog-head">
          <div className="row">
            <Avatar emoji={me.emoji} color={me.color} size={56} />
            <div className="grow">
              <b className="blog-title">{me.name} 的博客</b>
              <small className="muted">{meUser?.bio || '还没有填写个性签名'}</small>
            </div>
            <a className="btn btn-primary btn-sm" href="#/write">
              ✍️ 写文章
            </a>
          </div>
          <div className="blog-stats">
            <span>
              <b>{mine.length}</b> 文章
            </span>
            <span>
              <b>{formatCount(totalViews)}</b> 总阅读
            </span>
            <span>
              <b>{formatCount(totalLikes)}</b> 总点赞
            </span>
            <span>
              <b>{snippets.length}</b> 代码片段
            </span>
            <span>
              <b>{drafts.length}</b> 草稿
            </span>
          </div>
        </div>

        <div className="tabs">
          <button className={cx('tab-btn', tab === 'published' && 'active')} onClick={() => setTab('published')}>
            公开文章（{mine.length}）
          </button>
          <button className={cx('tab-btn', tab === 'drafts' && 'active')} onClick={() => setTab('drafts')}>
            草稿箱（{drafts.length}）
          </button>
          <span className="grow" />
          <a className="btn btn-ghost btn-sm tab-link" href="#/snippets">
            💾 代码片段
          </a>
        </div>

        {tab === 'published' ? (
          <AsyncState
            loading={!ready}
            empty={mine.length === 0 && <Empty emoji="📄" text="还没有发布过文章，点右上角「写文章」开始第一篇" />}
          >
            {mine.map((a) => (
              <ArticleRow
                key={a.id}
                article={a}
                manage={<a href={`#/write?edit=${a.id}`}>✏️ 编辑</a>}
              />
            ))}
          </AsyncState>
        ) : null}

        {tab === 'drafts' ? (
          <AsyncState
            loading={!ready}
            empty={drafts.length === 0 && <Empty emoji="📝" text="草稿箱是空的，写文章时随时可以保存草稿" />}
          >
            {drafts.map((d) => (
              <div key={d.id} className="card">
                <b>{d.title || '（无标题草稿）'}</b>
                <p className="muted draft-excerpt">{d.content.slice(0, 80) || '（正文为空）'}</p>
                <div className="row wrap">
                  {d.tags.slice(0, 3).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  <small className="muted">
                    存于 <TimeAgo ts={d.savedAt} />
                  </small>
                  <span className="grow" />
                  <button className="btn btn-primary btn-sm" onClick={() => navigate(`/write/${d.id}`)}>
                    继续编辑
                  </button>
                </div>
              </div>
            ))}
          </AsyncState>
        ) : null}
      </div>
    </div>
  )
}
