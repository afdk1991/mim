/* 轮 23 打通：B4 feed 分发域核心逻辑（纯函数 + localStorage 按真实登录身份分 key）——
   负反馈（不感兴趣）/ 同城定位 / 推荐排序打分。
   依赖仅 auth + types，避免与组件层形成循环引用；UI 层见 feed-domain.tsx。 */
import { getCurrentUserId } from '../auth'
import type { Post } from '../types'

/* ---------- 负反馈（不感兴趣） ---------- */

/** 负反馈变更事件：feed 页监听以即时刷新（同 UD_EVT / SCHED_EVT 的做法） */
export const RF_EVT = 'mim-rf-change'

export interface NegFeedback {
  /** 作者级：该作者的动态从各流整卡即时消失 */
  authors: string[]
  /** 话题级：推荐流中该话题内容降权 80%（排序沉底） */
  topics: string[]
}

const negKey = (userId: string) => `mim-rf-${userId}:neg`

function parseLoose<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function loadNeg(userId = getCurrentUserId()): NegFeedback {
  const v = parseLoose<Partial<NegFeedback>>(localStorage.getItem(negKey(userId)), {})
  return {
    authors: Array.isArray(v.authors) ? v.authors.filter((x) => typeof x === 'string') : [],
    topics: Array.isArray(v.topics) ? v.topics.filter((x) => typeof x === 'string') : [],
  }
}

function writeNeg(next: NegFeedback, userId: string): void {
  try {
    localStorage.setItem(negKey(userId), JSON.stringify(next))
  } catch {
    /* 存储满时静默 */
  }
  window.dispatchEvent(new Event(RF_EVT))
}

/** 记录「不感兴趣」：作者级 + 话题级一并入册，各流按 RF_EVT 即时刷新 */
export function recordNotInterested(post: Post, userId = getCurrentUserId()): NegFeedback {
  const cur = loadNeg(userId)
  const next: NegFeedback = {
    authors: cur.authors.includes(post.authorId) ? cur.authors : [...cur.authors, post.authorId],
    topics: post.topic && !cur.topics.includes(post.topic) ? [...cur.topics, post.topic] : cur.topics,
  }
  writeNeg(next, userId)
  return next
}

/** 恢复：清空当前身份的全部负反馈记录 */
export function clearNeg(userId = getCurrentUserId()): void {
  writeNeg({ authors: [], topics: [] }, userId)
}

export function negCount(n: NegFeedback): number {
  return n.authors.length + n.topics.length
}

/* ---------- 同城定位 ---------- */

/** 城市清单（与发布位置预设同源口径，本地维护避免对 content-domain 的运行时依赖） */
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
]

const cityKey = (userId: string) => `mim-rf-${userId}:city`

/** 我设置的定位；未设置时由调用方传入 AB 实验 city_default 的兜底城市 */
export function loadCity(userId = getCurrentUserId(), fallback = '北京市'): string {
  const v = localStorage.getItem(cityKey(userId))
  return v ?? fallback
}

export function saveCity(city: string, userId = getCurrentUserId()): void {
  try {
    localStorage.setItem(cityKey(userId), city)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(RF_EVT))
}

/* ---------- 推荐排序 ---------- */

export interface RecoItem {
  post: Post
  /** 推荐理由：「你常看 @某人」/「#话题# 相关」/ 热门兜底 */
  reason: string
  score: number
}

/**
 * 推荐流打散（对齐微博「内容去重与打散」）：分数排序后重排，
 * 避免同一作者 / 同一话题连续扎堆。策略：线性扫描，每次从剩余条目中
 * 挑得分最高的一个「作者与话题都不同于上一条」的；找不到时退化为
 * 「仅作者不同」，仍找不到（剩余全部撞车）才取剩余最高分——保证不丢条目。
 * null 话题（未参与话题）不参与撞车判定。
 */
function interleaveReco(items: RecoItem[]): RecoItem[] {
  const rest = [...items]
  const out: RecoItem[] = []
  const sameTopic = (a: string | null, b: string | null): boolean => !!a && !!b && a === b
  let lastAuthor: string | null = null
  let lastTopic: string | null = null
  while (rest.length > 0) {
    let idx = rest.findIndex(
      (it) => it.post.authorId !== lastAuthor && !sameTopic(it.post.topic ?? null, lastTopic),
    )
    if (idx < 0) idx = rest.findIndex((it) => it.post.authorId !== lastAuthor)
    if (idx < 0) idx = 0
    const [picked] = rest.splice(idx, 1)
    out.push(picked)
    lastAuthor = picked.post.authorId
    lastTopic = picked.post.topic ?? null
  }
  return out
}

/**
 * 轮 23 打通：B4 推荐流本地排序 demo ——
 * 兴趣权重从既有互动数据推导（点赞/收藏/评论/转发各 +1 记作者与话题）；
 * 排序分 = 作者互动权重 ×2 + 话题命中 ×1.5 + 时间衰减（48h 指数近似，0~2 分）；
 * 负反馈话题命中降权 80%（作者级命中由调用方整卡过滤，不进候选）；
 * 末段过 interleaveReco 打散，同作者/同话题不连续出现。
 */
export function buildRecFeed(opts: {
  candidates: Post[]
  meId: string
  posts: Post[]
  favorites: Array<{ type: 'post' | 'article'; targetId: string }>
  users: Record<string, { id: string; name: string }>
  negTopics: string[]
}): RecoItem[] {
  const { candidates, meId, posts, favorites, users, negTopics } = opts
  const authorW = new Map<string, number>()
  const topicW = new Map<string, number>()
  const bump = (authorId: string | undefined, topic: string | null): void => {
    if (authorId && users[authorId]) authorW.set(authorId, (authorW.get(authorId) ?? 0) + 1)
    if (topic) topicW.set(topic, (topicW.get(topic) ?? 0) + 1)
  }
  /* 转发：我转发的原帖作者/话题 */
  for (const p of posts) {
    if (p.authorId !== meId || !p.repostOfId) continue
    const src = posts.find((x) => x.id === p.repostOfId)
    if (src) bump(src.authorId, src.topic)
  }
  /* 点赞 / 评论：我互动过的动态作者与话题 */
  for (const p of posts) {
    if (p.authorId === meId) continue
    let hit = p.likedByMe
    for (const c of p.comments ?? []) if (c.authorId === meId) hit = true
    if (hit) bump(p.authorId, p.topic)
  }
  /* 收藏 */
  const favIds = new Set(favorites.filter((f) => f.type === 'post').map((f) => f.targetId))
  for (const p of posts) if (favIds.has(p.id) && p.authorId !== meId) bump(p.authorId, p.topic)

  const now = Date.now()
  const negSet = new Set(negTopics)
  const items: RecoItem[] = candidates.map((p) => {
    const hours = Math.max(0, (now - p.createdAt) / 3_600_000)
    const aw = authorW.get(p.authorId) ?? 0
    const tw = p.topic ? (topicW.get(p.topic) ?? 0) : 0
    let score = aw * 2 + tw * 1.5 + Math.exp(-hours / 48) * 2
    if (p.topic && negSet.has(p.topic)) score *= 0.2
    const author = users[p.authorId]
    const reason =
      aw > 0 && author
        ? `你常看 @${author.name}`
        : tw > 0 && p.topic
          ? `#${p.topic}# 相关`
          : '🔥 热门内容'
    return { post: p, reason, score }
  })
  items.sort((a, b) => b.score - a.score)
  return interleaveReco(items)
}
