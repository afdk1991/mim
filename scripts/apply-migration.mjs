/**
 * Mim · 数据库迁移执行脚本（本地通道：pg 直连，全量）
 *
 * 作用：按统一迁移计划（scripts/lib/migration-plan.mjs）把全部 SQL 应用到 Supabase：
 *       0000_schema.sql（基线 20 张业务表）→ 0001… 增量迁移 → 9999_seed.sql（演示数据）。
 *       已在 public.schema_migrations 记录的版本自动跳过（迁移本身亦为幂等 SQL，
 *       重复执行不会报错，跟踪表只是避免无谓重跑）。
 *       应用完成后可选地为指定账号授予 admin 角色（解锁「🛡️ 管理后台」入口）。
 *
 * 修复记录（P1-1 根因）：早期版本只读 supabase/migrations/*.sql，
 *   漏掉目录外的 schema.sql 与 seed.sql，故本地执行同样无法补齐全库。
 *   现与云端通道共用同一计划，两条通道行为一致。
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
import { buildMigrationPlan, describePlan } from './lib/migration-plan.mjs'
import pg from 'pg'

const dbUrl = process.env.SUPABASE_DB_URL
const adminEmail = process.env.ADMIN_EMAIL?.trim()

if (!dbUrl) {
  console.error('❌ 缺少 SUPABASE_DB_URL 环境变量。')
  console.error('   请到 Supabase Dashboard → Project Settings → Database → Connection string 复制 Session pooler 连接串。')
  process.exit(1)
}

const plan = buildMigrationPlan()
if (plan.length === 0) {
  console.error('❌ 未找到任何 SQL 迁移文件')
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

  console.log(`📋 迁移计划：${describePlan(plan)}`)

  let ran = 0
  let skipped = 0
  for (const entry of plan) {
    if (applied.has(entry.version)) {
      console.log(`⏭️  ${entry.version} 已应用，跳过`)
      skipped += 1
      continue
    }
    console.log(`📜 执行 ${entry.version} …`)
    const sql = readFileSync(entry.path, 'utf8')
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query(
        'insert into public.schema_migrations (version) values ($1) on conflict (version) do nothing',
        [entry.version],
      )
      await client.query('commit')
      ran += 1
      console.log(`   ✅ ${entry.version} 完成`)
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw new Error(`${entry.version} 执行失败：${err.message}`)
    }
  }
  console.log(`✅ 迁移完成：新应用 ${ran} 个，跳过 ${skipped} 个（共 ${plan.length} 个）`)

  // 迁移结果速览（对应迁移未应用时静默跳过）
  for (const [label, sql] of [
    ['角色', 'select name from public.roles order by name'],
    ['权限', 'select key from public.permissions order by key'],
    ['商品', "select count(*)::int as n from public.products where status = 'active'"],
    ['超话', 'select count(*)::int as n from public.topics'],
    ['热搜', 'select count(*)::int as n from public.hot_searches'],
  ]) {
    try {
      const { rows } = await client.query(sql)
      const vals = rows.map((r) => r.name ?? r.key ?? r.n)
      console.log(`   ${label}（${vals.length}）：${vals.join(', ')}`)
    } catch {
      /* 未应用时无此表，忽略 */
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
