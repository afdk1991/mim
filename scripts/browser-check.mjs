/* 真实浏览器自动化：渲染站点并采集控制台/网络错误 + 截图。
   用法：BASE=http://localhost:5198 node scripts/browser-check.mjs [url...]
   默认检查本地预览服务（npm run build && npx vite preview --port 5198）的首页与商城页。 */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBrowser } from './lib/browser.mjs'

const EDGE = resolveBrowser()
const BASE = (process.env.BASE || 'http://localhost:5198').replace(/\/+$/, '')
const OUT = join(process.cwd(), 'browser-shots')
mkdirSync(OUT, { recursive: true })

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2).map((u, i) => ({ name: `target${i + 1}`, url: u }))
  : [
      { name: 'home', url: `${BASE}/#/feed` },
      { name: 'mall', url: `${BASE}/#/mall` },
    ]

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: false, // 接管真实浏览器：可见执行
  args: ['--start-maximized'],
})

const summary = []

for (const t of TARGETS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  const consoleErrors = []
  const pageErrors = []
  const badRequests = []
  const apiCalls = []

  page.on('console', (m) => {
    const txt = m.text()
    if (m.type() === 'error') consoleErrors.push(txt.slice(0, 300))
    if (/42703|does not exist|PGRST|permission denied|fetch failed/i.test(txt)) {
      apiCalls.push(`[console:${m.type()}] ${txt.slice(0, 250)}`)
    }
  })
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() >= 400) badRequests.push(`${r.status()} ${u.slice(0, 160)}`)
    if (/\/api\/(rest|auth|rpc|storage)/.test(u)) {
      apiCalls.push(`${r.status()} ${u.slice(0, 160)}`)
    }
  })
  page.on('requestfailed', (r) => {
    badRequests.push(`FAILED ${r.url().slice(0, 160)} ${r.failure()?.errorText ?? ''}`)
  })

  console.log(`\n=== [${t.name}] ${t.url} ===`)
  try {
    // 同源 hash 跳转不会触发导航事件，先清空文档避免 goto 挂死
    await page.goto('about:blank')
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(9000) // 等 SPA 挂载 + 云端数据往返

    const title = await page.title()
    const rootChildren = await page.evaluate(() => {
      const r = document.getElementById('root')
      return r ? r.children.length : -1
    })
    const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim())
    const shot = join(OUT, `${t.name}.png`)
    await page.screenshot({ path: shot, fullPage: false })

    console.log(`标题: ${title}`)
    console.log(`#root 子节点: ${rootChildren}`)
    console.log(`正文前 220 字: ${bodyText.slice(0, 220)}`)
    console.log(`截图: ${shot}`)
    console.log(`页面异常(pageerror): ${pageErrors.length ? pageErrors.join(' | ') : '无'}`)
    console.log(`控制台错误: ${consoleErrors.length ? consoleErrors.slice(0, 6).join(' | ') : '无'}`)
    const interestingBad = badRequests.filter(
      (x) => !/favicon|\.png|\.jpg|\.svg|\.woff/i.test(x),
    )
    console.log(`失败请求(非静态资源): ${interestingBad.length ? interestingBad.slice(0, 6).join(' | ') : '无'}`)
    console.log(`后端 /api 相关调用:\n  ${apiCalls.length ? apiCalls.slice(0, 10).join('\n  ') : '无'}`)

    summary.push({
      name: t.name,
      title,
      rootChildren,
      textLen: bodyText.length,
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
      badRequests: interestingBad.length,
      shot,
    })
  } catch (e) {
    console.log(`❌ 导航/渲染失败: ${String(e).slice(0, 300)}`)
    summary.push({ name: t.name, error: String(e).slice(0, 200) })
  }
  await ctx.close()
}

await browser.close()
console.log('\n=== 汇总 ===')
console.log(JSON.stringify(summary, null, 1))
