/* ==========================================================================
 * 统一钱包 —— 余额与流水的本机真源 + 云端权威回拉
 *
 * 金额一律「分」整数；流水保留最近 50 条。
 * 充值红线：不提供自助充值，必须扫码付款 + 服务端口令核销后才入账，
 * 页面不得出现「点一下余额就增加」的实现。
 * ======================================================================== */

import { readJson, userKey, writeJson } from '../../core/storage'
import { emit, EVT } from '../../core/events'
import { currentUid } from '../../data/session'
import type { PlanCode, TxKind, WalletState, WalletTx } from '../../domain/commerce/model'
import { LIMITS } from '../../core/config'
import { yuanText } from '../../core/utils'
import { emitToast } from '../../ui'
import { db } from '../../data/client'

const SCOPE = 'wallet'

const EMPTY: WalletState = { balanceFen: 0, plan: 'BASIC', txs: [] }

function parseWallet(raw: unknown): WalletState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.balanceFen !== 'number') return null
  const txs = Array.isArray(r.txs)
    ? (r.txs as WalletTx[]).filter(
        (t) => t && typeof t.id === 'number' && typeof t.fen === 'number' && typeof t.kind === 'string',
      )
    : []
  const plan: PlanCode =
    r.plan === 'SUPER' || r.plan === 'DOWNLOAD_PACK' || r.plan === 'ENTERPRISE' ? r.plan : 'BASIC'
  return { balanceFen: Math.max(0, Math.floor(r.balanceFen)), plan, txs }
}

export function getWalletState(): WalletState {
  return readJson(userKey(SCOPE, currentUid(), 'state'), parseWallet, EMPTY)
}

function save(w: WalletState): void {
  writeJson(userKey(SCOPE, currentUid(), 'state'), w)
  emit(EVT.wallet)
}

function push(id: number, kind: TxKind, fen: number, note: string): WalletState {
  const cur = getWalletState()
  const next: WalletState = {
    balanceFen:
      kind === 'consume' ? Math.max(0, cur.balanceFen - fen) : cur.balanceFen + fen,
    plan: cur.plan,
    txs: [{ id, kind, fen: Math.abs(fen), note, at: Date.now() }, ...cur.txs].slice(0, LIMITS.walletTxMax),
  }
  save(next)
  return next
}

/** 云端权威回拉：本地乐观更新后以服务端为准 */
async function hydrate(): Promise<void> {
  const r = await db.rpc<{ balance_fen: number }>('wallet_state', {})
  if (!r.ok) return
  const fen = Number((r.data as { balance_fen?: number })?.balance_fen ?? NaN)
  if (!Number.isFinite(fen)) return
  const cur = getWalletState()
  if (cur.balanceFen !== fen) save({ ...cur, balanceFen: fen })
}

/** 扣款：余额不足返回 false 并提示，调用方必须据此中止流程 */
export function walletConsume(fen: number, note: string): boolean {
  if (!Number.isFinite(fen) || fen <= 0) return false
  const cur = getWalletState()
  if (cur.balanceFen < fen) {
    emitToast(`余额不足：需 ¥${yuanText(fen)}，当前 ¥${yuanText(cur.balanceFen)}`)
    return false
  }
  push(Date.now(), 'consume', fen, note)
  void db.rpc('wallet_debit', { p_fen: fen, p_note: note }, { write: true }).then(() => hydrate())
  return true
}

export function walletRecharge(fen: number, note: string): void {
  if (!Number.isFinite(fen) || fen <= 0) return
  push(Date.now(), 'recharge', fen, note)
  void db.rpc('wallet_credit', { p_fen: fen, p_note: note, p_kind: 'recharge' }, { write: true }).then(() => hydrate())
}

export function walletIncome(fen: number, note: string): void {
  if (!Number.isFinite(fen) || fen <= 0) return
  push(Date.now(), 'income', fen, note)
  void db.rpc('wallet_credit', { p_fen: fen, p_note: note, p_kind: 'income' }, { write: true }).then(() => hydrate())
}

/** 启动时同步一次云端权威余额 */
export function hydrateWallet(): void {
  void hydrate()
}
