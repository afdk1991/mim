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
