/* ============================================================================
 * 通用限流 —— 入口 IP 级固定窗口（单进程内存实现）
 *
 * 为什么独立成模块而不是摊在 main.js：
 *   1. main.js 由并行会话维护（健康检查 / 日志 / IoT 网关），把中间件逻辑塞进去
 *      必然互相冲突；这里只暴露一个 `assertAllowed(ip, bucket)`，main.js 一行接入。
 *   2. 阈值集中在本文件常量（可用环境变量覆盖），便于运维按部署形态调整。
 *
 * 为什么用固定窗口而不是令牌桶/漏桶：
 *   本项目是单实例自托管、无 Redis；固定窗口实现最简单、无外部依赖，
 *   对「登录爆破 / 写死循环 / 恶意刷分」这类场景足够。窗口边界的轻微突发
 *   （窗口切换瞬间最多放 2 倍）对自托管场景可接受。
 *
 * 分桶口径（key = IP + 路由类）：
 *   · auth  —— register/login，爆破重点，阈值最低但要压得住压测的批量注册；
 *   · rpc:<fn> —— 按 RPC 函数分桶，避免一个被刷的读接口连坐其它正常接口；
 *   · rest —— REST 写操作（POST/PATCH/DELETE）。
 *   高频业务写（秒杀/发码/出行履约）已由服务端行锁+条件更新防超卖，
 *   这里给更高的桶阈值，不做二次误伤。
 *
 * 注意：进程内存限流在多实例部署时不准；将来上多副本需换 Redis/网关层。
 * ========================================================================== */

import { rateLimited } from './errors.js'

/** 窗口长度（毫秒）。固定窗口：从该桶第一次请求起计时，窗口结束后计数清零。 */
export const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 10_000)

/** auth 桶阈值（register/login）。压测 V1 会并发注册 40 个账号，阈值必须 > 40。 */
const AUTH_LIMIT = Number(process.env.RATE_AUTH_PER_WINDOW ?? 100)

/** RPC 默认桶阈值。EDGE-2 连续打 wallet_state，需在窗口内被 429。 */
const RPC_LIMIT = Number(process.env.RATE_RPC_PER_WINDOW ?? 30)

/** 高频业务写 RPC：已有服务端并发保护，给更高阈值避免压测/正常抢购被误杀。 */
const RPC_BUSINESS_LIMIT = Number(process.env.RATE_BUSINESS_PER_WINDOW ?? 120)

/** REST 写操作阈值（每 IP）。 */
const REST_LIMIT = Number(process.env.RATE_REST_PER_WINDOW ?? 60)

/** 高频业务写 RPC 白名单（按函数名）。这些函数内部已有行锁/条件更新防超卖。 */
const BUSINESS_RPCS = new Set([
  'seckill_grab',
  'seckill_release',
  'issue_voucher_code',
  'travel_book',
  'travel_release',
  'travel_refund',
  'travel_issue',
  'device_bind',
  'device_unbind',
  'device_state',
  'ota_check',
  'ota_report',
  'ota_publish',
  'ota_stats',
  'admin_devices',
  'admin_device_commands',
])

/** 桶状态：{ ts: 窗口起始毫秒, left: 剩余配额 } */
const buckets = new Map()

/* 定期清掉过期桶，避免 Map 随时间无限增长（与 events.js 同思路）。 */
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of buckets) if (now - v.ts > RATE_WINDOW_MS) buckets.delete(k)
}, RATE_WINDOW_MS)
// 该定时器不得阻止进程退出
sweeper.unref?.()

/**
 * 从请求里取客户端 IP。反代后取 X-Forwarded-For 第一段；本机直连用 socket 地址。
 * 仅用于限流分桶，不作为鉴权依据。
 * @param {import('node:http').IncomingMessage} req
 */
export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] ?? '')
  if (xff) return xff.split(',')[0].trim() || 'unknown'
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * 校验某个 IP 在某个桶内是否还有配额；超限直接抛 429 ApiError。
 * @param {string} ip
 * @param {'auth'|'rpc'|'rest'} kind  路由大类
 * @param {string} [name]  rpc 时为函数名
 */
export function assertAllowed(ip, kind, name = '') {
  let limit
  if (kind === 'auth') limit = AUTH_LIMIT
  else if (kind === 'rest') limit = REST_LIMIT
  else limit = name && BUSINESS_RPCS.has(name) ? RPC_BUSINESS_LIMIT : RPC_LIMIT

  const key = `${ip}|${kind}${name ? ':' + name : ''}`
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now - b.ts >= RATE_WINDOW_MS) {
    buckets.set(key, { ts: now, left: limit - 1 })
    return // 新窗口第一个放行
  }
  if (b.left <= 0) {
    const retryMs = RATE_WINDOW_MS - (now - b.ts)
    throw rateLimited(`请求过于频繁（${kind} 窗口上限 ${limit} 次/${Math.round(RATE_WINDOW_MS / 1000)}s），${Math.ceil(retryMs / 1000)}s 后重试`)
  }
  b.left -= 1
}
