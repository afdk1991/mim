/* ==========================================================================
 * 成长引擎 —— 行为记分 / 等级 / 签到 / 徽章
 *
 * 计分口径（与原实现一致）：
 *   score = Σ 匹配行为的 value，daily_cap 只在「上报时拦截」，不参与反算。
 *   负值惩罚不受上限约束（否则恶意刷正向行为可以抵消处罚）。
 * ======================================================================== */

export type GrowthAction =
  | 'publish_dynamic'
  | 'dynamic_liked'
  | 'live_open'
  | 'follow_gained'
  | 'publish_article'
  | 'article_collected'
  | 'answer_adopted'
  | 'resource_downloaded'
  | 'column_finished'
  | 'course_review_good'
  | 'anti_spam_penalty'

export interface GrowthRule {
  action: GrowthAction
  value: number
  /** 每日上限；null 表示不限 */
  dailyCap: number | null
  decayDays: number
  /** 需通过质量门才计分 */
  qualityGate: boolean
  label: string
  icon: string
}

export const GROWTH_RULES: GrowthRule[] = [
  { action: 'publish_dynamic', value: 2, dailyCap: 10, decayDays: 30, qualityGate: false, label: '发布动态', icon: '✍️' },
  { action: 'dynamic_liked', value: 1, dailyCap: 200, decayDays: 30, qualityGate: false, label: '动态被赞', icon: '👍' },
  { action: 'live_open', value: 50, dailyCap: 1, decayDays: 7, qualityGate: false, label: '开播一场', icon: '📡' },
  { action: 'follow_gained', value: 1, dailyCap: 50, decayDays: 30, qualityGate: false, label: '新增粉丝', icon: '👥' },
  { action: 'publish_article', value: 10, dailyCap: 5, decayDays: 0, qualityGate: true, label: '发布文章', icon: '📝' },
  { action: 'article_collected', value: 3, dailyCap: null, decayDays: 0, qualityGate: false, label: '文章被收藏', icon: '⭐' },
  { action: 'answer_adopted', value: 20, dailyCap: null, decayDays: 0, qualityGate: false, label: '回答被采纳', icon: '✅' },
  { action: 'resource_downloaded', value: 5, dailyCap: null, decayDays: 0, qualityGate: false, label: '资源被下载', icon: '📦' },
  { action: 'column_finished', value: 30, dailyCap: null, decayDays: 0, qualityGate: false, label: '专栏完结', icon: '📚' },
  { action: 'course_review_good', value: 5, dailyCap: null, decayDays: 0, qualityGate: false, label: '课程好评', icon: '🎓' },
  { action: 'anti_spam_penalty', value: -50, dailyCap: null, decayDays: 0, qualityGate: false, label: '违规扣分', icon: '⚠️' },
]

export interface GrowthEvent {
  id: string
  action: GrowthAction
  at: number
}

export interface GrowthState {
  events: GrowthEvent[]
  checkin: { last: string; streak: number }
  /** 徽章 code → 达成毫秒 */
  badges: Record<string, number>
}

export function ruleOf(action: GrowthAction): GrowthRule | null {
  return GROWTH_RULES.find((r) => r.action === action) ?? null
}

/** 成长总分 */
export function growthScore(events: GrowthEvent[]): number {
  let sum = 0
  for (const e of events) {
    const r = ruleOf(e.action)
    if (r) sum += r.value
  }
  return sum
}

/** 等级：Lv = floor(sqrt(score)/8) + 1 */
export function growthLevel(score: number): number {
  return Math.floor(Math.sqrt(Math.max(0, score)) / 8) + 1
}

/** 升到 Lv.N 所需分数 */
export function scoreForLevel(lv: number): number {
  return 64 * (lv - 1) * (lv - 1)
}

export function levelProgress(score: number): { lv: number; pct: number; next: number } {
  const lv = growthLevel(score)
  const prev = scoreForLevel(lv)
  const next = scoreForLevel(lv + 1)
  const pct = next === prev ? 100 : Math.min(100, Math.max(0, ((score - prev) / (next - prev)) * 100))
  return { lv, pct, next }
}

/** 每日上限校验：仅正值且配了 cap 的行为受限 */
export function dailyCount(events: GrowthEvent[], action: GrowthAction, dayKeyStr: string): number {
  return events.filter((e) => e.action === action && dayKeyOf(e.at) === dayKeyStr).length
}

export function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export interface RecordInput {
  action: GrowthAction
  /** 是否通过质量门 */
  quality?: boolean
}

export type RecordOutcome = { ok: true; delta: number } | { ok: false; reason: 'quality' | 'cap' | 'unknown' }

/** 记分判定：质量门 → 日上限 → 计分 */
export function evaluate(state: GrowthState, input: RecordInput, now = Date.now()): RecordOutcome {
  const rule = ruleOf(input.action)
  if (!rule) return { ok: false, reason: 'unknown' }
  if (rule.qualityGate && !input.quality) return { ok: false, reason: 'quality' }
  if (rule.dailyCap !== null && rule.value > 0) {
    const used = dailyCount(state.events, input.action, dayKeyOf(now))
    if (used >= rule.dailyCap) return { ok: false, reason: 'cap' }
  }
  return { ok: true, delta: rule.value }
}

/* ---------- 徽章 ---------- */

export interface Badge {
  code: string
  name: string
  emoji: string
  desc: string
}

export const BADGES: Badge[] = [
  { code: 'seed', name: '萌芽', emoji: '🌱', desc: '成长值达到 10' },
  { code: 'regular', name: '常客', emoji: '🙂', desc: '成长值达到 100' },
  { code: 'star', name: '新星', emoji: '🌟', desc: '成长值达到 500' },
  { code: 'creator', name: '创作者', emoji: '✍️', desc: '成长值达到 20' },
  { code: 'scholar', name: '学者', emoji: '📚', desc: '成长值达到 200' },
  { code: 'elite', name: '精英', emoji: '🏅', desc: '成长值达到 300' },
  { code: 'expert', name: '专家', emoji: '🎖️', desc: '成长值达到 1000' },
  { code: 'week', name: '连续七日', emoji: '🔥', desc: '连续签到 7 天' },
]

/** 结算应得徽章（首次达成才入账） */
export function earnedBadges(score: number, streak: number): string[] {
  const byScore: Array<[string, number]> = [
    ['seed', 10],
    ['creator', 20],
    ['regular', 100],
    ['scholar', 200],
    ['elite', 300],
    ['star', 500],
    ['expert', 1000],
  ]
  const out = byScore.filter(([, min]) => score >= min).map(([code]) => code)
  if (streak >= 7) out.push('week')
  return out
}

/* ---------- VIP ---------- */

export type VipPlanId = 'monthly' | 'quarterly' | 'yearly'

export interface VipPlan {
  id: VipPlanId
  label: string
  priceFen: number
  days: number
  perMonthFen: number
  tag?: string
  highlight?: boolean
}

const DAY_MS = 86_400_000

export const VIP_PLANS: VipPlan[] = [
  { id: 'monthly', label: '月卡', priceFen: 2500, days: 30, perMonthFen: 2500 },
  { id: 'quarterly', label: '季卡', priceFen: 6800, days: 90, perMonthFen: 2267, tag: '立省 9%' },
  { id: 'yearly', label: '年卡', priceFen: 19800, days: 365, perMonthFen: 1650, tag: '立省 34%', highlight: true },
]

export interface VipState {
  plan: VipPlanId | null
  expireAt: number
}

export function vipActive(v: VipState, now = Date.now()): boolean {
  return v.plan !== null && v.expireAt > now
}

export function vipLeftDays(v: VipState, now = Date.now()): number {
  if (!vipActive(v, now)) return 0
  return Math.max(1, Math.ceil((v.expireAt - now) / DAY_MS))
}

/** 续费叠加：未过期在原到期日上叠加，已过期从当前时间重新起算 */
export function vipRenew(v: VipState, plan: VipPlan, now = Date.now()): VipState {
  const base = vipActive(v, now) ? v.expireAt : now
  return { plan: plan.id, expireAt: base + plan.days * DAY_MS }
}
