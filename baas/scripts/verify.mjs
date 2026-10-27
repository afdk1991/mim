#!/usr/bin/env node
/**
 * 一键体检入口（离线可跑）：
 *   node scripts/verify.mjs
 *
 * 覆盖：
 *   1. shell 脚本语法（bash -n）
 *   2. SQL 静态体检（check-sql.mjs）
 *   3. 编排一致性：compose 服务 ↔ Envoy cluster/路由、${VAR} 是否都在 .env.example 里
 *   4. 迁移编号连续性与命名
 *   5. Edge Functions 类型检查 + 路由注册完整性
 *
 * 注：运行时探测另见 scripts/healthcheck.mjs（需栈已启动）。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const add = (ok, section, detail, level = 'fail') =>
  results.push({ ok, section, detail, level })

/** 移除 dollar-quoted 段，避免把函数体里的文本当作顶层语句扫描 */
const stripDollarQuoted = (sql) => sql.replace(/(\$[A-Za-z_]*\$)([\s\S]*?)\1/g, ' $1$1 ')

const run = (cmd, args, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

// ---------------------------------------------------------------- 1. shell
{
  const dir = path.join(ROOT, 'scripts')
  const shFiles = readdirSync(dir).filter((f) => f.endsWith('.sh'))
  for (const f of shFiles) {
    const r = run('bash', ['-n', path.join(dir, f)])
    add(r.code === 0, `bash -n ${f}`, r.out || '语法正确')
  }
}

// ---------------------------------------------------------------- 2. SQL
{
  const r = run('node', [path.join(ROOT, 'scripts', 'check-sql.mjs')])
  add(r.code === 0, 'SQL 静态体检', r.out.split('\n').slice(-1)[0] || r.out)
}

// ------------------------------------------------------- 3. 编排一致性
const compose = readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8')
const envoy = readFileSync(path.join(ROOT, 'envoy', 'envoy.yaml'), 'utf8')
const envExample = readFileSync(path.join(ROOT, '.env.example'), 'utf8')

// 3.1 不能有 Tab（YAML 硬性要求）
{
  const yamls = [
    ['docker-compose.yml', compose],
    ['envoy/envoy.yaml', envoy],
    ['docker-compose.hardened.yml', readFileSync(path.join(ROOT, 'docker-compose.hardened.yml'), 'utf8')],
    ['metrics/prometheus.yml', readFileSync(path.join(ROOT, 'metrics', 'prometheus.yml'), 'utf8')],
    ['metrics/alert.rules.yml', readFileSync(path.join(ROOT, 'metrics', 'alert.rules.yml'), 'utf8')],
    ['metrics/pg_exporter.queries.yml', readFileSync(path.join(ROOT, 'metrics', 'pg_exporter.queries.yml'), 'utf8')],
  ]
  const bad = []
  for (const [name, text] of yamls) {
    if (/^\s*[\w"-]+:.*\t/.test(text) || /\t/.test(text)) bad.push(name)
  }
  add(bad.length === 0, 'YAML 无 Tab 缩进', bad.length ? `含 Tab：${bad.join(', ')}` : 'ok')
}

// 3.2 提取 compose 服务名
const services = (() => {
  const lines = compose.split('\n')
  const out = []
  let inServices = false
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue }
    if (!inServices) continue
    if (/^\S/.test(line)) break
    const m = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/)
    if (m) out.push(m[1])
  }
  return out
})()
{
  const need = ['db', 'auth', 'rest', 'realtime', 'storage', 'meta', 'functions', 'envoy']
  const missing = need.filter((n) => !services.includes(n))
  add(missing.length === 0, 'compose 必备服务齐全',
    missing.length ? `缺失：${missing.join(', ')}` : services.join(', '))
}

// 3.3 Envoy cluster ↔ compose 服务
const clusters = (() => {
  // 只取 clusters: 段下的条目，避免把 listeners 段的 - name 也算进来
  const lines = envoy.split('\n')
  const out = []
  let inClusters = false
  for (const line of lines) {
    if (/^ {2}clusters:\s*$/.test(line)) { inClusters = true; continue }
    if (!inClusters) continue
    if (/^ {2}\S/.test(line)) break
    const m = line.match(/^ {4}- name: ([a-zA-Z0-9_-]+)$/)
    if (m) out.push(m[1])
  }
  return out
})()
{
  const unknown = clusters.filter((c) => !services.includes(c))
  add(unknown.length === 0, 'Envoy cluster 均对应 compose 服务',
    unknown.length ? `未知 cluster：${unknown.join(', ')}` : clusters.join(', '))
}

// 3.4 Envoy 路由前缀齐全
const prefixes = [...envoy.matchAll(/match:\s*\{\s*prefix:\s*"([^"]+)"\s*\}/g)].map((m) => m[1])
{
  const need = ['/auth/v1', '/rest/v1', '/graphql/v1', '/realtime/v1', '/storage/v1', '/functions/v1']
  const missing = need.filter((n) => !prefixes.includes(n))
  add(missing.length === 0, 'Envoy 七类路由齐全',
    missing.length ? `缺失：${missing.join(', ')}` : prefixes.join(' '))
}

// 3.5 ${VAR} 必须在 .env.example 中定义
{
  const used = new Set(
    [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}/g)].map((m) => m[1])
  )
  const defined = new Set(
    [...envExample.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1])
  )
  const missing = [...used].filter((v) => !defined.has(v))
  add(missing.length === 0, 'compose 引用的变量都在 .env.example',
    missing.length ? `未定义：${missing.join(', ')}` : `${used.size} 个变量全部有定义`)
}

// 3.6 migrate.sh 依赖的 /db 挂载
{
  const ok = /-\s*\.\/db:\/db:ro/.test(compose)
  add(ok, 'compose 挂载 ./db:/db（迁移脚本依赖）', ok ? 'ok' : '缺少 - ./db:/db:ro')
}

// ------------------------------------------------------- 4. 迁移编号
{
  const files = readdirSync(path.join(ROOT, 'db', 'migrations'))
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
  const nums = files.map((f) => parseInt(f.slice(0, 4), 10))
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i)
  const contiguous = nums.every((n, i) => n === i + 1)
  const badName = readdirSync(path.join(ROOT, 'db', 'migrations'))
    .filter((f) => f.endsWith('.sql') && !/^\d{4}_.+\.sql$/.test(f))
  add(dup.length === 0 && contiguous && badName.length === 0,
    '迁移编号连续且命名规范',
    `${files.length} 个：${files.join(', ')}${dup.length ? ` 重复：${dup}` : ''}${badName.length ? ` 命名不合规：${badName}` : ''}`)
}

// ------------------------------------------------------- 5. Edge Functions
{
  const fnRoot = path.join(ROOT, 'functions')
  const dirs = readdirSync(fnRoot).filter((d) => statSync(path.join(fnRoot, d)).isDirectory())
  const fns = dirs.filter((d) => d !== '_shared' && d !== 'main')
  const missingEntry = fns.filter((d) => !existsSync(path.join(fnRoot, d, 'index.ts')))
  add(missingEntry.length === 0, '每个函数都有 index.ts',
    missingEntry.length ? `缺失：${missingEntry.join(', ')}` : fns.join(', '))

  const main = readFileSync(path.join(fnRoot, 'main', 'index.ts'), 'utf8')
  // 以 import 路径判定注册（对象字面量用简写，不能靠引号匹配）
  const notRouted = fns.filter((d) => !main.includes(`../${d}/index.ts`))
  add(notRouted.length === 0, '函数均已注册到 main 路由',
    notRouted.length ? `未注册：${notRouted.join(', ')}` : `${fns.length} 个函数已注册`)

  // 类型检查
  const require = createRequire(path.join(ROOT, 'package.json'))
  let tscPath
  try {
    tscPath = require.resolve('typescript/bin/tsc')
  } catch {
    tscPath = null
  }
  if (!tscPath) {
    add(false, 'functions 类型检查', '未找到 typescript，跳过（在仓库根 npm i 后重试）', 'warn')
  } else {
    const r = run('node', [tscPath, '-p', 'functions/tsconfig.json', '--noEmit'])
    add(r.code === 0, 'functions 类型检查', r.out || '0 error')
  }
}

// ------------------------------------------- 6. 连接池 / 可观测 / 加固 / CI
{
  // 6.1 事务池安全：迁移里不能出现 LISTEN / NOTIFY（事务模式下会失效）
  const sqlAll = readdirSync(path.join(ROOT, 'db', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(ROOT, 'db', 'migrations', f), 'utf8'))
    .map((s) => stripDollarQuoted(s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')))
    .join('\n')
  const usesListen = /\b(LISTEN|NOTIFY)\s+/i.test(sqlAll)
  add(!usesListen, '迁移未使用 LISTEN/NOTIFY',
    usesListen ? '事务连接池下 LISTEN 会失效，Realtime 必须走逻辑复制' : 'Realtime 走逻辑复制，不依赖 LISTEN')

  // 6.2 连接池模式
  const envFile = path.join(ROOT, '.env')
  const src = existsSync(envFile) ? readFileSync(envFile, 'utf8') : envExample
  const pm = src.match(/^POOL_MODE=([^#\r\n]*)/m)
  const mode = pm ? pm[1].trim() : '(未设置，默认直连)'
  add(true, '连接池模式', `POOL_MODE=${mode}`)

  // 6.3 新增产物文件齐全
  const must = [
    'metrics/prometheus.yml',
    'metrics/alert.rules.yml',
    'metrics/pg_exporter.queries.yml',
    'docker-compose.hardened.yml',
    'docs/edge-isolation.md',
    'docs/implementation-plan.md',
  ]
  const missingFiles = must.filter((f) => !existsSync(path.join(ROOT, f)))
  add(missingFiles.length === 0, '可观测/加固/文档产物齐全',
    missingFiles.length ? `缺失：${missingFiles.join(', ')}` : `${must.length} 个文件就位`)

  // 6.4 compose 挂载的宿主机路径必须真实存在
  // ./volumes/* 由 Docker 自动创建，不要求仓库中存在
  const mounts = [...compose.matchAll(/-\s+(\.\/[^\s:]+):/g)]
    .map((m) => m[1])
    .filter((p) => !p.startsWith('./volumes/'))
  const badMount = mounts.filter((p) => !existsSync(path.resolve(ROOT, p)))
  add(badMount.length === 0, 'compose 挂载路径均存在',
    badMount.length ? `缺失：${badMount.join(', ')}` : mounts.join(', '))

  // 6.5 CI 流水线
  const wf = path.resolve(ROOT, '..', '.github', 'workflows', 'baas.yml')
  const wfOk = existsSync(wf) && readFileSync(wf, 'utf8').includes('scripts/verify.mjs')
  add(wfOk, 'CI 流水线已接入 verify.mjs',
    wfOk ? '.github/workflows/baas.yml' : '缺少 .github/workflows/baas.yml 或未调用 verify.mjs')
}

// ---------------------------------------------------------------- 输出
console.log('BaaS 一键体检（离线）\n')
for (const r of results) {
  const mark = r.ok ? '✅' : r.level === 'warn' ? '🟡' : '🔴'
  console.log(`${mark} ${r.section.padEnd(34)} ${r.detail}`)
}
const fails = results.filter((r) => !r.ok && r.level !== 'warn').length
const warns = results.filter((r) => !r.ok && r.level === 'warn').length
console.log(`\n合计：${results.length - fails - warns} 通过 / 🔴 ${fails} 失败 / 🟡 ${warns} 提示`)
process.exit(fails > 0 ? 1 : 0)
