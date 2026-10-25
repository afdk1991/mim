// 线上云端端到端实测：注册 → 发布 → 全新会话（空 localStorage）可读回
// 判据：换一个全新浏览器上下文若能读到另一会话发布的内容 ⇒ 数据确实落在云端
import { chromium } from 'playwright-core'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'https://afdk1991.github.io/mim/'
const STAMP = Date.now()
const USER = 'e2e' + STAMP.toString(36)
const PWD = 'E2eTest2026!'
const TITLE = '云端E2E验证' + STAMP.toString(36)

const results = []
const ok = (n, c, d = '') => { results.push([c ? '✅' : '❌', n, d]); return c }

const b = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] })

const net = []      // 云端请求流水
const errors = []   // 页面异常

function hook(p) {
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('response', async (r) => {
    const u = r.url()
    if (!/supabase\.co|tcloudbase\.com|tcloudbaseapp/.test(u)) return
    let body = ''
    try { body = (await r.text()).slice(0, 160) } catch { /* noop */ }
    net.push(`${r.status()} ${r.request().method()} ${u.replace(/^https:\/\//, '').slice(0, 90)} ${body.replace(/\s+/g, ' ')}`)
  })
}

async function dismiss(p) {
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button,.btn,.welcome-agree')]
      .find((x) => /同意|进入|不再提示|开始使用/.test(x.textContent || ''))
    btn?.click()
  })
  await p.waitForTimeout(300)
}
async function goto(p, hash, wait = 1500) {
  await p.goto(BASE + hash, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(wait)
  await dismiss(p)
  await p.waitForTimeout(400)
}

/* ---------- 阶段一：注册 ---------- */
const ctx1 = await b.newContext({ viewport: { width: 1280, height: 900 } })
const p1 = await ctx1.newPage()
p1.setDefaultTimeout(60000)
p1.setDefaultNavigationTimeout(60000)
hook(p1)

await goto(p1, '#/login', 2000)
const localBadge = await p1.evaluate(() => document.body.innerText.includes('本地演示模式'))
ok('生产站未显示“本地演示模式”', !localBadge, localBadge ? '仍出现该字样' : '已消失')

// 切到「注册」标签（第二个 tab）
const tabs = p1.locator('.auth-tab')
const tabCount = await tabs.count()
if (tabCount >= 2) { await tabs.nth(1).click(); await p1.waitForTimeout(300) }
await p1.fill('input[placeholder="用户名"]', USER)
await p1.fill('input[placeholder^="密码"]', PWD)
await p1.click('form.auth-form button[type="submit"]')
await p1.waitForTimeout(6000)

const afterReg = await p1.evaluate(() => document.body.innerText)
const registerErr = await p1.locator('.auth-err').count()
  ? (await p1.locator('.auth-err').first().innerText()).trim() : ''
const loggedIn = /已登录/.test(afterReg)
ok('线上注册成功并进入登录态', loggedIn, registerErr || (loggedIn ? `用户=${USER}` : '未出现已登录'))

/* ---------- 阶段二：发布内容 ---------- */
let published = false
if (loggedIn) {
  await goto(p1, '#/publish', 2000)
  // 默认 content_type 为「动态」（广场态），此时无标题输入框，只填正文
  const ta = p1.locator('textarea').first()
  if (await ta.count()) {
    await ta.fill('这是一条用于验证线上云端持久化的端到端测试内容。' + TITLE)
    await p1.waitForTimeout(400)
    const submit = p1.locator('.pb-submit')
    if (await submit.count()) {
      await submit.first().click()
      await p1.waitForTimeout(4000)
      const t = await p1.evaluate(() => document.body.innerText)
      published = /已发布|发布成功|发布进/.test(t)
      ok('线上发布内容成功', published, published ? TITLE : (t.match(/命中敏感词[^\n]*/)?.[0] || '未见到发布成功提示'))
    } else ok('线上发布内容成功', false, '未找到 .pb-submit')
  } else ok('线上发布内容成功', false, '未找到标题输入框')
}

/* ---------- 阶段三：全新会话读回（云端持久化铁证） ---------- */
let crossRead = false
if (published) {
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } })  // 全新空存储
  const p2 = await ctx2.newPage()
  p2.setDefaultTimeout(60000)
  await goto(p2, '#/feed', 3000)
  const body = await p2.evaluate(() => document.body.innerText)
  crossRead = body.includes(TITLE)
  ok('全新会话可读回该内容（云端持久化）', crossRead,
    crossRead ? '空 localStorage 下命中' : '新会话未看到，说明仅存本地')
  await ctx2.close()
}

/* ---------- 阶段四：请求流水与异常 ---------- */
const cloudCalls = net.filter((l) => /rest\/v1|auth\/v1|mim-api/.test(l))
const failed = cloudCalls.filter((l) => /^(4|5)\d\d /.test(l))
ok('云端请求有成功响应', cloudCalls.some((l) => /^2\d\d /.test(l)),
  cloudCalls.length ? `共 ${cloudCalls.length} 条，失败 ${failed.length} 条` : '未捕获到云端请求')
const real = errors.filter((e) => !/PGRST205|products|favicon|manifest/i.test(e))
ok('无真实 JS 异常', real.length === 0, real.slice(0, 2).join(' | ') || '无')

await b.close()

console.log('\n=== 线上云端端到端实测（GitHub Pages 生产站）===')
for (const [s, n, d] of results) console.log(`${s} ${n.padEnd(26)} ${d}`)
console.log('\n--- 云端请求流水（前 12 条）---')
for (const l of net.slice(0, 12)) console.log('  ' + l)
console.log('\n--- 失败请求（前 6 条）---')
for (const l of failed.slice(0, 6)) console.log('  ' + l)
const fail = results.filter((r) => r[0] === '❌').length
console.log(`\n汇总：${results.length - fail}/${results.length} 通过｜测试账号 ${USER}｜标题 ${TITLE}`)
process.exit(fail ? 1 : 0)
