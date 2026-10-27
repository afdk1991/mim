/* ==========================================================================
 * 私信会话 —— 会话列表 + 聊天窗口 + 发送
 *
 * 数据：useApp().state.messages（本机真源）；对方资料取 state.users，
 *      不在本机用户表时显示「用户 <id 前 6 位>」，不编造昵称与头像。
 *
 * 红线：
 *  1. 不伪造已读回执 —— 我们没有云端已读回执通道，自己发出的消息只标「已送达」。
 *  2. 发送前三重守卫（与设置页一致）：黑名单 / 私信已关闭 / 仅允许我关注的人。
 *     隐私与黑名单读自身份域本机存储（app/state/identity），并订阅变更事件，
 *     这样在设置页改动后切回来立刻生效。
 * ======================================================================== */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import type { Message, User } from '@/domain/content/model'
import { subscribe, EVT } from '@/core/events'
import { getBlacklist, getPrivacy } from '@/app/state/identity'
import type { PrivacyState } from '@/domain/identity/model'
import { Avatar, Empty, TimeAgo, useToast } from '@/ui'
import { cx, timeAgo } from '@/core/utils'

const ANON_COLOR = 'var(--bg-soft)'

/** 会话聚合：同一对方的全部消息 + 最后一条 + 未读数 */
interface Conversation {
  userId: string
  msgs: Message[]
  last: Message
  unread: number
}

/** 对方不在本机用户表时的占位（保持头像/昵称可用，但不伪装成真实用户） */
function fallbackUser(id: string): User {
  return {
    id,
    name: `用户 ${id.slice(0, 6)}`,
    emoji: '🙂',
    color: ANON_COLOR,
    bio: '',
    followers: 0,
    following: 0,
    verified: false,
  }
}

export function MessagesPage() {
  const api = useApp()
  const { query, navigate } = useRouter()
  const toast = useToast()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  /* 隐私与黑名单：本机实时读取 + 事件订阅（设置页改动后无需刷新即可生效） */
  const [guard, setGuard] = useState<{ blacklist: string[]; privacy: PrivacyState }>(() => ({
    blacklist: getBlacklist(),
    privacy: getPrivacy(),
  }))
  useEffect(() => subscribe(EVT.identity, () => setGuard({ blacklist: getBlacklist(), privacy: getPrivacy() })), [])

  const { messages, users, following, meId } = api.state
  /* api 每次 state 变化都会换新引用，放进依赖数组会让「读会话 → 状态变更 → 再读」无限循环，
     所以 effect 里统一走 ref 拿最新 api，依赖只保留真正变化的值 */
  const apiRef = useRef(api)
  apiRef.current = api

  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Message[]>()
    for (const m of messages) {
      const arr = map.get(m.userId) ?? []
      arr.push(m)
      map.set(m.userId, arr)
    }
    return [...map.entries()]
      .filter(([userId]) => !guard.blacklist.includes(userId)) // 已拉黑：会话与消息一并屏蔽
      .map(([userId, msgs]) => {
        const sorted = [...msgs].sort((a, b) => a.createdAt - b.createdAt)
        return {
          userId,
          msgs: sorted,
          last: sorted[sorted.length - 1]!,
          unread: sorted.filter((m) => !m.fromMe && !m.read).length,
        }
      })
      .sort((a, b) => b.last.createdAt - a.last.createdAt)
  }, [messages, guard.blacklist])

  const activeId = query.get('with') ?? conversations[0]?.userId ?? ''
  const active = conversations.find((c) => c.userId === activeId) ?? null
  const activeUser = active ? (users.find((u) => u.id === active.userId) ?? fallbackUser(active.userId)) : null
  const count = active?.msgs.length ?? 0

  /* 打开会话即清未读：依赖消息条数，收到新消息时同样会重跑 */
  useEffect(() => {
    if (activeId) apiRef.current.readConversation(activeId)
  }, [activeId, count])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [count, activeId])

  const isFollowing = activeId !== '' && following.includes(activeId)

  /** 发送守卫：命中任一隐私约束即拦截并说明原因，不静默丢弃用户输入 */
  const blockedReason = (): string | null => {
    if (!activeId || !active) return '请先选择一个会话'
    if (guard.blacklist.includes(activeId)) return '已将该用户加入黑名单，无法发送私信'
    if (guard.privacy.dm === 'off') return '你已关闭私信功能，可在「设置 → 隐私设置」重新开启'
    if (guard.privacy.dm === 'following' && !isFollowing) return '你的私信仅允许「我关注的人」，请先关注对方'
    return null
  }

  const reason = blockedReason()

  const send = (): void => {
    const text = input.trim()
    if (!text) return
    const blocked = blockedReason()
    if (blocked) {
      toast(blocked)
      return
    }
    api.sendMessage(activeId, text)
    setInput('')
  }

  return (
    <div className="page">
      <h1 className="page-title">✉️ 私信</h1>

      {conversations.length === 0 ? (
        <Empty emoji="💬" text="还没有任何会话：从用户主页点「私信」开始聊天" />
      ) : (
        <div className="msg-layout">
          <div className="msg-list">
            {conversations.map((c) => {
              const u = users.find((x) => x.id === c.userId) ?? fallbackUser(c.userId)
              return (
                <div
                  key={c.userId}
                  className={cx('msg-item', c.userId === activeId && 'active')}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/messages?with=${c.userId}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/messages?with=${c.userId}`)
                  }}
                >
                  <Avatar emoji={u.emoji} color={u.color} size={40} />
                  <div className="msg-item-main">
                    <b>{u.name}</b>
                    <p>{c.last.content}</p>
                  </div>
                  {c.unread > 0 ? <span className="msg-unread" aria-label={`${c.unread} 条未读`} /> : null}
                </div>
              )
            })}
          </div>

          <div className="msg-thread">
            {active && activeUser ? (
              <>
                <div className="msg-thread-head">
                  <Avatar emoji={activeUser.emoji} color={activeUser.color} size={28} />
                  <b>{activeUser.name}</b>
                  <span className="grow" />
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/user/${activeUser.id}`)}>
                    查看主页
                  </button>
                </div>

                <div className="msg-bubbles">
                  {active.msgs.map((m) => (
                    <div key={m.id} className={cx('bubble-row', m.fromMe && 'me')}>
                      <Avatar
                        emoji={m.fromMe ? '🙂' : activeUser.emoji}
                        color={m.fromMe ? ANON_COLOR : activeUser.color}
                        size={30}
                      />
                      <div className="bubble">{m.content}</div>
                      <span className="bubble-time">
                        {timeAgo(m.createdAt)}
                        {/* 无云端已读通道：只显示「已送达」，绝不伪造对方已读 */}
                        {m.fromMe ? <em className="msg-receipt">已送达</em> : null}
                      </span>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>

                <div className="msg-input-bar">
                  <input
                    className="input"
                    placeholder={reason ? reason : `给 ${activeUser.name} 发送消息…`}
                    value={input}
                    disabled={reason !== null}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') send()
                    }}
                  />
                  <button className="btn btn-primary btn-sm" disabled={!input.trim()} onClick={send}>
                    发送
                  </button>
                </div>
              </>
            ) : (
              <Empty emoji="✉️" text="选择左侧会话开始聊天" />
            )}
          </div>
        </div>
      )}

      {!active && activeId ? (
        <p className="muted" style={{ fontSize: 12 }}>
          会话 <code>{activeId.slice(0, 8)}</code> 暂不可显示（对方可能已被加入黑名单）。
        </p>
      ) : null}

      <p className="muted" style={{ fontSize: 12 }}>
        当前身份：{meId} · 共 {conversations.length} 个会话 · 每条消息下方仅显示「已送达」，不做虚假已读回执
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        最后更新：<TimeAgo ts={conversations[0]?.last.createdAt ?? 0} />
      </p>
    </div>
  )
}
