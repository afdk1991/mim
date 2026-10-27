/* ==========================================================================
 * 内容域规则 —— 纯函数，无 React、无 IO
 *
 * 承载原实现里散落在页面中的业务判定：可见性、敏感词、摘要、排序、过滤链。
 * 页面只做渲染，判定一律调这里，避免同一规则在多处走样。
 * ======================================================================== */

import { LIMITS } from '../../core/config'
import type { Post, PostComment } from './model'

/* ---------- 敏感词（机审前置，命中即阻断发布） ---------- */

export type SensitiveCategory = 'spam' | 'finance' | 'blackmarket' | 'adult' | 'violence'

export const SENSITIVE_WORDS_BY_CATEGORY: Record<SensitiveCategory, { label: string; words: string[] }> = {
  spam: { label: '垃圾营销', words: ['加微信', '刷单', '兼职日结', '免费领取'] },
  finance: { label: '金融违规', words: ['博彩', '赌博', '套现', '高利贷'] },
  blackmarket: { label: '黑产交易', words: ['办证', '代开发票', '买卖账号'] },
  adult: { label: '色情低俗', words: ['色情', '成人内容'] },
  violence: { label: '暴力违法', words: ['暴力', '违禁品'] },
}

export const SENSITIVE_WORDS: string[] = Object.values(SENSITIVE_WORDS_BY_CATEGORY).flatMap((c) => c.words)

export interface SensitiveHit {
  word: string
  category: SensitiveCategory
}

export function findSensitiveHitsDetailed(text: string): SensitiveHit[] {
  const out: SensitiveHit[] = []
  for (const [cat, def] of Object.entries(SENSITIVE_WORDS_BY_CATEGORY) as Array<
    [SensitiveCategory, { label: string; words: string[] }]
  >) {
    for (const w of def.words) {
      if (text.includes(w)) out.push({ word: w, category: cat })
    }
  }
  return out
}

export function findSensitiveHits(text: string): string[] {
  return findSensitiveHitsDetailed(text).map((h) => h.word)
}

export function sensitiveHitLabels(text: string): string[] {
  const cats = new Set(findSensitiveHitsDetailed(text).map((h) => h.category))
  return Array.from(cats).map((c) => SENSITIVE_WORDS_BY_CATEGORY[c].label)
}

/* ---------- 青少年模式 ---------- */

export const TEEN_WORDS = ['博彩', '色情', '暴力', '成人内容']

export function matchesTeenWords(text: string): boolean {
  return TEEN_WORDS.some((w) => text.includes(w))
}

/* ---------- 可见性 ---------- */

/** 仅自己可见的内容，只有作者本人能看 */
export function postVisibleTo(p: Post, viewerId: string): boolean {
  return p.visibility !== 'self' || p.authorId === viewerId
}

/** 快拍是否已过期（过期即在渲染期消失） */
export function storyExpired(p: Post, now = Date.now()): boolean {
  return !!p.story && typeof p.expiresAt === 'number' && p.expiresAt > 0 && now > p.expiresAt
}

/* ---------- Feed 过滤链（顺序固定，页面不得自行重排） ---------- */

export interface FeedFilterInput {
  blacklist: string[]
  teenEnabled: boolean
  blockedAuthors: string[]
}

export function feedFilter(p: Post, viewerId: string, f: FeedFilterInput, now = Date.now()): boolean {
  if (p.story) return false // 快拍只进快拍栏
  if (!postVisibleTo(p, viewerId)) return false
  if (f.blacklist.includes(p.authorId)) return false
  if (f.teenEnabled && matchesTeenWords(p.content)) return false
  if (f.blockedAuthors.includes(p.authorId)) return false
  if (storyExpired(p, now)) return false
  return true
}

/* ---------- 排序 ---------- */

/** 关注流：置顶帖排最前（稳定排序），其余保持原序 */
export function sortFollowing(posts: Post[]): Post[] {
  const pinned = posts.filter((p) => p.pinned)
  const rest = posts.filter((p) => !p.pinned)
  return [...pinned, ...rest]
}

/** 热门流：heat = 点赞 + 转发×2 + 评论×3 */
export function heatOf(p: Post): number {
  return p.likes + p.reposts * 2 + p.comments.length * 3
}

export function sortHot(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => heatOf(b) - heatOf(a))
}

/** 同城流：location 以城市名开头 */
export function filterByCity(posts: Post[], city: string): Post[] {
  return posts.filter((p) => (p.location ?? '').startsWith(city))
}

/** 话题流：最新 / 最热，置顶优先 */
export function sortTopic(posts: Post[], by: 'latest' | 'hot'): Post[] {
  const pinned = posts.filter((p) => p.pinned)
  const rest = posts.filter((p) => !p.pinned)
  const sorted =
    by === 'hot' ? [...rest].sort((a, b) => b.likes - a.likes) : [...rest].sort((a, b) => b.createdAt - a.createdAt)
  return [...pinned, ...sorted]
}

/** 推荐流打分：作者权重×2 + 话题权重×1.5 + 时间衰减 exp(-h/48)×2 */
export function recoScore(p: Post, authorWeight: number, topicWeight: number, now = Date.now()): number {
  const hours = (now - p.createdAt) / 3_600_000
  return authorWeight * 2 + topicWeight * 1.5 + Math.exp(-hours / 48) * 2
}

/* ---------- 摘要与元信息 ---------- */

/** 文章摘要：去代码块 → 去标记符号 → 折叠空白 → 取前 72 字 */
export function makeSummary(content: string, max = 72): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*`\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length <= max ? plain : `${plain.slice(0, max)}…`
}

/** 阅读时长（分钟）：400 字/分钟，下限 1 */
export function readMinutes(content: string): number {
  return Math.max(1, Math.ceil(content.length / 400))
}

/** 正文去空白长度（质量门用） */
export function plainLength(content: string): number {
  return content.replace(/\s+/g, '').length
}

/** 文章质量门：正文 ≥50 字才记成长分 */
export function articleQualityPass(content: string): boolean {
  return plainLength(content) >= 50
}

/* ---------- 评论 ---------- */

/** 顶层评论与回复分离（只支持二级） */
export function splitComments(comments: PostComment[]): { top: PostComment[]; repliesOf: (id: string) => PostComment[] } {
  const top = comments.filter((c) => !c.replyTo)
  const repliesOf = (id: string): PostComment[] => comments.filter((c) => c.replyTo === id)
  return { top, repliesOf }
}

/* ---------- 投票与抽奖 ---------- */

export function voteOpen(v: { endsAt: number }, now = Date.now()): boolean {
  return now < v.endsAt
}

export function voteTotal(v: { counts: number[] }): number {
  return v.counts.reduce((a, b) => a + b, 0)
}

/** 一人一票：返回是否投成功（已投过或已截止返回 false） */
export function canCastVote(v: { voters: Record<string, number>; endsAt: number }, voterId: string, now = Date.now()): boolean {
  if (!voteOpen(v, now)) return false
  return v.voters[voterId] === undefined
}

export function canDrawLottery(l: { winners?: string[]; endsAt: number }, now = Date.now()): boolean {
  if (l.winners && l.winners.length > 0) return false
  return now >= l.endsAt
}

/* ---------- 分页 ---------- */

export function pageOf<T>(list: T[], page: number, size = LIMITS.feedPageSize): T[] {
  return list.slice(0, page * size)
}

export function hasMore<T>(list: T[], page: number, size = LIMITS.feedPageSize): boolean {
  return list.length > page * size
}
