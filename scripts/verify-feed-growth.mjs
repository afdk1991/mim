// 微博信息流 + 成长页回归实测（确定性：离线可跑，只需本地 preview 构建产物）
//
// 背景：本脚本此前随工作区丢失过一次，导致 `npm run verify:feed` 长期指向不存在的文件。
// 按 package.json / .gitignore 的「确定性回归基线入库」策略，本脚本已放行入库，
// 避免第三次丢失。
//
// 空态基线（seed 演示内容已彻底删除，STORAGE_KEY 升为 mim-state-v3）：
// 所有访客一律从全空态起步——信息流 0 卡片 + 空态提示，Tab 栏与发布框等
// 功能骨架仍在；成长页走本地累积引擎，不依赖内容数据，断言保持不变。
//
// 用法：npm run verify:feed
//       BASE=http://localhost:5199 npm run verify:feed
import { chromium } from 'playwright-core'
import { resolveBrowser } from './lib/browser.mjs'

const EDGE = resolveBrowser()
const BASE = process.env.BASE || 'http://localhost:5198'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const dismissWelcome = async () => {
  // 欢迎弹窗会拦截点击并在截图里遮挡主体，断言前必须关掉
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /同意|进入|不再提示|开始使用/.test(b.textContent || ''),
      )
      btn?.click()
    })
    await page.waitForTimeout(350)
  }
}

// ---------- 1. 信息流（默认「关注」Tab）：全空基线 ----------
await page.goto(`${BASE}/#/feed`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await dismissWelcome()

const feed = await page.evaluate(() => {
  const empty = document.querySelector('.empty')
  return {
    cards: document.querySelectorAll('.post-card').length,
    articleCards: document.querySelectorAll('.rf-article-card').length,
    pinTags: document.querySelectorAll('.wt-pin-tag').length,
    views: document.querySelectorAll('.pa-views').length,
    tabs: document.querySelectorAll('.rf-feed-tabs .tab-btn').length,
    compose: !!document.querySelector('.compose-tools'),
    empty: !!empty,
    emptyText: (empty?.textContent || '').trim(),
  }
})
check('信息流零卡片（无演示内容残留）', feed.cards === 0, `cards=${feed.cards}`)
check('无头条文章卡残留', feed.articleCards === 0, `articleCards=${feed.articleCards}`)
check('无置顶标签残留', feed.pinTags === 0, `pinTags=${feed.pinTags}`)
check('无阅读量组件残留', feed.views === 0, `views=${feed.views}`)
check('信息流 Tab 栏仍在', feed.tabs >= 2, `tabs=${feed.tabs}`)
check('发布框仍在（功能骨架完整）', feed.compose)
check(
  '关注 Tab 空态提示渲染',
  feed.empty && /还没有新动态|暂无/.test(feed.emptyText),
  `empty=${feed.empty} text=${feed.emptyText.slice(0, 30)}`,
)

// ---------- 2. 热门 Tab：空态下不渲染 24h 热榜 ----------
await page.evaluate(() => {
  const hot = [...document.querySelectorAll('.rf-feed-tabs .tab-btn')].find((t) =>
    (t.textContent || '').includes('热门'),
  )
  hot?.click()
})
await page.waitForTimeout(800)
const hot = await page.evaluate(() => {
  const empty = document.querySelector('.empty')
  return {
    cards: document.querySelectorAll('.post-card').length,
    hotBanner: !!document.querySelector('.rf-hot-banner'),
    hotRank: document.querySelectorAll('.rf-hot-rank').length,
    emptyText: (empty?.textContent || '').trim(),
  }
})
check('热门 Tab 零卡片', hot.cards === 0, `cards=${hot.cards}`)
check('空态不渲染 24h 热榜', !hot.hotBanner && hot.hotRank === 0, `banner=${hot.hotBanner} rank=${hot.hotRank}`)
check('热门 Tab 空态提示渲染', /暂无热门动态/.test(hot.emptyText), `text=${hot.emptyText.slice(0, 30)}`)

// ---------- 3. 成长页「单态」一致性（本地累积引擎，不依赖内容数据） ----------
await page.goto(`${BASE}/#/growth`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await dismissWelcome()
const growth = await page.evaluate(() => {
  const txt = document.body.innerText || ''
  return {
    len: txt.trim().length,
    hasLevel: /Lv\.?\s*\d|等级/.test(txt),
    hasScore: txt.includes('成长值'),
    hasExp: /\bEXP\b/.test(txt),
    hasPoint: /\bPOINT\b/.test(txt),
  }
})
check('成长页渲染有内容', growth.len > 100, `len=${growth.len}`)
check('成长页展示等级', growth.hasLevel)
check(
  '成长页为单态「成长值」（无 EXP / POINT 双轨）',
  growth.hasScore && !growth.hasExp && !growth.hasPoint,
  `score=${growth.hasScore} exp=${growth.hasExp} point=${growth.hasPoint}`,
)

check('全程无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(`\n=== 信息流 + 成长页（空态基线）：${pass} 通过 / ${fail} 失败 ===`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
