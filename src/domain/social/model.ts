/* ==========================================================================
 * 社交域模型 —— 群聊 / 群消息 / 话题签到 / 置顶 / 漫游
 *
 * 不伪造原则：群成员、签到、在线人数一律以本机真实产生的数据为准，
 * 没有真实来源时显示空态，不得预铺随机成员或随机签到记录。
 * ======================================================================== */

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

export interface CheckinState {
  streak: number
  total: number
  /** YYYY-MM-DD（本地时区） */
  lastDate: string
}

export interface SuggestUser {
  id: string
  name: string
  emoji: string
  reason: string
}

export interface RoamSnap {
  at: number
  count: number
  msgs: GroupMessage[]
}

/* ---------- 规则 ---------- */

export const GROUP_NAME_MAX = 20
/** 建群最少成员数（不含自己） */
export const GROUP_MIN_MEMBERS = 2
/** 消息漫游条数范围 */
export const ROAM_KEEP_MIN = 10
export const ROAM_KEEP_MAX = 5000
export const ROAM_KEEP_DEFAULT = 500

export function dayKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 签到连击：昨天签过则 +1，否则重置为 1（同一天重复签到不累加） */
export function nextStreak(prev: CheckinState | undefined, today = dayKey()): { streak: number; total: number } {
  if (!prev) return { streak: 1, total: 1 }
  if (prev.lastDate === today) return { streak: prev.streak, total: prev.total }
  const yesterday = dayKey(Date.now() - 86_400_000)
  return { streak: prev.lastDate === yesterday ? prev.streak + 1 : 1, total: prev.total + 1 }
}

export interface TopicLevel {
  lv: number
  name: string
  /** 距下一级还差多少天 */
  nextGap: number
}

/** 话题等级：按累计签到天数分档 */
export function topicLevel(streak: number, total: number): TopicLevel {
  const score = total + streak * 2
  const table: Array<{ min: number; lv: number; name: string }> = [
    { min: 0, lv: 1, name: '新人' },
    { min: 10, lv: 2, name: '常客' },
    { min: 30, lv: 3, name: '活跃' },
    { min: 80, lv: 4, name: '铁粉' },
    { min: 200, lv: 5, name: '话题达人' },
  ]
  let cur = table[0]!
  let next: (typeof table)[number] | null = null
  for (let i = 0; i < table.length; i += 1) {
    if (score >= table[i]!.min) {
      cur = table[i]!
      next = table[i + 1] ?? null
    }
  }
  return { lv: cur.lv, name: cur.name, nextGap: next ? next.min - score : 0 }
}

/** 话题主持人：指定优先，否则取最早发帖者 */
export function topicHostOf(topic: string, hosts: Record<string, string>, postAuthors: string[]): string | null {
  return hosts[topic] ?? postAuthors[postAuthors.length - 1] ?? null
}

export function groupUnreadOf(reads: Record<string, number>, groupId: string, msgs: GroupMessage[]): number {
  const last = reads[groupId] ?? 0
  return msgs.filter((m) => m.createdAt > last).length
}
