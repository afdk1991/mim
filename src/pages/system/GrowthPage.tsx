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
import { currentUid } from '../../data/session'
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

export function GrowthPage() {
  const toast = useToast()
  const [state, setState] = useState<GrowthState>(() => readJson(stateKey(), parseGrowth, EMPTY_STATE))

  useEffect(() => subscribe(EVT.growth, () => setState(readJson(stateKey(), parseGrowth, EMPTY_STATE))), [])

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
    const nextState: GrowthState = { ...state, checkin: { last: today, streak: result.streak } }
    writeJson(stateKey(), nextState)
    setState(nextState)
    toast(`签到成功，已连续 ${result.streak} 天`)
  }

  const recent = state.events.slice(-EVENT_SHOWN).reverse()

  return (
    <div className="page page-grid single">
      <h1 className="page-title">🌱 成长引擎</h1>

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
