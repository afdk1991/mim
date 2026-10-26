/**
 * Mim · 生成「一键补齐脚本」supabase/apply-all-manual.sql
 *
 * 用途：无需数据库密码 / 无需本地 SUPABASE_DB_URL，
 *       把本文件全文粘贴到 Supabase Dashboard → SQL Editor → Run 即可补齐线上全库。
 *
 * 生成内容（与 CI 云端通道同一迁移计划，顺序完全一致）：
 *   0000_schema.sql → 0001… 增量迁移
 * 因此手工执行与 push main 自动执行的结果一致，不会分叉。
 *
 * 用法：npm run db:gen-manual
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildMigrationPlan, describePlan } from './lib/migration-plan.mjs'

const OUT = fileURLToPath(new URL('../supabase/apply-all-manual.sql', import.meta.url))
const plan = buildMigrationPlan()

if (plan.length === 0) {
  console.error('❌ 未找到任何 SQL 迁移文件')
  process.exit(1)
}

const RULE = '='.repeat(78)
const stamp = new Date().toISOString()

const head = `\
-- ${RULE}
-- Mim · 一键补齐脚本（供 Supabase Dashboard → SQL Editor 粘贴执行）
-- 生成时间：${stamp}
-- 生成命令：npm run db:gen-manual（与本仓库 CI 迁移计划同源，顺序一致）
--
-- 用途：无需数据库密码 / 无需本地 SUPABASE_DB_URL，直接补齐线上缺失内容。
-- 内容：${describePlan(plan)}
--
-- 典型补齐项：
--   ① 基线 20 张业务表（posts / profiles / articles / snippets / topics / hot_searches …）
--   ② IAM 权限中心（roles / permissions / user_roles / role_permissions / audit_logs）
--   ③ 商城目录（products 商品模型字段；不含任何商品数据）
--   ④ 对象存储私有桶 mim-media（迁移 0002）
--   ⑤ 账号桥（account_bridge + username_taken / claim_username RPC，迁移 0003）
--
-- 执行方式（二选一）：
--   ① 推荐：Dashboard → SQL Editor → 粘贴本文件全部内容 → Run（无需密码）
--   ② 命令行：设好 SUPABASE_DB_URL 后 npm run db:apply
--
-- 幂等：全部使用 create table if not exists / add column if not exists /
--       insert ... on conflict do nothing，可重复执行，不会产生重复数据。
-- ${RULE}

-- 迁移跟踪表（与 CI 共用：手工执行过的版本，CI 下次会自动跳过）
create table if not exists public.schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now()
);

`

const parts = plan.map((entry) => {
  const body = readFileSync(entry.path, 'utf8').trim()
  const kindLabel = entry.kind === 'schema' ? '基线结构' : `迁移 ${entry.version}`
  return `-- ${RULE}\n-- ${kindLabel}\n-- ${RULE}\n\n${body}\n`
})

const tail = `
-- ${RULE}
-- 记录已应用版本（使 CI 后续自动跳过，避免重复执行）
-- ${RULE}

${plan
  .map((e) => `insert into public.schema_migrations (version) values ('${e.version}') on conflict (version) do nothing;`)
  .join('\n')}

-- ${RULE}
-- 执行后自检（四条均应有返回且不报错）：
--   select count(*) from public.roles;                                    -- 应 > 0（系统基础权限）
--   select count(*) from public.products where status = 'active';         -- 应 = 0（无演示商品）
--   select count(*) from public.topics;                                   -- 应 = 0（无演示话题）
--   select count(*) from public.hot_searches;                             -- 应 = 0（无演示热搜）
--   select public.username_taken('probe_name');                           -- 应 true/false，不再报 PGRST202
-- ${RULE}
`

writeFileSync(OUT, head + parts.join('\n') + tail, 'utf8')

const kb = (Buffer.byteLength(head + parts.join('\n') + tail, 'utf8') / 1024).toFixed(1)
console.log(`✅ 已生成 ${OUT}`)
console.log(`   包含 ${plan.length} 段：${describePlan(plan)}`)
console.log(`   体积 ${kb} KB`)
