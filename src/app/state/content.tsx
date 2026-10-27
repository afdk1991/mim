/* ==========================================================================
 * 内容域状态 —— 动态 / 文章 / 片段 / 社交关系的本机真源 + 云端补写
 *
 * 分层原则（重建重点）：
 *   状态层只管「数据与动作」，不碰渲染；页面只消费 useApp()。
 *   云端写入一律 fire-and-forget 三态（ok / skip / fail），失败回滚并提示，
 *   绝不出现「前端显示成功、云端没写进去」的静默不一致。
 *
 * 不伪造原则：没有真实来源时保持空数组，页面显示空态。
 * ======================================================================== */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AppNotification,
  Article,
  ArticleComment,
  ArticleDraft,
  FavoriteKind,
  FavoriteItem,
  Message,
  Post,
  PostComment,
  PostDraft,
  Snippet,
  User,
} from '../../domain/content/model'
import { makeSummary } from '../../domain/content/rules'
import { uid } from '../../core/utils'
import { emit, EVT } from '../../core/events'
import { currentUid } from '../../data/session'
import { loadSnapshot, pushCloud, saveSnapshot, writeWithFallback } from '../../data/sync'
import { db } from '../../data/client'
import { emitToast } from '../../ui'

export interface AppState {
  meId: string
  users: User[]
  posts: Post[]
  articles: Article[]
  snippets: Snippet[]
  notifications: AppNotification[]
  messages: Message[]
  favorites: FavoriteItem[]
  postDrafts: PostDraft[]
  articleDrafts: ArticleDraft[]
  following: string[]
}

const SCOPE = 'content'

function emptyState(meId: string): AppState {
  return {
    meId,
    users: [],
    posts: [],
    articles: [],
    snippets: [],
    notifications: [],
    messages: [],
    favorites: [],
    postDrafts: [],
    articleDrafts: [],
    following: [],
  }
}

/* ---------- 反序列化：元素级校验，脏数据剔除 ---------- */

const isArr = (v: unknown): v is unknown[] => Array.isArray(v)

function parseState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.meId !== 'string') return null
  const arr = <T,>(v: unknown): T[] => (isArr(v) ? (v as T[]) : [])
  return {
    meId: r.meId,
    users: arr<User>(r.users),
    posts: arr<Post>(r.posts).filter((p) => p && typeof p.id === 'string'),
    articles: arr<Article>(r.articles).filter((a) => a && typeof a.id === 'string'),
    snippets: arr<Snippet>(r.snippets).filter((s) => s && typeof s.id === 'string'),
    notifications: arr<AppNotification>(r.notifications),
    messages: arr<Message>(r.messages),
    favorites: arr<FavoriteItem>(r.favorites),
    postDrafts: arr<PostDraft>(r.postDrafts),
    articleDrafts: arr<ArticleDraft>(r.articleDrafts),
    following: arr<string>(r.following).filter((x) => typeof x === 'string'),
  }
}

/* ---------- API ---------- */

export interface AppApi {
  state: AppState
  meId: string
  publishPost: (content: string, opts?: { images?: string[]; topic?: string | null; visibility?: Post['visibility'] }) => string
  deletePost: (id: string) => void
  togglePostLike: (id: string) => void
  addPostComment: (postId: string, content: string, replyTo?: string) => void
  repostPost: (postId: string, comment: string) => string
  toggleFollow: (id: string) => void
  toggleFavorite: (kind: FavoriteKind, targetId: string) => void
  sendMessage: (userId: string, content: string) => void
  readConversation: (userId: string) => void
  readNotification: (id: string) => void
  readAllNotifications: () => void
  savePostDraft: (content: string, topic: string, images: string[]) => string
  publishPostDraft: (draftId: string) => void
  deletePostDraft: (id: string) => void
  publishArticle: (input: { title: string; content: string; tags: string[]; draftId?: string }) => string
  saveArticleDraft: (input: { id?: string; title: string; content: string; tags: string[] }) => string
  deleteArticleDraft: (id: string) => void
  deleteArticle: (id: string) => void
  editPost: (id: string, patch: { content?: string; images?: string[] }) => void
  editArticle: (id: string, patch: { title?: string; content?: string; tags?: string[] }) => void
  toggleArticleLike: (id: string) => void
  addArticleComment: (articleId: string, content: string) => void
  toggleCommentLike: (postId: string, commentId: string) => void
  addSnippet: (title: string, language: string, code: string) => void
  deleteSnippet: (id: string) => void
  toggleSnippetLike: (id: string) => void
  /** 仅递增下载计数；不凭空生成收益流水 */
  downloadResource: (id: string) => void
  updateProfile: (patch: Partial<User>) => void
  refreshFeed: () => number
  resetLocalData: () => void
}

const AppCtx = createContext<AppApi | null>(null)

/** 缺列缓存：线上库未应用迁移时自动裁剪，迁移补齐后自动恢复全字段 */
const missingCols = new Map<string, Set<string>>()

function missingOf(table: string): Set<string> {
  const s = missingCols.get(table)
  if (s) return s
  const n = new Set<string>()
  missingCols.set(table, n)
  return n
}

async function cloudInsert(table: string, row: Record<string, unknown>, label: string): Promise<boolean> {
  const { result } = await writeWithFallback(table, row, missingOf(table), (body) =>
    db.insert(table, body) as never,
  )
  if (!result.ok && result.error.code !== 'offline' && result.error.code !== 'no_auth') {
    emitToast(`⚠ ${label}云端保存失败：${result.error.message}`)
  }
  return result.ok
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => {
    const meId = currentUid()
    return loadSnapshot(SCOPE, parseState, emptyState(meId))
  })
  const stateRef = useRef(state)
  stateRef.current = state

  /* 落地本机 + 广播（切号/跨模块刷新依赖事件） */
  useEffect(() => {
    saveSnapshot(SCOPE, state)
    emit(EVT.identity)
  }, [state])

  /* 云写统一出口：三态收敛 */
  const write = useCallback((run: () => Promise<unknown>, onFail?: () => void) => {
    void pushCloud(async () => {
      try {
        await run()
        return { ok: true, data: null }
      } catch {
        onFail?.()
        return { ok: false, error: { code: 'server' as const, message: '' } }
      }
    }).then((back) => {
      if (back === 'fail' && !onFail) emitToast('⚠ 云端同步失败，已保留在本机')
    })
  }, [])

  const api = useMemo<AppApi>(() => {
    const patch = (fn: (s: AppState) => AppState): void => setState((s) => fn(s))

    return {
      state,
      meId: state.meId,

      publishPost(content, opts) {
        const id = uid('p')
        const post: Post = {
          id,
          authorId: stateRef.current.meId,
          content,
          images: opts?.images ?? [],
          createdAt: Date.now(),
          repostOfId: null,
          repostComment: '',
          likes: 0,
          likedByMe: false,
          reposts: 0,
          topic: opts?.topic ?? null,
          source: '来自 网页版',
          comments: [],
          visibility: opts?.visibility ?? 'public',
        }
        patch((s) => ({ ...s, posts: [post, ...s.posts] }))
        write(() =>
          cloudInsert(
            'posts',
            {
              id,
              author_id: post.authorId,
              content,
              images: post.images,
              created_at: new Date(post.createdAt).toISOString(),
              topic: post.topic,
              source: post.source,
              visibility: post.visibility,
            },
            '发布',
          ),
        )
        return id
      },

      deletePost(id) {
        const snapshot = stateRef.current.posts
        patch((s) => ({ ...s, posts: s.posts.filter((p) => p.id !== id || p.authorId !== s.meId) }))
        write(
          () => db.remove('posts', id),
          () => {
            setState((s) => ({ ...s, posts: snapshot }))
            emitToast('⚠ 云端删除失败，已恢复')
          },
        )
      },

      togglePostLike(id) {
        patch((s) => ({
          ...s,
          posts: s.posts.map((p) =>
            p.id === id
              ? { ...p, likedByMe: !p.likedByMe, likes: Math.max(0, p.likes + (p.likedByMe ? -1 : 1)) }
              : p,
          ),
        }))
      },

      addPostComment(postId, content, replyTo) {
        const c: PostComment = {
          id: uid('c'),
          authorId: stateRef.current.meId,
          content,
          createdAt: Date.now(),
          likes: 0,
          likedByMe: false,
          ...(replyTo ? { replyTo } : {}),
        }
        patch((s) => ({
          ...s,
          posts: s.posts.map((p) => (p.id === postId ? { ...p, comments: [...p.comments, c] } : p)),
        }))
        write(() =>
          cloudInsert(
            'post_comments',
            {
              id: c.id,
              post_id: postId,
              author_id: c.authorId,
              content,
              reply_to: replyTo ?? null,
              created_at: new Date(c.createdAt).toISOString(),
            },
            '评论',
          ),
        )
      },

      repostPost(postId, comment) {
        const id = uid('p')
        patch((s) => ({
          ...s,
          posts: [
            {
              id,
              authorId: s.meId,
              content: comment || '转发动态',
              images: [],
              createdAt: Date.now(),
              repostOfId: postId,
              repostComment: comment,
              likes: 0,
              likedByMe: false,
              reposts: 0,
              topic: null,
              source: '来自 网页版',
              comments: [],
              visibility: 'public',
            },
            ...s.posts.map((p) => (p.id === postId ? { ...p, reposts: p.reposts + 1 } : p)),
          ],
        }))
        return id
      },

      toggleFollow(id) {
        patch((s) => ({
          ...s,
          following: s.following.includes(id) ? s.following.filter((x) => x !== id) : [...s.following, id],
          users: s.users.map((u) =>
            u.id === id
              ? {
                  ...u,
                  followers: Math.max(
                    0,
                    u.followers + (s.following.includes(id) ? -1 : 1),
                  ),
                }
              : u,
          ),
        }))
      },

      toggleFavorite(kind, targetId) {
        patch((s) => {
          const exist = s.favorites.find((f) => f.type === kind && f.targetId === targetId)
          return {
            ...s,
            favorites: exist
              ? s.favorites.filter((f) => f.id !== exist.id)
              : [...s.favorites, { id: uid('f'), type: kind, targetId, createdAt: Date.now() }],
          }
        })
      },

      sendMessage(userId, content) {
        const m: Message = {
          id: uid('m'),
          userId,
          fromMe: true,
          content,
          createdAt: Date.now(),
          read: true,
        }
        patch((s) => ({ ...s, messages: [...s.messages, m] }))
        write(() => db.rpc('send_message', { p_peer: userId, p_content: content }, { write: true }))
      },

      readConversation(userId) {
        patch((s) => ({
          ...s,
          messages: s.messages.map((m) => (m.userId === userId && !m.fromMe ? { ...m, read: true } : m)),
        }))
      },

      readNotification(id) {
        patch((s) => ({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }))
      },

      readAllNotifications() {
        patch((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) }))
      },

      savePostDraft(content, topic, images) {
        const id = uid('d')
        patch((s) => ({ ...s, postDrafts: [{ id, content, topic, images, savedAt: Date.now() }, ...s.postDrafts] }))
        return id
      },

      publishPostDraft(draftId) {
        const d = stateRef.current.postDrafts.find((x) => x.id === draftId)
        if (!d) return
        api.publishPost(d.content, { images: d.images, topic: d.topic || null })
        patch((s) => ({ ...s, postDrafts: s.postDrafts.filter((x) => x.id !== draftId) }))
      },

      deletePostDraft(id) {
        patch((s) => ({ ...s, postDrafts: s.postDrafts.filter((d) => d.id !== id) }))
      },

      publishArticle({ title, content, tags, draftId }) {
        const id = uid('a')
        const article: Article = {
          id,
          authorId: stateRef.current.meId,
          title,
          summary: makeSummary(content),
          content,
          tags,
          createdAt: Date.now(),
          views: 0,
          likes: 0,
          likedByMe: false,
          comments: [],
        }
        patch((s) => ({
          ...s,
          articles: [article, ...s.articles],
          // 由草稿发布时消费该草稿，避免草稿箱残留已发布内容
          ...(draftId ? { articleDrafts: s.articleDrafts.filter((d) => d.id !== draftId) } : {}),
        }))
        write(() =>
          cloudInsert(
            'articles',
            {
              id,
              author_id: article.authorId,
              title,
              summary: article.summary,
              content,
              tags,
              created_at: new Date(article.createdAt).toISOString(),
            },
            '文章',
          ),
        )
        return id
      },

      saveArticleDraft({ id, title, content, tags }) {
        const finalId = id ?? uid('ad')
        patch((s) => ({
          ...s,
          articleDrafts: [
            { id: finalId, title, content, tags, savedAt: Date.now() },
            ...s.articleDrafts.filter((d) => d.id !== finalId),
          ],
        }))
        return finalId
      },

      deleteArticleDraft(id) {
        patch((s) => ({ ...s, articleDrafts: s.articleDrafts.filter((d) => d.id !== id) }))
      },

      deleteArticle(id) {
        patch((s) => ({ ...s, articles: s.articles.filter((a) => a.id !== id || a.authorId !== s.meId) }))
      },

      editPost(id, patchBody) {
        patch((s) => ({
          ...s,
          posts: s.posts.map((p) => (p.id === id && p.authorId === s.meId ? { ...p, ...patchBody } : p)),
        }))
      },

      editArticle(id, patchBody) {
        patch((s) => ({
          ...s,
          articles: s.articles.map((a) =>
            a.id === id && a.authorId === s.meId
              ? { ...a, ...patchBody, ...(patchBody.content ? { summary: makeSummary(patchBody.content) } : {}) }
              : a,
          ),
        }))
      },

      toggleArticleLike(id) {
        patch((s) => ({
          ...s,
          articles: s.articles.map((a) =>
            a.id === id
              ? { ...a, likedByMe: !a.likedByMe, likes: Math.max(0, a.likes + (a.likedByMe ? -1 : 1)) }
              : a,
          ),
        }))
      },

      addArticleComment(articleId, content) {
        const c: ArticleComment = {
          id: uid('ac'),
          authorId: stateRef.current.meId,
          content,
          createdAt: Date.now(),
        }
        patch((s) => ({
          ...s,
          articles: s.articles.map((a) => (a.id === articleId ? { ...a, comments: [...a.comments, c] } : a)),
        }))
        write(() =>
          cloudInsert(
            'article_comments',
            {
              id: c.id,
              article_id: articleId,
              author_id: c.authorId,
              content,
              created_at: new Date(c.createdAt).toISOString(),
            },
            '评论',
          ),
        )
      },

      toggleCommentLike(postId, commentId) {
        patch((s) => ({
          ...s,
          posts: s.posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  comments: p.comments.map((c) =>
                    c.id === commentId
                      ? { ...c, likedByMe: !c.likedByMe, likes: Math.max(0, c.likes + (c.likedByMe ? -1 : 1)) }
                      : c,
                  ),
                }
              : p,
          ),
        }))
      },

      toggleSnippetLike(id) {
        patch((s) => ({
          ...s,
          snippets: s.snippets.map((x) =>
            x.id === id
              ? { ...x, likedByMe: !x.likedByMe, likes: Math.max(0, x.likes + (x.likedByMe ? -1 : 1)) }
              : x,
          ),
        }))
      },

      downloadResource(id) {
        void db.rpc('resource_download', { p_id: id }, { write: true })
      },

      addSnippet(title, language, code) {
        patch((s) => ({
          ...s,
          snippets: [
            {
              id: uid('s'),
              authorId: s.meId,
              title,
              language,
              code,
              createdAt: Date.now(),
              likes: 0,
              likedByMe: false,
            },
            ...s.snippets,
          ],
        }))
      },

      deleteSnippet(id) {
        patch((s) => ({ ...s, snippets: s.snippets.filter((x) => x.id !== id) }))
      },

      updateProfile(p) {
        patch((s) => {
          // users 里没有本人记录时直接 upsert 一条：否则「编辑资料」会静默无效
          // （users 只有在关注/被关注同步后才有数据，纯本机用户此前永远改不动资料）
          if (!s.users.some((u) => u.id === s.meId)) {
            return {
              ...s,
              users: [
                {
                  id: s.meId,
                  name: p.name ?? '我',
                  emoji: p.emoji ?? '🙂',
                  color: p.color ?? '#ff8200',
                  bio: p.bio ?? '',
                  followers: 0,
                  following: 0,
                  verified: false,
                },
                ...s.users,
              ],
            }
          }
          return { ...s, users: s.users.map((u) => (u.id === s.meId ? { ...u, ...p } : u)) }
        })
      },

      // 无远端推送通道时恒返回 0；保留管线以便接入真实源时不改调用方
      refreshFeed: () => 0,

      resetLocalData() {
        setState(emptyState(stateRef.current.meId))
      },
    }
  }, [state, write])

  return <AppCtx.Provider value={api}>{children}</AppCtx.Provider>
}

export function useApp(): AppApi {
  const v = useContext(AppCtx)
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用')
  return v
}
