/* ==========================================================================
 * 富文本渲染 —— #话题# 与 @用户 的可点击解析
 *
 * 只做两件事：话题跳话题页、@按用户名反查跳个人主页。
 * 不做 HTML 注入，全部走 React 节点，天然免疫 XSS。
 * ======================================================================== */

import { Fragment, useMemo } from 'react'

const PATTERN = /#([^#]+)#|@([\u4e00-\u9fa5\w-]+)/g

export interface RichTextProps {
  text: string
  /** 用户名 → 用户 id；未命中时 @ 保持纯文本 */
  resolveUser?: (name: string) => string | null
  onTopic?: (name: string) => void
  onUser?: (id: string) => void
}

export function RichText({ text, resolveUser, onTopic, onUser }: RichTextProps) {
  const nodes = useMemo(() => build(text, resolveUser, onTopic, onUser), [text, resolveUser, onTopic, onUser])
  return <span className="rich-text">{nodes}</span>
}

function build(
  text: string,
  resolveUser: ((name: string) => string | null) | undefined,
  onTopic: ((name: string) => void) | undefined,
  onUser: ((id: string) => void) | undefined,
): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PATTERN.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`t${key}`}>{text.slice(last, m.index)}</Fragment>)
    const topic = m[1]
    const user = m[2]
    if (topic) {
      const name = topic
      out.push(
        <a
          key={`h${key}`}
          href={`#/topic/${encodeURIComponent(name)}`}
          style={{ color: 'var(--primary)' }}
          onClick={(e) => {
            if (!onTopic) return
            e.preventDefault()
            onTopic(name)
          }}
        >
          #{name}#
        </a>,
      )
    } else if (user) {
      const id = resolveUser?.(user) ?? null
      if (id && onUser) {
        out.push(
          <a
            key={`u${key}`}
            href={`#/user/${id}`}
            style={{ color: 'var(--primary)' }}
            onClick={(e) => {
              e.preventDefault()
              onUser(id)
            }}
          >
            @{user}
          </a>,
        )
      } else {
        out.push(<Fragment key={`p${key}`}>@{user}</Fragment>)
      }
    }
    key += 1
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<Fragment key={`e${key}`}>{text.slice(last)}</Fragment>)
  return out
}
