#!/usr/bin/env node
/**
 * SQL 静态体检（不依赖 Docker / psql）
 *
 * 检查项：
 *   🔴 dollar-quote 不配对          → 迁移会直接语法错误
 *   🔴 裸 SET（非 SET LOCAL）        → 事务连接池下跨请求残留，导致串号越权
 *   🔴 public 表未启用 RLS           → 数据对 API 裸奔
 *   🟡 security definer 未固定 search_path → 有函数劫持风险
 *   🟡 grant ... to public           → 权限扩散
 *   🟡 文件结尾缺少分号
 *
 * 用法：node scripts/check-sql.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = [
  { dir: path.join(ROOT, 'db', 'init'), label: 'init' },
  { dir: path.join(ROOT, 'db', 'migrations'), label: 'migration' },
]

const RED = '🔴'
const YELLOW = '🟡'
const GREEN = '✅'

const findings = []
const add = (severity, file, rule, detail) =>
  findings.push({ severity, file, rule, detail })

function stripComments(sql) {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
}

/** 移除所有 dollar-quoted 段（$$ ... $$ / $tag$ ... $tag$），用于扫描“裸 SET” */
function stripDollarQuoted(sql) {
  return sql.replace(/(\$[A-Za-z_]*\$)([\s\S]*?)\1/g, ' $1$1 ')
}

/** dollar-quote 配对检查 */
function checkDollarBalance(sql, file) {
  const stack = []
  const re = /(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/g
  let m
  while ((m = re.exec(sql)) !== null) {
    const tag = m[1]
    if (stack.length && stack[stack.length - 1] === tag) stack.pop()
    else stack.push(tag)
  }
  if (stack.length) {
    add(RED, file, 'dollar-quote 不配对', `残留未闭合标记：${stack.join(', ')}`)
  }
}

function checkBareSet(sql, file) {
  const outside = stripDollarQuoted(stripComments(sql))
  const re = /^[ \t]*set\s+(?!local\b)(?!search_path\b)(?!statement_timeout\b)([a-z_]+)/gim
  let m
  while ((m = re.exec(outside)) !== null) {
    add(RED, file, '裸 SET（应为 SET LOCAL）', `set ${m[1]} —— 事务池下会跨请求残留`)
  }
}

function checkRls(sql, file) {
  const tables = []
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi
  let m
  while ((m = re.exec(sql)) !== null) tables.push(m[1])

  for (const t of tables) {
    const rlsRe = new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${t}\\s+enable\\s+row\\s+level\\s+security`,
      'i'
    )
    if (!rlsRe.test(sql)) {
      add(RED, file, 'public 表未启用 RLS', `public.${t}`)
    }
  }
}

function checkDefiner(sql, file) {
  // 注释里出现的 "security definer" 不算数，先去掉行注释
  const code = stripComments(sql)
  const definer = (code.match(/security\s+definer/gi) || []).length
  const searchPath = (code.match(/set\s+search_path/gi) || []).length
  if (definer > searchPath) {
    add(YELLOW, file, 'security definer 未固定 search_path', `definer=${definer} search_path=${searchPath}`)
  }
}

function checkGrantPublic(sql, file) {
  const re = /grant\s+[^;]*\bto\s+public\b/gi
  let m
  while ((m = re.exec(sql)) !== null) {
    add(YELLOW, file, 'grant ... to public', m[0].replace(/\s+/g, ' ').slice(0, 80))
  }
}

function checkTrailingSemicolon(sql, file) {
  const lines = stripComments(sql)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1] || ''
  if (!/[;]$/.test(last) && !/\$\$$/.test(last)) {
    add(YELLOW, file, '文件结尾疑似缺少分号', `最后一行：${last.slice(0, 60)}`)
  }
}

let fileCount = 0
for (const { dir, label } of SOURCES) {
  if (!existsSync(dir)) continue
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    fileCount++
    const abs = path.join(dir, f)
    const sql = readFileSync(abs, 'utf8')
    const rel = `${label}/${f}`
    checkDollarBalance(stripComments(sql), rel)
    checkBareSet(sql, rel)
    checkRls(sql, rel)
    checkDefiner(sql, rel)
    checkGrantPublic(sql, rel)
    checkTrailingSemicolon(sql, rel)
  }
}

// ---------------- 输出 ----------------
console.log(`SQL 静态体检：共 ${fileCount} 个文件\n`)

if (findings.length === 0) {
  console.log(`${GREEN} 全部通过：无 🔴 / 🟡 问题`)
  process.exit(0)
}

const order = { [RED]: 0, [YELLOW]: 1 }
findings.sort((a, b) => order[a.severity] - order[b.severity])

for (const f of findings) {
  console.log(`${f.severity} ${f.file.padEnd(38)} ${f.rule.padEnd(30)} ${f.detail}`)
}

const reds = findings.filter((f) => f.severity === RED).length
const yellows = findings.length - reds
console.log(`\n合计：🔴 ${reds} 项（阻断）/ 🟡 ${yellows} 项（提示）`)
process.exit(reds > 0 ? 1 : 0)
