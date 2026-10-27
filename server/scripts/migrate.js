/* ============================================================================
 * 迁移执行器 —— node scripts/migrate.js
 *
 * 约定：db/migrations/*.sql 按文件名升序执行，全部语句幂等
 *      （create table if not exists / create index if not exists / on conflict），
 *      重复执行不会报错也不会重复写数据。已执行文件记录在 schema_migrations。
 * ========================================================================== */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from '../src/db.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, '..', 'db', 'migrations')

async function main() {
  await query(
    `create table if not exists schema_migrations (
       filename    text primary key,
       applied_at  timestamptz not null default now()
     )`,
  )

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  if (!files.length) {
    console.log(`[migrate] ${dir} 下没有迁移文件`)
    return
  }

  const done = new Set((await query('select filename from schema_migrations')).rows.map((r) => r.filename))

  for (const file of files) {
    if (done.has(file)) {
      console.log(`[migrate] 跳过（已应用） ${file}`)
      continue
    }
    const sql = await readFile(path.join(dir, file), 'utf8')
    process.stdout.write(`[migrate] 应用 ${file} … `)
    try {
      // pg 简单协议支持一次多条语句；每条迁移文件自带幂等保证
      await pool.query(sql)
      await query('insert into schema_migrations (filename) values ($1) on conflict do nothing', [file])
      console.log('完成')
    } catch (e) {
      console.log('失败')
      console.error(`  ↳ ${e.message}`)
      if (e.position) console.error(`  ↳ 位置 ${e.position}`)
      process.exitCode = 1
      throw e
    }
  }

  const applied = (await query('select filename from schema_migrations order by filename')).rows.map((r) => r.filename)
  console.log(`[migrate] 当前已应用 ${applied.length} 个迁移：${applied.join(', ')}`)
}

main()
  .catch(() => {
    process.exitCode = process.exitCode ?? 1
  })
  .finally(async () => {
    await pool.end()
  })
