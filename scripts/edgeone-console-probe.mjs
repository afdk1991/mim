/**
 * EdgeOne 控制台探查（一次性诊断脚本）
 *
 * 背景：mim 的 EdgeOne Makers 项目（makers-euoglvyjyknd）Provider 为 'Github'，
 * CLI 直传被平台拒绝；需要控制台信息确认：真实域名 / GitHub 绑定 / 构建配置 /
 * 部署历史。本脚本用 Edge 持久化 profile 打开控制台，等待人工登录后自动探查。
 *
 * 运行：node scripts/edgeone-console-probe.mjs [--timeout-min 5]
 * 产物：.edgeone-console/*.png + *.txt（已 gitignore）
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.edgeone-console')
const PROFILE = path.join(OUT, 'edge-profile')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const CONSOLE = 'https://edgeone.cloud.tencent.com/'

const argIdx = process.argv.indexOf('--timeout-min')
const TIMEOUT_MIN = argIdx > -1 ? Number(process.argv[argIdx + 1]) || 5 : 5
const LOGIN_TIMEOUT_MS = TIMEOUT_MIN * 60 * 1000
const POLL_MS = 4000

fs.mkdirSync(OUT, { recursive: true })

const stamp = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${stamp()}] ${m}`)

async function dump(page, tag) {
  const png = path.join(OUT, `${tag}.png`)
  const txt = path.join(OUT, `${tag}.txt`)
  try {
    await page.screenshot({ path: png, fullPage: false })
    const text = await page.evaluate(() => document.body?.innerText || '')
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => `${a.innerText.trim().slice(0, 30)} -> ${a.href}`).slice(0, 60)
    )
    fs.writeFileSync(txt, `URL: ${page.url()}\n\n=== TEXT ===\n${text.slice(0, 6000)}\n\n=== LINKS ===\n${links.join('\n')}`, 'utf8')
    log(`已留存 ${tag}.png / ${tag}.txt（URL: ${page.url()}）`)
  } catch (e) {
    log(`dump ${tag} 失败: ${e.message}`)
  }
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EDGE,
    headless: false,
    viewport: { width: 1500, height: 950 },
    args: ['--start-maximized'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())

  log(`打开 EdgeOne 控制台：${CONSOLE}`)
  await page.goto(CONSOLE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('goto: ' + e.message))

  // —— 等待登录 ——
  const loginWall = async () => {
    const url = page.url()
    if (/login|signin|passport/i.test(url)) return true
    const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
    return /扫码登录|账号密码登录|登录腾讯云|请登录/.test(body)
  }
  const t0 = Date.now()
  let loggedIn = !(await loginWall())
  while (!loggedIn && Date.now() - t0 < LOGIN_TIMEOUT_MS) {
    const left = Math.round((LOGIN_TIMEOUT_MS - (Date.now() - t0)) / 1000)
    log(`等待登录…剩余 ${left}s（请在弹出浏览器中完成腾讯云登录）`)
    await page.waitForTimeout(POLL_MS)
    loggedIn = !(await loginWall())
  }
  if (!loggedIn) {
    log('登录超时，保存当前页面状态后退出')
    await dump(page, 'login-timeout')
    await ctx.close()
    process.exit(2)
  }
  log('已登录')
  await page.waitForTimeout(3000)
  await dump(page, '01-home')

  // —— 探查 Pages / Makers 项目列表 ——
  const candidates = [
    'https://console.cloud.tencent.com/makers/project/list',
    'https://console.cloud.tencent.com/makers',
    'https://console.cloud.tencent.com/edgeone/pages',
    'https://console.cloud.tencent.com/edgeone',
  ]
  for (const [i, url] of candidates.entries()) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(3500)
      const body = await page.evaluate(() => document.body?.innerText || '')
      if (/mim|makers|项目|Project/i.test(body)) {
        await dump(page, `0${i + 2}-pages-list`)
        const hit = body.includes('mim')
        log(`候选页命中 mim: ${hit}`)
        if (hit) {
          // 尝试点击 mim 项目进入详情
          const clicked = await page.evaluate(() => {
            const els = [...document.querySelectorAll('a,div,span,td,li')]
              .filter((el) => el.innerText && el.innerText.trim() === 'mim')
            if (els.length) { els[0].click(); return true }
            return false
          })
          if (clicked) {
            await page.waitForTimeout(3500)
            await dump(page, '04-mim-detail')
          }
          break
        }
      } else {
        log(`候选页无有效内容：${url}`)
      }
    } catch (e) {
      log(`候选页失败 ${url}: ${e.message}`)
    }
  }

  // —— 侧栏入口兜底：点可见的 Pages/Makers 菜单 ——
  try {
    const body = await page.evaluate(() => document.body?.innerText || '')
    if (!/mim/i.test(body)) {
      const menuClicked = await page.evaluate(() => {
        const els = [...document.querySelectorAll('a,div,span,li')]
          .filter((el) => /^(Pages|Makers|页面|极简建站)$/i.test((el.innerText || '').trim()))
        if (els.length) { els[0].click(); return els[0].innerText.trim() }
        return null
      })
      if (menuClicked) {
        log(`点击菜单：${menuClicked}`)
        await page.waitForTimeout(4000)
        await dump(page, '05-menu-pages')
        const hit = await page.evaluate(() => (document.body?.innerText || '').includes('mim'))
        if (hit) {
          const clicked = await page.evaluate(() => {
            const els = [...document.querySelectorAll('a,div,span,td,li')]
              .filter((el) => (el.innerText || '').trim() === 'mim')
            if (els.length) { els[0].click(); return true }
            return false
          })
          if (clicked) {
            await page.waitForTimeout(3500)
            await dump(page, '06-mim-detail')
          }
        }
      }
    }
  } catch (e) {
    log('菜单兜底失败: ' + e.message)
  }

  await dump(page, '99-final')
  log('探查完成，产物目录：' + OUT)
  await ctx.close()
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
