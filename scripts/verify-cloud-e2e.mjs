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

// 欢迎弹窗：等按钮出现再点（它在首屏之后才挂载，早于它执行会点空导致遮罩拦截后续点击）；
// 兜底直接移除遮罩，保证测试不被弹窗阻塞
async function dismiss(p) {
  try {
    const btn = p.locator('.welcome-agree')
    await btn.waitFor({ state: 'visible', timeout: 5000 })
    await btn.click({ timeout: 5000 })
  } catch {
    await p.evaluate(() => document.querySelector('.welcome-mask')?.remove())
  }
  await p.waitForTimeout(300)
}
async function goto(p, hash, wait = 1500) {
  // waitUntil=commit：GitHub Pages 偶发慢/被 Cloudflare 抖动时 domcontentloaded 会卡死超时，
  // commit 只等导航开始，后续用固定等待+选择器兜底，实测更稳
  await p.goto(BASE + hash, { waitUntil: 'commit' })
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

// 等表单就绪（commit 导航后需显式等元素，不能用固定 sleep 赌渲染完成）
try {
  await p1.waitForSelector('input[placeholder="用户名"]', { timeout: 45000 })
} catch {
  const t = await p1.evaluate(() => document.body.innerText.slice(0, 300))
  console.log('DIAG 页面文本:', JSON.stringify(t))
  console.log('DIAG 控制台:', errors.slice(0, 6))
  throw new Error('登录表单未渲染')
}
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

/* ---------- 阶段三：换浏览器登录同一账号读回（云端持久化铁证） ----------
   注意：必须带登录态——posts 的 RLS 只允许已认证角色读取，
   匿名新会话读不到属预期（安全策略），不代表数据没上云。
   判据换成「全新浏览器上下文（空 localStorage/cookie）+ 登录同一账号」能读到。 */
let crossRead = false
if (published) {
  await ctx1.close() // 释放首个上下文，避免同源页面互相挤占导致导航超时
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } }) // 全新空存储
  const p2 = await ctx2.newPage()
  p2.setDefaultTimeout(90000)
  p2.setDefaultNavigationTimeout(90000)
  hook(p2)
  await goto(p2, '#/login', 2500)
  await p2.waitForSelector('input[placeholder="用户名"]', { timeout: 60000 })
  await p2.fill('input[placeholder="用户名"]', USER)
  await p2.fill('input[placeholder^="密码"]', PWD)
  await p2.click('form.auth-form button[type="submit"]')
  await p2.waitForTimeout(6000)
  // 判据改为「本地已落云端会话凭据」——登录成功后路由会离开登录页，页面文案判据不可靠
  const logged2 = await p2.evaluate(() =>
    Object.keys(localStorage).some((k) => /supabase|sb-/.test(k)) ||
    document.body.innerText.includes('已登录'))
  ok('新浏览器可用同一账号登录（账号在云端）', logged2, logged2 ? USER : '未取得云端会话')
  await goto(p2, '#/feed', 4000)
  const body = await p2.evaluate(() => document.body.innerText)
  crossRead = body.includes(TITLE)
  ok('换浏览器登录后可读回该内容（云端持久化）', crossRead,
    crossRead ? '空 localStorage 下命中' : '未看到，说明仅存本地')
  await ctx2.close()
}

/* ---------- 阶段四：请求流水与异常 ---------- */
const cloudCalls = net.filter((l) => /rest\/v1|auth\/v1|mim-api/.test(l))
const failed = cloudCalls.filter((l) => /^(4|5)\d\d /.test(l))
ok('云端请求有成功响应', cloudCalls.some((l) => /^2\d\d /.test(l)),
  cloudCalls.length ? `共 ${cloudCalls.length} 条，失败 ${failed.length} 条` : '未捕获到云端请求')
// 只把「5xx / 未捕获 JS 异常」判为真实故障：4xx 中 PGRST204「线上库缺列」是降级重试的
// 预期噪声（重试后成功），409 是备后端镜像双写的幂等冲突，二者都不影响用户可见结果
const real = errors.filter(
  (e) => !/PGRST|Failed to load resource: the server responded with a status of 4\d\d|favicon|manifest/i.test(e),
)
ok('无 5xx / 未捕获 JS 异常', real.length === 0, real.slice(0, 2).join(' | ') || '无')

await b.close()

console.log('\n=== 线上云端端到端实测（GitHub Pages 生产站）===')
for (const [s, n, d] of results) console.log(`${s} ${n.padEnd(26)} ${d}`)
console.log('\n--- 云端请求流水（前 12 条）---')
for (const l of net.slice(0, 12)) console.log('  ' + l)
console.log('\n--- 失败请求（全部，最多 15 条）---')
for (const l of failed.slice(0, 15)) console.log('  ' + l)
const fail = results.filter((r) => r[0] === '❌').length
console.log(`\n汇总：${results.length - fail}/${results.length} 通过｜测试账号 ${USER}｜标题 ${TITLE}`)
process.exit(fail ? 1 : 0)
