import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import type { Article, Post } from './types'
import { cx, formatCount, timeAgo } from './utils'
import { useApp } from './store'
import { useRouter } from './router'
import { useAuth } from './auth'
import { can } from './permissions'

/* ---------- Avatar ---------- */

export function Avatar({ emoji, color, size = 44 }: { emoji: string; color: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.52, background: color, lineHeight: `${size}px` }}
    >
      {emoji}
    </span>
  )
}

/* ---------- UserLink ---------- */

export function UserLink({ userId, size = 44 }: { userId: string; size?: number }) {
  const { user, state } = useApp()
  const u = user(userId)
  return (
    <a className="user-link" href={userId === state.meId ? '#/my' : `#/user/${u.id}`}>
      <Avatar emoji={u.emoji} color={u.color} size={size} />
      <span className="user-link-info">
        <b>
          {u.name}
          {u.verified && <span className="v-badge" title="认证用户">V</span>}
        </b>
        <small>{formatCount(u.followers)} 粉丝</small>
      </span>
    </a>
  )
}

/* ---------- Tag / Empty ---------- */

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>
}

export function Empty({ emoji = '📭', text = '暂无内容' }: { emoji?: string; text?: string }) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <p>{text}</p>
    </div>
  )
}

export function TimeAgo({ ts }: { ts: number }) {
  return <time className="time-ago">{timeAgo(ts)}</time>
}

/* ---------- RichText：#话题# 与 @用户 ---------- */

export function RichText({ text }: { text: string }) {
  const { state } = useApp()
  const parts: ReactNode[] = []
  const re = /#([^#]+)#|@([\u4e00-\u9fa5\w-]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1]) {
      parts.push(
        <a key={key++} className="rich-topic" href={`#/topic/${encodeURIComponent(m[1])}`}>
          #{m[1]}#
        </a>,
      )
    } else if (m[2]) {
      const atName = m[2]
      const u = Object.values(state.users).find((x) => x.name === atName)
      parts.push(
        u ? (
          <a key={key++} className="rich-at" href={u.id === state.meId ? '#/my' : `#/user/${u.id}`}>
            @{atName}
          </a>
        ) : (
          <span key={key++}>@{atName}</span>
        ),
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className="rich-text">{parts}</span>
}

/* ---------- Modal ---------- */

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

/* ---------- Toast ---------- */

interface ToastItem {
  id: number
  text: string
}

const ToastCtx = createContext<(text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    /* 连续相同文案去重：避免连点叠加重复提示 */
    setItems((s) => (s[s.length - 1]?.text === text ? s : [...s, { id, text }]))
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 1800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className="toast">{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

/* ---------- FollowButton ---------- */

export function FollowButton({ userId, small = false }: { userId: string; small?: boolean }) {
  const { me, isFollowing, toggleFollow } = useApp()
  if (userId === me.id) return null
  const following = isFollowing(userId)
  return (
    <button
      className={cx('btn', following ? 'btn-ghost' : 'btn-primary', small && 'btn-sm')}
      onClick={() => toggleFollow(userId)}
    >
      {following ? '已关注' : '+ 关注'}
    </button>
  )
}

/* ---------- PostCard ---------- */

export function PostCard({ post, compact = false }: { post: Post; compact?: boolean }) {
  const api = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const [repostOpen, setRepostOpen] = useState(false)
  const [repostText, setRepostText] = useState('')
  const quoted = post.repostOfId ? api.state.posts.find((p) => p.id === post.repostOfId) : null
  const quotedAuthor = quoted ? api.user(quoted.authorId) : null
  const { auth } = useAuth()
  // 能力守卫：统一走 can()（guest 模式自动隐藏删除入口），reducer ownership 静默兜底
  const mine = can(auth.mode, api.state.meId, 'post:delete', post)

  return (
    <article className="card post-card">
      {post.repostComment && quoted && (
        <div className="repost-note">
          <RichText text={post.repostComment} />
        </div>
      )}
      <div className="post-head">
        <UserLink userId={post.authorId} />
        <div className="post-head-meta">
          <TimeAgo ts={post.createdAt} />
          <span className="post-source">来自{post.source}</span>
        </div>
        {mine && (
          <button
            className="icon-btn post-del"
            aria-label="删除动态"
            onClick={() => {
              api.deletePost(post.id)
              toast('动态已删除')
            }}
          >
            🗑
          </button>
        )}
      </div>

      {!post.repostComment && (
        <div className="post-content">
          <RichText text={post.content} />
        </div>
      )}

      {post.images.length > 0 && (
        <div className={cx('post-images', `n${Math.min(post.images.length, 9)}`)}>
          {post.images.slice(0, 9).map((img, i) => (
            <span key={i} className="post-image" role="img" aria-label="配图">
              {img}
            </span>
          ))}
        </div>
      )}

      {quoted && quotedAuthor && (
        <a className="quote-card" href={`#/post/${quoted.id}`}>
          <div className="quote-author">
            {quotedAuthor.name} <TimeAgo ts={quoted.createdAt} />
          </div>
          <div className="quote-text">{quoted.content}</div>
          {quoted.images.length > 0 && (
            <div className="quote-images">{quoted.images.map((img, i) => <span key={i}>{img}</span>)}</div>
          )}
        </a>
      )}

      <div className="post-actions">
        <button className={cx('pa-btn', post.likedByMe && 'active')} onClick={() => api.togglePostLike(post.id)}>
          {post.likedByMe ? '❤️' : '🤍'} {formatCount(post.likes)}
        </button>
        <a className="pa-btn" href={`#/post/${post.id}`}>
          💬 {compact ? '评论' : formatCount(post.comments?.length ?? 0)}
        </a>
        <button className="pa-btn" onClick={() => setRepostOpen(true)}>
          🔁 {formatCount(post.reposts)}
        </button>
        <button
          className={cx('pa-btn', api.isFavorited('post', post.id) && 'active')}
          onClick={() => {
            api.toggleFavorite('post', post.id)
            toast(api.isFavorited('post', post.id) ? '已取消收藏' : '已收藏')
          }}
        >
          {api.isFavorited('post', post.id) ? '⭐' : '☆'} 收藏
        </button>
      </div>

      {repostOpen && (
        <Modal title="转发动态" onClose={() => setRepostOpen(false)}>
          <textarea
            className="input repost-input"
            rows={3}
            placeholder="说说你的转发理由…"
            value={repostText}
            onChange={(e) => setRepostText(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setRepostOpen(false)}>取消</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                api.repostPost(post.id, repostText || '转发动态')
                setRepostOpen(false)
                setRepostText('')
                toast('转发成功')
              }}
            >
              转发
            </button>
          </div>
        </Modal>
      )}
    </article>
  )
}

/* ---------- ArticleCard ---------- */

export function ArticleCard({ article }: { article: Article }) {
  const api = useApp()
  const toast = useToast()
  const author = api.user(article.authorId)
  const fav = api.isFavorited('article', article.id)
  return (
    <article className="card article-card">
      <div className="article-card-main">
        <a href={`#/article/${article.id}`} className="article-title">
          {article.title}
        </a>
        <p className="article-summary">{article.summary}</p>
        <div className="article-meta">
          <a className="article-author" href={article.authorId === api.me.id ? '#/my' : `#/user/${article.authorId}`}>
            <Avatar emoji={author.emoji} color={author.color} size={20} />
            {author.name}
          </a>
          <TimeAgo ts={article.createdAt} />
          <span>👁 {formatCount(article.views)}</span>
          <span>👍 {formatCount(article.likes)}</span>
          <span>💬 {article.comments.length}</span>
          <div className="article-tags">
            {article.tags.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        </div>
      </div>
      <button
        className={cx('icon-btn star-btn', fav && 'active')}
        title={fav ? '取消收藏' : '收藏'}
        onClick={() => {
          api.toggleFavorite('article', article.id)
          toast(fav ? '已取消收藏' : '已收藏')
        }}
      >
        {fav ? '⭐' : '☆'}
      </button>
    </article>
  )
}
