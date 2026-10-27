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
 * 用法：
 *   node scripts/probe-schema.mjs                 # 用内置项目（同前端兜底常量）
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/probe-schema.mjs
 */

const URL_ =
  process.env.SUPABASE_URL?.replace(/\/$/, '') || 'https://sepfobukokrrivwyvhnd.supabase.co'
const KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg'

/** 关键对象 → 由哪个迁移引入（用于给出「该跑哪个 SQL」的建议） */
const TABLES = [
  ['topics', '0000'],
  ['hot_searches', '0000'],
  ['roles', '0001'],
  ['audit_logs', '0001'],
  ['account_bridge', '0003'],
  ['wallet_balances', '0006'],
  ['wallet_txns', '0006'],
  ['growth_rules', '0007'],
  ['growth_events', '0007'],
  ['growth_checkins', '0007'],
  ['growth_badges', '0007'],
  ['mall_orders', '0008'],
  ['price_quotes', '0009'],
  ['rec_feedback', '0009'],
]

const RPCS = [
  ['username_taken', '0003'],
  ['has_any_admin', '0010'],
]

async function head(path, method = 'GET') {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? '{}' : undefined,
  })
  const body = await res.json().catch(() => null)
  // PostgREST 错误码：PGRST205=表不存在，PGRST202=函数不存在，
  // 其余 4xx（401/400 等）均说明对象存在（RLS 拒绝或缺参数）
  return { status: res.status, code: body?.code ?? null }
}

console.log(`🔍 探测 ${URL_} …\n`)

const missing = []
for (const [t, mig] of TABLES) {
  const r = await head(`${t}?select=*&limit=1`)
  const ok = !(r.status === 404 && r.code === 'PGRST205')
  console.log(`${ok ? '✅' : '❌'} 表 ${t.padEnd(18)} (${mig})  HTTP ${r.status}${r.code ? ' ' + r.code : ''}`)
  if (!ok) missing.push({ kind: '表', name: t, mig })
}

console.log('')
for (const [fn, mig] of RPCS) {
  const r = await head(`rpc/${fn}`, 'POST')
  const ok = !(r.status === 404 && r.code === 'PGRST202')
  console.log(`${ok ? '✅' : '❌'} 函数 ${fn.padEnd(16)} (${mig})  HTTP ${r.status}${r.code ? ' ' + r.code : ''}`)
  if (!ok) missing.push({ kind: '函数', name: fn, mig })
}

console.log('')
if (missing.length === 0) {
  console.log('🎉 全部关键对象齐备，迁移已应用到最新。')
  process.exit(0)
}

const migs = [...new Set(missing.map((m) => m.mig))].sort()
console.log(`⚠️ 缺失 ${missing.length} 个对象，涉及迁移：${migs.join(', ')}`)
console.log(missing.map((m) => `   - ${m.kind} ${m.name}（${m.mig}）`).join('\n'))
console.log('\n修复方式（任选其一）：')
console.log('  1) 零凭证：Supabase Dashboard → SQL Editor → 粘贴 supabase/apply-all-manual.sql 全文执行（幂等）')
console.log('  2) 本机：  SUPABASE_DB_URL=postgresql://… npm run db:apply')
console.log('  3) CI：    仓库 Secrets 配 SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF，push main 自动应用')
process.exit(1)
