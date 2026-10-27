/**
 * 版本号一致性校验（本地开发 / CI 通用）
 *
 * 唯一版本源：src/version.ts 的 APP_VERSION（四段式 major.minor.patch.build）
 * 派生规则  ：因 npm / iOS / Tauri 强制三段 semver，三段式载体取「第1.第2.第4段」
 *             V0.0.0.0 → 0.0.0   V0.0.0.1 → 0.0.1
 * 构建号     ：versionCode / CURRENT_PROJECT_VERSION 必须单调递增，不参与字面值比对
 *
 * 用法：
 *   node scripts/version-check.mjs                  # 校验工作区文件 + 本地 git tag
 *   node scripts/version-check.mjs --remote         # 追加校验远端 origin 的 tag（验证线上标签层）
 *   node scripts/version-check.mjs --tag V0.0.0.0   # 额外校验指定 tag 与版本源一致
 */
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const p = (rel) => path.join(ROOT, rel)

const read = (rel) => (existsSync(p(rel)) ? readFileSync(p(rel), 'utf8') : null)
const match1 = (txt, re) => {
  const m = txt && txt.match(re)
  return m ? m[1] : null
}

// ---------- 1. 读取唯一版本源 ----------
const versionSrc = read('src/version.ts')
const APP_VERSION = match1(versionSrc, /export const APP_VERSION\s*=\s*'([^']+)'/)
if (!APP_VERSION) {
  console.error('❌ 无法从 src/version.ts 解析 APP_VERSION（唯一版本源缺失）')
  process.exit(1)
}
const seg = APP_VERSION.split('.')
if (seg.length !== 4) {
  console.error(`❌ APP_VERSION 必须为四段式，当前为 ${seg.length} 段：${APP_VERSION}`)
  process.exit(1)
}
// 派生三段式：第1.第2.第4段
const THREE = `${seg[0]}.${seg[1]}.${seg[3]}`

// ---------- 2. 采集各载体实际值 ----------
const gradle = read('android/app/build.gradle')
const appJson5 = read('harmony/AppScope/app.json5')
const pkg = JSON.parse(read('package.json'))
const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'))
const cargo = read('src-tauri/Cargo.toml')
const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
const ohRoot = read('harmony/oh-package.json5')
const ohEntry = read('harmony/entry/oh-package.json5')

const checks = [
  // —— 四段式载体：必须与 APP_VERSION 字面一致 ——
  { layer: 'src/version.ts (唯一源)', expect: APP_VERSION, actual: APP_VERSION, kind: 'four' },
  { layer: 'android versionName', expect: APP_VERSION, actual: match1(gradle, /versionName\s+"([^"]+)"/), kind: 'four' },
  { layer: 'harmony versionName', expect: APP_VERSION, actual: match1(appJson5, /"versionName"\s*:\s*"([^"]+)"/), kind: 'four' },
  // —— 三段式载体：必须等于派生值 ——
  { layer: 'package.json', expect: THREE, actual: pkg.version, kind: 'three' },
  { layer: 'tauri.conf.json', expect: THREE, actual: tauriConf.version, kind: 'three' },
  { layer: 'src-tauri/Cargo.toml', expect: THREE, actual: match1(cargo, /^version\s*=\s*"([^"]+)"/m), kind: 'three' },
  { layer: 'iOS MARKETING_VERSION', expect: THREE, actual: match1(pbx, /MARKETING_VERSION\s*=\s*([^;]+);/), kind: 'three' },
  { layer: 'harmony oh-package.json5', expect: THREE, actual: match1(ohRoot, /"version"\s*:\s*"([^"]+)"/), kind: 'three' },
  { layer: 'harmony entry/oh-package.json5', expect: THREE, actual: match1(ohEntry, /"version"\s*:\s*"([^"]+)"/), kind: 'three' },
]

// ---------- 3. 校验 git tag（本地必查；--remote 追加远端）----------
const EXPECT_TAG = `V${APP_VERSION}`

const listLocalTags = () => {
  try {
    return execSync('git tag -l', { cwd: ROOT }).toString().split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const localTags = listLocalTags()
// 规范：仓库内只应存在唯一版本 tag，且等于 V<APP_VERSION>
checks.push({
  layer: '本地 git tag（唯一）',
  expect: EXPECT_TAG,
  actual: localTags.length === 0 ? '(无 tag)' : localTags.join(','),
  kind: 'four',
})

const wantRemote = process.argv.includes('--remote')
if (wantRemote) {
  let remoteTags = []
  try {
    remoteTags = execSync('git ls-remote --tags origin', { cwd: ROOT })
      .toString()
      .split('\n')
      .map((l) => l.split('refs/tags/')[1])
      .filter(Boolean)
      .filter((t) => !t.endsWith('^{}'))
  } catch {
    remoteTags = []
  }
  checks.push({
    layer: '远端 git tag（origin）',
    expect: EXPECT_TAG,
    actual: remoteTags.length === 0 ? '(无 tag)' : remoteTags.join(','),
    kind: 'four',
  })
}

const tagArg = process.argv.find((a) => a.startsWith('--tag='))?.split('=')[1]
  ?? (process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : null)
if (tagArg) {
  checks.push({ layer: `指定 tag (${tagArg})`, expect: EXPECT_TAG, actual: tagArg, kind: 'four' })
}

// ---------- 4. 输出与判定 ----------
console.log(`唯一版本源 APP_VERSION = ${APP_VERSION}  →  三段派生值 = ${THREE}\n`)
const pad = (s, n) => String(s).padEnd(n)
let bad = 0
for (const c of checks) {
  const ok = c.actual === c.expect
  if (!ok) bad++
  const flag = ok ? '✅' : '❌'
  console.log(`  ${flag} ${pad(c.layer, 30)} 期望 ${pad(c.expect, 12)} 实际 ${c.actual ?? '(解析失败)'}`)
}

// 构建号（只提示，要求单调递增）
const codes = {
  'android versionCode': match1(gradle, /versionCode\s+(\d+)/),
  'harmony versionCode': match1(appJson5, /"versionCode"\s*:\s*(\d+)/),
  'iOS CURRENT_PROJECT_VERSION': match1(pbx, /CURRENT_PROJECT_VERSION\s*=\s*(\d+)/),
}
console.log('\n构建号（需单调递增，不参与字面比对）：')
for (const [k, v] of Object.entries(codes)) console.log(`  ℹ️ ${pad(k, 30)} ${v ?? '(未解析)'}`)

// 当前 HEAD 与 tag 信息
try {
  const head = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  console.log(`\n当前 HEAD: ${head}`)
} catch {}

console.log(`\n${bad === 0 ? '✅ 全部版本载体一致' : `❌ ${bad} 处不一致`}`)
process.exit(bad === 0 ? 0 : 1)
