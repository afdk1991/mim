/* ==========================================================================
 * PostDetailPage 动态详情 —— 正文 / 九宫格 / 转发引用 / 二级评论 / 互动
 *
 * 守卫：仅自己可见的非作者访问、以及已过期快拍一律按「不存在」处理（与原实现一致），
 *       避免通过直接改地址看到别人「仅自己」的内容。
 * 评论：只支持二级缩进（顶级评论 + 其回复），与 domain/content/rules.splitComments 对齐，
 *       不做无限层级——无限层级会让移动端缩进失控，且数据模型本身只有一层 replyTo。
 * 评论点赞：走状态层 toggleCommentLike(postId, commentId)。
 * 遗留：删除单条评论在状态层仍无出口（deleteComment 缺失），故不提供该按钮。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { Avatar, Empty, Modal, RichText, TimeAgo, useToast } from '@/ui'
import { ImageGrid, RepostModal } from './content-parts'
import { PostCard } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx, formatCount } from '@/core/utils'
import type { PostComment } from '@/domain/content/model'
import { postVisibleTo, splitComments, storyExpired } from '@/domain/content/rules'
// 浏览足迹（键 mim.history）的写入口由社交域提供，内容域只在真正打开内容时上报
import { recordView } from '../social/HistoryPage'
import { useFirstPaint } from './content-data'
import { authorOf, nameOf, userNameResolver } from './content-lib'
import { reportGrowth } from './growth-report'

export interface PostDetailPageProps {
  id: string
}

export function PostDetailPage({ id }: PostDetailPageProps) {
  const app = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const ready = useFirstPaint()
  const post = app.state.posts.find((p) => p.id === id)

  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState<PostComment | null>(null)
  const [repostOpen, setRepostOpen] = useState(false)
  /* 作者本人编辑动态：正文 + 图片（每行一个链接），走状态层 editPost（带 authorId 归属校验） */
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState({ content: '', images: '' })

  /* 打开即写一次浏览足迹（社交域 HistoryPage 读取）；依赖只放 id —— 每次状态变化都重写会不断刷新「看过时间」 */
  useEffect(() => {
    if (post) recordView('post', id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const users = app.state.users
  const me = authorOf(users, app.meId)

  /* 详情页守卫：看不见即当作不存在，不返回任何详情片段 */
  if (!post || !postVisibleTo(post, app.meId) || storyExpired(post)) {
    return (
      <div className="page-grid single">
        <div>
          <Empty emoji="🔍" text="动态不存在或已被删除" />
          <a className="btn btn-ghost btn-sm" href="#/feed">
            ← 回到广场
          </a>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="page-grid single">
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    )
  }

  const author = authorOf(users, post.authorId)
  const comments = post.comments
  const { top, repliesOf } = splitComments(comments)
  const favorited = app.state.favorites.some((f) => f.type === 'post' && f.targetId === post.id)
  const source = post.repostOfId ? app.state.posts.find((p) => p.id === post.repostOfId) : undefined

  const openEdit = (): void => {
    setDraft({ content: post.content, images: (post.images ?? []).join('\n') })
    setEditOpen(true)
  }

  const saveEdit = (): void => {
    const content = draft.content.trim()
    if (!content) {
      toast('正文不能为空')
      return
    }
    app.editPost(post.id, {
      content,
      images: draft.images
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    })
    toast('动态已更新 ✅')
    setEditOpen(false)
  }

  const submit = (): void => {
    if (!input.trim()) {
      toast('评论内容不能为空')
      return
    }
    app.addPostComment(post.id, input.trim(), replyTo?.id)
    toast(replyTo ? '回复成功' : '评论成功')
    setInput('')
    setReplyTo(null)
  }

  return (
    <div className="page-grid single">
      <div>
        <div className="card row wrap detail-back">
          <a className="btn btn-ghost btn-sm" href="#/feed">
            ← 返回广场
          </a>
          <span className="grow" />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              app.toggleFavorite('post', post.id)
              toast(favorited ? '已取消收藏' : '已收藏 ⭐')
            }}
          >
            {favorited ? '⭐ 已收藏' : '☆ 收藏'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setRepostOpen(true)}>
            🔁 转发
          </button>
          {post.authorId === app.meId ? (
            <button className="btn btn-ghost btn-sm" onClick={openEdit}>
              ✏️ 编辑
            </button>
          ) : null}
          {post.authorId === app.meId ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                app.deletePost(post.id)
                toast('动态已删除 🗑')
                navigate('/feed')
              }}
            >
              🗑 删除
            </button>
          ) : null}
        </div>

        <PostCard
          post={post}
          author={author}
          viewerId={app.meId}
          onToggleLike={() => {
            // 只在「由未赞变已赞」时上报，取消赞不倒扣（与原成长口径一致）
            if (!post.likedByMe) reportGrowth('dynamic_liked')
            app.togglePostLike(post.id)
          }}
          onRepost={() => setRepostOpen(true)}
          onDelete={post.authorId === app.meId ? () => app.deletePost(post.id) : undefined}
          onUser={(uid) => navigate(uid === app.meId ? '/my' : `/user/${uid}`)}
          onTopic={(n) => navigate(`/topic/${encodeURIComponent(n)}`)}
          resolveUser={userNameResolver(users)}
        />

        {post.images.length > 0 ? (
          <div className="card">
            <h3 className="section-title">🖼 配图（{post.images.length}）</h3>
            <ImageGrid images={post.images} />
          </div>
        ) : null}

        {/* 转发引用：被引用的原动态可能已被删除，此时如实说明，不假装还有内容 */}
        {post.repostOfId ? (
          <div className="card">
            <h3 className="section-title">🔁 转自</h3>
            {source ? (
              <a className="post-repost" href={`#/post/${source.id}`}>
                <Avatar emoji={authorOf(users, source.authorId).emoji} color={authorOf(users, source.authorId).color} size={24} />
                <div>
                  <b>{nameOf(users, source.authorId)}</b>
                  <p>{source.content}</p>
                </div>
              </a>
            ) : (
              <Empty emoji="🕳" text="原动态已被作者删除" />
            )}
          </div>
        ) : null}

        <div className="card">
          <h3 className="section-title">💬 全部评论（{comments.length}）</h3>
          {comments.length === 0 ? <Empty emoji="💬" text="还没有评论，来抢沙发" /> : null}
          {top.map((c) => (
            <div key={c.id}>
              <div className="comment-row">
                <Avatar emoji={authorOf(users, c.authorId).emoji} color={authorOf(users, c.authorId).color} size={32} />
                <div className="grow">
                  <a href={c.authorId === app.meId ? '#/my' : `#/user/${c.authorId}`} className="comment-name">
                    {nameOf(users, c.authorId)}
                  </a>
                  <p className="comment-text">
                    <RichText text={c.content} resolveUser={userNameResolver(users)} />
                  </p>
                  <small className="muted">
                    <TimeAgo ts={c.createdAt} />
                  </small>
                </div>
                <button
                  className={cx('act-btn', c.likedByMe && 'active')}
                  onClick={() => app.toggleCommentLike(post.id, c.id)}
                  title={c.likedByMe ? '取消赞' : '点赞'}
                  aria-label={c.likedByMe ? '取消赞' : '点赞'}
                >
                  ❤️ {formatCount(c.likes)}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setReplyTo(c)}>
                  ↳ 回复
                </button>
              </div>
              {repliesOf(c.id).map((r) => (
                <div key={r.id} className="comment-row reply">
                  <Avatar emoji={authorOf(users, r.authorId).emoji} color={authorOf(users, r.authorId).color} size={26} />
                  <div className="grow">
                    <a href={r.authorId === app.meId ? '#/my' : `#/user/${r.authorId}`} className="comment-name">
                      {nameOf(users, r.authorId)}
                    </a>
                    <p className="comment-text">
                      <span className="reply-prefix">↳ 回复 @{nameOf(users, c.authorId)}：</span>
                      <RichText text={r.content} resolveUser={userNameResolver(users)} />
                    </p>
                    <small className="muted">
                      <TimeAgo ts={r.createdAt} />
                    </small>
                  </div>
                  <button
                    className={cx('act-btn', r.likedByMe && 'active')}
                    onClick={() => app.toggleCommentLike(post.id, r.id)}
                    title={r.likedByMe ? '取消赞' : '点赞'}
                    aria-label={r.likedByMe ? '取消赞' : '点赞'}
                  >
                    ❤️ {formatCount(r.likes)}
                  </button>
                </div>
              ))}
            </div>
          ))}

          <div className={cx('msg-input-bar', 'comment-input')}>
            <Avatar emoji={me.emoji} color={me.color} size={32} />
            <input
              className="input"
              placeholder={replyTo ? `回复 @${nameOf(users, replyTo.authorId)}…` : `回复 @${author.name}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            {replyTo ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)}>
                取消回复
              </button>
            ) : null}
            <button className="btn btn-primary btn-sm" onClick={submit}>
              评论
            </button>
          </div>
        </div>
      </div>

      {repostOpen ? <RepostModal post={post} onClose={() => setRepostOpen(false)} /> : null}

      {editOpen ? (
        <Modal title="编辑动态" onClose={() => setEditOpen(false)}>
          <label className="edit-label">正文</label>
          <textarea
            className="input"
            rows={5}
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
          <label className="edit-label">图片（每行一个链接，可留空）</label>
          <textarea
            className="input mono-textarea"
            rows={3}
            placeholder="https://..."
            value={draft.images}
            onChange={(e) => setDraft({ ...draft, images: e.target.value })}
          />
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={saveEdit}>
              保存
            </button>
            <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              取消
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
