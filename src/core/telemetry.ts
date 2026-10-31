/* ==========================================================================
 * 埋点客户端 —— docs/specs/埋点与数据口径规范.md 的第一段实现
 *
 * 设计取舍（为什么不用第三方 SDK）：
 *   1. 本项目依赖极简（无 antd / 无 Sentry），为一个埋点引入第三方与工程路线冲突；
 *   2. 埋点是「贯穿所有页面」的基础设施，一旦绑死 SDK，将来换厂商要改全站调用；
 *      收敛到一个模块后，换厂商只需要改 flush() 里的上报地址与字段映射。
 *
 * 三条硬约束：
 *   1. 埋点永不阻塞业务、永不抛错 —— 任何失败都在本模块内部吞掉。
 *      绝不允许「埋点挂了导致页面白屏」。
 *   2. 字段两级过滤后才入队：先剔明文敏感字段，再校验事件名白名单。
 *      违反这两点的事件直接丢弃并记录到 selfCheck 的 dropped 计数（可观测）。
 *   3. 后端未配置（纯本地模式）时只做本地计数，不发网络请求 ——
 *      否则 GitHub Pages 静态部署下会持续报 404/405 噪音。
 * ======================================================================== */

import { isBackendConfigured } from './config'
import { post } from './http'
import { getPlatform } from '../platform'
import { APP_VERSION } from './version'

/** 事件名白名单：不在白名单的事件不入队（防止随手打点污染数据口径） */
export const TRACK_EVENTS = [
  /* 应用级 */
  'app_launch',
  'page_view',
  'perf_first_paint',
  /* 账号 */
  'auth_register',
  'auth_login',
  /* 内容 */
  'content_post_publish',
  'content_post_view',
  'content_comment_add',
  /* 商城与资金 */
  'mall_order_create',
  'mall_order_pay',
  'mall_seckill_grab',
  'wallet_debit',
  'wallet_credit',
  /* 成长 */
  'growth_checkin',
  'growth_level_up',
  /* 设备与 OTA */
  'device_bind',
  'device_command_send',
  'device_command_ack',
  'ota_report',
] as const

export type TrackEvent = (typeof TRACK_EVENTS)[number]

export type TrackValue = string | number | boolean | null

export type TrackPayload = Record<string, TrackValue>

/** 敏感字段：出现在 key 里的这些词一律剔除，避免出现「密码进了埋点库」这类事故 */
const SENSITIVE = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'phone',
  'mobile',
  'idcard',
  'id_card',
  'credential',
]

const ENDPOINT = '/events'
const MAX_QUEUE = 200
const BATCH_SIZE = 20
const FLUSH_MS = 10_000

interface TrackRecord {
  /** 事件唯一 ID：服务端据此做重传幂等（同一批重复提交不重复计数） */
  eid: string
  event: string
  props: TrackPayload
  ts: number
}

const queue: TrackRecord[] = []
let sessionId = ''
let anonId = ''
let uidProvider: () => string | null = () => null

/* 自检计数：QA 的「埋点自检」清单直接读这里 */
const stats = {
  enqueued: 0,
  flushed: 0,
  dropped: 0,
  failures: 0,
  lastError: '',
  lastFlushAt: 0,
}

/** 注册用户标识来源：core 不能反向依赖 data/session，由应用层注入 */
export function setTrackIdentity(fn: () => string | null): void {
  uidProvider = fn
}

function now(): number {
  return Date.now()
}

function safeSessionId(): string {
  if (sessionId) return sessionId
  try {
    sessionId = Math.random().toString(36).slice(2, 10) + now().toString(36)
  } catch {
    sessionId = 'sess-unknown'
  }
  return sessionId
}

/**
 * 稳定匿名标识：未登录也要能把同一次安装的行为串起来（否则漏斗在登录步骤断层）。
 * 只落在本地存储，不跨设备同步，不可反推个人身份。
 */
function newRandomId(bytes = 16): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '')
    }
  } catch {
    /* 某些非安全上下文没有 crypto.randomUUID：退到随机串 */
  }
  return Array.from({ length: bytes }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function safeAnonId(): string {
  if (anonId) return anonId
  const KEY = 'mim.global.anon_id'
  try {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (cached && cached.length >= 8) {
      anonId = cached
      return anonId
    }
    anonId = newRandomId()
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, anonId)
  } catch {
    // 隐私模式 / 小程序环境写不了或读不了：退化为「本次会话有效」的空值，不影响业务
    anonId = anonId || 'anon-unknown'
  }
  return anonId
}

/** uid 只做短哈希：埋点里不落真实 uid 明文 */
function hashId(raw: string): string {
  let h = 5381
  for (let i = 0; i < raw.length; i += 1) h = ((h << 5) + h + raw.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function platformKindSafe(): string {
  try {
    return getPlatform().kind
  } catch {
    return 'unknown'
  }
}

/** 公共属性：规范 §2 的 7 项公共字段 */
function commonProps(): TrackPayload {
  const uid = (() => {
    try {
      return uidProvider()
    } catch {
      return null
    }
  })()
  const on = typeof window !== 'undefined' ? window : null
  return {
    app_version: APP_VERSION,
    platform: platformKindSafe(),
    uid_hash: uid ? hashId(uid) : null,
    anon_id: safeAnonId(),
    session_id: safeSessionId(),
    ts: now(),
    // 页面路径取自 hash 路由（本项目用 hash 路由，location.pathname 恒为 '/'）
    path: on ? String(on.location.hash || '#/') : '',
    referrer: on && on.document ? String(on.document.referrer || '') : '',
  }
}

/** 属性过滤：敏感词命中即剔除，同时压掉 undefined（JSON 序列化会变成 null 噪音） */
function sanitize(payload: TrackPayload | undefined): TrackPayload {
  const out: TrackPayload = {}
  if (!payload) return out
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue
    const key = k.toLowerCase()
    if (SENSITIVE.some((s) => key.includes(s))) continue
    if (typeof v === 'string' && v.length > 200) continue // 超长字符串不入队
    out[k] = v
  }
  return out
}

/** 上报：单个失败不影响队列里剩余事件；失败留队等下一次 flush（上限 MAX_QUEUE 丢弃最旧） */
async function flush(): Promise<void> {
  if (!queue.length) return
  if (!isBackendConfigured()) {
    // 纯本地模式：保留最新 MAX_QUEUE 条供自检查看，不发请求
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
    return
  }
  const batch = queue.splice(0, BATCH_SIZE)
  try {
    const r = await post<unknown>(ENDPOINT, { events: batch })
    stats.lastFlushAt = now()
    if (r.ok) {
      stats.flushed += batch.length
      return
    }
    stats.failures += 1
    stats.lastError = r.error.message
    // 失败回流：留着下轮重试，但不无限堆积
    queue.unshift(...batch)
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  } catch (e) {
    stats.failures += 1
    stats.lastError = e instanceof Error ? e.message : String(e)
    queue.unshift(...batch)
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  }
}

/** 唯一写入口：业务层只用这一个函数 */
export function track(event: TrackEvent, payload?: TrackPayload): void {
  try {
    if (!TRACK_EVENTS.includes(event)) {
      stats.dropped += 1
      stats.lastError = `事件名不在白名单：${String(event)}`
      return
    }
    queue.push({ eid: newRandomId(), event, props: { ...commonProps(), ...sanitize(payload) }, ts: now() })
    stats.enqueued += 1
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
    if (queue.length >= BATCH_SIZE) void flush()
  } catch {
    /* 埋点永不抛错：这里吞掉所有异常，保证不影响调用方业务 */
    stats.failures += 1
  }
}

/** 页面停留 / 首帧：规范 §5 的 FCP 口径由调用方在首屏渲染后调用一次 */
export function trackFirstPaint(ms: number): void {
  track('perf_first_paint', { ms: Math.round(ms) })
}

export function trackPageView(path: string): void {
  track('page_view', { path })
}

/** QA 自检：返回计数与最近错误，供「埋点自检清单」逐项打勾 */
export function telemetrySelfCheck(): {
  backendConfigured: boolean
  queued: number
  enqueued: number
  flushed: number
  dropped: number
  failures: number
  lastError: string
  lastFlushAt: number
} {
  return {
    backendConfigured: isBackendConfigured(),
    queued: queue.length,
    enqueued: stats.enqueued,
    flushed: stats.flushed,
    dropped: stats.dropped,
    failures: stats.failures,
    lastError: stats.lastError,
    lastFlushAt: stats.lastFlushAt,
  }
}

/** 测试与调试用：读取当前队列快照（只读拷贝） */
export function telemetryQueueSnapshot(): TrackRecord[] {
  return queue.map((x) => ({ ...x, props: { ...x.props } }))
}

/** 启动定时器 + 离开页面前补一次 flush（flush 自身也吞错） */
let started = false
export function startTelemetry(): void {
  if (started || typeof window === 'undefined') return
  started = true

  const tick = setInterval(() => {
    void flush()
  }, FLUSH_MS)

  // 页面隐藏 / 关闭前把剩余事件尽力发出去
  const onHide = (): void => {
    void flush()
  }
  try {
    window.addEventListener('pagehide', onHide)
    window.addEventListener('visibilitychange', () => {
      if (window.document && window.document.visibilityState === 'hidden') onHide()
    })
    window.addEventListener('beforeunload', () => {
      clearInterval(tick)
    })
  } catch {
    /* 小程序 / 非浏览器环境没有 window：静默跳过 */
  }
}

/** 供测试使用：清空队列与计数 */
export function resetTelemetryForTest(): void {
  queue.length = 0
  stats.enqueued = 0
  stats.flushed = 0
  stats.dropped = 0
  stats.failures = 0
  stats.lastError = ''
  stats.lastFlushAt = 0
}
