/* ==========================================================================
 * VIP 状态与订单本机存储 —— mim.vip.<uid>.state / mim.vip.<uid>.orders
 *
 * 供 VipCenterPage 与 WalletPage 共用（钱包页的权益矩阵要知道 VIP 是否生效，
 * 两处各写一份解析逻辑必然漂移，所以收敛到这里）。
 *
 * 金额一律「分」；订单只增不删，退订不清空（已支付费用不予退回，凭证必须留着）。
 * ======================================================================== */

import { LIMITS } from '../../core/config'
import { asNumber, asRecord, asString, readJson, userKey, writeJson } from '../../core/storage'
import { currentUid } from '../../data/session'
import type { VipPlanId, VipState } from '../../domain/growth/growth'

const SCOPE = 'vip'

export const EMPTY_VIP: VipState = { plan: null, expireAt: 0 }

export interface VipOrder {
  id: string
  planId: VipPlanId
  label: string
  priceFen: number
  days: number
  at: number
}

function stateKey(): string {
  return userKey(SCOPE, currentUid(), 'state')
}

function ordersKey(): string {
  return userKey(SCOPE, currentUid(), 'orders')
}

function asPlanId(v: unknown): VipPlanId | null {
  return v === 'monthly' || v === 'quarterly' || v === 'yearly' ? v : null
}

function parseVip(raw: unknown): VipState | null {
  const r = asRecord(raw)
  if (!r) return null
  if (r.plan === null) return { ...EMPTY_VIP }
  const plan = asPlanId(r.plan)
  if (plan === null) return null
  const expireAt = asNumber(r.expireAt) ?? 0
  return { plan, expireAt: Math.max(0, Math.floor(expireAt)) }
}

function parseOrders(raw: unknown): VipOrder[] | null {
  if (!Array.isArray(raw)) return null
  const out: VipOrder[] = []
  for (const v of raw) {
    const r = asRecord(v)
    if (!r) return null
    const id = asString(r.id)
    const label = asString(r.label)
    const priceFen = asNumber(r.priceFen)
    const days = asNumber(r.days)
    const planId = asPlanId(r.planId)
    if (id === null || label === null || priceFen === null || days === null || planId === null) return null
    out.push({ id, planId, label, priceFen, days, at: asNumber(r.at) ?? 0 })
  }
  return out
}

export function getVipState(): VipState {
  return readJson(stateKey(), parseVip, EMPTY_VIP)
}

export function setVipState(v: VipState): void {
  writeJson(stateKey(), v)
}

export function getVipOrders(): VipOrder[] {
  return readJson(ordersKey(), parseOrders, [] as VipOrder[])
}

/** 新订单置顶，超出上限的旧订单丢弃（订单不保留则会丢失交易凭证） */
export function prependVipOrder(order: VipOrder): VipOrder[] {
  const next = [order, ...getVipOrders()].slice(0, LIMITS.vipOrderMax)
  writeJson(ordersKey(), next)
  return next
}
