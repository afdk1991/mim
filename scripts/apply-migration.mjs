/**
 * Mim · 数据库迁移执行脚本（Phase1 L1 IAM）
 *
 * 作用：把 supabase/migrations/0001_iam_phase1.sql 一次性应用到 Supabase 数据库，
 *      并可选地为指定账号授予 admin 角色（解锁「🛡️ 管理后台」入口）。
 *
 * 前置准备：
 *   1. Supabase Dashboard → Project Settings → Database → Connection string
 *      推荐复制「Session pooler」串（IPv4 兼容；Direct connection 走 IPv6，很多网络不通）
 *      形如：postgresql://postgres.<项目ref>:<数据库密码>@aws-0-<区域>.pooler.supabase.com:5432/postgres
 *   2. 数据库密码 = 创建项目时设置的 Database Password
 *
 * 用法（PowerShell）：
 *   $env:SUPABASE_DB_URL="postgresql://postgres.<ref>:<密码>@aws-0-<区域>.pooler.supabase.com:5432/postgres"
 *   $env:ADMIN_EMAIL="you@example.com"   # 可选：给该注册邮箱授予 admin 角色
 *   npm run db:apply
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATION = fileURLToPath(new URL('../supabase/migrations/0001_iam_phase1.sql', import.meta.url))

const dbUrl = process.env.SUPABASE_DB_URL
const adminEmail = process.env.ADMIN_EMAIL?.trim()

if (!dbUrl) {
  console.error('❌ 缺少 SUPABASE_DB_URL 环境变量。')
  console.error('   请到 Supabase Dashboard → Project Settings → Database → Connection string 复制 Session pooler 连接串。')
  process.exit(1)
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  console.log('🔌 连接数据库…')
  await client.connect()

  console.log('📜 执行迁移 0001_iam_phase1.sql …')
  const sql = readFileSync(MIGRATION, 'utf8')
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')
  console.log('✅ 迁移执行成功')

  // 迁移结果速览
  const { rows: roleRows } = await client.query('select name from public.roles order by name')
  const { rows: permRows } = await client.query('select key from public.permissions order by key')
  console.log(`   角色（${roleRows.length}）：${roleRows.map((r) => r.name).join(', ')}`)
  console.log(`   权限（${permRows.length}）：${permRows.map((r) => r.key).join(', ')}`)

  if (adminEmail) {
    console.log(`👑 为 ${adminEmail} 授予 admin 角色…`)
    const { rowCount } = await client.query(
      `insert into public.user_roles (user_id, role_id)
       select u.id, r.id from auth.users u, public.roles r
       where u.email = $1 and r.name = 'admin'
       on conflict do nothing`,
      [adminEmail],
    )
    if (rowCount === 0) {
      const { rows: u } = await client.query('select id from auth.users where email = $1', [adminEmail])
      if (u.length === 0) {
        console.warn(`   ⚠️ 未找到邮箱为 ${adminEmail} 的注册用户，请先在应用里注册该账号再重跑本步骤。`)
      } else {
        console.log('   该账号已是 admin，无需重复授予。')
      }
    } else {
      console.log('   ✅ 已授予 admin，刷新页面即可看到「🛡️ 管理后台」入口。')
    }
  } else {
    console.log('ℹ️ 如需授予 admin 角色，设置 ADMIN_EMAIL 环境变量后重跑本脚本即可。')
  }
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error('❌ 迁移失败，已回滚：', err.message)
  process.exit(1)
} finally {
  await client.end()
}
