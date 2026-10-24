import { describe, expect, it } from 'vitest'
import { buildRecFeed } from './feed-core'
import type { Post } from '../types'

/** 构造最小可用 Post（只填 buildRecFeed 打散路径用到的字段） */
const mkPost = (id: string, authorId: string, topic: string | null, hoursAgo: number): Post => ({
  id,
  authorId,
  content: `post-${id}`,
  images: [],
  createdAt: Date.now() - hoursAgo * 3_600_000,
  repostOfId: null,
  repostComment: '',
  likes: 10,
  likedByMe: false,
  reposts: 1,
  topic,
  source: 'test',
})

const run = (candidates: Post[]): ReturnType<typeof buildRecFeed> =>
  buildRecFeed({
    candidates,
    meId: 'me',
    posts: [],
    favorites: [],
    users: Object.fromEntries(
      [...new Set(candidates.map((c) => c.authorId))].map((id) => [id, { id, name: id }]),
    ),
    negTopics: [],
  })

describe('buildRecFeed 打散（内容去重与打散）', () => {
  it('同作者高分连续候选应被打散，且不丢条目', () => {
    /* u1 三条最新（时间衰减分最高），若不打散会连续占前三 */
    const candidates = [
      mkPost('p1', 'u1', '前端', 1),
      mkPost('p2', 'u1', '前端', 2),
      mkPost('p3', 'u1', '前端', 3),
      mkPost('p4', 'u2', '后端', 10),
      mkPost('p5', 'u3', '算法', 20),
    ]
    const out = run(candidates)
    expect(out.map((x) => x.post.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    for (let i = 1; i < out.length; i++) {
      expect(out[i].post.authorId).not.toBe(out[i - 1].post.authorId)
    }
  })

  it('同话题连续也应被打散（作者不同但话题相同）', () => {
    const candidates = [
      mkPost('q1', 'u1', '前端', 1),
      mkPost('q2', 'u2', '前端', 2),
      mkPost('q3', 'u3', '后端', 3),
      mkPost('q4', 'u4', '后端', 4),
    ]
    const out = run(candidates)
    expect(out).toHaveLength(4)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].post.topic).not.toBe(out[i - 1].post.topic)
    }
  })

  it('候选全部同作者时允许连续（无替代可用，退化不报错）', () => {
    const candidates = [mkPost('r1', 'u1', '前端', 1), mkPost('r2', 'u1', '前端', 2)]
    const out = run(candidates)
    expect(out).toHaveLength(2)
    expect(out.map((x) => x.post.id)).toEqual(['r1', 'r2'])
  })

  it('null 话题不参与撞车判定（未参与话题的动态可连续）', () => {
    const candidates = [
      mkPost('s1', 'u1', null, 1),
      mkPost('s2', 'u2', null, 2),
      mkPost('s3', 'u3', null, 3),
    ]
    const out = run(candidates)
    expect(out).toHaveLength(3)
  })
})
