import type { Article, Post } from './types'
import { useApp } from './store'
import { cx, formatCount } from './utils'
import { UserLink } from './components'

/* ============================================================
 * feed-extras —— 微博式首页增强组件（实时提示 / 流内文章卡 / 骨架屏 / 热榜）
 * ------------------------------------------------------------
 * 对照 weibo.com 首页补齐四块标志性体验：
 *   1. NewPostsBar   「有 N 条新微博」顶部推送条（后台到达、点击才回顶展示）
 *   2. ArticleFeedCard 头条文章卡穿插进信息流（对齐微博流内头条文章样式）
 *   3. FeedSkeleton  首屏骨架屏（加载态占位，避免流区域空白跳动）
 *   4. HotBanner     热门 Tab 顶部 24h 热榜（top3 + 热度）
 *
 * 独立成文件的理由：weibo.tsx / components.tsx 正被并行会话高频修改，
 * 新组件集中在此可把对既有文件的改动压到最小（仅 import + 少量接线）。
 * ============================================================ */

/** 「有 N 条新微博」提示条：出现于信息流顶部，点击回顶并展示新内容 */
export function NewPostsBar({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null
  return (
    <button type="button" className="rf-newbar" onClick={onOpen}>
      <span className="rf-newbar-arrow" aria-hidden="true">
        ↑
      </span>
      有 {count} 条新微博，点击查看
    </button>
  )
}

/** 头条文章卡：信息流内穿插（封面 + 标题 + 摘要 + 作者 + 阅读量） */
export function ArticleFeedCard({ article }: { article: Article }) {
  const api = useApp()
  const author = api.state.users[article.authorId]
  const summary = article.summary || article.content.replace(/\n/g, ' ').slice(0, 60)
  return (
    <a className="card rf-article-card" href={`#/article/${article.id}`}>
      <div className="rf-article-main">
        <div className="rf-article-head">
          <span className="rf-article-badge">头条文章</span>
          <b className="rf-article-title">{article.title}</b>
        </div>
        <p className="rf-article-summary">{summary}</p>
        <div className="rf-article-meta">
          {author ? <UserLink userId={author.id} /> : <span className="rf-article-author">佚名</span>}
          <span className="rf-article-views">👁 {formatCount(article.views ?? 0)} 阅读</span>
        </div>
      </div>
      <span className="rf-article-cover" aria-hidden="true">
        {article.tags[0] ? `#${article.tags[0]}` : '📄'}
      </span>
    </a>
  )
}

/** 信息流骨架屏：首屏加载态（头像行 + 三段正文 + 互动行） */
export function FeedSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="feed-skeleton" aria-label="内容加载中" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div className="card feed-sk-card" key={i}>
          <div className="feed-sk-head">
            <span className="sk feed-sk-avatar" />
            <span className="feed-sk-lines">
              <span className="sk" style={{ width: '30%', height: 12 }} />
              <span className="sk" style={{ width: '18%', height: 10 }} />
            </span>
          </div>
          <span className="sk feed-sk-line" style={{ width: '92%' }} />
          <span className="sk feed-sk-line" style={{ width: '74%' }} />
          <span className="sk feed-sk-line" style={{ width: '56%' }} />
          <span className="sk feed-sk-actions" />
        </div>
      ))}
    </div>
  )
}

/** 热门 Tab 顶部「24 小时热榜」：top3 动态 + 热度值 */
export function HotBanner({ items }: { items: Array<{ p: Post; heat: number }> }) {
  if (items.length === 0) return null
  return (
    <div className="card rf-hot-banner">
      <div className="rf-hot-banner-head">
        <b>🔥 24 小时热榜</b>
        <small>按互动热度实时排序</small>
      </div>
      {items.map(({ p, heat }, i) => (
        <a key={p.id} className="rf-hot-row" href={`#/post/${p.id}`}>
          <span className={cx('rf-hot-rank', i < 3 && 'top')}>{i + 1}</span>
          <span className="rf-hot-text">{p.content.replace(/\n/g, ' ').slice(0, 46)}</span>
          <span className="rf-hot-heat">🔥 {formatCount(heat)}</span>
        </a>
      ))}
    </div>
  )
}
