/**
 * CI 辅助脚本：将 package.json 临时改写为可发布到 GitHub Packages 的形态。
 * - 包名改为 @<owner>/mim（GitHub Packages npm 仓库要求 scope 等于仓库属主）
 * - private 置为 false，registry 指向 npm.pkg.github.com
 * - 声明发布内容仅包含 dist 与 README
 * 仅在发布工作流中运行，不会改动仓库内文件。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const owner = process.argv[2]
if (!owner) {
  console.error('用法: node scripts/prepare-package.mjs <owner>')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

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

writeFileSync(new URL('../package.json', import.meta.url), JSON.stringify(pkg, null, 2) + '\n')
console.log(`package.json 已准备发布: ${pkg.name}`)
