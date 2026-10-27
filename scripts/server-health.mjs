/* ============================================================================
 * 后端健康探测 —— node scripts/server-health.mjs
 *
 * 对真实 HTTP 接口做端到端探测（不做 mock、不连数据库直查）：
 *   1. GET  /api/health            服务存活 + 数据库连通性
 *   2. GET  /api/rest/products?limit=1   通用 REST 层可用（含表白名单与列核定）
 *
 * 用法：
 *   node scripts/server-health.mjs
 *   MIM_API_BASE=http://127.0.0.1:8787 node scripts/server-health.mjs
 *   node scripts/server-health.mjs http://example.com
 * ========================================================================== */

const BASE = (process.argv[2] ?? process.env.MIM_API_BASE ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 5000)

const PROBES = [
  { name: '健康检查', path: '/api/health', check: (d) => d && d.ok === true },
  {
    name: 'REST 商品列表',
    path: '/api/rest/products?limit=1',
    check: (d) => Array.isArray(d),
  },
]

async function probe({ name, path, check }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    })
    const text = await res.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!res.ok) {
      const inner = payload?.error
      return {
        ok: false,
        line: `✗ ${name}：HTTP ${res.status} ${payload?.error?.code ?? ''} ${payload?.error?.message ?? ''}`.trim(),
      }
    }
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
    if (!check(data)) return { ok: false, line: `✗ ${name}：响应结构不符预期 ${text.slice(0, 120)}` }
    return { ok: true, line: `✓ ${name}：${res.status} ${JSON.stringify(data).slice(0, 160)}` }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, line: `✗ ${name}：${aborted ? '请求超时' : e.message}` }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log(`Mim 后端健康探测 → ${BASE}`)
  const results = []
  for (const p of PROBES) results.push(await probe(p))
  for (const r of results) console.log(`  ${r.line}`)

  const failed = results.filter((r) => !r.ok).length
  if (failed) {
    console.error(`\n${failed} 项失败：后端未就绪，请先在 server 目录执行 npm install && npm run migrate && npm run dev`)
    process.exitCode = 1
    return
  }
  console.log('\n全部通过：后端可用')
}

await main()
