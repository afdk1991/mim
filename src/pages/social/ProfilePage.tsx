/* ==========================================================================
 * 他人主页 —— 资料卡 / 关注按钮 / 私信 / 其可见动态
 *
 * 数据：state.users 反查；不存在 → 空态「用户不存在或已注销」（不编造资料）。
 * 可见性：一律走 domain/content/rules 的 postVisibleTo，「仅自己可见」的动态看不到。
 *
 * 坑：访问自己的 id 必须重定向到 /my，否则会出现「自己关注自己」的歧义页；
 *     重定向前先 return null，避免闪现一帧他人主页。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { postVisibleTo } from '@/domain/content/rules'
import { subscribe, EVT } from '@/core/events'
import { getBlacklist, setBlacklist } from '@/app/state/identity'
import { Avatar, Empty, PostCard, Tag, useToast } from '@/ui'
import { cx, formatCount } from '@/core/utils'

export interface ProfilePageProps {
  id: string
}

export function ProfilePage({ id }: ProfilePageProps) {
  const api = useApp()
  const { navigate } = useRouter()
  const toast = useToast()
  const [blacklist, setList] = useState<string[]>(getBlacklist)

  // 黑名单在设置页改动后，回到本页要立刻反映「已拉黑」按钮状态
  useEffect(() => subscribe(EVT.identity, () => setList(getBlacklist())), [])

  const { meId, users, posts, following } = api.state
  const isMe = id === meId

  useEffect(() => {
    if (isMe) navigate('/my')
  }, [isMe, navigate])

  if (isMe) return null

  const user = users.find((u) => u.id === id)
  if (!user) return <Empty emoji="👻" text="用户不存在或已注销" />

  // 快拍只进快拍栏，主页列表不混排（与 Feed 过滤链保持同一口径）
  const visible = posts.filter((p) => p.authorId === id && !p.story && postVisibleTo(p, meId))
  const isFollowing = following.includes(id)
  const blocked = blacklist.includes(id)

  const toggleBlock = (): void => {
    const next = blocked ? blacklist.filter((x) => x !== id) : [...blacklist, id]
    setBlacklist(next)
    setList(next)
    toast(blocked ? `已将 ${user.name} 移出黑名单` : `已拉黑 ${user.name}，TA 的私信将被拦截`)
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          <Avatar emoji={user.emoji} color={user.color} size={64} />
          <div className="grow">
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {user.name}
              {user.verified ? ' ✅' : ''}
            </div>
            <small className="muted">@{user.id}</small>
          </div>
          <button
            className={cx('btn btn-sm', isFollowing ? 'btn-ghost' : 'btn-primary')}
            onClick={() => {
              api.toggleFollow(id)
              toast(isFollowing ? `已取消关注 ${user.name}` : `已关注 ${user.name}`)
            }}
          >
            {isFollowing ? '已关注' : '+ 关注'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/messages?with=${id}`)}>
            ✉️ 私信
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleBlock}>
            {blocked ? '✅ 移出黑名单' : '🚫 拉黑'}
          </button>
        </div>
        <p className="dim" style={{ margin: '10px 0 0' }}>
          {user.bio || '暂无签名'}
        </p>
        <div className="row wrap" style={{ marginTop: 10, gap: 16, fontSize: 13 }}>
          <span>
            <b>{formatCount(user.followers)}</b> <span className="muted">粉丝</span>
          </span>
          <span>
            <b>{formatCount(user.following)}</b> <span className="muted">关注</span>
          </span>
          <span>
            <b>{formatCount(visible.length)}</b> <span className="muted">可见动态</span>
          </span>
          {blocked ? <Tag>已拉黑</Tag> : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty emoji="🕊" text={blocked ? '已拉黑该用户，其动态不再展示' : 'TA 还没有对外可见的动态'} />
      ) : (
        visible.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            author={user}
            viewerId={meId}
            onToggleLike={() => api.togglePostLike(p.id)}
            onOpen={() => navigate(`/post/${p.id}`)}
            onTopic={(name) => navigate(`/topic/${encodeURIComponent(name)}`)}
          />
        ))
      )}
    </div>
  )
}
