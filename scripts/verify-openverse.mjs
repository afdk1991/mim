/* 浏览器实测：漫剧在线发现 + 统一播放器回归（离线 route mock，替代已移除的 vitest）
 * 用法：先起 `npx vite --port 5199 --strictPort`，再 `node scripts/verify-openverse.mjs`
 * 沙箱无外网，Openverse / Commons / Supabase 代理全部用 route mock 模拟。 */
import { chromium } from 'playwright-core'
import { resolveBrowser } from './lib/browser.mjs'

const EDGE = resolveBrowser()
const BASE = process.env.BASE || 'http://localhost:5199'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' —— ' + detail : ''}`)
}

/* ---------------------------- Mock 数据 ---------------------------- */

const vid = (prefix, i, opts = {}) => ({
  id: `${prefix}-${i}`,
  title: `${prefix} open clip ${i}`,
  url: opts.noUrl ? '' : `https://cdn.example.com/${prefix}${i}.mp4`,
  license: opts.noLicense ? undefined : 'cc-by',
  license_version: opts.noLicense ? undefined : '4.0',
  thumbnail: i === 0 ? 'https://cdn.example.com/thumb.jpg' : undefined,
  foreign_landing_url: `https://example.com/${prefix}/${i}`,
  source: 'Flickr',
})

const ovPayload = (prefix) => ({
  results: [vid(prefix, 0), vid(prefix, 1, { noLicense: true }), vid(prefix, 2, { noUrl: true })],
  page: 1,
  page_count: 2,
  result_count: 40,
})

const commonsPage = (id, name, license) => ({
  pageid: id,
  index: id,
  title: `File:${name}`,
  videoinfo: [
    {
      url: `https://upload.wikimedia.org/commons/${id}.webm`,
      thumburl: 'https://upload.wikimedia.org/thumb.jpg',
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
      extmetadata: license ? { LicenseShortName: { value: license } } : {},
    },
  ],
})

/** Commons 首页返回 continue.gsroffset ⇒ hasMore=true；第二页不返回 ⇒ 到底 */
const commonsPayload = (offset) => ({
  query: {
    pages: offset === 0
      ? { 111: commonsPage(111, 'AI_clip_one.webm', 'CC0'), 222: commonsPage(222, 'AI_clip_two.webm', null) }
      : { 333: commonsPage(333, 'AI_clip_three.webm', 'CC BY 4.0'), 444: commonsPage(444, 'AI_clip_four.webm', 'CC-BY-SA') },
    ...(offset === 0 ? { continue: { gsroffset: 20 } } : {}),
  },
})

const cnt = { video: 0, audio: 0, commons: 0 }

const jsonOK = (body) => ({
  status: 200,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify(body),
})

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (e) => console.log('⚠️ pageerror:', e.message))

/* ---------------------------- 路由拦截 ---------------------------- */

await page.route('**/*', async (route) => {
  const url = route.request().url()
  try {
    // Openverse 代理（supabase functions）或直连 api.openverse.org
    if (/\/openverse\/(videos|audio)/.test(url) || /api\.openverse\.org\/v1\/(videos|audio)/.test(url)) {
      const u = new URL(url)
      const q = u.searchParams.get('q') || ''
      const page_ = Number(u.searchParams.get('page') || '1')
      const isAudio = /audio/.test(url)
      if (isAudio) cnt.audio++
      else cnt.video++
      if (q === 'ratelimit') return route.fulfill({ status: 429, contentType: 'application/json', body: '{"detail":"throttled"}' })
      if (q === 'boom') return route.fulfill({ status: 502, contentType: 'application/json', body: '{"detail":"bad gateway"}' })
      if (q === 'badjson') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>not json</html>' })
      if (q === 'nolicensetype' && u.searchParams.get('license_type') !== 'commercial') {
        return route.fulfill({ status: 400, contentType: 'application/json', body: '{"detail":"license_type missing"}' })
      }
      const prefix = isAudio ? 'aud' : `vid-p${page_}`
      return route.fulfill(jsonOK(ovPayload(prefix)))
    }
    // Wikimedia Commons
    if (/commons\.wikimedia\.org\/w\/api\.php/.test(url)) {
      cnt.commons++
      const u = new URL(url)
      const offset = Number(u.searchParams.get('gsroffset') || '0')
      const search = u.searchParams.get('gsrsearch') || ''
      if (!/filetype:video/.test(search)) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"no filetype filter"}' })
      }
      return route.fulfill(jsonOK(commonsPayload(offset)))
    }
    // 媒体直链：返回空内容即可（播放态由 UI 状态驱动，不依赖真实解码）
    if (/\.(mp4|webm|ogg|mp3)(\?|$)/i.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from([]) })
    }
    return route.continue()
  } catch (e) {
    console.log('⚠️ route error:', e.message)
    return route.continue()
  }
})

/* ---------------------------- 用例 ---------------------------- */

const goto = async (hash) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => document.querySelector('.welcome-agree')?.click())
  await page.waitForTimeout(300)
}

const texts = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()))

try {
  await goto('#/manju')

  // 1. 首页 → 全量列表
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /全部 \d+ 部/.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(600)
  const panel = await page.$('.manju-discover')
  check('进入全量列表页并渲染在线发现面板', !!panel)

  const srcChips = await texts('.manju-discover-srcs .manju-chip')
  check('三来源切换 chips', srcChips.length === 3, srcChips.join(' / '))

  // 2. 站内精选条目（含本轮新增音频种子）
  const itemTitles = await texts('.manju-ext-item .manju-card-title')
  check('列表展示站内精选条目', itemTitles.length >= 20, `共 ${itemTitles.length} 条`)
  const audioSeeds = ['巴赫', '贝多芬', '乔普林'].filter((k) => itemTitles.some((t) => t.includes(k)))
  check('3 条公版音频种子在列', audioSeeds.length === 3, audioSeeds.join(' / '))
  const audioPlay = await page.$$eval('.manju-ext-item', (els) =>
    els.filter((e) => /巴赫|贝多芬|乔普林/.test(e.textContent) && /站内播放/.test(e.textContent)).length,
  )
  check('音频种子走站内播放（直链可播）', audioPlay === 3, `可播 ${audioPlay}/3`)

  // 3. Openverse 视频检索 + 授权展示
  const beforeVideo = cnt.video
  await page.fill('input[aria-label="在线发现关键词"]', 'animation')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.manju-discover-row button')].find((x) => /搜索|检索中/.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(900)
  const disc = await texts('.manju-discover-list .manju-card-title')
  check('Openverse 视频检索渲染 3 条结果', disc.length === 3, disc.join(' | '))
  check('首次检索发出网络请求', cnt.video === beforeVideo + 1, `video=${cnt.video}`)
  const badges = await texts('.manju-discover-list .manju-license')
  check('有授权条目显示 CC-BY 4.0', badges.includes('CC-BY 4.0'), badges.join(' / '))
  check('缺授权条目显示「授权未知」而非冒充 CC/PD',
    badges.includes('授权未知') && !badges.some((b) => /^cc\/pd$/i.test(b)), badges.join(' / '))

  // 4. 前端缓存：同词再检索不再打网络
  const beforeCache = cnt.video
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.manju-discover-row button')].find((x) => /搜索/.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(700)
  check('重复检索命中前端缓存（0 次新请求）', cnt.video === beforeCache, `新增 ${cnt.video - beforeCache} 次`)
  check('缓存命中后结果仍在', (await texts('.manju-discover-list .manju-card-title')).length === 3)

  // 5. 错误细分：429 / 502 / 坏 JSON
  for (const [q, kw, label] of [
    ['ratelimit', '限流', '429 → 限流文案'],
    ['boom', '上游服务暂不可用', '502 → 上游文案'],
    ['badjson', '解析失败', '非法 JSON → 解析文案'],
  ]) {
    await page.fill('input[aria-label="在线发现关键词"]', q)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.manju-discover-row button')].find((x) => /搜索/.test(x.textContent || ''))
      b?.click()
    })
    await page.waitForTimeout(800)
    const err = (await page.textContent('.manju-discover-err').catch(() => '')) || ''
    check(label, err.includes(kw), err.trim())
  }

  // 6. Commons：hasMore 翻页
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.manju-discover-srcs .manju-chip')].find((x) => /Commons/.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(300)
  await page.fill('input[aria-label="在线发现关键词"]', 'ai generated')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.manju-discover-row button')].find((x) => /搜索/.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(900)
  const c1 = await texts('.manju-discover-list .manju-card-title')
  check('Commons 检索渲染 2 条', c1.length === 2, c1.join(' | '))
  const moreBtn = await page.$('.manju-discover-more')
  check('hasMore 为真时出现「加载更多」', !!moreBtn)
  await page.evaluate(() => document.querySelector('.manju-discover-more')?.click())
  await page.waitForTimeout(900)
  const c2 = await texts('.manju-discover-list .manju-card-title')
  check('Commons 翻页追加到 4 条', c2.length === 4, `第 2 页后 ${c2.length} 条`)

  // 7. 收入片单去重
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.manju-discover-list button')].find((x) => /收入片单/.test(x.textContent || ''))
    b?.click()
  })
  await page.waitForTimeout(500)
  const dedup = await page.$$eval('.manju-discover-list button', (els) =>
    els.filter((e) => /✓ 已加入/.test(e.textContent || '') && e.disabled).length,
  )
  check('已加入条目按钮置灰防重复', dedup >= 1, `disabled=${dedup}`)

  // 8. 统一播放器：起播 + 跨页保持
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.manju-ext-item')].find((e) => /站内播放/.test(e.textContent || ''))
    row?.querySelector('button')?.click()
  })
  await page.waitForTimeout(900)
  const bar1 = await page.$('.mim-player-bar')
  check('站内播放唤起统一播放条', !!bar1)
  const title1 = (await page.textContent('.mim-player-bar').catch(() => '')) || ''
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((x) => (x.getAttribute('href') || '').endsWith('#/feed'))
    a?.click()
  })
  await page.waitForTimeout(800)
  const bar2 = await page.$('.mim-player-bar')
  check('切换页面后播放条保持（跨页不中断）', !!bar2, title1.replace(/\s+/g, ' ').slice(0, 30))
  const mediaCount = await page.$$eval('video,audio', (e) => e.length)
  check('全站单一媒体元素（无重复 <video>）', mediaCount <= 1, `media=${mediaCount}`)
  await page.screenshot({ path: 'verify-shots/manju-discover.png', fullPage: false })

  const pass = results.filter((r) => r.ok).length
  console.log(`\n=== 汇总：${pass}/${results.length} 通过 ===`)
  if (pass !== results.length) {
    console.log('失败项：')
    for (const r of results.filter((x) => !x.ok)) console.log(`  ❌ ${r.name} —— ${r.detail}`)
  }
} catch (e) {
  results.push({ name: '脚本异常', ok: false, detail: e.message })
} finally {
  await browser.close()
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
