import { cpSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 将 dist 构建产物同步到 HarmonyOS 壳工程的 rawfile（离线 WebView 资源）。
// 用法：npm run build && node scripts/sync-harmony.mjs
const src = 'dist'
const dest = 'harmony/entry/src/main/resources/rawfile'

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
