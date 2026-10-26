import './growth.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Modal, TimeAgo, emitToast, useToast } from './components'
import { getCurrentUserId, useAuth } from './auth'
import { cx } from './utils'

/* ================= 统一成长引擎 =================
   蓝本：开发吧.md 4.1 growth_rule —— 单态（2026-10-23）统一为一条成长线。
   - 所有行为累积单一「成长值」，无广场/知识分轨；
   - 单一等级曲线：Lv = floor(sqrt(score)/8) + 1（永久累积，demo 不模拟时间衰减）。
   独立存储：localStorage mim-growth-v1，不动 AppState/store/seed。
   轮 13 打通：对外暴露 recordGrowth 上报入口，各端真实行为
   （发布/获赞/收藏/下载）经 store api 层流入本引擎；页内模拟按钮与
   外部上报共用同一份规则表、daily_cap 与徽章结算。
   轮 17 打通：成长数据按真实登录身份隔离（mim-growth-v1:<userId>），切号即重载。
   轮 18/19 打通：徽章墙展示增强——筛选 Tab / 距下一枚徽章提示 / 点击详情弹窗。 */

/** 单态：成长值统一累加，不再区分广场/知识域 */

/** growth_rule 单条规则（数值直接取自开发吧.md 配置表，改表不发版；单态下统一成长值） */
interface GrowthRule {
  action: string
  reward: 'GROWTH'
  value: number
  /** 每日上限次数；null = 无上限 */
  dailyCap: number | null
  decayDays: number
  qualityGate: boolean
  label: string
  icon: string
}

const GROWTH_RULES: GrowthRule[] = [
  { action: 'publish_dynamic', reward: 'GROWTH', value: 2, dailyCap: 10, decayDays: 30, qualityGate: false, label: '发动态', icon: '📝' },
  { action: 'dynamic_liked', reward: 'GROWTH', value: 1, dailyCap: 200, decayDays: 30, qualityGate: false, label: '动态获赞', icon: '⭐' },
  { action: 'live_open', reward: 'GROWTH', value: 50, dailyCap: 1, decayDays: 7, qualityGate: false, label: '开直播', icon: '📺' },
  { action: 'follow_gained', reward: 'GROWTH', value: 1, dailyCap: 50, decayDays: 30, qualityGate: false, label: '涨粉', icon: '👥' },
  { action: 'publish_article', reward: 'GROWTH', value: 10, dailyCap: 5, decayDays: 0, qualityGate: true, label: '发博文', icon: '✍️' },
  { action: 'article_collected', reward: 'GROWTH', value: 3, dailyCap: null, decayDays: 0, qualityGate: false, label: '博文被藏', icon: '📌' },
  { action: 'answer_adopted', reward: 'GROWTH', value: 20, dailyCap: null, decayDays: 0, qualityGate: false, label: '回答被采纳', icon: '🏅' },
  { action: 'resource_downloaded', reward: 'GROWTH', value: 5, dailyCap: null, decayDays: 0, qualityGate: false, label: '资源被下载', icon: '📦' },
  { action: 'column_finished', reward: 'GROWTH', value: 30, dailyCap: null, decayDays: 0, qualityGate: false, label: '专栏学完', icon: '🎓' },
  { action: 'course_review_good', reward: 'GROWTH', value: 5, dailyCap: null, decayDays: 0, qualityGate: false, label: '课程好评', icon: '💬' },
  { action: 'anti_spam_penalty', reward: 'GROWTH', value: -50, dailyCap: null, decayDays: 0, qualityGate: false, label: '反垃圾惩罚', icon: '🚫' },
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

/* 轮 17 打通：成长数据按登录身份分 key 隔离 */
const growthKeyFor = (userId: string) => `mim-growth-v1:${userId}`

function localDate(ts: number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 校验并解析成长存档（缺失/非法返回 null） */
function parseGrowth(raw: string | null): GrowthState | null {
  try {
    const v = JSON.parse(raw ?? 'null') as GrowthState | null
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
  return null
}

/** 读取当前身份的成长数据（页面重载场景显式传 userId，避免与身份单例同步竞态） */
function loadGrowth(userId: string = getCurrentUserId()): GrowthState {
  const key = growthKeyFor(userId)
  const own = parseGrowth(localStorage.getItem(key))
  if (own) return own
  return { events: [], checkin: { last: '', streak: 0 }, badges: {} }
}

/** 统一等级曲线：Lv = floor(sqrt(score)/8) + 1（score 可能为负，钳 0） */
function growthLevel(score: number): number {
  return Math.floor(Math.sqrt(Math.max(0, score)) / 8) + 1
}

/** 徽章定义：cond 基于双线数值与签到 streak 派生；metric/target 供锁定态推导进度提示 */
const BADGES: {
  code: string
  icon: string
  label: string
  desc: string
  /** 进度度量：score = 统一成长值达标；streak = 连续签到天数达标 */
  metric: 'score' | 'streak'
  target: number
  cond: (s: { score: number; streak: number }) => boolean
}[] = [
  { code: 'seed', icon: '🌱', label: '初来乍到', desc: '成长值 ≥ 10', metric: 'score', target: 10, cond: (s) => s.score >= 10 },
  { code: 'regular', icon: '🔥', label: '活跃常客', desc: '成长值 ≥ 100', metric: 'score', target: 100, cond: (s) => s.score >= 100 },
  { code: 'star', icon: '📣', label: '人气红人', desc: '成长值 ≥ 500', metric: 'score', target: 500, cond: (s) => s.score >= 500 },
  { code: 'creator', icon: '✍️', label: '首发创作', desc: '成长值 ≥ 20', metric: 'score', target: 20, cond: (s) => s.score >= 20 },
  { code: 'scholar', icon: '📚', label: '博学多才', desc: '成长值 ≥ 200', metric: 'score', target: 200, cond: (s) => s.score >= 200 },
  { code: 'elite', icon: '💎', label: '成长精英', desc: '成长值 ≥ 300', metric: 'score', target: 300, cond: (s) => s.score >= 300 },
  { code: 'expert', icon: '🎓', label: '领域专家', desc: '成长值 ≥ 1000', metric: 'score', target: 1000, cond: (s) => s.score >= 1000 },
  { code: 'week', icon: '📅', label: '七日之约', desc: '连续签到 7 天', metric: 'streak', target: 7, cond: (s) => s.streak >= 7 },
]

/** 徽章详情弹窗：获取途径提示（按 metric 路由到对应成长线说明，口径与配置表红线一致） */
const BADGE_HOWTO: Record<'score' | 'streak', string> = {
  score: '通过任意内容行为获取成长值：发动态/博文、获赞、被收藏、被采纳、资源被下载（永久累积）',
  streak: '每日签到保持连续，断签后重新计数',
}

/** 锁定徽章进度：由 metric/target 推导当前值与达成百分比；dual 取双线短板 */
function badgeProgress(
  b: (typeof BADGES)[number],
  s: { score: number; streak: number },
): { cur: number; pct: number; text: string } {
  const pos = (n: number) => Math.max(0, n) // 负分钳 0（惩罚事件会让 score 为负）
  const cur = b.metric === 'score' ? pos(s.score) : pos(s.streak)
  const unit = b.metric === 'streak' ? ' 天' : ''
  const name = b.metric === 'score' ? '成长值' : '连续'
  return { cur, pct: Math.min(100, Math.round((cur / b.target) * 100)), text: `${name} ${cur}/${b.target}${unit}` }
}

/** 合并徽章解锁时间：next 状态下新解锁的 code 记录首次达成时刻（以 next.badges 为基底，清空后可重新计时） */
function withBadgeTimes(next: GrowthState): GrowthState {
  let score = 0
  for (const e of next.events) {
    const rule = GROWTH_RULES.find((r) => r.action === e.action)
    if (!rule) continue
    score += rule.value
  }
  const ctx = { score, streak: next.checkin.streak }
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
  | { ok: true; label: string; value: number; reward: 'GROWTH' }
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
    localStorage.setItem(growthKeyFor(getCurrentUserId()), JSON.stringify(merged))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(GROWTH_UPDATE_EVT))
  emitToast(`🚀 已记分「${rule.label}」 ${rule.value > 0 ? '+' : ''}${rule.value} 成长值`)
  return { ok: true, label: rule.label, value: rule.value, reward: rule.reward }
}

/** 等级进度：返回 [当前级, 下一级, 进度 0-100]（单态统一曲线） */
function levelProgress(num: number): [number, number, number] {
  const cur = growthLevel(num)
  const prev = 64 * (cur - 1) * (cur - 1)
  const next = 64 * cur * cur
  const safe = Math.max(0, num)
  const pct = next === prev ? 100 : ((safe - prev) / (next - prev)) * 100
  return [cur, cur + 1, Math.min(100, Math.max(0, pct))]
}

export function GrowthPage() {
  const toast = useToast()
  /* 轮 17 打通：登录身份切换时重载对应身份的成长数据（显式传 userId 防竞态） */
  const { auth } = useAuth()
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

  /* 轮 17 打通：切号（登录/登出）即重载对应身份的成长数据 */
  useEffect(() => {
    setState(loadGrowth(auth.userId))
  }, [auth.userId])

  const checkedToday = state.checkin.last === today

  /* 派生：双线累计值 + 今日各行为计数（daily_cap 依据） */
  const { score, todayCount } = useMemo(() => {
    let score = 0
    const todayCount: Record<string, number> = {}
    for (const e of state.events) {
      const rule = GROWTH_RULES.find((r) => r.action === e.action)
      if (!rule) continue
      score += rule.value
      if (localDate(e.at) === today) todayCount[e.action] = (todayCount[e.action] ?? 0) + 1
    }
    return { score, todayCount }
  }, [state, today])

  const persist = (next: GrowthState) => {
    const merged = withBadgeTimes(next) // 落盘前合并新解锁徽章的首次达成时刻
    setState(merged)
    try {
      localStorage.setItem(growthKeyFor(getCurrentUserId()), JSON.stringify(merged))
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
    toast(`已记录「${rule.label}」 ${rule.value > 0 ? '+' : ''}${rule.value} 成长值`)
  }

  /** 签到：断签即重置（昨天没签则从 1 重新计） */
  const checkin = () => {
    if (checkedToday) return
    const streak = state.checkin.last === yesterday ? state.checkin.streak + 1 : 1
    persist({ ...state, checkin: { last: today, streak } })
    toast(streak >= 7 ? `已签到，连续 ${streak} 天，徽章「七日之约」到手！` : `已签到，连续 ${streak} 天`)
  }

  const lvl = levelProgress(score)
  const badgeCtx = { score, streak: state.checkin.streak }
  const flows = [...state.events].reverse().slice(0, 10)

  /* 徽章派生：已解锁集合 + 计数（徽章墙「已解锁 X/8」摘要） */
  const unlockedCodes = useMemo(() => BADGES.filter((b) => b.cond(badgeCtx)).map((b) => b.code), [score, state.checkin.streak])
  const unlockedCount = unlockedCodes.length

  /* 展示补充①：距下一枚徽章提示——锁定徽章中进度（pct）最高者，全部解锁后为 null */
  const nextBadge = useMemo(() => {
    let best: { b: (typeof BADGES)[number]; prog: ReturnType<typeof badgeProgress> } | null = null
    for (const b of BADGES) {
      if (b.cond(badgeCtx)) continue
      const prog = badgeProgress(b, badgeCtx)
      if (!best || prog.pct > best.prog.pct) best = { b, prog }
    }
    return best
  }, [score, state.checkin.streak])

  /* 展示补充②：徽章筛选 Tab——全部 / 已解锁 / 未解锁 */
  const [badgeFilter, setBadgeFilter] = useState<'all' | 'unlocked' | 'locked'>('all')

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

  /* 展示补充②（续）：筛选后的徽章列表与 Tab 文案（计数实时联动） */
  const shownBadges = BADGES.filter((b) =>
    badgeFilter === 'all' ? true : badgeFilter === 'unlocked' ? b.cond(badgeCtx) : !b.cond(badgeCtx),
  )
  const badgeTabs: { key: 'all' | 'unlocked' | 'locked'; label: string }[] = [
    { key: 'all', label: `全部 ${BADGES.length}` },
    { key: 'unlocked', label: `已解锁 ${unlockedCount}` },
    { key: 'locked', label: `未解锁 ${BADGES.length - unlockedCount}` },
  ]

  /* 轮 19 打通：徽章点击详情弹窗——点击任意徽章卡查看达成条件/获取途径/进度/解锁时间 */
  const [detailCode, setDetailCode] = useState<string | null>(null)
  const detailBadge = detailCode ? BADGES.find((b) => b.code === detailCode) ?? null : null
  const detailProg = detailBadge && !detailBadge.cond(badgeCtx) ? badgeProgress(detailBadge, badgeCtx) : null
  /* Esc 快捷关闭（点遮罩 / ✕ 由共享 Modal 组件承担） */
  useEffect(() => {
    if (!detailCode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailCode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailCode])

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🚀 统一成长引擎</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>
          统一成长引擎（单态 · 开发吧.md growth_rule）：所有行为累积单一「成长值」，单一等级曲线，无广场/知识分轨。
        </p>

        {/* 统一等级（单态） */}
        <div className="gr-duo">
          <div className="card gr-line">
            <div className="gr-line-head">
              <b>🚀 成长值</b>
              <span className="gr-reward">{score}</span>
            </div>
            <div className="gr-level-num">Lv.{lvl[0]}</div>
            <div className="gr-bar" role="progressbar" aria-valuenow={Math.round(lvl[2])} aria-valuemin={0} aria-valuemax={100} aria-label="成长等级进度">
              <div className="gr-bar-fill" style={{ width: `${lvl[2]}%` }} />
            </div>
            <small className="gr-hint">成长至 Lv.{lvl[1]} · 曲线 floor(sqrt(score)/8)+1 · 永久累积</small>
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
            {/* 展示补充②：筛选 Tab（全部 / 已解锁 / 未解锁），计数实时联动 */}
            <div className="gr-badge-tabs" role="tablist" aria-label="徽章筛选">
              {badgeTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={badgeFilter === t.key}
                  className={cx('gr-badge-tab', badgeFilter === t.key && 'active')}
                  onClick={() => setBadgeFilter(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* 展示补充①：距下一枚徽章提示（锁定徽章中进度最高者），全部解锁后隐藏 */}
            {nextBadge && (
              <p className="gr-badge-next">
                🎯 距下一枚「{nextBadge.b.label}」：{nextBadge.prog.text} · 进度 {nextBadge.prog.pct}%
              </p>
            )}
            {shownBadges.length === 0 ? (
              <Empty emoji="🏅" text={badgeFilter === 'unlocked' ? '还没有解锁任何徽章，去下面的行为按钮攒进度吧' : '所有徽章均已解锁！'} />
            ) : (
              <div className="gr-badges">
                {shownBadges.map((b) => {
                  const unlocked = b.cond(badgeCtx)
                  const prog = unlocked ? null : badgeProgress(b, badgeCtx)
                  const fresh = unlocked && freshCodes.includes(b.code)
                  return (
                    <div
                      key={b.code}
                      className={cx('gr-badge', !unlocked && 'locked', fresh && 'fresh')}
                      title={b.desc}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetailCode(b.code)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDetailCode(b.code)
                        }
                      }}
                    >
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
            )}
          </div>
        </div>

        {/* 行为模拟触发（demo） */}
        <div className="card">
          <b>⚡ 模拟行为触发</b>
          <p className="muted gr-act-tip">demo 直接记事件；真实链路由各端行为上报统一引擎结算，逐日受 daily_cap 约束。</p>
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
                    {r.value} 成长值
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
                    {rule && <span className="tag">成长值</span>}
                    <em className={cx('gr-flow-val', (rule?.value ?? 0) < 0 && 'neg')}>
                      {(rule?.value ?? 0) > 0 ? '+' : ''}
                      {rule?.value ?? 0} 成长值
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
            ⚠️ 红线：单态下所有行为累积单一成长值，无分轨兑换概念；demo 不模拟时间衰减，仅做规则展示。
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

        {/* 轮 19 打通：徽章详情弹窗（点击徽章卡触发，Esc / 点遮罩 / ✕ 关闭） */}
        {detailBadge && (
          <Modal title={`${detailBadge.icon} ${detailBadge.label}`} onClose={() => setDetailCode(null)}>
            <div className="gr-bdetail">
              <p className="gr-bdetail-cond">{detailBadge.desc}</p>
              <p className="gr-bdetail-howto">💡 {BADGE_HOWTO[detailBadge.metric]}</p>
              {detailProg ? (
                <>
                  <p className="gr-bdetail-status">🔒 未解锁 · {detailProg.text}</p>
                  <div className="gr-badge-bar" role="progressbar" aria-valuenow={detailProg.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${detailBadge.label}达成进度`}>
                    <i style={{ width: `${detailProg.pct}%` }} />
                  </div>
                </>
              ) : (
                <p className="gr-bdetail-status ok">
                  ✅ 已解锁{state.badges[detailBadge.code] ? ` · ${localDate(state.badges[detailBadge.code])}` : ''}
                </p>
              )}
            </div>
          </Modal>
        )}
      </div>
    </div>
  )
}
