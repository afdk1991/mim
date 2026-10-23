/**
 * Mim · 数据库迁移执行脚本（全量：按序应用 supabase/migrations/*.sql）
 *
 * 作用：把 supabase/migrations/ 目录下全部迁移按文件名顺序应用到 Supabase 数据库，
 *      已在 public.schema_migrations 记录的版本自动跳过（迁移本身亦为幂等 SQL，
 *      重复执行不会报错，跟踪表只是避免无谓重跑）。
 *      应用完成后可选地为指定账号授予 admin 角色（解锁「🛡️ 管理后台」入口）。
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
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url))

const dbUrl = process.env.SUPABASE_DB_URL
const adminEmail = process.env.ADMIN_EMAIL?.trim()

if (!dbUrl) {
  console.error('❌ 缺少 SUPABASE_DB_URL 环境变量。')
  console.error('   请到 Supabase Dashboard → Project Settings → Database → Connection string 复制 Session pooler 连接串。')
  process.exit(1)
}

// 按文件名排序（0001_… < 0002_…），保证迁移顺序
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (migrations.length === 0) {
  console.error(`❌ ${MIGRATIONS_DIR} 下没有 .sql 迁移文件`)
  process.exit(1)
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  console.log('🔌 连接数据库…')
  await client.connect()

  // 迁移跟踪表（幂等；与迁移内容解耦，仅记录「哪个版本已应用」）
  await client.query(
    `create table if not exists public.schema_migrations (
       version     text primary key,
       applied_at  timestamptz not null default now()
     )`,
  )

  const { rows: appliedRows } = await client.query('select version from public.schema_migrations')
  const applied = new Set(appliedRows.map((r) => r.version))

  let ran = 0
  let skipped = 0
  for (const name of migrations) {
    if (applied.has(name)) {
      console.log(`⏭️  ${name} 已应用，跳过`)
      skipped += 1
      continue
    }
    console.log(`📜 执行迁移 ${name} …`)
    const sql = readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8')
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into public.schema_migrations (version) values ($1) on conflict (version) do nothing', [name])
      await client.query('commit')
      ran += 1
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw new Error(`${name} 执行失败：${err.message}`)
    }
  }
  console.log(`✅ 迁移完成：新应用 ${ran} 个，跳过 ${skipped} 个（共 ${migrations.length} 个）`)

  // 迁移结果速览（0001 的 IAM 种子；表不存在时静默跳过）
  for (const [label, sql] of [
    ['角色', 'select name from public.roles order by name'],
    ['权限', 'select key from public.permissions order by key'],
  ]) {
    try {
      const { rows } = await client.query(sql)
      console.log(`   ${label}（${rows.length}）：${rows.map((r) => r.name ?? r.key).join(', ')}`)
    } catch {
      // 0001 未应用时无此表，忽略
    }
  }

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
