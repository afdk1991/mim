/* ==========================================================================
 * ArticleEditorPage 文章编辑器 —— 新建 / 续写草稿 / 载入已有文章再另存
 *
 * 标题 + 正文 + 标签编辑器；摘要走 rules.makeSummary，质量门走 articleQualityPass
 *       （正文去空白 <50 字会提示「不计成长分」，但不阻断发布——原实现同样只是不记分）。
 * 草稿：走 saveArticleDraft，同一份草稿反复保存会复用 id（不堆叠重名草稿）。
 * 编辑已有文章：走状态层 editArticle（带 authorId 归属校验，传 content 时自动重算 summary）；
 *       由草稿发布时把 draftId 交给 publishArticle，草稿会被自动消费，草稿箱不留残件。
 * 成长分：只有「真发布」才上报 publish_article；编辑更新不重复上报，避免绕过日上限。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import { Empty, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { articleQualityPass, makeSummary, plainLength } from '@/domain/content/rules'
import { reportGrowth } from './growth-report'

export interface ArticleEditorPageProps {
  draftId?: string
  editId?: string
}

export function ArticleEditorPage({ draftId, editId }: ArticleEditorPageProps) {
  const app = useApp()
  const toast = useToast()
  const { navigate } = useRouter()

  /* 编辑模式只认自己发布的文章；草稿模式续写草稿箱内容 */
  const editing = editId ? app.state.articles.find((a) => a.id === editId && a.authorId === app.meId) : undefined
  const existing = draftId ? app.state.articleDrafts.find((d) => d.id === draftId) : undefined

  const [title, setTitle] = useState(existing?.title ?? editing?.title ?? '')
  const [content, setContent] = useState(existing?.content ?? editing?.content ?? '')
  const [tags, setTags] = useState<string[]>(existing?.tags ?? editing?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [draftIdNow, setDraftIdNow] = useState<string | undefined>(draftId)

  const summary = useMemo(() => makeSummary(content), [content])
  const quality = articleQualityPass(content)

  const addTag = (): void => {
    const list = tagInput
      .split(/[,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (list.length === 0) return
    const merged = Array.from(new Set([...tags, ...list]))
    setTags(merged)
    setTagInput('')
  }

  const saveDraft = (): void => {
    if (!title.trim()) {
      toast('至少写个标题吧')
      return
    }
    const id = app.saveArticleDraft({ id: draftIdNow, title: title.trim(), content, tags })
    setDraftIdNow(id)
    toast('已保存到草稿箱')
  }

  const publish = (): void => {
    if (!title.trim() || content.trim().length === 0) {
      toast('标题和正文不能为空')
      return
    }
    // 编辑已有文章：更新原文（含 summary 重算），不再另存草稿
    if (editing) {
      app.editArticle(editing.id, { title: title.trim(), content, tags })
      toast('文章已更新 ✅')
      navigate(`/article/${editing.id}`)
      return
    }
    // draftId 交给状态层：由草稿发布时自动消费该草稿
    const id = app.publishArticle({ title: title.trim(), content, tags, draftId: draftIdNow })
    // 质量门：正文去空白 <50 字不计成长分（规则见 domain/growth）
    const outcome = reportGrowth('publish_article', articleQualityPass(content))
    toast(outcome.ok ? '文章已发布 🎉' : '文章已发布（正文不足 50 字，本次不计成长分）')
    navigate(`/article/${id}`)
  }

  /* 既没有草稿也没有可编辑文章：给出明确的下一步引导，而不是空白编辑器 */
  if ((draftId && !existing) || (editId && !editing)) {
    return (
      <div className="page-grid single">
        <div>
          <Empty emoji="🔍" text={draftId ? '草稿不存在或已被删除' : '文章不存在，或你不是作者'} />
          <a className="btn btn-primary btn-sm" href="#/write">
            新建一篇文章
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="page-grid single">
      <div className="card">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2 className="page-title">{editing ? '✏️ 编辑文章' : existing ? '📝 续写草稿' : '✍️ 写文章'}</h2>
          <a className="btn btn-ghost btn-sm" href="#/blog">
            我的博客
          </a>
        </div>

        <input
          className="input"
          placeholder="输入文章标题…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}
        />

        <div className="tag-editor">
          {tags.map((t) => (
            <span key={t} className="tag">
              {t}
              <button className="tag-del" aria-label={`删除标签 ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
                ✕
              </button>
            </span>
          ))}
          <input
            className="input tag-input"
            placeholder="标签（回车或逗号分隔，如：React, 性能优化）"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTag()
              }
            }}
            onBlur={addTag}
          />
        </div>

        <textarea
          className="input mono-textarea"
          style={{ minHeight: 340 }}
          placeholder={'正文支持 Markdown 块：\n## 二级标题（自动生成目录）\n- 列表项\n```\n代码块\n```'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />

        <div className="editor-foot">
          <div className="row wrap">
            <small className="muted">字数：{content.length}（去空白 {plainLength(content)}）</small>
            {!quality && content.length > 0 ? (
              <small className="warn-text">正文不足 50 字，发布后不计成长分</small>
            ) : null}
            {summary ? <small className="muted">摘要预览：{summary}</small> : null}
          </div>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={saveDraft}>
              保存草稿
            </button>
            <a className="btn btn-ghost btn-sm" href={`#/article/${editing?.id ?? ''}`} hidden={!editing}>
              查看原文
            </a>
            <button className="btn btn-primary btn-sm" onClick={publish}>
              {editing ? '保存修改' : '发布文章'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
