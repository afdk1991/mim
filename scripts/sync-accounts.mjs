/**
 * Mim · CloudBase → Supabase 存量账号同步（账号桥，配套迁移 0003）
 *
 * 作用：把 CloudBase app_users 全量登记进 Supabase account_bridge：
 *   · 之后这些用户名在 Supabase 全局查重（username_taken RPC）中可见 ⇒ 防撞名
 *   · 老密码可在首次登录时经 Edge Function /auth/bridge-login 验 PBKDF2 自动落户
 *     （账号此前未在 Supabase 注册过时；已注册过则走原生登录，桥不会改动其密码）
 *
 * 幂等：username 为 account_bridge 主键，重复执行只补增量，不报错。
 *
 * 凭证（均需用户提供；本环境只有 anon key，无法代执行）：
 *   CLOUDBASE_SERVICE_KEY     CloudBase PG 网关 service_role Key（读 app_users）
 *                             （与云函数环境变量 MIM_SERVICE_KEY 同值）
 *   SUPABASE_SERVICE_ROLE_KEY Supabase service_role Key（写 account_bridge），或
 *   SUPABASE_DB_URL           Session pooler 连接串（替代 service_role 直连 PG）
 *
 * 用法：
 *   node scripts/sync-accounts.mjs            # dry-run：只打印将同步的账号（默认）
 *   node scripts/sync-accounts.mjs --apply    # 实际写入 Supabase
 */
import pg from 'pg'

const GW = (process.env.CLOUDBASE_GATEWAY_URL || 'https://cs-1-d5g815slocb5a611a.api.tcloudbasegateway.com').replace(/\/+$/, '')
const CB_KEY = process.env.CLOUDBASE_SERVICE_KEY || ''
const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://sepfobukokrrivwyvhnd.supabase.co').replace(/\/+$/, '')
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SB_DB_URL = process.env.SUPABASE_DB_URL || ''
const APPLY = process.argv.includes('--apply')

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/

function fail(message, hint) {
  console.error(`❌ ${message}`)
  if (hint) console.error(`   ${hint}`)
  process.exit(1)
}

if (!CB_KEY) {
  fail('缺少 CLOUDBASE_SERVICE_KEY（读 CloudBase app_users 用）。', '与云函数 mim-api 的环境变量 MIM_SERVICE_KEY 同值。')
}
if (!SB_SERVICE_KEY && !SB_DB_URL) {
  fail('缺少 SUPABASE_SERVICE_ROLE_KEY 或 SUPABASE_DB_URL（写 account_bridge 用）。', 'Dashboard → Project Settings → API / Database 获取。')
}

/** 读 CloudBase 全量账号（经 PG 网关 postgREST，service_role） */
async function readCloudbaseUsers() {
  const q = 'select=uid,username,password_hash,salt,name,emoji,created_at&order=created_at.asc'
  const r = await fetch(`${GW}/v1/rdb/rest/app_users?${q}`, {
    headers: { Authorization: `Bearer ${CB_KEY}`, apikey: CB_KEY },
  })
  const text = await r.text()
  if (r.status >= 400) fail(`读取 CloudBase app_users 失败（HTTP ${r.status}）`, text.slice(0, 300))
  const rows = JSON.parse(text)
  if (!Array.isArray(rows)) fail('CloudBase 返回异常', text.slice(0, 300))
  return rows
}

/** 写 Supabase account_bridge（service_role REST 或 PG 直连，二选一） */
async function writeBridge(users) {
  const rows = users.map((u) => ({
    username: u.username,
    cloudbase_uid: u.uid,
    password_hash: u.password_hash,
    salt: u.salt,
    source: 'import',
  }))

  if (SB_SERVICE_KEY) {
    const r = await fetch(`${SB_URL}/rest/v1/account_bridge`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    })
    const text = await r.text()
    if (r.status >= 400) fail(`写入 account_bridge 失败（HTTP ${r.status}）`, text.slice(0, 300))
    return
  }

  const client = new pg.Client({ connectionString: SB_DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('begin')
    for (const row of rows) {
      await client.query(
        `insert into public.account_bridge (username, cloudbase_uid, password_hash, salt, source)
         values ($1, $2, $3, $4, $5)
         on conflict (username) do nothing`,
        [row.username, row.cloudbase_uid, row.password_hash, row.salt, row.source],
      )
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => {})
    fail('写入 account_bridge 失败', err.message)
  } finally {
    await client.end()
  }
}

const users = await readCloudbaseUsers()
console.log(`\n=== CloudBase 账号（共 ${users.length} 个） ===`)
for (const u of users) {
  const flag = USERNAME_RE.test(u.username) ? '' : '  ⚠️ 用户名不合规，桥接登录会拒绝'
  console.log(`  ${u.username.padEnd(24)} uid=${u.uid}  ${String(u.created_at).slice(0, 19)}${flag}`)
}

if (!APPLY) {
  console.log('\n🔎 dry-run：以上账号将登记进 Supabase account_bridge（username 已存在的跳过）。')
  console.log('   确认无误后加 --apply 实际执行。')
  process.exit(0)
}

if (users.length === 0) {
  console.log('\n✅ 无账号需要同步。')
  process.exit(0)
}

console.log(`\n📤 写入 Supabase account_bridge（${users.length} 条，幂等）…`)
await writeBridge(users)
console.log('✅ 同步完成。这些用户名现已进入 Supabase 全局查重；')
console.log('   老用户在登录页输入原用户名 + 原密码即可自动落户（需 Edge Function mim-api 已部署且迁移 0003 已应用）。')
