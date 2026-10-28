// 全站路由遍历实测：白屏 / JS 异常 / 渲染内容检测（仅本地验证，不入库）
import { chromium } from 'playwright-core'
import { resolveBrowser } from './lib/browser.mjs'

const EDGE = resolveBrowser()
const BASE = process.env.BASE || 'http://localhost:5198'

const ROUTES = [
  '#/feed', '#/articles', '#/write', '#/topics', '#/notifications', '#/messages',
  '#/videos', '#/ranks', '#/login', '#/search?q=%E6%B5%8B%E8%AF%95',
  '#/my', '#/blog', '#/favorites', '#/history', '#/following', '#/publish',
  '#/wallet', '#/vip', '#/growth', '#/settings',
  '#/mall', '#/mall/cart', '#/mall/orders', '#/mall/wallet',
  '#/mall/youxuan', '#/mall/live', '#/mall/mix', '#/mall/gexm', '#/mall/laal',
  /* 四大业务会场（#/mall/biz/<kind>）：与频道路由并存，需一并防白屏 */
  '#/mall/biz/seckill', '#/mall/biz/local', '#/mall/biz/live', '#/mall/biz/travel',
  '#/admin', '#/admin/products', '#/admin/recharge', '#/admin/audit', '#/admin/roles',
  '#/ai', '#/ardot', '#/bom', '#/coze', '#/delivery', '#/live', '#/mail',
  '#/manju', '#/nav', '#/price', '#/resources', '#/snippets', '#/tags',
  '#/info/about', '#/info/terms', '#/info/privacy', '#/info/account-rules',
  '#/info/appeal', '#/info/disclaimer', '#/info/license', '#/info/publish-license',
]

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const rows = []
for (const r of ROUTES) {
  const errs = []
  const onErr = (e) => errs.push(e.message)
  page.on('pageerror', onErr)
  let len = 0
  let hasShell = false
  try {
    await page.goto(`${BASE}/${r}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    const res = await page.evaluate(() => ({
      len: (document.body.innerText || '').trim().length,
      shell: !!document.querySelector('.app-shell, #root > *, .mim-shell'),
    }))
    len = res.len
    hasShell = res.shell
  } catch (e) {
    errs.push('nav: ' + e.message)
  }
  page.off('pageerror', onErr)

  // 白屏判定：正文过短且无 shell 容器
  const blank = len < 40 && !hasShell
  const bad = errs.length > 0
  rows.push({ route: r, len, shell: hasShell, errs: errs.slice(0, 1), blank, bad })
  const tag = blank ? '🔴白屏' : bad ? '🟠JS异常' : '✅'
  console.log(`${tag} ${r.padEnd(24)} len=${String(len).padStart(5)} shell=${hasShell ? 'Y' : 'N'}${errs.length ? ' | ' + errs[0].slice(0, 90) : ''}`)
}

const blanks = rows.filter((r) => r.blank).length
const bads = rows.filter((r) => r.bad).length
console.log(`\n=== 汇总：${ROUTES.length} 路由 | 白屏 ${blanks} | JS异常 ${bads} ===`)
if (bads) {
  console.log('\n--- JS 异常明细 ---')
  rows.filter((r) => r.bad).forEach((r) => console.log(`${r.route}: ${r.errs[0]}`))
}
await browser.close()
process.exit(blanks + bads > 0 ? 1 : 0)
