#!/usr/bin/env node
/* 生成 Android OTA 清单 manifest.json（简化协议：{version, android:{url, sha256}}）
   用法：node scripts/gen-ota-manifest.mjs <version> <apkPath> <tag>
   例： node scripts/gen-ota-manifest.mjs 0.0.0.0 android/app/build/outputs/apk/release/app-release.apk V0.0.0.0
   输出文件中的 url 与 Release 附件文件名必须一致（app-release.apk） */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const [version, apkPath, tag] = process.argv.slice(2)
if (!version || !apkPath || !tag) {
  console.error('用法: node scripts/gen-ota-manifest.mjs <version> <apkPath> <tag>')
  process.exit(1)
}

const sha256 = createHash('sha256').update(readFileSync(apkPath)).digest('hex')

const manifest = {
  version,
  android: {
    url: `https://github.com/afdk1991/mim/releases/download/${tag}/app-release.apk`,
    sha256,
  },
}

writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log('manifest.json 已生成:', JSON.stringify(manifest, null, 2))
