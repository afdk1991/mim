/* ============================================================================
 * IoT 长连接网关骨架 —— 10 号文 §2（EMQX 自托管，ADR-002）
 *
 * 四块职责：
 *   1. EMQX HTTP 认证钩子：一机一密 Device-Token 校验，未注册/未激活拒绝连接
 *   2. EMQX HTTP 授权钩子：设备只能订自己的 $dev/{id}/cmd、发自己的 /up 与 /shadow
 *   3. EMQX 事件钩子：client.connected / disconnected → 回写在线状态与 last_seen
 *   4. 指令通路：App → sendCommand → EMQX publish（QoS1）→ 设备回执 $dev/{id}/up
 *      → 规则引擎转发 /api/iot/uplink → 回写指令状态（App 轮询 commandStatus）
 *
 * EMQX 侧需要的一次性配置（自托管集群，部署手册据此核对）：
 *   - 认证：password_based + http backend → POST {本服务}/api/iot/hook/auth
 *   - 授权：http → POST {本服务}/api/iot/hook/acl
 *   - 事件：Webhook 桥接 client.connected / client.disconnected
 *           → POST {本服务}/api/iot/hook/event（请求头带 x-iot-hook-token）
 *   - 上行：规则引擎 SQL `SELECT clientid, topic, payload FROM "$dev/+/up"`
 *           → Webhook POST {本服务}/api/iot/uplink（请求头带 x-iot-hook-token）
 *   钩子与上行统一用 x-iot-hook-token 共享密钥鉴权（未配置则端点关闭，同 SYNC_TOKEN 原则）。
 *
 * 错误码（03 号文登记表，数字段位随响应体下发，HTTP 状态码同步生效）：
 *   30101 设备不存在 / 30102 设备离线 / 30103 未绑定或已被他人绑定
 *
 * 刻意不做的事：
 *   - 不做 OTA check/report（10 号文 §1，随下一轮 0009 迁移落地）
 *   - 不做设备激活/绑定（11 号文 BLE 配网闭环后签发 Device-Token 时一并实现）
 *   - 不订阅 MQTT：上行回执走 EMQX 规则引擎 Webhook，本进程不持有 MQTT 连接
 * ========================================================================== */

import { createHash, timingSafeEqual } from 'node:crypto'
import { query, one } from './db.js'
import { ApiError, badRequest, busy, forbidden, notFound } from './errors.js'

/* ---------- 设备域错误码（03 号文登记段位） ---------- */

const deviceNotFound = () => new ApiError(30101, '设备不存在', 404)
const deviceOffline = () => new ApiError(30102, '设备离线，请稍后重试', 409)
const deviceNotOwned = () => new ApiError(30103, '设备未绑定或已被他人绑定', 403)

/* ---------- 钩子共享密钥 ---------- */

function sameToken(a, b) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** EMQX → 本服务的钩子/上行鉴权：未配置 IOT_HOOK_TOKEN 视为端点未启用 */
export function checkHookToken(req) {
  const expected = process.env.IOT_HOOK_TOKEN ?? ''
  if (!expected) throw forbidden('设备网关钩子未启用：服务端未配置 IOT_HOOK_TOKEN')
  const got = String(req.headers['x-iot-hook-token'] ?? '')
  if (!got || !sameToken(got, expected)) throw forbidden('钩子令牌不正确')
}

/* ---------- 1. EMQX 认证/授权钩子（响应契约是 { result }，不走 { data } 包装） ---------- */

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/**
 * 认证：EMQX 5.x http backend 约定 username = device_id，password = Device-Token。
 * 未注册、未签发 Token（未激活）、Token 不符 → deny（10 号文：未激活拒绝连接）。
 */
export async function hookAuth(body) {
  const deviceId = String(body?.username ?? '')
  const token = String(body?.password ?? '')
  if (!deviceId || !token) return { result: 'deny' }
  const device = await one(
    'select status, device_token_hash from devices where id = $1',
    [deviceId],
  )
  if (!device || !device.device_token_hash || device.status === 'pending_activate') {
    return { result: 'deny' }
  }
  return { result: sha256(token) === device.device_token_hash ? 'allow' : 'deny' }
}

/**
 * 授权：最小面原则——设备身份只能触碰自己的三条 Topic（08 号文 ADR-002 Topic 规范）。
 * 影子离线清理由 EMQX retained 机制承担，此处不放行任何跨设备读写。
 */
export async function hookAcl(body) {
  const deviceId = String(body?.username ?? '')
  const action = String(body?.action ?? '')
  const topic = String(body?.topic ?? '')
  if (!deviceId) return { result: 'deny' }
  const allow =
    (action === 'subscribe' && topic === `$dev/${deviceId}/cmd`) ||
    (action === 'publish' && (topic === `$dev/${deviceId}/up` || topic === `$dev/${deviceId}/shadow`))
  return { result: allow ? 'allow' : 'deny' }
}

/* ---------- 2. EMQX 事件钩子（在线状态回写） ---------- */

export async function hookEvent(body) {
  const deviceId = String(body?.username ?? '')
  const event = String(body?.event ?? '')
  if (!deviceId) return { result: 'ignore' }
  if (event === 'client.connected') {
    await query(
      `update devices set status = 'online', last_seen_at = now(), updated_at = now()
        where id = $1 and status <> 'pending_activate'`,
      [deviceId],
    )
  } else if (event === 'client.disconnected') {
    await query(
      `update devices set status = 'offline', last_seen_at = now(), updated_at = now()
        where id = $1 and status = 'online'`,
      [deviceId],
    )
  }
  return { result: 'ok' }
}

/* ---------- 3. 上行回执（$dev/{id}/up 经规则引擎转入） ---------- */

export async function uplink(body) {
  const m = /^\$dev\/([^/]+)\/up$/.exec(String(body?.topic ?? ''))
  if (!m) throw badRequest('上行 Topic 非法')
  const deviceId = m[1]

  let msg
  try {
    msg = typeof body?.payload === 'string' ? JSON.parse(body.payload) : body?.payload
  } catch {
    throw badRequest('上行报文不是合法 JSON')
  }
  const cmdId = String(msg?.cmd_id ?? '')
  if (!cmdId) throw badRequest('上行报文缺少 cmd_id')
  const okFlag = msg?.result === 'ok'

  // 只消化 pending/sent：重复回执、超时后迟到的回执都幂等落地，不回退终态
  const r = await query(
    `update device_commands
        set status = $1, fail_reason = $2, acked_at = now()
      where id = $3 and device_id = $4 and status in ('pending', 'sent')`,
    [okFlag ? 'acked' : 'failed', okFlag ? null : String(msg?.fail_reason ?? 'unknown'), cmdId, deviceId],
  )
  return { cmd_id: cmdId, matched: r.rowCount > 0 }
}

/* ---------- 4. 指令下发（App 侧） ---------- */

const CMD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const ACTION_RE = /^[a-z][a-z0-9_.]{1,32}$/
const EMQX_TIMEOUT_MS = 5000

/** 经 EMQX 5.x HTTP API 投递 QoS1 下行报文；key/secret 未配置即网关未就绪 */
async function publish(deviceId, envelope) {
  const base = (process.env.EMQX_API_URL ?? 'http://127.0.0.1:18083').replace(/\/+$/, '')
  const key = process.env.EMQX_API_KEY ?? ''
  const secret = process.env.EMQX_API_SECRET ?? ''
  if (!key || !secret) throw busy('设备网关未配置（缺 EMQX_API_KEY / EMQX_API_SECRET）')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), EMQX_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/api/v5/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        topic: `$dev/${deviceId}/cmd`,
        payload: JSON.stringify(envelope),
        qos: 1,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw busy(`设备网关下发失败（EMQX HTTP ${res.status}）`)
  } catch (e) {
    if (e?.name === 'AbortError') throw busy('设备网关下发超时')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function failCommand(cmdId, reason) {
  await query(`update device_commands set status = 'failed', fail_reason = $1 where id = $2`, [reason, cmdId])
}

export async function sendCommand(ctx, deviceId, body) {
  const cmdId = String(body?.cmd_id ?? '')
  const action = String(body?.action ?? '')
  if (!CMD_ID_RE.test(cmdId)) throw badRequest('cmd_id 需为 8~64 位字母、数字、- 或 _')
  if (!ACTION_RE.test(action)) throw badRequest('action 需为小写字母开头的动作名（如 volume.set）')
  const payload = body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {}

  const device = await one('select owner_id, status from devices where id = $1', [deviceId])
  if (!device) throw deviceNotFound()
  if (!device.owner_id || device.owner_id !== ctx.uid) throw deviceNotOwned()

  // 幂等（10 号文 §2.2）：同 cmd_id 重发直接回旧单，不重复下发
  const ins = await query(
    `insert into device_commands (id, device_id, action, payload, created_by)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do nothing
     returning id`,
    [cmdId, deviceId, action, JSON.stringify(payload), ctx.uid],
  )
  if (!ins.rows.length) return commandStatus(ctx, deviceId, cmdId)

  if (device.status !== 'online') {
    await failCommand(cmdId, 'device_offline')
    throw deviceOffline()
  }

  try {
    await publish(deviceId, { cmd_id: cmdId, action, payload })
  } catch (e) {
    await failCommand(cmdId, 'gateway_error')
    throw e
  }
  await query(`update device_commands set status = 'sent', sent_at = now() where id = $1`, [cmdId])
  return { cmd_id: cmdId, device_id: deviceId, action, status: 'sent' }
}

export async function commandStatus(ctx, deviceId, cmdId) {
  const row = await one(
    `select id, device_id, action, payload, status, fail_reason, created_at, sent_at, acked_at
       from device_commands where id = $1 and device_id = $2`,
    [cmdId, deviceId],
  )
  if (!row) throw notFound('指令不存在')
  const device = await one('select owner_id from devices where id = $1', [deviceId])
  if (!device || device.owner_id !== ctx.uid) throw deviceNotOwned()
  return row
}
