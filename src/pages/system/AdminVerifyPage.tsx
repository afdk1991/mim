/* ==========================================================================
 * 券码核销 —— #/admin/verify（管理员可用，依赖管理员角色本身）
 *
 * 数据：db.rpc('verify_voucher', { p_code })，核销动作与服务端裁定均走服务端，
 *       前端不持有券码库存，避免伪造核销。
 * 坑：
 *  1. 必须通过 AdminGate 做前端身份判断 —— 非管理员（含未登录）直接给无权限态，
 *     不应渲染核销表单。
 *  2. 后端未就绪 / 核销失败时显示错误态，不预置「已核销」假结果。
 *  3. used_at 可能是时间戳或日期字符串，统一容错展示。
 * ======================================================================== */

import { useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { db } from '../../data/client'
import { errText } from '../../core/result'
import { formatDate } from '../../core/utils'
import { Empty, Tag, useToast } from '../../ui'

interface VerifyResult {
  code: string | null
  order_id: string | null
  used_at: string | number | null
}

/** used_at 容错展示：时间戳走 formatDate，字符串原样，空值给「—」 */
function fmtUsed(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return formatDate(v) || String(v)
  return String(v)
}

export function AdminVerifyPage() {
  return (
    <AdminGate>
      <VerifyInner />
    </AdminGate>
  )
}

function VerifyInner() {
  const toast = useToast()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onVerify(): Promise<void> {
    const p = code.trim()
    if (!p) {
      toast('请输入券码')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    // 核销是写类动作：write:true 显式声明，避免默认重试造成重复核销
    const r = await db.rpc<VerifyResult>('verify_voucher', { p_code: p }, { write: true })
    setLoading(false)
    if (!r.ok) {
      setError(errText(r.error))
      return
    }
    setResult(r.data)
    if (r.data && (r.data.order_id || r.data.used_at)) toast('核销成功')
  }

  return (
    <div className="page page-grid single">
      <h1 className="page-title">🎫 券码核销</h1>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          输入券码
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            className="input grow"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="例如 MIM-XXXX-XXXX"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onVerify()
            }}
          />
          <button className="btn btn-primary" onClick={onVerify} disabled={loading}>
            {loading ? '核验中…' : '核销'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          核销动作记录在服务端并写审计，前端不持有券码库存，无法绕过服务端裁定。
        </p>
      </div>

      {error ? (
        <div className="card">
          <Empty emoji="⚠️" text={error} />
        </div>
      ) : result ? (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <div className="section-title" style={{ marginTop: 0 }}>
              核验结果
            </div>
            {result.used_at ? <Tag>已核销</Tag> : <Tag>可用</Tag>}
          </div>
          <div className="kv-table">
            <div className="kv-row">
              <span className="muted">券码</span>
              <span>{result.code ?? '—'}</span>
            </div>
            <div className="kv-row">
              <span className="muted">订单号</span>
              <span>{result.order_id ?? '—'}</span>
            </div>
            <div className="kv-row">
              <span className="muted">核销时间</span>
              <span>{fmtUsed(result.used_at)}</span>
            </div>
          </div>
          {!result.used_at ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              该券码尚未核销，当前可正常使用。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
