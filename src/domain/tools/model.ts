/* ==========================================================================
 * 工具台域模型 —— 各工具台的共享类型与规则
 *
 * 工具台的共同形态：自包含状态 + 本机即时落地 + 云端整包快照同步。
 * 这里只定义模型与纯规则，IO 由 data 层负责，页面只做渲染。
 * ======================================================================== */

/* ---------- BOM 工具台 ---------- */

export interface BomRow {
  code: string
  name: string
  spec: string
  qty: number
  /** 单价（分） */
  priceFen: number
}

export interface BomVersion {
  key: string
  name: string
  desc: string
  surface: [number, number]
  acy: BomRow[]
}

export interface BomState {
  ver: string
  /** 行 code → 实际数量 */
  qtys: Record<string, number>
}

/** 汇总由明细动态计算（原实现手写汇总与明细差 174.4 元，此处从根上避免） */
export function bomTotal(ver: BomVersion, qtys: Record<string, number>): number {
  return ver.acy.reduce((sum, r) => sum + r.priceFen * (qtys[r.code] ?? r.qty), 0)
}

/* ---------- 智能体连通性 ---------- */

export type HealthStatus = 'idle' | 'loading' | 'online' | 'offline'

export interface HealthRecord {
  at: number
  ok: boolean
  latency: number
}

export interface CozeState {
  baseUrl: string
  history: HealthRecord[]
}

export const HEALTH_TIMEOUT_MS = 5000
export const HEALTH_HISTORY_MAX = 30

/* ---------- AI 资源库 ---------- */

export type AiLevel = 'g' | 'a' | 'r'

export const AI_LEVEL_META: Record<AiLevel, { label: string; cls: string }> = {
  g: { label: '可自由转载', cls: 'ok' },
  a: { label: '需署名', cls: 'warn' },
  r: { label: '限制较多', cls: 'danger' },
}

export interface AiResource {
  id: string
  cat: string
  name: string
  type: string
  level: AiLevel
  lic: string
  desc: string
  who: string
  link: { label: string; url: string }
}

export interface AiState {
  favs: string[]
  checks: string[]
  updatedAt: number
}

/* ---------- 漫剧 ---------- */

export type MjCat = 'comic' | 'ai'

export interface MjItem {
  id: string
  title: string
  cat: MjCat
  cover: string
  source: string
  episodesText: string
  custom?: boolean
  license?: string
  videoUrl?: string
  audioUrl?: string
  thumb?: string
  homeUrl?: string
}

export interface MjState {
  favorites: string[]
  seen: string[]
  progress: Record<string, number>
  customExt: MjItem[]
}

/* ---------- 聚合监控 ---------- */

export type SourceStatus = 'ok' | 'error'

export interface ArdotItem {
  title: string
  value: string
}

export interface SourceRuntime {
  status: SourceStatus
  items: ArdotItem[]
  message: string
  fetchedAt: number
  /** 命中本地缓存而非回源 */
  stale: boolean
  ms: number
}

export interface LogEntry {
  id: string
  at: number
  action: string
  source: string
  result: '成功' | '失败' | '拒绝'
  detail: string
  ms: number
}

export const ARDOT_TIMEOUT_MS = 8000
export const ARDOT_LOG_MAX = 40

/* ---------- 邮箱聚合 ---------- */

export interface MailPreset {
  id: string
  label: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  note: string
}

export const MAIL_PRESETS: MailPreset[] = [
  { id: 'qq', label: 'QQ 邮箱', imapHost: 'imap.qq.com', imapPort: 993, smtpHost: 'smtp.qq.com', smtpPort: 465, note: '需在邮箱设置中开启 IMAP/SMTP 并使用授权码' },
  { id: '163', label: '网易 163', imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465, note: '需使用客户端授权码' },
  { id: 'gmail', label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, note: '需开启两步验证并使用应用专用密码' },
]

export interface MailCfg {
  proxyUrl: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  user: string
  pass: string
}

export interface MailMsg {
  uid: string
  flags: string
  date: string
  from: string
  to: string
  subject: string
  preview: string
}

/* ---------- 路线导航（零图片依赖：CSS 网格 + SVG polyline） ---------- */

export interface Place {
  id: string
  name: string
  emoji: string
  /** 百分比坐标 */
  x: number
  y: number
}

export interface RouteStep {
  text: string
  distKm: number
}

export interface PlannedRoute {
  id: string
  fromId: string
  toId: string
  viaIds: string[]
  steps: RouteStep[]
  distKm: number
  mins: number
  done: boolean
  createdAt: number
}

export interface NavState {
  routes: PlannedRoute[]
  current: { routeId: string; stepIndex: number } | null
}

export const NAV_ROUTE_MAX = 8

/** 距离估算：网格坐标差 × 0.42（与原点位体系同尺度） */
export function estimateDistance(a: Place, b: Place): number {
  return Math.hypot(b.x - a.x, b.y - a.y) * 0.42
}

export function estimateMinutes(distKm: number): number {
  return Math.max(6, Math.round(distKm * 2.4))
}

export function directionText(dx: number, dy: number): string {
  const ns = dy > 0 ? '南' : '北'
  const ew = dx > 0 ? '东' : '西'
  return `${ns}${ew}`
}

/* ---------- 配送调度 ---------- */

export type DeliveryStatus = 'pending' | 'picking' | 'delivering' | 'delivered'

export const DELIVERY_STATUS_TEXT: Record<DeliveryStatus, string> = {
  pending: '待分配',
  picking: '取货中',
  delivering: '配送中',
  delivered: '已送达',
}

export interface Rider {
  id: string
  name: string
  emoji: string
  vehicle: string
  /** 单骑手同时只挂一单 */
  orderId: string | null
}

export interface DeliveryOrder {
  id: string
  code: string
  customer: string
  address: string
  items: string
  amountFen: number
  status: DeliveryStatus
  riderId: string | null
  createdAt: number
}

export interface BoardData {
  riders: Rider[]
  orders: DeliveryOrder[]
}

/** 单号：max(2000, 现有最大号) + 1 */
export function nextCode(orders: DeliveryOrder[]): string {
  const max = orders.reduce((m, o) => {
    const n = Number(o.code.replace(/\D/g, ''))
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 2000)
  return `D-${max + 1}`
}

export function deliveredTotal(orders: DeliveryOrder[]): number {
  return orders.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.amountFen, 0)
}

/* ---------- 价格监控 ---------- */

export interface PricePoint {
  at: number
  /** 单位：分 */
  priceFen: number
}

export interface WatchProduct {
  id: string
  name: string
  emoji: string
  platform: string
  /** 预警线（分）；0 表示按现价 9 折自动推导 */
  thresholdFen: number
  prices: PricePoint[]
}

export interface PriceAlert {
  id: string
  productId: string
  fromFen: number
  toFen: number
  at: number
}

export const PRICE_POINTS_MAX = 30
export const PRICE_SPARK_POINTS = 10

/** 预警触发：低于预警线 或 跌幅 ≥5% */
export function alertTriggered(last: PricePoint | null, prev: PricePoint | null, thresholdFen: number): boolean {
  if (!last) return false
  if (thresholdFen > 0 && last.priceFen <= thresholdFen) return true
  if (prev && prev.priceFen > 0) {
    const pct = (prev.priceFen - last.priceFen) / prev.priceFen
    if (pct >= 0.05) return true
  }
  return false
}
