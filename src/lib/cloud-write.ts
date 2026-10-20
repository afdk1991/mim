/* 云端写适配层（轮 3 写路径·内容）。
   职责：已登录云端会话时，把发布类写操作（动态/文章/代码片段）insert 到 Supabase，
   本地状态由 store.tsx 先行乐观更新；insert 失败时本层弹极简 DOM toast 报错，
   并返回 false，由 store.tsx dispatch 回滚 action 撤销乐观结果。
   - 身份取自 supabase.auth.getSession()（内存缓存，无网络开销），不依赖 React context，
     因此 AppProvider/ToastProvider/AuthProvider 的嵌套顺序无关紧要。
   - 未配置云端或无登录会话：跳过（返回 true），行为与纯本地演示完全一致。
   - 转发动态云端行不写 repost_of_id（seed 父帖在云端无对应行，外键必炸），
     评论文案落到 content 列，本地仍保留转发链展示。 */
import { supabase } from './supabase'
import type { Post, Article, Snippet } from '../types'

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

/** 统一入口：返回 true = 云端写成功或已跳过；false = 失败（调用方须回滚乐观结果） */
async function insertRow(
  table: 'posts' | 'articles' | 'snippets',
  row: Record<string, unknown>,
  label: string,
): Promise<boolean> {
  const userId = await cloudUserId()
  if (!userId) return true // 未登录/未配置云端：跳过，保持本地演示行为
  const { error } = await supabase!
    .from(table)
    .insert({ ...row, author_id: userId })
  if (error) {
    cloudToast(`⚠ ${label}云端保存失败，已回滚：${error.message}`)
    return false
  }
  return true
}

export function cloudWritePost(p: Post): Promise<boolean> {
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
    },
    '动态',
  )
}

export function cloudWriteArticle(a: Article): Promise<boolean> {
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

export function cloudWriteSnippet(s: Snippet): Promise<boolean> {
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
