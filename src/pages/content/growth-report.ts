/* ==========================================================================
 * 成长事件上报（内容域侧写入）
 *
 * 约定：本机状态键 mim.growth.<uid>.state，与系统域成长页（GrowthPage）共用同一份。
 * 铁律：
 *  1. 一律先过 domain/growth.evaluate() —— 质量门（publish_article 正文去空白 ≥50 字）
 *     与每日上限都在 evaluate 内判定，上报方不绕过、不补记、不预铺事件。
 *  2. 只有「真实发生了的行为」才上报：点赞只在「由未赞变已赞」时上报，
 *     关注只在「由未关注变已关注」时上报，取消不再倒扣（与原实现一致）。
 * ======================================================================== */

import { currentUid } from '@/data/session'
import { emit, EVT } from '@/core/events'
import { arrayOf, asNumber, asRecord, asString, readJson, userKey, writeJson } from '@/core/storage'
import { uid } from '@/core/utils'
import type { GrowthAction, GrowthState } from '@/domain/growth/growth'
import { evaluate } from '@/domain/growth/growth'

const SCOPE = 'growth'

const EMPTY_STATE: GrowthState = { events: [], checkin: { last: '', streak: 0 }, badges: {} }

function parseEvent(v: unknown): GrowthState['events'][number] | null {
  const r = asRecord(v)
  if (!r) return null
  const id = asString(r.id)
  const action = asString(r.action)
  const at = asNumber(r.at)
  if (id === null || action === null || at === null) return null
  return { id, action: action as GrowthAction, at }
}

function parseGrowth(raw: unknown): GrowthState | null {
  const r = asRecord(raw)
  if (!r) return null
  const events = arrayOf(parseEvent)(r.events)
  if (events === null) return null
  const c = asRecord(r.checkin)
  const badgesRaw = asRecord(r.badges) ?? {}
  const badges: Record<string, number> = {}
  for (const [k, v] of Object.entries(badgesRaw)) {
    const ts = asNumber(v)
    if (ts !== null) badges[k] = ts
  }
  return {
    events,
    checkin: { last: c ? asString(c.last) ?? '' : '', streak: c ? asNumber(c.streak) ?? 0 : 0 },
    badges,
  }
}

function stateKey(): string {
  return userKey(SCOPE, currentUid(), 'state')
}

export function loadGrowthState(): GrowthState {
  return readJson(stateKey(), parseGrowth, EMPTY_STATE)
}

export interface GrowthReportResult {
  ok: boolean
  /** ok=false 时的原因：质量门未过 / 当日已达上限 / 未知行为 */
  reason?: 'quality' | 'cap' | 'unknown'
  delta?: number
}

/**
 * 上报一次行为：evaluate 判定通过才落盘 + 广播。
 * 返回判定结果，便于调用方在 toast 里如实说明「为什么没加成长值」。
 */
export function reportGrowth(action: GrowthAction, quality = true): GrowthReportResult {
  const state = loadGrowthState()
  const outcome = evaluate(state, { action, quality })
  if (!outcome.ok) return { ok: false, reason: outcome.reason }
  const next: GrowthState = { ...state, events: [...state.events, { id: uid('g'), action, at: Date.now() }] }
  writeJson(stateKey(), next)
  emit(EVT.growth)
  return { ok: true, delta: outcome.delta }
}
