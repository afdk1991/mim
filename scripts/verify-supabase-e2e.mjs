/**
 * Supabase 全链路 · 浏览器级端到端验证（真实 Edge 渲染 + 真实注册登录）
 *
 * 前置：先构建并启动 preview（端口 5199）：
 *   npm run build
 *   npx vite preview --port 5199 &
 *   node scripts/verify-supabase-e2e.mjs
 *
 * 覆盖：
 *   1) 应用以云端模式启动（非「本地演示模式」）⇒ 适配层解析到 Supabase
 *   2) 第三方登录网格出现 GitHub 按钮 ⇒ GoTrue settings 探测生效
 *   3) 注册新账号（合成邮箱映射）⇒ 自动登录 ⇒ 「✅ 已登录」卡片显示用户名
 *   4) localStorage 持久化 Supabase 会话（mim-sb-auth）
 *   5) 页面无 console 错误
 *
 * 说明：会在 Supabase 项目留下一个冒烟账号（e2e_<时间戳>@mim.app），
 *       与 scripts/smoke-storage.mjs 的冒烟账号同性质，无法自动删除（需 service_role）。
 */

import { chromium } from 'playwright-core'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
// 用 127.0.0.1 而非 localhost：localhost 可能被浏览器解析到 IPv6 ::1，
// 连接失败重试会导致首次文档加载及其在途请求被 ERR_ABORTED（误报网络错误）
const BASE = 'http://127.0.0.1:5199/'

let pass = 0
let fail = 0
let warn = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--window-size=1280,900'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  const netErrs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('response', (r) => {
    if (r.status() >= 400) netErrs.push(`HTTP ${r.status()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => netErrs.push(`FAILED ${r.url()} :: ${r.failure()?.errorText ?? ''}`))
  // /auth/v1/ 请求流水（定位中止/重试等非确定性行为）
  const authFlow = []
  page.on('request', (r) => {
    if (r.url().includes('/auth/v1/')) authFlow.push(`REQ ${r.url().replace(/^https:\/\/[^/]+/, '')}`)
  })
  page.on('response', (r) => {
    if (r.url().includes('/auth/v1/')) authFlow.push(`RESP ${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, '')}`)
  })
  // favicon.ico 404 为本地 preview 固有噪音（URL 不在 console 文本里，
  // 故同时过滤通用 404 文案；真实 404 均由 response 监听按 URL 捕获判定）
  const isNoise = (e) => /favicon\.ico/.test(e) || /Failed to load resource: the server responded with a status of 404/.test(e)

  const username = `e2e_${Date.now().toString(36)}`
  const password = 'E2e@2026ok'

  await page.goto(BASE + '#/login', { waitUntil: 'domcontentloaded' })
  // 欢迎弹窗拦截点击：用 React 的 onClick 关闭（勿直接 remove 节点）
  await page.evaluate(() => document.querySelector('.welcome-agree')?.click())
  await page.waitForTimeout(600)

  // 1) 云端模式（而非本地演示）
  const bodyText = await page.evaluate(() => document.body.innerText)
  check('应用以云端模式启动（未见「本地演示模式」）', !bodyText.includes('本地演示模式'))

  // 2) 切到注册 tab
  await page.click('.auth-tab:nth-child(2)')
  await page.waitForTimeout(200)

  // 3) OAuth 网格出现 GitHub 按钮（GoTrue settings 异步探测，等待其完成）
  try {
    await page.waitForFunction(
      () => (document.querySelector('.auth-oauth')?.innerText ?? '').includes('GitHub'),
      { timeout: 10000 },
    )
    check('第三方登录网格出现 GitHub 按钮', true)
  } catch {
    const oauthText = await page.evaluate(() => document.querySelector('.auth-oauth')?.innerText ?? '')
    check('第三方登录网格出现 GitHub 按钮', false, oauthText.slice(0, 80).replace(/\n/g, ' '))
  }

  // 4) 填表注册
  await page.fill('.auth-form input[type="text"]', username)
  await page.fill('.auth-form input[type="password"]', password)
  await page.click('.auth-form button[type="submit"]')

  // 5) 等待「✅ 已登录」卡片 + 用户名显示（真实 Supabase 注册 + 自动登录）
  try {
    await page.waitForSelector('.auth-card .page-title', { timeout: 20000 })
    await page.waitForFunction(
      (u) => document.body.innerText.includes('✅ 已登录') && document.body.innerText.includes(u),
      username,
      { timeout: 20000 },
    )
    check('注册并自动登录（✅ 已登录 + 用户名显示）', true, username)
  } catch {
    const errText = await page.evaluate(() => document.querySelector('.auth-err')?.textContent ?? '(无错误提示)')
    check('注册并自动登录（✅ 已登录 + 用户名显示）', false, errText)
  }

  // 6) 会话持久化到 localStorage（storageKey: mim-sb-auth）
  const session = await page.evaluate(() => {
    const raw = localStorage.getItem('mim-sb-auth')
    if (!raw) return null
    try {
      const j = JSON.parse(raw)
      return { hasToken: !!j.access_token, userId: j.user?.id ?? null, email: j.user?.email ?? null }
    } catch {
      return null
    }
  })
  check(
    'Supabase 会话已持久化（mim-sb-auth）',
    !!session?.hasToken,
    session ? `uid=${session.userId} email=${session.email}` : '无会话',
  )

  // 等待 RBAC 拉取（loadIam）等登录后异步请求完成，再统计网络错误
  await page.waitForTimeout(1500)

  // 7) 网络/控制台错误分类：
  //    IAM 四表（roles/permissions/role_permissions/user_roles）在迁移 0001
  //    未执行时返回 PGRST205（HTTP 404），属已知待办 → WARN；
  //    其余错误一律 FAIL。
  const IAM_RE = /roles|permissions|audit_logs/
  const realNet = netErrs.filter((e) => !isNoise(e))
  const iamErrs = realNet.filter((e) => IAM_RE.test(e))
  const otherErrs = [...realNet.filter((e) => !IAM_RE.test(e)), ...errs.filter((e) => !isNoise(e))]
  if (iamErrs.length > 0) {
    warn++
    console.log(`  ⚠️ IAM 表 404（迁移 0001_iam_phase1.sql 未执行，已知待办）— ${iamErrs[0]}`)
  }
  if (realNet.length > 0 || authFlow.length > 0) {
    console.log('  —— /auth/v1/ 请求流水 ——')
    authFlow.forEach((e) => console.log(`     ${e}`))
    console.log('  —— 网络异常明细 ——')
    realNet.forEach((e) => console.log(`     ${e}`))
  }
  check('无其他网络/控制台错误', otherErrs.length === 0, otherErrs.slice(0, 3).join(' | '))

  await browser.close()
  console.log(`\n=== 结果：✅ ${pass} 通过 · ❌ ${fail} 失败 · ⚠️ ${warn} 警告 ===\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
