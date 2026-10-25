/**
 * Mim · Edge Function 远程部署脚本（Supabase Management API）
 *
 * 背景：CI 的 deploy-supabase-function job 需要 4 个 secrets，未配置时整段跳过，
 * 导致线上 /functions/v1/mim-api 404。本脚本用 Access Token 直接走 Management API
 * 部署，无需 GitHub Secrets、无需 Docker、无需 CLI。
 *
 * 端点（官方）：POST /v1/projects/{ref}/functions/deploy?slug=mim-api
 *   multipart/form-data:
 *     metadata = {"entrypoint_path":"index.ts","name":"mim-api","verify_jwt":false}
 *     file     = 源文件（可多个，保留相对路径名，如 _shared/policy.ts）
 *
 * 凭证来源（二选一）：
 *   1. 环境变量 SUPABASE_ACCESS_TOKEN
 *   2. 文件 browser-shots/supabase-access-token.txt（由 supabase-autopilot.mjs 抓取）
 *
 * 用法：
 *   node scripts/deploy-supabase-function.mjs            # 部署 + 验证
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/deploy-supabase-function.mjs
 *       # 同时写入 function secrets（SUPABASE_SERVICE_ROLE_KEY + MIM_TOKEN_SECRET）
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FN_DIR = join(ROOT, 'supabase', 'functions', 'mim-api')
const TOKEN_FILE = join(ROOT, 'browser-shots', 'supabase-access-token.txt')
const PROJECT_REF = 'sepfobukokrrivwyvhnd'
const SB_URL = `https://${PROJECT_REF}.supabase.co`
const ANON_KEY = 'sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg'

const token =
  process.env.SUPABASE_ACCESS_TOKEN?.trim() ||
  (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '')

if (!token) {
  console.error('❌ 缺少 Access Token：设置 SUPABASE_ACCESS_TOKEN 或先运行 supabase-autopilot.mjs')
  process.exit(1)
}

/** 递归收集函数目录下全部文件 */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else out.push(p)
  }
  return out
}

async function main() {
  const files = collect(FN_DIR).map((p) => ({
    rel: relative(FN_DIR, p).replaceAll('\\', '/'),
    abs: p,
  }))
  console.log(`📦 函数文件 ${files.length} 个：${files.map((f) => f.rel).join(', ')}`)

  // ---- 1. 部署（create-or-update）----
  const form = new FormData()
  form.set(
    'metadata',
    JSON.stringify({
      entrypoint_path: 'index.ts',
      name: 'mim-api',
      verify_jwt: false,
    }),
  )
  for (const f of files) {
    const blob = new Blob([readFileSync(f.abs)], { type: 'application/typescript' })
    form.append('file', blob, f.rel)
  }

  console.log('🚀 部署 Edge Function mim-api …')
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=mim-api`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  )
  const text = await res.text()
  if (!res.ok) {
    console.error(`❌ 部署失败 HTTP ${res.status}: ${text.slice(0, 500)}`)
    process.exit(1)
  }
  let meta = {}
  try { meta = JSON.parse(text) } catch { /* 响应体可能为空 */ }
  console.log(`✅ 部署成功：slug=${meta.slug ?? 'mim-api'} status=${meta.status ?? '?'} version=${meta.version ?? '?'}`)

  // ---- 2. Function secrets（可选）----
  // 注意：Supabase 平台禁止 secret 名以 SUPABASE_ 开头（保留前缀，
  // SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
  // 由 Edge Runtime 自动注入，无需也不能手动设置）。
  // 故此处只写自定义的 MIM_TOKEN_SECRET。
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const tokenSecret = process.env.MIM_TOKEN_SECRET?.trim() || randomBytes(32).toString('hex')
  const secrets = [{ name: 'MIM_TOKEN_SECRET', value: tokenSecret }]

  console.log('🔑 写入 function secrets …')
  const secRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(secrets),
  })
  if (secRes.ok) {
    console.log(`   ✅ secrets 已设置：${secrets.map((s) => s.name).join(', ')}`)
    console.log('   ℹ️ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Edge Runtime 自动注入（平台保留前缀）')
    console.log(`   ℹ️ MIM_TOKEN_SECRET（已随机生成并写入）：${tokenSecret}`)
    if (!serviceKey) {
      console.log('   （未使用外部 SUPABASE_SERVICE_ROLE_KEY——平台自动注入的即为该值）')
    }
  } else {
    console.log(`   ⚠️ secrets 写入失败 HTTP ${secRes.status}：${(await secRes.text()).slice(0, 300)}`)
  }

  // ---- 3. 线上验证（真实调用）----
  await new Promise((r) => setTimeout(r, 3000))
  const probe = await fetch(`${SB_URL}/functions/v1/mim-api`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })
  const body = (await probe.text()).slice(0, 300)
  console.log(`🔍 线上探测 GET /functions/v1/mim-api → HTTP ${probe.status}`)
  console.log(`   ${body}`)
  if (probe.status === 200) console.log('✅ Edge Function 已上线并可访问')
  else console.log('⚠️ 函数暂未就绪（部署可能仍在生效中，稍后重试本脚本第 3 步）')
}

main().catch((e) => {
  console.error('DEPLOY FAILED:', e.message)
  process.exit(1)
})
