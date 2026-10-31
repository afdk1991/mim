/* ==========================================================================
 * 内容卡片 —— 动态 / 文章 / 媒体 / 投票 / 抽奖
 *
 * 组件不读全局状态、不直接调后端：所有交互通过回调外抛，
 * 由页面注入真实动作。这样同一张卡片能在广场、话题页、个人主页复用。
 * ======================================================================== */

import { useState } from 'react'
import type { Article, Post, PostLottery, PostMedia, PostVote } from '../domain/content/model'
import { canDrawLottery, voteOpen, voteTotal } from '../domain/content/rules'
import { formatCount, timeAgo, yuanText } from '../core/utils'
import { Avatar, Badge, RichText } from './index'
import { cx } from '../core/utils'

export interface AuthorLite {
  id: string
  name: string
  emoji: string
  color: string
  verified?: boolean
}

/* ---------- 动态卡片 ---------- */

export interface PostCardProps {
  post: Post
  author?: AuthorLite
  viewerId: string
  onToggleLike?: () => void
  onRepost?: () => void
  onComment?: () => void
  /** 投票：回调抛出选项下标，由页面决定如何落库（卡片本身不碰状态） */
  onVote?: (optionIndex: number) => void
  onDelete?: () => void
  onOpen?: () => void
  onUser?: (id: string) => void
  onTopic?: (name: string) => void
  resolveUser?: (name: string) => string | null
  compact?: boolean
}

export function PostCard({
  post,
  author,
  viewerId,
  onToggleLike,
  onRepost,
  onComment,
  onVote,
  onDelete,
  onOpen,
  onUser,
  onTopic,
  resolveUser,
  compact = false,
}: PostCardProps) {
  const images = post.images.slice(0, 9)
  const isMine = post.authorId === viewerId

  return (
    <article className="post-card">
      <header className="post-head">
        <Avatar
          emoji={author?.emoji ?? '🙂'}
          color={author?.color ?? 'var(--bg-soft)'}
          size={compact ? 34 : 42}
        />
        <div className="post-author grow">
          <button
            className="btn btn-ghost btn-sm"
            style={{ padding: 0, border: 'none', fontWeight: 600 }}
            onClick={() => (author ? onUser?.(author.id) : undefined)}
          >
            {author?.name ?? '匿名用户'}
            {author?.verified ? <span title="已认证"> ✅</span> : null}
          </button>
          <small>
            {timeAgo(post.createdAt)}
            {post.source ? ` · ${post.source}` : ''}
            {post.pinned ? ' · 置顶' : ''}
          </small>
        </div>
        {post.visibility === 'self' ? <Badge cls="closed">仅自己可见</Badge> : null}
        {isMine && onDelete ? (
          <button className="btn btn-ghost btn-sm" onClick={onDelete}>
            删除
          </button>
        ) : null}
      </header>

      <div className="post-body" onClick={onOpen}>
        <RichText text={post.content} resolveUser={resolveUser} onTopic={onTopic} onUser={onUser} />
      </div>

      {images.length > 0 ? (
        <div className={cx('post-images', `n${images.length}`)}>
          {images.map((src, i) => (
            <span key={i}>{isUrl(src) ? <img src={src} alt="" /> : src}</span>
          ))}
        </div>
      ) : null}

      {post.media ? <MediaCard media={post.media} /> : null}
      {post.vote ? <VoteBlock vote={post.vote} viewerId={viewerId} onVote={onVote} /> : null}
      {post.lottery ? <LotteryBlock lottery={post.lottery} viewerId={viewerId} /> : null}
      {post.location ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          📍 {post.location}
        </div>
      ) : null}

      <footer className="post-actions">
        <button onClick={onRepost}>
          🔁 {post.reposts > 0 ? formatCount(post.reposts) : '转发'}
        </button>
        <button onClick={onComment}>
          💬 {post.comments.length > 0 ? formatCount(post.comments.length) : '评论'}
        </button>
        <button onClick={onToggleLike} style={post.likedByMe ? { color: 'var(--primary)' } : undefined}>
          {post.likedByMe ? '❤️' : '🤍'} {post.likes > 0 ? formatCount(post.likes) : '赞'}
        </button>
        {typeof post.views === 'number' ? <span>👀 {formatCount(post.views)}</span> : null}
      </footer>
    </article>
  )
}

function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s)
}

/* ---------- 媒体卡 ---------- */

export function MediaCard({ media, onPlay }: { media: PostMedia; onPlay?: () => void }) {
  if (!media.src) {
    // 不伪造画面：无真实片源时退化为海报占位
    return (
      <div className="vote-block">
        <div className="row">
          <span style={{ fontSize: 24 }}>{media.kind === 'audio' ? '🎵' : '🎬'}</span>
          <div className="grow">
            <div>{media.title ?? '媒体内容'}</div>
            <small className="muted">暂无可播放片源</small>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="vote-block">
      <div className="row">
        <span style={{ fontSize: 24 }}>{media.kind === 'audio' ? '🎵' : '🎬'}</span>
        <div className="grow">
          <div>{media.title ?? media.src}</div>
          <small className="muted">{media.kind === 'audio' ? '音频' : '视频'}</small>
        </div>
        {onPlay ? (
          <button className="btn btn-primary btn-sm" onClick={onPlay}>
            播放
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ---------- 投票 ---------- */

export function VoteBlock({
  vote,
  viewerId,
  onVote,
}: {
  vote: PostVote
  viewerId: string
  onVote?: (optionIndex: number) => void
}) {
  const total = voteTotal(vote)
  const open = voteOpen(vote)
  const voted = vote.voters[viewerId] !== undefined
  return (
    <div className="vote-block">
      <div style={{ fontWeight: 600 }}>{vote.question}</div>
      {vote.options.map((opt, i) => {
        const pct = total > 0 ? Math.round((vote.counts[i] ?? 0) / total * 100) : 0
        return (
          <div className="vote-opt" key={`${opt}-${i}`}>
            <button
              className="btn btn-sm"
              disabled={!open || voted || !onVote}
              onClick={() => onVote?.(i)}
            >
              {opt}
            </button>
            <div className="vote-bar">
              <i style={{ width: `${voted || !open ? pct : 0}%` }} />
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              {voted || !open ? `${pct}%` : '—'}
            </span>
          </div>
        )
      })}
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {open ? (voted ? '已投票' : '可选一项') : '投票已截止'} · 共 {total} 票
      </div>
    </div>
  )
}

/* ---------- 抽奖 ---------- */

export function LotteryBlock({
  lottery,
  viewerId,
  onJoin,
  onDraw,
}: {
  lottery: PostLottery
  viewerId: string
  onJoin?: () => void
  onDraw?: () => void
}) {
  const joined = lottery.participants.includes(viewerId)
  const drawn = !!lottery.winners && lottery.winners.length > 0
  const drawable = canDrawLottery(lottery)
  return (
    <div className="lottery-block">
      <div className="row-between">
        <span style={{ fontWeight: 600 }}>🎁 {lottery.prize}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {lottery.count} 份 · {lottery.participants.length} 人参与
        </span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-sm" disabled={joined || !onJoin} onClick={onJoin}>
          {joined ? '已参与' : '参与抽奖'}
        </button>
        {drawable && !drawn ? (
          <button className="btn btn-primary btn-sm" onClick={onDraw}>
            立即开奖
          </button>
        ) : null}
      </div>
      {drawn ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          中奖：{lottery.winners?.join('、')}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- 文章卡 ---------- */

export function ArticleCard({
  article,
  author,
  onOpen,
  onToggleLike,
}: {
  article: Article
  author?: AuthorLite
  onOpen?: () => void
  onToggleLike?: () => void
}) {
  // 只需要 setter 翻转展开态；读到的值本身未参与渲染，故不解构（避免 TS6133 未使用变量）
  const [, setExpanded] = useState(false)
  return (
    <article className="article-card">
      <h3>
        <button
          className="btn btn-ghost"
          style={{ padding: 0, border: 'none', fontSize: 15, fontWeight: 600 }}
          onClick={onOpen}
        >
          {article.title}
        </button>
      </h3>
      <p className="dim" style={{ margin: '0 0 8px' }}>
        {article.summary}
      </p>
      <div className="row-between">
        <span className="muted" style={{ fontSize: 12 }}>
          {author?.name ?? '匿名'} · {timeAgo(article.createdAt)} · 👀 {formatCount(article.views)}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {article.tags.slice(0, 3).map((t) => (
            <a key={t} className="tag" href={`#/search?q=${encodeURIComponent(t)}`}>
              {t}
            </a>
          ))}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onToggleLike?.()
              setExpanded((v) => !v)
            }}
          >
            {article.likedByMe ? '❤️' : '🤍'} {article.likes}
          </button>
        </span>
      </div>
    </article>
  )
}

/** 金额展示：分 → ¥x.xx */
export function Money({ fen }: { fen: number }) {
  return <span style={{ color: 'var(--danger)', fontWeight: 600 }}>¥{yuanText(fen)}</span>
}
