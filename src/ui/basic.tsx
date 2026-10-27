/* ==========================================================================
 * 基础组件 —— 无业务依赖的展示型组件
 * 全部具名导出；按钮直接写 className="btn btn-primary"，不额外包一层 Button，
 * 与全站既有写法保持一致。
 * ======================================================================== */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { cx, timeAgo } from '../core/utils'

export function Avatar({ emoji, color, size = 44 }: { emoji: string; color: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.52),
      }}
      aria-hidden
    >
      {emoji}
    </span>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>
}

export function Badge({ cls = '', children }: { cls?: string; children: ReactNode }) {
  return <span className={cx('badge', cls)}>{children}</span>
}

export function Empty({ emoji = '📭', text = '暂无内容' }: { emoji?: string; text?: string }) {
  return (
    <div className="empty">
      <span className="empty-emoji">{emoji}</span>
      <span>{text}</span>
    </div>
  )
}

export function TimeAgo({ ts }: { ts: number }) {
  return <time className="muted">{timeAgo(ts)}</time>
}

export function Skeleton({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div className="col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-actions">{footer}</div> : null}
      </div>
    </div>
  )
}

/** 区块骨架：卡片式加载态 */
export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return <Skeleton rows={rows} height={96} />
}
