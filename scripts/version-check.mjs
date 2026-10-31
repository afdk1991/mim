/**
 * 版本号一致性校验（本地开发 / CI 通用）
 *
 * 唯一版本源：src/core/version.ts 的 APP_VERSION（三段式 semver major.minor.patch）
 * 所有载体统一使用同一三段版本号，git tag 形如 V0.0.0。
 * 构建号（versionCode / CURRENT_PROJECT_VERSION）需单调递增，不参与字面值比对。
 *
 * 用法：
 *   node scripts/version-check.mjs                  # 校验工作区文件 + 本地 git tag
 *   node scripts/version-check.mjs --remote          # 追加校验远端 origin 的 tag
 *   node scripts/version-check.mjs --tag V0.0.0     # 额外校验指定 tag 与版本源一致
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
const versionSrc = read('src/core/version.ts')
const APP_VERSION = match1(versionSrc, /export const APP_VERSION\s*=\s*'([^']+)'/)
if (!APP_VERSION) {
  console.error('❌ 无法从 src/core/version.ts 解析 APP_VERSION（唯一版本源缺失）')
  process.exit(1)
}
const seg = APP_VERSION.split('.')
if (seg.length !== 3) {
  console.error(`❌ APP_VERSION 必须为三段式 semver，当前为 ${seg.length} 段：${APP_VERSION}`)
  process.exit(1)
}

// ---------- 2. 采集各载体实际值（全部三段，必须等于 APP_VERSION）----------
const gradle = read('android/app/build.gradle')
const appJson5 = read('harmony/AppScope/app.json5')
const pkg = JSON.parse(read('package.json'))
const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'))
const cargo = read('src-tauri/Cargo.toml')
const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
const ohRoot = read('harmony/oh-package.json5')
const ohEntry = read('harmony/entry/oh-package.json5')
const workerPkg = JSON.parse(read('worker/package.json'))
const workerWrangler = read('worker/wrangler.jsonc')

const checks = [
  { layer: 'src/core/version.ts (唯一源)', expect: APP_VERSION, actual: APP_VERSION },
  { layer: 'package.json', expect: APP_VERSION, actual: pkg.version },
  { layer: 'tauri.conf.json', expect: APP_VERSION, actual: tauriConf.version },
  { layer: 'src-tauri/Cargo.toml', expect: APP_VERSION, actual: match1(cargo, /^version\s*=\s*"([^"]+)"/m) },
  { layer: 'android versionName', expect: APP_VERSION, actual: match1(gradle, /versionName\s+"([^"]+)"/) },
  { layer: 'iOS MARKETING_VERSION', expect: APP_VERSION, actual: match1(pbx, /MARKETING_VERSION\s*=\s*([^;]+);/) },
  { layer: 'harmony versionName', expect: APP_VERSION, actual: match1(appJson5, /"versionName"\s*:\s*"([^"]+)"/) },
  { layer: 'harmony oh-package.json5', expect: APP_VERSION, actual: match1(ohRoot, /"version"\s*:\s*"([^"]+)"/) },
  { layer: 'harmony entry/oh-package.json5', expect: APP_VERSION, actual: match1(ohEntry, /"version"\s*:\s*"([^"]+)"/) },
  { layer: 'worker/package.json', expect: APP_VERSION, actual: workerPkg.version },
  { layer: 'worker wrangler APP_VERSION', expect: APP_VERSION, actual: match1(workerWrangler, /"APP_VERSION"\s*:\s*"([^"]+)"/) },
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
// 仓库内允许存在非版本形态的辅助 tag（如回滚锚点 pre-rebuild-*）。
// 只对「V 三段式」版本 tag 做唯一性校验；其余形态列出为 info。
const VERSION_TAG_RE = /^V\d+\.\d+\.\d+$/
const versionTags = localTags.filter((t) => VERSION_TAG_RE.test(t))
const otherTags = localTags.filter((t) => !VERSION_TAG_RE.test(t))
checks.push({
  layer: '本地版本 tag（V 三段式，唯一）',
  expect: EXPECT_TAG,
  actual: versionTags.length === 0 ? '(无)' : versionTags.join(','),
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
  const remoteVersionTags = remoteTags.filter((t) => VERSION_TAG_RE.test(t))
  const remoteOtherTags = remoteTags.filter((t) => !VERSION_TAG_RE.test(t))
  checks.push({
    layer: '远端版本 tag（V 三段式）',
    expect: EXPECT_TAG,
    actual: remoteVersionTags.length === 0 ? '(无)' : remoteVersionTags.join(','),
  })
  if (remoteOtherTags.length) {
    console.log(`  ℹ️ 远端辅助 tag（不参与判定）：${remoteOtherTags.join(', ')}`)
  }
}

const tagArg = process.argv.find((a) => a.startsWith('--tag='))?.split('=')[1]
  ?? (process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : null)
if (tagArg) {
  checks.push({ layer: `指定 tag (${tagArg})`, expect: EXPECT_TAG, actual: tagArg })
}

// ---------- 4. 输出与判定 ----------
console.log(`唯一版本源 APP_VERSION = ${APP_VERSION}\n`)
if (otherTags.length) {
  console.log(`  ℹ️ 本地辅助 tag（回滚/快照锚点，不参与判定）：${otherTags.join(', ')}`)
}
const pad = (s, n) => String(s).padEnd(n)
let bad = 0
for (const c of checks) {
  const ok = c.actual === c.expect
  if (!ok) bad++
  const flag = ok ? '✅' : '❌'
  console.log(`  ${flag} ${pad(c.layer, 30)} 期望 ${pad(c.expect, 10)} 实际 ${c.actual ?? '(解析失败)'}`)
}

// 构建号（只提示，要求单调递增）
const codes = {
  'android versionCode': match1(gradle, /versionCode\s+(\d+)/),
  'harmony versionCode': match1(appJson5, /"versionCode"\s*:\s*(\d+)/),
  'iOS CURRENT_PROJECT_VERSION': match1(pbx, /CURRENT_PROJECT_VERSION\s*=\s*(\d+)/),
}
console.log('\n构建号（需单调递增，不参与字面比对）：')
for (const [k, v] of Object.entries(codes)) console.log(`  ℹ️ ${pad(k, 30)} ${v ?? '(未解析)'}`)

try {
  const head = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  console.log(`\n当前 HEAD: ${head}`)
} catch {}

console.log(`\n${bad === 0 ? '✅ 全部版本载体一致' : `❌ ${bad} 处不一致`}`)
process.exit(bad === 0 ? 0 : 1)
