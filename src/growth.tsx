import './growth.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, TimeAgo, emitToast, useToast } from './components'
import { cx } from './utils'

/* ================= 统一成长引擎 =================
   蓝本：开发吧.md 4.1 growth_rule ——「一条引擎，两条线」。
   - 广场线 EXP：时效活跃，decay_days=30（demo 不模拟时间衰减，仅展示规则）；
   - 知识线 POINT：长尾资产，decay_days=0 永久累积；
   - 两条等级曲线量纲不同，数学上不可互换：
     广场 level = floor(exp^0.45 / 20)；知识 Lv = floor(point^0.5 / 8) + 1。
   独立存储：localStorage mim-growth-v1，不动 AppState/store/seed。
   轮 13 打通：对外暴露 recordGrowth 上报入口，广场/知识各端真实行为
   （发布/获赞/收藏/下载）经 store api 层流入本引擎；页内模拟按钮与
   外部上报共用同一份规则表、daily_cap 与徽章结算。 */

/** 域：1=广场态 2=知识态（开发吧.md content.domain 同源） */
type Domain = 1 | 2

/** growth_rule 单条规则（数值直接取自开发吧.md 配置表，改表不发版） */
interface GrowthRule {
  action: string
  domain: Domain | 0 // 0 = 双域通用
  reward: 'EXP' | 'POINT'
  value: number
  /** 每日上限次数；null = 无上限 */
  dailyCap: number | null
  decayDays: number
  qualityGate: boolean
  label: string
  icon: string
}

const GROWTH_RULES: GrowthRule[] = [
  { action: 'publish_dynamic', domain: 1, reward: 'EXP', value: 2, dailyCap: 10, decayDays: 30, qualityGate: false, label: '发动态', icon: '📝' },
  { action: 'dynamic_liked', domain: 1, reward: 'EXP', value: 1, dailyCap: 200, decayDays: 30, qualityGate: false, label: '动态获赞', icon: '⭐' },
  { action: 'live_open', domain: 1, reward: 'EXP', value: 50, dailyCap: 1, decayDays: 7, qualityGate: false, label: '开直播', icon: '📺' },
  { action: 'follow_gained', domain: 1, reward: 'EXP', value: 1, dailyCap: 50, decayDays: 30, qualityGate: false, label: '涨粉', icon: '👥' },
  { action: 'publish_article', domain: 2, reward: 'POINT', value: 10, dailyCap: 5, decayDays: 0, qualityGate: true, label: '发博文', icon: '✍️' },
  { action: 'article_collected', domain: 2, reward: 'POINT', value: 3, dailyCap: null, decayDays: 0, qualityGate: false, label: '博文被藏', icon: '📌' },
  { action: 'answer_adopted', domain: 2, reward: 'POINT', value: 20, dailyCap: null, decayDays: 0, qualityGate: false, label: '回答被采纳', icon: '🏅' },
  { action: 'resource_downloaded', domain: 2, reward: 'POINT', value: 5, dailyCap: null, decayDays: 0, qualityGate: false, label: '资源被下载', icon: '📦' },
  { action: 'column_finished', domain: 2, reward: 'POINT', value: 30, dailyCap: null, decayDays: 0, qualityGate: false, label: '专栏学完', icon: '🎓' },
  { action: 'course_review_good', domain: 2, reward: 'POINT', value: 5, dailyCap: null, decayDays: 0, qualityGate: false, label: '课程好评', icon: '💬' },
  { action: 'anti_spam_penalty', domain: 0, reward: 'POINT', value: -50, dailyCap: null, decayDays: 0, qualityGate: false, label: '反垃圾惩罚', icon: '🚫' },
]

interface GrowthEvent {
  id: number
  action: string
  at: number
}

interface GrowthState {
  events: GrowthEvent[]
  /** 签到：last = 最近签到日（本地 YYYY-M-D），streak = 连续天数 */
  checkin: { last: string; streak: number }
  /** 徽章解锁时间：code → 首次达成时刻（旧数据无此字段时 loadGrowth 自动补空对象） */
  badges: Record<string, number>
}

const GROWTH_KEY = 'mim-growth-v1'

function localDate(ts: number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function loadGrowth(): GrowthState {
  try {
    const v = JSON.parse(localStorage.getItem(GROWTH_KEY) ?? 'null') as GrowthState | null
    if (v && Array.isArray(v.events) && v.checkin && typeof v.checkin.last === 'string' && typeof v.checkin.streak === 'number') {
      return {
        events: v.events.filter((e) => e && typeof e.id === 'number' && typeof e.action === 'string' && typeof e.at === 'number'),
        checkin: { last: v.checkin.last, streak: v.checkin.streak },
        badges: v.badges && typeof v.badges === 'object' ? v.badges : {},
      }
    }
  } catch {
    /* ignore */
  }
  return { events: [], checkin: { last: '', streak: 0 }, badges: {} }
}

/** 广场等级曲线：level = floor(exp^0.45 / 20)（point 可能为负，钳 0） */
function feedLevel(exp: number): number {
  return Math.floor(Math.pow(Math.max(0, exp), 0.45) / 20)
}

/** 知识等级曲线：Lv = floor(point^0.5 / 8) + 1（point 可能为负，钳 0） */
function kbLevel(point: number): number {
  return Math.floor(Math.sqrt(Math.max(0, point)) / 8) + 1
}

/** 徽章定义：cond 基于双线数值与签到 streak 派生；metric/target 供锁定态推导进度提示 */
const BADGES: {
  code: string
  icon: string
  label: string
  desc: string
  /** 进度度量：exp/point/streak 单线达标；both = 双线同时达标（取短板） */
  metric: 'exp' | 'point' | 'streak' | 'both'
  target: number
  cond: (s: { exp: number; point: number; streak: number }) => boolean
}[] = [
  { code: 'seed', icon: '🌱', label: '初来乍到', desc: '广场 EXP ≥ 10', metric: 'exp', target: 10, cond: (s) => s.exp >= 10 },
  { code: 'regular', icon: '🔥', label: '广场常客', desc: '广场 EXP ≥ 100', metric: 'exp', target: 100, cond: (s) => s.exp >= 100 },
  { code: 'star', icon: '📣', label: '广场红人', desc: '广场 EXP ≥ 500', metric: 'exp', target: 500, cond: (s) => s.exp >= 500 },
  { code: 'first', icon: '✍️', label: '首篇博文', desc: '知识 POINT ≥ 10', metric: 'point', target: 10, cond: (s) => s.point >= 10 },
  { code: 'scholar', icon: '📚', label: '知识达人', desc: '知识 POINT ≥ 200', metric: 'point', target: 200, cond: (s) => s.point >= 200 },
  { code: 'expert', icon: '🎓', label: '领域专家', desc: '知识 POINT ≥ 1000', metric: 'point', target: 1000, cond: (s) => s.point >= 1000 },
  { code: 'week', icon: '📅', label: '七日之约', desc: '连续签到 7 天', metric: 'streak', target: 7, cond: (s) => s.streak >= 7 },
  { code: 'dual', icon: '🏆', label: '双线开花', desc: '两条线同时 ≥ 50', metric: 'both', target: 50, cond: (s) => s.exp >= 50 && s.point >= 50 },
]

/** 锁定徽章进度：由 metric/target 推导当前值与达成百分比；dual 取双线短板 */
function badgeProgress(
  b: (typeof BADGES)[number],
  s: { exp: number; point: number; streak: number },
): { cur: number; pct: number; text: string } {
  const pos = (n: number) => Math.max(0, n) // 负分钳 0（惩罚事件会让 point 为负）
  if (b.metric === 'both') {
    const exp = pos(s.exp)
    const point = pos(s.point)
    const short = Math.min(exp, point) // 双线短板决定整体进度
    return {
      cur: short,
      pct: Math.min(100, Math.round((short / b.target) * 100)),
      text: `EXP ${exp}/${b.target} · POINT ${point}/${b.target}`,
    }
  }
  const cur = b.metric === 'exp' ? pos(s.exp) : b.metric === 'point' ? pos(s.point) : pos(s.streak)
  const unit = b.metric === 'streak' ? ' 天' : ''
  const name = b.metric === 'exp' ? 'EXP' : b.metric === 'point' ? 'POINT' : '连续'
  return { cur, pct: Math.min(100, Math.round((cur / b.target) * 100)), text: `${name} ${cur}/${b.target}${unit}` }
}

/** 合并徽章解锁时间：next 状态下新解锁的 code 记录首次达成时刻（以 next.badges 为基底，清空后可重新计时） */
function withBadgeTimes(next: GrowthState): GrowthState {
  let exp = 0
  let point = 0
  for (const e of next.events) {
    const rule = GROWTH_RULES.find((r) => r.action === e.action)
    if (!rule) continue
    if (rule.reward === 'EXP') exp += rule.value
    else point += rule.value
  }
  const ctx = { exp, point, streak: next.checkin.streak }
  const badges = { ...next.badges }
  let changed = false
  for (const code of BADGES.filter((b) => b.cond(ctx)).map((b) => b.code)) {
    if (!(code in badges)) {
      badges[code] = Date.now()
      changed = true
    }
  }
  return changed ? { ...next, badges } : next
}

/* ---------- 跨模块上报入口（轮 13 打通）----------
   store api 层在真实行为发生时调用；与页内 trigger() 共用规则表/daily_cap/徽章结算，
   落盘后派发 GROWTH_UPDATE_EVT 让成长页实时刷新。 */

/** 成长数据变更事件名：GrowthPage 监听以同步外部上报 */
export const GROWTH_UPDATE_EVT = 'mim-growth-update'

/** 记分结果：ok=已入账；否则给出原因（无规则/达上限/未过质量门），供调用方联动 */
export type GrowthFeedback =
  | { ok: true; label: string; value: number; reward: 'EXP' | 'POINT' }
  | { ok: false; reason: 'no-rule' | 'cap' | 'quality' }

/** 外部行为记分：规则校验 → 质量门 → daily_cap → 落盘（含徽章合并）→ 派发刷新事件 → toast */
export function recordGrowth(action: string, opts?: { quality?: boolean }): GrowthFeedback {
  const rule = GROWTH_RULES.find((r) => r.action === action)
  if (!rule) return { ok: false, reason: 'no-rule' }
  if (rule.qualityGate && !(opts?.quality ?? false)) {
    emitToast(`「${rule.label}」未过质量门，本次不计分`)
    return { ok: false, reason: 'quality' }
  }
  const cur = loadGrowth()
  const today = localDate(Date.now())
  if (rule.dailyCap !== null && rule.value > 0) {
    const used = cur.events.filter((e) => e.action === action && localDate(e.at) === today).length
    if (used >= rule.dailyCap) {
      emitToast(`「${rule.label}」已达今日上限 ${rule.dailyCap} 次`)
      return { ok: false, reason: 'cap' }
    }
  }
  const merged = withBadgeTimes({
    ...cur,
    events: [...cur.events, { id: Date.now(), action, at: Date.now() }],
  })
  try {
    localStorage.setItem(GROWTH_KEY, JSON.stringify(merged))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(GROWTH_UPDATE_EVT))
  emitToast(`🚀 已记分「${rule.label}」 ${rule.value > 0 ? '+' : ''}${rule.value} ${rule.reward}`)
  return { ok: true, label: rule.label, value: rule.value, reward: rule.reward }
}

/** 等级进度：返回 [当前级, 下一级, 进度 0-100] */
function levelProgress(kind: 'feed' | 'kb', num: number): [number, number, number] {
  if (kind === 'feed') {
    const cur = feedLevel(num)
    const pow = 1 / 0.45
    const prev = cur === 0 ? 0 : Math.pow(20 * cur, pow)
    const next = Math.pow(20 * (cur + 1), pow)
    const pct = next === prev ? 100 : ((num - prev) / (next - prev)) * 100
    return [cur, cur + 1, Math.min(100, Math.max(0, pct))]
  }
  const cur = kbLevel(num)
  const prev = 64 * (cur - 1) * (cur - 1)
  const next = 64 * cur * cur
  const safe = Math.max(0, num)
  const pct = next === prev ? 100 : ((safe - prev) / (next - prev)) * 100
  return [cur, cur + 1, Math.min(100, Math.max(0, pct))]
}

export function GrowthPage() {
  const toast = useToast()
  const [state, setState] = useState<GrowthState>(loadGrowth)
  const today = localDate(Date.now())
  const yesterday = localDate(Date.now() - 86_400_000)

  /* 轮 13 打通：外部上报（store api 层的发布/获赞/收藏/下载）实时同步——
     recordGrowth 落盘后派发统一事件，本页重读 localStorage 保持视图一致 */
  useEffect(() => {
    const sync = () => setState(loadGrowth())
    window.addEventListener(GROWTH_UPDATE_EVT, sync)
    return () => window.removeEventListener(GROWTH_UPDATE_EVT, sync)
  }, [])

  const checkedToday = state.checkin.last === today

  /* 派生：双线累计值 + 今日各行为计数（daily_cap 依据） */
  const { exp, point, todayCount } = useMemo(() => {
    let exp = 0
    let point = 0
    const todayCount: Record<string, number> = {}
    for (const e of state.events) {
      const rule = GROWTH_RULES.find((r) => r.action === e.action)
      if (!rule) continue
      if (rule.reward === 'EXP') exp += rule.value
      else point += rule.value
      if (localDate(e.at) === today) todayCount[e.action] = (todayCount[e.action] ?? 0) + 1
    }
    return { exp, point, todayCount }
  }, [state, today])

  const persist = (next: GrowthState) => {
    const merged = withBadgeTimes(next) // 落盘前合并新解锁徽章的首次达成时刻
    setState(merged)
    try {
      localStorage.setItem(GROWTH_KEY, JSON.stringify(merged))
    } catch {
      /* ignore */
    }
  }

  /** 触发行为：尊重 daily_cap；负值行为（惩罚）不受上限约束 */
  const trigger = (rule: GrowthRule) => {
    if (rule.dailyCap !== null && rule.value > 0 && (todayCount[rule.action] ?? 0) >= rule.dailyCap) {
      toast(`「${rule.label}」已达今日上限 ${rule.dailyCap} 次`)
      return
    }
    persist({
      ...state,
      events: [...state.events, { id: Date.now(), action: rule.action, at: Date.now() }],
    })
    toast(`已记录「${rule.label}」 ${rule.value > 0 ? '+' : ''}${rule.value} ${rule.reward}`)
  }

  /** 签到：断签即重置（昨天没签则从 1 重新计） */
  const checkin = () => {
    if (checkedToday) return
    const streak = state.checkin.last === yesterday ? state.checkin.streak + 1 : 1
    persist({ ...state, checkin: { last: today, streak } })
    toast(streak >= 7 ? `已签到，连续 ${streak} 天，徽章「七日之约」到手！` : `已签到，连续 ${streak} 天`)
  }

  const feed = levelProgress('feed', exp)
  const kb = levelProgress('kb', point)
  const badgeCtx = { exp, point, streak: state.checkin.streak }
  const flows = [...state.events].reverse().slice(0, 10)

  /* 徽章派生：已解锁集合 + 计数（徽章墙「已解锁 X/8」摘要） */
  const unlockedCodes = useMemo(() => BADGES.filter((b) => b.cond(badgeCtx)).map((b) => b.code), [exp, point, state.checkin.streak])
  const unlockedCount = unlockedCodes.length

  /* 新解锁高亮：会话内记录新达成徽章 code，卡片播放发光动画（刷新后消失） */
  const [freshCodes, setFreshCodes] = useState<string[]>([])
  /* 解锁瞬间提示：对比上次解锁集合，新增徽章即 toast（首次挂载只记录不提示） */
  const unlockedKey = unlockedCodes.join(',')
  const prevUnlockedRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevUnlockedRef.current
    prevUnlockedRef.current = unlockedKey
    if (prev === null) return
    const prevSet = new Set(prev ? prev.split(',') : [])
    const newly = unlockedCodes.filter((c) => !prevSet.has(c))
    if (newly.length > 0) {
      const metas = BADGES.filter((b) => newly.includes(b.code))
      const allDone = unlockedCodes.length === BADGES.length
      toast(`🏅 解锁新徽章：${metas.map((b) => `${b.icon} ${b.label}`).join('、')}${allDone ? ' · 🎉 全部徽章达成！' : ''}`)
      setFreshCodes((f) => [...new Set([...f, ...newly])])
    }
  }, [unlockedKey, unlockedCodes, toast])

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🚀 统一成长引擎</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>
          一条引擎两条线（开发吧.md growth_rule）：广场互动分有时效、知识贡献分永久累积，两条等级曲线量纲不同、数学上不可互换。
        </p>

        {/* 双线等级 */}
        <div className="gr-duo">
          <div className="card gr-line">
            <div className="gr-line-head">
              <b>🎬 广场互动分</b>
              <span className="gr-reward gr-reward-exp">EXP {exp}</span>
            </div>
            <div className="gr-level-num">Lv.{feed[0]}</div>
            <div className="gr-bar" role="progressbar" aria-valuenow={Math.round(feed[2])} aria-valuemin={0} aria-valuemax={100} aria-label="广场等级进度">
              <div className="gr-bar-fill" style={{ width: `${feed[2]}%` }} />
            </div>
            <small className="gr-hint">成长至 Lv.{feed[1]} · 曲线 floor(exp^0.45/20) · 30 天衰减</small>
          </div>
          <div className="card gr-line">
            <div className="gr-line-head">
              <b>📚 知识贡献分</b>
              <span className="gr-reward gr-reward-point">POINT {point}</span>
            </div>
            <div className="gr-level-num">Lv.{kb[0]}</div>
            <div className="gr-bar" role="progressbar" aria-valuenow={Math.round(kb[2])} aria-valuemin={0} aria-valuemax={100} aria-label="知识等级进度">
              <div className="gr-bar-fill gr-bar-kb" style={{ width: `${kb[2]}%` }} />
            </div>
            <small className="gr-hint">成长至 Lv.{kb[1]} · 曲线 floor(point^0.5/8)+1 · 零衰减永久累积</small>
          </div>
        </div>

        {/* 签到 + 徽章 */}
        <div className="gr-duo">
          <div className="card gr-checkin">
            <b>📅 每日签到</b>
            <div className="gr-streak">连续 <em>{state.checkin.streak}</em> 天</div>
            <button className="btn btn-primary gr-checkin-btn" disabled={checkedToday} onClick={checkin}>
              {checkedToday ? '今日已签到 ✓' : '签到'}
            </button>
            <small className="gr-hint">断签重新计数，连续 7 天解锁「七日之约」徽章</small>
          </div>
          <div className="card">
            <div className="gr-badge-head">
              <b>🏅 徽章墙</b>
              <span className="gr-badge-count">
                已解锁 {unlockedCount}/{BADGES.length}
                {unlockedCount === BADGES.length && <em className="gr-badge-all">🎉 全徽章达成</em>}
              </span>
            </div>
            <div className="gr-badges">
              {BADGES.map((b) => {
                const unlocked = b.cond(badgeCtx)
                const prog = unlocked ? null : badgeProgress(b, badgeCtx)
                const fresh = unlocked && freshCodes.includes(b.code)
                return (
                  <div key={b.code} className={cx('gr-badge', !unlocked && 'locked', fresh && 'fresh')} title={b.desc}>
                    <i aria-hidden>{b.icon}</i>
                    <span>{b.label}</span>
                    <small>{b.desc}</small>
                    {/* 已解锁：显示首次达成日期（旧数据无时间戳则仅显示「已解锁」） */}
                    {unlocked && <small className="gr-badge-time">{state.badges[b.code] ? `${localDate(state.badges[b.code])} 解锁` : '已解锁'}</small>}
                    {/* 锁定态进度提示：当前值/目标值 + 细进度条，解锁后自动隐藏 */}
                    {prog && (
                      <>
                        <small className="gr-badge-prog">{prog.text}</small>
                        <div className="gr-badge-bar" role="progressbar" aria-valuenow={prog.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.label}达成进度`}>
                          <i style={{ width: `${prog.pct}%` }} />
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 行为模拟触发（demo） */}
        <div className="card">
          <b>⚡ 模拟行为触发</b>
          <p className="muted gr-act-tip">demo 直接记事件；真实链路由广场/知识各端行为上报统一引擎结算，逐日受 daily_cap 约束。</p>
          <div className="gr-actions">
            {GROWTH_RULES.map((r) => {
              const used = todayCount[r.action] ?? 0
              const capped = r.dailyCap !== null && r.value > 0 && used >= r.dailyCap
              return (
                <button
                  key={r.action}
                  className={cx('gr-act-btn', capped && 'capped')}
                  disabled={capped}
                  onClick={() => trigger(r)}
                  title={capped ? '已达今日上限' : r.label}
                >
                  <i aria-hidden>{r.icon}</i>
                  <span>{r.label}</span>
                  <em className={r.value < 0 ? 'neg' : ''}>
                    {r.value > 0 ? '+' : ''}
                    {r.value} {r.reward}
                  </em>
                  <small>
                    今日 {used}/{r.dailyCap ?? '∞'}
                    {r.qualityGate ? ' · 需质量门' : ''}
                  </small>
                </button>
              )
            })}
          </div>
        </div>

        {/* 成长流水 */}
        <div className="card">
          <b>🧾 成长流水</b>
          {flows.length === 0 ? (
            <Empty emoji="🌱" text="还没有成长记录，点上面的行为按钮试试" />
          ) : (
            <div className="gr-flow">
              {flows.map((e) => {
                const rule = GROWTH_RULES.find((r) => r.action === e.action)
                return (
                  <div key={e.id} className="gr-flow-row">
                    <span className="gr-flow-ico" aria-hidden>{rule?.icon ?? '•'}</span>
                    <span className="gr-flow-label">{rule?.label ?? e.action}</span>
                    {rule && <span className={cx('tag', rule.domain === 1 && 'gr-tag-feed', rule.domain === 2 && 'gr-tag-kb')}>{rule.domain === 1 ? '广场' : rule.domain === 2 ? '知识' : '通用'}</span>}
                    <em className={cx('gr-flow-val', (rule?.value ?? 0) < 0 && 'neg')}>
                      {(rule?.value ?? 0) > 0 ? '+' : ''}
                      {rule?.value ?? 0} {rule?.reward}
                    </em>
                    <small className="gr-flow-time">
                      <TimeAgo ts={e.at} />
                    </small>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* growth_rule 配置表（可直接导入的运营配置） */}
        <div className="card">
          <b>📋 growth_rule 配置表</b>
          <div className="gr-table-wrap">
            <table className="gr-table">
              <thead>
                <tr>
                  <th>行为</th>
                  <th>域</th>
                  <th>奖励</th>
                  <th>数值</th>
                  <th>日上限</th>
                  <th>衰减</th>
                  <th>质量门</th>
                </tr>
              </thead>
              <tbody>
                {GROWTH_RULES.map((r) => (
                  <tr key={r.action}>
                    <td>{r.icon} {r.label}</td>
                    <td>{r.domain === 1 ? '广场' : r.domain === 2 ? '知识' : '通用'}</td>
                    <td>{r.reward}</td>
                    <td className={r.value < 0 ? 'gr-neg' : ''}>{r.value}</td>
                    <td>{r.dailyCap === null ? '无' : `${r.dailyCap} 次`}</td>
                    <td>{r.decayDays === 0 ? '不衰减' : `${r.decayDays} 天`}</td>
                    <td>{r.qualityGate ? '需' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="gr-warn">
            ⚠️ 红线：广场 EXP 与知识 POINT 数值不等价、衰减不同（30 天 vs 0）、等级曲线量纲互斥，严禁互相兑换或合并展示；demo 不模拟时间衰减，仅做规则展示。
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (!window.confirm('确定清空全部成长数据（含签到与徽章进度）吗？')) return
                persist({ events: [], checkin: { last: '', streak: 0 }, badges: {} })
                toast('成长数据已清空')
              }}
            >
              清空成长数据
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
