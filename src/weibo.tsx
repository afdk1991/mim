import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './store'
import { MyAppHub } from './myhub'
import { useRouter } from './router'
import { cx, formatCount, recordView, timeAgo } from './utils'
import {
  ArticleCard,
  Avatar,
  Empty,
  FollowButton,
  MediaCard,
  Modal,
  PostCard,
  RichText,
  Tag,
  TimeAgo,
  UserLink,
  useToast,
} from './components'
import { matchesTeenWords, toggleBlacklistUser, useUserDomain, VBadge } from './user-domain'
import { postVisibleTo } from './content-domain'
import { VoiceBubbleThread, VoiceRecordButton } from './media-domain' /* 轮 24 打通：B5 私信语音条 */
/* 轮 23 打通：B4 发现与分发 —— 负反馈/同城 hooks 与核心打分逻辑、AB 实验取桶 */
import { useCity, useNegFeedback } from './feed-domain'
/* 轮 25 打通：微博式首页增强——实时新动态提示条 / 流内头条文章卡 / 骨架屏 / 24h 热榜 */
import { ArticleFeedCard, FeedSkeleton, HotBanner, NewPostsBar } from './feed-extras'
import { buildRecFeed, CITY_PRESETS, clearNeg, negCount } from './lib/feed-core'
import { abVariant } from './lib/ab'
import {
  GroupCreateModal,
  RoamModal,
  SuggestCard,
  checkinOf,
  checkinTopic,
  dayKey,
  groupMsgsOf,
  hallOfFame,
  leaveGroup,
  loadGroupReads,
  loadGroups,
  loadPins,
  markGroupRead,
  sendGroupMessage,
  togglePin,
  topicHostOf,
  topicLevel,
  useSd,
} from './social-domain'
import type { ChatGroup } from './social-domain'
import type { AppNotification, PostComment, User } from './types'

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
            {/* 轮 20 打通：V 徽章统一走 VBadge（本人按用户域认证状态区分橙V/蓝V） */}
            <VBadge u={u} />
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

/* ================= 轮 21 打通：7. 24h 快拍栏（圆圈头像 + 弹窗查看，过期自动消失） ================= */

export function StoryBar() {
  const api = useApp()
  const [open, setOpen] = useState<string | null>(null)
  /* 渲染期按 expiresAt 过滤：过期快拍不出现在栏内 */
  const stories = api.state.posts.filter(
    (p) => p.story && postVisibleTo(p, api.me.id) && (!p.expiresAt || Date.now() < p.expiresAt),
  )
  if (stories.length === 0) return null
  return (
    <>
      <div className="card wt-story-bar" aria-label="快拍栏">
        {stories.map((s) => {
          const u = api.user(s.authorId)
          return (
            <button key={s.id} type="button" className="wt-story-item" onClick={() => setOpen(s.id)}>
              <span className="wt-story-ring">
                <Avatar emoji={u.emoji} color={u.color} size={44} />
              </span>
              <small>{u.name}</small>
            </button>
          )
        })}
      </div>
      {open &&
        (() => {
          const s = api.state.posts.find((p) => p.id === open)
          if (!s) return null
          const u = api.user(s.authorId)
          return (
            <Modal title={`${u.name} 的快拍 · 24h 可见`} onClose={() => setOpen(null)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Avatar emoji={u.emoji} color={u.color} size={28} />
                <b>{u.name}</b>
                <TimeAgo ts={s.createdAt} />
              </div>
              <p className="wt-story-text">{s.content}</p>
              {s.media && <MediaCard media={s.media} />}
            </Modal>
          )
        })()}
    </>
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

  /* 轮 20 打通：feed 流过滤——黑名单用户动态不展示；青少年模式开启时简单关键词过滤敏感占位内容
     轮 21 打通：叠加 B2 过滤——快拍只进快拍栏不进常规流；「仅自己」动态非本人不可见 */
  const { blacklist, teen } = useUserDomain()
  /* 轮 23 打通：B4 负反馈 —— 作者级命中整卡即时消失（作者+话题按登录身份分 key 记录） */
  const neg = useNegFeedback()
  /* 轮 23 打通：B4 同城 —— 我设置的定位（未设置时默认城市走 AB 实验 city_default） */
  const [city, setCity] = useCity()
  /* 轮 23 打通：B4 feed 顶部 Tab —— 关注 / 推荐 / 热门 / 同城
     轮 20/21/22 口径保持：黑名单 / 青少年敏感词 / 快拍不进流 / 仅自己可见过滤不变 */
  const [tab, setTab] = useState<'follow' | 'reco' | 'hot' | 'city'>('follow')
  /* 信息流分页：每页 10 条，切 Tab 重置（对齐微博「加载更多」），长列表避免一次性全量渲染 */
  const FEED_PAGE_SIZE = 10
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE)
  const switchTab = (t: 'follow' | 'reco' | 'hot' | 'city'): void => {
    setTab(t)
    setVisibleCount(FEED_PAGE_SIZE)
  }
  /* 回到顶部悬浮球：滚动超过一屏后出现 */
  const [showBackTop, setShowBackTop] = useState(false)
  useEffect(() => {
    const onScroll = (): void => setShowBackTop(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  /* 首屏骨架屏：450ms 加载态占位（避免流区域空白跳动，对齐现代信息流加载体验） */
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 450)
    return () => window.clearTimeout(t)
  }, [])
  /* 轮 25 打通：「有 N 条新微博」实时提示条 —— 对齐微博首页后台推送交互。
     信号源为 store.refreshFeed()：seed 删除后该入口为预留空实现（恒返回 0），
     提示条不出现；保留轮询管线，待云端有新内容推送通道后复用。 */
  const [unseen, setUnseen] = useState(0)
  const apiRef = useRef(api)
  apiRef.current = api
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      if (!alive) return
      const n = apiRef.current.refreshFeed()
      if (n > 0) setUnseen((v) => v + n)
    }
    const first = window.setTimeout(pull, 10_000)
    const timer = window.setInterval(pull, 22_000)
    return () => {
      alive = false
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [])
  const openUnseen = (): void => {
    setUnseen(0)
    setVisibleCount(FEED_PAGE_SIZE)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const basePosts = api.state.posts.filter(
    (p) =>
      !p.story &&
      postVisibleTo(p, api.me.id) &&
      !blacklist.includes(p.authorId) &&
      !(teen.enabled && matchesTeenWords(p.content)) &&
      !neg.authors.includes(p.authorId),
  )
  /* 关注流：自己 + 已关注作者；置顶动态（pinned）排最前，对齐微博个人主页/关注流置顶行为 */
  const followPosts = basePosts
    .filter((p) => p.authorId === api.me.id || api.isFollowing(p.authorId))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  /* 推荐流：非自己、未关注作者的公开动态，按兴趣权重本地排序（互动统计见 lib/feed-core） */
  const recoItems = buildRecFeed({
    candidates: basePosts.filter((p) => p.authorId !== api.me.id && !api.isFollowing(p.authorId)),
    meId: api.me.id,
    posts: api.state.posts,
    favorites: api.state.favorites,
    users: api.state.users,
    negTopics: neg.topics,
  })
  /* 同城流：按动态位置归属城市过滤（用户无城市字段，位置即地理信号） */
  const cityPosts = basePosts.filter((p) => (p.location ?? '').startsWith(city))
  /* 热门流：公开动态按互动热度排序（赞 + 转发×2 + 评论×3），对齐微博首页「热门」Tab。
     heat 保留在条目上，供顶部「24 小时热榜」复用同一份排序，避免两处口径漂移。 */
  const hotRanked = basePosts
    .filter((p) => p.authorId !== api.me.id)
    .map((p) => ({ p, heat: p.likes + p.reposts * 2 + (p.comments?.length ?? 0) * 3 }))
    .sort((a, b) => b.heat - a.heat)
  const cities = [
    ...new Set([
      ...CITY_PRESETS,
      ...api.state.posts.map((p) => p.location?.split(' · ')[0] ?? '').filter((c): c is string => !!c),
    ]),
  ]
  const reasonStyle = abVariant('reco_reason_style')
  /* 流内穿插的头条文章（按最新排序；关注流与热门流各穿插一篇，错开避免重复露出） */
  const feedArticles = useMemo(
    () => api.state.articles.slice().sort((a, b) => b.createdAt - a.createdAt),
    [api.state.articles],
  )
  /* 当前 Tab 的全量条数（供「加载更多」判断与已展示计数） */
  const activeCount =
    tab === 'follow'
      ? followPosts.length
      : tab === 'reco'
        ? recoItems.length
        : tab === 'hot'
          ? hotRanked.length
          : cityPosts.length

  return (
    <div className="page-grid">
      <div>
        {/* 轮 21 打通：feed 顶部快拍栏 */}
        <StoryBar />
        {/* 轮 23 打通：B4 feed 顶部分发 Tab —— 关注 / 推荐 / 热门 / 同城 + 视频沉浸流入口 */}
        <div className="tabs rf-feed-tabs">
          <button className={cx('tab-btn', tab === 'follow' && 'active')} onClick={() => switchTab('follow')}>
            👥 关注
          </button>
          <button className={cx('tab-btn', tab === 'reco' && 'active')} onClick={() => switchTab('reco')}>
            ✨ 推荐
          </button>
          <button className={cx('tab-btn', tab === 'hot' && 'active')} onClick={() => switchTab('hot')}>
            🔥 热门
          </button>
          <button className={cx('tab-btn', tab === 'city' && 'active')} onClick={() => switchTab('city')}>
            📍 同城
          </button>
          <span style={{ flex: 1 }} />
          {tab === 'city' && (
            <select
              className="rf-city-select"
              aria-label="切换城市"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <a className="rf-tab-link" href="#/videos">
            🎬 视频
          </a>
        </div>

        {/* 轮 25 打通：「有 N 条新微博」实时提示条（后台到达，点击才回顶展示） */}
        <NewPostsBar count={unseen} onOpen={openUnseen} />

        {/* 首屏骨架屏：加载态占位 */}
        {loading && <FeedSkeleton rows={3} />}

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
            <select aria-label="选择话题" value={topic} onChange={(e) => setTopic(e.target.value)}>
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

        {/* 轮 23 打通：B4 负反馈恢复条 —— 已屏蔽 N 条推荐，可一键恢复 */}
        {negCount(neg) > 0 && (
          <div className="rf-neg-bar">
            <span>🚫 已屏蔽 {negCount(neg)} 条推荐（不感兴趣的作者 / 话题）</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                clearNeg()
                toast('已恢复相关内容推荐')
              }}
            >
              恢复
            </button>
          </div>
        )}

        {api.state.posts.length > 0 && basePosts.length === 0 && (
          <Empty emoji="🛡" text="当前内容已按黑名单 / 青少年模式过滤" />
        )}

        {!loading && tab === 'follow' && (
          <>
            {followPosts.length === 0 && <Empty emoji="👥" text="关注的人还没有新动态，去推荐页逛逛吧" />}
            {followPosts.slice(0, visibleCount).map((p, i) => (
              <Fragment key={p.id}>
                {/* 头条文章卡穿插：第 5 条动态后插入一篇（对齐微博流内头条文章） */}
                {i === 4 && feedArticles[0] && <ArticleFeedCard article={feedArticles[0]} />}
                <PostCard post={p} />
              </Fragment>
            ))}
          </>
        )}

        {!loading && tab === 'reco' && (
          <>
            {recoItems.length === 0 && <Empty emoji="✨" text="暂无推荐内容，发布或互动越多推荐越准" />}
            {/* 轮 23 打通：B4 推荐理由小标 —— AB 实验 reco_reason_style 控制样式 A/B */}
            {recoItems.slice(0, visibleCount).map(({ post, reason }) => (
              <div key={post.id} className="rf-reco-item">
                {reasonStyle === 'b' ? (
                  <span className="rf-reason rf-reason-b">✨ {reason}</span>
                ) : (
                  <span className="rf-reason">{reason}</span>
                )}
                <PostCard post={post} />
              </div>
            ))}
          </>
        )}

        {!loading && tab === 'hot' && (
          <>
            {/* 轮 25 打通：热门 Tab 顶部「24 小时热榜」top3 */}
            <HotBanner items={hotRanked.slice(0, 3)} />
            {hotRanked.length === 0 && <Empty emoji="🔥" text="暂无热门动态，多互动让内容热起来" />}
            {hotRanked.slice(0, visibleCount).map(({ p }, i) => (
              <Fragment key={p.id}>
                {i === 4 && feedArticles[1] && <ArticleFeedCard article={feedArticles[1]} />}
                <PostCard post={p} />
              </Fragment>
            ))}
          </>
        )}

        {!loading && tab === 'city' && (
          <>
            {cityPosts.length === 0 && (
              <Empty emoji="📍" text={`暂无「${city}」的同城动态，发布时选择位置即可现身同城`} />
            )}
            {cityPosts.slice(0, visibleCount).map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </>
        )}

        {/* 加载更多：当前 Tab 仍有未展示内容时出现（对齐微博信息流分页） */}
        {!loading && activeCount > visibleCount && (
          <div className="feed-loadmore">
            <button className="btn btn-ghost" onClick={() => setVisibleCount((v) => v + FEED_PAGE_SIZE)}>
              加载更多
            </button>
            <small>
              已展示 {Math.min(visibleCount, activeCount)} / {activeCount} 条
            </small>
          </div>
        )}

        {/* 单态（2026-10-23）：知识博文并入主信息流，打破"绝不进广场 Feed"隔离 */}
        <section style={{ marginTop: 18 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, margin: '0 0 10px', color: 'inherit' }}>
            📚 知识博文
            <a href="#/articles" style={{ marginLeft: 'auto', fontSize: 13, color: '#3b82f6', textDecoration: 'none' }}>全部 »</a>
          </h3>
          {api.state.articles.length === 0 ? (
            <Empty emoji="📚" text="还没有博文，去发布一篇知识内容吧" />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {api.state.articles
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 6)
                .map((a) => (
                  <a
                    key={a.id}
                    href={`#/article/${a.id}`}
                    className="card"
                    style={{
                      display: 'block',
                      padding: '10px 12px',
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <b style={{ display: 'block', fontSize: 14 }}>{a.title}</b>
                    <small style={{ color: 'var(--text-3, #888)', fontSize: 12 }}>
                      {a.summary || a.content.replace(/\n/g, ' ').slice(0, 40)}
                      {' · '}
                      {a.views} 阅读
                    </small>
                  </a>
                ))}
            </div>
          )}
        </section>
      </div>

      <div className="side-col">
        <div className="side-card">
          {/* 轮 23 打通：B4 榜单体系入口 —— 话题榜/明星榜/影响力榜聚合页 */}
          <h3>
            🔥 热搜榜
            <a className="rk-more" href="#/ranks">
              榜单 »
            </a>
          </h3>
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

        {/* 公告/活动位（对齐微博右侧栏）：产品动态 + 运营活动入口 */}
        <div className="side-card">
          <h3>📢 公告</h3>
          <a className="rf-announce-item" href="#/videos">
            <span className="rf-ann-tag">产品</span>
            <span>全站统一播放器上线，视频跨页播放不中断</span>
          </a>
          <a className="rf-announce-item" href="#/growth">
            <span className="rf-ann-tag">活动</span>
            <span>成长引擎每日签到，连续 7 天积分翻倍</span>
          </a>
          <a className="rf-announce-item" href="#/vip">
            <span className="rf-ann-tag">会员</span>
            <span>VIP 会员限时权益：免广告 + 动态置顶</span>
          </a>
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

        {/* 轮 22 打通：可能感兴趣的人 —— 好友的好友推导（排除已关注/黑名单/自己），无候选时 seed 兜底 */}
        <SuggestCard />
      </div>

      {/* 回到顶部悬浮球：滚动超过一屏后出现 */}
      {showBackTop && (
        <button
          className="feed-backtop"
          title="回到顶部"
          aria-label="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ↑
        </button>
      )}
    </div>
  )
}

/* ================= 2. PostDetailPage 动态详情 ================= */

export function PostDetailPage({ id }: { id: string }) {
  const api = useApp()
  const toast = useToast()
  const post = api.state.posts.find((p) => p.id === id)
  const [input, setInput] = useState('')
  /* 轮 21 打通：楼中楼——当前正在回复的评论（null = 发顶级评论） */
  const [replyTo, setReplyTo] = useState<PostComment | null>(null)
  /* 轮 25 打通：作者本人编辑动态（正文 + 图片，上云走 editPost） */
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState({ content: '', images: '' })
  const openEdit = () => {
    if (!post) return
    setDraft({ content: post.content, images: (post.images ?? []).join('\n') })
    setEditOpen(true)
  }
  const saveEdit = () => {
    if (!post) return
    const images = draft.images.split('\n').map((s) => s.trim()).filter(Boolean)
    api.editPost(post.id, { content: draft.content, images })
    toast('动态已更新')
    setEditOpen(false)
  }

  useEffect(() => {
    if (post) recordView('post', post.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  /* 轮 21 打通：详情页守卫——仅自己可见的非本人访问 / 已过期快拍，一律视为不存在 */
  const hidden =
    post != null &&
    (!postVisibleTo(post, api.me.id) ||
      (post.story && post.expiresAt != null && Date.now() > post.expiresAt))
  if (!post || hidden) return <Empty emoji="🔍" text="动态不存在或已被删除" />

  const submit = () => {
    if (!input.trim()) return
    api.addPostComment(post.id, input, replyTo?.id)
    toast(replyTo ? '回复成功' : '评论成功')
    setInput('')
    setReplyTo(null)
  }

  const comments = post.comments ?? []
  /* 轮 21 打通：楼中楼——顶级评论在前，回复挂在其父评论下（二级缩进，不做无限层级） */
  const tops = comments.filter((c) => !c.replyTo)
  const repliesOf = (cid: string) => comments.filter((c) => c.replyTo === cid)

  return (
    <div className="page-grid single">
      <div>
        <PostCard post={post} />

        {post.authorId === api.me.id && (
          <div
            className="card"
            style={{ marginBottom: 10, padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <strong style={{ fontSize: 14 }}>我的动态</strong>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={openEdit}>
              ✏️ 编辑
            </button>
          </div>
        )}

        <div className="card">
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>💬 全部评论（{comments.length}）</h3>
          {comments.length === 0 && <Empty emoji="💬" text="还没有评论，来抢沙发" />}
          {tops.map((c) => {
            return (
              <div key={c.id}>
                <div className="notif-row" style={{ cursor: 'default' }}>
                  <UserLink userId={c.authorId} size={36} />
                  <div className="notif-body">
                    <p>
                      <RichText text={c.content} />
                    </p>
                    <small>
                      <TimeAgo ts={c.createdAt} />
                    </small>
                  </div>
                  {/* 轮 21 打通：楼中楼——对某条评论「回复」 */}
                  <button type="button" className="wt-reply-chip" onClick={() => setReplyTo(c)}>
                    ↳ 回复
                  </button>
                  <button
                    className={cx('like-btn', c.likedByMe && 'active')}
                    onClick={() => api.toggleCommentLike(post.id, c.id)}
                  >
                    {c.likedByMe ? '❤️' : '🤍'} {c.likes}
                  </button>
                </div>
                {repliesOf(c.id).map((r) => (
                  <div key={r.id} className="notif-row wt-reply" style={{ cursor: 'default' }}>
                    <UserLink userId={r.authorId} size={28} />
                    <div className="notif-body">
                      <p>
                        <span className="wt-reply-prefix">
                          ↳ 回复 @{api.user(c.authorId).name}：
                        </span>
                        <RichText text={r.content} />
                      </p>
                      <small>
                        <TimeAgo ts={r.createdAt} />
                      </small>
                    </div>
                    <button
                      className={cx('like-btn', r.likedByMe && 'active')}
                      onClick={() => api.toggleCommentLike(post.id, r.id)}
                    >
                      {r.likedByMe ? '❤️' : '🤍'} {r.likes}
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
          <div className="msg-input-bar" style={{ padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: comments.length ? 8 : 0 }}>
            <Avatar emoji={api.me.emoji} color={api.me.color} size={32} />
            <input
              className="input"
              placeholder={replyTo ? `回复 @${api.user(replyTo.authorId).name}…` : `回复 @${u_name(post.authorId, api)}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            {replyTo && (
              <button className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)}>
                取消回复
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={submit}>评论</button>
          </div>
        </div>

        {editOpen && (
          <Modal title="编辑动态" onClose={() => setEditOpen(false)}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted, #8a8f99)', margin: '0 0 4px' }}>
              正文
            </label>
            <textarea
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--line, #d8dbe2)',
                fontSize: 14,
                boxSizing: 'border-box',
                background: 'transparent',
                color: 'inherit',
                resize: 'vertical',
              }}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={5}
            />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted, #8a8f99)', margin: '10px 0 4px' }}>
              图片（每行一个链接，可留空）
            </label>
            <textarea
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--line, #d8dbe2)',
                fontSize: 14,
                boxSizing: 'border-box',
                background: 'transparent',
                color: 'inherit',
                resize: 'vertical',
              }}
              value={draft.images}
              onChange={(e) => setDraft({ ...draft, images: e.target.value })}
              rows={3}
              placeholder="https://..."
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>
                保存
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditOpen(false)}>
                取消
              </button>
            </div>
          </Modal>
        )}
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
  /* 轮 22 修复：订阅社交域事件——签到走 sdSet 广播 SD_EVT，此处不订阅则签到后按钮/等级不刷新 */
  useSd()
  const toast = useToast()
  const [sort, setSort] = useState<'new' | 'hot' | 'hall'>('new')
  const topic = api.state.topics.find((t) => t.name === name)
  /* 轮 21 打通：话题流同样排除快拍与「仅自己」动态 */
  const posts = api.state.posts.filter((p) => p.topic === name && !p.story && postVisibleTo(p, api.me.id))
  /* 轮 22 打通：超话签到状态与等级（连续天数 + 累计签到 → Lv1 铁粉…Lv5 老粉） */
  const ck = checkinOf(name)
  const level = ck ? topicLevel(ck.streak, ck.total) : null
  const checkedToday = ck?.lastDate === dayKey()
  /* 轮 22 打通：主持人判定（keyed 指定优先，demo 以超话最早发帖作者兜底）+ 主持人可置顶帖子 */
  const hostId = topicHostOf(name, posts)
  const isHost = hostId === api.me.id
  const pins = loadPins()[name] ?? []
  const base = [...posts].sort((a, b) => (sort === 'new' ? b.createdAt - a.createdAt : b.likes - a.likes))
  const sorted = [...base.filter((p) => pins.includes(p.id)), ...base.filter((p) => !pins.includes(p.id))]
  const authors = [...new Set(posts.map((p) => p.authorId))]
  /* 轮 22 打通：名人堂 —— 连续签到 Top5（仅本机真实签到，不伪造成员数据） */
  const hall = hallOfFame(name, api.me.id, authors)
  const related = api.state.topics.filter((t) => t.name !== name).slice(0, 8)

  return (
    <div className="page-grid single">
      <div>
        <div className="topic-head">
          <h2>#{name}#</h2>
          <p>
            {topic?.desc ?? '大家都在聊这个话题'} · {formatCount(topic?.heat ?? 0)} 阅读 · {posts.length} 条讨论
          </p>
          {/* 轮 22 打通：签到按钮 + 超话等级 + 连续/累计天数 + 主持人标识 */}
          <div className="sg-topic-meta">
            <button
              className={cx('btn btn-sm', checkedToday ? 'btn-ghost' : 'btn-primary')}
              disabled={checkedToday}
              onClick={() => {
                if (checkedToday) return
                const st = checkinTopic(name)
                const lv = topicLevel(st.streak, st.total)
                toast(`签到成功 · Lv${lv.lv} ${lv.name}${lv.nextGap != null ? `（再签 ${lv.nextGap} 天升级）` : ''}`)
              }}
            >
              {checkedToday ? '✅ 今日已签到' : '📅 签到'}
            </button>
            {level && (
              <span className="sg-lv-chip">
                Lv{level.lv} {level.name}
              </span>
            )}
            {ck && (
              <small>
                连续 {ck.streak} 天 · 累计 {ck.total} 天
              </small>
            )}
            {hostId && (
              <span className="sg-host-chip">
                👑 主持人：{api.user(hostId).name}
                {isHost ? '（你）' : ''}
              </span>
            )}
          </div>
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
          <button className={cx('tab-btn', sort === 'hall' && 'active')} onClick={() => setSort('hall')}>
            🏅 名人堂
          </button>
        </div>

        {sort === 'hall' ? (
          /* 轮 22 打通：名人堂 Tab —— 按连续签到天数 Top5 榜单 */
          <div className="card">
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>🏅 名人堂 · 连续签到 Top5</h3>
            {hall.length === 0 ? (
              <Empty emoji="🏅" text="还没有成员签到，点上方「签到」抢占榜首" />
            ) : (
              hall.map((e, i) => {
                const lv = topicLevel(e.streak, e.total)
                return (
                  <div key={e.userId} className="sg-hall-row">
                    <span className={cx('sg-hall-rank', i < 3 && 'top')}>{i + 1}</span>
                    <UserLink userId={e.userId} size={36} />
                    <div className="sg-hall-meta">
                      <span className="sg-lv-chip">
                        Lv{lv.lv} {lv.name}
                      </span>
                      <small>
                        连续 {e.streak} 天 · 累计 {e.total} 天{e.simulated ? ' · 示例' : ''}
                      </small>
                    </div>
                    {hostId === e.userId && <span className="sg-host-chip sg-hall-right">主持人</span>}
                  </div>
                )
              })
            )}
          </div>
        ) : (
          <>
            {sorted.length === 0 && <Empty emoji="💭" text="这个话题下还没有讨论" />}
            {sorted.map((p) => (
              <div key={p.id}>
                {(pins.includes(p.id) || isHost) && (
                  /* 轮 22 打通：主持人置顶 —— 置顶帖排序最前，带 📌 标识 */
                  <div className="sg-pin-bar">
                    {pins.includes(p.id) && <span className="sg-pin-tag">📌 置顶</span>}
                    {isHost && (
                      <button
                        className="sg-pin-btn"
                        onClick={() => {
                          const on = togglePin(name, p.id)
                          toast(on ? '已置顶该帖' : '已取消置顶')
                        }}
                      >
                        {pins.includes(p.id) ? '取消置顶' : '置顶'}
                      </button>
                    )}
                  </div>
                )}
                <PostCard post={p} />
              </div>
            ))}
          </>
        )}

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
  const toast = useToast()
  const [input, setInput] = useState('')
  const [groupOpen, setGroupOpen] = useState(false)
  const [roamOpen, setRoamOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  /* 轮 20 打通：隐私开关 + 黑名单在私信读/写路径的真实约束 */
  const { privacy, blacklist } = useUserDomain()
  /* 轮 22 打通：群聊 / 已读回执 / 消息漫游 数据按登录身份分 key 存储（mim-sd-<uid>:*），变更即刷新 */
  useSd()

  const conversations = useMemo(() => {
    const map = new Map<string, typeof api.state.messages>()
    for (const m of api.state.messages) {
      const arr = map.get(m.userId) ?? []
      arr.push(m)
      map.set(m.userId, arr)
    }
    return [...map.entries()]
      .filter(([userId]) => !blacklist.includes(userId)) // 拉黑用户的会话不再展示（其私信被拦截）
      .map(([userId, msgs]) => ({
        userId,
        msgs: [...msgs].sort((a, b) => a.createdAt - b.createdAt),
        last: msgs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)),
        unread: msgs.filter((m) => !m.fromMe && !m.read).length,
      }))
      .sort((a, b) => b.last.createdAt - a.last.createdAt)
  }, [api.state.messages, blacklist])

  /* 轮 22 打通：会话列表合并群聊 —— 单聊/群聊统一按最近消息排序，群聊以 👥 头像 + 成员数角标区分 */
  const groups = loadGroups()
  const greads = loadGroupReads()
  const items: Array<{
    kind: 'dm' | 'group'
    id: string
    group: ChatGroup | null
    lastTs: number
    lastText: string
    unread: number
  }> = [
    ...groups.map((g) => {
      const msgs = groupMsgsOf(g.id)
      const last = msgs[msgs.length - 1]
      const upto = greads[g.id] ?? 0
      return {
        kind: 'group' as const,
        id: g.id,
        group: g,
        lastTs: last?.createdAt ?? g.createdAt,
        lastText: last ? `${api.user(last.authorId).name}：${last.content}` : '群聊已创建，打个招呼吧',
        unread: msgs.filter((m) => m.authorId !== api.me.id && m.createdAt > upto).length,
      }
    }),
    ...conversations.map((c) => ({
      kind: 'dm' as const,
      id: c.userId,
      group: null as ChatGroup | null,
      lastTs: c.last.createdAt,
      lastText: c.last.content,
      unread: c.unread,
    })),
  ].sort((a, b) => b.lastTs - a.lastTs)

  const activeId = query.get('with') ?? items[0]?.id
  const activeGroup = activeId ? (groups.find((g) => g.id === activeId) ?? null) : null
  const active = activeGroup ? null : conversations.find((c) => c.userId === activeId)
  const activeUser = active ? api.user(active.userId) : null
  const gMsgs = activeGroup ? groupMsgsOf(activeGroup.id) : []
  const activeCount = activeGroup ? gMsgs.length : (active?.msgs.length ?? 0)

  /* 轮 22 打通：打开会话即清未读（对接现有导航 badge）—— 单聊走 readConversation，群聊走分组已读 */
  useEffect(() => {
    if (!activeId) return
    if (activeGroup) markGroupRead(activeId)
    else api.readConversation(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeGroup?.id, activeCount])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeCount, activeId])

  /* 已读回执：本机无法获知对方是否真实已读（云端无已读 API），仅展示「已送达」，不伪造已读状态 */
  const mySentCount = active && !activeGroup ? active.msgs.filter((m) => m.fromMe).length : 0

  const send = () => {
    if (!input.trim() || !activeId || activeGroup) return
    /* 轮 20 打通：账号级隐私约束——黑名单 / 关闭私信 / 仅限关注的人，命中即拦截并 toast */
    if (blacklist.includes(activeId)) {
      toast('已拉黑该用户，无法发送私信')
      return
    }
    if (privacy.dm === 'off') {
      toast('你已关闭私信功能，可在「设置 → 隐私设置」重新开启')
      return
    }
    if (privacy.dm === 'following' && !api.isFollowing(activeId)) {
      toast('你的私信仅允许「我关注的人」，请先关注对方')
      return
    }
    api.sendMessage(activeId, input)
    setInput('')
  }

  /* 轮 22 打通：群聊发送 —— 成员发言写入分 key 存储（本地单视角，仅记录本人真实发言） */
  const sendToGroup = () => {
    const text = input.trim()
    if (!text || !activeGroup) return
    sendGroupMessage(activeGroup, api.me.id, text)
    setInput('')
  }

  /* 轮 22 打通：退群 */
  const leave = () => {
    if (!activeGroup) return
    if (!window.confirm(`确定退出「${activeGroup.name}」并清空本机群消息吗？`)) return
    leaveGroup(activeGroup.id)
    toast('已退出群聊')
    navigate('/messages')
  }

  return (
    <div className="page-grid single">
      <div className="msg-layout">
        <div className="msg-list">
          {/* 轮 22 打通：发起群聊 / 消息漫游入口 */}
          <div className="sg-msg-tools">
            <button className="btn btn-ghost btn-sm" onClick={() => setGroupOpen(true)}>
              👥 发起群聊
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRoamOpen(true)}>
              ☁️ 消息漫游
            </button>
          </div>
          {items.length === 0 && <Empty emoji="💬" text="暂无会话，点上方「发起群聊」开聊" />}
          {items.map((c) => (
            <div
              key={c.kind + c.id}
              className={cx('msg-item', c.id === activeId && 'active')}
              onClick={() => navigate(`/messages?with=${c.id}`)}
            >
              {c.group ? (
                <span className="sg-group-avatar">
                  <Avatar emoji="👥" color="var(--primary-weak)" size={40} />
                  <em className="sg-group-badge">{c.group.memberIds.length}</em>
                </span>
              ) : (
                <Avatar emoji={api.user(c.id).emoji} color={api.user(c.id).color} size={40} />
              )}
              <div className="msg-item-main">
                <b>{c.group ? c.group.name : api.user(c.id).name}</b>
                <p>{c.lastText}</p>
              </div>
              {c.unread > 0 && <span className="msg-unread" />}
            </div>
          ))}
        </div>

        <div className="msg-thread">
          {activeGroup ? (
            <>
              {/* 轮 22 打通：群聊会话 —— 头部展示成员数，可退群 */}
              <div className="sg-thread-head">
                👥 {activeGroup.name}
                <small>共 {activeGroup.memberIds.length} 人 · 群聊</small>
                <button className="btn btn-ghost btn-sm sg-leave" onClick={leave}>
                  🚪 退群
                </button>
              </div>
              <div className="msg-bubbles">
                {gMsgs.map((m) => {
                  const mine = m.authorId === api.me.id
                  const author = mine ? api.me : api.user(m.authorId)
                  return (
                    <div key={m.id} className={cx('bubble-row', mine && 'me')}>
                      <Avatar emoji={author.emoji} color={author.color} size={30} />
                      <div>
                        {!mine && <small className="sg-bubble-name">{author.name}</small>}
                        <div className="bubble">{m.content}</div>
                      </div>
                      <span className="bubble-time">{timeAgo(m.createdAt)}</span>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>
              <div className="msg-input-bar">
                <input
                  className="input"
                  placeholder={`在「${activeGroup.name}」发言…`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendToGroup()}
                />
                <button className="btn btn-primary btn-sm" disabled={!input.trim()} onClick={sendToGroup}>
                  发送
                </button>
              </div>
            </>
          ) : activeUser && active ? (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
                {activeUser.name}
                <small style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 8 }}>私信会话</small>
              </div>
              <div className="msg-bubbles">
                {active.msgs.map((m) => (
                  <div key={m.id} className={cx('bubble-row', m.fromMe && 'me')}>
                    <Avatar
                      emoji={m.fromMe ? api.me.emoji : activeUser.emoji}
                      color={m.fromMe ? api.me.color : activeUser.color}
                      size={30}
                    />
                    <div className="bubble">{m.content}</div>
                    <span className="bubble-time">
                      {timeAgo(m.createdAt)}
                      {/* 已读回执：仅展示「已送达」，不伪造对方已读（云端无已读 API） */}
                      {m.fromMe && <em className="sg-receipt">已送达</em>}
                    </span>
                  </div>
                ))}
                {/* 轮 24 打通：B5 语音条气泡（仅单聊会话，按登录身份+会话 id 分 key 存取） */}
                <VoiceBubbleThread convId={active.userId} />
                <div ref={bottomRef} />
              </div>
              <div className="msg-input-bar">
                {/* 轮 24 打通：B5 语音条——按住说话（真实 MediaRecorder 录音 0.5s 起，松开停止并发送） */}
                <VoiceRecordButton convId={active.userId} />
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

      {/* 轮 22 打通：建群 / 消息漫游弹窗 */}
      {groupOpen && <GroupCreateModal onClose={() => setGroupOpen(false)} />}
      {roamOpen && <RoamModal messages={api.state.messages} onClose={() => setRoamOpen(false)} />}
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
            ⭐ 收藏的动态（{api.state.favorites.filter((f) => f.type === 'post').length}）
          </button>
          <button className={cx('tab-btn', tab === 'article' && 'active')} onClick={() => setTab('article')}>
            📄 收藏的文章（{api.state.favorites.filter((f) => f.type === 'article').length}）
          </button>
        </div>
        {tab === 'post' && (posts.length === 0 ? <Empty emoji="⭐" text="还没有收藏动态" /> : posts.map((p) => <PostCard key={p.id} post={p} />))}
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
  /* 轮 21 打通：主页动态列表排除快拍（快拍只在快拍栏/弹窗展示） */
  const myPosts = api.state.posts.filter((p) => p.authorId === api.me.id && !p.story)
  const drafts = api.state.postDrafts

  return (
    <div className="page-grid single">
      <div>
        <ProfileHead
          u={api.me}
          extraStats={[
            { label: '动态', value: myPosts.length },
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
        <MyAppHub />
        <div className="tabs">
          <button className={cx('tab-btn', tab === 'posts' && 'active')} onClick={() => setTab('posts')}>
            我的动态（{myPosts.length}）
          </button>
          <button className={cx('tab-btn', tab === 'drafts' && 'active')} onClick={() => setTab('drafts')}>
            草稿箱（{drafts.length}）
          </button>
        </div>

        {tab === 'posts' &&
          (myPosts.length === 0 ? <Empty emoji="✍️" text="你还没有发布过动态" /> : myPosts.map((p) => <PostCard key={p.id} post={p} />))}

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
                <VBadge u={u} />
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
  const toast = useToast()
  const { blacklist } = useUserDomain()

  useEffect(() => {
    if (id === api.me.id) navigate('/my')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (id === api.me.id) return null
  if (!api.state.users[id]) return <Empty emoji="👻" text="用户不存在或已注销" />
  const u = api.user(id)
  /* 轮 21 打通：他人主页只展示可见的非快拍动态（仅自己可见的他人看不到） */
  const posts = api.state.posts.filter((p) => p.authorId === id && !p.story && postVisibleTo(p, api.me.id))
  const articles = api.state.articles.filter((a) => a.authorId === id)

  return (
    <div className="page-grid single">
      <div>
        <ProfileHead
          u={u}
          extraStats={[{ label: '动态', value: posts.length }, { label: '文章', value: articles.length }]}
          actions={
            <>
              <FollowButton userId={id} />
              <button className="btn btn-ghost" onClick={() => navigate(`/messages?with=${id}`)}>
                ✉️ 私信
              </button>
              {/* 轮 20 打通：用户页加入/移出黑名单（按当前身份分 key 存储，feed 与私信同步生效） */}
              <button
                className="btn btn-ghost"
                onClick={() => {
                  const blocked = toggleBlacklistUser(id)
                  toast(blocked ? `已将 ${u.name} 加入黑名单，TA 的动态与私信将被拦截` : `已将 ${u.name} 移出黑名单`)
                }}
              >
                {blacklist.includes(id) ? '✅ 移出黑名单' : '🚫 拉黑'}
              </button>
            </>
          }
        />
        {posts.length === 0 && <Empty emoji="🕊" text="TA 还没有发布过动态" />}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
      </div>
    </div>
  )
}
