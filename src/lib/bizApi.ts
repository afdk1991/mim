/* ============================================================================
 * 钱包 / 成长 / 商城 后端化业务通道（P0 资金 / 安全迁移的前端落点）
 *
 * 原则：云端优先，调用失败由调用方降级到 localStorage。
 *
 * 双后端同构：
 *   · cloudbase 模式 → 直连 mim-api 云函数业务端点（/wallet /growth /mall），
 *     uid 由服务端从 x-mim-token 反解注入，前端绝不持有/比对任何敏感口令。
 *   · supabase  模式 → 调同名 PG RPC（auth.uid() 内部取 uid；见
 *     supabase/migrations/0006_wallet.sql / 0007_growth.sql / 0008_mall.sql）。
 *
 * 两端返回同构 jsonb（{ ok, ... }），本模块统一映射为前端形态。
 * 任何失败都向上抛错，由 wallet.tsx / growth.tsx / mall/store.tsx 捕获降级。
 * ========================================================================== */

import { supabase, cloudBackend, cloudToken, cloudApiBase } from './supabase'

/* ----------------------------- 类型 ----------------------------- */

export interface BizTx {
  id: number
  kind: 'recharge' | 'consume' | 'income'
  fen: number
  note: string
  at: number
}

export interface BizWalletState {
  balanceFen: number
  plan: string
  txns: BizTx[]
}

export interface BizGrowthState {
  events: { id: number; action: string; at: number }[]
  checkin: { last: string; streak: number }
  badges: { code: string; at: number }[]
}

/* ----------------------------- 底层传输 ----------------------------- */

function authHeaders(): Record<string, string> {
  const t = cloudToken()
  return t ? { 'Content-Type': 'application/json', 'x-mim-token': t } : { 'Content-Type': 'application/json' }
}

async function cbFetch(sub: string, method: 'GET' | 'POST', body?: unknown): Promise<any> {
  const res = await fetch(`${cloudApiBase}${sub}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || json.ok === false) {
    const msg =
      (json && (json.error || json.message)) ||
      (res.status === 401 ? '请先登录' : res.status === 403 ? '无权限' : `云端请求失败 (HTTP ${res.status})`)
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return json
}

async function sbRpc(fn: string, params?: Record<string, unknown>): Promise<any> {
  if (!supabase) throw new Error('云端未配置')
  const { data, error } = await supabase.rpc(fn, params)
  if (error) throw new Error(error.message || '云端 RPC 失败')
  if (!data || data.ok === false) {
    throw new Error((data && (data.error || data.message)) || '云端 RPC 失败')
  }
  return data
}

/* ----------------------------- 钱包 ----------------------------- */

export async function walletState(): Promise<BizWalletState> {
  const j = cloudBackend === 'cloudbase' ? await cbFetch('/wallet/state', 'GET') : await sbRpc('wallet_state')
  return {
    balanceFen: typeof j.balance_fen === 'number' ? j.balance_fen : 0,
    plan: typeof j.plan === 'string' ? j.plan : 'BASIC',
    txns: Array.isArray(j.txns) ? (j.txns as BizTx[]) : [],
  }
}

/** 原子扣费；成功返回云端权威余额（分） */
export async function walletDebit(fen: number, note: string): Promise<number> {
  const j =
    cloudBackend === 'cloudbase'
      ? await cbFetch('/wallet/debit', 'POST', { fen, note })
      : await sbRpc('wallet_debit', { p_fen: fen, p_note: note })
  return typeof j.balance_fen === 'number' ? j.balance_fen : 0
}

/** 原子入账（充值/收益）；成功返回云端权威余额（分） */
export async function walletCredit(
  fen: number,
  note: string,
  kind: 'recharge' | 'income',
  snapshot: unknown = null,
): Promise<number> {
  const j =
    cloudBackend === 'cloudbase'
      ? await cbFetch('/wallet/credit', 'POST', { fen, note, kind, snapshot })
      : await sbRpc('wallet_credit', { p_fen: fen, p_note: note, p_kind: kind, p_snapshot: snapshot })
  return typeof j.balance_fen === 'number' ? j.balance_fen : 0
}

/* ----------------------------- 成长 ----------------------------- */

export async function growthState(): Promise<BizGrowthState> {
  const j = cloudBackend === 'cloudbase' ? await cbFetch('/growth/state', 'GET') : await sbRpc('growth_state')
  const ck = j.checkin || { last: '', streak: 0 }
  return {
    events: Array.isArray(j.events) ? (j.events as BizGrowthState['events']) : [],
    checkin: { last: typeof ck.last === 'string' ? ck.last : '', streak: typeof ck.streak === 'number' ? ck.streak : 0 },
    badges: Array.isArray(j.badges) ? (j.badges as BizGrowthState['badges']) : [],
  }
}

/** 行为记分；返回 ok / reason 与云端回写的 value */
export async function growthRecord(
  action: string,
  quality: boolean,
): Promise<{ ok: boolean; value?: number; reason?: string }> {
  const j =
    cloudBackend === 'cloudbase'
      ? await cbFetch('/growth/record', 'POST', { action, quality })
      : await sbRpc('growth_record', { p_action: action, p_quality: quality })
  return { ok: j.ok !== false, value: j.value, reason: j.reason }
}

/** 服务端签到（用服务端日期算连击，防改本地时钟作弊）；返回 ok / streak / reason */
export async function growthCheckin(): Promise<{ ok: boolean; streak?: number; reason?: string }> {
  const j = cloudBackend === 'cloudbase' ? await cbFetch('/growth/checkin', 'POST', {}) : await sbRpc('growth_checkin')
  return { ok: j.ok !== false, streak: j.streak, reason: j.reason }
}

/* ----------------------------- 商城 ----------------------------- */

/** 管理员核销口令（服务端比对，永不下发前端）：仅校验口令，不计余额 */
export async function mallVerifyKey(key: string): Promise<void> {
  if (cloudBackend === 'cloudbase') {
    await cbFetch('/mall/verify-key', 'POST', { key })
  } else if (supabase) {
    const { error } = await supabase.rpc('confirm_order', { p_order_id: '', p_key: key })
    // supabase 主模式口令比对由 Edge Function 层完成，此处仅占位校验入口
    if (error) throw new Error(error.message)
  } else {
    throw new Error('云端未配置')
  }
}

/** 管理员核销订单（服务端校验 admin 权限 + 口令 + 状态机转移 awaiting_confirm → paid） */
export async function mallConfirm(orderId: string, key: string): Promise<void> {
  if (cloudBackend === 'cloudbase') {
    await cbFetch('/mall/confirm', 'POST', { orderId, key })
  } else if (supabase) {
    const { error } = await supabase.rpc('confirm_order', { p_order_id: orderId, p_key: key })
    if (error) throw new Error(error.message)
  } else {
    throw new Error('云端未配置')
  }
}

/** 落盘订单到云端（snake_case 列名，兼容 postgREST / CloudBase PG） */
export async function mallUpsertOrder(order: Record<string, unknown>): Promise<void> {
  if (cloudBackend === 'cloudbase') {
    await cbFetch('/mall/order', 'POST', order)
  } else if (supabase) {
    const { error } = await supabase.from('mall_orders').upsert(order)
    if (error) throw new Error(error.message)
  } else {
    throw new Error('云端未配置')
  }
}

/** 拉取云端订单（按 user_id 隔离，RLS / 服务端强制） */
export async function mallListOrders(): Promise<Record<string, unknown>[]> {
  if (cloudBackend === 'cloudbase') {
    const j = await cbFetch('/mall/orders', 'GET')
    return Array.isArray(j) ? j : []
  }
  if (!supabase) throw new Error('云端未配置')
  const { data, error } = await supabase.from('mall_orders').select('*').order('at', { ascending: false })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : []
}

/* ----------------------------- 价格行情（P1-1） ----------------------------- */

export interface BizPriceQuote { price: number; change: number; at: number }
export type BizPriceMap = Record<string, BizPriceQuote>

/**
 * 触发服务端回源刷新行情（CloudBase 侧 priceRefresh 回源 CoinGecko 并写 price_quotes）。
 * 浏览器不再直连 CoinGecko —— 消除 CORS / 限流 / 行情被篡改的面。
 * 仅 CloudBase 后端支持；supabase 模式需自建 Edge Function + 定时器（暂未接入）。
 */
export async function priceRefresh(): Promise<void> {
  if (cloudBackend === 'cloudbase') {
    await cbFetch('/price/refresh', 'POST')
    return
  }
  throw new Error('云端未配置（行情刷新仅 CloudBase 后端支持）')
}

/** 读取行情快照（ids 为空返回全部）。前端只读快照，不直连上游。 */
export async function priceLatest(ids: string[] = []): Promise<BizPriceMap> {
  if (cloudBackend === 'cloudbase') {
    const q = ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : ''
    const j = await cbFetch(`/price/latest${q}`, 'GET')
    return (j && typeof j === 'object' ? j : {}) as BizPriceMap
  }
  throw new Error('云端未配置（行情读取仅 CloudBase 后端支持）')
}

/* ----------------------------- 推荐负反馈 / 同城（P1-2） ----------------------------- */

export interface BizRecFeedback { authors: string[]; topics: string[]; city: string; exists?: boolean }

/** 读取负反馈 / 同城定位云端真源（跨端一致） */
export async function recGet(): Promise<BizRecFeedback> {
  if (cloudBackend === 'cloudbase') {
    const j = await cbFetch('/rec/feedback', 'GET')
    return {
      authors: Array.isArray(j?.authors) ? (j.authors as string[]) : [],
      topics: Array.isArray(j?.topics) ? (j.topics as string[]) : [],
      city: typeof j?.city === 'string' ? j.city : '北京市',
      exists: j?.exists === true,
    }
  }
  const j = await sbRpc('rec_feedback_get')
  return {
    authors: Array.isArray(j?.authors) ? (j.authors as string[]) : [],
    topics: Array.isArray(j?.topics) ? (j.topics as string[]) : [],
    city: typeof j?.city === 'string' ? j.city : '北京市',
    exists: j?.exists === true,
  }
}

/** 写入负反馈 / 同城定位到云端真源 */
export async function recSave(payload: { authors: string[]; topics: string[]; city: string }): Promise<void> {
  if (cloudBackend === 'cloudbase') {
    await cbFetch('/rec/feedback', 'POST', payload)
    return
  }
  await sbRpc('rec_feedback_save', {
    p_authors: payload.authors,
    p_topics: payload.topics,
    p_city: payload.city,
  })
}

/* ----------------------------- 外部探测代理（P1-3） ----------------------------- */

/**
 * 经服务端白名单代理访问外部资源（防 SSRF）：服务端仅放行 PROXY_ALLOW 名单内主机。
 * 返回原始文本，调用方自行 JSON.parse。仅 CloudBase 后端支持。
 */
export async function proxyExternalText(url: string): Promise<string> {
  if (cloudBackend !== 'cloudbase') throw new Error('云端未配置（外部代理仅 CloudBase 后端支持）')
  const res = await fetch(`${cloudApiBase}/proxy`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ url }),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    let msg = `代理请求失败 (HTTP ${res.status})`
    try {
      const j = JSON.parse(text)
      if (j && (j.error || j.message)) msg = j.error || j.message
    } catch { /* keep default */ }
    throw new Error(msg)
  }
  return text
}

/** 经服务端白名单代理获取外部 JSON（防 SSRF；白名单仅放行登记主机） */
export async function proxyExternalJson(url: string): Promise<unknown> {
  return JSON.parse(await proxyExternalText(url))
}
