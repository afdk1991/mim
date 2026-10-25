/**
 * Mim · 抓取 service_role key（textContent 通道）
 *
 * 背景：innerText 会按 CSS 换行插入 \n，把 JWT 打断导致正则失配；
 *       textContent 返回原始 DOM 文本，不受视觉换行影响。
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const ROOT = path.resolve(import.meta.dirname, '..')
const SHOTS = path.join(ROOT, 'browser-shots')
const PROFILE = path.join(SHOTS, 'edge-profile')
const REF = 'sepfobukokrrivwyvhnd'
const API_KEYS_PAGE = `https://supabase.com/dashboard/project/${REF}/settings/api-keys`

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EDGE,
    headless: false,
    viewport: { width: 1500, height: 950 },
  })
  const page = ctx.pages()[0] || (await ctx.newPage())

  log('打开 API Keys 页…')
  await page.goto(API_KEYS_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)

  // 切 Legacy tab
  const legacyTab = page.getByText(/legacy anon, service_role api keys/i).first()
  if (await legacyTab.isVisible().catch(() => false)) {
    await legacyTab.click()
    log('已切换 Legacy tab')
    await page.waitForTimeout(3000)
  }

  // 确保 key 明文可见：点 reveal（在含 service_role 文本的行内找按钮）
  const rows = await page.$$('tr, [role="row"], div')
  let clicked = 0
  for (const r of rows.slice(0, 200)) {
    const t = (await r.textContent().catch(() => '')) || ''
    if (/service_role/i.test(t) && t.length < 2000) {
      for (const b of await r.$$('button')) {
        const label = (((await b.getAttribute('aria-label')) || '') + ' ' + ((await b.textContent()) || '')).toLowerCase()
        if (label.includes('reveal') || label.includes('show')) {
          await b.click().catch(() => {})
          clicked++
          await page.waitForTimeout(400)
        }
      }
    }
  }
  log(`service_role 行内点击 reveal ${clicked} 个`)
  await page.waitForTimeout(1500)

  await page.screenshot({ path: path.join(SHOTS, 'grab-service-role.png'), fullPage: true })

  // textContent 通道抓 JWT
  const raw = await page.evaluate(() => document.body.textContent || '')
  const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
  const all = raw.match(jwtRe) || []
  log(`textContent 发现 ${all.length} 个 JWT`)

  const decode = (jwt) => {
    try {
      const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(Buffer.from(p, 'base64').toString('utf8'))
    } catch { return null }
  }
  for (const j of all) {
    const role = decode(j)?.role
    log(`  JWT ${j.slice(0, 18)}… role=${role ?? '?'}`)
  }

  let key =
    all.find((j) => decode(j)?.role === 'service_role') ||
    all.find((j) => { const r = decode(j)?.role; return r && r !== 'anon' }) ||
    null

  if (!key) {
    // fallback：input 值通道
    for (const el of await page.$$('input')) {
      const v = await el.inputValue().catch(() => '')
      const m = v.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/)
      if (m && decode(m[0])?.role === 'service_role') { key = m[0]; break }
    }
  }

  if (key) {
    fs.writeFileSync(path.join(SHOTS, 'supabase-service-role.txt'), key)
    log('✅ service_role key 已写入:', key.slice(0, 14) + '…')
  } else {
    log('⚠️ 仍未抓到，见 browser-shots/grab-service-role.png')
  }
  await ctx.close()
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
