/* ==========================================================================
 * 关注列表 —— 我关注的全部用户，可直接取关
 *
 * 数据：state.following（id 数组，真源）→ state.users 反查资料。
 *      反查不到的 id（用户未同步到本机）如实显示为「已关注但未加载资料」，
 *      仍然给取关入口，避免列表里出现无法操作的死条目。
 * ======================================================================== */

import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import type { User } from '@/domain/content/model'
import { Avatar, Empty, useToast } from '@/ui'
import { formatCount } from '@/core/utils'

function unfollowOf(id: string): User {
  return {
    id,
    name: `用户 ${id.slice(0, 6)}`,
    emoji: '🙂',
    color: 'var(--bg-soft)',
    bio: '资料尚未同步到本机',
    followers: 0,
    following: 0,
    verified: false,
  }
}

export function FollowingPage() {
  const api = useApp()
  const { navigate } = useRouter()
  const toast = useToast()
  const { following, users } = api.state

  const list = following.map((id) => ({ id, user: users.find((u) => u.id === id) ?? unfollowOf(id) }))

  return (
    <div className="page">
      <h1 className="page-title">👥 我的关注 <span className="tag">{formatCount(list.length)}</span></h1>

      {list.length === 0 ? (
        <Empty emoji="👥" text="还没有关注任何人，去别人的主页点「关注」试试" />
      ) : (
        list.map(({ id, user }) => (
          <div key={id} className="card">
            <div className="row">
              <Avatar emoji={user.emoji} color={user.color} size={44} />
              <div className="grow">
                <a href={`#/user/${id}`} style={{ fontWeight: 600 }}>
                  {user.name}
                  {user.verified ? ' ✅' : ''}
                </a>
                <div className="muted" style={{ fontSize: 12 }}>
                  {user.bio || '暂无签名'} · 粉丝 {formatCount(user.followers)}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/messages?with=${id}`)}>
                ✉️ 私信
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  api.toggleFollow(id)
                  toast(`已取消关注 ${user.name}`)
                }}
              >
                已关注 · 取消
              </button>
            </div>
          </div>
        ))
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        关注关系存在本机并随身份隔离，云端同步完成后可在其他设备看到同一份列表。
      </p>
    </div>
  )
}
