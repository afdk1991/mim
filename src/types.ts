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

export interface PostComment {
  id: string
  authorId: string
  content: string
  createdAt: number
  likes: number
  likedByMe: boolean
  /** 轮 21 打通：楼中楼——被回复评论 id（缺省为顶级评论，渲染二级缩进，不做无限层级） */
  replyTo?: string
}

/* 轮 21 打通：B2 内容域扩展类型（旧 Post/seed 缺省全部可选，兼容旧存档不炸） */

/** 视频/GIF 占位媒体：demo 用 emoji 海报 + 时长占位（真实媒体上传后续接入） */
export interface PostMedia {
  type: 'video' | 'gif'
  /** emoji 海报占位 */
  poster: string
  /** 视频时长（秒）；GIF 无 */
  duration?: number
}

/** 投票：votes 记「选项→票数」；voters 按身份 key（meId→选项）记一人一票的判定真源 */
export interface PostVote {
  options: string[]
  votes: Record<string, number>
  endsAt: number
  /** voterKey → 所选选项（一人一票） */
  voters: Record<string, string>
}

/** 抽奖：参与者按身份 key 去重，开奖后写入 winners 公示 */
export interface PostLottery {
  prize: string
  count: number
  endsAt: number
  participants: string[]
  winners?: string[]
}

export interface Post {
  id: string
  authorId: string
  content: string
  images: string[] // emoji 占位图
  createdAt: number
  repostOfId: string | null
  repostComment: string
  likes: number
  likedByMe: boolean
  reposts: number
  topic: string | null
  source: string
  comments?: PostComment[]
  /** 轮 21 打通：视频/GIF 媒体卡 */
  media?: PostMedia
  /** 轮 21 打通：投票 */
  vote?: PostVote
  /** 轮 21 打通：抽奖 */
  lottery?: PostLottery
  /** 轮 21 打通：发布位置（📍 显示在卡片底部） */
  location?: string
  /** 轮 21 打通：可见性——public 公开 / self 仅自己（缺省视为 public） */
  visibility?: 'public' | 'self'
  /** 轮 21 打通：24h 快拍标记 */
  story?: boolean
  /** 轮 21 打通：过期时间戳（快拍 24h；过期自动从各流消失） */
  expiresAt?: number
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

export type ResourceType = 'pdf' | 'video' | 'code' | 'doc'

export interface Resource {
  id: string
  title: string
  description: string
  category: string
  uploader: string
  size: string
  downloads: number
  type: ResourceType
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

export interface Message {
  id: string
  userId: string // 对话对象
  fromMe: boolean
  content: string
  createdAt: number
  read: boolean
}

export interface FavoriteItem {
  id: string
  type: 'post' | 'article'
  targetId: string
  createdAt: number
}

export interface PostDraft {
  id: string
  content: string
  topic: string | null
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

/** 云端真源 id 集合（轮 4）：写操作仅对这些 id 落云端，seed 演示内容保持纯本地 */
export interface CloudIds {
  /** 云端 profiles 的用户 id（关注分流依据） */
  users: string[]
  posts: string[]
  articles: string[]
  snippets: string[]
}

export interface AppState {
  meId: string
  users: Record<string, User>
  posts: Post[]
  articles: Article[]
  snippets: Snippet[]
  resources: Resource[]
  notifications: AppNotification[]
  topics: Topic[]
  hotSearches: HotSearchItem[]
  messages: Message[]
  favorites: FavoriteItem[]
  postDrafts: PostDraft[]
  articleDrafts: ArticleDraft[]
  followingIds: string[]
  /** 云端真源内容 id 集合（可选字段：旧存档缺失时视为空集，全部走纯本地） */
  cloudIds?: CloudIds
}
