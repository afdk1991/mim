// 微博信息流 + 成长页回归实测（确定性：离线可跑，只需本地 preview 构建产物）
//
// 背景：本脚本此前随工作区丢失过一次，导致 `npm run verify:feed` 长期指向不存在的文件。
// 按 package.json / .gitignore 的「确定性回归基线入库」策略，本脚本已放行入库，
// 避免第三次丢失。
//
// 用法：npm run verify:feed
//       BASE=http://localhost:5199 npm run verify:feed
import { chromium } from 'playwright-core'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
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

// ---------- 1. 信息流（默认 Tab） ----------
await page.goto(`${BASE}/#/feed`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await dismissWelcome()

const feed = await page.evaluate(() => ({
  cards: document.querySelectorAll('.post-card').length,
  articleCards: document.querySelectorAll('.rf-article-card').length,
  pinTags: document.querySelectorAll('.wt-pin-tag').length,
  views: document.querySelectorAll('.pa-views').length,
  tabs: document.querySelectorAll('.rf-feed-tabs .tab-btn').length,
}))
check('信息流动态卡片渲染', feed.cards >= 1, `cards=${feed.cards}`)
check('头条文章卡穿插', feed.articleCards >= 1, `articleCards=${feed.articleCards}`)
check('置顶标签渲染', feed.pinTags >= 1, `pinTags=${feed.pinTags}`)
check('阅读量展示', feed.views >= 1, `views=${feed.views}`)
check('信息流 Tab 栏', feed.tabs >= 2, `tabs=${feed.tabs}`)

// ---------- 2. 热门 Tab + 24h 热榜 ----------
// 注意：HotBanner 只在「热门」Tab 内渲染，必须在切 Tab 之后断言
await page.evaluate(() => {
  const hot = [...document.querySelectorAll('.rf-feed-tabs .tab-btn')].find((t) =>
    (t.textContent || '').includes('热门'),
  )
  hot?.click()
})
await page.waitForTimeout(800)
const hot = await page.evaluate(() => ({
  cards: document.querySelectorAll('.post-card').length,
  hotBanner: !!document.querySelector('.rf-hot-banner'),
  hotRank: document.querySelectorAll('.rf-hot-rank').length,
}))
check('切换「热门」Tab 有内容', hot.cards >= 1, `cards=${hot.cards}`)
check('24h 热榜卡片渲染', hot.hotBanner, hot.hotBanner ? 'present' : '缺失')
check('热榜序号渲染', hot.hotRank >= 1, `hotRank=${hot.hotRank}`)

// ---------- 3. 成长页「单态」一致性 ----------
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

console.log(`\n=== 信息流 + 成长页：${pass} 通过 / ${fail} 失败 ===`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
