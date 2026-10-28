/* ==========================================================================
 * 充值核销 —— #/admin/recharge
 *
 * 为什么必须走服务端 RPC：
 *  wallet_balances 不在 REST 白名单、wallet_txs 是 write:'none'，
 *  前端无法也不应直接改他人余额；入账由服务端校验管理员角色后，
 *  在同一事务内完成「加余额 + 记充值流水 + 写 audit_logs 留痕」。
 *
 * 流程：管理员收到用户的充值申请（邮件 / 线下）→ 核对收款 →
 *      按用户名或 UUID 查出用户 → 填金额入账 → 在下方流水中核对。
 * 红线：本页绝不「点一下就加钱」而不留痕，也不预置任何演示流水。
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { db } from '../../data/client'
import { errText } from '../../core/result'
import { formatDate, yuanText, yuanToFen } from '../../core/utils'
import { Empty, Skeleton, Tag, useToast } from '../../ui'

interface UserHit {
  id: string
  username: string | null
  name: string | null
  balance_fen: number
}

interface LedgerRow {
  id: number | string
  user_id: string
  username: string | null
  fen: number
  note: string | null
  at: number
}

interface LedgerResult {
  rows: LedgerRow[]
}

const LEDGER_LIMIT = 50

export function AdminRechargePage() {
  return (
    <AdminGate>
      <RechargeInner />
    </AdminGate>
  )
}

function RechargeInner() {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [looking, setLooking] = useState(false)
  const [hit, setHit] = useState<UserHit | null>(null)

  const [amountYuan, setAmountYuan] = useState('')
  const [note, setNote] = useState('')
  const [crediting, setCrediting] = useState(false)

  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [ledgerError, setLedgerError] = useState<string | null>(null)

  const loadLedger = useCallback(async () => {
    const r = await db.rpc<LedgerResult>('admin_wallet_ledger', { p_limit: LEDGER_LIMIT })
    setLedgerLoading(false)
    if (!r.ok) {
      setLedgerError(errText(r.error))
      return
    }
    setLedgerError(null)
    setLedger(r.data.rows)
  }, [])

  useEffect(() => {
    void loadLedger()
  }, [loadLedger])

  const lookup = async () => {
    const q = query.trim()
    if (!q) {
      toast('请输入用户名或用户 UUID')
      return
    }
    setLooking(true)
    const r = await db.rpc<UserHit>('admin_user_lookup', { p_query: q })
    setLooking(false)
    if (!r.ok) {
      setHit(null)
      toast(errText(r.error))
      return
    }
    setHit(r.data)
  }

  const credit = async () => {
    if (!hit) {
      toast('请先核对用户')
      return
    }
    const fen = yuanToFen(Number(amountYuan) || 0)
    if (!Number.isFinite(fen) || fen <= 0) {
      toast('请输入正确的入账金额')
      return
    }
    setCrediting(true)
    const r = await db.rpc<{ balance_fen: number; fen: number }>(
      'admin_wallet_credit',
      { p_user_id: hit.id, p_fen: fen, p_note: note.trim() },
      { write: true },
    )
    setCrediting(false)
    if (!r.ok) {
      toast(errText(r.error))
      return
    }
    toast(`已入账 ¥${yuanText(fen)}，当前余额 ¥${yuanText(r.data.balance_fen)}`)
    setHit({ ...hit, balance_fen: r.data.balance_fen })
    setAmountYuan('')
    setNote('')
    setLedgerLoading(true)
    void loadLedger()
  }

  return (
    <div className="page page-grid single">
      <h1 className="page-title">🪙 充值核销</h1>

      <div className="card">
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          充值不会自动到账：用户扫码付款后线下提交申请，管理员核对收款后在本页入账。每次入账都会写入审计日志（wallet.credit），可在「审计日志」追溯。
        </p>
      </div>

      <div className="section-title">① 用户核对</div>
      <div className="card col">
        <div className="row wrap">
          <input
            className="mall-biz-input"
            placeholder="用户名 或 用户 UUID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary" disabled={looking} onClick={() => void lookup()}>
            {looking ? '查询中…' : '查询'}
          </button>
        </div>
        {hit ? (
          <div className="card" style={{ marginTop: 8 }}>
            <div className="row-between" style={{ alignItems: 'center' }}>
              <div>
                <b>{hit.name || hit.username || '（未命名）'}</b>
                <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                  @{hit.username || '无用户名'}
                </span>
              </div>
              <Tag>余额 ¥{yuanText(hit.balance_fen)}</Tag>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              UUID：{hit.id}
            </div>
          </div>
        ) : (
          <small className="muted">先查询并确认用户身份，再执行入账。</small>
        )}
      </div>

      <div className="section-title">② 核销入账</div>
      <div className="card col">
        <div className="row wrap">
          <input
            className="mall-biz-input"
            inputMode="decimal"
            placeholder="入账金额（元）"
            value={amountYuan}
            onChange={(e) => setAmountYuan(e.target.value)}
          />
          <input
            className="mall-biz-input"
            placeholder="备注（交易单号 / 收款说明，可空）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={!hit || crediting} onClick={() => void credit()}>
          {crediting ? '入账中…' : hit ? `确认入账 ¥${yuanText(yuanToFen(Number(amountYuan) || 0))}` : '请先核对用户'}
        </button>
        <small className="muted">金额按「元」输入，落库为「分」；服务端校验管理员角色后才写入余额。</small>
      </div>

      <div className="section-title">最近充值记录（{ledger.length}）</div>
      {ledgerLoading ? (
        <Skeleton rows={3} height={56} />
      ) : ledgerError ? (
        <div className="card">
          <Empty emoji="🗄️" text="无法读取充值流水" />
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            原因：{ledgerError}。请确认 server 已部署并完成数据库迁移（npm run server:migrate）。
          </p>
        </div>
      ) : ledger.length === 0 ? (
        <div className="card">
          <Empty emoji="🧾" text="暂无充值记录：完成首次核销后这里会出现流水" />
        </div>
      ) : (
        <div className="col">
          {ledger.map((t) => (
            <div className="card notif-row" key={t.id}>
              <span className="notif-icon">🪙</span>
              <div className="notif-body">
                <div className="row-between">
                  <b>@{t.username || t.user_id}</b>
                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                    ＋¥{yuanText(t.fen)}
                  </span>
                </div>
                <small className="muted">
                  {t.note || '—'} · {formatDate(t.at)}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
