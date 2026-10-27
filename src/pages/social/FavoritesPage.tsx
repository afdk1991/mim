/* ==========================================================================
 * 收藏夹 —— 收藏的动态 / 文章，分两个 Tab
 *
 * 数据：useApp().state.favorites 只存 {kind, targetId}，正文要从 posts / articles
 *      反查。反查不到（内容已删除或未同步到本机）时如实提示「已不可读」并给
 *      取消收藏入口，避免收藏夹里出现永远打不开的僵尸条目。
 * ======================================================================== */

import { useState } from 'react'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import type { FavoriteKind, User } from '@/domain/content/model'
import { ArticleCard, Empty, PostCard, TimeAgo, useToast } from '@/ui'
import { recordView } from './HistoryPage'
import { cx, ellipsis } from '@/core/utils'

interface TabDef {
  key: FavoriteKind
  label: string
  icon: string
}

const TABS: TabDef[] = [
  { key: 'post', label: '动态', icon: '⭐' },
  { key: 'article', label: '文章', icon: '📄' },
]

/** 收藏作者在用户表缺失时的占位（不用假昵称顶替） */
const UNKNOWN: User = {
  id: '',
  name: '未知作者',
  emoji: '🙂',
  color: 'var(--bg-soft)',
  bio: '',
  followers: 0,
  following: 0,
  verified: false,
}

export function FavoritesPage() {
  const api = useApp()
  const { navigate } = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<FavoriteKind>('post')

  const { favorites, posts, articles, users, meId } = api.state

  const favs = favorites.filter((f) => f.type === tab)
  const missing = favs.filter((f) =>
    tab === 'post'
      ? !posts.some((p) => p.id === f.targetId)
      : !articles.some((a) => a.id === f.targetId),
  )

  const authorOf = (id: string): User => users.find((u) => u.id === id) ?? UNKNOWN

  const countOf = (kind: FavoriteKind): number => favorites.filter((f) => f.type === kind).length

  const drop = (targetId: string): void => {
    api.toggleFavorite(tab, targetId)
    toast('已取消收藏')
  }

  return (
    <div className="page">
      <h1 className="page-title">⭐ 我的收藏</h1>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}（{countOf(t.key)}）
          </button>
        ))}
      </div>

      {missing.length > 0 ? (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <b>⚠ {missing.length} 条收藏已不可读</b>
          <p className="muted" style={{ margin: '6px 0 10px', fontSize: 12 }}>
            对应内容已被删除或尚未同步到本机，可选择清理。
          </p>
          <div className="row wrap">
            {missing.map((f) => (
              <button key={f.id} className="btn btn-ghost btn-sm" onClick={() => drop(f.targetId)}>
                ✕ 清理 {f.targetId.slice(0, 6)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {favs.length === 0 ? (
        <Empty
          emoji={tab === 'post' ? '⭐' : '📄'}
          text={tab === 'post' ? '还没有收藏动态，在动态左下角点 ⭐ 收藏试试' : '还没有收藏文章，读文章时点右上角收藏吧'}
        />
      ) : null}

      {tab === 'post'
        ? favs.map((f) => {
            const p = posts.find((x) => x.id === f.targetId)
            if (!p) return null
            const author = authorOf(p.authorId)
            return (
              <PostCard
                key={f.id}
                post={p}
                author={author}
                viewerId={meId}
                onToggleLike={() => api.togglePostLike(p.id)}
                onOpen={() => {
                  // 从收藏打开即视为一次浏览，写入本机足迹（键 mim.history）
                  recordView('post', p.id)
                  navigate(`/post/${p.id}`)
                }}
                onUser={(id) => navigate(`/user/${id}`)}
                onTopic={(name) => navigate(`/topic/${encodeURIComponent(name)}`)}
              />
            )
          })
        : favs.map((f) => {
            const a = articles.find((x) => x.id === f.targetId)
            if (!a) return null
            return (
              <div key={f.id} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <div className="grow">
                  <ArticleCard
                    article={a}
                    author={authorOf(a.authorId)}
                    onOpen={() => {
                      recordView('article', a.id)
                      navigate(`/article/${a.id}`)
                    }}
                  />
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => drop(a.id)} title="取消收藏">
                  ✕
                </button>
              </div>
            )
          })}

      {favs.length > 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>
          共 {favs.length} 条{tab === 'post' ? '动态' : '文章'}收藏 · 最近收藏：
          <TimeAgo ts={favs.reduce((m, f) => Math.max(m, f.createdAt), 0)} />
        </p>
      ) : null}

      <p className="muted" style={{ fontSize: 12 }}>
        收藏按当前身份隔离存放：{ellipsis(meId, 12)}；换设备需等云端同步完成后才会出现。
      </p>
    </div>
  )
}
