/* ==========================================================================
 * ArticleDetailPage 文章详情 —— 正文分块渲染 + 目录跳转 + 阅读时长 + 收藏
 *
 * 正文解析：支持 ## 二级标题 / - 列表 / ``` 代码块 / `行内代码`（与原 article 详情一致），
 *           不引入 Markdown 依赖，也不做 HTML 注入（全部走 React 节点）。
 * 目录：标题锚点 id 与内容同步生成（同一套 scan 顺序），点击 scrollIntoView 平滑滚动。
 * 阅读时长：走 rules.readMinutes（400 字/分钟，下限 1 分钟），不自算。
 * 遗留：文章点赞与评论写入在重建后的状态层没有出口，这里如实标注而不是伪造成功。
 * ======================================================================== */

import { useMemo } from 'react'
import { Avatar, Empty, Tag, TimeAgo, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount } from '@/core/utils'
import { readMinutes } from '@/domain/content/rules'
import { useFirstPaint } from './content-data'
import { authorOf } from './content-lib'

export interface ArticleDetailPageProps {
  id: string
}

interface Block {
  kind: 'p' | 'h2' | 'code' | 'ul'
  text?: string
  items?: string[]
  lines?: string[]
}

/** 块级解析：代码块优先，避免把 ``` 里的 ## 误当标题 */
function parseBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.startsWith('```')) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        code.push(lines[i] ?? '')
        i += 1
      }
      i += 1 // 跳过结束围栏
      blocks.push({ kind: 'code', lines: code })
    } else if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: line.slice(3) })
      i += 1
    } else if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('- ')) {
        items.push((lines[i] ?? '').slice(2))
        i += 1
      }
      blocks.push({ kind: 'ul', items })
    } else if (line.trim()) {
      blocks.push({ kind: 'p', text: line })
      i += 1
    } else {
      i += 1
    }
  }
  return blocks
}

/** 标题列表（目录用）：锚点 id 由渲染期统一编号，见下方 plan */

function InlineCode({ text }: { text: string }): JSX.Element {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((piece, i) =>
        piece.startsWith('`') && piece.endsWith('`') && piece.length > 2 ? (
          <code key={i} className="inline">
            {piece.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{piece}</span>
        ),
      )}
    </>
  )
}

export function ArticleDetailPage({ id }: ArticleDetailPageProps) {
  const app = useApp()
  const toast = useToast()
  const ready = useFirstPaint()
  const article = app.state.articles.find((a) => a.id === id)

  const blocks = useMemo(() => (article ? parseBlocks(article.content) : []), [article])
  /* 锚点在一次扫描里定好：目录与我正共用同一份 id，避免标题重名时跳错 */
  const plan = useMemo(() => {
    let n = 0
    return blocks.map((b) => (b.kind === 'h2' ? { block: b, id: `sec-${n++}`, text: b.text ?? '' } : { block: b, id: '', text: '' }))
  }, [blocks])
  const headings = useMemo(
    () => plan.filter((p) => p.block.kind === 'h2').map((p) => ({ id: p.id, text: p.text })),
    [plan],
  )

  if (!article) {
    return (
      <div className="page-grid single">
        <div>
          <Empty emoji="🔍" text="文章不存在或已被删除" />
        </div>
      </div>
    )
  }

  const author = authorOf(app.state.users, article.authorId)
  const authorUser = app.state.users.find((u) => u.id === article.authorId)
  const fav = app.state.favorites.some((f) => f.type === 'article' && f.targetId === article.id)
  const minutes = readMinutes(article.content)

  return (
    <div className="page-grid">
      <div>
        {!ready ? (
          <div className="skeleton" style={{ height: 320 }} />
        ) : (
          <article className="card article-detail">
            <h1 className="article-detail-title">{article.title}</h1>
            <div className="article-detail-meta">
              <a className="row" href={article.authorId === app.meId ? '#/my' : `#/user/${article.authorId}`}>
                <Avatar emoji={author.emoji} color={author.color} size={26} />
                {author.name}
              </a>
              <span className="muted">
                <TimeAgo ts={article.createdAt} /> · 约 {minutes} 分钟读完
              </span>
              <span className="muted">👀 {formatCount(article.views)}</span>
              <span className="muted">👍 {formatCount(article.likes)}</span>
              <div className="chip-row">
                {article.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>

            <div className="prose">
              {plan.map(({ block: b, id }, i) => {
                if (b.kind === 'code') return <pre key={i}><code>{(b.lines ?? []).join('\n')}</code></pre>
                if (b.kind === 'h2') return <h2 key={i} id={id}>{b.text}</h2>
                if (b.kind === 'ul')
                  return (
                    <ul key={i}>
                      {(b.items ?? []).map((it, j) => (
                        <li key={j}>
                          <InlineCode text={it} />
                        </li>
                      ))}
                    </ul>
                  )
                return (
                  <p key={i}>
                    <InlineCode text={b.text ?? ''} />
                  </p>
                )
              })}
            </div>

            <div className="post-actions">
              <button
                className={cx('act-btn', fav && 'active')}
                onClick={() => {
                  app.toggleFavorite('article', article.id)
                  toast(fav ? '已取消收藏' : '已收藏 ⭐')
                }}
              >
                {fav ? '⭐ 已收藏' : '☆ 收藏'}
              </button>
              {article.authorId === app.meId ? (
                <a className="act-btn" href={`#/write?edit=${article.id}`}>
                  ✏️ 编辑
                </a>
              ) : null}
            </div>
          </article>
        )}

        <div className="card">
          <h3 className="section-title">💬 评论（{article.comments.length}）</h3>
          {article.comments.length === 0 ? <Empty emoji="💬" text="还没有评论，说说你的看法" /> : null}
          {article.comments.map((c) => (
            <div key={c.id} className="comment-row">
              <Avatar emoji={authorOf(app.state.users, c.authorId).emoji} color={authorOf(app.state.users, c.authorId).color} size={30} />
              <div className="grow">
                <a href={c.authorId === app.meId ? '#/my' : `#/user/${c.authorId}`} className="comment-name">
                  {authorOf(app.state.users, c.authorId).name}
                </a>
                <p className="comment-text">{c.content}</p>
                <small className="muted">
                  <TimeAgo ts={c.createdAt} />
                </small>
              </div>
            </div>
          ))}
          {/* 评论写入需要状态层提供 addArticleComment，当前不提供按钮避免「点了没反应」的假交互 */}
          <p className="muted comment-note">
            文章评论写入接口尚未在重建后的状态层提供（待补 addArticleComment），当前仅支持浏览。
          </p>
        </div>
      </div>

      <div className="side-col">
        {headings.length > 0 ? (
          <div className="side-card toc">
            <h3 className="side-title">📑 目录</h3>
            {headings.map((h) => (
              <a
                key={h.id}
                className="toc-item"
                href={`#/article/${article.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                {h.text}
              </a>
            ))}
          </div>
        ) : null}
        <div className="side-card">
          <h3 className="side-title">👤 关于作者</h3>
          <div className="row">
            <Avatar emoji={author.emoji} color={author.color} size={40} />
            <div className="grow">
              <a href={article.authorId === app.meId ? '#/my' : `#/user/${article.authorId}`}>{author.name}</a>
              <small className="muted user-sub">{authorUser?.bio || '这位作者还没有填写简介'}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
