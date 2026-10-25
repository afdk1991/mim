/**
 * Mim · Supabase 密钥抓取脚本 v2（修正版）
 *
 * v1 失败原因：
 *   - legacy token 弹窗也要求填 Name（v1 未填 → 卡在校验）
 *   - service_role 在「Legacy anon, service_role API keys」tab 下（v1 没切 tab）
 *
 * 流程：
 *   1. Access Token：Generate new token → Create legacy token → 填 name → Generate token → 抓 sbp_
 *   2. service_role：API Keys 页 → 切 Legacy tab → reveal → 抓 eyJ JWT
 *
 * 产物：
 *   browser-shots/supabase-access-token.txt   Access Token（sbp_…）
 *   browser-shots/supabase-service-role.txt   service_role key（eyJ…）
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const ROOT = path.resolve(import.meta.dirname, '..')
const SHOTS = path.join(ROOT, 'browser-shots')
const PROFILE = path.join(SHOTS, 'edge-profile')
const REF = 'sepfobukokrrivwyvhnd'
const TOKENS_PAGE = 'https://supabase.com/dashboard/account/tokens'
const API_KEYS_PAGE = `https://supabase.com/dashboard/project/${REF}/settings/api-keys`

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

/** 从页面抓 sbp_ token（文本 + input 双通道，多次重试） */
async function grabFromPage(page, pattern, tries = 6) {
  for (let i = 0; i < tries; i++) {
    let txt = ''
    try { txt = await page.evaluate(() => document.body.innerText) } catch { txt = '' }
    const m = txt.match(pattern)
    if (m) return m[0]
    try {
      for (const el of await page.$$('input')) {
        const v = await el.inputValue().catch(() => '')
        if (pattern.test(v)) { pattern.lastIndex = 0; return v }
      }
    } catch { /* ignore */ }
    await page.waitForTimeout(2000)
  }
  return null
}

async function grabToken(page) {
  log('打开 Access Tokens 页…')
  await page.goto(TOKENS_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(4000)

  const genBtn = page.getByRole('button', { name: /generate new (access )?token/i }).first()
  await genBtn.waitFor({ state: 'visible', timeout: 20000 })
  await genBtn.click()
  await page.waitForTimeout(2500)
  log('已打开 Generate token 弹窗')

  // legacy token 路径（一步、全权限）
  const legacy = page.getByText(/create legacy token/i).first()
  if (await legacy.isVisible().catch(() => false)) {
    log('点击 Create legacy token …')
    await legacy.click()
    await page.waitForTimeout(2000)
  }

  // 填 name（必填）：React 受控组件需逐字符输入触发 onChange
  // 注意：必须限定在弹窗内——页面背景也有 input（Filter tokens 搜索框），
  // 且弹窗遮罩会拦截背景元素的点击
  const nameInput = page
    .getByPlaceholder(/e\.g\.|token name|name for the token/i)
    .first()
    .or(page.locator('[data-state="open"] input').first())
  await nameInput.waitFor({ state: 'visible', timeout: 10000 })
  await nameInput.click()
  await page.keyboard.type('mim-autopilot', { delay: 30 })
  const filled = await nameInput.inputValue().catch(() => '')
  log(`已填写 token 名称: mim-autopilot（当前值: "${filled}"）`)
  await page.waitForTimeout(500)

  // 点 Generate token（绿色按钮，限定弹窗内——背景页有同名干扰按钮）
  const modal = page.locator('[data-state="open"]').last()
  const gen = modal.getByRole('button', { name: /^generate token$/i }).first()
  await gen.click()
  log('已点击 Generate token，等待明文…')
  await page.waitForTimeout(4000)

  await page.screenshot({ path: path.join(SHOTS, 'grab-token-v2.png') })

  const token = await grabFromPage(page, /sbp_[a-f0-9]{40,}/i)
  if (token) {
    fs.writeFileSync(path.join(SHOTS, 'supabase-access-token.txt'), token)
    log('✅ Access Token 已写入:', token.slice(0, 12) + '…')
  } else {
    log('⚠️ 未抓到 token，见 browser-shots/grab-token-v2.png')
  }
  return token
}

async function grabServiceRole(page) {
  log('打开 Project → Settings → API Keys …')
  await page.goto(API_KEYS_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)

  // 切到 Legacy tab
  const legacyTab = page.getByText(/legacy anon, service_role api keys/i).first()
  if (await legacyTab.isVisible().catch(() => false)) {
    await legacyTab.click()
    log('已切换到 Legacy anon, service_role API keys tab')
    await page.waitForTimeout(3000)
  } else {
    log('⚠️ 未找到 Legacy tab（可能已在该页）')
  }

  // 点所有 reveal 按钮（眼睛图标）
  let revealed = 0
  for (const b of await page.$$('button')) {
    const label = (((await b.getAttribute('aria-label')) || '') + ' ' + ((await b.textContent()) || '')).toLowerCase()
    if (label.includes('reveal') || label.includes('show')) {
      await b.click().catch(() => {})
      revealed++
      await page.waitForTimeout(500)
    }
  }
  log(`已点击 reveal 按钮 ${revealed} 个`)
  await page.waitForTimeout(2000)

  await page.screenshot({ path: path.join(SHOTS, 'grab-api-keys-v2.png'), fullPage: true })

  // 抓全部 JWT（anon + service_role 都在页面上），按 payload 选 role=service_role
  // 注意：JWT header 段很短（~36 字符），正则不能要求过长
  const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
  let txt = ''
  try { txt = await page.evaluate(() => document.body.innerText) } catch { txt = '' }
  const all = txt.match(jwtRe) || []
  log(`页面发现 ${all.length} 个 JWT`)

  const decodePayload = (jwt) => {
    try {
      const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(Buffer.from(part, 'base64').toString('utf8'))
    } catch { return null }
  }

  // 优先 service_role；否则取第一个非 anon 的
  let key =
    all.find((j) => decodePayload(j)?.role === 'service_role') ||
    all.find((j) => { const p = decodePayload(j); return p && p.role && p.role !== 'anon' }) ||
    null

  if (key) {
    const role = decodePayload(key)?.role ?? 'unknown'
    fs.writeFileSync(path.join(SHOTS, 'supabase-service-role.txt'), key)
    log(`✅ ${role} key 已写入:`, key.slice(0, 14) + '…')
  } else {
    log('⚠️ 未抓到 service_role，见 browser-shots/grab-api-keys-v2.png')
  }
  return key
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EDGE,
    headless: false,
    viewport: { width: 1500, height: 950 },
    args: ['--start-maximized'],
  })
  const page = ctx.pages()[0] || (await ctx.newPage())

  const token = await grabToken(page)
  const serviceRole = await grabServiceRole(page)

  const result = {
    hasAccessToken: !!token,
    tokenPrefix: token ? token.slice(0, 12) : null,
    hasServiceRole: !!serviceRole,
    capturedAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(SHOTS, 'grab-keys-result.json'), JSON.stringify(result, null, 2))
  log('完成：', JSON.stringify(result))
  await ctx.close()
}

main().catch((e) => {
  console.error('GRAB KEYS V2 FAILED:', e)
  process.exit(1)
})
