import type { AppState } from '../types'

/**
 * 空状态种子：不生成任何演示内容。
 * 游客看到空态 + 引导，登录用户由 cloud-read 拉取真实云端数据；
 * 仅保留 me 本地乐观身份（发帖/评论的作者占位，登录后内容归属真实 uuid 档案）。
 */
function createEmptyState(): AppState {
  return {
    meId: 'me',
    followingIds: [],
    users: {
      me: {
        id: 'me',
        name: '新用户',
        emoji: '🙂',
        color: '#4f7cff',
        bio: '',
        followers: 0,
        following: 0,
        verified: false,
      },
    },
    topics: [],
    hotSearches: [],
    posts: [],
    articles: [],
    snippets: [],
    resources: [],
    notifications: [],
    messages: [],
    favorites: [],
    postDrafts: [],
    articleDrafts: [],
  }
}

/** 生成全新空状态：无演示内容，仅保留 me 占位身份。 */
export function createSeedState(): AppState {
  return createEmptyState()
}
