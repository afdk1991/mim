/* 轮 23 打通：B4 发现与分发域 UI 层 —— 视频沉浸流（#/videos）/ 榜单体系（#/ranks）/
   AB Debug 面板 + 负反馈与同城 hooks。核心纯逻辑见 lib/feed-core.ts 与 lib/ab.ts。 */
import { useCallback, useEffect, useState } from 'react'
import { useApp } from './store'
import { cx, formatCount } from './utils'
import { Avatar, Empty, Modal, RichText, VideoPlayerScreen } from './components'
import { readVerify, useUserDomain, VBadge } from './user-domain'
import { postVisibleTo } from './content-domain'
import { AB_EVT, abSummary, abIs, loadAbDebug, writeAbDebug } from './lib/ab'
import { RF_EVT, loadCity, loadNeg, saveCity, type NegFeedback } from './lib/feed-core'
import './feed-domain.css'
import type { Post, PostMedia } from './types'

/* ---------- 负反馈 hook（按登录身份分 key，RF_EVT 即时刷新） ---------- */
export function useNegFeedback(): NegFeedback {
  const [neg, setNeg] = useState<NegFeedback>(() => loadNeg())
  useEffect(() => {
    const sync = (): void => setNeg(loadNeg())
    window.addEventListener(RF_EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(RF_EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return neg
}

/* ---------- 同城定位 hook（未设置时默认城市走 AB 实验 city_default） ---------- */
export function useCity(): [string, (c: string) => void] {
  const fallback = abIs('city_default', 'b') ? '上海市' : '北京市'
  const [city, setCityState] = useState<string>(() => loadCity(undefined, fallback))
  useEffect(() => {
    const sync = (): void => setCityState(loadCity(undefined, fallback))
    window.addEventListener(RF_EVT, sync)
    return () => window.removeEventListener(RF_EVT, sync)
  }, [fallback])
  const setCity = useCallback((c: string) => saveCity(c), [])
  return [city, setCity]
}

/* ---------- AB Debug 面板：展示当前身份命中的实验桶（#videos 页底开关控制显隐） ---------- */
function AbDebugBar() {
  const rows = abSummary()
  return (
    <div className="ab-debug">
      <b>🧪 AB 实验 · 当前命中桶</b>
      {rows.map(({ exp, variant }) => (
        <div key={exp.key} className="ab-debug-row">
          <span>{exp.name}</span>
          <code>
            {exp.key} → {variant}
          </code>
        </div>
      ))}
    </div>
  )
}

/* 轮 23 打通：B4 视频沉浸流 —— #/videos 纵向全屏卡片流（scroll-snap 上下滑动切换），
   仅显示含 video 媒体的动态，沿用黑名单 / 可见性 / 快拍过滤口径 */
export function VideosPage() {
  const api = useApp()
  const { blacklist } = useUserDomain()
  const [abDebug, setAbDebug] = useState<boolean>(() => loadAbDebug())
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    const sync = (): void => setAbDebug(loadAbDebug())
    window.addEventListener(AB_EVT, sync)
    return () => window.removeEventListener(AB_EVT, sync)
  }, [])
  const vids = api.state.posts.filter(
    (p): p is Post & { media: PostMedia } =>
      p.media?.type === 'video' &&
      !p.story &&
      postVisibleTo(p, api.me.id) &&
      !blacklist.includes(p.authorId),
  )
  return (
    <div className="page-grid single">
      <div>
        <div className="rf-video-head">
          <h2 className="page-title">🎬 视频沉浸流</h2>
          {/* 轮 23 打通：B4 AB Debug 小开关 —— 开启后控制台打印命中桶并展开页底面板 */}
          <button
            className={cx('btn btn-sm', abDebug ? 'btn-primary' : 'btn-ghost')}
            onClick={() => writeAbDebug(!abDebug)}
          >
            🧪 AB Debug
          </button>
        </div>
        {vids.length === 0 ? (
          <Empty emoji="🎬" text="还没有视频动态，去发布一条带视频的内容吧" />
        ) : (
          <div className="rf-video-scroll">
            {vids.map((p) => {
              const u = api.user(p.authorId)
              const mine = p.authorId === api.me.id
              return (
                <section key={p.id} className="rf-video-card">
                  <button
                    type="button"
                    className="rf-video-screen"
                    aria-label="播放视频"
                    onClick={() => setOpenId(openId === p.id ? null : p.id)}
                  >
                    <span className="rf-video-poster">{p.media.poster}</span>
                    <span className="rf-video-play">▶</span>
                    {p.media.duration != null && (
                      <span className="rf-video-dur">{formatCount(p.media.duration)}s</span>
                    )}
                  </button>
                  {openId === p.id && (
                    <Modal title="视频播放" onClose={() => setOpenId(null)}>
                      <VideoPlayerScreen media={p.media} />
                    </Modal>
                  )}
                  <div className="rf-video-info">
                    <b>
                      {u.emoji} {u.name} · {mine ? '我的动态' : '推荐视频'}
                    </b>
                    <p>
                      <RichText text={p.content} />
                    </p>
                  </div>
                  {/* 点赞 / 评论浮层：与普通流同一套互动数据 */}
                  <div className="rf-video-float">
                    <button
                      className={cx('rf-vf-btn', p.likedByMe && 'active')}
                      onClick={() => api.togglePostLike(p.id)}
                      aria-label="点赞"
                    >
                      {p.likedByMe ? '❤️' : '🤍'}
                      <small>{formatCount(p.likes)}</small>
                    </button>
                    <a className="rf-vf-btn" href={`#/post/${p.id}`} aria-label="评论">
                      💬
                      <small>{formatCount(p.comments?.length ?? 0)}</small>
                    </a>
                  </div>
                </section>
              )
            })}
          </div>
        )}
        {abDebug && <AbDebugBar />}
      </div>
    </div>
  )
}

/* 轮 23 打通：B4 榜单体系 —— 话题榜（提及数）/ 明星榜（橙V 粉丝数）/ 影响力榜（赞+评+转 Top10），
   三榜 Tab 切换，金银铜名次徽标 */
type RankTab = 'topic' | 'star' | 'power'

const RANK_TABS: Array<{ key: RankTab; label: string; icon: string }> = [
  { key: 'topic', label: '话题榜', icon: '💬' },
  { key: 'star', label: '明星榜', icon: '🌟' },
  { key: 'power', label: '影响力榜', icon: '⚡' },
]

function RankNo({ i }: { i: number }) {
  return <span className={cx('rk-no', i < 3 && `rk-top-${i + 1}`)}>{i + 1}</span>
}

export function RanksPage() {
  const api = useApp()
  const [tab, setTab] = useState<RankTab>('topic')

  /* 话题榜：动态 topic 提及数为主排序，seed 话题热度兜底（seed 空时从动态合成） */
  const topicRows = (() => {
    const mention = new Map<string, number>()
    for (const p of api.state.posts) if (p.topic) mention.set(p.topic, (mention.get(p.topic) ?? 0) + 1)
    const names = [...new Set([...api.state.topics.map((t) => t.name), ...mention.keys()])]
    return names
      .map((name) => {
        const t = api.state.topics.find((x) => x.name === name)
        return { name, desc: t?.desc ?? '大家都在聊这个话题', heat: t?.heat ?? 0, posts: mention.get(name) ?? 0 }
      })
      .sort((a, b) => b.posts - a.posts || b.heat - a.heat)
  })()

  /* 明星榜：认证橙V（seed verified 或用户域认证审批通过）按粉丝数排序 */
  const starRows = Object.values(api.state.users)
    .filter((u) => u.verified || readVerify(u.id).status === 'approved')
    .sort((a, b) => b.followers - a.followers)

  /* 影响力榜：互动量 = 赞 + 评 + 转 加权 Top10 */
  const powerRows = Object.values(api.state.users)
    .map((u) => {
      const own = api.state.posts.filter((p) => p.authorId === u.id && !p.story)
      const total = own.reduce((s, p) => s + p.likes + (p.comments?.length ?? 0) + p.reposts, 0)
      return { u, total, posts: own.length }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📊 榜单</h2>
        <div className="tabs rk-tabs">
          {RANK_TABS.map((t) => (
            <button
              key={t.key}
              className={cx('tab-btn', tab === t.key && 'active')}
              onClick={() => setTab(t.key)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div className="card">
          {tab === 'topic' &&
            (topicRows.length === 0 ? (
              <Empty emoji="💬" text="还没有话题讨论，发一条带 #话题# 的动态上榜" />
            ) : (
              topicRows.map((r, i) => (
                <a key={r.name} className="rk-row" href={`#/topic/${encodeURIComponent(r.name)}`}>
                  <RankNo i={i} />
                  <div className="rk-main">
                    <b>#{r.name}#</b>
                    <small>{r.desc}</small>
                  </div>
                  <div className="rk-meta">
                    <b>{formatCount(r.posts)}</b> 条讨论 · {formatCount(r.heat)} 阅读
                  </div>
                </a>
              ))
            ))}
          {tab === 'star' &&
            (starRows.length === 0 ? (
              <Empty emoji="🌟" text="暂无认证用户上榜，去「设置 → 创作者认证」申请橙V" />
            ) : (
              starRows.map((u, i) => (
                <a key={u.id} className="rk-row" href={u.id === api.me.id ? '#/my' : `#/user/${u.id}`}>
                  <RankNo i={i} />
                  <Avatar emoji={u.emoji} color={u.color} size={40} />
                  <div className="rk-main">
                    <b>
                      {u.name} <VBadge u={u} />
                    </b>
                    <small>{u.bio}</small>
                  </div>
                  <div className="rk-meta">
                    <b>{formatCount(u.followers)}</b> 粉丝
                  </div>
                </a>
              ))
            ))}
          {tab === 'power' &&
            (powerRows.length === 0 ? (
              <Empty emoji="⚡" text="暂无互动数据，点赞评论转发越多影响力越高" />
            ) : (
              powerRows.map((r, i) => (
                <a key={r.u.id} className="rk-row" href={r.u.id === api.me.id ? '#/my' : `#/user/${r.u.id}`}>
                  <RankNo i={i} />
                  <Avatar emoji={r.u.emoji} color={r.u.color} size={40} />
                  <div className="rk-main">
                    <b>{r.u.name}</b>
                    <small>{r.posts} 条动态</small>
                  </div>
                  <div className="rk-meta">
                    <b>{formatCount(r.total)}</b> 互动量
                  </div>
                </a>
              ))
            ))}
        </div>
      </div>
    </div>
  )
}
