import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Article, Post, PostComment, PostLottery, PostMedia, PostVote, User } from './types'
import { cx, formatCount, timeAgo } from './utils'
import { useApp } from './store'
import { useRouter } from './router'
import { useAuth } from './auth'
import { can } from './permissions'
import { VBadge } from './user-domain'
import { recordNotInterested } from './lib/feed-core'
import { DanmakuLayer } from './media-domain' /* 轮 24 打通：B5 视频弹幕层 */
import { detectMediaKind, usePlayerControl, type MediaTrack } from './player' /* 全站统一播放器：动态视频卡复用，避免重复实现 */

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
          {/* 轮 20 打通：V 徽章统一走 VBadge（本人按用户域认证状态区分橙V/蓝V） */}
          <VBadge u={u} />
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

/* 轮 13 打通：模块级 toast 出口。store api 层/成长引擎等非 React 调用链
   （在 ToastProvider 之外）通过 emitToast 派发提示；Provider 未挂载时静默丢弃。 */
let toastPush: ((text: string) => void) | null = null

export function emitToast(text: string): void {
  toastPush?.(text)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    /* 连续相同文案去重：避免连点叠加重复提示 */
    setItems((s) => (s[s.length - 1]?.text === text ? s : [...s, { id, text }]))
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 1800)
  }, [])
  /* 注册模块级出口：供 React 树外的跨模块链路（成长记分/钱包入账）复用同一 toast 队列 */
  useEffect(() => {
    toastPush = push
    return () => {
      toastPush = null
    }
  }, [push])
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

/* ---------- 轮 21 打通：B2 内容域卡片扩展（视频/GIF / 投票 / 抽奖 / 位置 / 可见性角标） ---------- */

/** 1. 视频/GIF 媒体卡：海报 + 播放按钮 + 时长角标；
    - 有真实直链（media.src）时，点击交由全站统一播放器接管（跨页不中断、可拖拽进度、可切歌）；
    - 无直链时保持原占位播放器（弹幕等体验不变）。 */
export function MediaCard({ media, postId }: { media: PostMedia; postId?: string }) {
  const [open, setOpen] = useState(false)
  const player = usePlayerControl()

  const launch = () => {
    if (!media.src) {
      setOpen(true)
      return
    }
    const kind = media.kind ?? detectMediaKind(media.src)
    const track: MediaTrack = {
      id: `post:${postId ?? media.poster}`,
      title: '动态视频',
      kind,
      src: media.src,
      poster: media.poster,
      cover: media.poster,
      meta: '动态视频 · 全站统一播放器',
    }
    player.play(track, { position: 0 })
  }

  return (
    <>
      <button
        type="button"
        className={cx('wt-media-card', media.type === 'gif' && 'wt-gif')}
        onClick={launch}
        aria-label={media.type === 'gif' ? '播放GIF' : '播放视频'}
      >
        <span className="wt-media-poster">{media.poster}</span>
        <span className="wt-media-play">{media.type === 'gif' ? 'GIF · 动图' : '▶'}</span>
        {media.type === 'video' && media.duration != null && (
          <span className="wt-media-dur">{formatCount(media.duration)}s</span>
        )}
      </button>
      {open && (
        <Modal title={media.type === 'gif' ? 'GIF 动图（占位播放器）' : '视频播放（占位播放器）'} onClose={() => setOpen(false)}>
          <VideoPlayerScreen media={media} postId={postId} />
        </Modal>
      )}
    </>
  )
}

/** 占位播放器画面：假进度条（useEffect 计时推进），视频/GIF 均可复用；轮 24 打通：挂 B5 弹幕层 */
export function VideoPlayerScreen({ media, postId }: { media: PostMedia; postId?: string }) {
  const total = media.type === 'video' ? (media.duration ?? 15) : 5
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSec((s) => (s >= total ? total : s + 0.2))
    }, 200)
    return () => window.clearInterval(timer)
  }, [total])
  const done = sec >= total
  return (
    <>
      {/* 轮 24 打通：B5 弹幕层挂载（按 post id 分 key，无 post id 退化为海报 key） */}
      <div className="md-player-host">
        <div className={cx('wt-player-screen', media.type === 'gif' && 'wt-gif')}>{media.poster}</div>
        <DanmakuLayer postId={postId} posterKey={media.poster} />
      </div>
      <div className="wt-player-bar">
        <span style={{ width: `${Math.min(100, (sec / total) * 100)}%` }} />
      </div>
      <div className="wt-player-meta">
        <span>{done ? '播放完毕' : '播放中…'}</span>
        <span>
          {sec.toFixed(1)}s / {total}s
        </span>
      </div>
    </>
  )
}

/** 2. 投票块：一人一票（按身份 key），百分比条 + 总票数，截止锁定 */
export function VoteBlock({ postId, vote }: { postId: string; vote: PostVote }) {
  const api = useApp()
  const toast = useToast()
  const ended = Date.now() > vote.endsAt
  const mine = vote.voters[api.me.id]
  const total = Object.values(vote.votes).reduce((a, b) => a + b, 0)
  return (
    <div className="wt-vote">
      {vote.options.map((opt) => {
        const n = vote.votes[opt] ?? 0
        const pct = total > 0 ? Math.round((n / total) * 100) : 0
        return (
          <button
            key={opt}
            type="button"
            className={cx('wt-vote-opt', mine === opt && 'picked')}
            disabled={ended || !!mine}
            onClick={() => {
              api.castVote(postId, opt)
              toast('投票成功，一人一票 🗳️')
            }}
          >
            <span className="wt-vote-fill" style={{ width: `${pct}%` }} />
            <span className="wt-vote-label">
              {opt}
              {mine === opt ? '（已投）' : ''}
            </span>
            <span className="wt-vote-pct">
              {pct}% · {formatCount(n)}票
            </span>
          </button>
        )
      })}
      <span className="wt-vote-meta">
        {formatCount(total)} 人投票 · {ended ? '已截止' : `${Math.max(1, Math.ceil((vote.endsAt - Date.now()) / 3_600_000))} 小时后截止`}
        {ended ? ' · 已锁定' : ''}
      </span>
    </div>
  )
}

/** 3. 抽奖块：参与去重 → 倒计时/立即开奖 → emoji 名单公示 */
export function LotteryBlock({ postId, lottery }: { postId: string; lottery: PostLottery }) {
  const api = useApp()
  const toast = useToast()
  const joined = lottery.participants.includes(api.me.id)
  const ended = lottery.winners || Date.now() > lottery.endsAt
  const hoursLeft = Math.max(0, Math.ceil((lottery.endsAt - Date.now()) / 3_600_000))

  const draw = () => {
    if (lottery.participants.length === 0) {
      toast('还没有人参与，无法开奖')
      return
    }
    const shuffled = [...lottery.participants].sort(() => Math.random() - 0.5)
    const winners = shuffled.slice(0, Math.min(lottery.count, lottery.participants.length))
    api.drawLottery(postId, winners)
    emitToast(`🎉 中奖名单：${winners.map((id) => api.user(id)?.emoji ?? '😀').join(' ')} 恭喜！`)
  }

  return (
    <div className="wt-lottery">
      <div className="wt-lottery-head">🎁 {lottery.prize}</div>
      <div className="wt-lottery-meta">
        共 {lottery.count} 份 · {formatCount(lottery.participants.length)} 人参与 ·{' '}
        {lottery.winners ? '已开奖' : ended ? '已到开奖时间' : `${hoursLeft} 小时后开奖`}
      </div>
      {!lottery.winners && (
        <div className="wt-lottery-actions">
          {!joined ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => api.joinLottery(postId)}>
              参与抽奖
            </button>
          ) : (
            <span className="wt-lottery-joined">✅ 已参与，坐等开奖</span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={draw}>
            立即开奖
          </button>
        </div>
      )}
      {lottery.winners && (
        <div className="wt-lottery-winners">
          <span>🎉 中奖：</span>
          {lottery.winners.map((id) => (
            <span key={id} className="wt-winner-chip">
              {api.user(id)?.emoji ?? '😀'} {api.user(id)?.name ?? '神秘用户'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- PostCard ---------- */

export function PostCard({ post, compact = false }: { post: Post; compact?: boolean }) {
  const api = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const [repostOpen, setRepostOpen] = useState(false)
  const [repostText, setRepostText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
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
          {/* 轮 25 打通：置顶标识（对齐微博置顶微博标） */}
          {post.pinned && <span className="wt-pin-tag">📌 置顶</span>}
          {/* 轮 21 打通：8. 仅自己可见角标 */}
          {post.visibility === 'self' && <span className="wt-vis-tag">🔒 仅自己</span>}
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

      {/* 轮 21 打通：1. 视频/GIF 媒体卡（海报 + 播放按钮 + 时长角标）；轮 24 打通：透传 post id 供弹幕分 key */}
      {post.media && <MediaCard media={post.media} postId={post.id} />}
      {/* 轮 21 打通：2. 投票块（一人一票，截止锁定） */}
      {post.vote && <VoteBlock postId={post.id} vote={post.vote} />}
      {/* 轮 21 打通：3. 抽奖块（参与去重 / 开奖公示） */}
      {post.lottery && <LotteryBlock postId={post.id} lottery={post.lottery} />}

      {quoted && quotedAuthor && (
        <a className="quote-card" href={`#/post/${quoted.id}`}>
          <div className="quote-author">
            {quotedAuthor.name} <TimeAgo ts={quoted.createdAt} />
          </div>
          {/* 轮 25 打通：转发卡原文同样走 RichText（@用户 / #话题# 高亮），与主正文一致 */}
          <div className="quote-text">
            <RichText text={quoted.content} />
          </div>
          {quoted.images.length > 0 && (
            <div className="quote-images">{quoted.images.map((img, i) => <span key={i}>{img}</span>)}</div>
          )}
        </a>
      )}

      {/* 轮 21 打通：4. 位置显示在卡片底部操作区上方 */}
      {post.location && <div className="wt-loc">📍 {post.location}</div>}

      <div className="post-actions">
        <button className={cx('pa-btn', post.likedByMe && 'active')} onClick={() => api.togglePostLike(post.id)}>
          {/* 轮 25 打通：点赞 pop 动画 —— key 随 likedByMe 切换强制重挂，仅点亮态播放 */}
          <span key={post.likedByMe ? 'on' : 'off'} className={cx('pa-like-emoji', post.likedByMe && 'pop')}>
            {post.likedByMe ? '❤️' : '🤍'}
          </span>{' '}
          {formatCount(post.likes)}
        </button>
        <a className="pa-btn" href={`#/post/${post.id}`}>
          💬 {compact ? '评论' : formatCount(post.comments?.length ?? 0)}
        </a>
        <button className="pa-btn" onClick={() => setRepostOpen(true)}>
          🔁 {formatCount(post.reposts)}
        </button>
        {/* 轮 25 打通：阅读量（缺省字段不显示，避免老数据出现「阅读 0」） */}
        {post.views != null && <span className="pa-views">👁 {formatCount(post.views)}</span>}
        <button
          className={cx('pa-btn', api.isFavorited('post', post.id) && 'active')}
          onClick={() => {
            api.toggleFavorite('post', post.id)
            toast(api.isFavorited('post', post.id) ? '已取消收藏' : '已收藏')
          }}
        >
          {api.isFavorited('post', post.id) ? '⭐' : '☆'} 收藏
        </button>
        {/* 轮 23 打通：B4 负反馈入口 —— 「···」菜单收起「不感兴趣」；点击后按登录身份记录作者级+话题级，
            各流监听 RF_EVT 即时消失并 toast 提示 */}
        <button className="pa-btn" aria-label="更多操作" onClick={() => setMenuOpen((v) => !v)}>
          ···
        </button>
        {menuOpen && (
          <div className="rf-post-menu">
            <button
              type="button"
              onClick={() => {
                recordNotInterested(post)
                setMenuOpen(false)
                toast('将减少此类内容推荐')
              }}
            >
              🚫 不感兴趣
            </button>
          </div>
        )}
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
