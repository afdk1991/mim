/* ==========================================================================
 * 内容域页面共用小组件 —— 四态容器 / 用户行 / 关注按钮 / 关键词高亮 / 九宫格
 *
 * 收敛目的：这类快手级组件在多个页面重复出现，抽出来保证「空态文案、关注态、
 * 高亮方式」在内容域内只有一处实现，不随页面各自漂移。
 * 组件本身不读业务状态，交互由调用方注入；只有 FollowButton 直接依赖状态层的
 * toggleFollow 唯一出口（关注操作全站语义一致，没必要再回调包一层）。
 * ======================================================================== */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar, Empty, Modal, Skeleton, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx } from '@/core/utils'
import type { Post } from '@/domain/content/model'
import { authorOf, highlightPieces } from './content-lib'
import type { AuthorLite } from './content-lib'

/* ---------- 四态容器 ---------- */

export interface AsyncStateProps {
  loading: boolean
  /** 非空 → 降级为空态并展示该说明（后端未就绪 / 读取失败） */
  error?: string
  /** 非空 → 展示该空态；由调用方按数据长度给出，文案要告诉用户下一步做什么 */
  empty?: ReactNode
  skeletonRows?: number
  children: ReactNode
}

/** 每个列表区块都必须经过它：加载中 / 空数据 / 错误降级 / 有数据 */
export function AsyncState({ loading, error, empty, skeletonRows = 3, children }: AsyncStateProps) {
  if (loading) return <Skeleton rows={skeletonRows} height={92} />
  if (error) return <Empty emoji="⚠️" text={error} />
  if (empty !== undefined && empty !== null && empty !== false) return <>{empty}</>
  return <>{children}</>
}

/* ---------- 用户行 ---------- */

export function UserRow({
  author,
  meId,
  size = 36,
  sub,
  right,
}: {
  author: AuthorLite
  meId: string
  size?: number
  sub?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="user-row">
      <Avatar emoji={author.emoji} color={author.color} size={size} />
      <div className="grow">
        <a href={author.id === meId ? '#/my' : `#/user/${author.id}`} className="user-name">
          {author.name}
          {author.verified ? <span title="已认证"> ✅</span> : null}
        </a>
        {sub ? <small className="muted user-sub">{sub}</small> : null}
      </div>
      {right}
    </div>
  )
}

/* ---------- 关注按钮 ---------- */

export function FollowButton({ userId, small = true }: { userId: string; small?: boolean }) {
  const app = useApp()
  if (userId === app.meId) return null
  const following = app.state.following.includes(userId)
  return (
    <button
      className={cx('btn', following ? 'btn-ghost' : 'btn-primary', small && 'btn-sm')}
      onClick={() => app.toggleFollow(userId)}
    >
      {following ? '已关注' : '+ 关注'}
    </button>
  )
}

/* ---------- 关键词高亮 ---------- */

export function Highlight({ text, kw }: { text: string; kw: string }) {
  const pieces = highlightPieces(text, kw)
  return (
    <>
      {pieces.map((piece, i) =>
        piece.hit ? (
          <mark key={i} className="hl">
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  )
}

/* ---------- 转发弹窗（Feed 与动态详情共用同一套转发动作） ---------- */

export function RepostModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const app = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const [comment, setComment] = useState('')

  const submit = (): void => {
    const id = app.repostPost(post.id, comment.trim())
    toast('已转发到你的时间线 🔁')
    onClose()
    navigate(`/post/${id}`)
  }

  return (
    <Modal title="转发动态" onClose={onClose}>
      <div className="post-repost">
        <b>{authorOf(app.state.users, post.authorId).name}</b>
        <p>{post.content}</p>
      </div>
      <textarea
        className="input"
        rows={3}
        placeholder="说说你的看法…（可留空，留空则记为「转发动态」）"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          取消
        </button>
        <button className="btn btn-primary" onClick={submit}>
          转发
        </button>
      </div>
    </Modal>
  )
}

/* ---------- 图片九宫格 ---------- */

const isUrl = (s: string): boolean => /^https?:\/\//.test(s)

/** 九宫格：emoji 占位图与真实图片地址混排（沿用 .post-images 的 n1~n9 栅格），点击看大图 */
export function ImageGrid({ images }: { images: string[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const list = images.slice(0, 9)
  if (list.length === 0) return null
  return (
    <>
      <div className={cx('post-images', `n${list.length}`)}>
        {list.map((src, i) => (
          <button key={`${src}-${i}`} className="img-cell" onClick={() => setOpen(src)} aria-label="查看图片">
            {isUrl(src) ? <img src={src} alt="" /> : <span>{src}</span>}
          </button>
        ))}
      </div>
      {open !== null && (
        <Modal title="查看图片" onClose={() => setOpen(null)}>
          <div className="img-preview">
            {isUrl(open) ? <img src={open} alt="" /> : <span className="img-preview-emoji">{open}</span>}
          </div>
        </Modal>
      )}
    </>
  )
}
