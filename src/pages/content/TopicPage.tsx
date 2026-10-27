/* ==========================================================================
 * TopicPage 话题页 —— 话题下的动态流（最新 / 最热，置顶优先）+ 签到 + 参与者
 *
 * 话题数据：由动态 topic 字段派生（无独立的云端话题集合），见 content-lib。
 * 排序：最新 / 最热都走 rules.sortTopic —— 置顶帖永远排最前，其余按各自口径排。
 * 签到：连击口径走 social 域的 nextStreak（昨天签过才 +1），等级走 topicLevel，
 *       落本机 mim.content.<uid>.checkin 并按 EVT.social 广播刷新。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import { Avatar, Empty, useToast } from '@/ui'
import { PostCard } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx, formatCount } from '@/core/utils'
import { feedFilter, sortTopic } from '@/domain/content/rules'
import { topicLevel } from '@/domain/social/model'
import { useFirstPaint } from './content-data'
import { useFeedPrefs, useTopicCheckin } from './content-prefs'
import {
  CITY_PRESETS,
  authorOf,
  sortTopics,
  topicsFromPosts,
  userNameResolver,
} from './content-lib'
import { AsyncState } from './content-parts'

export interface TopicPageProps {
  name: string
}

export function TopicPage({ name }: TopicPageProps) {
  const app = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const ready = useFirstPaint()
  const prefs = useFeedPrefs(app.meId, CITY_PRESETS[0])
  const checkin = useTopicCheckin(app.meId)
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')

  const users = app.state.users
  const posts = useMemo(
    () => app.state.posts.filter((p) => p.topic === name && feedFilter(p, app.meId, prefs.filter)),
    [app.state.posts, app.meId, prefs.filter, name],
  )
  const list = useMemo(() => sortTopic(posts, sort), [posts, sort])
  const authors = useMemo(() => Array.from(new Set(posts.map((p) => p.authorId))), [posts])
  const related = useMemo(
    () => sortTopics(topicsFromPosts(app.state.posts), 'posts').filter((t) => t.name !== name).slice(0, 8),
    [app.state.posts, name],
  )

  const checkedToday = checkin.checkedOf(name)
  const state = checkin.stateOf(name)
  const level = state ? topicLevel(state.streak, state.total) : null

  return (
    <div className="page-grid single">
      <div>
        <div className="card topic-head">
          <h2 className="page-title">#{name}#</h2>
          <p className="muted">
            {posts.length} 条讨论 · {authors.length} 人参与 · {formatCount(list.reduce((s, p) => s + p.likes, 0))} 次点赞
          </p>
          <div className="row wrap">
            <button
              className={cx('btn btn-sm', checkedToday ? 'btn-ghost' : 'btn-primary')}
              disabled={checkedToday}
              onClick={() => {
                const r = checkin.checkin(name)
                const lv = topicLevel(r.streak, r.total)
                toast(`签到成功 · Lv${lv.lv} ${lv.name}${lv.nextGap > 0 ? `（再累计 ${lv.nextGap} 分升级）` : '（已达最高等级）'}`)
              }}
            >
              {checkedToday ? '✅ 今日已签到' : '📅 签到'}
            </button>
            {level ? <span className="tag">Lv{level.lv} {level.name}</span> : null}
            {state ? (
              <small className="muted">
                连续 {state.streak} 天 · 累计 {state.total} 天
              </small>
            ) : null}
          </div>
        </div>

        {authors.length > 0 ? (
          <div className="card">
            <h3 className="section-title">👥 {authors.length} 人参与讨论</h3>
            <div className="avatar-wall">
              {authors.map((uid) => {
                const u = authorOf(users, uid)
                return (
                  <a key={uid} href={uid === app.meId ? '#/my' : `#/user/${uid}`} title={u.name}>
                    <Avatar emoji={u.emoji} color={u.color} size={40} />
                  </a>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="tabs">
          <button className={cx('tab-btn', sort === 'latest' && 'active')} onClick={() => setSort('latest')}>
            🕐 最新
          </button>
          <button className={cx('tab-btn', sort === 'hot' && 'active')} onClick={() => setSort('hot')}>
            🔥 最热
          </button>
          <span className="grow" />
          <a className="btn btn-ghost btn-sm tab-link" href="#/topics">
            超话排行 »
          </a>
        </div>

        <AsyncState
          loading={!ready}
          empty={list.length === 0 && <Empty emoji="💭" text="这个话题下还没有讨论，快去发布第一条带 #话题# 的动态" />}
        >
          {list.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              author={authorOf(users, p.authorId)}
              viewerId={app.meId}
              onOpen={() => navigate(`/post/${p.id}`)}
              onComment={() => navigate(`/post/${p.id}`)}
              onToggleLike={() => app.togglePostLike(p.id)}
              onDelete={p.authorId === app.meId ? () => app.deletePost(p.id) : undefined}
              onUser={(id) => navigate(id === app.meId ? '/my' : `/user/${id}`)}
              onTopic={(t) => navigate(`/topic/${encodeURIComponent(t)}`)}
              resolveUser={userNameResolver(users)}
            />
          ))}
        </AsyncState>

        {related.length > 0 ? (
          <div className="card">
            <h3 className="section-title">🔀 相关话题</h3>
            <div className="chip-row">
              {related.map((t) => (
                <a key={t.name} className="chip" href={`#/topic/${encodeURIComponent(t.name)}`}>
                  #{t.name}# · {t.posts} 条
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
