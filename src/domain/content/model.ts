/* ==========================================================================
 * 内容域模型 —— 动态 / 文章 / 片段 / 资源 / 话题 / 评论
 *
 * 取自原实现并做两处收敛：
 *  1. 富字段（media/vote/lottery/location/story/visibility/pinned/expiresAt）
 *     统一标为可选，反序列化时缺失即缺省 —— 原实现「云端行回写会覆盖本地富字段」
 *     的降级 bug 由此消除（见 data/sync.ts 的合并策略）。
 *  2. 时间统一毫秒 number；落库转 ISO 由仓储层负责，模型层不关心。
 * ======================================================================== */

export type Visibility = 'public' | 'self'

export interface PostMedia {
  kind: 'video' | 'audio' | 'gif'
  src?: string
  poster?: string
  duration?: number
  title?: string
}

export interface PostVote {
  question: string
  options: string[]
  counts: number[]
  /** 投票人 → 选项下标；一人一票，真源在此 */
  voters: Record<string, number>
  endsAt: number
}

export interface PostLottery {
  prize: string
  count: number
  participants: string[]
  /** 存在即已开奖，不可再开 */
  winners?: string[]
  endsAt: number
}

export interface PostComment {
  id: string
  authorId: string
  content: string
  createdAt: number
  likes: number
  likedByMe: boolean
  /** 缺省为顶级评论；只支持二级缩进，不做无限层级 */
  replyTo?: string
}

export interface Post {
  id: string
  authorId: string
  content: string
  /** emoji 占位图或已上传的图片地址 */
  images: string[]
  createdAt: number
  repostOfId: string | null
  repostComment: string
  likes: number
  likedByMe: boolean
  reposts: number
  topic: string | null
  source: string
  comments: PostComment[]
  media?: PostMedia
  vote?: PostVote
  lottery?: PostLottery
  location?: string
  visibility: Visibility
  story?: boolean
  expiresAt?: number
  pinned?: boolean
  views?: number
}

export interface ArticleComment {
  id: string
  authorId: string
  content: string
  createdAt: number
}

export interface Article {
  id: string
  authorId: string
  title: string
  summary: string
  content: string
  tags: string[]
  createdAt: number
  views: number
  likes: number
  likedByMe: boolean
  comments: ArticleComment[]
}

export interface Snippet {
  id: string
  authorId: string
  title: string
  language: string
  code: string
  createdAt: number
  likes: number
  likedByMe: boolean
}

export interface Resource {
  id: string
  title: string
  description: string
  category: string
  uploader: string
  size: string
  downloads: number
  type: string
}

export interface Topic {
  id: string
  name: string
  heat: number
  desc: string
}

export type HotTag = '热' | '新' | '爆' | '沸' | null

export interface HotSearchItem {
  id: string
  rank: number
  text: string
  heat: number
  tag: HotTag
}

export type NotificationType = 'like' | 'comment' | 'repost' | 'follow' | 'mention'

export interface AppNotification {
  id: string
  type: NotificationType
  fromUserId: string
  content: string
  postId: string | null
  createdAt: number
  read: boolean
}

export interface Message {
  id: string
  /** 对话对象 */
  userId: string
  fromMe: boolean
  content: string
  createdAt: number
  read: boolean
}

export type FavoriteKind = 'post' | 'article'

export interface FavoriteItem {
  id: string
  type: FavoriteKind
  targetId: string
  createdAt: number
}

export interface PostDraft {
  id: string
  content: string
  topic: string
  images: string[]
  savedAt: number
}

export interface ArticleDraft {
  id: string
  title: string
  content: string
  tags: string[]
  savedAt: number
}

export interface User {
  id: string
  name: string
  emoji: string
  color: string
  bio: string
  followers: number
  following: number
  verified: boolean
}

/** 浏览足迹：实现在 core/utils（含本机持久化与 50 条上限），
 *  这里再导出以保持单一真源，避免两处各定义一份导致结构漂移。 */
export type { HistoryEntry, ViewKind } from '../../core/utils'

/** 内容类型编码：与统一发布器的 content_type 对齐 */
export const CONTENT_TYPE = {
  text: 10,
  image: 11,
  video: 12,
  vote: 13,
  lottery: 14,
  story: 15,
  article: 20,
  resource: 22,
} as const

export type ContentTypeCode = (typeof CONTENT_TYPE)[keyof typeof CONTENT_TYPE]

export const SNIPPET_LANGUAGES = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'CSS',
  'SQL',
  'Shell',
] as const
