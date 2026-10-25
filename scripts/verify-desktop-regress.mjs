import { chromium } from 'playwright-core'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const b = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
let pass = 0, fail = 0
const check = (n, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++ }

await p.goto('http://localhost:5198/#/feed', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(700)
const sn = await p.evaluate(() => {
  const el = document.querySelector('.sidenav')
  const r = el.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height), dir: getComputedStyle(el).flexDirection }
})
check('桌面侧边栏仍为竖向 196px', sn.w === 196 && sn.dir === 'column', `w=${sn.w} dir=${sn.dir}`)

await p.goto('http://localhost:5198/#/ardot', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(800)
const ar = await p.evaluate(() => {
  const g = document.querySelector('.ardot-grid')
  const cards = [...document.querySelectorAll('.ardot-src')].slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().width))
  return { cols: getComputedStyle(g).gridTemplateColumns, cards, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth }
})
check('桌面 ardot 双列网格保持', ar.cols.split(' ').length === 2, `cols=${ar.cols}`)
check('桌面 ardot 卡片等宽且不溢出', ar.cards[0] === ar.cards[1] && ar.ovf === 0, `cards=${ar.cards} ovf=${ar.ovf}`)

await p.goto('http://localhost:5198/#/bom', { waitUntil: 'domcontentloaded' })
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

await p.goto('http://localhost:5198/#/notifications', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(600)
const nt = await p.evaluate(() => {
  const t = document.querySelector('.tabs')
  return { ovx: getComputedStyle(t).overflowX, tabs: document.querySelectorAll('.tabs .tab-btn').length, ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth }
})
check('桌面通知页 Tab 栏正常', nt.tabs >= 4 && nt.ovf === 0, `tabs=${nt.tabs} ovf=${nt.ovf}`)

console.log(`\n=== 桌面回归：${pass} 通过 / ${fail} 失败 ===`)
await b.close()
