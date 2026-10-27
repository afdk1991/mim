/* ==========================================================================
 * VideosPage 视频沉浸流 —— 纵向全屏卡片流（scroll-snap 上下滑动切换）
 *
 * 口径：只显示含 video 媒体的动态，且沿用 Feed 的过滤链（快拍 / 仅自己可见 /
 *       黑名单 / 青少年 / 负反馈 / 过期）。
 * 不伪造画面：没有真实片源（media.src 为空）时一律显示海报占位 + 「暂无可播放片源」，
 *       绝不生成假画面或假时长；原实现的占位推流/占位播放器同样无意造假，此处保留其精神。
 * ======================================================================== */

import { useMemo } from 'react'
import { Avatar, Empty, MediaCard } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount } from '@/core/utils'
import { feedFilter } from '@/domain/content/rules'
import { useFirstPaint } from './content-data'
import { useFeedPrefs } from './content-prefs'
import { AsyncState } from './content-parts'
import { CITY_PRESETS, authorOf, nameOf } from './content-lib'

export function VideosPage() {
  const app = useApp()
  const ready = useFirstPaint()
  const prefs = useFeedPrefs(app.meId, CITY_PRESETS[0])

  const vids = useMemo(
    () => app.state.posts.filter((p) => p.media?.kind === 'video' && feedFilter(p, app.meId, prefs.filter)),
    [app.state.posts, app.meId, prefs.filter],
  )
  const noSource = vids.filter((p) => !p.media?.src).length

  return (
    <div className="page-grid single">
      <div>
        <div className="row-between video-head">
          <h2 className="page-title">🎬 视频沉浸流</h2>
          <a className="btn btn-ghost btn-sm" href="#/feed">
            ← 回到广场
          </a>
        </div>
        {vids.length > 0 && noSource > 0 ? (
          <div className="notice-bar">🎞 {noSource} 条视频尚未接入真实片源，当前仅显示海报占位</div>
        ) : null}

        <AsyncState
          loading={!ready}
          skeletonRows={2}
          empty={vids.length === 0 && <Empty emoji="🎬" text="还没有视频动态，去发布一条带视频的内容吧" />}
        >
          <div className="video-scroll">
            {vids.map((p) => {
              const u = authorOf(app.state.users, p.authorId)
              const media = p.media
              return (
                <section key={p.id} className="video-card">
                  <div className="video-screen">
                    {media?.src ? (
                      <video src={media.src} poster={media.poster} controls playsInline />
                    ) : (
                      <button className="video-poster" disabled aria-label="暂无可播放片源">
                        <span>{media?.poster ?? '🎬'}</span>
                        <small>暂无可播放片源</small>
                      </button>
                    )}
                  </div>
                  <div className="video-info">
                    <div className="row">
                      <Avatar emoji={u.emoji} color={u.color} size={30} />
                      <a href={p.authorId === app.meId ? '#/my' : `#/user/${p.authorId}`} className="video-author">
                        {p.authorId === app.meId ? '我的动态' : nameOf(app.state.users, p.authorId)}
                      </a>
                    </div>
                    <p>{p.content}</p>
                    <div className="video-actions">
                      <button className={cx('vf-btn', p.likedByMe && 'active')} onClick={() => app.togglePostLike(p.id)}>
                        {p.likedByMe ? '❤️' : '🤍'} {formatCount(p.likes)}
                      </button>
                      <a className="vf-btn" href={`#/post/${p.id}`}>
                        💬 {formatCount(p.comments.length)}
                      </a>
                      {media && !media.src ? <MediaCard media={media} /> : null}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        </AsyncState>
      </div>
    </div>
  )
}
