/* ==========================================================================
 * FeedPage 首页广场 —— 四 Tab 分发（关注 / 推荐 / 热门 / 同城）+ 发布框 + 侧栏
 *
 * 数据：全部来自 useApp() 的本机内容真源；过滤链与排序一律调 domain/content/rules，
 *       页面不自行重排顺序（快拍不进流 / 仅自己可见 / 黑名单 / 青少年 / 负反馈 / 快拍过期）。
 * 分页：每页 10 条（rules.pageOf 默认取 LIMITS.feedPageSize），切 Tab 重置，
 *       避免长列表一次性全量渲染（与原实现的 visibleCount 口径一致）。
 * 侧栏：热搜 Top10 与话题推荐 Top5 由动态真实派生（见 content-lib 说明）；
 *       原实现读的 topics / hotSearches 集合从未被真实通道填充且含预铺热度，此处不还原，
 *       没有数据时一律落到空态。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar, Empty, PostCard, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx, formatCount } from '@/core/utils'
import type { Post } from '@/domain/content/model'
import {
  feedFilter,
  filterByCity,
  hasMore,
  heatOf,
  pageOf,
  recoScore,
  sortFollowing,
  sortHot,
} from '@/domain/content/rules'
import { useFirstPaint } from './content-data'
import { useFeedPrefs } from './content-prefs'
import { reportGrowth } from './growth-report'
import { AsyncState, FollowButton, RepostModal, UserRow } from './content-parts'
import {
  CITY_PRESETS,
  authorOf,
  citiesOf,
  hotSearchFromPosts,
  sortTopics,
  topicsFromPosts,
  userNameResolver,
} from './content-lib'

type Tab = 'follow' | 'reco' | 'hot' | 'city'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'follow', label: '👥 关注' },
  { key: 'reco', label: '✨ 推荐' },
  { key: 'hot', label: '🔥 热门' },
  { key: 'city', label: '📍 同城' },
]

const POST_EMOJIS = ['😀', '😂', '🤔', '😭', '👍', '🔥', '🎉', '❤️', '🚀', '💡', '✅', '⚠️']
const IMAGE_EMOJIS = ['⚛️', '🚀', '🎨', '🐱', '🌸', '🍜', '🏔️', '💻', '📱']

export function FeedPage() {
  const app = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const ready = useFirstPaint()
  const prefs = useFeedPrefs(app.meId, CITY_PRESETS[0])

  /* 默认落到「推荐」而非「关注」：新用户关注数为 0，默认关注 Tab 必然空态；
     推荐流基于全站内容打分（buildReco），接入后端后任何新用户都有内容可看。
     注：未配置后端时本地 posts 初始为空（见 app/state/content.tsx），四个 Tab 都会空态——
     那是数据源缺失，不是 Tab 选择问题，需由「是否提供演示种子」的产品决策解决。 */
  const [tab, setTab] = useState<Tab>('reco')
  const [page, setPage] = useState(1)
  const switchTab = (t: Tab): void => {
    setTab(t)
    setPage(1) // 切 Tab 必须重置分页，否则新 Tab 会沿用上一次的翻页下标
  }

  /* ---------- 发布框 ---------- */
  const [content, setContent] = useState('')
  const [topic, setTopic] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [picker, setPicker] = useState<'none' | 'emoji' | 'image'>('none')

  /* ---------- 候选池：四个 Tab 共用同一条过滤链 ---------- */
  const posts = app.state.posts
  const users = app.state.users
  const me = authorOf(users, app.meId)
  const visible = useMemo(() => posts.filter((p) => feedFilter(p, app.meId, prefs.filter)), [posts, app.meId, prefs.filter])

  const followList = useMemo(() => {
    const mine = visible.filter((p) => p.authorId === app.meId || app.state.following.includes(p.authorId))
    return sortFollowing(mine)
  }, [visible, app.meId, app.state.following])

  const recoList = useMemo(
    () =>
      buildReco({
        posts: visible,
        meId: app.meId,
        following: app.state.following,
        favorites: app.state.favorites,
        negTopics: prefs.neg.topics,
      }),
    [visible, app.meId, app.state.following, app.state.favorites, prefs.neg.topics],
  )

  const hotList = useMemo(() => sortHot(visible.filter((p) => p.authorId !== app.meId)), [visible, app.meId])
  /* 热门流正文：跳过已在「24 小时热榜 Top3」横幅展示过的前 3 条，
     否则同一屏里这 3 条会先以榜单行、再以完整卡片各出现一次。 */
  const hotRestList = useMemo(() => hotList.slice(3), [hotList])
  const cityList = useMemo(
    () => filterByCity(visible, prefs.city).sort((a, b) => b.createdAt - a.createdAt),
    [visible, prefs.city],
  )

  const topicStats = useMemo(() => topicsFromPosts(visible), [visible])
  const cities = useMemo(() => citiesOf(posts), [posts])
  const activePosts = tab === 'follow' ? followList : tab === 'reco' ? recoList.map((r) => r.post) : tab === 'hot' ? hotRestList : cityList
  const shownCount = Math.min(page * 10, activePosts.length)
  const [repostOf, setRepostOf] = useState<Post | null>(null)

  const publish = (): void => {
    if (!content.trim()) {
      toast('先写点什么吧')
      return
    }
    app.publishPost(content.trim(), { topic: topic.trim() || null, images })
    reportGrowth('publish_dynamic')
    setContent('')
    setTopic('')
    setImages([])
    setPicker('none')
    toast('发布成功 🎉')
  }

  const saveDraft = (): void => {
    if (!content.trim()) {
      toast('草稿内容为空')
      return
    }
    app.savePostDraft(content.trim(), topic.trim(), images)
    setContent('')
    setTopic('')
    setImages([])
    setPicker('none')
    toast('已存入草稿箱')
  }

  const renderPost = (p: Post): ReactNode => (
    <PostCard
      key={p.id}
      post={p}
      author={authorOf(users, p.authorId)}
      viewerId={app.meId}
      onOpen={() => navigate(`/post/${p.id}`)}
      onComment={() => navigate(`/post/${p.id}`)}
      onToggleLike={() => {
        // 只在「由未赞变已赞」时上报，取消赞不倒扣
        if (!p.likedByMe) reportGrowth('dynamic_liked')
        app.togglePostLike(p.id)
      }}
      onRepost={() => setRepostOf(p)}
      onVote={(i: number) => {
        app.castVote(p.id, i)
        toast('投票成功，一人一票 🗳️')
      }}
      onDelete={p.authorId === app.meId ? () => app.deletePost(p.id) : undefined}
      onUser={(id) => navigate(id === app.meId ? '/my' : `/user/${id}`)}
      onTopic={(name) => navigate(`/topic/${encodeURIComponent(name)}`)}
      resolveUser={userNameResolver(users)}
    />
  )

  return (
    <div className="page-grid">
      <div>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => switchTab(t.key)}>
              {t.label}
            </button>
          ))}
          <span className="grow" />
          {tab === 'city' ? (
            <select
              className="input city-select"
              aria-label="切换城市"
              value={prefs.city}
              onChange={(e) => prefs.setCity(e.target.value)}
            >
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : null}
          <a className="btn btn-ghost btn-sm tab-link" href="#/videos">
            🎬 视频
          </a>
        </div>

        {/* 青少年模式开启时明确说明「因此少看了什么」，避免用户以为内容丢失 */}
        {prefs.teenEnabled ? <div className="notice-bar">🛡 青少年模式已开启，命中青少年敏感词的内容已过滤</div> : null}
        {prefs.negCount > 0 ? (
          <div className="notice-bar">
            🚫 已屏蔽 {prefs.negCount} 条推荐（不感兴趣的作者 / 话题）
            <button className="btn btn-ghost btn-sm" onClick={() => prefs.clearNeg()}>
              恢复
            </button>
          </div>
        ) : null}
        {posts.length > 0 && visible.length === 0 ? (
          <Empty emoji="🛡" text="当前内容已被黑名单 / 青少年模式 / 负反馈全部过滤" />
        ) : null}

        <div className="card compose">
          <div className="compose-top">
            <Avatar emoji={me.emoji} color={me.color} size={40} />
            <textarea
              className="input"
              placeholder="分享新鲜事…（支持 #话题# 和 @用户）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          {picker !== 'none' ? (
            <div className="emoji-picker">
              {(picker === 'emoji' ? POST_EMOJIS : IMAGE_EMOJIS).map((e) => (
                <button
                  key={e}
                  onClick={() =>
                    picker === 'emoji' ? setContent((c) => c + e) : setImages((s) => (s.includes(e) ? s : [...s, e]))
                  }
                >
                  {e}
                </button>
              ))}
            </div>
          ) : null}
          <div className="compose-tools">
            <button
              className="icon-btn"
              title="表情"
              aria-label="插入表情"
              onClick={() => setPicker((v) => (v === 'emoji' ? 'none' : 'emoji'))}
            >
              😊
            </button>
            <button
              className="icon-btn"
              title="配图"
              aria-label="添加配图"
              onClick={() => setPicker((v) => (v === 'image' ? 'none' : 'image'))}
            >
              🖼
            </button>
            {images.length > 0 ? <small className="muted">已选 {images.length} 张配图</small> : null}
            <input
              className="input topic-input"
              list="feed-topic-options"
              placeholder="#话题（可选）"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <datalist id="feed-topic-options">
              {sortTopics(topicStats, 'posts')
                .slice(0, 10)
                .map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
            </datalist>
            <span className="grow" />
            <button className="btn btn-ghost btn-sm" onClick={saveDraft}>
              存草稿
            </button>
            <button className="btn btn-primary btn-sm" onClick={publish}>
              发布
            </button>
          </div>
        </div>

        {tab === 'follow' ? (
          <AsyncState
            loading={!ready}
            empty={followList.length === 0 ? <Empty emoji="👥" text="关注的人还没有新动态，去推荐或热门页逛逛吧" /> : null}
          >
            {pageOf(followList, page).map(renderPost)}
          </AsyncState>
        ) : null}

        {tab === 'reco' ? (
          <AsyncState
            loading={!ready}
            empty={recoList.length === 0 ? <Empty emoji="✨" text="暂无推荐内容，发布或互动越多推荐越准" /> : null}
          >
            {pageOf(recoList, page).map(({ post, reason }) => (
              <div key={post.id} className="reco-item">
                <div className="reco-reason">
                  <span>{reason}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="减少此类推荐"
                    onClick={() => {
                      prefs.dislikeAuthor(post.authorId)
                      if (post.topic) prefs.dislikeTopic(post.topic)
                      toast('已减少此类推荐')
                    }}
                  >
                    不感兴趣
                  </button>
                </div>
                {renderPost(post)}
              </div>
            ))}
          </AsyncState>
        ) : null}

        {tab === 'hot' ? (
          <AsyncState
            loading={!ready}
            empty={hotList.length === 0 ? <Empty emoji="🔥" text="暂无热门动态，多互动让内容热起来" /> : null}
          >
            {hotList.length > 0 ? (
              <div className="card hot-banner">
                <b>🔥 24 小时热榜 Top3</b>
                {hotList.slice(0, 3).map((p, i) => (
                  <a key={p.id} className="rank-row" href={`#/post/${p.id}`}>
                    <span className={cx('rank-no', `rank-top-${i + 1}`)}>{i + 1}</span>
                    <span className="grow hot-text">{p.content.slice(0, 40) || '（图片动态）'}</span>
                    <small className="muted">{formatCount(heatOf(p))} 热度</small>
                  </a>
                ))}
              </div>
            ) : null}
            {pageOf(hotRestList, page).map(renderPost)}
          </AsyncState>
        ) : null}

        {tab === 'city' ? (
          <AsyncState
            loading={!ready}
            empty={
              cityList.length === 0 ? (
                <Empty emoji="📍" text={`暂无「${prefs.city}」的同城动态，发布时带上位置即可现身同城`} />
              ) : null
            }
          >
            {pageOf(cityList, page).map(renderPost)}
          </AsyncState>
        ) : null}

        {hasMore(activePosts, page) ? (
          <div className="load-more">
            <button className="btn btn-ghost" onClick={() => setPage((p) => p + 1)}>
              加载更多
            </button>
            <small className="muted">
              已展示 {shownCount} / {activePosts.length} 条
            </small>
          </div>
        ) : null}
      </div>

      <FeedSide posts={visible} ready={ready} />
      {repostOf !== null ? <RepostModal post={repostOf} onClose={() => setRepostOf(null)} /> : null}
    </div>
  )
}

/* ---------- 侧栏：热搜 / 话题推荐 / 推荐关注 ---------- */

function FeedSide({ posts, ready }: { posts: Post[]; ready: boolean }): ReactNode {
  const app = useApp()
  const hotSearches = hotSearchFromPosts(posts)
  const recoTopics = sortTopics(topicsFromPosts(posts), 'posts').slice(0, 5)
  const strangers = app.state.users.filter((u) => u.id !== app.meId && !app.state.following.includes(u.id)).slice(0, 3)

  return (
    <div className="side-col">
      <div className="side-card">
        <h3 className="side-title">
          🔥 热搜榜
          <a className="side-more" href="#/ranks">
            榜单 »
          </a>
        </h3>
        <AsyncState
          loading={!ready}
          skeletonRows={4}
          empty={hotSearches.length === 0 && <Empty emoji="🔥" text="还没有话题热度，发一条带 #话题# 的动态就有榜了" />}
        >
          {hotSearches.map((h) => (
            <a key={h.id} className="hot-item" href={`#/search?q=${encodeURIComponent(h.text)}`}>
              <span className={cx('rank-no', h.rank <= 3 && `rank-top-${h.rank}`)}>{h.rank}</span>
              <span className="grow hot-text">{h.text}</span>
              {h.tag ? <span className={cx('hot-tag', `t-${h.tag}`)}>{h.tag}</span> : null}
              <small className="muted">{formatCount(h.heat)}</small>
            </a>
          ))}
        </AsyncState>
      </div>

      <div className="side-card">
        <h3 className="side-title">📊 话题推荐</h3>
        <AsyncState
          loading={!ready}
          skeletonRows={2}
          empty={recoTopics.length === 0 && <Empty emoji="💬" text="还没有话题，发布动态时带上 #话题# 试试" />}
        >
          {recoTopics.map((t) => (
            <a key={t.name} className="topic-reco" href={`#/topic/${encodeURIComponent(t.name)}`}>
              #{t.name}#
              <small className="muted side-right">{t.posts} 条讨论</small>
            </a>
          ))}
        </AsyncState>
      </div>

      <div className="side-card">
        <h3 className="side-title">👀 推荐关注</h3>
        <AsyncState
          loading={!ready}
          skeletonRows={2}
          empty={strangers.length === 0 && <Empty emoji="👤" text="暂无可推荐的用户" />}
        >
          {strangers.map((u) => (
            <UserRow
              key={u.id}
              meId={app.meId}
              author={{ id: u.id, name: u.name, emoji: u.emoji, color: u.color, verified: u.verified }}
              right={<FollowButton userId={u.id} />}
            />
          ))}
        </AsyncState>
      </div>
    </div>
  )
}

/* ---------- 推荐流打分 ---------- */

interface RecoInput {
  posts: Post[]
  meId: string
  following: string[]
  favorites: ReturnType<typeof useApp>['state']['favorites']
  negTopics: string[]
}

interface RecoItem {
  post: Post
  reason: string
  score: number
}

/**
 * 推荐排序：recoScore = 作者权重×2 + 话题权重×1.5 + 时间衰减 exp(-h/48)×2。
 * 权重如实取自本机真实行为，不用随机数凑排序：
 *   作者权重 = 我点赞过该作者的动态数（上限 1），代表「我常互动的人」
 *   话题权重 = 该话题是否出现在我发过 / 赞过 / 收藏过的动态里
 */
function buildReco({ posts, meId, following, favorites, negTopics }: RecoInput): RecoItem[] {
  const favIds = new Set(favorites.filter((f) => f.type === 'post').map((f) => f.targetId))
  const engaged = new Set<string>()
  for (const p of posts) {
    if (p.authorId === meId || p.likedByMe || favIds.has(p.id)) engaged.add(p.topic ?? '')
  }
  const likedByAuthor = new Map<string, number>()
  for (const p of posts) {
    if (p.likedByMe) likedByAuthor.set(p.authorId, (likedByAuthor.get(p.authorId) ?? 0) + 1)
  }

  return posts
    .filter((p) => p.authorId !== meId && !following.includes(p.authorId) && !negTopics.includes(p.topic ?? ''))
    .map((post) => {
      const authorWeight = Math.min(1, (likedByAuthor.get(post.authorId) ?? 0) / 3)
      const topicWeight = post.topic && engaged.has(post.topic) ? 1 : 0
      return {
        post,
        reason: authorWeight > 0 ? '你常点赞的 TA' : topicWeight > 0 ? `你参与过的话题 · ${post.topic}` : '新鲜发布',
        score: recoScore(post, authorWeight, topicWeight),
      }
    })
    .sort((a, b) => b.score - a.score)
}
