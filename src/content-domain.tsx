/* 轮 21 打通：B2 内容域共享层——敏感词前置词库、位置/海报预设、可见性判定、定时发布队列（按真实登录身份分 key）。
   定时队列沿用 user-domain 的「mim-<域>-<uid>:field」分 key 约定（其工具未导出，此处按同款模式实现，不改动 user-domain.tsx）。 */
import { useEffect, useRef } from 'react'
import { getCurrentUserId } from './auth'
import { emitToast } from './components'
import { useApp } from './store'
import type { Post, PostLottery, PostMedia, PostVote } from './types'
import { uid } from './utils'

/* ---------- 9. 敏感词前置（发布侧词库检测，占位词库） ---------- */
export const SENSITIVE_WORDS = [
  '加微信',
  '免费领取',
  '点击链接',
  '私下转账',
  '博彩',
  '代开发票',
  '兼职刷单',
  '高仿表',
  '游戏外挂',
  '私聊购买',
  '色情',
  '网络赌博',
  '贷款秒批',
  '代办证件',
  '僵尸粉',
]

/** 返回正文中命中的敏感词列表（顺序与词库一致） */
export function findSensitiveHits(text: string): string[] {
  return SENSITIVE_WORDS.filter((w) => text.includes(w))
}

/* ---------- 预设：发布位置 10 个、视频 emoji 海报 10 个 ---------- */
export const LOCATION_PRESETS = [
  '北京市 · 三里屯',
  '上海市 · 外滩',
  '广州市 · 珠江新城',
  '深圳市 · 深南大道',
  '杭州市 · 西湖',
  '成都市 · 春熙路',
  '武汉市 · 江汉路',
  '西安市 · 大雁塔',
  '南京市 · 夫子庙',
  '厦门市 · 鼓浪屿',
]

export const VIDEO_POSTERS = ['🎬', '🎞️', '📼', '🌄', '🏙️', '🐱', '🎵', '⚽', '🍜', '🚀']

/** 轮 21 打通：快拍有效期 24 小时 */
export const STORY_TTL = 24 * 60 * 60 * 1000

/* ---------- 8. 可见性判定：visibility='self' 时仅作者本人可见（各 feed 流共用；
   与 B1 账号级隐私的「取更严者」在发布侧落地，见 publish.tsx 的 effVisibility） ---------- */
export function postVisibleTo(p: Post, viewerId: string): boolean {
  return p.visibility !== 'self' || p.authorId === viewerId
}

/* ---------- 5. 定时发布队列（localStorage 按身份分 key） ---------- */

/** 随队列暂存的发布参数：到点原样透传给现有 publishPost api */
export type ScheduleExtra = {
  topic: string | null
  images: string[]
  media?: PostMedia
  vote?: PostVote
  lottery?: PostLottery
  location?: string
  visibility?: 'public' | 'self'
  story?: boolean
  expiresAt?: number
}

export interface ScheduleItem extends ScheduleExtra {
  id: string
  /** 计划发出的时间戳 */
  at: number
  content: string
}

const schedKey = (userId: string) => `mim-cd-${userId}:scheduled`

/** 队列变更事件：轮询发出 / 页面取消后广播，让打开中的发布器实时刷新 */
export const SCHED_EVT = 'mim-cd-sched-change'

function parseSchedule(raw: string | null): ScheduleItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as ScheduleItem[]) : []
  } catch {
    return []
  }
}

export function loadSchedule(userId = getCurrentUserId()): ScheduleItem[] {
  try {
    return parseSchedule(localStorage.getItem(schedKey(userId)))
  } catch {
    return []
  }
}

function writeSchedule(list: ScheduleItem[], userId = getCurrentUserId()): void {
  try {
    localStorage.setItem(schedKey(userId), JSON.stringify(list))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(SCHED_EVT))
}

/** 入队（id 自动生成），按计划时间正序 */
export function enqueueSchedule(item: Omit<ScheduleItem, 'id'>): void {
  const list = [...loadSchedule(), { ...item, id: uid('sch') }]
  list.sort((a, b) => a.at - b.at)
  writeSchedule(list)
}

/** 取消一条定时发布 */
export function cancelSchedule(id: string): void {
  writeSchedule(loadSchedule().filter((x) => x.id !== id))
}

/* ---------- 5. App 级轮询：挂载即检 + 每 30s 一轮，到点经现有 publishPost api 入库 ---------- */
export function ScheduledTicker(): null {
  const api = useApp()
  // ref 持有最新 api：避免 api 随 state 变化反复重置 interval
  const apiRef = useRef(api)
  apiRef.current = api
  useEffect(() => {
    const tick = () => {
      const uidNow = getCurrentUserId()
      const list = loadSchedule(uidNow)
      const due = list.filter((x) => x.at <= Date.now())
      if (due.length === 0) return
      for (const item of due) {
        apiRef.current.publishPost(item.content, {
          topic: item.topic,
          images: item.images,
          media: item.media,
          vote: item.vote,
          lottery: item.lottery,
          location: item.location,
          visibility: item.visibility,
          story: item.story,
          expiresAt: item.expiresAt,
        })
      }
      writeSchedule(list.filter((x) => x.at > Date.now()), uidNow)
      emitToast(`定时发布已发出 ${due.length} 条 ⏰`)
    }
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return null
}
