/**
 * Mim · 数据库迁移执行脚本（云端通道：Supabase Management API）
 *
 * 与 scripts/apply-migration.mjs（本地通道：pg 直连）的区别：
 *   - 本地通道：需要「数据库密码」拼进连接串（postgresql://postgres.<ref>:<密码>@…）
 *   - 云端通道：只需 Supabase「Access Token」+「Project Ref」，不接触数据库密码，
 *     因此可安全用于 GitHub Actions —— 本地电脑上不必再执行任何迁移命令。
 *
 * 行为：按文件名顺序应用 supabase/migrations/*.sql；
 *       已在 public.schema_migrations 记录的版本自动跳过；
 *       迁移本身均为幂等 SQL，重复执行安全。
 *       可选：设置 ADMIN_EMAIL 为指定注册邮箱授予 admin 角色（解锁「🛡️ 管理后台」）。
 *
 * 所需 GitHub Secrets（仓库 Settings → Secrets and variables → Actions）：
 *   SUPABASE_ACCESS_TOKEN   Supabase 账号 Access Token
 *                           （生成入口：supabase.com/dashboard/account/tokens）
 *   SUPABASE_PROJECT_REF    项目 Reference ID（本项目：sepfobukokrrivwyvhnd）
 *   ADMIN_EMAIL（可选）     需要授予 admin 角色的注册邮箱
 *
 * 用法（CI 自动执行，等价于本地：npm run db:apply:remote）：
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/apply-migration-remote.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url))

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim()
const adminEmail = process.env.ADMIN_EMAIL?.trim()

if (!token || !projectRef) {
  // 跳过而非失败：未配置凭证不应阻塞构建与部署（与 deploy-function 等作业同策略）
  console.log('ℹ️ 未配置 SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF，跳过云端数据库迁移。')
  console.log('   配置方式：仓库 Settings → Secrets and variables → Actions → New repository secret')
  console.log('   配好后下次 push main 即自动应用迁移，无需在本机执行任何命令。')
  process.exit(0)
}

const ENDPOINT = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

/**
 * 通过 Management API 执行 SQL。
 * 返回结果行数组（查询类）；DDL/DML 通常返回空数组。
 */
async function runSql(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 400)}`)
  }
  return res.json()
}

try {
  console.log(`🔌 通过 Management API 连接项目 ${projectRef} …`)

  // 迁移跟踪表（幂等；与迁移内容解耦，仅记录「哪个版本已应用」）
  await runSql(
    `create table if not exists public.schema_migrations (
       version     text primary key,
       applied_at  timestamptz not null default now()
     )`,
  )

  const appliedRows = await runSql('select version from public.schema_migrations')
  const applied = new Set((appliedRows ?? []).map((r) => r.version))

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (migrations.length === 0) {
    console.log(`ℹ️ ${MIGRATIONS_DIR} 下没有 .sql 迁移文件，无需执行。`)
    process.exit(0)
  }

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
    await runSql(sql)
    await runSql(
      `insert into public.schema_migrations (version) values ('${name}') on conflict (version) do nothing`,
    )
    ran += 1
    console.log(`   ✅ ${name} 完成`)
  }
  console.log(`✅ 迁移完成：新应用 ${ran} 个，跳过 ${skipped} 个（共 ${migrations.length} 个）`)

  // 迁移结果速览（表不存在时静默跳过）
  for (const [label, query] of [
    ['角色', 'select name from public.roles order by name'],
    ['权限', 'select key from public.permissions order by key'],
    ['存储桶', 'select id from storage.buckets order by id'],
  ]) {
    try {
      const rows = await runSql(query)
      const vals = (rows ?? []).map((r) => r.name ?? r.key ?? r.id)
      console.log(`   ${label}（${vals.length}）：${vals.join(', ')}`)
    } catch {
      /* 对应迁移未应用或无权限读取，忽略 */
    }
  }

  if (adminEmail) {
    console.log(`👑 为 ${adminEmail} 授予 admin 角色…`)
    const rows = await runSql(
      `with ins as (
         insert into public.user_roles (user_id, role_id)
         select u.id, r.id from auth.users u, public.roles r
         where u.email = '${adminEmail}' and r.name = 'admin'
         on conflict do nothing
         returning user_id
       )
       select count(*)::int as n from ins`,
    )
    const n = rows?.[0]?.n ?? 0
    if (n > 0) {
      console.log('   ✅ 已授予 admin，刷新页面即可看到「🛡️ 管理后台」入口。')
    } else {
      const u = await runSql(`select id from auth.users where email = '${adminEmail}'`)
      if (!u || u.length === 0) {
        console.warn(`   ⚠️ 未找到邮箱为 ${adminEmail} 的注册用户，请先在应用里注册该账号再重跑。`)
      } else {
        console.log('   该账号已是 admin，无需重复授予。')
      }
    }
  } else {
    console.log('ℹ️ 如需授予 admin 角色，配置 ADMIN_EMAIL secret 后下次 push 自动生效。')
  }
} catch (err) {
  console.error('❌ 云端迁移失败：', err.message)
  process.exit(1)
}
