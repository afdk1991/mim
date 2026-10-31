#!/usr/bin/env node
/* 生成 Tauri updater 标准格式的 latest.json
   用法：node scripts/gen-tauri-updater-manifest.mjs <version> <tag> [assetsDir]
   assetsDir 中应包含 tauri build 产出的 *.sig 签名文件（与对应 updater 包同名去 .sig 后缀）。
   输出：latest.json 到当前工作目录，供 gh release upload 上传。

   Tauri v1 latest.json 规范见 https://tauri.app/v1/guides/distribution/updater：
   {
     "version": "1.0.0",
     "notes": "...",
     "pub_date": "ISO8601",
     "platforms": {
       "windows-x86_64":   { "signature": "<base64>", "url": "https://..." },
       "darwin-aarch64":   { "signature": "...", "url": "..." },
       "darwin-x86_64":    { ... },
       "linux-x86_64":     { ... }
     }
   }
*/

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [version, tag, assetsDir = '.'] = process.argv.slice(2)
if (!version || !tag) {
  console.error('用法: node scripts/gen-tauri-updater-manifest.mjs <version> <tag> [assetsDir]')
  process.exit(1)
}

const REPO = process.env.OTA_REPO || 'afdk1991/mim'

/**
 * 根据 Tauri 产物文件名推断 updater 平台 key。
 * tauri-action 上传的 updater 包命名约定（productName=Mim）：
 *   Windows NSIS :  Mim_<ver>_x64-setup.nsis.zip
 *   macOS ARM    :  Mim_<ver>_aarch64.app.tar.gz
 *   macOS Intel  :  Mim_<ver>_x64.app.tar.gz
 *   Linux AppImg :  Mim_<ver>_amd64.AppImage.tar.gz
 * 注意判断顺序：aarch64 必须先于通用 x64 判断，避免 macOS ARM 被误判。
 */
function detectPlatform(fileName) {
  const f = fileName.toLowerCase()
  if (f.includes('aarch64') || f.includes('arm64')) return 'darwin-aarch64'
  if (f.includes('x64-setup') || f.includes('nsis')) return 'windows-x86_64'
  if (f.includes('.app.tar.gz') || f.includes('darwin') || f.includes('.dmg')) return 'darwin-x86_64'
  if (f.includes('appimage') || f.includes('amd64') || f.includes('linux')) return 'linux-x86_64'
  return null
}

let entries = []
try {
  entries = readdirSync(assetsDir)
} catch (e) {
  console.error(`❌ 无法读取 assets 目录 ${assetsDir}: ${e.message}`)
  process.exit(1)
}

const sigFiles = entries.filter((f) => f.endsWith('.sig'))
if (sigFiles.length === 0) {
  console.error(`❌ 在 ${assetsDir} 下未找到任何 .sig 文件，无法生成 Tauri latest.json`)
  process.exit(1)
}

// 按平台聚合候选文件，同平台可能有多个（NSIS/MSI、Intel/ARM 分开），
// 选最匹配的一个作为该平台的 updater 包。
const byPlatform = {}
for (const sigFile of sigFiles) {
  const pkgName = sigFile.replace(/\.sig$/, '')
  const platform = detectPlatform(pkgName)
  if (!platform) {
    console.warn(`⚠️  无法识别平台，跳过: ${pkgName}`)
    continue
  }
  if (!byPlatform[platform]) byPlatform[platform] = []
  byPlatform[platform].push({ pkgName, sigFile })
  console.log(`  候选 [${platform}] ${pkgName}`)
}

const platforms = {}
for (const [platform, candidates] of Object.entries(byPlatform)) {
  let chosen = candidates[0]
  if (platform === 'windows-x86_64') {
    // Windows 同时有 NSIS 与 MSI updater 包时，优先 NSIS（tauri.conf.targets 首选）
    chosen = candidates.find((c) => c.pkgName.toLowerCase().includes('nsis')) || candidates[0]
  } else if (platform === 'darwin-x86_64' || platform === 'darwin-aarch64') {
    // macOS 优先 .app.tar.gz（updater 专用包），其次 .dmg
    chosen = candidates.find((c) => c.pkgName.toLowerCase().includes('.app.tar.gz')) || candidates[0]
  }
  const signature = readFileSync(join(assetsDir, chosen.sigFile), 'utf8').trim()
  platforms[platform] = {
    signature,
    url: `https://github.com/${REPO}/releases/download/${tag}/${chosen.pkgName}`,
  }
  console.log(`✅ ${platform} -> ${chosen.pkgName}`)
}

if (Object.keys(platforms).length === 0) {
  console.error('❌ 未能从任何 .sig 文件识别出 Tauri 平台')
  process.exit(1)
}

const latest = {
  version,
  notes: `Mim ${version} 更新发布`,
  pub_date: new Date().toISOString(),
  platforms,
}

writeFileSync('latest.json', JSON.stringify(latest, null, 2) + '\n')
console.log('\nlatest.json 已生成:')
console.log(JSON.stringify(latest, null, 2))
