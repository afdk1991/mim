/**
 * Mim · 测试账号清理脚本（Supabase 侧）
 *
 * 背景：本项目开发期在 Supabase 留下了冒烟/E2E 调试账号（smoke_ e2e_ dbg_ 等前缀），
 *       CloudBase 侧已清理完毕（见 sync/清理记录），此脚本清理 Supabase 主后端。
 *
 * 判定规则（命中任一即视为测试号）：
 *   1. user_metadata.username 或 email 前缀匹配：
 *      smoke_ e2e_ dbg_ diag_ rt_ st_ bridgetest_ test_
 *   2. profile.name 为默认值「新用户」——注册表单必填 username，真实用户 name=username，
 *      只有早期不传 username 的脚本注册才会落到默认名（可用 --no-default-name 关闭此规则）。
 *
 * 删除方式：删 auth.users 行（profiles 为 on delete cascade，级联清理；
 *      内容表 posts/messages/favorites 若存在同样级联——开发期均为 0 行）。
 *
 * 前置准备（二选一）：
 *   A. service_role key（最轻，无需数据库密码）：
 *      Dashboard → Project Settings → API Keys → service_role secret
 *      $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   B. 数据库连接串（Session pooler）：
 *      $env:SUPABASE_DB_URL="postgresql://postgres.<ref>:<密码>@aws-0-<区域>.pooler.supabase.com:5432/postgres"
 *
 * 用法：
 *   node scripts/purge-test-users.mjs            # dry-run：只列出将删账号
 *   node scripts/purge-test-users.mjs --apply    # 执行删除
 *   node scripts/purge-test-users.mjs --no-default-name   # 不按默认名判定（更保守）
 */
import pg from 'pg'

const SB_URL = process.env.VITE_SUPABASE_URL || 'https://sepfobukokrrivwyvhnd.supabase.co'
const SB_ANON = process.env.VITE_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const DB_URL = process.env.SUPABASE_DB_URL || ''
const APPLY = process.argv.includes('--apply')
const USE_DEFAULT_NAME = !process.argv.includes('--no-default-name')

const TEST_PREFIX = /^(smoke_|e2e_|dbg_|diag_|rt_|st_|bridgetest_|test_)/

/** 判定一个账号是否为测试号；返回 null 放行，或返回命中原因 */
function classify(user, profile) {
  const username = String(user.user_metadata?.username || '')
  const email = String(user.email || '')
  const name = String(profile?.name || '')
  if (TEST_PREFIX.test(username)) return `username 前缀：${username}`
  if (TEST_PREFIX.test(email)) return `email 前缀：${email}`
  if (USE_DEFAULT_NAME && name === '新用户') return '默认档案名（早期脚本注册）'
  return null
}

/** 模式 A：GoTrue Admin API（service_role key） */
async function listViaAdminApi() {
  const users = []
  let page = 1
  for (;;) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!r.ok) throw new Error(`admin/users 拉取失败：HTTP ${r.status} ${await r.text()}`)
    const body = await r.json()
    const batch = body.users || []
    users.push(...batch)
    if (batch.length < 200) break
    page++
  }
  // profiles（anon 可全读，用于默认名判定）
  let profiles = []
  if (USE_DEFAULT_NAME) {
    const pr = await fetch(`${SB_URL}/rest/v1/profiles?select=id,name`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
    })
    if (pr.ok) profiles = await pr.json()
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]))
  return users.map((u) => ({ user: u, profile: profileById.get(u.id) || null }))
}

/** 模式 B：数据库直连（DB URL） */
async function listViaDb() {
  const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: users } = await client.query(
      'select id, email, raw_user_meta_data from auth.users order by created_at',
    )
    const { rows: profiles } = await client.query('select id, name from public.profiles')
    const profileById = new Map(profiles.map((p) => [p.id, p]))
    return {
      users: users.map((r) => ({
        user: { id: r.id, email: r.email, user_metadata: r.raw_user_meta_data || {} },
        profile: profileById.get(r.id) || null,
      })),
      async deleteOne(id) {
        await client.query('delete from auth.users where id = $1', [id])
      },
      close: () => client.end(),
    }
  } catch (e) {
    await client.end().catch(() => {})
    throw e
  }
}

async function main() {
  if (!SERVICE_KEY && !DB_URL) {
    console.error('❌ 缺少凭据：请设置 SUPABASE_SERVICE_ROLE_KEY 或 SUPABASE_DB_URL。')
    console.error('   service_role key：Dashboard → Project Settings → API Keys → service_role secret')
    console.error('   DB URL：Dashboard → Project Settings → Database → Session pooler 连接串')
    process.exit(1)
  }

  let entries
  let deleteOne
  let close
  if (SERVICE_KEY) {
    entries = await listViaAdminApi()
    deleteOne = async (id) => {
      const r = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      })
      if (!r.ok && r.status !== 404) throw new Error(`删除 ${id} 失败：HTTP ${r.status} ${await r.text()}`)
    }
    close = () => {}
  } else {
    const via = await listViaDb()
    entries = via.users
    deleteOne = via.deleteOne
    close = via.close
  }

  const targets = []
  const keep = []
  for (const entry of entries) {
    const reason = classify(entry.user, entry.profile)
    if (reason) targets.push({ id: entry.user.id, email: entry.user.email, name: entry.profile?.name || '', reason })
    else keep.push(entry)
  }

  console.log(`\n账号总数：${entries.length}　判定测试号：${targets.length}　保留：${keep.length}\n`)
  for (const t of targets) {
    console.log(`  🗑️  ${t.id.slice(0, 8)}  ${t.email}  name=${t.name}  ← ${t.reason}`)
  }
  if (keep.length > 0) {
    console.log('\n保留账号：')
    for (const k of keep) console.log(`  ✅  ${k.user.id.slice(0, 8)}  ${k.user.email}  name=${k.profile?.name || ''}`)
  }

  if (!APPLY) {
    console.log('\n（dry-run）追加 --apply 参数执行删除。')
    close()
    return
  }
  if (targets.length === 0) {
    console.log('\n没有需要删除的账号。')
    close()
    return
  }

  console.log(`\n⏳ 删除 ${targets.length} 个测试账号…`)
  let ok = 0
  for (const t of targets) {
    try {
      await deleteOne(t.id)
      ok++
      console.log(`  ✅ 已删 ${t.id.slice(0, 8)} ${t.email}`)
    } catch (e) {
      console.error(`  ❌ ${t.id.slice(0, 8)} ${t.email}：${e.message}`)
    }
  }
  console.log(`\n完成：${ok}/${targets.length} 已删除（profiles 及内容表随 auth.users 级联清理）。`)
  close()
}

main().catch((e) => {
  console.error(`❌ ${e.message}`)
  process.exit(1)
})
