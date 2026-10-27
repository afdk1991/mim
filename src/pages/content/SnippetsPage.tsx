/* ==========================================================================
 * SnippetsPage 代码片段 —— 语言白名单收录 + 复制 + 删除自己的片段
 *
 * 语言一律走 domain 的 SNIPPET_LANGUAGES 白名单（页面不得自行放宽，避免脏语言值入库）。
 * 复制：优先 Clipboard API，被拒时回退 execCommand；两种都失败就如实提示，不假装成功。
 * 点赞：走状态层 toggleSnippetLike（本机计数 +1/-1，取消赞不空转）。
 * ======================================================================== */

import { useMemo, useState } from 'react'
import { Empty, Modal, TimeAgo, useToast, Avatar } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount } from '@/core/utils'
import { SNIPPET_LANGUAGES } from '@/domain/content/model'
import { useFirstPaint } from './content-data'
import { AsyncState } from './content-parts'
import { authorOf } from './content-lib'

export function SnippetsPage() {
  const app = useApp()
  const toast = useToast()
  const ready = useFirstPaint()
  const [lang, setLang] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState<string>(SNIPPET_LANGUAGES[0])
  const [code, setCode] = useState('')

  const snippets = app.state.snippets
  const usedLangs = useMemo(() => Array.from(new Set(snippets.map((s) => s.language))), [snippets])
  const list = snippets.filter((s) => !lang || s.language === lang)

  const copy = (id: string, text: string): void => {
    const done = (): void => {
      setCopiedId(id)
      toast('代码已复制 📋')
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500)
    }
    const fallback = (): void => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
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
    // 非安全上下文（http 且非 localhost）没有 clipboard 对象，必须回退
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback)
    else fallback()
  }

  const create = (): void => {
    if (!title.trim() || !code.trim()) {
      toast('标题和代码不能为空')
      return
    }
    app.addSnippet(title.trim(), language, code)
    setOpen(false)
    setTitle('')
    setCode('')
    toast('片段已收录 ✅')
  }

  return (
    <div className="page-grid single">
      <div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2 className="page-title">💾 代码片段</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
            + 新建片段
          </button>
        </div>

        {usedLangs.length > 0 ? (
          <div className="card chip-row">
            <button className={cx('chip', lang === null && 'active')} onClick={() => setLang(null)}>
              全部
            </button>
            {usedLangs.map((l) => (
              <button key={l} className={cx('chip', lang === l && 'active')} onClick={() => setLang(l)}>
                {l}
              </button>
            ))}
          </div>
        ) : null}

        <AsyncState
          loading={!ready}
          empty={
            list.length === 0 && (
              <Empty
                emoji="💾"
                text={lang ? `语言「${lang}」下暂无片段，点右上角收录第一条` : '还没有代码片段，收录第一条吧'}
              />
            )
          }
        >
          <div className="snippet-grid">
            {list.map((s) => {
              const u = authorOf(app.state.users, s.authorId)
              return (
                <div key={s.id} className="card snippet-card">
                  <div className="snippet-head">
                    <span className="lang-badge">{s.language}</span>
                    <b className="grow snippet-title">{s.title}</b>
                    {s.authorId === app.meId ? (
                      <button
                        className="icon-btn snippet-del"
                        title="删除片段"
                        aria-label="删除片段"
                        onClick={() => {
                          app.deleteSnippet(s.id)
                          toast('片段已删除 🗑')
                        }}
                      >
                        🗑
                      </button>
                    ) : null}
                  </div>
                  <div className="snippet-code-wrap">
                    <pre className="snippet-code">
                      <code>{s.code}</code>
                    </pre>
                    <button
                      className={cx('copy-btn', copiedId === s.id && 'done')}
                      onClick={() => copy(s.id, s.code)}
                    >
                      {copiedId === s.id ? '已复制 ✓' : '复制'}
                    </button>
                  </div>
                  <div className="snippet-foot">
                    <span className="row">
                      <Avatar emoji={u.emoji} color={u.color} size={20} />
                      {u.name}
                    </span>
                    <button
                      className={cx('act-btn', s.likedByMe && 'active')}
                      onClick={() => app.toggleSnippetLike(s.id)}
                      title={s.likedByMe ? '取消赞' : '点赞'}
                      aria-label={s.likedByMe ? '取消赞' : '点赞'}
                    >
                      <TimeAgo ts={s.createdAt} /> · ❤️ {formatCount(s.likes)}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </AsyncState>
      </div>

      {open ? (
        <Modal title="新建代码片段" onClose={() => setOpen(false)}>
          <input
            className="input"
            placeholder="片段标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <select
            className="input"
            aria-label="选择语言"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{ marginBottom: 10 }}
          >
            {SNIPPET_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <textarea
            className="input mono-textarea"
            rows={8}
            placeholder="粘贴你的代码…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={create}>
              收录
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
