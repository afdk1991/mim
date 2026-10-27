/**
 * CI 辅助脚本：将 package.json 临时改写为可发布到 GitHub Packages 的形态。
 * - 包名改为 @<owner>/mim（GitHub Packages npm 仓库要求 scope 等于仓库属主）
 * - private 置为 false，registry 指向 npm.pkg.github.com
 * - 声明发布内容仅包含 dist 与 README
 * 仅在发布工作流中运行，不会改动仓库内文件。
 *
 * 版本号来源（关键）：
 *   不直接使用 tag —— tag 是四段式（V0.0.0.0），而 npm 只接受三段 semver，
 *   直接取 tag 会得到非法版本 "0.0.0.0" 并导致 npm publish 报
 *   `Invalid version`（实测失败）。故此处从**唯一版本源** src/version.ts 的
 *   APP_VERSION 读取四段值，按项目派生规则取「第1.第2.第4段」得到三段版本，
 *   与 package.json / iOS / Tauri 完全同源，杜绝「tag 与包版本分裂」。
 *
 * 用法: node scripts/prepare-package.mjs <owner> [tag]
 *   tag 传入时做一致性校验：必须等于 V<APP_VERSION>（大小写 v 均可），
 *   不一致直接失败，避免「打了 tag 却发出别的版本号」。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const owner = process.argv[2]
const tag = process.argv[3] || ''
if (!owner) {
  console.error('用法: node scripts/prepare-package.mjs <owner> [tag]')
  process.exit(1)
}

// ---------- 1. 读取唯一版本源 ----------
const versionSrc = readFileSync(path.join(ROOT, 'src/version.ts'), 'utf8')
const vm = versionSrc.match(/export const APP_VERSION\s*=\s*'([^']+)'/)
if (!vm) {
  console.error('❌ 无法从 src/version.ts 解析 APP_VERSION（唯一版本源缺失）')
  process.exit(1)
}
const APP_VERSION = vm[1]
const seg = APP_VERSION.split('.')
if (seg.length !== 4) {
  console.error(`❌ APP_VERSION 必须为四段式，当前 ${seg.length} 段：${APP_VERSION}`)
  process.exit(1)
}

// ---------- 2. 派生三段式（第1.第2.第4段）----------
const THREE = `${seg[0]}.${seg[1]}.${seg[3]}`
if (!/^\d+\.\d+\.\d+$/.test(THREE)) {
  console.error(`❌ 派生出的三段版本非法：${THREE}`)
  process.exit(1)
}

// ---------- 3. tag 一致性校验（防「打 A 号发 B 版」）----------
if (tag) {
  const expected = [`V${APP_VERSION}`, `v${APP_VERSION}`]
  if (!expected.includes(tag)) {
    console.error(`❌ tag ${tag} 与唯一版本源不符：APP_VERSION=${APP_VERSION}，应为 ${expected[0]}`)
    process.exit(1)
  }
  console.log(`tag 校验通过: ${tag} → APP_VERSION ${APP_VERSION}`)
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

pkg.name = `@${owner}/${pkg.name}`
pkg.private = false
pkg.publishConfig = {
  registry: 'https://npm.pkg.github.com',
}
pkg.files = ['dist', 'README.md']
pkg.repository = {
  type: 'git',
  url: `https://github.com/${owner}/mim`,
}

// 版本由唯一源派生，不接受手动/外部注入
pkg.version = THREE

writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
console.log(`package.json 已准备发布: ${pkg.name}@${pkg.version}（派生自 APP_VERSION ${APP_VERSION}）`)
