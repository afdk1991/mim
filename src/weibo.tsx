import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './store'
import { useRouter } from './router'
import { cx, formatCount, recordView, timeAgo } from './utils'
import {
  ArticleCard,
  Avatar,
  Empty,
  FollowButton,
  Modal,
  PostCard,
  RichText,
  Tag,
  TimeAgo,
  UserLink,
  useToast,
} from './components'
import type { AppNotification, User } from './types'

/* ================= ProfileHead（个人主页头部） ================= */

function ProfileHead({
  u,
  extraStats,
  actions,
}: {
  u: User
  extraStats?: Array<{ label: string; value: number }>
  actions?: React.ReactNode
}) {
  return (
    <div className="profile-head">
      <div className="profile-row">
        <Avatar emoji={u.emoji} color={u.color} size={64} />
        <div>
          <div className="profile-name">
            {u.name}
            {u.verified && <span className="v-badge">V</span>}
          </div>
          <small style={{ opacity: 0.85 }}>@{u.id}</small>
        </div>
        <div className="profile-actions">{actions}</div>
      </div>
      <div className="profile-bio">{u.bio}</div>
      <div className="profile-stats">
        <span>
          <b>{formatCount(u.followers)}</b> 粉丝
        </span>
        <span>
          <b>{formatCount(u.following)}</b> 关注
        </span>
        {(extraStats ?? []).map((s) => (
          <span key={s.label}>
            <b>{formatCount(s.value)}</b> {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ================= 1. FeedPage 首页 ================= */

const POST_EMOJIS = ['😀', '😂', '🤔', '😭', '👍', '🔥', '🎉', '❤️', '🚀', '💡', '✅', '⚠️']
const IMAGE_EMOJIS = ['⚛️', '🚀', '🎨', '🐱', '🌸', '🍜', '🏔️', '💻', '📱']

export function FeedPage() {
  const api = useApp()
  const toast = useToast()
  const [content, setContent] = useState('')
  const [topic, setTopic] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [showEmoji, setShowEmoji] = useState(false)
  const [showImage, setShowImage] = useState(false)

  const publish = () => {
    if (!content.trim()) {
      toast('先写点什么吧')
      return
    }
    api.publishPost(content, { topic: topic || null, images })
    setContent('')
    setImages([])
    setTopic('')
    setShowEmoji(false)
    setShowImage(false)
    toast('发布成功 🎉')
  }

  const saveDraft = () => {
    if (!content.trim()) {
      toast('草稿内容为空')
      return
    }
    api.savePostDraft(content, topic || null, images)
    setContent('')
    setImages([])
    setTopic('')
    toast('已存入草稿箱')
  }

  const recos = Object.values(api.state.users).filter(
    (u) => u.id !== api.me.id && !api.isFollowing(u.id),
  )

  return (
    <div className="page-grid">
      <div>
        <div className="card compose">
          <div className="compose-top">
            <Avatar emoji={api.me.emoji} color={api.me.color} size={40} />
            <textarea
              className="input"
              placeholder="分享新鲜事…（支持 #话题# 和 @用户）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          {(showEmoji || showImage) && (
            <div className="emoji-picker">
              {showEmoji &&
                POST_EMOJIS.map((e) => (
                  <button key={e} onClick={() => setContent((c) => c + e)}>
                    {e}
                  </button>
                ))}
              {showImage &&
                IMAGE_EMOJIS.map((e) => (
                  <button key={e} onClick={() => setImages((s) => (s.includes(e) ? s : [...s, e]))}>
                    {e}
                  </button>
                ))}
            </div>
          )}
          <div className="compose-tools">
            <button className="icon-btn" title="表情" onClick={() => { setShowEmoji((v) => !v); setShowImage(false) }}>
              😊
            </button>
            <button className="icon-btn" title="配图" onClick={() => { setShowImage((v) => !v); setShowEmoji(false) }}>
              🖼
            </button>
            {images.length > 0 && <small style={{ color: 'var(--text-3)' }}>已选 {images.length} 张配图</small>}
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">不参与话题</option>
              {api.state.topics.map((t) => (
                <option key={t.id} value={t.name}>#{t.name}#</option>
              ))}
            </select>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={saveDraft}>存草稿</button>
            <button className="btn btn-primary btn-sm" onClick={publish}>发布</button>
          </div>
        </div>

        {api.state.posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>

      <div className="side-col">
        <div className="side-card">
          <h3>🔥 热搜榜</h3>
          {api.state.hotSearches.slice(0, 10).map((h) => (
            <a key={h.id} className="hot-item" href={`#/search?q=${encodeURIComponent(h.text)}`}>
              <span className="hot-rank">{h.rank}</span>
              <span className="hot-text">{h.text}</span>
              {h.tag && <span className={`hot-tag t-${h.tag}`}>{h.tag}</span>}
              <span className="hot-heat">{formatCount(h.heat)}</span>
            </a>
          ))}
        </div>

        <div className="side-card">
          <h3>📊 话题推荐</h3>
          {api.state.topics.slice(0, 5).map((t) => (
            <a key={t.id} className="topic-reco" href={`#/topic/${encodeURIComponent(t.name)}`}>
              #{t.name}#
              <small style={{ color: 'var(--text-3)', marginLeft: 'auto' }}>{formatCount(t.heat)} 阅读</small>
            </a>
          ))}
        </div>

        {recos.length > 0 && (
          <div className="side-card">
            <h3>👀 推荐关注</h3>
            {recos.slice(0, 3).map((u) => (
              <div key={u.id} className="user-row" style={{ marginBottom: 10 }}>
                <UserLink userId={u.id} size={36} />
                <FollowButton userId={u.id} small />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= 2. PostDetailPage 微博详情 ================= */

export function PostDetailPage({ id }: { id: string }) {
  const api = useApp()
  const toast = useToast()
  const post = api.state.posts.find((p) => p.id === id)
  const [input, setInput] = useState('')

  useEffect(() => {
    if (post) recordView('post', post.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!post) return <Empty emoji="🔍" text="微博不存在或已被删除" />

  const submit = () => {
    if (!input.trim()) return
    api.addPostComment(post.id, input)
    setInput('')
    toast('评论成功')
  }

  const comments = post.comments ?? []

  return (
    <div className="page-grid single">
      <div>
        <PostCard post={post} />

        <div className="card">
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>💬 全部评论（{comments.length}）</h3>
          {comments.length === 0 && <Empty emoji="💬" text="还没有评论，来抢沙发" />}
          {comments.map((c) => {
            const u = api.user(c.authorId)
            return (
              <div key={c.id} className="notif-row" style={{ cursor: 'default' }}>
                <UserLink userId={c.authorId} size={36} />
                <div className="notif-body">
                  <p>
                    <RichText text={c.content} />
                  </p>
                  <small>
                    <TimeAgo ts={c.createdAt} />
                  </small>
                </div>
                <button
                  className={cx('like-btn', c.likedByMe && 'active')}
                  onClick={() => api.toggleCommentLike(post.id, c.id)}
                >
                  {c.likedByMe ? '❤️' : '🤍'} {c.likes}
                </button>
              </div>
            )
          })}
          <div className="msg-input-bar" style={{ padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: comments.length ? 8 : 0 }}>
            <Avatar emoji={api.me.emoji} color={api.me.color} size={32} />
            <input
              className="input"
              placeholder={`回复 @${u_name(post.authorId, api)}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button className="btn btn-primary btn-sm" onClick={submit}>评论</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function u_name(authorId: string, api: ReturnType<typeof useApp>) {
  return api.user(authorId).name
}

/* ================= 3. TopicPage 话题页 ================= */

export function TopicPage({ name }: { name: string }) {
  const api = useApp()
  const [sort, setSort] = useState<'new' | 'hot'>('new')
  const topic = api.state.topics.find((t) => t.name === name)
  const posts = api.state.posts.filter((p) => p.topic === name)
  const sorted = useMemo(
    () => [...posts].sort((a, b) => (sort === 'new' ? b.createdAt - a.createdAt : b.likes - a.likes)),
    [posts, sort],
  )
  const authors = [...new Set(posts.map((p) => p.authorId))]
  const related = api.state.topics.filter((t) => t.name !== name).slice(0, 8)

  return (
    <div className="page-grid single">
      <div>
        <div className="topic-head">
          <h2>#{name}#</h2>
          <p>
            {topic?.desc ?? '大家都在聊这个话题'} · {formatCount(topic?.heat ?? 0)} 阅读 · {posts.length} 条讨论
          </p>
        </div>

        {authors.length > 0 && (
          <div className="card">
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>👥 {authors.length} 人参与讨论</h3>
            <div className="avatar-wall">
              {authors.map((id) => {
                const u = api.user(id)
                return (
                  <a
                    key={id}
                    href={id === api.me.id ? '#/my' : `#/user/${id}`}
                    title={`${u.name} · ${formatCount(u.followers)} 粉丝`}
                  >
                    <Avatar emoji={u.emoji} color={u.color} size={40} />
                  </a>
                )
              })}
            </div>
          </div>
        )}

        <div className="tabs">
          <button className={cx('tab-btn', sort === 'new' && 'active')} onClick={() => setSort('new')}>
            🕐 最新
          </button>
          <button className={cx('tab-btn', sort === 'hot' && 'active')} onClick={() => setSort('hot')}>
            🔥 最热
          </button>
        </div>

        {sorted.length === 0 && <Empty emoji="💭" text="这个话题下还没有讨论" />}
        {sorted.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}

        {related.length > 0 && (
          <div className="card">
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>🔀 相关话题</h3>
            <div className="chip-row">
              {related.map((t) => (
                <a key={t.id} className="chip" href={`#/topic/${encodeURIComponent(t.name)}`}>
                  #{t.name}# · {formatCount(t.heat)} 阅读
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= 3.5 TopicRankPage 超话排行榜 ================= */

export function TopicRankPage() {
  const api = useApp()
  const topics = [...api.state.topics].sort((a, b) => b.heat - a.heat)

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🔥 超话排行榜</h2>
        <div className="card">
          {topics.map((t, i) => {
            const posts = api.state.posts.filter((p) => p.topic === t.name).length
            return (
              <a
                key={t.id}
                className={cx('topic-rank-item', i < 3 && 'top')}
                href={`#/topic/${encodeURIComponent(t.name)}`}
              >
                <span className="topic-rank-no">{i + 1}</span>
                <div className="topic-rank-main">
                  <div className="topic-rank-name">#{t.name}#</div>
                  <p className="topic-rank-desc">{t.desc}</p>
                </div>
                <div className="topic-rank-meta">
                  <b>{formatCount(t.heat)}</b>
                  阅读 · {posts} 条讨论
                </div>
              </a>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ================= 4. NotificationsPage 通知 ================= */

const NOTIF_TABS: Array<{ key: string; label: string; icon: string }> = [
  { key: 'all', label: '全部', icon: '🔔' },
  { key: 'like', label: '赞', icon: '❤️' },
  { key: 'comment', label: '评论', icon: '💬' },
  { key: 'repost', label: '转发', icon: '🔁' },
  { key: 'follow', label: '关注', icon: '👤' },
  { key: 'mention', label: '@我', icon: '📢' },
]

export function NotificationsPage() {
  const api = useApp()
  const { navigate } = useRouter()
  const [tab, setTab] = useState('all')
  const list = api.state.notifications.filter((n) => tab === 'all' || n.type === tab)

  const open = (n: AppNotification) => {
    api.readNotification(n.id)
    if (n.postId) navigate(`/post/${n.postId}`)
  }

  return (
    <div className="page-grid single">
      <div>
        <div className="tabs">
          {NOTIF_TABS.map((t) => (
            <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
              {t.icon} {t.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => api.readAllNotifications()}>
            全部已读
          </button>
        </div>
        <div className="card">
          {list.length === 0 && <Empty emoji="🔔" text="暂时没有新通知" />}
          {list.map((n) => {
            const u = api.user(n.fromUserId)
            return (
              <div key={n.id} className={cx('notif-row', !n.read && 'unread')} onClick={() => open(n)}>
                <span className="notif-icon">{NOTIF_TABS.find((t) => t.key === n.type)?.icon ?? '🔔'}</span>
                <div className="notif-body">
                  <p>
                    <b style={{ color: 'var(--primary)' }}>{u.name}</b> {n.content}
                  </p>
                  <small>
                    <TimeAgo ts={n.createdAt} />
                  </small>
                </div>
                {!n.read && <span className="notif-dot" />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ================= 5. MessagesPage 私信 ================= */

export function MessagesPage() {
  const api = useApp()
  const { query, navigate } = useRouter()
  const [input, setInput] = useState('')
  const [kw, setKw] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const conversations = useMemo(() => {
    const map = new Map<string, typeof api.state.messages>()
    for (const m of api.state.messages) {
      const arr = map.get(m.userId) ?? []
      arr.push(m)
      map.set(m.userId, arr)
    }
    return [...map.entries()]
      .map(([userId, msgs]) => ({
        userId,
        msgs: [...msgs].sort((a, b) => a.createdAt - b.createdAt),
        last: msgs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)),
        unread: msgs.filter((m) => !m.fromMe && !m.read).length,
      }))
      .sort((a, b) => b.last.createdAt - a.last.createdAt)
  }, [api.state.messages])

  const kws = kw.trim().toLowerCase()
  const shown = kws
    ? conversations.filter((c) => {
        const u = api.user(c.userId)
        return (
          u.name.toLowerCase().includes(kws) ||
          c.userId.toLowerCase().includes(kws) ||
          c.msgs.some((m) => m.content.toLowerCase().includes(kws))
        )
      })
    : conversations

  const activeId = query.get('with') ?? conversations[0]?.userId
  const active = conversations.find((c) => c.userId === activeId)
  const activeUser = active ? api.user(active.userId) : null

  useEffect(() => {
    if (activeId) api.readConversation(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.msgs.length, api.state.messages.length])

  const send = () => {
    if (!input.trim() || !activeId) return
    api.sendMessage(activeId, input)
    setInput('')
  }

  return (
    <div className="page-grid single">
      <div className="msg-layout">
        <div className="msg-list">
          <input
            className="input"
            style={{ marginBottom: 8 }}
            placeholder="🔍 搜索会话或消息内容…"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
          />
          {shown.length === 0 && <Empty emoji="🔍" text="没有匹配的会话" />}
          {shown.map((c) => {
            const u = api.user(c.userId)
            return (
              <div
                key={c.userId}
                className={cx('msg-item', c.userId === activeId && 'active')}
                onClick={() => navigate(`/messages?with=${c.userId}`)}
              >
                <Avatar emoji={u.emoji} color={u.color} size={40} />
                <div className="msg-item-main">
                  <b>{u.name}</b>
                  <p>{c.last.content}</p>
                </div>
                {c.unread > 0 && <span className="msg-unread" />}
              </div>
            )
          })}
        </div>

        <div className="msg-thread">
          {activeUser && active ? (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
                {activeUser.name}
                <small style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 8 }}>私信会话</small>
              </div>
              <div className="msg-bubbles">
                {active.msgs.map((m) => (
                  <div key={m.id} className={cx('bubble-row', m.fromMe && 'me')}>
                    <Avatar emoji={m.fromMe ? api.me.emoji : activeUser.emoji} color={m.fromMe ? api.me.color : activeUser.color} size={30} />
                    <div className="bubble">{m.content}</div>
                    <span className="bubble-time">{timeAgo(m.createdAt)}</span>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="msg-input-bar">
                <input
                  className="input"
                  placeholder={`给 ${activeUser.name} 发送消息…`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                />
                <button className="btn btn-primary btn-sm" onClick={send}>发送</button>
              </div>
            </>
          ) : (
            <Empty emoji="✉️" text="选择左侧会话开始聊天" />
          )}
        </div>
      </div>
    </div>
  )
}

/* ================= 6. FavoritesPage 收藏 ================= */

export function FavoritesPage() {
  const api = useApp()
  const [tab, setTab] = useState<'post' | 'article'>('post')
  const favs = api.state.favorites.filter((f) => f.type === tab)
  const posts = favs
    .map((f) => api.state.posts.find((p) => p.id === f.targetId))
    .filter((p): p is NonNullable<typeof p> => !!p)
  const articles = favs
    .map((f) => api.state.articles.find((a) => a.id === f.targetId))
    .filter((a): a is NonNullable<typeof a> => !!a)

  return (
    <div className="page-grid single">
      <div>
        <div className="tabs">
          <button className={cx('tab-btn', tab === 'post' && 'active')} onClick={() => setTab('post')}>
            ⭐ 收藏的微博（{api.state.favorites.filter((f) => f.type === 'post').length}）
          </button>
          <button className={cx('tab-btn', tab === 'article' && 'active')} onClick={() => setTab('article')}>
            📄 收藏的文章（{api.state.favorites.filter((f) => f.type === 'article').length}）
          </button>
        </div>
        {tab === 'post' && (posts.length === 0 ? <Empty emoji="⭐" text="还没有收藏微博" /> : posts.map((p) => <PostCard key={p.id} post={p} />))}
        {tab === 'article' &&
          (articles.length === 0 ? <Empty emoji="📄" text="还没有收藏文章" /> : articles.map((a) => <ArticleCard key={a.id} article={a} />))}
      </div>
    </div>
  )
}

/* ================= 7. MyProfilePage 我的主页 ================= */

const AVATAR_EMOJIS = ['😀', '😎', '🤓', '🐱', '🦊', '🐼', '🚀', '🌸', '💻', '🔥', '🎯', '⭐']
const AVATAR_COLORS = ['#ff8200', '#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#f39c12', '#2c3e50', '#c0392b']

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const api = useApp()
  const toast = useToast()
  const [name, setName] = useState(api.me.name)
  const [emoji, setEmoji] = useState(api.me.emoji)
  const [color, setColor] = useState(api.me.color)
  const [bio, setBio] = useState(api.me.bio)

  const save = () => {
    if (!name.trim()) {
      toast('昵称不能为空')
      return
    }
    api.updateProfile({ name: name.trim(), emoji, color, bio: bio.trim() })
    toast('资料已更新 ✅')
    onClose()
  }

  return (
    <Modal title="编辑个人资料" onClose={onClose}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>昵称</div>
          <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>头像 emoji</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
          <div style={{ marginBottom: 6, fontWeight: 600 }}>头像背景色</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`选择颜色 ${c}`}
                onClick={() => setColor(c)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: c,
                  border: color === c ? '2px solid var(--text-1)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>个性签名</div>
          <textarea
            className="input"
            style={{ minHeight: 72 }}
            maxLength={80}
            placeholder="介绍一下自己…"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
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
  const toast = useToast()
  const [tab, setTab] = useState<'posts' | 'drafts'>('posts')
  const [editOpen, setEditOpen] = useState(false)
  const myPosts = api.state.posts.filter((p) => p.authorId === api.me.id)
  const drafts = api.state.postDrafts

  return (
    <div className="page-grid single">
      <div>
        <ProfileHead
          u={api.me}
          extraStats={[
            { label: '微博', value: myPosts.length },
            { label: '草稿', value: drafts.length },
          ]}
          actions={
            <>
              <a className="btn btn-ghost btn-sm" href="#/following" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }}>
                👥 关注列表
              </a>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }}
                onClick={() => setEditOpen(true)}
              >
                ✏️ 编辑资料
              </button>
              <a className="btn btn-ghost btn-sm" href="#/write" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }}>
                ✍️ 写文章
              </a>
            </>
          }
        />
        <div className="tabs">
          <button className={cx('tab-btn', tab === 'posts' && 'active')} onClick={() => setTab('posts')}>
            我的微博（{myPosts.length}）
          </button>
          <button className={cx('tab-btn', tab === 'drafts' && 'active')} onClick={() => setTab('drafts')}>
            草稿箱（{drafts.length}）
          </button>
        </div>

        {tab === 'posts' &&
          (myPosts.length === 0 ? <Empty emoji="✍️" text="你还没有发布过微博" /> : myPosts.map((p) => <PostCard key={p.id} post={p} />))}

        {tab === 'drafts' && (
          <>
            {drafts.length === 0 && <Empty emoji="📝" text="草稿箱是空的" />}
            {drafts.map((d) => (
              <div key={d.id} className="card">
                <p style={{ margin: '0 0 8px' }}>{d.content}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {d.topic && <Tag>#{d.topic}#</Tag>}
                  <small style={{ color: 'var(--text-3)' }}>
                    存于 <TimeAgo ts={d.savedAt} />
                  </small>
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      api.publishPostDraft(d.id)
                      toast('草稿已发布')
                    }}
                  >
                    立即发布
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      api.deletePostDraft(d.id)
                      toast('草稿已删除')
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      {editOpen && <EditProfileModal onClose={() => setEditOpen(false)} />}
    </div>
  )
}

/* ================= 8. FollowingPage 关注列表 ================= */

export function FollowingPage() {
  const api = useApp()
  const users = api.state.followingIds.map((id) => api.user(id))

  return (
    <div className="page-grid single">
      <div>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a className="btn btn-ghost btn-sm" href="#/my">← 返回</a>
          <b>关注列表（{users.length}）</b>
        </div>
        {users.length === 0 && <Empty emoji="👥" text="还没有关注任何人，去别人的主页逛逛吧" />}
        {users.map((u) => (
          <div key={u.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UserLink userId={u.id} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {u.name}
                {u.verified && <span className="v-badge">V</span>}
              </div>
              <small style={{ color: 'var(--text-3)' }}>{u.bio}</small>
            </div>
            <FollowButton userId={u.id} small />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================= 9. ProfilePage 他人主页 ================= */

export function ProfilePage({ id }: { id: string }) {
  const api = useApp()
  const { navigate } = useRouter()

  useEffect(() => {
    if (id === api.me.id) navigate('/my')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (id === api.me.id) return null
  const u = api.user(id)
  const posts = api.state.posts.filter((p) => p.authorId === id)
  const articles = api.state.articles.filter((a) => a.authorId === id)

  return (
    <div className="page-grid single">
      <div>
        <ProfileHead
          u={u}
          extraStats={[{ label: '微博', value: posts.length }, { label: '文章', value: articles.length }]}
          actions={
            <>
              <FollowButton userId={id} />
              <button className="btn btn-ghost" onClick={() => navigate(`/messages?with=${id}`)}>
                ✉️ 私信
              </button>
            </>
          }
        />
        {posts.length === 0 && <Empty emoji="🕊" text="TA 还没有发布过微博" />}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </div>
  )
}
