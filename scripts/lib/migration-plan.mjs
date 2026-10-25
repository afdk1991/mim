/**
 * Mim · 迁移计划（全量，本地/云端两条通道共用）
 *
 * 背景（P1-1 根因）：
 *   早期 apply-migration*.mjs 只读 supabase/migrations/*.sql，
 *   而 supabase/schema.sql（20 张业务表基线）与 supabase/seed.sql（演示数据）
 *   都位于 migrations/ 目录之外，从未被纳入自动化流水线 ——
 *   导致线上库只执行过手工粘贴的 schema.sql，
 *   0001/0003/seed 全部处于「从未应用」状态（roles 等表 404、热搜为空）。
 *
 * 本模块把三类 SQL 收敛为单一有序计划，供两条通道共用：
 *   0000_schema.sql  ← supabase/schema.sql     （基线：业务表 + RLS，必须最先）
 *   0001…00NN_*.sql  ← supabase/migrations/*   （增量迁移，按文件名排序）
 *   9999_seed.sql    ← supabase/seed.sql       （演示数据，最后灌入）
 *
 * 排序由 version 字符串决定（0000 < 0001… < 9999），故顺序恒为
 * 「基线 → 增量 → 数据」，且三者独立可缺失（缺文件则跳过，不报错）。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** supabase/ 目录绝对路径 */
const SUPABASE_DIR = fileURLToPath(new URL('../../supabase', import.meta.url))
const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations')

/**
 * 构建全量迁移计划。
 * @returns {Array<{ version: string, path: string, kind: 'schema'|'migration'|'seed' }>}
 */
export function buildMigrationPlan() {
  const plan = []

  const schemaPath = join(SUPABASE_DIR, 'schema.sql')
  if (existsSync(schemaPath)) {
    plan.push({ version: '0000_schema.sql', path: schemaPath, kind: 'schema' })
  }

  if (existsSync(MIGRATIONS_DIR)) {
    for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      plan.push({ version: name, path: join(MIGRATIONS_DIR, name), kind: 'migration' })
    }
  }

  const seedPath = join(SUPABASE_DIR, 'seed.sql')
  if (existsSync(seedPath)) {
    plan.push({ version: '9999_seed.sql', path: seedPath, kind: 'seed' })
  }

  // 以 version 字符串定序：0000_schema → 0001… → 9999_seed
  plan.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
  return plan
}

/** 计划的人类可读摘要（供脚本打印与自检） */
export function describePlan(plan) {
  return plan.map((e) => e.version).join(' → ')
}
