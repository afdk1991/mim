/* ==========================================================================
 * TopicRankPage 超话排行榜 —— 按话题真实讨论量 / 互动热度排序
 *
 * 排序口径与原榜单页一致：讨论数为主序、互动热度为次序（没有独立热度字段可依赖，
 * 热度由该话题下动态的赞+转×2+评×3 求和派生）。空数据时不预铺示例榜。
 * ======================================================================== */

import { useMemo } from 'react'
import { Empty } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount } from '@/core/utils'
import { feedFilter } from '@/domain/content/rules'
import { useFirstPaint } from './content-data'
import { useFeedPrefs } from './content-prefs'
import { AsyncState } from './content-parts'
import { CITY_PRESETS, sortTopics, topicsFromPosts } from './content-lib'

export function TopicRankPage() {
  const app = useApp()
  const ready = useFirstPaint()
  const prefs = useFeedPrefs(app.meId, CITY_PRESETS[0])

  const rows = useMemo(() => {
    const visible = app.state.posts.filter((p) => feedFilter(p, app.meId, prefs.filter))
    return sortTopics(topicsFromPosts(visible), 'posts')
  }, [app.state.posts, app.meId, prefs.filter])

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🔥 超话排行榜</h2>
        <AsyncState
          loading={!ready}
          empty={rows.length === 0 && <Empty emoji="💬" text="还没有超话，发布一条带 #话题# 的动态即可上榜" />}
          skeletonRows={4}
        >
          <div className="card">
            {rows.map((t, i) => (
              <a key={t.name} className={cx('rank-row', i < 3 && 'top')} href={`#/topic/${encodeURIComponent(t.name)}`}>
                <span className={cx('rank-no', i < 3 && `rank-top-${i + 1}`)}>{i + 1}</span>
                <div className="rank-main">
                  <b>#{t.name}#</b>
                  <small className="muted">{t.authors} 人参与 · 最近更新 {Math.round((Date.now() - t.lastAt) / 86400000)} 天前</small>
                </div>
                <div className="rank-meta">
                  <b>{formatCount(t.posts)}</b> 条讨论 · {formatCount(t.heat)} 热度
                </div>
              </a>
            ))}
          </div>
        </AsyncState>
      </div>
    </div>
  )
}
