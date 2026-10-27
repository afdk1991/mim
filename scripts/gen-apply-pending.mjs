/**
 * Mim · 生成「待补齐迁移」一键脚本 supabase/apply-pending-manual.sql
 *
 * 用途：线上库实测落后于仓库时（npm run db:probe 会报出缺失对象及所属迁移），
 *       只把「从某个版本起」的迁移拼成一个脚本，粘到 SQL Editor 执行即可补齐，
 *       无需重跑全量 apply-all-manual.sql。
 *
 * 与 db:gen-manual 同源：两者都走 lib/migration-plan.mjs，顺序与 CI 完全一致，
 *       不会与自动通道产生分叉。
 *
 * 用法：
 *   node scripts/gen-apply-pending.mjs            # 默认从 0008 起（线上实测缺口）
 *   node scripts/gen-apply-pending.mjs 0009       # 指定起始版本
 *   FROM=0010 node scripts/gen-apply-pending.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildMigrationPlan } from './lib/migration-plan.mjs'

const from = (process.argv[2] || process.env.FROM || '0008').trim()
const OUT = fileURLToPath(new URL('../supabase/apply-pending-manual.sql', import.meta.url))

const plan = buildMigrationPlan()
// version 形如 '0000_schema.sql' / '0008_mall.sql'；取前 4 位数字比较
const num = (v) => (v.match(/^(\d{4})/)?.[1] ?? '9999')
const picked = plan.filter((e) => Number(num(e.version)) >= Number(num(from)))

if (picked.length === 0) {
  console.error(`❌ 没有版本号 >= ${from} 的迁移，无需生成`)
  process.exit(1)
}

const RULE = '='.repeat(78)
const stamp = new Date().toISOString()

const head = `\
-- ${RULE}
-- Mim · 待补齐迁移一键脚本（供 Supabase Dashboard → SQL Editor 粘贴执行）
-- 生成时间：${stamp}
-- 生成命令：npm run db:gen-pending -- ${from}（与 CI 迁移计划同源，顺序一致）
--
-- 适用范围：线上库尚未应用「${from} 及之后」的迁移时补齐。当前包含：
${picked.map((e) => `--   · ${e.version}`).join('\n')}
--
-- 如何确认是否需要执行：
--   npm run db:probe
--   （只读探测，列出前端引用但线上缺失的表 / 函数及其所属迁移）
--
-- 执行方式：Dashboard → SQL Editor → 粘贴本文件全部内容 → Run（无需数据库密码）
--
-- 幂等：全部使用 create table if not exists / create or replace function /
--       add column if not exists / drop policy if exists + create policy，
--       可重复执行，不触碰既有数据。
-- ${RULE}

`

const parts = picked.map((entry) => {
  const body = readFileSync(entry.path, 'utf8').trim()
  return `-- ${RULE}\n-- ${entry.version}\n-- ${RULE}\n\n${body}\n`
})

const tail = `
-- ${RULE}
-- 记录已应用版本（使 CI 后续自动跳过，避免重复执行）
-- ${RULE}

${picked
  .map((e) => `insert into public.schema_migrations (version) values ('${e.version}') on conflict (version) do nothing;`)
  .join('\n')}

-- ${RULE}
-- 执行后自检（重跑 npm run db:probe 应全部 ✅）
-- ${RULE}
`

writeFileSync(OUT, head + parts.join('\n') + tail, 'utf8')

const kb = (Buffer.byteLength(head + parts.join('\n') + tail, 'utf8') / 1024).toFixed(1)
console.log(`✅ 已生成 ${OUT}`)
console.log(`   包含 ${picked.length} 段：${picked.map((e) => e.version).join(' → ')}`)
console.log(`   体积 ${kb} KB`)
