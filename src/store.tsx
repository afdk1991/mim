import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import { createSeedState } from './data/seed'
import type { AppState, Post, PostComment, Article, User } from './types'
import { uid } from './utils'

const STORAGE_KEY = 'mim-state-v1'

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      const valid =
        parsed &&
        typeof parsed.meId === 'string' &&
        parsed.users &&
        typeof parsed.users === 'object' &&
        [
          parsed.posts,
          parsed.articles,
          parsed.snippets,
          parsed.resources,
          parsed.notifications,
          parsed.topics,
          parsed.hotSearches,
          parsed.messages,
          parsed.favorites,
          parsed.postDrafts,
          parsed.articleDrafts,
          parsed.followingIds,
        ].every(Array.isArray)
      if (valid) {
        // 兼容旧存档：确保评论数组存在，避免缺字段导致页面崩溃
        parsed.posts = parsed.posts.map((p) => ({ ...p, comments: p.comments ?? [] }))
        parsed.articles = parsed.articles.map((a) => ({ ...a, comments: a.comments ?? [] }))
        return parsed
      }
    }
  } catch {
    /* 忽略损坏的本地数据，重新播种 */
  }
  return createSeedState()
}

type Action =
  | { type: 'publishPost'; payload: { id: string; content: string; topic: string | null; images: string[]; repostOfId: string | null; repostComment: string } }
  | { type: 'deletePost'; payload: string }
  | { type: 'togglePostLike'; payload: string }
  | { type: 'addPostComment'; payload: { postId: string; content: string } }
  | { type: 'toggleCommentLike'; payload: { postId: string; commentId: string } }
  | { type: 'toggleFollow'; payload: string }
  | { type: 'readNotification'; payload: string }
  | { type: 'readAllNotifications' }
  | { type: 'sendMessage'; payload: { id: string; userId: string; content: string } }
  | { type: 'receiveMessage'; payload: { id: string; userId: string; content: string } }
  | { type: 'readConversation'; payload: string }
  | { type: 'toggleFavorite'; payload: { kind: 'post' | 'article'; targetId: string } }
  | { type: 'savePostDraft'; payload: { content: string; topic: string | null; images: string[] } }
  | { type: 'deletePostDraft'; payload: string }
  | { type: 'publishPostDraft'; payload: string }
  | { type: 'publishArticle'; payload: { id: string; draftId: string | null; title: string; content: string; tags: string[] } }
  | { type: 'saveArticleDraft'; payload: { id: string; title: string; content: string; tags: string[] } }
  | { type: 'deleteArticleDraft'; payload: string }
  | { type: 'toggleArticleLike'; payload: string }
  | { type: 'addArticleComment'; payload: { id: string; articleId: string; content: string } }
  | { type: 'toggleSnippetLike'; payload: string }
  | { type: 'addSnippet'; payload: { id: string; title: string; language: string; code: string } }
  | { type: 'deleteSnippet'; payload: string }
  | { type: 'downloadResource'; payload: string }
  | { type: 'updateProfile'; payload: { name: string; emoji: string; color: string; bio: string } }
  | { type: 'editArticle'; payload: { id: string; title: string; content: string; tags: string[] } }
  | { type: 'deleteArticle'; payload: string }
  | { type: 'reset' }

function makeSummary(content: string): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`\-\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 72) + (text.length > 72 ? '…' : '')
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'publishPost': {
      const p = action.payload
      const posts = state.posts.map((x) =>
        p.repostOfId && x.id === p.repostOfId ? { ...x, reposts: x.reposts + 1 } : x,
      )
      const post: Post = {
        id: p.id,
        authorId: state.meId,
        content: p.repostOfId ? p.repostComment || '转发动态' : p.content,
        images: p.repostOfId ? [] : p.images,
        createdAt: Date.now(),
        repostOfId: p.repostOfId,
        repostComment: p.repostComment,
        likes: 0,
        likedByMe: false,
        reposts: 0,
        topic: p.repostOfId ? null : p.topic,
        source: '来自 网页版',
      }
      return { ...state, posts: [post, ...posts] }
    }

    case 'deletePost':
      return {
        ...state,
        posts: state.posts.filter((p) => p.id !== action.payload),
        favorites: state.favorites.filter((f) => !(f.type === 'post' && f.targetId === action.payload)),
      }

    case 'togglePostLike':
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload
            ? { ...p, likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1) }
            : p,
        ),
      }

    case 'addPostComment': {
      const comment: PostComment = {
        id: uid('c'),
        authorId: state.meId,
        content: action.payload.content,
        createdAt: Date.now(),
        likes: 0,
        likedByMe: false,
      }
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload.postId ? { ...p, comments: [...(p.comments ?? []), comment] } : p,
        ),
      }
    }

    case 'toggleCommentLike':
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload.postId
            ? {
                ...p,
                comments: (p.comments ?? []).map((c) =>
                  c.id === action.payload.commentId
                    ? { ...c, likedByMe: !c.likedByMe, likes: c.likes + (c.likedByMe ? -1 : 1) }
                    : c,
                ),
              }
            : p,
        ),
      }

    case 'toggleFollow': {
      const targetId = action.payload
      if (targetId === state.meId) return state
      const wasFollowing = state.followingIds.includes(targetId)
      const users = { ...state.users }
      const target = users[targetId]
      if (target) {
        users[targetId] = { ...target, followers: Math.max(0, target.followers + (wasFollowing ? -1 : 1)) }
      }
      const me = users[state.meId]
      if (me) {
        users[state.meId] = { ...me, following: Math.max(0, me.following + (wasFollowing ? -1 : 1)) }
      }
      return {
        ...state,
        users,
        followingIds: wasFollowing
          ? state.followingIds.filter((id) => id !== targetId)
          : [...state.followingIds, targetId],
      }
    }

    case 'readNotification':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.payload ? { ...n, read: true } : n,
        ),
      }

    case 'readAllNotifications':
      return {
        ...state,
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
      }

    case 'sendMessage': {
      const { id, userId, content } = action.payload
      return {
        ...state,
        messages: [...state.messages, { id, userId, fromMe: true, content, createdAt: Date.now(), read: true }],
      }
    }

    case 'receiveMessage': {
      const { id, userId, content } = action.payload
      return {
        ...state,
        messages: [...state.messages, { id, userId, fromMe: false, content, createdAt: Date.now(), read: false }],
      }
    }

    case 'readConversation':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.userId === action.payload && !m.fromMe ? { ...m, read: true } : m,
        ),
      }

    case 'toggleFavorite': {
      const { kind, targetId } = action.payload
      const exists = state.favorites.some((f) => f.type === kind && f.targetId === targetId)
      return {
        ...state,
        favorites: exists
          ? state.favorites.filter((f) => !(f.type === kind && f.targetId === targetId))
          : [...state.favorites, { id: uid('fa'), type: kind, targetId, createdAt: Date.now() }],
      }
    }

    case 'savePostDraft':
      return {
        ...state,
        postDrafts: [
          { id: uid('pd'), content: action.payload.content, topic: action.payload.topic, images: action.payload.images, savedAt: Date.now() },
          ...state.postDrafts,
        ],
      }

    case 'deletePostDraft':
      return { ...state, postDrafts: state.postDrafts.filter((d) => d.id !== action.payload) }

    case 'publishPostDraft': {
      const draft = state.postDrafts.find((d) => d.id === action.payload)
      if (!draft) return state
      const post: Post = {
        id: uid('p'),
        authorId: state.meId,
        content: draft.content,
        images: draft.images,
        createdAt: Date.now(),
        repostOfId: null,
        repostComment: '',
        likes: 0,
        likedByMe: false,
        reposts: 0,
        topic: draft.topic,
        source: '来自 网页版',
      }
      return { ...state, posts: [post, ...state.posts], postDrafts: state.postDrafts.filter((d) => d.id !== draft.id) }
    }

    case 'publishArticle': {
      const { id, draftId, title, content, tags } = action.payload
      const article: Article = {
        id,
        authorId: state.meId,
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
      return {
        ...state,
        articles: [article, ...state.articles],
        articleDrafts: draftId ? state.articleDrafts.filter((d) => d.id !== draftId) : state.articleDrafts,
      }
    }

    case 'editArticle':
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.payload.id
            ? {
                ...a,
                title: action.payload.title,
                summary: makeSummary(action.payload.content),
                content: action.payload.content,
                tags: action.payload.tags,
              }
            : a,
        ),
      }

    case 'deleteArticle':
      return {
        ...state,
        articles: state.articles.filter((a) => a.id !== action.payload),
        favorites: state.favorites.filter((f) => !(f.type === 'article' && f.targetId === action.payload)),
      }

    case 'updateProfile':
      return {
        ...state,
        users: { ...state.users, [state.meId]: { ...state.users[state.meId], ...action.payload } },
      }

    case 'saveArticleDraft': {
      const { id, title, content, tags } = action.payload
      const exists = state.articleDrafts.some((d) => d.id === id)
      return {
        ...state,
        articleDrafts: exists
          ? state.articleDrafts.map((d) => (d.id === id ? { ...d, title, content, tags, savedAt: Date.now() } : d))
          : [{ id, title, content, tags, savedAt: Date.now() }, ...state.articleDrafts],
      }
    }

    case 'deleteArticleDraft':
      return { ...state, articleDrafts: state.articleDrafts.filter((d) => d.id !== action.payload) }

    case 'toggleArticleLike':
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.payload
            ? { ...a, likedByMe: !a.likedByMe, likes: a.likes + (a.likedByMe ? -1 : 1) }
            : a,
        ),
      }

    case 'addArticleComment': {
      const { id, articleId, content } = action.payload
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === articleId
            ? { ...a, comments: [...a.comments, { id, authorId: state.meId, content, createdAt: Date.now() }] }
            : a,
        ),
      }
    }

    case 'toggleSnippetLike':
      return {
        ...state,
        snippets: state.snippets.map((s) =>
          s.id === action.payload
            ? { ...s, likedByMe: !s.likedByMe, likes: s.likes + (s.likedByMe ? -1 : 1) }
            : s,
        ),
      }

    case 'addSnippet': {
      const { id, title, language, code } = action.payload
      return {
        ...state,
        snippets: [
          { id, authorId: state.meId, title, language, code, createdAt: Date.now(), likes: 0, likedByMe: false },
          ...state.snippets,
        ],
      }
    }

    case 'deleteSnippet':
      return { ...state, snippets: state.snippets.filter((s) => s.id !== action.payload) }

    case 'downloadResource':
      return {
        ...state,
        resources: state.resources.map((r) =>
          r.id === action.payload ? { ...r, downloads: r.downloads + 1 } : r,
        ),
      }

    case 'reset':
      return createSeedState()

    default:
      return state
  }
}

const FALLBACK_USER: User = {
  id: 'unknown',
  name: '未知用户',
  emoji: '👤',
  color: '#9aa4b2',
  bio: '',
  followers: 0,
  following: 0,
  verified: false,
}

const AUTO_REPLIES = [
  '收到！我看一下~',
  '好嘞，回头细聊 👌',
  '赞同，这块我也在琢磨',
  '哈哈哈，正好我也在弄这块',
  '稍等，我发你个链接',
]

interface AppApi {
  state: AppState
  me: User
  user: (id: string) => User
  isFollowing: (id: string) => boolean
  isFavorited: (kind: 'post' | 'article', targetId: string) => boolean
  unreadNotifications: number
  unreadMessages: number
  publishPost: (content: string, opts?: { topic?: string | null; images?: string[] }) => string
  repostPost: (postId: string, comment: string) => string
  deletePost: (id: string) => void
  togglePostLike: (id: string) => void
  addPostComment: (postId: string, content: string) => void
  toggleCommentLike: (postId: string, commentId: string) => void
  toggleFollow: (id: string) => void
  readNotification: (id: string) => void
  readAllNotifications: () => void
  sendMessage: (userId: string, content: string) => void
  readConversation: (userId: string) => void
  toggleFavorite: (kind: 'post' | 'article', targetId: string) => void
  savePostDraft: (content: string, topic: string | null, images: string[]) => void
  deletePostDraft: (id: string) => void
  publishPostDraft: (id: string) => void
  publishArticle: (data: { title: string; content: string; tags: string[]; draftId?: string | null }) => string
  saveArticleDraft: (data: { id?: string; title: string; content: string; tags: string[] }) => string
  deleteArticleDraft: (id: string) => void
  updateProfile: (data: { name: string; emoji: string; color: string; bio: string }) => void
  editArticle: (id: string, data: { title: string; content: string; tags: string[] }) => void
  deleteArticle: (id: string) => void
  toggleArticleLike: (id: string) => void
  addArticleComment: (articleId: string, content: string) => void
  toggleSnippetLike: (id: string) => void
  addSnippet: (title: string, language: string, code: string) => void
  deleteSnippet: (id: string) => void
  downloadResource: (id: string) => void
  resetDemo: () => void
}

const AppContext = createContext<AppApi | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* 存储满时静默失败 */
    }
  }, [state])

  const api = useMemo<AppApi>(() => {
    const user = (id: string): User => state.users[id] ?? { ...FALLBACK_USER, id }
    return {
      state,
      me: user(state.meId),
      user,
      isFollowing: (id) => state.followingIds.includes(id),
      isFavorited: (kind, targetId) => state.favorites.some((f) => f.type === kind && f.targetId === targetId),
      unreadNotifications: state.notifications.filter((n) => !n.read).length,
      unreadMessages: state.messages.filter((m) => !m.fromMe && !m.read).length,

      publishPost: (content, opts) => {
        const id = uid('p')
        dispatch({
          type: 'publishPost',
          payload: { id, content, topic: opts?.topic ?? null, images: opts?.images ?? [], repostOfId: null, repostComment: '' },
        })
        return id
      },
      repostPost: (postId, comment) => {
        const id = uid('p')
        dispatch({ type: 'publishPost', payload: { id, content: '', topic: null, images: [], repostOfId: postId, repostComment: comment } })
        return id
      },
      deletePost: (id) => dispatch({ type: 'deletePost', payload: id }),
      togglePostLike: (id) => dispatch({ type: 'togglePostLike', payload: id }),
      addPostComment: (postId, content) => dispatch({ type: 'addPostComment', payload: { postId, content } }),
      toggleCommentLike: (postId, commentId) => dispatch({ type: 'toggleCommentLike', payload: { postId, commentId } }),
      toggleFollow: (id) => dispatch({ type: 'toggleFollow', payload: id }),
      readNotification: (id) => dispatch({ type: 'readNotification', payload: id }),
      readAllNotifications: () => dispatch({ type: 'readAllNotifications' }),
      sendMessage: (userId, content) => {
        dispatch({ type: 'sendMessage', payload: { id: uid('m'), userId, content } })
        const reply = AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)]
        window.setTimeout(() => {
          dispatch({ type: 'receiveMessage', payload: { id: uid('m'), userId, content: reply } })
        }, 900)
      },
      readConversation: (userId) => dispatch({ type: 'readConversation', payload: userId }),
      toggleFavorite: (kind, targetId) => dispatch({ type: 'toggleFavorite', payload: { kind, targetId } }),
      savePostDraft: (content, topic, images) => dispatch({ type: 'savePostDraft', payload: { content, topic, images } }),
      deletePostDraft: (id) => dispatch({ type: 'deletePostDraft', payload: id }),
      publishPostDraft: (id) => dispatch({ type: 'publishPostDraft', payload: id }),
      publishArticle: ({ title, content, tags, draftId }) => {
        const id = uid('a')
        dispatch({ type: 'publishArticle', payload: { id, draftId: draftId ?? null, title, content, tags } })
        return id
      },
      saveArticleDraft: ({ id, title, content, tags }) => {
        const finalId = id ?? uid('ad')
        dispatch({ type: 'saveArticleDraft', payload: { id: finalId, title, content, tags } })
        return finalId
      },
      deleteArticleDraft: (id) => dispatch({ type: 'deleteArticleDraft', payload: id }),
      updateProfile: (data) => dispatch({ type: 'updateProfile', payload: data }),
      editArticle: (id, data) => dispatch({ type: 'editArticle', payload: { id, ...data } }),
      deleteArticle: (id) => dispatch({ type: 'deleteArticle', payload: id }),
      toggleArticleLike: (id) => dispatch({ type: 'toggleArticleLike', payload: id }),
      addArticleComment: (articleId, content) =>
        dispatch({ type: 'addArticleComment', payload: { id: uid('ac'), articleId, content } }),
      toggleSnippetLike: (id) => dispatch({ type: 'toggleSnippetLike', payload: id }),
      addSnippet: (title, language, code) =>
        dispatch({ type: 'addSnippet', payload: { id: uid('s'), title, language, code } }),
      deleteSnippet: (id) => dispatch({ type: 'deleteSnippet', payload: id }),
      downloadResource: (id) => dispatch({ type: 'downloadResource', payload: id }),
      resetDemo: () => dispatch({ type: 'reset' }),
    }
  }, [state])

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用')
  return ctx
}
