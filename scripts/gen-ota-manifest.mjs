#!/usr/bin/env node
/* 生成 Android OTA 清单 manifest.json（简化协议：{version, android:{url, sha256}}）
   用法：node scripts/gen-ota-manifest.mjs <version> <apkPath> <tag> [repo]
   例： node scripts/gen-ota-manifest.mjs 0.0.0.0 android/app/build/outputs/apk/release/app-release.apk V0.0.0.0
   输出文件中的 url 与 Release 附件文件名必须一致（app-release.apk）
   repo 默认 afdk1991/mim，可通过第 4 参数或环境变量 OTA_REPO 覆盖（换仓库后不用改脚本）。 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const [version, apkPath, tag, repoArg] = process.argv.slice(2)
if (!version || !apkPath || !tag) {
  console.error('用法: node scripts/gen-ota-manifest.mjs <version> <apkPath> <tag> [repo]')
  process.exit(1)
}
const REPO = repoArg || process.env.OTA_REPO || 'afdk1991/mim'

const sha256 = createHash('sha256').update(readFileSync(apkPath)).digest('hex')

const apkUrl = `https://github.com/${REPO}/releases/download/${tag}/app-release.apk`

const manifest = {
  version,
  // 顶层 url 兼容 src/ota.ts 的 WebView manifest 流程（读 data.url）；
  // 嵌套 android.url/android.sha256 供原生 MimOta 插件 downloadAndInstall 使用。
  url: apkUrl,
  android: {
    url: apkUrl,
    sha256,
  },
}

writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log('manifest.json 已生成:', JSON.stringify(manifest, null, 2))
