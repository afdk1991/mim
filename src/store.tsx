/* 全局状态中台。
   身份模型：state.meId = 当前扮演的演示身份（seed 用户 me/u1..u9，内容 authorId 域）；
   真实登录身份（AuthState.userId，见 auth.tsx）不进此 store——
   钱包/订单等钱类数据在 mall 中台按真实身份隔离，内容权限由 can()（permissions.ts）+ reducer ownership 守卫双层兜底。 */
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import { createSeedState } from './data/seed'
import type { AppState, Post, PostComment, Article, Snippet, User, PostMedia, PostVote, PostLottery } from './types'
import { uid } from './utils'
import {
  cloudWritePost,
  cloudWriteArticle,
  cloudWriteSnippet,
  cloudWritePostComment,
  cloudWriteArticleComment,
  cloudLikePost,
  cloudLikeComment,
  cloudLikeArticle,
  cloudLikeSnippet,
  cloudDeletePost,
  cloudDeleteArticle,
  cloudDeleteSnippet,
  cloudUpdateArticle,
  cloudUpdatePost,
  cloudSetFollow,
  cloudSetFavorite,
  cloudWriteProfile,
  cloudUpsertPostDraft,
  cloudDeletePostDraft,
  cloudUpsertArticleDraft,
  cloudDeleteArticleDraft,
  cloudReadConversation,
  cloudReadNotifications,
  type CloudResult,
} from './lib/cloud-write'
import { pullCloudContent, type CloudPayload } from './lib/cloud-read'
import { cloudSendMessage, subscribeMessages } from './lib/cloud-msg'
import { supabase, cloudEnabled } from './lib/supabase'
import { recordGrowth } from './growth'
import { revenueSnapshot, walletIncome } from './wallet'

const STORAGE_KEY = 'mim-state-v2'

/**
 * 云端真实模式迁移（Supabase 已配置时对历史 localStorage 存档执行）：
 * 演示域数据（u1..u9 的内容/关注/通知/私信，演示超话/热搜/资源库）全部剔除，
 * 仅保留「我」自产的帖子/文章/片段、其收藏与草稿——这些是用户真实创作，
 * 上云前不丢失；登录并拉取云端后与云端行同 id 合并。
 */
function migrateLegacyForCloud(s: AppState): AppState {
  if (!s.users['me']) return createSeedState()
  const keepPostIds = new Set(s.posts.filter((p) => p.authorId === 'me').map((p) => p.id))
  const keepArticleIds = new Set(s.articles.filter((a) => a.authorId === 'me').map((a) => a.id))
  return {
    ...s,
    meId: 'me',
    users: { me: s.users['me'] },
    posts: s.posts.filter((p) => p.authorId === 'me'),
    articles: s.articles.filter((a) => a.authorId === 'me'),
    snippets: s.snippets.filter((x) => x.authorId === 'me'),
    resources: [],
    topics: [],
    hotSearches: [],
    notifications: [],
    messages: [],
    followingIds: [],
    favorites: s.favorites.filter(
      (f) =>
        (f.type === 'post' && keepPostIds.has(f.targetId)) ||
        (f.type === 'article' && keepArticleIds.has(f.targetId)),
    ),
  }
}

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
        // 兜底：meId 必须存在于 users，否则整站头像/昵称落 FALLBACK_USER
        if (!parsed.users[parsed.meId]) {
          if (parsed.users['me']) parsed.meId = 'me'
          else return createSeedState()
        }
        // 兼容旧存档：确保评论数组存在，避免缺字段导致页面崩溃
        parsed.posts = parsed.posts.map((p) => ({ ...p, comments: p.comments ?? [] }))
        parsed.articles = parsed.articles.map((a) => ({ ...a, comments: a.comments ?? [] }))
        // 兜底：cloudIds 为轮 4 新增可选字段，旧存档缺失时补空集
        if (!parsed.cloudIds) parsed.cloudIds = { users: [], posts: [], articles: [], snippets: [] }
        // 云端真实模式：历史存档剔除演示域数据（见 migrateLegacyForCloud），纯本地模式不受影响
        if (cloudEnabled) return migrateLegacyForCloud(parsed)
        return parsed
      }
    }
  } catch {
    /* 忽略损坏的本地数据，重新播种 */
  }
  return createSeedState()
}

type Action =
  /* 轮 21 打通：发布动态扩参——视频/GIF、投票、抽奖、位置、可见性、24h 快拍（全部可选，旧调用兼容） */
  | {
      type: 'publishPost'
      payload: {
        id: string
        content: string
        topic: string | null
        images: string[]
        repostOfId: string | null
        repostComment: string
        media?: PostMedia
        vote?: PostVote
        lottery?: PostLottery
        location?: string
        visibility?: 'public' | 'self'
        story?: boolean
        expiresAt?: number
      }
    }
  | { type: 'deletePost'; payload: string }
  | { type: 'togglePostLike'; payload: string }
  | { type: 'addPostComment'; payload: { id: string; postId: string; content: string; replyTo?: string } }
  | { type: 'toggleCommentLike'; payload: { postId: string; commentId: string } }
  | { type: 'castVote'; payload: { postId: string; option: string } }
  | { type: 'joinLottery'; payload: string }
  | { type: 'drawLottery'; payload: { postId: string; winners: string[] } }
  | { type: 'toggleFollow'; payload: string }
  | { type: 'readNotification'; payload: string }
  | { type: 'readAllNotifications' }
  | { type: 'sendMessage'; payload: { id: string; userId: string; content: string; createdAt?: number } }
  | { type: 'receiveMessage'; payload: { id: string; userId: string; content: string; createdAt?: number } }
  | { type: 'readConversation'; payload: string }
  | { type: 'cloudRollbackMessage'; payload: string }
  | { type: 'toggleFavorite'; payload: { kind: 'post' | 'article'; targetId: string } }
  | { type: 'savePostDraft'; payload: { id?: string; content: string; topic: string | null; images: string[] } }
  | { type: 'deletePostDraft'; payload: string }
  | { type: 'publishPostDraft'; payload: { draftId: string; postId: string } }
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
  | { type: 'editPost'; payload: { id: string; content: string; images: string[] } }
  | { type: 'deleteArticle'; payload: string }
  | { type: 'setIdentity'; payload: { meId: string; user?: User } }
  | { type: 'cloudRollbackPost'; payload: string }
  | { type: 'cloudRollbackArticle'; payload: string }
  | { type: 'cloudRollbackSnippet'; payload: string }
  | { type: 'cloudMark'; payload: { kind: 'posts' | 'articles' | 'snippets'; id: string } }
  | { type: 'cloudMerge'; payload: CloudPayload }
  | { type: 'cloudRollbackPostComment'; payload: { postId: string; commentId: string } }
  | { type: 'cloudRollbackArticleComment'; payload: { articleId: string; commentId: string } }
  | { type: 'cloudRestorePost'; payload: Post }
  | { type: 'cloudRestoreArticle'; payload: Article }
  | { type: 'cloudRestoreSnippet'; payload: Snippet }
  | { type: 'reset' }

function makeSummary(content: string): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`\-\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 72) + (text.length > 72 ? '…' : '')
}

/* 云端写火后不管：本地已乐观更新。'ok' → onOk（注册 cloudIds，标记内容此后走云端）；
   'skip'（未登录/未配置）→ 静默；'fail' → rollback（cloud-write 层已 toast）。 */
function fireCloudWrite<T>(
  write: (entity: T) => Promise<CloudResult>,
  entity: T,
  onOk: () => void,
  rollback: () => void,
): void {
  void write(entity).then((r) => {
    if (r === 'ok') onOk()
    else if (r === 'fail') rollback()
  })
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
        /* 轮 21 打通：B2 扩展字段直通入库（缺省字段不写，seed/旧存档兼容） */
        media: p.repostOfId ? undefined : p.media,
        vote: p.repostOfId ? undefined : p.vote,
        lottery: p.repostOfId ? undefined : p.lottery,
        location: p.repostOfId ? undefined : p.location,
        visibility: p.visibility ?? 'public',
        story: p.repostOfId ? undefined : p.story,
        expiresAt: p.repostOfId ? undefined : p.expiresAt,
      }
      return { ...state, posts: [post, ...posts] }
    }

    case 'deletePost': {
      const post = state.posts.find((p) => p.id === action.payload)
      if (!post || post.authorId !== state.meId) return state
      return {
        ...state,
        posts: state.posts.filter((p) => p.id !== action.payload),
        favorites: state.favorites.filter((f) => !(f.type === 'post' && f.targetId === action.payload)),
      }
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
        id: action.payload.id,
        authorId: state.meId,
        content: action.payload.content,
        createdAt: Date.now(),
        likes: 0,
        likedByMe: false,
        /* 轮 21 打通：楼中楼——记录被回复评论 id */
        replyTo: action.payload.replyTo,
      }
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload.postId ? { ...p, comments: [...(p.comments ?? []), comment] } : p,
        ),
      }
    }

    /* 轮 21 打通：投票——一人一票（voters 按身份 key 判重），截止后锁定 */
    case 'castVote': {
      const target = state.posts.find((p) => p.id === action.payload.postId)
      const vote = target?.vote
      if (!vote || Date.now() > vote.endsAt) return state
      if (vote.voters[state.meId] || !vote.options.includes(action.payload.option)) return state
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload.postId && p.vote
            ? {
                ...p,
                vote: {
                  ...p.vote,
                  votes: { ...p.vote.votes, [action.payload.option]: (p.vote.votes[action.payload.option] ?? 0) + 1 },
                  voters: { ...p.vote.voters, [state.meId]: action.payload.option },
                },
              }
            : p,
        ),
      }
    }

    /* 轮 21 打通：抽奖参与——按身份 key 去重 */
    case 'joinLottery': {
      const target = state.posts.find((p) => p.id === action.payload)
      if (!target?.lottery || target.lottery.winners) return state
      if (target.lottery.participants.includes(state.meId)) return state
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload && p.lottery
            ? { ...p, lottery: { ...p.lottery, participants: [...p.lottery.participants, state.meId] } }
            : p,
        ),
      }
    }

    /* 轮 21 打通：抽奖开奖——调用方随机抽好 winners（≤份数且 ⊆ 参与者），此处落库公示 */
    case 'drawLottery': {
      const { postId, winners } = action.payload
      const target = state.posts.find((p) => p.id === postId)
      const lot = target?.lottery
      if (!lot || lot.winners) return state
      const valid = winners.every((w) => lot.participants.includes(w)) && winners.length <= lot.count
      if (!valid) return state
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === postId && p.lottery ? { ...p, lottery: { ...p.lottery, winners } } : p,
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
      const { id, userId, content, createdAt } = action.payload
      // 按 id 去重：Realtime 推送与云端 pull 竞态时避免同一条消息重复入列
      if (state.messages.some((m) => m.id === id)) return state
      return {
        ...state,
        messages: [...state.messages, { id, userId, fromMe: false, content, createdAt: createdAt ?? Date.now(), read: false }],
      }
    }

    case 'readConversation':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.userId === action.payload && !m.fromMe ? { ...m, read: true } : m,
        ),
      }

    /* 私信云端写失败回滚：按 id 移除乐观行 */
    case 'cloudRollbackMessage':
      return { ...state, messages: state.messages.filter((m) => m.id !== action.payload) }

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
          { id: action.payload.id ?? uid('pd'), content: action.payload.content, topic: action.payload.topic, images: action.payload.images, savedAt: Date.now() },
          ...state.postDrafts,
        ],
      }

    case 'deletePostDraft':
      return { ...state, postDrafts: state.postDrafts.filter((d) => d.id !== action.payload) }

    case 'publishPostDraft': {
      const draft = state.postDrafts.find((d) => d.id === action.payload.draftId)
      if (!draft) return state
      const post: Post = {
        id: action.payload.postId,
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

    case 'editArticle': {
      const target = state.articles.find((a) => a.id === action.payload.id)
      if (!target || target.authorId !== state.meId) return state
      // 云端异步同步（失败不回滚，本地已是最新）
      cloudUpdateArticle(action.payload.id, {
        title: action.payload.title,
        summary: makeSummary(action.payload.content),
        content: action.payload.content,
        tags: action.payload.tags,
      })
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
    }

    case 'deleteArticle': {
      const target = state.articles.find((a) => a.id === action.payload)
      if (!target || target.authorId !== state.meId) return state
      return {
        ...state,
        articles: state.articles.filter((a) => a.id !== action.payload),
        favorites: state.favorites.filter((f) => !(f.type === 'article' && f.targetId === action.payload)),
      }
    }

    case 'editPost': {
      const target = state.posts.find((p) => p.id === action.payload.id)
      if (!target || target.authorId !== state.meId) return state
      // 云端异步同步（失败不回滚，本地已是最新）
      cloudUpdatePost(action.payload.id, {
        content: action.payload.content,
        images: action.payload.images,
      })
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload.id
            ? { ...p, content: action.payload.content, images: action.payload.images }
            : p,
        ),
      }
    }

    case 'updateProfile': {
      const me = state.users[state.meId]
      // 云端异步同步（失败不回滚，本地已是最新）
      cloudWriteProfile({
        name: action.payload.name ?? me.name,
        emoji: action.payload.emoji ?? me.emoji,
        color: action.payload.color ?? me.color,
        bio: action.payload.bio ?? me.bio,
      })
      return {
        ...state,
        users: { ...state.users, [state.meId]: { ...me, ...action.payload } },
      }
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

    case 'deleteSnippet': {
      const target = state.snippets.find((s) => s.id === action.payload)
      if (!target || target.authorId !== state.meId) return state
      return { ...state, snippets: state.snippets.filter((s) => s.id !== action.payload) }
    }

    case 'downloadResource':
      return {
        ...state,
        resources: state.resources.map((r) =>
          r.id === action.payload ? { ...r, downloads: r.downloads + 1 } : r,
        ),
      }

    case 'setIdentity': {
      const { meId, user } = action.payload
      if (!user && !state.users[meId]) return state
      const users = user ? { ...state.users, [meId]: user } : state.users
      return { ...state, meId, users }
    }

    /* 云端写失败回滚：仅移除当前身份新建的乐观条目，防误删他人/旧数据 */
    case 'cloudRollbackPost':
      return {
        ...state,
        posts: state.posts.filter((p) => !(p.id === action.payload && p.authorId === state.meId)),
        favorites: state.favorites.filter((f) => !(f.type === 'post' && f.targetId === action.payload)),
      }

    case 'cloudRollbackArticle':
      return {
        ...state,
        articles: state.articles.filter((a) => !(a.id === action.payload && a.authorId === state.meId)),
      }

    case 'cloudRollbackSnippet':
      return {
        ...state,
        snippets: state.snippets.filter((s) => !(s.id === action.payload && s.authorId === state.meId)),
      }

    /* ---- 轮 4 云端读写路径 ---- */

    /* 写成功注册：该 id 此后的写操作分流到云端 */
    case 'cloudMark': {
      const { kind, id } = action.payload
      const prev = state.cloudIds ?? { users: [], posts: [], articles: [], snippets: [] }
      if (prev[kind].includes(id)) return state
      return { ...state, cloudIds: { ...prev, [kind]: [id, ...prev[kind]] } }
    }

    /* 云端读路径合并：云端行覆盖同 id 本地行（乐观行 authorId 矫正为真实档案 id），
       其余云端行按 createdAt 混排；关注/收藏取并集；cloudIds 并入拉取到的云端 id 全集。 */
    case 'cloudMerge': {
      const c = action.payload
      const postSet = new Set(c.posts.map((p) => p.id))
      const articleSet = new Set(c.articles.map((a) => a.id))
      const snippetSet = new Set(c.snippets.map((s) => s.id))
      // 乐观窗口保护：云端行无评论而本地同 id 行已有评论时保留本地评论
      const posts = [
        ...c.posts.map((cp) => {
          const local = state.posts.find((p) => p.id === cp.id)
          return local?.comments?.length && !cp.comments?.length ? { ...cp, comments: local.comments } : cp
        }),
        ...state.posts.filter((p) => !postSet.has(p.id)),
      ].sort((a, b) => b.createdAt - a.createdAt)
      const articles = [
        ...c.articles.map((ca) => {
          const local = state.articles.find((a) => a.id === ca.id)
          return local?.comments.length && !ca.comments.length ? { ...ca, comments: local.comments } : ca
        }),
        ...state.articles.filter((a) => !articleSet.has(a.id)),
      ].sort((a, b) => b.createdAt - a.createdAt)
      const snippets = [
        ...c.snippets,
        ...state.snippets.filter((s) => !snippetSet.has(s.id)),
      ].sort((a, b) => b.createdAt - a.createdAt)
      const favKeys = new Set(c.favorites.map((f) => `${f.type}:${f.targetId}`))
      const favorites = [...c.favorites, ...state.favorites.filter((f) => !favKeys.has(`${f.type}:${f.targetId}`))]
      // 私信合并：云端行（owner 侧全集）替换同 id 乐观行，其余本地行保留，按时间正序
      const msgSet = new Set(c.messages.map((m) => m.id))
      const messages = [...c.messages, ...state.messages.filter((m) => !msgSet.has(m.id))].sort(
        (a, b) => a.createdAt - b.createdAt,
      )
      // 通知合并：云端行替换同 id 本地行（云端为真实用户通知真源），按时间倒序
      const notifSet = new Set(c.notifications.map((n) => n.id))
      const notifications = [
        ...c.notifications,
        ...state.notifications.filter((n) => !notifSet.has(n.id)),
      ].sort((a, b) => b.createdAt - a.createdAt)
      // 草稿合并：云端行替换同 id 本地行（跨设备续写，云端为真源），按保存时间倒序
      const pdSet = new Set(c.postDrafts.map((d) => d.id))
      const postDrafts = [
        ...c.postDrafts,
        ...state.postDrafts.filter((d) => !pdSet.has(d.id)),
      ].sort((a, b) => b.savedAt - a.savedAt)
      const adSet = new Set(c.articleDrafts.map((d) => d.id))
      const articleDrafts = [
        ...c.articleDrafts,
        ...state.articleDrafts.filter((d) => !adSet.has(d.id)),
      ].sort((a, b) => b.savedAt - a.savedAt)
      const prev = state.cloudIds ?? { users: [], posts: [], articles: [], snippets: [] }
      return {
        ...state,
        users: { ...state.users, ...c.users },
        posts,
        articles,
        snippets,
        favorites,
        messages,
        notifications,
        postDrafts,
        articleDrafts,
        followingIds: Array.from(new Set([...state.followingIds, ...c.followingIds])),
        cloudIds: {
          users: Array.from(new Set([...prev.users, ...Object.keys(c.users)])),
          posts: Array.from(new Set([...prev.posts, ...postSet])),
          articles: Array.from(new Set([...prev.articles, ...articleSet])),
          snippets: Array.from(new Set([...prev.snippets, ...snippetSet])),
        },
      }
    }

    /* 评论写失败回滚：仅移除当前身份刚插入的乐观评论 */
    case 'cloudRollbackPostComment':
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === action.payload.postId
            ? { ...p, comments: (p.comments ?? []).filter((cm) => !(cm.id === action.payload.commentId && cm.authorId === state.meId)) }
            : p,
        ),
      }

    case 'cloudRollbackArticleComment':
      return {
        ...state,
        articles: state.articles.map((a) =>
          a.id === action.payload.articleId
            ? { ...a, comments: a.comments.filter((cm) => !(cm.id === action.payload.commentId && cm.authorId === state.meId)) }
            : a,
        ),
      }

    /* 删除/编辑云端失败恢复：把操作前快照放回列表 */
    case 'cloudRestorePost': {
      const p = action.payload
      const exists = state.posts.some((x) => x.id === p.id)
      return { ...state, posts: exists ? state.posts.map((x) => (x.id === p.id ? p : x)) : [p, ...state.posts] }
    }

    case 'cloudRestoreArticle': {
      const a = action.payload
      const exists = state.articles.some((x) => x.id === a.id)
      return { ...state, articles: exists ? state.articles.map((x) => (x.id === a.id ? a : x)) : [a, ...state.articles] }
    }

    case 'cloudRestoreSnippet': {
      const s = action.payload
      const exists = state.snippets.some((x) => x.id === s.id)
      return { ...state, snippets: exists ? state.snippets.map((x) => (x.id === s.id ? s : x)) : [s, ...state.snippets] }
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
  publishPost: (
    content: string,
    /* 轮 21 打通：发布扩参——媒体/投票/抽奖/位置/可见性/快拍全部可选 */
    opts?: {
      topic?: string | null
      images?: string[]
      media?: PostMedia
      vote?: PostVote
      lottery?: PostLottery
      location?: string
      visibility?: 'public' | 'self'
      story?: boolean
      expiresAt?: number
    },
  ) => string
  repostPost: (postId: string, comment: string) => string
  deletePost: (id: string) => void
  togglePostLike: (id: string) => void
  addPostComment: (postId: string, content: string, replyTo?: string) => void
  toggleCommentLike: (postId: string, commentId: string) => void
  /* 轮 21 打通：投票 / 抽奖（开奖 winners 由调用方随机抽出后传入） */
  castVote: (postId: string, option: string) => void
  joinLottery: (postId: string) => void
  drawLottery: (postId: string, winners: string[]) => void
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
  editPost: (id: string, data: { content: string; images: string[] }) => void
  deleteArticle: (id: string) => void
  toggleArticleLike: (id: string) => void
  addArticleComment: (articleId: string, content: string) => void
  toggleSnippetLike: (id: string) => void
  addSnippet: (title: string, language: string, code: string) => void
  deleteSnippet: (id: string) => void
  downloadResource: (id: string) => void
  switchDemoUser: (id: string) => void
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

  /* 轮 4 读路径：启动拉取云端内容合并本地；SIGNED_IN（登录成功/会话恢复）时重拉。
     轮 5：登录态下订阅 messages Realtime（对方来信实时推送），登出/卸载退订。 */
  useEffect(() => {
    if (!cloudEnabled || !supabase) return
    const sb = supabase // 闭包内不可依赖模块导入的窄化，捕获局部引用
    let alive = true
    let unsubMsg: (() => void) | null = null
    const pull = () => {
      void pullCloudContent().then((payload) => {
        if (!payload || !alive) return
        dispatch({ type: 'cloudMerge', payload })
        // 身份对齐：登录后 meId 切到 auth uuid。否则云端行的 authorId 是 uuid、
        // 本地 meId 仍为 'me'，个人主页/删除/编辑会认不出自己发布的内容。
        void sb.auth.getSession().then(({ data }) => {
          const uid = data.session?.user?.id
          if (!uid || !alive) return
          const me = payload.users[uid] ?? {
            id: uid,
            name: '新用户',
            emoji: '🙂',
            color: '#4f7cff',
            bio: '',
            followers: 0,
            following: 0,
            verified: false,
          }
          dispatch({ type: 'setIdentity', payload: { meId: uid, user: me } })
        })
        // 云端历史同步到本地 localStorage（loadHistory 同步读本地）
        import('./lib/cloud-history').then((m) => m.cloudSyncHistoryToLocal())
      })
    }
    const startRealtime = () => {
      void sb.auth.getSession().then(({ data: s }) => {
        const meId = s.session?.user?.id
        if (!meId || !alive) return
        unsubMsg?.()
        unsubMsg = subscribeMessages(meId, (m) => dispatch({ type: 'receiveMessage', payload: m }))
      })
    }
    pull()
    startRealtime()
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        pull()
        startRealtime()
      }
      if (event === 'SIGNED_OUT') {
        if (unsubMsg) {
          unsubMsg()
          unsubMsg = null
        }
        // 登出回落本地占位身份，保持 users['me'] 兜底，避免整站头像/昵称落 FALLBACK_USER
        dispatch({ type: 'setIdentity', payload: { meId: 'me' } })
      }
    })
    return () => {
      alive = false
      unsubMsg?.()
      data.subscription.unsubscribe()
    }
  }, [])

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
        const images = opts?.images ?? []
        const topic = opts?.topic ?? null
        dispatch({
          type: 'publishPost',
          payload: {
            id,
            content,
            topic,
            images,
            repostOfId: null,
            repostComment: '',
            /* 轮 21 打通：B2 扩展字段直通 reducer（云端行仅映射基础字段，扩展能力为本地 demo 域） */
            media: opts?.media,
            vote: opts?.vote,
            lottery: opts?.lottery,
            location: opts?.location,
            visibility: opts?.visibility,
            story: opts?.story,
            expiresAt: opts?.expiresAt,
          },
        })
        // 轮 13 打通：发布动态 → 成长引擎广场线记分（publish_dynamic +2 EXP，受日上限约束）
        recordGrowth('publish_dynamic')
        fireCloudWrite(
          cloudWritePost,
          { id, authorId: state.meId, content, images, createdAt: Date.now(), repostOfId: null, repostComment: '', likes: 0, likedByMe: false, reposts: 0, topic, source: '来自 网页版' },
          () => dispatch({ type: 'cloudMark', payload: { kind: 'posts', id } }),
          () => dispatch({ type: 'cloudRollbackPost', payload: id }),
        )
        return id
      },
      repostPost: (postId, comment) => {
        const id = uid('p')
        dispatch({ type: 'publishPost', payload: { id, content: '', topic: null, images: [], repostOfId: postId, repostComment: comment } })
        fireCloudWrite(
          cloudWritePost,
          { id, authorId: state.meId, content: '', images: [], createdAt: Date.now(), repostOfId: postId, repostComment: comment, likes: 0, likedByMe: false, reposts: 0, topic: null, source: '来自 网页版' },
          () => dispatch({ type: 'cloudMark', payload: { kind: 'posts', id } }),
          () => dispatch({ type: 'cloudRollbackPost', payload: id }),
        )
        return id
      },
      deletePost: (id) => {
        const snap = state.posts.find((p) => p.id === id)
        dispatch({ type: 'deletePost', payload: id })
        if (snap && state.cloudIds?.posts.includes(id)) {
          void cloudDeletePost(id).then((ok) => {
            if (!ok) dispatch({ type: 'cloudRestorePost', payload: snap })
          })
        }
      },
      togglePostLike: (id) => {
        const p = state.posts.find((x) => x.id === id)
        dispatch({ type: 'togglePostLike', payload: id })
        // 轮 13 打通：自己的动态获赞 → 广场线 dynamic_liked（点赞且此前未赞才计）
        if (p && p.authorId === state.meId && !p.likedByMe) recordGrowth('dynamic_liked')
        if (p && state.cloudIds?.posts.includes(id)) {
          void cloudLikePost(id, !p.likedByMe).then((ok) => {
            if (!ok) dispatch({ type: 'togglePostLike', payload: id })
          })
        }
      },
      addPostComment: (postId, content, replyTo) => {
        const id = uid('c')
        dispatch({ type: 'addPostComment', payload: { id, postId, content, replyTo } })
        if (state.cloudIds?.posts.includes(postId)) {
          void cloudWritePostComment(id, postId, content).then((r) => {
            if (r === 'fail') dispatch({ type: 'cloudRollbackPostComment', payload: { postId, commentId: id } })
          })
        }
      },
      /* 轮 21 打通：投票 / 抽奖走本地 reducer（投票与开奖均为 demo 域，不落云端） */
      castVote: (postId, option) => dispatch({ type: 'castVote', payload: { postId, option } }),
      joinLottery: (postId) => dispatch({ type: 'joinLottery', payload: postId }),
      drawLottery: (postId, winners) => dispatch({ type: 'drawLottery', payload: { postId, winners } }),
      toggleCommentLike: (postId, commentId) => {
        const c = state.posts.find((x) => x.id === postId)?.comments?.find((x) => x.id === commentId)
        dispatch({ type: 'toggleCommentLike', payload: { postId, commentId } })
        if (c && state.cloudIds?.posts.includes(postId)) {
          void cloudLikeComment(commentId, !c.likedByMe).then((ok) => {
            if (!ok) dispatch({ type: 'toggleCommentLike', payload: { postId, commentId } })
          })
        }
      },
      toggleFollow: (id) => {
        const wasFollowing = state.followingIds.includes(id)
        dispatch({ type: 'toggleFollow', payload: id })
        // 仅云端 profile 用户走云端关注表；seed 演示用户保持纯本地
        if (state.cloudIds?.users.includes(id)) {
          void cloudSetFollow(id, !wasFollowing).then((ok) => {
            if (!ok) dispatch({ type: 'toggleFollow', payload: id })
          })
        }
      },
      readNotification: (id) => {
        dispatch({ type: 'readNotification', payload: id })
        // 云端已读回写（未登录时内部自动 skip）；通知 id 为 text 列，无需 uuid 守卫
        void cloudReadNotifications(id)
      },
      readAllNotifications: () => {
        dispatch({ type: 'readAllNotifications' })
        void cloudReadNotifications()
      },
      sendMessage: (userId, content) => {
        const msgId = uid('m')
        dispatch({ type: 'sendMessage', payload: { id: msgId, userId, content } })
        // 云端真实用户走 send_message RPC（失败回滚乐观行）；seed 演示用户保持模拟回复
        if (state.cloudIds?.users.includes(userId)) {
          void cloudSendMessage(userId, content).then((r) => {
            if (r === 'fail') dispatch({ type: 'cloudRollbackMessage', payload: msgId })
          })
          return
        }
        const reply = AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)]
        window.setTimeout(() => {
          dispatch({ type: 'receiveMessage', payload: { id: uid('m'), userId, content: reply } })
        }, 900)
      },
      readConversation: (userId) => {
        dispatch({ type: 'readConversation', payload: userId })
        // 云端真实用户（uuid）才可回写已读；seed id 不是 uuid 会 22P02，须守卫
        if (state.cloudIds?.users.includes(userId)) void cloudReadConversation(userId)
      },
      toggleFavorite: (kind, targetId) => {
        const exists = state.favorites.some((f) => f.type === kind && f.targetId === targetId)
        dispatch({ type: 'toggleFavorite', payload: { kind, targetId } })
        // 轮 13 打通：新增博文收藏 → 知识线 article_collected（取消收藏不计分）
        if (kind === 'article' && !exists) recordGrowth('article_collected')
        const cloud = kind === 'post'
          ? state.cloudIds?.posts.includes(targetId)
          : state.cloudIds?.articles.includes(targetId)
        if (cloud) {
          void cloudSetFavorite(kind, targetId, !exists).then((ok) => {
            if (!ok) dispatch({ type: 'toggleFavorite', payload: { kind, targetId } })
          })
        }
      },
      savePostDraft: (content, topic, images) => {
        const draftId = uid('pd')
        dispatch({ type: 'savePostDraft', payload: { id: draftId, content, topic, images } })
        // 草稿云端同步（未登录时内部自动 skip），跨设备续写
        void cloudUpsertPostDraft({ id: draftId, content, topic, images, savedAt: Date.now() })
      },
      deletePostDraft: (id) => {
        dispatch({ type: 'deletePostDraft', payload: id })
        void cloudDeletePostDraft(id)
      },
      publishPostDraft: (draftId) => {
        const postId = uid('p')
        dispatch({ type: 'publishPostDraft', payload: { draftId, postId } })
        // 轮 13 打通：草稿发布与直接发布同口径记分（publish_dynamic）
        recordGrowth('publish_dynamic')
        const draft = state.postDrafts.find((d) => d.id === draftId)
        if (draft) {
          fireCloudWrite(
            cloudWritePost,
            { id: postId, authorId: state.meId, content: draft.content, images: draft.images, createdAt: Date.now(), repostOfId: null, repostComment: '', likes: 0, likedByMe: false, reposts: 0, topic: draft.topic, source: '来自 网页版' },
            () => dispatch({ type: 'cloudMark', payload: { kind: 'posts', id: postId } }),
            () => dispatch({ type: 'cloudRollbackPost', payload: postId }),
          )
        }
        // 草稿已发布，同步删除云端草稿（未同步过时为幂等空操作）
        void cloudDeletePostDraft(draftId)
      },
      publishArticle: ({ title, content, tags, draftId }) => {
        const id = uid('a')
        dispatch({ type: 'publishArticle', payload: { id, draftId: draftId ?? null, title, content, tags } })
        // 轮 13 打通：发布博文 → 知识线记分（publish_article +10 POINT）。
        // 质量门 demo 口径：正文去空白 ≥ 50 字视为过门，未过则引擎拒记并 toast。
        recordGrowth('publish_article', { quality: content.replace(/\s/g, '').length >= 50 })
        fireCloudWrite(
          cloudWriteArticle,
          { id, authorId: state.meId, title, summary: makeSummary(content), content, tags, createdAt: Date.now(), views: 0, likes: 0, likedByMe: false, comments: [] },
          () => dispatch({ type: 'cloudMark', payload: { kind: 'articles', id } }),
          () => dispatch({ type: 'cloudRollbackArticle', payload: id }),
        )
        if (draftId) void cloudDeleteArticleDraft(draftId)
        return id
      },
      saveArticleDraft: ({ id, title, content, tags }) => {
        const finalId = id ?? uid('ad')
        dispatch({ type: 'saveArticleDraft', payload: { id: finalId, title, content, tags } })
        void cloudUpsertArticleDraft({ id: finalId, title, content, tags, savedAt: Date.now() })
        return finalId
      },
      deleteArticleDraft: (id) => {
        dispatch({ type: 'deleteArticleDraft', payload: id })
        void cloudDeleteArticleDraft(id)
      },
      updateProfile: (data) => {
        dispatch({ type: 'updateProfile', payload: data })
        // 真实档案始终尝试云端同步（未登录时 skip）；失败仅 toast，本地档案保留
        void cloudWriteProfile(data)
      },
      editArticle: (id, data) => {
        const snap = state.articles.find((a) => a.id === id)
        dispatch({ type: 'editArticle', payload: { id, ...data } })
        if (snap && state.cloudIds?.articles.includes(id)) {
          void cloudUpdateArticle(id, {
            title: data.title,
            summary: makeSummary(data.content),
            content: data.content,
            tags: data.tags,
          }).then((ok) => {
            if (!ok) dispatch({ type: 'cloudRestoreArticle', payload: snap })
          })
        }
      },
      editPost: (id, data) => {
        const snap = state.posts.find((p) => p.id === id)
        dispatch({ type: 'editPost', payload: { id, ...data } })
        if (snap && state.cloudIds?.posts.includes(id)) {
          void cloudUpdatePost(id, { content: data.content, images: data.images }).then((ok) => {
            if (!ok) dispatch({ type: 'cloudRestorePost', payload: snap })
          })
        }
      },
      deleteArticle: (id) => {
        const snap = state.articles.find((a) => a.id === id)
        dispatch({ type: 'deleteArticle', payload: id })
        if (snap && state.cloudIds?.articles.includes(id)) {
          void cloudDeleteArticle(id).then((ok) => {
            if (!ok) dispatch({ type: 'cloudRestoreArticle', payload: snap })
          })
        }
      },
      toggleArticleLike: (id) => {
        const a = state.articles.find((x) => x.id === id)
        dispatch({ type: 'toggleArticleLike', payload: id })
        if (a && state.cloudIds?.articles.includes(id)) {
          void cloudLikeArticle(id, !a.likedByMe).then((ok) => {
            if (!ok) dispatch({ type: 'toggleArticleLike', payload: id })
          })
        }
      },
      addArticleComment: (articleId, content) => {
        const id = uid('ac')
        dispatch({ type: 'addArticleComment', payload: { id, articleId, content } })
        if (state.cloudIds?.articles.includes(articleId)) {
          void cloudWriteArticleComment(id, articleId, content).then((r) => {
            if (r === 'fail') dispatch({ type: 'cloudRollbackArticleComment', payload: { articleId, commentId: id } })
          })
        }
      },
      toggleSnippetLike: (id) => {
        const s = state.snippets.find((x) => x.id === id)
        dispatch({ type: 'toggleSnippetLike', payload: id })
        if (s && state.cloudIds?.snippets.includes(id)) {
          void cloudLikeSnippet(id, !s.likedByMe).then((ok) => {
            if (!ok) dispatch({ type: 'toggleSnippetLike', payload: id })
          })
        }
      },
      addSnippet: (title, language, code) => {
        const id = uid('s')
        dispatch({ type: 'addSnippet', payload: { id, title, language, code } })
        fireCloudWrite(
          cloudWriteSnippet,
          { id, authorId: state.meId, title, language, code, createdAt: Date.now(), likes: 0, likedByMe: false },
          () => dispatch({ type: 'cloudMark', payload: { kind: 'snippets', id } }),
          () => dispatch({ type: 'cloudRollbackSnippet', payload: id }),
        )
      },
      deleteSnippet: (id) => {
        const snap = state.snippets.find((s) => s.id === id)
        dispatch({ type: 'deleteSnippet', payload: id })
        if (snap && state.cloudIds?.snippets.includes(id)) {
          void cloudDeleteSnippet(id).then((ok) => {
            if (!ok) dispatch({ type: 'cloudRestoreSnippet', payload: snap })
          })
        }
      },
      downloadResource: (id) => {
        dispatch({ type: 'downloadResource', payload: id })
        // 轮 13 打通：资源被下载 → 知识线 resource_downloaded
        recordGrowth('resource_downloaded')
        // 轮 14 打通：资源被下载 → 作者按 revenue_rule(resource_buy 80%) 分成入账
        // demo 单身份模拟：uploader 为当前身份名时，视为自己的资源被他人下载；
        // 演示定价 ¥5.00（500 分）× 80% = 400 分，快照冻结下单时刻费率
        const res = state.resources.find((r) => r.id === id)
        if (res && res.uploader === state.users[state.meId]?.name) {
          const snap = revenueSnapshot('resource_buy')
          if (snap) walletIncome(400, `资源下载分成（${res.title}）`, snap)
        }
      },
      switchDemoUser: (id) => dispatch({ type: 'setIdentity', payload: { meId: id } }),
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
