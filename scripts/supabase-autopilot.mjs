/**
 * Supabase Dashboard 接管脚本（浏览器自动化）
 *
 * 背景：本地 .env.local 仅有 anon key，缺 SUPABASE_ACCESS_TOKEN / SERVICE_ROLE_KEY，
 * 迁移 0002/0004/0005 未应用、Edge Function 未部署。本脚本驱动真实 Edge：
 *
 *   1. 以独立持久化 profile 启动 Edge（不动用户自己的 Edge 主实例）
 *   2. 打开 Supabase Dashboard 登录页，等待用户手动登录（最长等待 LOGIN_TIMEOUT_MS）
 *   3. 登录成功后自动导航到 Account → Access Tokens
 *   4. 自动点击 "Generate new token"，从页面抓取 sbp_ 开头的 token
 *   5. 结果落盘：browser-shots/autopilot-result.json + 截图
 *
 * 运行：node scripts/supabase-autopilot.mjs [--headless]
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const ROOT = path.resolve(import.meta.dirname, '..')
const SHOTS = path.join(ROOT, 'browser-shots')
const PROFILE = path.join(SHOTS, 'edge-profile')
const DASH = 'https://supabase.com/dashboard/project/sepfobukokrrivwyvhnd'
const TOKENS_PAGE = 'https://supabase.com/dashboard/account/tokens'

const LOGIN_TIMEOUT_MS = 8 * 60 * 1000
const POLL_MS = 5000

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EDGE,
    headless: false,
    viewport: { width: 1500, height: 950 },
    args: ['--start-maximized'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())

  log('打开 Dashboard（未登录将跳转登录页）…')
  await page.goto(DASH, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // ---- 1. 等待登录 ----
  // 注意：项目页在跳转完成前会短暂渲染，必须双条件判定：
  //   URL 已离开 sign-in 且进入 dashboard/project|org|account
  //   且页面不含登录表单文案（Welcome back / Sign in to your account）
  //   登录跳转瞬间 execution context 会被销毁 → 所有 evaluate 必须容错
  const safeText = async (n = 800) => {
    try {
      return await page.evaluate(() => document.body.innerText.slice(0, 800))
    } catch {
      return '' // 导航中上下文销毁：当作无文本
    }
  }
  const isLoginPage = async () => {
    const url = page.url()
    if (/sign-in/.test(url)) return true
    const txt = await safeText()
    if (!txt) return true // 拿不到文本时保守判定为未就绪
    return /Welcome back|Sign in to your account|Continue with GitHub/i.test(txt)
  }
  const inDashboard = () =>
    /supabase\.com\/dashboard\/(project|org|account)/.test(page.url()) && !/sign-in/.test(page.url())

  // 先等页面跳转稳定（此时应停在登录页）
  for (let i = 0; i < 12; i++) {
    if (await isLoginPage()) break
    await page.waitForTimeout(1000)
  }
  if (await isLoginPage()) {
    log('⏳ 已打开登录页，请在弹出窗口中登录 Supabase（GitHub / 邮箱均可）…')
  } else {
    log('ℹ️ 当前不在登录页，直接检测登录态…')
  }

  const t0 = Date.now()
  let loggedIn = false
  while (Date.now() - t0 < LOGIN_TIMEOUT_MS) {
    if (!(await isLoginPage()) && inDashboard()) {
      loggedIn = true
      log('✅ 登录成功，当前 URL:', page.url())
      break
    }
    await page.waitForTimeout(POLL_MS)
  }

  if (!loggedIn) {
    log('❌ 等待登录超时（8 分钟）。请重新运行本脚本并尽快完成登录。')
    await page.screenshot({ path: path.join(SHOTS, 'autopilot-login-timeout.png') })
    await ctx.close()
    process.exit(2)
  }

  await page.screenshot({ path: path.join(SHOTS, 'autopilot-dashboard.png') })
  log('已截图 autopilot-dashboard.png')

  // ---- 2. Access Tokens 页 ----
  log('导航到 Account → Access Tokens …')
  await page.goto(TOKENS_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)

  // 严格复验：登录态失效会再跳登录页
  if (await isLoginPage()) {
    log('❌ Tokens 页被重定向到登录页，登录态未生效')
    await page.screenshot({ path: path.join(SHOTS, 'autopilot-login-failed.png') })
    await ctx.close()
    process.exit(3)
  }

  // ---- 3. 生成新 token ----
  let token = null
  try {
    // 找 Generate 按钮（文案可能为 "Generate new token" / "Generate new access token"）
    const genBtn = page.getByRole('button', { name: /generate new (access )?token/i }).first()
    await genBtn.waitFor({ state: 'visible', timeout: 15000 })
    await genBtn.click()
    log('已点击 Generate new token，等待弹窗…')
    await page.waitForTimeout(2000)

    // 弹窗内可能有 name 输入框与确认按钮
    const confirm = page.getByRole('button', { name: /^generate( token)?$/i }).first()
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click()
      log('已确认生成')
    }
    await page.waitForTimeout(3000)

    // 抓取页面上 sbp_ 开头的 token（生成后页面会展示一次明文）
    let bodyText = ''
    try {
      bodyText = await page.evaluate(() => document.body.innerText)
    } catch {
      bodyText = ''
    }
    const m = bodyText.match(/sbp_[a-f0-9]{40,}/i)
    if (m) {
      token = m[0]
      log('✅ 已从页面抓取 Access Token（前 12 位）:', token.slice(0, 12) + '…')
    } else {
      log('⚠️ 页面未直接展示 token 明文，尝试 input 值…')
      try {
        const inputs = await page.$$('input')
        for (const el of inputs) {
          const v = await el.inputValue().catch(() => '')
          if (/^sbp_[a-f0-9]{40,}$/i.test(v)) { token = v; break }
        }
      } catch { /* 页面重渲染，忽略 */ }
      if (token) log('✅ 从 input 抓取到 token:', token.slice(0, 12) + '…')
      else log('⚠️ 未能自动抓取 token，请手动复制页面上的 token')
    }
  } catch (e) {
    log('⚠️ 生成 token 流程异常:', String(e).slice(0, 200))
  }

  await page.screenshot({ path: path.join(SHOTS, 'autopilot-tokens.png') })

  const result = {
    loggedIn: true,
    token: token || null,
    tokenPrefix: token ? token.slice(0, 12) : null,
    capturedAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(SHOTS, 'autopilot-result.json'), JSON.stringify(result, null, 2))
  if (token) {
    fs.writeFileSync(path.join(SHOTS, 'supabase-access-token.txt'), token)
    log('token 已写入 browser-shots/supabase-access-token.txt')
  }
  log('完成。结果见 browser-shots/autopilot-result.json')
  await ctx.close()
}

main().catch((e) => {
  console.error('AUTOPILOT FAILED:', e)
  process.exit(1)
})
