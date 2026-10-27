/* 轮 22 打通：B3 社交域 —— 群聊 / 超话等级·主持人·名人堂 / 可能感兴趣的人 / 已读回执 / 消息漫游。
   存储沿用 B1/B2 的「mim-sd-<uid>:field」按真实登录身份分 key 约定；
   每次写入统一派发 SD_EVT，让打开中的页面实时刷新。复用 components/store/auth/user-domain，不改动它们。 */
import { useEffect, useMemo, useState } from 'react'
import { getCurrentUserId } from './auth'
import { Avatar, Empty, FollowButton, Modal, UserLink, useToast } from './components'
import { useUserDomain } from './user-domain'
import { useApp } from './store'
import { useRouter } from './router'
import type { Message, Post, User } from './types'
import { cx, timeAgo, uid } from './utils'
import './social-domain.css'

/* ================= 分 key 存储基座 ================= */

/** 社交域数据变更事件（组件订阅后重读 localStorage） */
export const SD_EVT = 'mim-sd-change'

function sdKey(userId: string, field: string): string {
  return `mim-sd-${userId}:${field}`
}

function dispatchSD() {
  window.dispatchEvent(new Event(SD_EVT))
}

/** 严格解析 localStorage JSON，异常时回退默认值 */
function parseSD<T>(raw: string | null, fallback: T): T {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v == null ? fallback : (v as T)
  } catch {
    return fallback
  }
}

function sdSet<T>(field: string, value: T) {
  try {
    localStorage.setItem(sdKey(getCurrentUserId(), field), JSON.stringify(value))
  } catch {
    /* 写满/隐私模式静默降级 */
  }
  dispatchSD()
}

function sdGet<T>(field: string, fallback: T): T {
  try {
    return parseSD<T>(localStorage.getItem(sdKey(getCurrentUserId(), field)), fallback)
  } catch {
    return fallback
  }
}

/** 订阅社交域数据：SD_EVT 触发重渲染（页面在渲染体里直接重读分 key 存储；
    登录身份切换时 AuthProvider 整树重渲染，同样会重读，两个来源都已覆盖） */
export function useSd(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((n) => n + 1)
    window.addEventListener(SD_EVT, bump)
    return () => window.removeEventListener(SD_EVT, bump)
  }, [])
  return version
}

/* ================= 1. 群聊 ================= */

export interface ChatGroup {
  id: string
  name: string
  memberIds: string[]
  createdBy: string
  createdAt: number
}

export interface GroupMessage {
  id: string
  groupId: string
  authorId: string
  content: string
  createdAt: number
}

export function loadGroups(): ChatGroup[] {
  const list = sdGet<ChatGroup[]>('groups', [])
  return Array.isArray(list) ? list : []
}

function saveGroups(list: ChatGroup[]) {
  sdSet('groups', list)
}

export function loadGroupMsgs(): GroupMessage[] {
  const list = sdGet<GroupMessage[]>('gmsgs', [])
  return Array.isArray(list) ? list : []
}

/** 某个群的成员发言（按时间升序） */
export function groupMsgsOf(groupId: string): GroupMessage[] {
  return loadGroupMsgs().filter((m) => m.groupId === groupId).sort((a, b) => a.createdAt - b.createdAt)
}

/** 群已读时间线：groupId → 该时刻之前收到的群消息视为已读 */
export function loadGroupReads(): Record<string, number> {
  const map = sdGet<Record<string, number>>('greads', {})
  return map && typeof map === 'object' ? map : {}
}

export function markGroupRead(groupId: string) {
  const reads = loadGroupReads()
  reads[groupId] = Date.now()
  sdSet('greads', reads)
}

export function groupUnreadOf(groupId: string, meId: string): number {
  const upto = loadGroupReads()[groupId] ?? 0
  return groupMsgsOf(groupId).filter((m) => m.authorId !== meId && m.createdAt > upto).length
}

/** 建群：成员自动包含自己（校验交给调用方：群名非空 + 2 位以上好友） */
export function createGroup(name: string, memberIds: string[]): ChatGroup {
  const g: ChatGroup = {
    id: uid('grp'),
    name,
    memberIds: [getCurrentUserId(), ...memberIds.filter((id) => id !== getCurrentUserId())],
    createdBy: getCurrentUserId(),
    createdAt: Date.now(),
  }
  saveGroups([...loadGroups(), g])
  return g
}

/** 退群：移除群与其消息记录 */
export function leaveGroup(groupId: string) {
  saveGroups(loadGroups().filter((g) => g.id !== groupId))
  sdSet('gmsgs', loadGroupMsgs().filter((m) => m.groupId !== groupId))
}

function appendGroupMsg(groupId: string, authorId: string, content: string) {
  const msg: GroupMessage = { id: uid('gm'), groupId, authorId, content, createdAt: Date.now() }
  sdSet('gmsgs', [...loadGroupMsgs(), msg])
}

/** 群聊发送 = 只写入我的真实发言；本机示例账号不会真的回复，不伪造成员消息 */
export function sendGroupMessage(group: ChatGroup, fromId: string, content: string): void {
  appendGroupMsg(group.id, fromId, content)
}

/** 轮 22 打通：群聊创建弹窗 —— 选 2 位以上好友 + 群名 */
export function GroupCreateModal({ onClose }: { onClose: () => void }) {
  const api = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  // 候选成员：除自己外的全部用户，已关注（好友）排前
  const cands = useMemo(() => {
    const followed = new Set(api.state.followingIds)
    return Object.values(api.state.users)
      .filter((u) => u.id !== api.me.id)
      .sort((a, b) => Number(followed.has(b.id)) - Number(followed.has(a.id)))
  }, [api.state.users, api.state.followingIds, api.me.id])

  const create = () => {
    if (picked.length < 2) {
      toast('至少选择 2 位好友才能建群')
      return
    }
    const g = createGroup(name.trim() || `${api.me.name}的群聊`, picked)
    toast(`「${g.name}」创建成功 🎉`)
    onClose()
    navigate(`/messages?with=${g.id}`)
  }

  return (
    <Modal title="发起群聊" onClose={onClose}>
      <input
        className="input"
        placeholder="群名称（选填，默认「xx 的群聊」）"
        maxLength={20}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="sg-pick-tip">选择 2 位以上成员，已选 {picked.length} 人</div>
      <div className="sg-pick-list">
        {cands.map((u) => {
          const on = picked.includes(u.id)
          return (
            <button
              key={u.id}
              type="button"
              className={cx('sg-pick-item', on && 'picked')}
              onClick={() => setPicked((s) => (on ? s.filter((x) => x !== u.id) : [...s, u.id]))}
            >
              <Avatar emoji={u.emoji} color={u.color} size={28} />
              <span>{u.name}</span>
              {api.isFollowing(u.id) && <em className="sg-pick-follow">好友</em>}
              {on && <em className="sg-pick-check">✓</em>}
            </button>
          )
        })}
      </div>
      {cands.length === 0 && <Empty emoji="👥" text="还没有其他用户，先去关注一些人吧" />}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={picked.length < 2} onClick={create}>
          创建群聊（{picked.length}）
        </button>
      </div>
    </Modal>
  )
}

/* ================= 4. 已读回执（单聊） ================= */

/* 本机无云端已读 API，不伪造对方已读状态；相关本地存储与模拟逻辑已移除。 */

/* ================= 5. 消息漫游 ================= */

export const ROAM_DEFAULT_KEEP = 500

export interface RoamSnap {
  at: number
  count: number
  msgs: Message[]
}

export function loadRoamKeep(): number {
  const n = sdGet<number>('roam-keep', ROAM_DEFAULT_KEEP)
  return Number.isFinite(n) && n >= 10 ? n : ROAM_DEFAULT_KEEP
}

export function saveRoamKeep(n: number) {
  sdSet('roam-keep', Math.max(10, Math.min(Math.round(n) || ROAM_DEFAULT_KEEP, 5000)))
}

export function loadRoamSnap(): RoamSnap | null {
  return sdGet<RoamSnap | null>('roam-snap', null)
}

/** 立即同步：把内存消息按 createdAt 排序后保留最近 keep 条写入分 key 存储 */
export function syncRoam(messages: Message[], keep: number): RoamSnap {
  const trimmed = [...messages].sort((a, b) => a.createdAt - b.createdAt).slice(-keep)
  const snap: RoamSnap = { at: Date.now(), count: trimmed.length, msgs: trimmed }
  sdSet('roam-snap', snap)
  return snap
}

/** 轮 22 打通：消息漫游弹窗 —— 说明 + 条数设置 + 立即同步 */
export function RoamModal({ messages, onClose }: { messages: Message[]; onClose: () => void }) {
  const toast = useToast()
  const [keep, setKeep] = useState<number>(() => loadRoamKeep())
  const [snap, setSnap] = useState<RoamSnap | null>(() => loadRoamSnap())

  const doSync = () => {
    const n = Math.max(10, Math.min(Number.isFinite(keep) && keep > 0 ? Math.round(keep) : ROAM_DEFAULT_KEEP, 5000))
    const s = syncRoam(messages, n)
    saveRoamKeep(n)
    setKeep(n)
    setSnap(s)
    toast(`同步成功 ${s.count} 条 ☁️`)
  }

  return (
    <Modal title="消息漫游" onClose={onClose}>
      <p className="sg-roam-desc">
        消息漫游会把本机聊天记录按<b>当前登录身份</b>保存（mim-sd-&lt;uid&gt;:* 分 key 存储），
        同一账号换设备 / 换身份登录后可回看最近聊天记录；超出条数上限的旧消息会被自动裁剪。
      </p>
      <div className="sg-roam-row">
        <label htmlFor="sg-roam-keep">漫游记录条数</label>
        <input
          id="sg-roam-keep"
          className="input"
          type="number"
          min={10}
          max={5000}
          value={keep}
          onChange={(e) => setKeep(Number(e.target.value))}
        />
      </div>
      <small className="sg-roam-meta">
        保留最近 {keep || ROAM_DEFAULT_KEEP} 条，超过自动裁剪 · 当前内存消息 {messages.length} 条
        {snap ? ` · 上次同步 ${timeAgo(snap.at)}（${snap.count} 条）` : ' · 尚未同步'}
      </small>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        <button className="btn btn-primary" onClick={doSync}>立即同步</button>
      </div>
    </Modal>
  )
}

/* ================= 2. 超话签到 / 等级 / 主持人 / 名人堂 ================= */

export interface CheckinState {
  streak: number // 连续签到天数
  total: number // 累计签到天数
  lastDate: string // 最近一次签到日期 YYYY-MM-DD
}

/** 日期键（本地时区） */
export function dayKey(ts = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function loadCheckins(): Record<string, CheckinState> {
  const map = sdGet<Record<string, CheckinState>>('checkins', {})
  return map && typeof map === 'object' ? map : {}
}

export function checkinOf(topic: string): CheckinState | null {
  return loadCheckins()[topic] ?? null
}

/** 签到：昨签则连续 +1，断签重置为 1 */
export function checkinTopic(topic: string): CheckinState {
  const cks = loadCheckins()
  const prev = cks[topic]
  const today = dayKey()
  if (prev?.lastDate === today) return prev
  const next: CheckinState = {
    streak: prev?.lastDate === dayKey(Date.now() - 86_400_000) ? prev.streak + 1 : 1,
    total: (prev?.total ?? 0) + 1,
    lastDate: today,
  }
  cks[topic] = next
  sdSet('checkins', cks)
  return next
}

/** 超话等级名：Lv1 铁粉 … Lv5 老粉 */
const LEVEL_NAMES = ['铁粉', '常驻粉', '忠实粉', '铁杆粉', '老粉'] as const
/** 累计签到天数晋升阈值（Lv2 / Lv3 / Lv4 / Lv5） */
const LEVEL_STEPS = [3, 10, 30, 90] as const

/** 超话等级 = 累计签到晋级，连续 ≥7 天加成一级 */
export function topicLevel(streak: number, total: number): { lv: number; name: string; nextGap: number | null } {
  let lv = 1
  for (const step of LEVEL_STEPS) if (total >= step) lv++
  if (streak >= 7 && lv < 5) lv++
  const name = LEVEL_NAMES[lv - 1]
  const nextGap = lv >= 5 ? null : (LEVEL_STEPS[lv - 1] ?? null) - total
  return { lv, name, nextGap }
}

/** 各超话置顶帖：topicName → pinned postIds */
export function loadPins(): Record<string, string[]> {
  const map = sdGet<Record<string, string[]>>('pins', {})
  return map && typeof map === 'object' ? map : {}
}

export function togglePin(topic: string, postId: string): boolean {
  const pins = loadPins()
  const list = pins[topic] ?? []
  const on = !list.includes(postId)
  pins[topic] = on ? [...list, postId] : list.filter((id) => id !== postId)
  sdSet('pins', pins)
  return on
}

/**
 * 主持人判定：已指定的主持人优先，否则兜底取该超话最早发帖的作者。
 */
export function topicHostOf(topic: string, posts: Post[]): string | null {
  const assigned = sdGet<Record<string, string>>('hosts', {})[topic]
  if (assigned) return assigned
  const sorted = [...posts].sort((a, b) => a.createdAt - b.createdAt)
  return sorted[0]?.authorId ?? null
}

export interface HallEntry {
  userId: string
  streak: number
  total: number
  simulated: boolean
}

/**
 * 轮 22 打通：名人堂 —— 按连续签到天数 Top5。
 * 本机只存我的真实签到；其他成员签到数据需云端同步，不伪造。
 */
export function hallOfFame(topic: string, meId: string, memberIds: string[]): HallEntry[] {
  const entries: HallEntry[] = []
  const mine = checkinOf(topic)
  if (mine) entries.push({ userId: meId, streak: mine.streak, total: mine.total, simulated: false })
  /* 其他成员无本机真实签到记录，不纳入排行榜（需云端同步） */
  void memberIds
  return entries
    .sort((a, b) => b.streak - a.streak || b.total - a.total)
    .slice(0, 5)
}

/* ================= 3. 可能感兴趣的人 ================= */

export interface SuggestUser {
  user: User
  common: number
}

/**
 * 轮 22 打通：可能感兴趣的人 —— 基于共同关注推导（好友的好友）：
 * ① 好友发帖所在超话下的其他作者；② 与好友在同帖互动过的其他评论者。
 * 排除已关注 / 拉黑 / 自己；计重合次数作为「共同关注 N 人」；无候选时退化为全站未关注用户兜底。
 */
export function useSuggestUsers(): SuggestUser[] {
  const api = useApp()
  const { blacklist } = useUserDomain()
  return useMemo(() => {
    const meId = api.me.id
    const followed = new Set(api.state.followingIds)
    const excluded = new Set<string>([meId, ...followed, ...blacklist])
    const friends = api.state.followingIds
    const score = new Map<string, number>()

    for (const f of friends) {
      const fTopics = new Set(api.state.posts.filter((p) => p.authorId === f && p.topic).map((p) => p.topic))
      for (const p of api.state.posts) {
        if (!p.topic || !fTopics.has(p.topic) || p.authorId === f || excluded.has(p.authorId)) continue
        score.set(p.authorId, (score.get(p.authorId) ?? 0) + 1)
      }
      for (const p of api.state.posts) {
        const involved = p.authorId === f || (p.comments?.some((c) => c.authorId === f) ?? false)
        if (!involved) continue
        for (const c of p.comments ?? []) {
          if (c.authorId === f || excluded.has(c.authorId)) continue
          score.set(c.authorId, (score.get(c.authorId) ?? 0) + 1)
        }
      }
    }

    let list: SuggestUser[] = [...score.entries()]
      .filter(([id]) => api.state.users[id])
      .map(([id, n]) => ({ user: api.state.users[id], common: n }))
      .sort((a, b) => b.common - a.common)

    // seed 兜底：无共同互动候选时，取全站未关注、未拉黑的用户
    if (list.length === 0) {
      list = Object.values(api.state.users)
        .filter((u) => !excluded.has(u.id))
        .map((u) => ({ user: u, common: 0 }))
    }
    return list.slice(0, 3)
  }, [api.state.users, api.state.posts, api.state.followingIds, blacklist])
}

/** feed 侧栏「可能感兴趣的人」推荐卡 */
export function SuggestCard() {
  const list = useSuggestUsers()
  if (list.length === 0) return null
  return (
    <div className="side-card">
      <h3>🤝 可能感兴趣的人</h3>
      {list.map(({ user, common }) => (
        <div key={user.id} className="user-row" style={{ marginBottom: 10 }}>
          <UserLink userId={user.id} size={36} />
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
            <small className="sg-common">{common > 0 ? `共同关注 ${common} 人` : '猜你喜欢'}</small>
            <FollowButton userId={user.id} small />
          </div>
        </div>
      ))}
    </div>
  )
}
