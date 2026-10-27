/* ============================================================================
 * 自托管后端端到端断言 —— node scripts/verify-backend.mjs
 *
 * 取代 Supabase 时代的 verify-cloud-e2e.mjs：那时断言的是 supabase.co 的
 * REST/Auth，现在断言的是 server/（node:http + pg）暴露的同一组能力：
 * 健康检查 → 注册 → 登录 → 读身份 → 鉴权拒绝 → REST 写读回 → 清理。
 *
 * 用法：
 *   node scripts/verify-backend.mjs
 *   MIM_API_BASE=http://127.0.0.1:8787 node scripts/verify-backend.mjs
 *   node scripts/verify-backend.mjs http://example.com
 *
 * 后端未启动时打印一行 skip 并 exit 0：本脚本常在「只跑前端」的 CI 里执行，
 * 没有数据库的环境不该因为断言不到后端而变红。
 *
 * 落表选择 notifications（server/db/migrations/0002_content.sql:130）：
 *   · 归属列 user_id 外键指向 users——注册出来的账号天然满足，无需外连别的表
 *   · 除 user_id 外无其它非空外键：from_user_id 可空，post_id 可空
 *   · 其余列（id / type / content / read）都有默认值，写入只需带 created_at
 *   · REST 白名单里它是 read:'owner' + write:'owner'（server/src/rest.js:41），
 *     既能验证「带令牌可读自己的」，也能验证「不带令牌 401」，正合断言 4/5
 * 测试账号无法经 API 删除（users 不在 REST 白名单，这是刻意的），仅清理本次写入的行。
 * ========================================================================== */

const BASE = (process.argv[2] ?? process.env.MIM_API_BASE ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 8000)

const TABLE = 'notifications'
const stamp = Math.random().toString(36).slice(2, 8)
const USERNAME = `vb_${stamp}@example.com`
const PASSWORD = `Vb-${stamp}-pass`
const MARK = `verify-backend ${stamp}`

let pass = 0
let fail = 0

function check(name, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
  return ok
}

/** 解包 { data } 契约；失败时抛出带响应体的错误，便于定位 */
async function call(method, path, { token, body } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const text = await res.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
    if (!res.ok) {
      const err = payload?.error
      const e = new Error(`HTTP ${res.status} ${err?.code ?? ''} ${err?.message ?? ''}`.trim() || `HTTP ${res.status}`)
      e.status = res.status
      e.body = text
      throw e
    }
    return { status: res.status, data, text }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log(`Mim 自托管后端断言 → ${BASE}`)

  /* ---------- 0. 探活：不可达即跳过 ---------- */
  let health
  try {
    health = await call('GET', '/api/health')
  } catch (e) {
    if (e?.name === 'AbortError' || !e?.status) {
      console.log(`skip: 后端未启动（${BASE}），跳过云端断言`)
      return 0
    }
    console.error(`❌ 健康检查失败：${e.message}\n${e.body ?? ''}`)
    return 1
  }
  const healthOk = check(
    '1. GET /api/health 返回 200 且含 ok',
    health.status === 200 && health.data?.ok === true,
    `${health.status} ${JSON.stringify(health.data).slice(0, 120)}`,
  )
  if (!healthOk) return 1

  /* ---------- 1~3. 注册 / 登录 / 读身份 ---------- */
  const reg = await call('POST', '/api/auth/register', { body: { username: USERNAME, password: PASSWORD } })
  const regToken = reg.data?.token
  check('2. POST /api/auth/register 注册并返回令牌', !!regToken, `账号 ${USERNAME}`)
  if (!regToken) return 1

  const login = await call('POST', '/api/auth/login', { body: { username: USERNAME, password: PASSWORD } })
  const token = login.data?.token
  check('3. POST /api/auth/login 登录并返回令牌', !!token)

  const me = await call('GET', '/api/auth/me', { token })
  check(
    '4. GET /api/auth/me 带 Authorization 返回该用户',
    me.data?.id === reg.data?.user?.id && me.data?.username === USERNAME,
    `id=${me.data?.id} username=${me.data?.username}`,
  )

  /* ---------- 5. 鉴权：不带令牌必须 401 ---------- */
  let anonStatus = 0
  let anonBody = ''
  try {
    const anon = await call('GET', `/api/rest/${TABLE}?limit=1`)
    anonStatus = anon.status
  } catch (e) {
    anonStatus = e.status ?? 0
    anonBody = e.body ?? ''
  }
  check(
    '5. 不带 Authorization 访问受保护资源返回 401',
    anonStatus === 401,
    `HTTP ${anonStatus}${anonBody ? ' | ' + anonBody.slice(0, 120) : ''}`,
  )

  /* ---------- 6. REST 写 → 读回 ---------- */
  const created = await call('POST', `/api/rest/${TABLE}`, {
    token,
    body: { type: 'like', content: MARK, created_at: Date.now() },
  })
  const rowId = created.data?.id
  check('6a. POST /api/rest/notifications 写入成功', !!rowId, `id=${rowId}`)
  if (!rowId) return 1

  const read = await call('GET', `/api/rest/${TABLE}?eq=id.${encodeURIComponent(rowId)}`, { token })
  const hit = (read.data ?? []).find((r) => r.id === rowId)
  check(
    '6b. GET /api/rest/notifications 读回该行',
    !!hit && hit.content === MARK && hit.user_id === me.data?.id,
    `rows=${(read.data ?? []).length} content=${hit?.content ?? '(未命中)'}`,
  )

  /* ---------- 7. 清理（无论前面是否通过都尽量删掉测试行）---------- */
  try {
    // 服务端 DELETE 取主键于路径：/api/rest/:table/:id
    await call('DELETE', `/api/rest/${TABLE}/${encodeURIComponent(rowId)}`, { token })
    check('7. DELETE /api/rest/notifications/:id 清理测试数据', true, `id=${rowId}`)
  } catch (e) {
    check('7. DELETE /api/rest/notifications/:id 清理测试数据', false, `${e.message} | ${e.body ?? ''}`)
  }

  console.log(`\n=== 自托管后端断言：${pass} 通过 / ${fail} 失败 ===`)
  return fail > 0 ? 1 : 0
}

try {
  process.exitCode = await main()
} catch (e) {
  console.error(`❌ 断言异常中断：${e.message}`)
  if (e?.body) console.error(`响应体：${String(e.body).slice(0, 500)}`)
  process.exitCode = 1
}
