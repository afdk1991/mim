/* ==========================================================================
 * 通知中心 —— 赞 / 评论 / 转发 / 关注 / @我 五类通知
 *
 * 数据：useApp().state.notifications（本机真源，云端补写由状态层负责）。
 * 交互：单条点击 = 标记已读 + 跳原文；「全部已读」一次性清空角标。
 *
 * 坑（原实现就有）：必须先 read 再 navigate，否则从详情页返回时角标还亮着，
 *     用户会以为「点了没生效」。此处顺序写死，不要调换。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import type { AppNotification, NotificationType, User } from '@/domain/content/model'
import { Empty, TimeAgo, useToast } from '@/ui'
import { cx, formatCount } from '@/core/utils'

interface TabDef {
  key: NotificationType | 'all'
  label: string
  icon: string
}

const TABS: TabDef[] = [
  { key: 'all', label: '全部', icon: '🔔' },
  { key: 'like', label: '赞', icon: '❤️' },
  { key: 'comment', label: '评论', icon: '💬' },
  { key: 'repost', label: '转发', icon: '🔁' },
  { key: 'follow', label: '关注', icon: '👤' },
  { key: 'mention', label: '@我', icon: '📢' },
]

const ICON_OF: Record<NotificationType, string> = {
  like: '❤️',
  comment: '💬',
  repost: '🔁',
  follow: '👤',
  mention: '📢',
}

/** 兜底作者：对方不在本机用户表（未同步到本机）时如实显示「某用户」，不编造昵称 */
const UNKNOWN: User = {
  id: '',
  name: '某用户',
  emoji: '🙂',
  color: 'var(--bg-soft)',
  bio: '',
  followers: 0,
  following: 0,
  verified: false,
}

const EMPTY_TEXT: Record<NotificationType | 'all', string> = {
  all: '暂时没有新通知，去广场发条动态吧',
  like: '还没有人给你点赞',
  comment: '还没有人评论你的内容',
  repost: '还没有人转发你的动态',
  follow: '还没有新粉丝，去关注感兴趣的人吧',
  mention: '还没有人 @ 你',
}

export function NotificationsPage() {
  const api = useApp()
  const { navigate } = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<NotificationType | 'all'>('all')

  const { notifications, users } = api.state

  const unread = notifications.filter((n) => !n.read).length
  const list = useMemo(
    () => (tab === 'all' ? notifications : notifications.filter((n) => n.type === tab)),
    [notifications, tab],
  )

  const authorOf = (id: string): User => users.find((u) => u.id === id) ?? UNKNOWN

  const open = (n: AppNotification): void => {
    if (!n.read) api.readNotification(n.id)
    if (n.postId) navigate(`/post/${n.postId}`)
  }

  const readAll = (): void => {
    if (unread === 0) return
    api.readAllNotifications()
    toast('已将全部通知标记为已读')
  }

  return (
    <div className="page">
      <h1 className="page-title">🔔 通知 {unread > 0 ? <span className="tag">{unread} 未读</span> : null}</h1>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
        <span className="grow" />
        <button className="btn btn-ghost btn-sm" disabled={unread === 0} onClick={readAll}>
          全部已读
        </button>
      </div>

      {list.length === 0 ? (
        <Empty emoji="🔔" text={EMPTY_TEXT[tab]} />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {list.map((n) => {
            const u = authorOf(n.fromUserId)
            return (
              <div
                key={n.id}
                className={cx('notif-row', !n.read && 'unread')}
                role="button"
                tabIndex={0}
                onClick={() => open(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') open(n)
                }}
              >
                <span className="notif-icon">{ICON_OF[n.type] ?? '🔔'}</span>
                <div className="notif-body">
                  <p style={{ margin: 0 }}>
                    <b style={{ color: 'var(--primary)' }}>{u.name}</b> {n.content}
                  </p>
                  <small className="muted">
                    <TimeAgo ts={n.createdAt} />
                    {n.postId ? ' · 点击查看原文' : ''}
                  </small>
                </div>
                {!n.read ? <span className="notif-dot" aria-label="未读" /> : null}
              </div>
            )
          })}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        共 {formatCount(notifications.length)} 条通知 · 未读 {formatCount(unread)} 条
      </p>
    </div>
  )
}
