import type { AppState, HotSearchItem } from '../types'

/**
 * 演示热搜榜（发现域内容，非用户自产内容）。
 * 设计上「空状态种子」不生成用户演示内容（帖子/文章等），但热搜属于发现/运营位，
 * 本地模式（未接云端）没有云端热搜来源，若留空则下拉搜索面板恒为空白，
 * 故在此提供一份默认榜；接云端后由云端下发覆盖。与手势/搜索机制解耦，仅影响数据。
 */
export const DEMO_HOT_SEARCHES: HotSearchItem[] = [
  { id: 'hs1', rank: 1, text: '机箱 BOM 工具台', heat: 1286000, tag: '沸' },
  { id: 'hs2', rank: 2, text: '疾风引擎', heat: 986000, tag: '热' },
  { id: 'hs3', rank: 3, text: 'AI 服务器资源', heat: 742000, tag: '热' },
  { id: 'hs4', rank: 4, text: '配送路线优化', heat: 518000, tag: '新' },
  { id: 'hs5', rank: 5, text: '漫剧片单', heat: 463000, tag: null },
  { id: 'hs6', rank: 6, text: '邮箱聚合', heat: 327000, tag: null },
  { id: 'hs7', rank: 7, text: '超话签到', heat: 264000, tag: null },
  { id: 'hs8', rank: 8, text: '比价探针', heat: 158000, tag: null },
]

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
    hotSearches: DEMO_HOT_SEARCHES,
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
