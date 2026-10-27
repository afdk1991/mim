/**
 * Mim · 线上库结构自检（只读，无需数据库密码）
 *
 * 用途：判断远端 Supabase 库到底应用了哪些迁移。
 *   GitHub Actions 的 migrate-db job 在未配 secrets 时会「整段跳过」，
 *   于是本地新写的迁移不会自动到线上 —— 表现为某些页面静默报错、
 *   或 /#/admin 的引导 RPC 不存在。本脚本用公开 anon key 只读探测，
 *   把「哪些表/函数缺」一次列清。
 *
 * 判定口径（PostgREST）：
 *   HTTP 200            → 对象存在（返回空数组说明存在但 RLS 拒绝匿名读）
 *   HTTP 404 PGRST205   → 表不存在
 *   HTTP 404 PGRST202   → 函数不存在
 *
 * 探测清单不再手工维护，而是从前端源码自动提取，避免清单漂移：
 *   · 表   ← src/** 中所有 .from('xxx')
 *   · 函数 ← src/** 中所有 .rpc('xxx') 与 lib/bizApi.ts 的 sbRpc('xxx')
 *   归属迁移由 supabase/schema.sql + supabase/migrations/*.sql 反查得到。
 *
 * 用法：
 *   node scripts/probe-schema.mjs                 # 用内置项目（同前端兜底常量）
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/probe-schema.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SUPABASE_DIR = join(ROOT, 'supabase')

const URL_ =
  process.env.SUPABASE_URL?.replace(/\/$/, '') || 'https://sepfobukokrrivwyvhnd.supabase.co'
const KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg'

/* ------------------------- 1. 从前端源码提取引用清单 ------------------------- */

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const srcFiles = walk(join(ROOT, 'src'))
const srcText = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

const refTables = new Set(
  [...srcText.matchAll(/\.from\(\s*['"]([a-zA-Z0-9_]+)['"]/g)].map((m) => m[1]),
)
const refFns = new Set([
  ...[...srcText.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)].map((m) => m[1]),
  ...[...srcText.matchAll(/sbRpc\(\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]),
])

/* ------------------------- 2. 反查归属迁移 ------------------------- */

/** 迁移文件 → 其中定义的表名 / 函数名 / 函数签名 */
function sqlIndex() {
  const files = []
  const schemaPath = join(SUPABASE_DIR, 'schema.sql')
  if (existsSync(schemaPath)) files.push({ label: '0000_schema.sql', path: schemaPath })
  const migDir = join(SUPABASE_DIR, 'migrations')
  if (existsSync(migDir)) {
    for (const n of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
      files.push({ label: n, path: join(migDir, n) })
    }
  }
  const owner = { tables: {}, fns: {}, args: {} }
  for (const f of files) {
    const t = readFileSync(f.path, 'utf8')
    for (const m of t.matchAll(/create\s+(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi)) {
      owner.tables[m[1]] ??= f.label
    }
    for (const m of t.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)/gi,
    )) {
      owner.fns[m[1]] ??= f.label
      owner.args[m[1]] ??= m[2].trim()
    }
  }
  return owner
}

/**
 * 为函数构造探测用 payload。
 * 关键：PostgREST 按 payload 做重载解析 —— 带必需参数的函数若传 {} 会被判为
 * PGRST202「函数不存在」，造成假阴性。故必须按签名给出每个参数。
 */
function samplePayload(argsStr) {
  const payload = {}
  if (!argsStr) return payload
  for (const raw of argsStr.split(',')) {
    const seg = raw.trim()
    if (!seg) continue
    const m = seg.match(/^([a-zA-Z0-9_]+)\s+(.+)$/)
    if (!m) continue
    const name = m[1]
    const type = m[2].replace(/\s+(default|DEFAULT)\s+.*$/, '').trim().toLowerCase()
    if (type.includes('[]')) payload[name] = []
    else if (/^(bigint|int|integer|smallint|numeric|decimal|real|double|float|money)/.test(type)) payload[name] = 0
    else if (/^(bool|boolean)/.test(type)) payload[name] = false
    else if (/^(json|jsonb)/.test(type)) payload[name] = {}
    else if (/^uuid/.test(type)) payload[name] = '00000000-0000-0000-0000-000000000000'
    else if (/^(timestamp|date|time)/.test(type)) payload[name] = new Date().toISOString()
    else payload[name] = 'probe'
  }
  return payload
}

const owner = sqlIndex()

/* ------------------------- 3. 只读探测 ------------------------- */

async function probe(path, method = 'GET', payload = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(payload) : undefined,
  })
  const body = await res.json().catch(() => null)
  // PostgREST：PGRST205=表不存在，PGRST202=函数不存在；
  // 其余 4xx（401/400 等）均说明对象存在（RLS 拒绝或缺参数）
  return { status: res.status, code: body?.code ?? null }
}

const missing = []
const unknown = []

console.log(`🔍 探测 ${URL_} …`)
console.log(`   前端引用：${refTables.size} 张表 / ${refFns.size} 个函数（自动提取自 src/）\n`)

console.log('— 表 —')
for (const t of [...refTables].sort()) {
  const r = await probe(`${t}?select=*&limit=1`)
  const ok = !(r.status === 404 && r.code === 'PGRST205')
  const mig = owner.tables[t] ?? null
  console.log(`${ok ? '✅' : '❌'} ${t.padEnd(20)} HTTP ${String(r.status).padEnd(3)}${(r.code ?? '').padEnd(9)} ${mig ?? '(迁移中未定义!)'}`)
  if (!ok) missing.push({ kind: '表', name: t, mig })
  if (!mig) unknown.push({ kind: '表', name: t })
}

console.log('\n— 函数 —')
for (const fn of [...refFns].sort()) {
  const args = owner.args[fn] ?? ''
  const payload = samplePayload(args)
  const r = await probe(`rpc/${fn}`, 'POST', payload)
  const ok = !(r.status === 404 && r.code === 'PGRST202')
  const mig = owner.fns[fn] ?? null
  const sig = args ? `(${args})` : '()'
  console.log(`${ok ? '✅' : '❌'} ${fn.padEnd(20)} HTTP ${String(r.status).padEnd(3)}${(r.code ?? '').padEnd(9)} ${mig ?? '(迁移中未定义!)'}`)
  if (!ok) missing.push({ kind: '函数', name: fn, mig, sig })
  if (!mig) unknown.push({ kind: '函数', name: fn })
}

/* ------------------------- 4. 结论 ------------------------- */

console.log('')

if (unknown.length) {
  console.log('🔴 前端引用了但仓库 SQL 中根本没定义的对象（写了调用却没有后端实现）：')
  for (const u of unknown) console.log(`   - ${u.kind} ${u.name}`)
  console.log('')
}

if (missing.length === 0) {
  console.log('🎉 前端引用的全部对象在线上齐备。')
} else {
  const migs = [...new Set(missing.map((m) => m.mig ?? '未定义'))].sort()
  console.log(`⚠️ 线上缺失 ${missing.length} 个对象，涉及迁移：${migs.join(', ')}`)
  console.log(missing.map((m) => `   - ${m.kind} ${m.name}（${m.mig ?? '未定义'}）`).join('\n'))
  console.log('\n修复方式（任选其一）：')
  console.log('  1) 零凭证：Supabase Dashboard → SQL Editor → 粘贴 supabase/apply-all-manual.sql 全文执行（幂等）')
  console.log('  2) 本机：  SUPABASE_DB_URL=postgresql://… npm run db:apply')
  console.log('  3) CI：    仓库 Secrets 配 SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF，push main 自动应用')
}

process.exit(missing.length || unknown.length ? 1 : 0)
