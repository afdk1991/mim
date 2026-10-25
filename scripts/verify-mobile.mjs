// 移动端视口实测：用 --window-size + setViewportSize 绕过 headless innerWidth 退化
import { chromium } from 'playwright-core'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = process.env.BASE || 'http://localhost:5198'
const W = Number(process.argv[2] || 390)
const H = Number(process.argv[3] || 844)
const ROUTES = [
  '#/feed', '#/articles', '#/write', '#/topics', '#/notifications', '#/messages',
  '#/my', '#/blog', '#/favorites', '#/history', '#/following', '#/publish',
  '#/wallet', '#/vip', '#/growth', '#/settings',
  '#/mall', '#/mall/cart', '#/mall/orders', '#/mall/wallet',
  '#/mall/youxuan', '#/mall/live', '#/mall/mix', '#/mall/gexm', '#/mall/laal',
  '#/admin', '#/admin/audit', '#/admin/roles',
  '#/ai', '#/ardot', '#/bom', '#/coze', '#/delivery', '#/live', '#/mail',
  '#/manju', '#/nav', '#/price', '#/resources', '#/snippets', '#/tags',
  '#/info/account-rules', '#/info/appeal', '#/info/disclaimer', '#/info/license',
  '#/info/publish-license',
]

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${W},${H}`],
})
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)

const vp = await page.evaluate(() => ({ iw: innerWidth, ih: innerHeight }))
console.log(`视口自检：innerWidth=${vp.iw} innerHeight=${vp.ih}（期望 ${W}×${H}）`)
const vpOk = vp.iw === W
console.log(vpOk ? '✅ 移动端视口生效' : '❌ 视口仍退化，后续结果不可信')

const rows = []
for (const r of ROUTES) {
  await page.goto(`${BASE}/${r}`, { waitUntil: 'domcontentloaded' })
  await page.setViewportSize({ width: W, height: H })
  await page.waitForTimeout(600)
  const m = await page.evaluate(() => ({
    iw: innerWidth,
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    len: (document.body.innerText || '').trim().length,
  }))
  // 横向溢出容忍 2px（滚动条/边框误差）
  const overflow = m.sw - m.cw
  const bad = m.iw !== W || overflow > 2
  rows.push({ r, ...m, overflow, bad })
  console.log(`${bad ? '🟠' : '✅'} ${r.padEnd(14)} innerWidth=${m.iw} 横向溢出=${overflow}px 正文=${m.len}`)
}

const fails = rows.filter((x) => x.bad)
console.log(`\n=== 汇总：${rows.length - fails.length}/${rows.length} 移动端视口正常 ===`)
if (fails.length) fails.forEach((f) => console.log(`  问题页 ${f.r}: innerWidth=${f.iw} 溢出=${f.overflow}px`))

await page.goto(`${BASE}/#/feed`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
await page.screenshot({ path: 'verify-shots/mobile-feed.png' })
await browser.close()
