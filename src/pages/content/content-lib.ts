/* ==========================================================================
 * 内容域页面共用选择器 —— 话题派生 / 作者查询 / 本地检索
 *
 * 为什么要有这一层：
 *  1. 原实现的「话题榜 / 热搜榜」读的是 store 里独立的 topics / hotSearches 集合，
 *     但这两个集合从未被任何真实通道写入（永远是空数组），热度也是预铺值。
 *     重建后不允许伪造，因此改为【从动态真实派生】：
 *       话题 = 动态 topic 字段聚合；热度 = 该话题下动态的真实互动量（复用 heatOf）。
 *     派生结果为空时就返回空数组，由页面落到空态。
 *  2. 多个页面都要「按 id 取头像昵称 / 按关键词检索 / 关键词高亮」，
 *     抽出来避免同一段逻辑在 16 个页面里各写一遍走样。
 *
 * 本文件是纯函数：无 React、无 IO、无计时器。
 * ======================================================================== */

import type { Article, HotSearchItem, Post, User } from '@/domain/content/model'
import { heatOf } from '@/domain/content/rules'

/* ---------- 作者 ---------- */

/**
 * 卡片作者摘要。
 * 说明：ui/post-card.tsx 里有一份同构的 AuthorLite，但 '@/ui' 桶文件未导出它；
 *      这里按同样字段定义一份与 PostCard props 结构兼容的类型，避免页面深链到具体文件
 *      （已建议主控在 ui/index.ts 补一行 export type { AuthorLite }）。
 */
export interface AuthorLite {
  id: string
  name: string
  emoji: string
  color: string
  verified?: boolean
}

/** 未知作者（被删除的用户 / 未同步的云端作者）统一落匿名占位，不伪造昵称 */
export const ANON_AUTHOR: AuthorLite = {
  id: '',
  name: '匿名用户',
  emoji: '🙂',
  color: 'var(--bg-soft)',
}

export function authorOf(users: User[], id: string): AuthorLite {
  const u = users.find((x) => x.id === id)
  if (!u) return ANON_AUTHOR
  return { id: u.id, name: u.name, emoji: u.emoji, color: u.color, verified: u.verified }
}

export function nameOf(users: User[], id: string): string {
  return authorOf(users, id).name
}

/** RichText 的 @用户名 → 用户 id 反查：命中才可点击跳转 */
export function userNameResolver(users: User[]): (name: string) => string | null {
  return (name) => users.find((u) => u.name === name)?.id ?? null
}

/* ---------- 话题派生 ---------- */

export interface TopicStat {
  name: string
  /** 该话题下动态数 */
  posts: number
  /** 参与讨论的作者数（去重） */
  authors: number
  /** 互动热度：话题下所有动态 heatOf 之和 */
  heat: number
  firstAt: number
  lastAt: number
}

/** 由动态聚合话题：无话题的动态不参与，快拍 / 仅自己可见由调用方先过滤 */
export function topicsFromPosts(posts: Post[]): TopicStat[] {
  const acc = new Map<string, { stat: TopicStat; authors: Set<string> }>()
  for (const p of posts) {
    const name = p.topic?.trim()
    if (!name) continue
    let row = acc.get(name)
    if (!row) {
      row = {
        stat: { name, posts: 0, authors: 0, heat: 0, firstAt: p.createdAt, lastAt: p.createdAt },
        authors: new Set<string>(),
      }
      acc.set(name, row)
    }
    row.stat.posts += 1
    row.stat.heat += heatOf(p)
    row.stat.firstAt = Math.min(row.stat.firstAt, p.createdAt)
    row.stat.lastAt = Math.max(row.stat.lastAt, p.createdAt)
    row.authors.add(p.authorId)
  }
  return Array.from(acc.values(), ({ stat, authors }) => ({ ...stat, authors: authors.size }))
}

export type TopicSort = 'posts' | 'heat' | 'recent'

export function sortTopics(list: TopicStat[], by: TopicSort = 'posts'): TopicStat[] {
  const rows = [...list]
  if (by === 'heat') return rows.sort((a, b) => b.heat - a.heat || b.posts - a.posts)
  if (by === 'recent') return rows.sort((a, b) => b.lastAt - a.lastAt)
  return rows.sort((a, b) => b.posts - a.posts || b.heat - a.heat)
}

const DAY_MS = 24 * 60 * 60 * 1000

function hotTagOf(t: TopicStat, i: number, now: number): HotSearchItem['tag'] {
  if (i === 0) return '爆'
  if (i === 1) return '沸'
  // 24h 内首现的话题标「新」，比尾部名次徽标更能反映真实热度变化
  if (now - t.firstAt < DAY_MS) return '新'
  if (i === 2) return '热'
  return null
}

/** 热搜榜：由话题真实互动热度派生（无数据时返回空数组 → 页面走空态） */
export function hotSearchFromPosts(posts: Post[], limit = 10, now = Date.now()): HotSearchItem[] {
  return sortTopics(topicsFromPosts(posts), 'heat')
    .slice(0, limit)
    .map((t, i) => ({ id: t.name, rank: i + 1, text: t.name, heat: t.heat, tag: hotTagOf(t, i, now) }))
}

/* ---------- 同城城市 ---------- */

/** 同城 Tab 的城市候选：预设 + 动态里真实出现过的城市名（location 形如「北京市 · 三里屯」） */
export const CITY_PRESETS = [
  '北京市',
  '上海市',
  '广州市',
  '深圳市',
  '杭州市',
  '成都市',
  '武汉市',
  '西安市',
  '南京市',
  '厦门市',
] as const

export function citiesOf(posts: Post[]): string[] {
  const set = new Set<string>(CITY_PRESETS)
  for (const p of posts) {
    const city = (p.location ?? '').split(' · ')[0]?.trim()
    if (city) set.add(city)
  }
  return Array.from(set)
}

/* ---------- 本地检索 ---------- */

/** 动态是否命中：正文 / 话题 / 评论内容 */
export function matchPost(p: Post, kw: string): boolean {
  return (
    p.content.toLowerCase().includes(kw) ||
    (p.topic ?? '').toLowerCase().includes(kw) ||
    p.comments.some((c) => c.content.toLowerCase().includes(kw))
  )
}

/** 文章是否命中：标题 / 摘要 / 正文 / 标签 / 评论 */
export function matchArticle(a: Article, kw: string): boolean {
  return (
    a.title.toLowerCase().includes(kw) ||
    a.summary.toLowerCase().includes(kw) ||
    a.content.toLowerCase().includes(kw) ||
    a.tags.some((t) => t.toLowerCase().includes(kw)) ||
    a.comments.some((c) => c.content.toLowerCase().includes(kw))
  )
}

export interface Piece {
  text: string
  hit: boolean
}

/** 关键词切片（大小写不敏感），交给 Highlight 渲染 <mark> */
export function highlightPieces(text: string, kw: string): Piece[] {
  if (!kw) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const key = kw.toLowerCase()
  const out: Piece[] = []
  let i = 0
  while (i < text.length) {
    const at = lower.indexOf(key, i)
    if (at < 0) {
      out.push({ text: text.slice(i), hit: false })
      break
    }
    if (at > i) out.push({ text: text.slice(i, at), hit: false })
    out.push({ text: text.slice(at, at + key.length), hit: true })
    i = at + key.length
  }
  return out
}
