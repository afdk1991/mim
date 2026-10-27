/* ==========================================================================
 * 我的主页 —— 资料卡 / 关注粉丝数 / 我的动态 / 我的文章 / 草稿箱
 *
 * 数据：useApp().state（本机真源）。「我」的 User 记录可能尚未同步到本机 users 表
 *      （首次进入就是空的），因此用 meId 兜底出一个只读占位资料，不假装已存在。
 *
 * 坑：state.following 是「我关注的人」的真源；user.followers / user.following 只是
 *     用户记录里的冗余计数，两者可能不一致 —— 展示时以数组长度为准。
 * ======================================================================== */

import { useState } from 'react'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import type { User } from '@/domain/content/model'
import { Avatar, Empty, Modal, PostCard, Tag, TimeAgo, useToast } from '@/ui'
import { cx, formatCount } from '@/core/utils'

type TabKey = 'posts' | 'articles' | 'drafts'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'posts', label: '动态' },
  { key: 'articles', label: '文章' },
  { key: 'drafts', label: '草稿' },
]

const AVATAR_EMOJIS = ['😀', '😎', '🤓', '🐱', '🦊', '🐼', '🚀', '🌸', '💻', '🔥', '🎯', '⭐']
const AVATAR_COLORS = ['#ff8200', '#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#f39c12', '#2c3e50', '#c0392b']

/** 本人尚未落在 users 表时的占位资料（昵称如实显示，不伪造粉丝数） */
function anonMe(meId: string): User {
  return {
    id: meId,
    name: '我',
    emoji: '🙂',
    color: 'var(--primary-weak)',
    bio: '还没有填写个性签名',
    followers: 0,
    following: 0,
    verified: false,
  }
}

function EditProfileModal({ me, onClose }: { me: User; onClose: () => void }) {
  const api = useApp()
  const toast = useToast()
  const [name, setName] = useState(me.name)
  const [emoji, setEmoji] = useState(me.emoji)
  const [color, setColor] = useState(me.color)
  const [bio, setBio] = useState(me.bio)

  const save = (): void => {
    if (!name.trim()) {
      toast('昵称不能为空')
      return
    }
    api.updateProfile({ name: name.trim(), emoji, color, bio: bio.trim() })
    toast('资料已更新')
    onClose()
  }

  return (
    <Modal title="编辑个人资料" onClose={onClose}>
      <div className="col">
        <div>
          <div className="section-title" style={{ margin: '0 0 6px' }}>
            昵称
          </div>
          <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <div className="section-title" style={{ margin: '0 0 6px' }}>
            头像 emoji
          </div>
          <div className="row wrap">
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e}
                className={cx('btn btn-ghost btn-sm', emoji === e && 'active')}
                style={emoji === e ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title" style={{ margin: '0 0 6px' }}>
            头像底色
          </div>
          <div className="row wrap">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`选择颜色 ${c}`}
                onClick={() => setColor(c)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: c,
                  border: color === c ? '2px solid var(--text)' : '2px solid transparent',
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="section-title" style={{ margin: '0 0 6px' }}>
            个性签名
          </div>
          <textarea className="input" maxLength={80} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={save}>
          保存资料
        </button>
      </div>
    </Modal>
  )
}

export function MyProfilePage() {
  const api = useApp()
  const { navigate } = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>('posts')
  const [editOpen, setEditOpen] = useState(false)

  const { meId, users, posts, articles, postDrafts, articleDrafts, following } = api.state
  const me = users.find((u) => u.id === meId) ?? anonMe(meId)

  const myPosts = posts.filter((p) => p.authorId === meId)
  const myArticles = articles.filter((a) => a.authorId === meId)
  const drafts = postDrafts.length + articleDrafts.length

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          <Avatar emoji={me.emoji} color={me.color} size={64} />
          <div className="grow">
            <div style={{ fontSize: 18, fontWeight: 700 }}>{me.name}</div>
            <small className="muted">@{me.id}</small>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditOpen(true)}>
            ✏️ 编辑资料
          </button>
        </div>
        <p className="dim" style={{ margin: '10px 0 0' }}>
          {me.bio || '暂无签名'}
        </p>
        <div className="row wrap" style={{ marginTop: 10, gap: 16, fontSize: 13 }}>
          <a href="#/following">
            <b>{formatCount(following.length)}</b> <span className="muted">关注</span>
          </a>
          <span>
            <b>{formatCount(me.followers)}</b> <span className="muted">粉丝</span>
          </span>
          <span>
            <b>{formatCount(myPosts.length)}</b> <span className="muted">动态</span>
          </span>
          <span>
            <b>{formatCount(myArticles.length)}</b> <span className="muted">文章</span>
          </span>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'drafts' && drafts > 0 ? `（${drafts}）` : ''}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        myPosts.length === 0 ? (
          <Empty emoji="✍️" text="你还没有发布过动态，去「发布」写一条吧" />
        ) : (
          myPosts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              author={me}
              viewerId={meId}
              onToggleLike={() => api.togglePostLike(p.id)}
              onDelete={() => api.deletePost(p.id)}
              onOpen={() => navigate(`/post/${p.id}`)}
              onTopic={(name) => navigate(`/topic/${encodeURIComponent(name)}`)}
            />
          ))
        )
      ) : null}

      {tab === 'articles' ? (
        myArticles.length === 0 ? (
          <Empty emoji="📄" text="你还没有发布过文章" />
        ) : (
          myArticles.map((a) => (
            <div key={a.id} className="card">
              <a href={`#/article/${a.id}`} style={{ fontWeight: 600, fontSize: 15 }}>
                {a.title}
              </a>
              <p className="dim" style={{ margin: '4px 0 0' }}>
                {a.summary}
              </p>
              <div className="row wrap" style={{ marginTop: 6 }}>
                {a.tags.slice(0, 3).map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
                <span className="grow" />
                <small className="muted">
                  <TimeAgo ts={a.createdAt} />
                </small>
              </div>
            </div>
          ))
        )
      ) : null}

      {tab === 'drafts' ? (
        postDrafts.length === 0 && articleDrafts.length === 0 ? (
          <Empty emoji="📝" text="草稿箱是空的" />
        ) : (
          <>
            {postDrafts.map((d) => (
              <div key={d.id} className="card">
                <p style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{d.content}</p>
                <div className="row wrap">
                  {d.topic ? <Tag>#{d.topic}#</Tag> : null}
                  <small className="muted">
                    存于 <TimeAgo ts={d.savedAt} />
                  </small>
                  <span className="grow" />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      api.publishPostDraft(d.id)
                      toast('草稿已发布')
                    }}
                  >
                    立即发布
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => api.deletePostDraft(d.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
            {articleDrafts.map((d) => (
              <div key={d.id} className="card">
                <b>{d.title || '（无标题）'}</b>
                <p className="dim" style={{ margin: '4px 0 8px' }}>
                  {d.content.slice(0, 80) || '（空正文）'}
                </p>
                <div className="row wrap">
                  <small className="muted">
                    存于 <TimeAgo ts={d.savedAt} />
                  </small>
                  <span className="grow" />
                  <a className="btn btn-primary btn-sm" href={`#/write/${d.id}`}>
                    继续编辑
                  </a>
                </div>
              </div>
            ))}
          </>
        )
      ) : null}

      {editOpen ? <EditProfileModal me={me} onClose={() => setEditOpen(false)} /> : null}
    </div>
  )
}
