/* ==========================================================================
 * RanksPage 榜单体系 —— 话题榜 / 明星榜 / 影响力榜
 *
 * 三榜口径（沿用原实现）：
 *   话题榜   = 话题被动态提及的次数（次序：互动热度）
 *   明星榜   = 认证用户（User.verified）按粉丝数排序
 *   影响力榜 = 用户互动量（赞 + 评 + 转）Top10，且只统计有互动的人
 * 所有数据本机真实派生：没有互动就没有榜单，不预铺底数。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar, Empty } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount } from '@/core/utils'
import { feedFilter } from '@/domain/content/rules'
import { useFirstPaint } from './content-data'
import { useFeedPrefs } from './content-prefs'
import { AsyncState } from './content-parts'
import { CITY_PRESETS, nameOf, sortTopics, topicsFromPosts } from './content-lib'

type RankTab = 'topic' | 'star' | 'power'

const RANK_TABS: Array<{ key: RankTab; label: string }> = [
  { key: 'topic', label: '💬 话题榜' },
  { key: 'star', label: '🌟 明星榜' },
  { key: 'power', label: '⚡ 影响力榜' },
]

export function RanksPage() {
  const app = useApp()
  const ready = useFirstPaint()
  const prefs = useFeedPrefs(app.meId, CITY_PRESETS[0])
  const [tab, setTab] = useState<RankTab>('topic')

  const visible = useMemo(
    () => app.state.posts.filter((p) => feedFilter(p, app.meId, prefs.filter)),
    [app.state.posts, app.meId, prefs.filter],
  )
  const topicRows = useMemo(() => sortTopics(topicsFromPosts(visible), 'posts'), [visible])
  const starRows = useMemo(
    () => app.state.users.filter((u) => u.verified).sort((a, b) => b.followers - a.followers),
    [app.state.users],
  )
  const powerRows = useMemo(
    () =>
      app.state.users
        .map((u) => {
          const own = visible.filter((p) => p.authorId === u.id)
          return { u, posts: own.length, total: own.reduce((s, p) => s + p.likes + p.comments.length + p.reposts, 0) }
        })
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
    [app.state.users, visible],
  )

  const emptyOf = (t: RankTab): ReactNode => {
    if (t === 'topic') return <Empty emoji="💬" text="还没有话题讨论，发一条带 #话题# 的动态上榜" />
    if (t === 'star') return <Empty emoji="🌟" text="暂无认证用户上榜" />
    return <Empty emoji="⚡" text="暂无互动数据，点赞评论转发越多影响力越高" />
  }
  const isEmpty = tab === 'topic' ? topicRows.length === 0 : tab === 'star' ? starRows.length === 0 : powerRows.length === 0

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📊 榜单</h2>
        <div className="tabs">
          {RANK_TABS.map((t) => (
            <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <AsyncState loading={!ready} skeletonRows={4} empty={isEmpty ? emptyOf(tab) : null}>
          <div className="card">
            {tab === 'topic'
              ? topicRows.map((t, i) => (
                  <a key={t.name} className="rank-row" href={`#/topic/${encodeURIComponent(t.name)}`}>
                    <span className={cx('rank-no', i < 3 && `rank-top-${i + 1}`)}>{i + 1}</span>
                    <div className="rank-main">
                      <b>#{t.name}#</b>
                      <small className="muted">{t.authors} 人参与讨论</small>
                    </div>
                    <div className="rank-meta">
                      <b>{formatCount(t.posts)}</b> 条 · {formatCount(t.heat)} 热度
                    </div>
                  </a>
                ))
              : null}

            {tab === 'star'
              ? starRows.map((u, i) => (
                  <a key={u.id} className="rank-row" href={u.id === app.meId ? '#/my' : `#/user/${u.id}`}>
                    <span className={cx('rank-no', i < 3 && `rank-top-${i + 1}`)}>{i + 1}</span>
                    <Avatar emoji={u.emoji} color={u.color} size={40} />
                    <div className="rank-main">
                      <b>{u.name} ✅</b>
                      <small className="muted">{u.bio}</small>
                    </div>
                    <div className="rank-meta">
                      <b>{formatCount(u.followers)}</b> 粉丝
                    </div>
                  </a>
                ))
              : null}

            {tab === 'power'
              ? powerRows.map((r, i) => (
                  <a key={r.u.id} className="rank-row" href={r.u.id === app.meId ? '#/my' : `#/user/${r.u.id}`}>
                    <span className={cx('rank-no', i < 3 && `rank-top-${i + 1}`)}>{i + 1}</span>
                    <Avatar emoji={r.u.emoji} color={r.u.color} size={40} />
                    <div className="rank-main">
                      <b>{nameOf(app.state.users, r.u.id)}</b>
                      <small className="muted">{r.posts} 条动态</small>
                    </div>
                    <div className="rank-meta">
                      <b>{formatCount(r.total)}</b> 互动量
                    </div>
                  </a>
                ))
              : null}
          </div>
        </AsyncState>
      </div>
    </div>
  )
}
