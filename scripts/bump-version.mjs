/**
 * 一键 bump 版本号（本地发版前置步骤，不 commit / 不 tag / 不 push）
 *
 * 用法：
 *   node scripts/bump-version.mjs                # patch：0.0.0 -> 0.0.1
 *   node scripts/bump-version.mjs --patch        # 同上（显式）
 *   node scripts/bump-version.mjs --minor        # 0.0.0 -> 0.1.0
 *   node scripts/bump-version.mjs --major        # 0.0.0 -> 1.0.0
 *   node scripts/bump-version.mjs --dry-run ... # 只打印将要改什么，不写盘
 *
 * 行为：
 *   1. 从 git tag（V<semver>，按 -v:refname 排序）读当前版本；若无 tag，回退读 src/core/version.ts
 *   2. 按 --patch/--minor/--major 算出新版本
 *   3. 用正则 / JSON.parse 精确替换 11 个版本载体；versionCode / CURRENT_PROJECT_VERSION 自动 +1
 *   4. 改完自动跑 node scripts/version-check.mjs，必须全 ✅
 *   5. 打印下一步手动发版命令（commit + tag + push）
 *
 * 不做的事：git commit / git tag / git push / 触发 release workflow
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const p = (rel) => path.join(ROOT, rel)
const read = (rel) => (existsSync(p(rel)) ? readFileSync(p(rel), 'utf8') : null)

// ---------- 参数解析 ----------
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
let bump = 'patch'
if (args.includes('--major')) bump = 'major'
else if (args.includes('--minor')) bump = 'minor'
else if (args.includes('--patch')) bump = 'patch'

// ---------- 1. 读当前版本：优先 git tag，回退到 version.ts ----------
function readCurrentVersionFromTag() {
  try {
    const out = execSync('git tag --sort=-v:refname', { cwd: ROOT }).toString()
    const tags = out.split('\n').map((s) => s.trim()).filter(Boolean)
    const vTags = tags.filter((t) => /^V\d+\.\d+\.\d+$/.test(t))
    if (vTags.length === 0) return null
    return vTags[0].slice(1) // 去掉前导 V
  } catch {
    return null
  }
}

function readCurrentVersionFromSource() {
  const src = read('src/core/version.ts')
  const m = src && src.match(/export const APP_VERSION\s*=\s*'([^']+)'/)
  return m ? m[1] : null
}

const current = readCurrentVersionFromTag() ?? readCurrentVersionFromSource()
if (!current) {
  console.error('❌ 无法确定当前版本号：git tag 与 src/core/version.ts 都读不到')
  process.exit(1)
}
const [maj, min, pat] = current.split('.').map((n) => Number(n))
if (![maj, min, pat].every(Number.isFinite)) {
  console.error(`❌ 当前版本号 "${current}" 不是三段 semver`)
  process.exit(1)
}

// ---------- 2. 算新版本 ----------
let next
if (bump === 'major') next = [maj + 1, 0, 0].join('.')
else if (bump === 'minor') next = [maj, min + 1, 0].join('.')
else next = [maj, min, pat + 1].join('.')

console.log(`当前版本：V${current}（来源：${readCurrentVersionFromTag() ? 'git tag' : 'src/core/version.ts'}）`)
console.log(`Bump 维度：--${bump}`)
console.log(`目标版本：V${next}${dryRun ? '   [DRY-RUN，不写盘]' : ''}\n`)

// ---------- 3. 构造替换计划 ----------
// 每一项：{ file, label, apply(original) -> newContent }
// 对于整数 build number，先读旧值 +1，再整体替换。
const gradleSrc = read('android/app/build.gradle')
const pbxSrc = read('ios/App/App.xcodeproj/project.pbxproj')
const appJson5Src = read('harmony/AppScope/app.json5')

const curAndroidCode = Number((gradleSrc || '').match(/versionCode\s+(\d+)/)?.[1] ?? NaN)
const curIosCode = Number((pbxSrc || '').match(/CURRENT_PROJECT_VERSION\s*=\s*(\d+)/)?.[1] ?? NaN)
const curHarmonyCode = Number((appJson5Src || '').match(/"versionCode"\s*:\s*(\d+)/)?.[1] ?? NaN)
if (![curAndroidCode, curIosCode, curHarmonyCode].every(Number.isFinite)) {
  console.error('❌ 无法解析当前 versionCode / CURRENT_PROJECT_VERSION，中止')
  process.exit(1)
}
const nextAndroidCode = curAndroidCode + 1
const nextIosCode = curIosCode + 1
const nextHarmonyCode = curHarmonyCode + 1

const plans = [
  {
    file: 'src/core/version.ts',
    label: `APP_VERSION '${current}' -> '${next}'`,
    apply: (t) => t.replace(/(export const APP_VERSION\s*=\s*')[^']+(')/, `$1${next}$2`),
  },
  {
    file: 'package.json',
    label: `version "${current}" -> "${next}"`,
    apply: (t) => {
      const j = JSON.parse(t)
      j.version = next
      return JSON.stringify(j, null, 2) + '\n'
    },
  },
  {
    file: 'src-tauri/tauri.conf.json',
    label: `version "${current}" -> "${next}"`,
    apply: (t) => {
      const j = JSON.parse(t)
      j.version = next
      return JSON.stringify(j, null, 2) + '\n'
    },
  },
  {
    file: 'src-tauri/Cargo.toml',
    label: `version = "${current}" -> "${next}"`,
    apply: (t) => t.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${next}"`),
  },
  {
    file: 'android/app/build.gradle',
    label: `versionCode ${curAndroidCode}->${nextAndroidCode}, versionName "${current}"->"${next}"`,
    apply: (t) =>
      t
        .replace(/versionCode\s+\d+/, `versionCode ${nextAndroidCode}`)
        .replace(/versionName\s+"[^"]+"/, `versionName "${next}"`),
  },
  {
    file: 'ios/App/App.xcodeproj/project.pbxproj',
    label: `MARKETING_VERSION=${current}->${next}, CURRENT_PROJECT_VERSION ${curIosCode}->${nextIosCode} (×2)`,
    apply: (t) =>
      t
        .replace(/MARKETING_VERSION\s*=\s*[^;]+;/g, `MARKETING_VERSION = ${next};`)
        .replace(/CURRENT_PROJECT_VERSION\s*=\s*\d+;/g, `CURRENT_PROJECT_VERSION = ${nextIosCode};`),
  },
  {
    file: 'harmony/AppScope/app.json5',
    label: `versionCode ${curHarmonyCode}->${nextHarmonyCode}, versionName "${current}"->"${next}"`,
    apply: (t) =>
      t
        .replace(/"versionCode"\s*:\s*\d+/, `"versionCode": ${nextHarmonyCode}`)
        .replace(/"versionName"\s*:\s*"[^"]+"/, `"versionName": "${next}"`),
  },
  {
    file: 'harmony/oh-package.json5',
    label: `version "${current}" -> "${next}"`,
    apply: (t) => t.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`),
  },
  {
    file: 'harmony/entry/oh-package.json5',
    label: `version "${current}" -> "${next}"`,
    apply: (t) => t.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`),
  },
  {
    file: 'worker/package.json',
    label: `version "${current}" -> "${next}"`,
    apply: (t) => {
      const j = JSON.parse(t)
      j.version = next
      return JSON.stringify(j, null, 2) + '\n'
    },
  },
  {
    file: 'worker/wrangler.jsonc',
    label: `APP_VERSION "${current}" -> "${next}"`,
    apply: (t) => t.replace(/("APP_VERSION"\s*:\s*)"[^"]+"/, `$1"${next}"`),
  },
]

// ---------- 4. 执行 ----------
for (const plan of plans) {
  const original = read(plan.file)
  if (original == null) {
    console.error(`❌ 文件不存在：${plan.file}`)
    process.exit(1)
  }
  const updated = plan.apply(original)
  if (updated === original) {
    console.error(`❌ 替换未命中：${plan.file}（${plan.label}）`)
    process.exit(1)
  }
  if (dryRun) {
    console.log(`  [dry-run] ${plan.file}`)
    console.log(`           ${plan.label}`)
  } else {
    writeFileSync(p(plan.file), updated, 'utf8')
    console.log(`  ✏️  ${plan.file}`)
    console.log(`      ${plan.label}`)
  }
}

if (dryRun) {
  console.log(`\n[dry-run] 未写盘。去掉 --dry-run 真跑一次。`)
  process.exit(0)
}

// ---------- 5. 跑 version-check ----------
// bump 本身不打 tag，所以「本地版本 tag」一行必然是 stale 的（V<旧> vs 期望 V<新>）。
// 这里只把「文件载体不一致」视为硬失败；tag 行不匹配属于预期，commit 后手动 tag 即闭环。
console.log('\n--- 运行 node scripts/version-check.mjs ---')
let checkOutput = ''
try {
  checkOutput = execFileSync(process.execPath, ['scripts/version-check.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
} catch (e) {
  checkOutput = typeof e.stdout === 'string' ? e.stdout : ''
}
console.log(checkOutput)

// 数逐行 ❌ 检查项（带"期望"字样的那行）；排除 tag 那一行
const failLines = checkOutput.split('\n').filter((l) => l.includes('❌') && l.includes('期望'))
const realFail = failLines.filter((l) => !l.includes('本地版本 tag'))
if (realFail.length > 0) {
  console.error(`\n❌ 版本载体文件不一致（${realFail.length} 处）：`)
  for (const l of realFail) console.error(`   ${l.trim()}`)
  process.exit(1)
}
if (failLines.length > 0) {
  console.log(`⚠️  本地 tag 仍指向旧版本（预期）——commit 后执行 git tag V${next} 即闭环`)
}

// ---------- 6. 打印下一步 ----------
console.log(`\n✅ 已 bump 到 V${next}（构建号：android=${nextAndroidCode} / harmony=${nextHarmonyCode} / ios=${nextIosCode}）`)
console.log(`下一步请手动执行：`)
console.log(`  git commit -am "chore: release v${next}" && git tag V${next} && git push --tags`)
