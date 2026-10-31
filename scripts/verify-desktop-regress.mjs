import { chromium } from 'playwright-core'
import { resolveBrowser } from './lib/browser.mjs'

// SD-006：支持 BASE 环境变量（与 verify-routes/verify-mobile 等兄弟脚本一致），
// 换端口/换主机时不用改脚本。
const BASE = process.env.BASE || 'http://localhost:5198'

const EDGE = resolveBrowser()
const b = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
let pass = 0, fail = 0
const check = (n, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++ }

// 整段包 try/finally：页面结构变动导致 evaluate 抛错时，也保证浏览器进程被关闭、不残留。
try {
  await p.goto(`${BASE}/#/feed`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(700)
  const sn = await p.evaluate(() => {
    const el = document.querySelector('.sidenav')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), dir: getComputedStyle(el).flexDirection }
  })
  check('桌面侧边栏仍为竖向 196px', !!sn && sn.w === 196 && sn.dir === 'column', sn ? `w=${sn.w} dir=${sn.dir}` : '缺 .sidenav 元素')

  await p.goto(`${BASE}/#/ardot`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(800)
  const ar = await p.evaluate(() => {
    const g = document.querySelector('.ardot-grid')
    if (!g) return null
    const cards = [...document.querySelectorAll('.ardot-src')].slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().width))
    return { cols: getComputedStyle(g).gridTemplateColumns, cards, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  check('桌面 ardot 双列网格保持', !!ar && ar.cols.split(' ').length === 2, ar ? `cols=${ar.cols}` : '缺 .ardot-grid 元素')
  check('桌面 ardot 卡片等宽且不溢出', !!ar && ar.cards.length === 2 && ar.cards[0] === ar.cards[1] && ar.ovf === 0, ar ? `cards=${ar.cards} ovf=${ar.ovf}` : 'N/A')

  await p.goto(`${BASE}/#/bom`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(800)
  const bm = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.bom-table')]
    const wrap = [...document.querySelectorAll('.bom-scroll')]
    return {
      tables: t.length, wraps: wrap.length,
      widths: t.map((e) => Math.round(e.getBoundingClientRect().width)),
      wrapW: wrap.map((e) => Math.round(e.getBoundingClientRect().width)),
      rows: t.reduce((s, e) => s + e.querySelectorAll('tbody tr').length, 0),
      ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  check('桌面 BOM 三表格齐全且有滚动包裹', bm.tables === 3 && bm.wraps === 3, `tables=${bm.tables} wraps=${bm.wraps}`)
  check('桌面 BOM 表格撑满且内容完整', bm.widths.every((w) => w === bm.wrapW[0]) && bm.rows > 20, `w=${bm.widths} rows=${bm.rows}`)
  check('桌面 BOM 无溢出', bm.ovf === 0, `ovf=${bm.ovf}`)

  await p.goto(`${BASE}/#/notifications`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(600)
  const nt = await p.evaluate(() => {
    const t = document.querySelector('.tabs')
    if (!t) return { tabs: 0, ovf: 999 }
    return { ovx: getComputedStyle(t).overflowX, tabs: document.querySelectorAll('.tabs .tab-btn').length, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  check('桌面通知页 Tab 栏正常', nt.tabs >= 4 && nt.ovf === 0, `tabs=${nt.tabs} ovf=${nt.ovf}`)
} catch (e) {
  console.error('❌ 脚本执行异常（页面结构或浏览器问题）：', e.message)
  fail++
} finally {
  await b.close()
}

console.log(`\n=== 桌面回归：${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail > 0 ? 1 : 0)
