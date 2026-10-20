import { useEffect, useMemo, useState } from 'react'
import { useApp } from './store'
import { useRouter } from './router'
import { cx, formatCount, formatDate, recordView } from './utils'
import { Avatar, Empty, Modal, RichText, Tag, TimeAgo, UserLink, useToast } from './components'
import { useAuth } from './auth'
import { can } from './permissions'
import type { Article } from './types'

/* ================= 文章正文块级解析 ================= */

interface Block {
  kind: 'p' | 'h2' | 'code' | 'ul'
  text?: string
  items?: string[]
  lines?: string[]
}

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏
      blocks.push({ kind: 'code', lines: code })
    } else if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: line.slice(3) })
      i++
    } else if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2))
        i++
      }
      blocks.push({ kind: 'ul', items })
    } else if (line.trim()) {
      blocks.push({ kind: 'p', text: line })
      i++
    } else {
      i++
    }
  }
  return blocks
}

function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
          <code key={i} className="inline">{p.slice(1, -1)}</code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function ProseBlocks({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content])
  let h2Index = 0
  return (
    <div className="prose">
      {blocks.map((b, i) => {
        if (b.kind === 'code') {
          return <pre key={i}><code>{(b.lines ?? []).join('\n')}</code></pre>
        }
        if (b.kind === 'h2') {
          const id = `h2-${h2Index++}`
          return <h2 key={i} id={id}>{b.text}</h2>
        }
        if (b.kind === 'ul') {
          return (
            <ul key={i}>
              {(b.items ?? []).map((it, j) => <li key={j}><InlineCode text={it} /></li>)}
            </ul>
          )
        }
        return <p key={i}><InlineCode text={b.text ?? ''} /></p>
      })}
    </div>
  )
}

function extractHeadings(content: string): Array<{ id: string; text: string }> {
  let idx = 0
  return content
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => ({ id: `h2-${idx++}`, text: l.slice(3) }))
}

/* ================= 1. ArticlesPage 文章列表 ================= */

export function ArticlesPage() {
  const api = useApp()
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')
  const allTags = [...new Set(api.state.articles.flatMap((a) => a.tags))]
  let list = tag ? api.state.articles.filter((a) => a.tags.includes(tag)) : [...api.state.articles]
  list = [...list].sort((a, b) => (sort === 'latest' ? b.createdAt - a.createdAt : b.likes - a.likes))

  return (
    <div className="page-grid single">
      <div>
        <div className="card tag-chips" style={{ marginBottom: 12 }}>
          <span className={cx('chip', !tag && 'active')} onClick={() => setTag(null)}>全部</span>
          {allTags.map((t) => (
            <span key={t} className={cx('chip', tag === t && 'active')} onClick={() => setTag(t)}>{t}</span>
          ))}
        </div>
        <div className="tabs">
          <button className={cx('tab-btn', sort === 'latest' && 'active')} onClick={() => setSort('latest')}>🆕 最新</button>
          <button className={cx('tab-btn', sort === 'hot' && 'active')} onClick={() => setSort('hot')}>🔥 最热</button>
        </div>
        {list.length === 0 && <Empty emoji="📄" text="该标签下暂无文章" />}
        {list.map((a) => <ArticleRow key={a.id} article={a} />)}
      </div>
    </div>
  )
}

function ArticleRow({ article, manage }: { article: Article; manage?: React.ReactNode }) {
  const api = useApp()
  const author = api.user(article.authorId)
  const fav = api.isFavorited('article', article.id)
  return (
    <article className="card article-card">
      <div className="article-card-main">
        <a href={`#/article/${article.id}`} className="article-title">{article.title}</a>
        <p className="article-summary">{article.summary}</p>
        <div className="article-meta">
          <a className="article-author" href={article.authorId === api.me.id ? '#/my' : `#/user/${article.authorId}`}>
            <Avatar emoji={author.emoji} color={author.color} size={20} />
            {author.name}
          </a>
          <span>{formatDate(article.createdAt)}</span>
          <span>👁 {formatCount(article.views)}</span>
          <span>👍 {formatCount(article.likes)}</span>
          <span>💬 {article.comments.length}</span>
          <div className="article-tags">{article.tags.slice(0, 3).map((t) => <Tag key={t}>{t}</Tag>)}</div>
          {manage && <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>{manage}</div>}
        </div>
      </div>
      <button
        className={cx('icon-btn star-btn', fav && 'active')}
        title={fav ? '取消收藏' : '收藏'}
        onClick={() => api.toggleFavorite('article', article.id)}
      >
        {fav ? '⭐' : '☆'}
      </button>
    </article>
  )
}

/* ================= 2. ArticleDetailPage 文章详情 ================= */

export function ArticleDetailPage({ id }: { id: string }) {
  const api = useApp()
  const toast = useToast()
  const article = api.state.articles.find((a) => a.id === id)
  const [input, setInput] = useState('')

  useEffect(() => {
    if (article) recordView('article', article.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!article) return <Empty emoji="🔍" text="文章不存在或已被删除" />
  const author = api.user(article.authorId)
  const headings = extractHeadings(article.content)
  const fav = api.isFavorited('article', article.id)

  const submit = () => {
    if (!input.trim()) return
    api.addArticleComment(article.id, input)
    setInput('')
    toast('评论成功')
  }

  return (
    <div className="article-layout">
      <div>
        <div className="card article-detail">
          <h1 className="article-detail-title">{article.title}</h1>
          <div className="article-detail-meta">
            <UserLink userId={article.authorId} size={36} />
            <span>{formatDate(article.createdAt)}</span>
            <span>👁 {formatCount(article.views)} 阅读</span>
            <div>{article.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
          </div>
          <ProseBlocks content={article.content} />
          <div className="post-actions" style={{ marginTop: 24 }}>
            <button className={cx('pa-btn', article.likedByMe && 'active')} onClick={() => api.toggleArticleLike(article.id)}>
              {article.likedByMe ? '👍' : '👍🏻'} 点赞 {formatCount(article.likes)}
            </button>
            <button
              className={cx('pa-btn', fav && 'active')}
              onClick={() => {
                api.toggleFavorite('article', article.id)
                toast(fav ? '已取消收藏' : '已收藏')
              }}
            >
              {fav ? '⭐' : '☆'} 收藏
            </button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>💬 评论（{article.comments.length}）</h3>
          {article.comments.length === 0 && <Empty emoji="💬" text="还没有评论，说说你的看法" />}
          {article.comments.map((c) => {
            const u = api.user(c.authorId)
            return (
              <div key={c.id} className="notif-row" style={{ cursor: 'default' }}>
                <UserLink userId={c.authorId} size={36} />
                <div className="notif-body">
                  <p><b style={{ color: 'var(--primary)' }}>{u.name}</b>：{c.content}</p>
                  <small><TimeAgo ts={c.createdAt} /></small>
                </div>
              </div>
            )
          })}
          <div className="msg-input-bar" style={{ padding: '12px 0 0', borderTop: '1px solid var(--border)' }}>
            <Avatar emoji={api.me.emoji} color={api.me.color} size={32} />
            <input
              className="input"
              placeholder={`回复 @${author.name}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button className="btn btn-primary btn-sm" onClick={submit}>评论</button>
          </div>
        </div>
      </div>

      <div className="side-col">
        {headings.length > 0 && (
          <div className="side-card toc">
            <h3>📑 目录</h3>
            {headings.map((h) => (
              <a
                key={h.id}
                href={`#/article/${article.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                {h.text}
              </a>
            ))}
          </div>
        )}
        <div className="side-card">
          <h3>👤 关于作者</h3>
          <UserLink userId={article.authorId} />
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '10px 0 0' }}>{author.bio}</p>
        </div>
      </div>
    </div>
  )
}

/* ================= 3. ArticleEditorPage 写文章 ================= */

export function ArticleEditorPage({ draftId, editId }: { draftId?: string; editId?: string }) {
  const api = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  // 编辑模式：仅允许编辑自己发布的文章；草稿模式：续写草稿箱内容
  const editing = editId ? api.state.articles.find((a) => a.id === editId && a.authorId === api.me.id) : undefined
  const existing = draftId ? api.state.articleDrafts.find((d) => d.id === draftId) : undefined
  const [title, setTitle] = useState(existing?.title ?? editing?.title ?? '')
  const [tags, setTags] = useState((existing?.tags ?? editing?.tags ?? []).join(', '))
  const [content, setContent] = useState(existing?.content ?? editing?.content ?? '')
  const [currentId, setCurrentId] = useState(draftId)

  const publish = () => {
    if (!title.trim() || !content.trim()) {
      toast('标题和正文不能为空')
      return
    }
    const tagList = tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
    if (editing) {
      api.editArticle(editing.id, { title, content, tags: tagList })
      toast('文章已更新 ✅')
      navigate(`/article/${editing.id}`)
      return
    }
    const id = api.publishArticle({ title, content, tags: tagList, draftId: currentId ?? null })
    toast('文章已发布 🎉')
    navigate(`/article/${id}`)
  }

  const save = () => {
    if (!title.trim()) {
      toast('至少写个标题吧')
      return
    }
    const tagList = tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
    const id = api.saveArticleDraft({ id: currentId, title, content, tags: tagList })
    setCurrentId(id)
    toast('已保存到草稿箱')
  }

  return (
    <div className="page-grid single">
      <div className="card">
        <input
          className="input"
          style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}
          placeholder="输入文章标题…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input"
          placeholder="标签（用逗号分隔，如：React, 前端, 教程）"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <textarea
          className="input"
          style={{ minHeight: 360, fontFamily: 'Consolas, Monaco, monospace' }}
          placeholder={'正文支持 Markdown 块：\n## 二级标题（自动生成目录）\n- 列表项\n```\n代码块\n```'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="compose-tools" style={{ marginTop: 12 }}>
          <small style={{ color: 'var(--text-3)' }}>字数：{content.length}{editing ? '（编辑模式，保存后立即生效）' : ''}</small>
          <span className="spacer" />
          {!editing && <button className="btn btn-ghost" onClick={save}>保存草稿</button>}
          <button className="btn btn-primary" onClick={publish}>{editing ? '保存修改' : '发布文章'}</button>
        </div>
      </div>
    </div>
  )
}

/* ================= 4. BlogHomePage 我的博客 ================= */

export function BlogHomePage() {
  const api = useApp()
  const toast = useToast()
  const { navigate } = useRouter()
  const [tab, setTab] = useState<'published' | 'drafts'>('published')
  const mine = api.state.articles.filter((a) => a.authorId === api.me.id)
  const totalViews = mine.reduce((s, a) => s + a.views, 0)
  const totalLikes = mine.reduce((s, a) => s + a.likes, 0)

  return (
    <div className="page-grid single">
      <div>
        <div className="profile-head">
          <div className="profile-row">
            <Avatar emoji={api.me.emoji} color={api.me.color} size={64} />
            <div>
              <div className="profile-name">{api.me.name} 的博客</div>
              <small style={{ opacity: 0.85 }}>{api.me.bio}</small>
            </div>
            <div className="profile-actions">
              <a href="#/write" className="btn btn-ghost btn-sm" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.5)' }}>✍️ 写文章</a>
            </div>
          </div>
          <div className="profile-stats">
            <span><b>{mine.length}</b> 文章</span>
            <span><b>{formatCount(totalViews)}</b> 总阅读</span>
            <span><b>{formatCount(totalLikes)}</b> 总点赞</span>
            <span><b>{api.state.snippets.filter((s) => s.authorId === api.me.id).length}</b> 代码片段</span>
          </div>
        </div>

        <div className="tabs">
          <button className={cx('tab-btn', tab === 'published' && 'active')} onClick={() => setTab('published')}>
            公开文章（{mine.length}）
          </button>
          <button className={cx('tab-btn', tab === 'drafts' && 'active')} onClick={() => setTab('drafts')}>
            草稿箱（{api.state.articleDrafts.length}）
          </button>
        </div>

        {tab === 'published' &&
          (mine.length === 0 ? (
            <Empty emoji="📄" text="还没有发布过文章" />
          ) : (
            mine.map((a) => (
              <ArticleRow
                key={a.id}
                article={a}
                manage={
                  <>
                    <a style={{ color: 'var(--primary)', fontSize: 13 }} href={`#/write?edit=${a.id}`}>✏️ 编辑</a>
                    <button
                      style={{ background: 'none', border: 'none', padding: 0, color: '#e74c3c', fontSize: 13, cursor: 'pointer' }}
                      onClick={() => {
                        if (window.confirm(`确认删除《${a.title}》？删除后不可恢复。`)) {
                          api.deleteArticle(a.id)
                          toast('文章已删除 🗑')
                        }
                      }}
                    >
                      🗑 删除
                    </button>
                  </>
                }
              />
            ))
          ))}

        {tab === 'drafts' && (
          <>
            {api.state.articleDrafts.length === 0 && <Empty emoji="📝" text="草稿箱是空的" />}
            {api.state.articleDrafts.map((d) => (
              <div key={d.id} className="card">
                <b style={{ fontSize: 16 }}>{d.title || '（无标题草稿）'}</b>
                <p style={{ color: 'var(--text-2)', fontSize: 13, margin: '6px 0 10px' }}>
                  {(d.content || '').slice(0, 80) || '（正文为空）'}…
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {d.tags.slice(0, 3).map((t) => <Tag key={t}>{t}</Tag>)}
                  <small style={{ color: 'var(--text-3)' }}><TimeAgo ts={d.savedAt} /></small>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={() => navigate(`/write/${d.id}`)}>继续编辑</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      api.deleteArticleDraft(d.id)
                      toast('草稿已删除')
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/* ================= 5. SnippetsPage 代码片段 ================= */

const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'CSS', 'SQL', 'Shell']

export function SnippetsPage() {
  const api = useApp()
  const toast = useToast()
  const { auth } = useAuth()
  const [lang, setLang] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('TypeScript')
  const [code, setCode] = useState('')

  const list = api.state.snippets.filter((s) => !lang || s.language === lang)

  const copyCode = (id: string, code: string) => {
    const done = () => {
      setCopiedId(id)
      toast('代码已复制 📋')
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500)
    }
    // 兜底：Clipboard API 被拒（文档未聚焦/权限受限）时用 execCommand 复制
    const fallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) done()
        else toast('复制失败，请手动选择复制')
      } catch {
        toast('复制失败，请手动选择复制')
      }
    }
    navigator.clipboard.writeText(code).then(done, fallback)
  }

  const create = () => {
    if (!title.trim() || !code.trim()) {
      toast('标题和代码不能为空')
      return
    }
    api.addSnippet(title, language, code)
    setOpen(false)
    setTitle('')
    setCode('')
    toast('片段已收录 ✅')
  }

  return (
    <div className="page-grid single">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <span style={{ fontWeight: 700 }}>💾 代码片段</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>+ 新建片段</button>
        </div>
        <div className="card tag-chips" style={{ marginBottom: 12 }}>
          <span className={cx('chip', !lang && 'active')} onClick={() => setLang(null)}>全部</span>
          {[...new Set(api.state.snippets.map((s) => s.language))].map((l) => (
            <span key={l} className={cx('chip', lang === l && 'active')} onClick={() => setLang(l)}>{l}</span>
          ))}
        </div>

        <div className="snippet-grid">
          {list.length === 0 && <Empty emoji="💾" text="没有匹配的片段" />}
          {list.map((s) => {
            const u = api.user(s.authorId)
            return (
              <div key={s.id} className="card">
                <div className="snippet-head">
                  <span className="lang-badge">{s.language}</span>
                  <b style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</b>
                  {can(auth.mode, api.state.meId, 'snippet:delete', s) && (
                    <button
                      title="删除片段"
                      style={{ background: 'none', border: 'none', padding: '0 2px', color: 'var(--text-3)', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}
                      onClick={() => {
                        if (window.confirm(`确认删除片段《${s.title}》？删除后不可恢复。`)) {
                          api.deleteSnippet(s.id)
                          toast('片段已删除 🗑')
                        }
                      }}
                    >
                      🗑
                    </button>
                  )}
                </div>
                <div className="snippet-code-wrap">
                  <pre className="snippet-code"><code>{s.code}</code></pre>
                  <button
                    className={cx('copy-btn', copiedId === s.id && 'done')}
                    onClick={() => copyCode(s.id, s.code)}
                  >
                    {copiedId === s.id ? '已复制 ✓' : '复制'}
                  </button>
                </div>
                <div className="snippet-foot">
                  <span>{u.emoji} {u.name}</span>
                  <span><TimeAgo ts={s.createdAt} /></span>
                  <span style={{ flex: 1 }} />
                  <button
                    className={cx('like-btn', s.likedByMe && 'active')}
                    onClick={() => api.toggleSnippetLike(s.id)}
                  >
                    {s.likedByMe ? '❤️' : '🤍'} {formatCount(s.likes)}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {open && (
        <Modal title="新建代码片段" onClose={() => setOpen(false)}>
          <input className="input" placeholder="片段标题" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 10 }} />
          <select className="input" aria-label="选择语言" value={language} onChange={(e) => setLanguage(e.target.value)} style={{ marginBottom: 10 }}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <textarea
            className="input"
            rows={8}
            style={{ fontFamily: 'Consolas, Monaco, monospace' }}
            placeholder="粘贴你的代码…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>取消</button>
            <button className="btn btn-primary" onClick={create}>收录</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ================= 6. ResourcesPage 资源下载 ================= */

const RES_ICONS: Record<string, string> = { pdf: '📕', video: '🎬', code: '💾', doc: '📘' }

export function ResourcesPage() {
  const api = useApp()
  const toast = useToast()
  const categories = [...new Set(api.state.resources.map((r) => r.category))]
  const [cat, setCat] = useState<string | null>(null)
  const [sort, setSort] = useState<'default' | 'downloads' | 'name'>('default')
  let list = api.state.resources.filter((r) => !cat || r.category === cat)
  if (sort === 'downloads') list = [...list].sort((a, b) => b.downloads - a.downloads)
  else if (sort === 'name') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'))

  return (
    <div className="page-grid single">
      <div>
        <div className="card tag-chips" style={{ marginBottom: 12 }}>
          <span className={cx('chip', !cat && 'active')} onClick={() => setCat(null)}>全部</span>
          {categories.map((c) => (
            <span key={c} className={cx('chip', cat === c && 'active')} onClick={() => setCat(c)}>{c}</span>
          ))}
        </div>
        <div className="tabs">
          <button className={cx('tab-btn', sort === 'default' && 'active')} onClick={() => setSort('default')}>📦 默认</button>
          <button className={cx('tab-btn', sort === 'downloads' && 'active')} onClick={() => setSort('downloads')}>🔥 下载最多</button>
          <button className={cx('tab-btn', sort === 'name' && 'active')} onClick={() => setSort('name')}>🔤 名称</button>
        </div>
        {list.length === 0 && <Empty emoji="📦" text="该分类下暂无资源" />}
        {list.map((r) => (
          <div key={r.id} className="card res-row">
            <span className={`res-icon t-${r.type}`}>{RES_ICONS[r.type] ?? '📦'}</span>
            <div className="res-main">
              <b>{r.title}</b>
              <p>{r.description}</p>
              <p>上传者：{r.uploader}</p>
            </div>
            <div className="res-meta">
              <div>{r.size}</div>
              <div>{formatCount(r.downloads)} 次下载</div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                api.downloadResource(r.id)
                toast(`《${r.title}》开始下载 📥`)
              }}
            >
              下载
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================= 7. SearchPage 搜索 ================= */

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 关键词高亮：所有匹配处包一层 mark.hl */
function Highlight({ text, kw }: { text: string; kw: string }) {
  if (!kw) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(kw)})`, 'gi'))
  const lower = kw.toLowerCase()
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === lower ? (
          <mark key={i} className="hl">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export function SearchPage() {
  const api = useApp()
  const { query: routeQuery } = useRouter()
  const [tab, setTab] = useState('all')
  const raw = routeQuery.get('q') ?? ''
  const kw = raw.trim().toLowerCase()
  const results = useMemo(() => {
    if (!kw) return { posts: [], articles: [], users: [], snippets: [] }
    return {
      posts: api.state.posts.filter(
        (p) =>
          p.content.toLowerCase().includes(kw) ||
          (p.topic ?? '').includes(kw) ||
          (p.comments ?? []).some((c) => c.content.toLowerCase().includes(kw)),
      ),
      articles: api.state.articles.filter(
        (a) =>
          a.title.toLowerCase().includes(kw) ||
          a.summary.includes(kw) ||
          a.content.toLowerCase().includes(kw) ||
          a.comments.some((c) => c.content.toLowerCase().includes(kw)),
      ),
      users: Object.values(api.state.users).filter(
        (u) => u.name.toLowerCase().includes(kw) || u.bio.includes(kw),
      ),
      snippets: api.state.snippets.filter(
        (s) => s.title.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw),
      ),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kw, api.state.posts, api.state.articles, api.state.users, api.state.snippets])

  const hasAny = results.posts.length + results.articles.length + results.users.length + results.snippets.length > 0

  return (
    <div className="page-grid single">
      <div>
        <div className="tabs">
          {[
            { key: 'all', label: `综合` },
            { key: 'post', label: `动态 (${results.posts.length})` },
            { key: 'article', label: `文章 (${results.articles.length})` },
            { key: 'user', label: `用户 (${results.users.length})` },
            { key: 'snippet', label: `片段 (${results.snippets.length})` },
          ].map((t) => (
            <button key={t.key} className={cx('tab-btn', tab === t.key && 'active')} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {!kw && <Empty emoji="🔎" text="输入关键词开始搜索" />}

        {kw && !hasAny && <Empty emoji="🕳" text={`没有找到与「${raw}」相关的内容`} />}

        {kw && hasAny && (
          <>
            {(tab === 'all' || tab === 'post') && results.posts.length > 0 && (
              <>
                {tab === 'all' && <h3 className="page-title">🕊 动态</h3>}
                {results.posts.slice(0, tab === 'all' ? 3 : undefined).map((p) => (
                  <PostCardLite key={p.id} pid={p.id} />
                ))}
              </>
            )}
            {(tab === 'all' || tab === 'article') && results.articles.length > 0 && (
              <>
                {tab === 'all' && <h3 className="page-title">📄 文章</h3>}
                {results.articles.slice(0, tab === 'all' ? 3 : undefined).map((a) => (
                  <a key={a.id} href={`#/article/${a.id}`} className="card" style={{ display: 'block' }}>
                    <b style={{ fontSize: 15 }}><Highlight text={a.title} kw={kw} /></b>
                    <p style={{ color: 'var(--text-2)', fontSize: 13, margin: '4px 0 0' }}>
                      <Highlight text={a.summary} kw={kw} />
                    </p>
                  </a>
                ))}
              </>
            )}
            {(tab === 'all' || tab === 'user') && results.users.length > 0 && (
              <>
                {tab === 'all' && <h3 className="page-title">👤 用户</h3>}
                <div className="card">
                  {results.users.slice(0, tab === 'all' ? 4 : undefined).map((u) => (
                    <div key={u.id} className="user-row" style={{ padding: '8px 0' }}>
                      <UserLink userId={u.id} size={40} />
                      <span style={{ flex: 1 }} />
                      <small style={{ color: 'var(--text-3)' }}>{formatCount(u.followers)} 粉丝</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            {(tab === 'all' || tab === 'snippet') && results.snippets.length > 0 && (
              <>
                {tab === 'all' && <h3 className="page-title">💾 代码片段</h3>}
                {results.snippets.slice(0, tab === 'all' ? 3 : undefined).map((s) => (
                  <div key={s.id} className="card">
                    <div className="snippet-head">
                      <span className="lang-badge">{s.language}</span>
                      <b style={{ fontSize: 14 }}><Highlight text={s.title} kw={kw} /></b>
                    </div>
                    <pre className="snippet-code"><code>{s.code}</code></pre>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PostCardLite({ pid }: { pid: string }) {
  const { state } = useApp()
  const p = state.posts.find((x) => x.id === pid)
  if (!p) return null
  const u = state.users[p.authorId]
  return (
    <a href={`#/post/${p.id}`} className="card" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Avatar emoji={u?.emoji ?? '👤'} color={u?.color ?? '#999'} size={24} />
        <b style={{ fontSize: 14 }}>{u?.name}</b>
        <TimeAgo ts={p.createdAt} />
      </div>
      <div style={{ fontSize: 14 }}>
        <RichText text={p.content} />
      </div>
    </a>
  )
}

/* ================= 8. TagsPage 标签聚合 ================= */

export function TagsPage() {
  const api = useApp()
  const { query, navigate } = useRouter()
  const activeTag = query.get('tag')

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of api.state.articles) {
      for (const t of a.tags) map.set(t, (map.get(t) ?? 0) + 1)
    }
    return [...map.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
  }, [api.state.articles])

  const list = activeTag
    ? api.state.articles
        .filter((a) => a.tags.includes(activeTag))
        .sort((a, b) => b.createdAt - a.createdAt)
    : []

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🏷 标签聚合</h2>
        <div className="card tag-chips">
          {counts.map(([t, n]) => (
            <span
              key={t}
              className={cx('chip', activeTag === t && 'active')}
              onClick={() => navigate(activeTag === t ? '/tags' : `/tags?tag=${encodeURIComponent(t)}`)}
            >
              {t} · {n}
            </span>
          ))}
        </div>
        {activeTag ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 12px' }}>
              <b>「{activeTag}」下的文章（{list.length}）</b>
              <a className="btn btn-ghost btn-sm" href="#/tags">查看全部标签</a>
            </div>
            {list.length === 0 && <Empty emoji="📄" text="该标签下暂无文章" />}
            {list.map((a) => <ArticleRow key={a.id} article={a} />)}
          </>
        ) : (
          <Empty emoji="🏷" text="点击上方标签，查看该主题下的全部文章" />
        )}
      </div>
    </div>
  )
}
