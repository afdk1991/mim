/* ==========================================================================
 * 通用纯函数 —— 无副作用、无依赖，可被任何层引用
 * ======================================================================== */

/** 本地唯一 id：`前缀 + 随机 7 位 base36 + 时间末 4 位 base36` */
export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

/** 条件类名拼接，过滤 false / null / undefined */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 相对时间：刚刚 / N分钟前 / N小时前 / 昨天 / MM-DD / YYYY-MM-DD */
export function timeAgo(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const diff = Date.now() - ts
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`
  const d = new Date(ts)
  if (diff < 2 * DAY) return '昨天'
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 精确时间：YYYY-MM-DD HH:mm */
export function formatDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 日期：YYYY-MM-DD */
export function formatDay(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 计数缩写：≥10000 → 「1.2万」（去掉 .0 尾） */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n < 10_000) return String(Math.floor(n))
  const w = Math.floor(n / 1000) / 10
  return `${w.toFixed(1).replace(/\.0$/, '')}万`
}

/** 媒体时长：mm:ss / h:mm:ss */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${pad2(m)}:${pad2(r)}`
}

/** 金额（分）→ 展示字符串，保留两位 */
export function yuanText(fen: number): string {
  if (!Number.isFinite(fen)) return '0.00'
  return (fen / 100).toFixed(2)
}

/** 金额（分）→ 元（整数，用于订单等非精确场景） */
export function fenToYuan(fen: number): number {
  if (!Number.isFinite(fen)) return 0
  return Math.round(fen / 100)
}

/** 元 → 分 */
export function yuanToFen(yuan: number): number {
  if (!Number.isFinite(yuan)) return 0
  return Math.round(yuan * 100)
}

/** 数值钳制到 [min,max]，非法值回退 fallback */
export function clamp(n: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 数组去重（保持首次出现顺序） */
export function uniq<T>(list: readonly T[]): T[] {
  return Array.from(new Set(list))
}

/** 截断字符串，超长加省略号 */
export function ellipsis(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

/** 延迟（仅用于测试与节流，业务禁止用 sleep 赌渲染） */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
