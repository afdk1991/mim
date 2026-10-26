// 跨平台浏览器可执行文件解析：本地 Windows 用系统 Edge，CI（Linux）用 runner 预装 Chrome
import { existsSync } from 'node:fs'

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

/** 解析可用的 Chromium 内核浏览器路径；优先取 MIM_BROWSER 环境变量 */
export function resolveBrowser() {
  const list = process.env.MIM_BROWSER ? [process.env.MIM_BROWSER, ...CANDIDATES] : CANDIDATES
  for (const p of list) {
    if (p && existsSync(p)) return p
  }
  throw new Error('未找到 Chromium 内核浏览器：请用 MIM_BROWSER 指向 msedge / chrome 可执行文件')
}
