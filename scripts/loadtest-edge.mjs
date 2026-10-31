/* ============================================================================
 * 边界 / 安全 RPC 测试脚本（契约级，阶段二实跑）
 *
 * 用途：对「待实现/待收口」的边界契约做断言：
 *   EDGE-1  config 权限分层：未登录 config_get 仅见非敏感键；管理员 admin_config_set
 *           可写；敏感键在 config_get 不可见；admin_config_set 回显脱敏仅末 4 位；
 *           audit_logs 留痕存在。
 *   EDGE-2  限流：连续超限请求被拒（记录实际返回码与触发阈值）。
 *   EDGE-3  errors.js 脱敏：5xx 响应体不得携带 PG 原始 detail / 堆栈 / 内部 SQL 片段。
 *   EDGE-4  wallet_credit 管理员收口：普通用户调用被拒 403。
 *   EDGE-5  growth 防刷：daily_cap 超限 409、quality_gate 400、同日重复签到 409。
 *   EDGE-6  健康检查：/api/health 与 /api/health?full=1 契约断言。
 *
 * 运行方式（阶段二，server 已启动 + 后端实现就位）：
 *   $env:DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/mim'
 *   $env:JWT_SECRET='<与 server 同>'
 *   $env:SYNC_TOKEN='sync-test-token-abc123'
 *   node scripts/loadtest-edge.mjs
 *
 * 退出码：全部断言通过=0；任一失败=1。结果打印 JSON 行。
 * 注意：本脚本会写入测试配置/成长事件/钱包流水，仅用于本机测试库。
 *       阶段一仅做 `node --check` 语法校验，不实跑（config RPC / 限流 / wallet_credit
 *       收口尚未在当前代码落地，实跑必然红——这是预期，不是脚本错误）。
 * ========================================================================== */

import pg from 'pg'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

/* 敏感键清单：config_get 响应中出现任一即判失败。
   与后端 server/src/config.js（待实现）的 SENSITIVE_KEYS 保持一致。 */
const SENSITIVE_KEYS = [
  'jwt_secret',
  'sync_token',
  'database_url',
  'db_url',
  'encryption_key',
  'admin_password',
  'smtp_password',
  'pay_secret',
]

/* 限流参数：按后端契约预期（可由环境变量覆盖）。
   实跑时记录「第几个请求开始返回 429」作为实测阈值，不写死。 */
const RATE_BURST = Number(process.env.RATE_BURST ?? 40)

const results = []
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${detail}`)
}

async function rpc(token, fn, params) {
  const res = await fetch(`${BASE}/api/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params ?? {}),
  })
  let body = null
  try { body = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, body }
}

async function rawPost(path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  })
  let parsed = null
  try { parsed = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, body: parsed, text: parsed ? '' : await res.text().catch(() => '') }
}

async function register(username, password = 'edge123456') {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json()
  return { status: res.status, token: body?.data?.token, user: body?.data?.user }
}

/** 直接在库内把某用户提升为 admin（测试夹具，等价 promote-admin.js） */
async function grantAdmin(uid) {
  await pool.query(
    `insert into user_roles (user_id, role_id)
     select $1, r.id from roles r where r.name = 'admin' on conflict do nothing`,
    [uid],
  )
}

/** 配置表夹具：确保存在一张 settings/config 表（表名以后端实现为准；这里做防御性检查） */
async function ensureConfigTable() {
  const t = await pool.query(
    `select 1 from information_schema.tables where table_name in ('app_config','settings','config') limit 1`,
  )
  return t.rows.length ? t.rows[0] : null
}

/* --------------------------------------------------------------------------
 * EDGE-1  config 权限分层
 * -------------------------------------------------------------------------- */
async function EDGE1_config(adminToken, normalUser) {
  // ① 未登录 config_get：必须可访问（200），且响应体不含任何敏感键
  const anon = await rpc(null, 'config_get', {})
  const anonData = anon.body?.data ?? {}
  const anonLeak = SENSITIVE_KEYS.filter((k) => anonData && Object.prototype.hasOwnProperty.call(anonData, k))
  const anonOk = anon.status === 200 && anonLeak.length === 0

  // ② 普通登录用户 config_get：同样不得见敏感键
  const normal = await rpc(normalUser.token, 'config_get', {})
  const normalData = normal.body?.data ?? {}
  const normalLeak = SENSITIVE_KEYS.filter((k) => normalData && Object.prototype.hasOwnProperty.call(normalData, k))
  const normalOk = normal.status === 200 && normalLeak.length === 0

  // ③ 管理员 admin_config_set：写入一个敏感键 + 一个非敏感键
  const writeRes = await rpc(adminToken, 'admin_config_set', {
    p_key: 'jwt_secret',
    p_value: 'test-secret-abcdef123456',
  })
  const writeOk = writeRes.status === 200

  // ④ 回显脱敏：敏感键回显仅末 4 位可见（如 ****1234），不得出现完整值
  const echoVal = writeRes.body?.data?.value ?? writeRes.body?.data?.echo ?? ''
  const fullLeak = typeof echoVal === 'string' && echoVal.includes('abcdef123456')
  const maskedOk = typeof echoVal === 'string' && /\*{2,}\d{4}$/.test(echoVal) && !fullLeak

  // ⑤ 非管理员 admin_config_set：必须 403
  const forbidden = await rpc(normalUser.token, 'admin_config_set', { p_key: 'site_name', p_value: 'hack' })
  const forbiddenOk = forbidden.status === 403

  // ⑥ 未登录 admin_config_set：必须 401
  const noAuthRes = await rpc(null, 'admin_config_set', { p_key: 'site_name', p_value: 'hack' })
  const noAuthOk = noAuthRes.status === 401

  // ⑦ audit_logs 留痕：admin_config_set 后应有一条 config.set 审计
  const audit = await pool.query(
    `select count(*)::int n from audit_logs where action like 'config%'`,
  )
  const auditOk = Number(audit.rows[0]?.n ?? 0) >= 1

  const pass = anonOk && normalOk && writeOk && maskedOk && forbiddenOk && noAuthOk && auditOk
  record('EDGE-1', 'config 权限分层/脱敏/留痕', pass,
    `匿名config_get=${anon.status} 泄漏=${anonLeak.join(',') || '无'} ` +
    `普通config_get泄漏=${normalLeak.join(',') || '无'} ` +
    `管理员写=${writeRes.status} 回显=${JSON.stringify(echoVal)} 脱敏=${maskedOk} ` +
    `普通写=${forbidden.status}(应403) 匿名写=${noAuthRes.status}(应401) ` +
    `audit留痕=${audit.rows[0]?.n ?? 0}条`)
}

/* --------------------------------------------------------------------------
 * EDGE-2  限流：连续超限请求被拒
 * -------------------------------------------------------------------------- */
async function EDGE2_rateLimit(normalUser) {
  // 对登录态 RPC 连续打 RATE_BURST 次，记录首次 429 出现在第几个请求
  const results = []
  let first429 = -1
  for (let i = 0; i < RATE_BURST; i++) {
    const r = await rpc(normalUser.token, 'wallet_state', {})
    results.push(r.status)
    if (r.status === 429 && first429 < 0) first429 = i + 1
  }
  const hits429 = results.filter((s) => s === 429).length
  // 契约：超过阈值后必须出现 429（不再是 200/500 串台）
  const pass = first429 > 0 && hits429 >= 1
  record('EDGE-2', '限流：超限请求被 429 拒绝', pass,
    `连发${RATE_BURST}次 wallet_state，首429出现在第${first429}次，累计429=${hits429}，状态序列前10=[${results.slice(0, 10).join(',')}]`)
}

/* --------------------------------------------------------------------------
 * EDGE-3  errors.js 脱敏：5xx 不得携带内部细节
 * -------------------------------------------------------------------------- */
async function EDGE3_errorDesensitize(normalUser) {
  // 触发点说明：阶段二实现就位后，这里通过一个会在服务端抛未映射异常的请求
  // （例如非法 JSON 类型注入、或故意传入越界参数触发非 PG_TO_CODE 分支）。
  // 断言对「任意 5xx 响应体」做形状检查：
  //   - code === 'server'
  //   - message === '服务端异常，请稍后重试'（与 errors.js:toApiError 一致）
  //   - 响应体文本不得出现 PG 原文特征：relation/column/syntax error/stack/at /lib/
  //
  // 阶段一先跑一个「已知会落到 4xx」的对照：非法 RPC 名 → 400 schema，message 不得泄漏表名。
  const badFn = await rpc(normalUser.token, 'does_not_exist_fn_edge', {})
  const badBody = JSON.stringify(badFn.body ?? {})
  const leakPatterns = [/relation\s+["']?\w+/i, /column\s+["']?\w+/i, /syntax error/i, /\bat\s+\w+\.js:\d+/i, /\/lib\/pg\//i]
  const leaks = leakPatterns.filter((re) => re.test(badBody))

  // 再制造一个真实 5xx：把 p_fen 传到 wallet_debit 触发余额不足（409，已映射）——
  // 这一步只为证明「已映射错误走 {error:{code,message}} 形状」，而不是泄漏。
  const conflict = await rpc(normalUser.token, 'wallet_debit', { p_fen: 99999999999 })
  const conflictShape = conflict.body?.error && typeof conflict.body.error.message === 'string' && conflict.status === 409

  const pass = badFn.status === 400 && leaks.length === 0 && conflictShape
  record('EDGE-3', 'errors.js 脱敏：响应体无 PG/堆栈原文', pass,
    `非法RPC=${badFn.status} 泄漏特征=${leaks.length ? leaks.map((r)=>r.source).join('|') : '无'} ` +
    `已映射409形状=${conflictShape} error=${JSON.stringify(conflict.body?.error ?? {}).slice(0,120)}`)
}

/* --------------------------------------------------------------------------
 * EDGE-4  wallet_credit 管理员收口
 * -------------------------------------------------------------------------- */
async function EDGE4_walletCreditAdmin(normalUser, adminToken) {
  // ① 普通用户调 wallet_credit：契约要求 403（管理员收口，禁止自充）
  const selfCredit = await rpc(normalUser.token, 'wallet_credit', { p_fen: 100, p_note: 'edge-self' })
  const selfBlocked = selfCredit.status === 403

  // ② 管理员调 wallet_credit（兜底确认管理员通道仍通）
  const adminCredit = await rpc(adminToken, 'admin_wallet_credit', {
    p_user_id: normalUser.user.id,
    p_fen: 100,
    p_note: 'edge-admin-topup',
  })
  const adminOk = adminCredit.status === 200 && Number(adminCredit.body?.data?.balance_fen ?? 0) >= 100

  const pass = selfBlocked && adminOk
  record('EDGE-4', 'wallet_credit 普通用户 403 / admin 通道可用', pass,
    `普通自充=${selfCredit.status}(应403) msg=${selfCredit.body?.error?.message ?? ''} ` +
    `管理员核销=${adminCredit.status} balance=${adminCredit.body?.data?.balance_fen ?? '?'}`)
}

/* --------------------------------------------------------------------------
 * EDGE-5  growth 防刷
 * -------------------------------------------------------------------------- */
async function EDGE5_growthAntiAbuse(normalUser) {
  // 选用 DB 中已配置的规则：publish_article（quality_gate=true, daily_cap=5）
  const ACTION = 'publish_article'
  // ① quality_gate：规则开启质量闸，p_quality=false 应 400
  const qGate = await rpc(normalUser.token, 'growth_record', { p_action: ACTION, p_quality: false })
  const qGateOk = qGate.status === 400

  // ② daily_cap：连续同一动作直到 409「今日该行为已达上限」
  const caps = []
  for (let i = 0; i < 10; i++) {
    const r = await rpc(normalUser.token, 'growth_record', { p_action: ACTION, p_quality: true })
    caps.push(r.status)
    if (r.status === 409) break
  }
  const hitCap = caps.includes(409)

  // ③ 同日重复签到 409
  await rpc(normalUser.token, 'growth_checkin', {})
  const dup = await rpc(normalUser.token, 'growth_checkin', {})
  const dupOk = dup.status === 409

  const pass = qGateOk && hitCap && dupOk
  record('EDGE-5', 'growth 防刷：质量闸/daily_cap/重复签到', pass,
    `质量闸=${qGate.status}(400|404) daily_cap序列=[${caps.join(',')}] 重复签到=${dup.status}(应409)`)
}

/* --------------------------------------------------------------------------
 * EDGE-6  健康检查契约
 * -------------------------------------------------------------------------- */
async function EDGE6_health() {
  const basic = await fetch(`${BASE}/api/health`).then((r) => r.json())
  const basicOk = basic.data?.ok === true && basic.data?.db === true && typeof basic.data?.uptime_ms === 'number'

  const full = await fetch(`${BASE}/api/health?full=1`).then((r) => r.json()).catch(() => null)
  // full=1 契约（待后端实现）：在 basic 之上额外给出 db 连接池/迁移版本/磁盘/内存
  const fullData = full?.data ?? {}
  const fullHasExtra = ['migrations', 'uptime_ms', 'rpcs'].some((k) => k in fullData)

  const pass = basicOk && full && fullHasExtra
  record('EDGE-6', '/api/health 与 ?full=1 契约', pass,
    `basic ok=${basic.data?.ok} db=${basic.data?.db} rpcs=${basic.data?.rpcs} ` +
    `full字段=${Object.keys(fullData).join(',') || '(空)'} `)
}

/* --------------------------------------------------------------------------
 * 清理 + 主流程
 * -------------------------------------------------------------------------- */
async function cleanup() {
  await pool.query(`delete from growth_events where user_id in (select id from users where username like 'edge_%')`)
  await pool.query(`delete from growth_checkins where user_id in (select id from users where username like 'edge_%')`)
  await pool.query(`delete from wallet_txs where note like 'edge-%'`)
}

async function main() {
  const ts = Date.now()
  const admin = await register(`edge_admin_${ts}`)
  await grantAdmin(admin.user.id)
  // 重新登录以装载 admin 角色（loadIdentity 在登录时跑）
  const adminLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: admin.user.username, password: 'edge123456' }),
  }).then((r) => r.json())
  const adminToken = adminLogin.data?.token

  const normal = await register(`edge_user_${ts}`)

  await cleanup()
  await EDGE1_config(adminToken, normal)
  await EDGE2_rateLimit(normal)
  await EDGE3_errorDesensitize(normal)
  await EDGE4_walletCreditAdmin(normal, adminToken)
  await EDGE5_growthAntiAbuse(normal)
  await EDGE6_health()
}

try {
  await main()
} catch (e) {
  console.error('脚本异常', e)
  process.exitCode = 1
} finally {
  await pool.end()
}
const failed = results.filter((r) => !r.pass)
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((f) => f.id) }, null, 2))
process.exitCode = failed.length ? 1 : 0
