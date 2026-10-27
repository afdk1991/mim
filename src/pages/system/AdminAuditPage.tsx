/* ==========================================================================
 * 审计日志 —— #/admin/audit（需要 audit:view 权限）
 *
 * 数据：db.list('audit_logs', { order: { col: 'created_at', asc: false }, limit: 100 })
 * 坑：
 *  1. 表结构由 server 迁移决定，列可能缺失 —— 一律按可选字段读取，缺列显示「—」，不编造。
 *  2. 失败必须降级为空态 + 原因，绝不兜底演示日志（审计数据伪造等于掩盖操作）。
 *  3. created_at 可能是时间戳数字也可能是 ISO 字符串，两种都要能渲染。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { db } from '../../data/client'
import { formatDate } from '../../core/utils'
import { Empty, Skeleton } from '../../ui'

const PAGE_SIZE = 100

interface AuditRow {
  id?: string | number
  actor?: string
  action?: string
  target?: string
  detail?: string
  created_at?: string | number
}

/** 缺列 / 空值统一降级为「—」，避免把 undefined 渲染成空白让人以为是有效数据 */
function text(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const s = String(v)
  return s.trim() === '' ? '—' : s
}

function tsOf(v: string | number | undefined): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Date.parse(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

export function AdminAuditPage() {
  return (
    <AdminGate perm="audit:view">
      <AuditInner />
    </AdminGate>
  )
}

function AuditInner() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await db.list<AuditRow>('audit_logs', {
        order: { col: 'created_at', asc: false },
        limit: PAGE_SIZE,
      })
      if (!alive) return
      setLoading(false)
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setRows(r.data)
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="page page-grid single">
      <h1 className="page-title">📜 审计日志</h1>

      {loading ? (
        <Skeleton rows={4} height={64} />
      ) : error ? (
        <div className="card">
          <Empty emoji="🗄️" text="无法读取审计日志" />
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            原因：{error}。请确认 server 已部署且 audit_logs 表已建好（npm run server:migrate）。
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty emoji="📭" text="暂无审计记录：后台操作与写操作被服务端记录后会出现在这里" />
        </div>
      ) : (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            最近 {rows.length} 条
          </div>
          <div className="col">
            {rows.map((row, i) => {
              const at = tsOf(row.created_at)
              return (
                <div className="notif-row" key={row.id === undefined ? `row-${i}` : String(row.id)}>
                  <span className="notif-icon">🧾</span>
                  <div className="notif-body">
                    <div>
                      <b>{text(row.action)}</b> · {text(row.actor)}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      对象：{text(row.target)} · {text(row.detail)}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {at > 0 ? formatDate(at) : '时间未知'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
