/**
 * Mim · 数据库迁移执行脚本（云端通道：Supabase Management API）
 *
 * 与 scripts/apply-migration.mjs（本地通道：pg 直连）的区别：
 *   - 本地通道：需要「数据库密码」拼进连接串（postgresql://postgres.<ref>:<密码>@…）
 *   - 云端通道：只需 Supabase「Access Token」+「Project Ref」，不接触数据库密码，
 *     因此可安全用于 GitHub Actions —— 本地电脑上不必再执行任何迁移命令。
 *
 * 行为：按统一迁移计划（scripts/lib/migration-plan.mjs）顺序应用
 *       0000_schema.sql（基线 20 张业务表）→ 0001… 增量迁移；
 *       已在 public.schema_migrations 记录的版本自动跳过；
 *       SQL 本身均为幂等写法，重复执行安全。
 *       可选：设置 ADMIN_EMAIL 为指定注册邮箱授予 admin 角色（解锁「🛡️ 管理后台」）。
 *
 * 修复记录（P1-1 根因）：早期版本只读 supabase/migrations/*.sql，
 *   漏掉目录外的 schema.sql，导致线上 0001/0003 从未应用
 *   （roles 等表 404、username_taken RPC 不存在、热搜/话题为空）。
 *   现改为统一计划，push main 一次即可把全库补齐到位。
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
import { readFileSync } from 'node:fs'
import { buildMigrationPlan, describePlan } from './lib/migration-plan.mjs'

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

/** Management API 只接受整段 SQL 文本，无法参数化；
 *  故对环境变量值做白名单校验，杜绝注入。 */
const EMAIL_RE = /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]+$/

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

  const plan = buildMigrationPlan()

  if (plan.length === 0) {
    console.log('ℹ️ 未找到任何 SQL 迁移文件，无需执行。')
    process.exit(0)
  }
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
    // 整文件一次性提交：Postgres 对多语句简单查询按单一隐式事务执行，
    // 任一语句失败即整体回滚，避免迁移半途中断留下不一致结构
    await runSql(sql)
    await runSql(
      `insert into public.schema_migrations (version) values ('${entry.version}') on conflict (version) do nothing`,
    )
    ran += 1
    console.log(`   ✅ ${entry.version} 完成`)
  }
  console.log(`✅ 迁移完成：新应用 ${ran} 个，跳过 ${skipped} 个（共 ${plan.length} 个）`)

  // 迁移结果速览（表不存在时静默跳过，便于 CI 日志一眼核对补齐结果）
  for (const [label, query] of [
    ['角色', 'select name from public.roles order by name'],
    ['权限', 'select key from public.permissions order by key'],
    ['商品', "select count(*)::int as n from public.products where status = 'active'"],
    ['超话', 'select count(*)::int as n from public.topics'],
    ['热搜', 'select count(*)::int as n from public.hot_searches'],
    ['存储桶', 'select id from storage.buckets order by id'],
  ]) {
    try {
      const rows = await runSql(query)
      const vals = (rows ?? []).map((r) => r.name ?? r.key ?? r.id ?? r.n)
      console.log(`   ${label}（${vals.length}）：${vals.join(', ')}`)
    } catch {
      /* 对应迁移未应用或无权限读取，忽略 */
    }
  }

  if (adminEmail) {
    if (!EMAIL_RE.test(adminEmail)) {
      console.warn(`   ⚠️ ADMIN_EMAIL 格式不合法，已跳过授权：${adminEmail}`)
    } else {
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
    }
  } else {
    console.log('ℹ️ 如需授予 admin 角色，配置 ADMIN_EMAIL secret 后下次 push 自动生效。')
  }
} catch (err) {
  console.error('❌ 云端迁移失败：', err.message)
  process.exit(1)
}
