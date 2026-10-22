export function uid(prefix = ''): string {
  return (
    prefix +
    Math.random().toString(36).slice(2, 9) +
    Date.now().toString(36).slice(-4)
  )
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** 相对时间：刚刚 / x分钟前 / x小时前 / 昨天 / MM-DD / YYYY-MM-DD */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return Math.floor(diff / MIN) + '分钟前'
  if (diff < DAY) return Math.floor(diff / HOUR) + '小时前'
  if (diff < 2 * DAY) return '昨天'
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  if (d.getFullYear() === new Date().getFullYear()) return mm + '-' + dd
  return d.getFullYear() + '-' + mm + '-' + dd
}

/** 精确时间：YYYY-MM-DD HH:mm */
export function formatDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  )
}

/** 数字格式化：12345 -> 1.2万 */
export function formatCount(n: number): string {
  if (n >= 10000) {
    const v = (n / 10000).toFixed(1).replace(/\.0$/, '')
    return v + '万'
  }
  return String(n)
}

/* ---------- 浏览历史（足迹） ---------- */

export type ViewKind = 'post' | 'article'

export interface HistoryEntry {
  kind: ViewKind
  id: string
  at: number
}

const HISTORY_KEY = 'mim-history'
const HISTORY_MAX = 50

export function loadHistory(): HistoryEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr.filter((e) => e && (e.kind === 'post' || e.kind === 'article') && typeof e.id === 'string')
  } catch {
    return []
  }
}

/** 记录一次浏览：同一条目去重置顶，上限 HISTORY_MAX 条；
    本地立即写 + 云端异步同步（动态 import 解耦循环依赖） */
export function recordView(kind: ViewKind, id: string) {
  const next = [{ kind, id, at: Date.now() }, ...loadHistory().filter((e) => !(e.kind === kind && e.id === id))].slice(
    0,
    HISTORY_MAX,
  )
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  // 云端异步同步（不阻塞 UI，失败不影响本地）
  import('./lib/cloud-history')
    .then((m) => m.cloudSaveHistory(next))
    .catch(() => {
      /* 云端不可用时静默降级 */
    })
}

/** 清空历史：本地立即删 + 云端异步同步 */
export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    /* ignore */
  }
  import('./lib/cloud-history')
    .then((m) => m.cloudClearHistory())
    .catch(() => {})
}
