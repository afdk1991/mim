/* 云端读路径（轮 4）：启动/登录时拉取云端内容与个人数据，转换为本地域模型。
   双真源共存设计：云端行 = 真实登录用户写入的内容；seed 演示内容（作者 me/u1..u9
   无 auth.users 行）= 本地真源。pullCloudContent 返回的载荷由 store.tsx dispatch
   cloudMerge 合并（云端行覆盖同 id 本地乐观行，其余混排插入）。
   任一查询失败或无登录会话返回 null，调用方保持纯本地状态（静默降级）。 */
import { supabase } from './supabase'
import type {
  AppNotification,
  Article,
  ArticleComment,
  ArticleDraft,
  FavoriteItem,
  Message,
  NotificationType,
  Post,
  PostComment,
  PostDraft,
  Snippet,
  User,
} from '../types'

export interface CloudPayload {
  /** 云端 profiles（仅真实登录用户，key 为 uuid，与 seed 用户 id 无交集） */
  users: Record<string, User>
  posts: Post[]
  articles: Article[]
  snippets: Snippet[]
  /** 我关注的云端用户 id（follows where follower = me） */
  followingIds: string[]
  /** 我的云端收藏（favorites where user = me） */
  favorites: FavoriteItem[]
  /** 我的云端私信（双行模型 owner 侧：我发的 from_me=true + 我收的 from_me=false，RLS 均按 owner_id 放行） */
  messages: Message[]
  /** 我的云端通知（notifications where user = me，倒序） */
  notifications: AppNotification[]
  /** 我的动态草稿（跨设备续写） */
  postDrafts: PostDraft[]
  /** 我的文章草稿（跨设备续写） */
  articleDrafts: ArticleDraft[]
}

/** 单查询解包：失败抛错由外层 catch 统一降级。
    CloudBase rdb 返回行结构与 Supabase 一致（同为 postgREST），此处按宽松类型解包，
    由调用点自行完成到域模型的字段映射（见下方 profiles→User 等转换）。 */
function unwrap<T = any>(r: { error?: { message: string } | null; data?: any }, name: string): T[] {
  if (r?.error || !r?.data) throw new Error(`${name}: ${r?.error?.message ?? 'empty'}`)
  return r.data as T[]
}

export async function pullCloudContent(): Promise<CloudPayload | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    const meId = data.session?.user?.id
    if (!meId) return null

    const [postsR, postCommentsR, articlesR, articleCommentsR, snippetsR, profilesR, messagesR,
      notifsR, postDraftsR, articleDraftsR,
      likePostR, likeCommentR, likeArticleR, likeSnippetR, followsR, favsR] = await Promise.all([
      supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('post_comments').select('*').order('created_at', { ascending: true }).limit(500),
      supabase.from('articles').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('article_comments').select('*').order('created_at', { ascending: true }).limit(500),
      supabase.from('snippets').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('profiles').select('*'),
      supabase.from('messages').select('*').eq('owner_id', meId).order('created_at', { ascending: true }).limit(500),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('post_drafts').select('*').order('saved_at', { ascending: false }),
      supabase.from('article_drafts').select('*').order('saved_at', { ascending: false }),
      supabase.from('post_likes').select('post_id').eq('user_id', meId),
      supabase.from('comment_likes').select('comment_id').eq('user_id', meId),
      supabase.from('article_likes').select('article_id').eq('user_id', meId),
      supabase.from('snippet_likes').select('snippet_id').eq('user_id', meId),
      supabase.from('follows').select('followee_id').eq('follower_id', meId),
      supabase.from('favorites').select('*').eq('user_id', meId),
    ])

    const likedPosts = new Set(unwrap(likePostR, 'post_likes').map((r) => r.post_id))
    const likedComments = new Set(unwrap(likeCommentR, 'comment_likes').map((r) => r.comment_id))
    const likedArticles = new Set(unwrap(likeArticleR, 'article_likes').map((r) => r.article_id))
    const likedSnippets = new Set(unwrap(likeSnippetR, 'snippet_likes').map((r) => r.snippet_id))

    // profiles → User（emoji/color 空值兜底，与 schema default 对齐）
    const users: Record<string, User> = {}
    for (const p of unwrap(profilesR, 'profiles')) {
      users[p.id] = {
        id: p.id,
        name: p.name,
        emoji: p.emoji || '🙂',
        color: p.color || '#ff8200',
        bio: p.bio ?? '',
        followers: p.followers ?? 0,
        following: p.following ?? 0,
        verified: p.verified ?? false,
      }
    }

    // 评论按父帖/父文章分组内嵌，按时间正序（本地 append 顺序 = 时间顺序）
    const commentsByPost = new Map<string, PostComment[]>()
    for (const c of unwrap(postCommentsR, 'post_comments')) {
      const list = commentsByPost.get(c.post_id) ?? []
      list.push({
        id: c.id,
        authorId: c.author_id,
        content: c.content,
        createdAt: Date.parse(c.created_at),
        likes: c.likes ?? 0,
        likedByMe: likedComments.has(c.id),
      })
      commentsByPost.set(c.post_id, list)
    }
    const commentsByArticle = new Map<string, ArticleComment[]>()
    for (const c of unwrap(articleCommentsR, 'article_comments')) {
      const list = commentsByArticle.get(c.article_id) ?? []
      list.push({
        id: c.id,
        authorId: c.author_id,
        content: c.content,
        createdAt: Date.parse(c.created_at),
      })
      commentsByArticle.set(c.article_id, list)
    }

    const posts: Post[] = unwrap(postsR, 'posts').map((p) => ({
      id: p.id,
      authorId: p.author_id,
      content: p.content,
      images: p.images ?? [],
      createdAt: Date.parse(p.created_at),
      repostOfId: p.repost_of_id ?? null,
      repostComment: p.repost_comment ?? '',
      likes: p.likes ?? 0,
      likedByMe: likedPosts.has(p.id),
      reposts: p.reposts ?? 0,
      topic: p.topic ?? null,
      source: p.source ?? '来自 网页版',
      // 富媒体/互动扩展字段（迁移 0004）：回拉还原本地富帖能力
      media: p.media ?? null,
      vote: p.vote ?? null,
      lottery: p.lottery ?? null,
      location: p.location ?? null,
      story: p.story ?? false,
      visibility: p.visibility ?? 'public',
      expiresAt: p.expires_at ? Date.parse(p.expires_at) : undefined,
      pinned: p.pinned ?? false,
      comments: commentsByPost.get(p.id) ?? [],
    }))

    const articles: Article[] = unwrap(articlesR, 'articles').map((a) => ({
      id: a.id,
      authorId: a.author_id,
      title: a.title,
      summary: a.summary ?? '',
      content: a.content,
      tags: a.tags ?? [],
      createdAt: Date.parse(a.created_at),
      views: a.views ?? 0,
      likes: a.likes ?? 0,
      likedByMe: likedArticles.has(a.id),
      comments: commentsByArticle.get(a.id) ?? [],
    }))

    const snippets: Snippet[] = unwrap(snippetsR, 'snippets').map((s) => ({
      id: s.id,
      authorId: s.author_id,
      title: s.title,
      language: s.language ?? 'text',
      code: s.code,
      createdAt: Date.parse(s.created_at),
      likes: s.likes ?? 0,
      likedByMe: likedSnippets.has(s.id),
    }))

    const favorites: FavoriteItem[] = unwrap(favsR, 'favorites').map((f) => ({
      id: f.id,
      type: f.type as 'post' | 'article',
      targetId: f.target_id,
      createdAt: Date.parse(f.created_at),
    }))

    // 私信双行模型 owner 侧：peer_id = 对话对象，from_me 区分收发方向
    const messages: Message[] = unwrap(messagesR, 'messages').map((m) => ({
      id: m.id,
      userId: m.peer_id as string,
      fromMe: m.from_me === true,
      content: m.content,
      createdAt: Date.parse(m.created_at),
      read: m.read ?? false,
    }))

    const notifications: AppNotification[] = unwrap(notifsR, 'notifications').map((n) => ({
      id: n.id,
      type: n.type as NotificationType,
      fromUserId: n.from_user_id as string,
      content: n.content,
      postId: n.post_id ?? null,
      read: n.read ?? false,
      createdAt: Date.parse(n.created_at),
    }))

    const postDrafts: PostDraft[] = unwrap(postDraftsR, 'post_drafts').map((d) => ({
      id: d.id,
      content: d.content,
      topic: d.topic ?? null,
      images: d.images ?? [],
      savedAt: Date.parse(d.saved_at),
    }))

    const articleDrafts: ArticleDraft[] = unwrap(articleDraftsR, 'article_drafts').map((d) => ({
      id: d.id,
      title: d.title,
      content: d.content,
      tags: d.tags ?? [],
      savedAt: Date.parse(d.saved_at),
    }))

    return {
      users,
      posts,
      articles,
      snippets,
      followingIds: unwrap(followsR, 'follows').map((r) => r.followee_id),
      favorites,
      messages,
      notifications,
      postDrafts,
      articleDrafts,
    }
  } catch (err) {
    console.warn('[cloud-read] 云端拉取失败，回退纯本地：', err)
    return null
  }
}
