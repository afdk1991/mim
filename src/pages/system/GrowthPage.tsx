/* ==========================================================================
 * 成长引擎 —— 成长值 / 等级 / 签到连击 / 徽章墙 / 行为规则
 *
 * 数据：规则与徽章来自 domain/growth；状态写本机 mim.growth.<uid>.state。
 * 坑：
 *  1. 签到日键必须用 social 的 dayKey()（补零格式），与 nextStreak 内部比较保持一致；
 *     用 growth 的 dayKeyOf()（不补零）会导致「昨天」判定失败、连击被误清零。
 *  2. 成长事件由各业务域上报，本页不伪造事件：没有记录时就是空态。
 *  3. 徽章首次达成才入账（code → 达成毫秒），重复渲染不会刷新时间。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { EVT, subscribe } from '../../core/events'
import { asNumber, asRecord, asString, readJson, userKey, writeJson } from '../../core/storage'
import { formatDate, formatDay } from '../../core/utils'
import { isBackendConfigured } from '../../core/config'
import { currentUid } from '../../data/session'
import { db } from '../../data/client'
import {
  BADGES,
  dayKeyOf,
  earnedBadges,
  GROWTH_RULES,
  growthScore,
  levelProgress,
  ruleOf,
} from '../../domain/growth/growth'
import type { GrowthEvent, GrowthState } from '../../domain/growth/growth'
import { dayKey, nextStreak } from '../../domain/social/model'
import { Empty, Tag, useToast } from '../../ui'

const SCOPE = 'growth'
const EVENT_SHOWN = 10

const EMPTY_STATE: GrowthState = { events: [], checkin: { last: '', streak: 0 }, badges: {} }

function parseEvents(raw: unknown): GrowthEvent[] | null {
  if (!Array.isArray(raw)) return null
  const out: GrowthEvent[] = []
  for (const v of raw) {
    const r = asRecord(v)
    if (!r) return null
    const id = asString(r.id)
    const action = asString(r.action)
    const at = asNumber(r.at)
    if (id === null || action === null || at === null) return null
    out.push({ id, action: action as GrowthEvent['action'], at })
  }
  return out
}

function parseGrowth(raw: unknown): GrowthState | null {
  const r = asRecord(raw)
  if (!r) return null
  const events = parseEvents(r.events)
  if (events === null) return null
  const c = asRecord(r.checkin)
  const badgesRaw = asRecord(r.badges)
  const badges: Record<string, number> = {}
  if (badgesRaw) {
    for (const [k, v] of Object.entries(badgesRaw)) {
      const ts = asNumber(v)
      if (ts !== null) badges[k] = ts
    }
  }
  return {
    events,
    checkin: {
      last: c ? asString(c.last) ?? '' : '',
      streak: c ? asNumber(c.streak) ?? 0 : 0,
    },
    badges,
  }
}

function stateKey(): string {
  return userKey(SCOPE, currentUid(), 'state')
}

/**
 * 服务端签到返回兼容两种形态：扁平 { last, streak } 或嵌套 { checkin: { last, streak } }。
 * last 可能是日期字符串或时间戳；时间戳统一走 dayKeyOf() 补零，与本地 dayKey() 一致。
 */
function coerceCheckin(raw: unknown): { last: string; streak: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const src = r.checkin && typeof r.checkin === 'object' ? (r.checkin as Record<string, unknown>) : r
  const rawLast = src.last
  const rawStreak = src.streak
  const streak = typeof rawStreak === 'number' ? rawStreak : Number(rawStreak)
  if (!Number.isFinite(streak)) return null
  let last = ''
  if (typeof rawLast === 'string') last = rawLast
  else if (typeof rawLast === 'number' && Number.isFinite(rawLast)) last = dayKeyOf(rawLast)
  return { last: last || dayKey(), streak }
}

export function GrowthPage() {
  const toast = useToast()
  const [state, setState] = useState<GrowthState>(() => readJson(stateKey(), parseGrowth, EMPTY_STATE))
  const [syncing, setSyncing] = useState(false)

  useEffect(() => subscribe(EVT.growth, () => setState(readJson(stateKey(), parseGrowth, EMPTY_STATE))), [])

  // GAP-03：挂载时以服务端为准拉取成长状态；连不上后端（未配置 / 表缺失）时
  // 静默回退本地 localStorage，绝不报错、不弹 toast，保证「未配置后端」页面仍可用。
  useEffect(() => {
    if (!isBackendConfigured()) return
    let alive = true
    void (async () => {
      setSyncing(true)
      const r = await db.rpc<GrowthState>('growth_state')
      if (!alive) return
      if (r.ok) {
        const pulled = parseGrowth(r.data)
        if (pulled) {
          setState(pulled)
          writeJson(stateKey(), pulled)
        }
      }
      setSyncing(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const score = growthScore(state.events)
  const { lv, pct, next } = levelProgress(score)
  const today = dayKey()
  const checkedToday = state.checkin.last === today
  const streak = state.checkin.streak

  // 首次达成的徽章入账：结算只依赖分数与连击，重复渲染不会改写已有达成时间
  useEffect(() => {
    const earned = earnedBadges(score, streak)
    const missing = earned.filter((code) => !(code in state.badges))
    if (missing.length === 0) return
    const badges = { ...state.badges }
    for (const code of missing) badges[code] = Date.now()
    const nextState: GrowthState = { ...state, badges }
    writeJson(stateKey(), nextState)
    setState(nextState)
  }, [score, streak, state])

  function onCheckin(): void {
    if (checkedToday) {
      toast('今日已签到，明天再来')
      return
    }
    const prev = state.checkin.last ? { streak: state.checkin.streak, total: 0, lastDate: state.checkin.last } : undefined
    const result = nextStreak(prev, today)
    // 本地乐观更新，保证离线 / 未配置后端时也能立即看到连击数
    const nextState: GrowthState = { ...state, checkin: { last: today, streak: result.streak } }
    writeJson(stateKey(), nextState)
    setState(nextState)
    toast(`签到成功，已连续 ${result.streak} 天`)

    // 已配置后端：调用服务端签到并据返回结果校正连击数（服务端为准）
    if (!isBackendConfigured()) return
    void (async () => {
      const r = await db.rpc<unknown>('growth_checkin', {}, { write: true })
      if (!r.ok) return // 失败静默：本地乐观态已保留，不打断用户
      const server = coerceCheckin(r.data)
      if (!server) return
      const s2: GrowthState = { ...state, checkin: { last: server.last, streak: server.streak } }
      writeJson(stateKey(), s2)
      setState(s2)
    })()
  }

  const recent = state.events.slice(-EVENT_SHOWN).reverse()

  return (
    <div className="page page-grid single">
      <h1 className="page-title">🌱 成长引擎</h1>
      <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        {isBackendConfigured()
          ? syncing
            ? '正在从云端同步成长状态…'
            : '成长状态以云端为准（未连通时回退本机）'
          : '当前未配置后端，成长数据仅保存在本机'}
      </p>

      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <b style={{ fontSize: 20 }}>Lv.{lv}</b>
          <Tag>成长值 {score}</Tag>
          <Tag>连击 {streak} 天</Tag>
        </div>
        <div className="growth-bar" style={{ marginTop: 10 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          距 Lv.{lv + 1} 还需 {Math.max(0, next - score)} 成长值（{pct.toFixed(0)}%）
        </div>

        <div className="row" style={{ marginTop: 14, gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={onCheckin} disabled={checkedToday}>
            {checkedToday ? '今日已签到' : '每日签到'}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {state.checkin.last ? `上次签到：${state.checkin.last}` : '还没有签到记录'}
          </span>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          签到计入连击与连击类徽章；成长值只由下方行为规则表记分，本页不会为了好看而补记事件。
        </p>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          徽章墙
        </div>
        <div className="badge-wall">
          {BADGES.map((b) => {
            const got = b.code in state.badges
            return (
              <div key={b.code} className={got ? 'badge-cell on' : 'badge-cell'}>
                <span className="badge-emoji">{b.emoji}</span>
                <b>{b.name}</b>
                <span className="muted" style={{ fontSize: 12 }}>
                  {b.desc}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {got ? `达成于 ${formatDay(state.badges[b.code] ?? 0) || '—'}` : '未达成'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          行为规则
        </div>
        <div className="col">
          {GROWTH_RULES.map((r) => (
            <div className="rule-row" key={r.action}>
              <span className="notif-icon">{r.icon}</span>
              <span className="grow">{r.label}</span>
              <Tag>{r.value > 0 ? `+${r.value}` : String(r.value)} 分</Tag>
              <span className="muted" style={{ fontSize: 12 }}>
                每日上限 {r.dailyCap === null ? '不限' : r.dailyCap}
                {r.qualityGate ? ' · 需过质量门' : ''}
              </span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          负分（违规扣分）不受每日上限约束，避免刷正向行为抵消处罚。
        </p>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          最近成长记录
        </div>
        {recent.length === 0 ? (
          <Empty emoji="📈" text="还没有成长记录：发布动态、文章或被采纳后由各业务域上报" />
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {recent.map((e) => {
              const r = ruleOf(e.action)
              return (
                <div className="notif-row" key={e.id}>
                  <span className="notif-icon">{r?.icon ?? '📌'}</span>
                  <div className="notif-body">
                    <div>
                      {r?.label ?? e.action} · {r ? `${r.value > 0 ? '+' : ''}${r.value} 分` : '—'}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {formatDate(e.at) || '—'} · {dayKeyOf(e.at)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
