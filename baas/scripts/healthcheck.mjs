#!/usr/bin/env node
/**
 * 运行时健康探测（需要栈已启动）。
 *   node scripts/healthcheck.mjs [--url http://localhost:8000]
 *
 * 说明：
 *   - 只做 HTTP 层探测，不写任何数据；未启动的组件会明确列出，方便定位。
 *   - optional 项为版本差异较大的端点（如 Realtime 健康检查路径、GraphQL 需扩展），
 *     失败只记 🟡，不算阻断。
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

function envValue(key) {
  const envFile = path.join(ROOT, '.env')
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) return m[1].trim()
  }
  return process.env[key]
}

const base = (() => {
  const i = argv.indexOf('--url')
  return (i >= 0 ? argv[i + 1] : null) || envValue('SITE_URL') || 'http://localhost:8000'
})()

const anonKey = envValue('ANON_KEY') || ''
const authHeaders = anonKey
  ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  : {}

const probes = [
  { name: 'gateway  /health', path: '/health', required: true },
  { name: 'auth     /auth/v1/health', path: '/auth/v1/health', required: true },
  { name: 'rest     OpenAPI', path: '/rest/v1/', required: true, headers: authHeaders },
  { name: 'rest     rpc/ping', path: '/rest/v1/rpc/ping', required: true, headers: authHeaders },
  { name: 'storage  /status', path: '/storage/v1/status', required: true },
  { name: 'realtime /api/health', path: '/realtime/v1/api/health', required: false },
  { name: 'functions /hello', path: '/functions/v1/hello', required: true },
  {
    name: 'graphql  /graphql/v1',
    path: '/graphql/v1',
    required: false,
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __schema { queryType { name } } }' }),
  },
]

async function probe(p) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${base}${p.path}`, {
      method: p.method ?? 'GET',
      headers: p.headers ?? {},
      body: p.body,
      signal: ctrl.signal,
    })
    const text = (await res.text()).slice(0, 120)
    return { ok: res.ok, status: res.status, text }
  } catch (err) {
    return { ok: false, status: 0, text: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

console.log(`健康探测：${base}\n`)
let failed = 0
let warned = 0

for (const p of probes) {
  const r = await probe(p)
  if (r.ok) {
    console.log(`  ✅ ${p.name.padEnd(30)} HTTP ${r.status}`)
  } else if (p.required) {
    failed++
    console.log(`  🔴 ${p.name.padEnd(30)} HTTP ${r.status} ${r.text}`)
  } else {
    warned++
    console.log(`  🟡 ${p.name.padEnd(30)} HTTP ${r.status} ${r.text}（可选项，多为版本差异）`)
  }
}

console.log(`\n合计：🔴 ${failed} 项阻断 / 🟡 ${warned} 项提示`)
if (failed > 0) {
  console.log('处置建议：make ps 看容器状态 → make logs 看启动日志 → 常见原因是密钥未生成或迁移未应用')
}
process.exit(failed > 0 ? 1 : 0)
