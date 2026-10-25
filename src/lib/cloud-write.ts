/* 云端写适配层（轮 3 内容发布 + 轮 4 点赞/评论/删除/编辑/关注/收藏/档案）。
   职责：已登录云端会话时把写操作同步到 Supabase，本地状态由 store.tsx 先行乐观更新；
   失败时本层弹极简 DOM toast 报错并返回失败态，由 store.tsx 回滚乐观结果或恢复快照。
   返回三态 CloudResult（发布/评论类）：
   - 'ok'   写成功（store 据此 dispatch cloudMark 注册 cloudIds，标记内容此后走云端）
   - 'skip' 未配置云端或无登录会话（静默跳过，行为与纯本地演示一致）
   - 'fail' 写失败（已 toast，调用方须回滚）
   点赞/关注/收藏/删除/编辑类返回 Promise<boolean>：true = 成功或跳过，false = 失败（已 toast）。
   身份取自 supabase.auth.getSession()（内存缓存），不依赖 React context。
   转发动态云端行不写 repost_of_id（seed 父帖云端无对应行，外键必炸），评论文案落 content 列。 */
import { supabase } from './supabase'
import type { Post, PostDraft, Article, ArticleDraft, Snippet } from '../types'

export type CloudResult = 'ok' | 'skip' | 'fail'

/** 极简 DOM toast（内联样式，零 css 依赖）：云端写失败时提示用户结果已回滚 */
function cloudToast(msg: string): void {
  const el = document.createElement('div')
  el.textContent = msg
  el.setAttribute(
    'style',
    [
      'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%)',
      'z-index:9999', 'padding:10px 18px', 'border-radius:8px',
      'background:rgba(20,20,20,.92)', 'color:#fff', 'font-size:13px',
      'box-shadow:0 4px 16px rgba(0,0,0,.25)', 'white-space:nowrap',
    ].join(';'),
  )
  document.body.appendChild(el)
  window.setTimeout(() => el.remove(), 2400)
}

async function cloudUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

type ContentTable = 'posts' | 'articles' | 'snippets' | 'post_comments' | 'article_comments'

/* ---------- 线上库结构漂移容错（缺列自动降级） ----------
   生产 Supabase 库可能落后于仓库迁移（迁移未应用时 posts 仍是无富字段的旧结构），
   此时写入带新列的整行会收到 PGRST204「Could not find the 'X' column of 'Y'」
   并整体失败，导致内容只落本地——即「看起来能用、实际是本地实现」。
   本段做法：捕获缺列错误 → 记入该表的缺失列表 → 剔除该列后重试，
   使写入始终能用线上库**实际存在**的列成功落库；迁移补齐后缓存自然不会被触发。
   注意：这只降级「可缺省的扩展字段」，主键/必填列缺失仍按原样报错，不静默吞错。 */
const missingCols = new Map<string, Set<string>>()

function missingOf(table: string): Set<string> {
  let s = missingCols.get(table)
  if (!s) { s = new Set(); missingCols.set(table, s) }
  return s
}

/** 按已记录的缺失列裁剪 payload（无记录时原样返回，零开销） */
function stripMissing(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const s = missingOf(table)
  if (!s.size) return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (!s.has(k)) out[k] = v
  return out
}

/** 从 PostgREST 报错里学习缺失列名；非缺列错误返回 null */
function learnMissing(table: string, msg: string): string | null {
  const m = /Could not find the '([^']+)' column/i.exec(msg || '')
  if (!m) return null
  missingOf(table).add(m[1])
  return m[1]
}

/**
 * 带缺列降级的写执行器。exec 每次收到裁剪后的 payload，
 * 遇缺列报错即剔除该列重试，直到成功或无列可剔（最多 max 轮，防死循环）。
 */
async function writeWithFallback(
  table: string,
  payload: Record<string, unknown>,
  exec: (p: Record<string, unknown>) => Promise<{ error: { message: string } | null }>,
  max = 12,
): Promise<{ error: { message: string } | null }> {
  let p = stripMissing(table, payload)
  for (let i = 0; i < max; i++) {
    const r = await exec(p)
    if (!r.error) return r
    const col = learnMissing(table, r.error.message)
    if (!col || !(col in p)) return r
    const next: Record<string, unknown> = { ...p }
    delete next[col]
    p = next
  }
  return { error: { message: '字段结构与线上库不匹配，已放弃写入' } }
}

/** 发布/评论类 insert 统一入口：返回三态 CloudResult */
async function insertRow(
  table: ContentTable,
  row: Record<string, unknown>,
  label: string,
): Promise<CloudResult> {
  const userId = await cloudUserId()
  if (!userId) return 'skip' // 未登录/未配置云端：跳过，保持本地演示行为
  const { error } = await writeWithFallback(table, { ...row, author_id: userId }, (p) =>
    supabase!.from(table).insert(p) as unknown as Promise<{ error: { message: string } | null }>,
  )
  if (error) {
    cloudToast(`⚠ ${label}云端保存失败，已回滚：${error.message}`)
    return 'fail'
  }
  return 'ok'
}

/* ---------- 发布（轮 3） ---------- */

export function cloudWritePost(p: Post): Promise<CloudResult> {
  return insertRow(
    'posts',
    {
      id: p.id,
      content: p.repostOfId ? p.repostComment || '转发动态' : p.content,
      images: p.images,
      created_at: new Date(p.createdAt).toISOString(),
      repost_of_id: null, // 见文件头注释：转发父帖可能不存在于云端
      repost_comment: p.repostComment,
      topic: p.topic,
      source: p.source,
      // 富媒体/互动扩展字段（迁移 0004）：本地富帖能力上云，避免回拉时被静默降级
      media: p.media ?? null,
      vote: p.vote ?? null,
      lottery: p.lottery ?? null,
      location: p.location ?? null,
      story: p.story ?? false,
      visibility: p.visibility ?? 'public',
      expires_at: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
      pinned: p.pinned ?? false,
    },
    '动态',
  )
}

export function cloudWriteArticle(a: Article): Promise<CloudResult> {
  return insertRow(
    'articles',
    {
      id: a.id,
      title: a.title,
      summary: a.summary,
      content: a.content,
      tags: a.tags,
      created_at: new Date(a.createdAt).toISOString(),
    },
    '文章',
  )
}

export function cloudWriteSnippet(s: Snippet): Promise<CloudResult> {
  return insertRow(
    'snippets',
    {
      id: s.id,
      title: s.title,
      language: s.language,
      code: s.code,
      created_at: new Date(s.createdAt).toISOString(),
    },
    '代码片段',
  )
}

/* ---------- 评论（轮 4） ---------- */

export function cloudWritePostComment(id: string, postId: string, content: string): Promise<CloudResult> {
  return insertRow('post_comments', { id, post_id: postId, content }, '评论')
}

export function cloudWriteArticleComment(id: string, articleId: string, content: string): Promise<CloudResult> {
  return insertRow('article_comments', { id, article_id: articleId, content }, '评论')
}

/* ---------- 点赞（轮 4）：like=true 插关联行 / false 删，父表计数由 schema 触发器维护 ---------- */

type LikeTable = 'post_likes' | 'comment_likes' | 'article_likes' | 'snippet_likes'

async function likeRow(
  table: LikeTable,
  col: string,
  id: string,
  like: boolean,
  label: string,
  silent = false,
): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const q = supabase!.from(table)
  const { error } = like
    ? await q.insert({ user_id: userId, [col]: id })
    : await q.delete().eq('user_id', userId).eq(col, id)
  if (error) {
    if (!silent) cloudToast(`⚠ ${label}云端同步失败，已回滚：${error.message}`)
    return false
  }
  return true
}

export function cloudLikePost(id: string, like: boolean): Promise<boolean> {
  return likeRow('post_likes', 'post_id', id, like, '动态点赞')
}

// 评论点赞静默：乐观评论 insert 竞态窗口内失败不打扰用户（仅回滚本地点赞态）
export function cloudLikeComment(id: string, like: boolean): Promise<boolean> {
  return likeRow('comment_likes', 'comment_id', id, like, '', true)
}

export function cloudLikeArticle(id: string, like: boolean): Promise<boolean> {
  return likeRow('article_likes', 'article_id', id, like, '文章点赞')
}

export function cloudLikeSnippet(id: string, like: boolean): Promise<boolean> {
  return likeRow('snippet_likes', 'snippet_id', id, like, '片段点赞')
}

/* ---------- 删除（轮 4）：关联评论/点赞行随外键级联删除 ---------- */

async function deleteRow(table: 'posts' | 'articles' | 'snippets', id: string, label: string): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await supabase!.from(table).delete().eq('id', id).eq('author_id', userId)
  if (error) {
    cloudToast(`⚠ ${label}云端删除失败，已恢复：${error.message}`)
    return false
  }
  return true
}

export function cloudDeletePost(id: string): Promise<boolean> {
  return deleteRow('posts', id, '动态')
}

export function cloudDeleteArticle(id: string): Promise<boolean> {
  return deleteRow('articles', id, '文章')
}

export function cloudDeleteSnippet(id: string): Promise<boolean> {
  return deleteRow('snippets', id, '代码片段')
}

/* ---------- 编辑（轮 4） ---------- */

export async function cloudUpdateArticle(
  id: string,
  d: { title: string; summary: string; content: string; tags: string[] },
): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await writeWithFallback('articles', d, (p) =>
    supabase!.from('articles').update(p).eq('id', id).eq('author_id', userId) as unknown as Promise<{ error: { message: string } | null }>,
  )
  if (error) {
    cloudToast(`⚠ 文章云端更新失败，已恢复：${error.message}`)
    return false
  }
  return true
}

/* ---------- 动态编辑（轮 4 补全）：patch 仅含可编辑字段，author_id 二次校验防越权 ---------- */

export async function cloudUpdatePost(
  id: string,
  d: { content: string; images: string[]; topic?: string | null; source?: string },
): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const patch: Record<string, unknown> = { content: d.content, images: d.images }
  if (d.topic !== undefined) patch.topic = d.topic
  if (d.source !== undefined) patch.source = d.source
  const { error } = await writeWithFallback('posts', patch, (p) =>
    supabase!.from('posts').update(p).eq('id', id).eq('author_id', userId) as unknown as Promise<{ error: { message: string } | null }>,
  )
  if (error) {
    cloudToast(`⚠ 动态云端更新失败，已恢复：${error.message}`)
    return false
  }
  return true
}

/* ---------- 关注 / 收藏 / 档案（轮 4） ---------- */

export async function cloudSetFollow(followeeId: string, follow: boolean): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  if (follow) {
    const { error } = await supabase!
      .from('follows')
      .insert({ follower_id: userId, followee_id: followeeId })
    if (error && error.code !== '23505') {
      // 23505 重复关注视为成功
      cloudToast(`⚠ 关注云端同步失败，已回滚：${error.message}`)
      return false
    }
  } else {
    const { error } = await supabase!
      .from('follows')
      .delete()
      .eq('follower_id', userId)
      .eq('followee_id', followeeId)
    if (error) {
      cloudToast(`⚠ 取消关注云端同步失败，已回滚：${error.message}`)
      return false
    }
  }
  return true
}

export async function cloudSetFavorite(kind: 'post' | 'article', targetId: string, fav: boolean): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  if (fav) {
    const { error } = await supabase!
      .from('favorites')
      .insert({ user_id: userId, type: kind, target_id: targetId })
    if (error && error.code !== '23505') {
      cloudToast(`⚠ 收藏云端同步失败，已回滚：${error.message}`)
      return false
    }
  } else {
    const { error } = await supabase!
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('type', kind)
      .eq('target_id', targetId)
    if (error) {
      cloudToast(`⚠ 取消收藏云端同步失败，已回滚：${error.message}`)
      return false
    }
  }
  return true
}

export async function cloudWriteProfile(d: { name: string; emoji: string; color: string; bio: string }): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await supabase!.from('profiles').update(d).eq('id', userId)
  if (error) {
    cloudToast(`⚠ 档案云端保存失败：${error.message}`)
    return false
  }
  return true
}

/* ---------- 草稿（轮 4）：upsert onConflict id 实现新建/更新二合一 ---------- */

export async function cloudUpsertPostDraft(d: PostDraft): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await writeWithFallback(
    'post_drafts',
    {
      id: d.id,
      user_id: userId,
      content: d.content,
      topic: d.topic,
      images: d.images,
      saved_at: new Date(d.savedAt).toISOString(),
    },
    (p) => supabase!.from('post_drafts').upsert(p, { onConflict: 'id' }) as unknown as Promise<{ error: { message: string } | null }>,
  )
  if (error) {
    cloudToast(`⚠ 动态草稿云端保存失败：${error.message}`)
    return false
  }
  return true
}

export async function cloudDeletePostDraft(id: string): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await supabase!.from('post_drafts').delete().eq('id', id).eq('user_id', userId)
  if (error) {
    cloudToast(`⚠ 动态草稿云端删除失败：${error.message}`)
    return false
  }
  return true
}

export async function cloudUpsertArticleDraft(d: ArticleDraft): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await writeWithFallback(
    'article_drafts',
    {
      id: d.id,
      user_id: userId,
      title: d.title,
      content: d.content,
      tags: d.tags,
      saved_at: new Date(d.savedAt).toISOString(),
    },
    (p) => supabase!.from('article_drafts').upsert(p, { onConflict: 'id' }) as unknown as Promise<{ error: { message: string } | null }>,
  )
  if (error) {
    cloudToast(`⚠ 文章草稿云端保存失败：${error.message}`)
    return false
  }
  return true
}

export async function cloudDeleteArticleDraft(id: string): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await supabase!.from('article_drafts').delete().eq('id', id).eq('user_id', userId)
  if (error) {
    cloudToast(`⚠ 文章草稿云端删除失败：${error.message}`)
    return false
  }
  return true
}

/* ---------- 私信（轮 5）：send_message RPC 一次写双方两行（msg_id 由 RPC 生成） ---------- */

export async function cloudSendMessage(peerId: string, content: string): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await supabase!.rpc('send_message', { p_peer: peerId, p_content: content })
  if (error) {
    cloudToast(`⚠ 私信云端发送失败：${error.message}`)
    return false
  }
  return true
}

/* ---------- 已读同步（轮 4/5）：调用方须保证 id 为云端域（seed id 更新 0 行无害，但私信 peer 必须 uuid） ---------- */

export async function cloudReadConversation(peerId: string): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  const { error } = await supabase!
    .from('messages')
    .update({ read: true })
    .eq('owner_id', userId)
    .eq('peer_id', peerId)
  if (error) {
    cloudToast(`⚠ 私信已读状态云端同步失败：${error.message}`)
    return false
  }
  return true
}

export async function cloudReadNotifications(id?: string): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true
  let q = supabase!.from('notifications').update({ read: true }).eq('user_id', userId)
  if (id) q = q.eq('id', id)
  const { error } = await q
  if (error) {
    cloudToast(`⚠ 通知已读状态云端同步失败：${error.message}`)
    return false
  }
  return true
}
