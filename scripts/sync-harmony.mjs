import { cpSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 将 dist 构建产物同步到 HarmonyOS 壳工程的 rawfile（离线 WebView 资源）。
// 用法：npm run build && node scripts/sync-harmony.mjs
// 路径一律相对本脚本所在目录，避免在其他工作目录运行时误拷。
const ROOT = dirname(fileURLToPath(import.meta.url))
const src = join(ROOT, '..', 'dist')
const dest = join(ROOT, '..', 'harmony/entry/src/main/resources/rawfile')

if (!existsSync(src)) {
  console.error('dist 不存在，请先执行 npm run build')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
// 保留 .gitkeep 使 rawfile 目录可被 git 追踪（目录内容本身已被 .gitignore 排除）
writeFileSync(join(dest, '.gitkeep'), '')
console.log(`已同步 ${src} → ${dest}`)
