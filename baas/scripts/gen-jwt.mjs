#!/usr/bin/env node
/**
 * 生成 BaaS 的 anon / service_role JWT（HS256），并做签发-验签回环自检。
 * 零依赖：只用 Node 内置 crypto。
 *
 * 用法：
 *   node scripts/gen-jwt.mjs                    # 打印两个 key
 *   node scripts/gen-jwt.mjs --write            # 写入 .env 的 ANON_KEY / SERVICE_ROLE_KEY
 *   node scripts/gen-jwt.mjs --self-test        # 额外执行签发-验签回环自检
 *   node scripts/gen-jwt.mjs --secret xxx       # 指定签名密钥（默认取 .env 的 JWT_SECRET）
 *
 * 约定：与 supabase/gotrue 一致的三类 JWT
 *   anon          : role=anon,          aud=anon
 *   service_role  : role=service_role,  aud=service_role（绕过 RLS，绝不下发到浏览器）
 *   authenticated : role=authenticated, aud=authenticated, sub=<user id>（由 Auth 服务签发）
 */
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function loadEnvSecret() {
  const envFile = path.join(ROOT, '.env')
  let secret = process.env.JWT_SECRET
  if (!secret && existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^JWT_SECRET=(.*)$/m)
    if (m) secret = m[1].trim()
  }
  return value('--secret') || secret
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const sign = (data, secret) =>
  b64url(createHmac('sha256', secret).update(data).digest())

function makeToken(claims, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = { iss: 'baas-local', iat: Math.floor(Date.now() / 1000), ...claims }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(body))
  const s = sign(`${h}.${p}`, secret)
  return { token: `${h}.${p}.${s}`, payload: body }
}

function verify(token, secret) {
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return { ok: false, reason: '结构不合法' }
  if (sign(`${h}.${p}`, secret) !== s) return { ok: false, reason: '签名不匹配' }
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: '已过期' }
  }
  return { ok: true, payload }
}

const secret = loadEnvSecret()
if (!secret) {
  console.error('缺少 JWT_SECRET：请在 .env 中配置，或用 --secret 指定')
  process.exit(1)
}
if (secret.length < 32) {
  console.error('🟡 JWT_SECRET 少于 32 字符，建议加长（当前长度 ' + secret.length + '）')
}

const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10 // 10 年
const anon = makeToken({ role: 'anon', aud: 'anon', exp }, secret)
const service = makeToken({ role: 'service_role', aud: 'service_role', exp }, secret)

// ---------------- 自检 ----------------
let failed = 0
if (flag('--self-test')) {
  console.log('签发-验签回环自检：')
  const uid = randomUUID()
  const cases = [
    ['anon', anon.token, 'anon'],
    ['service_role', service.token, 'service_role'],
    ['authenticated', makeToken({ role: 'authenticated', aud: 'authenticated', sub: uid, exp }, secret).token, 'authenticated'],
  ]
  for (const [name, token, wantRole] of cases) {
    const r = verify(token, secret)
    const okRole = r.ok && r.payload.role === wantRole
    const ok = r.ok && okRole
    if (!ok) failed++
    console.log(
      `  ${ok ? '✅' : '🔴'} ${name.padEnd(14)} role=${r.payload?.role ?? '-'} ` +
        `aud=${r.payload?.aud ?? '-'} ${r.ok ? '' : '→ ' + r.reason}`
    )
  }
  // 反向用例：篡改签名必须失败
  const tampered = anon.token.slice(0, -3) + 'AAA'
  const t = verify(tampered, secret)
  console.log(`  ${t.ok ? '🔴' : '✅'} 篡改签名应被拒绝：${t.ok ? '未拒绝（异常）' : '已拒绝'}`)
  if (t.ok) failed++
  console.log('')
}

// ---------------- 输出 / 写入 ----------------
if (flag('--write')) {
  const envFile = path.join(ROOT, '.env')
  if (!existsSync(envFile)) {
    writeFileSync(envFile, readFileSync(path.join(ROOT, '.env.example'), 'utf8'))
  }
  let content = readFileSync(envFile, 'utf8')
  const set = (key, val) => {
    const re = new RegExp(`^${key}=.*$`, 'm')
    content = re.test(content)
      ? content.replace(re, `${key}=${val}`)
      : `${content}\n${key}=${val}\n`
  }
  set('ANON_KEY', anon.token)
  set('SERVICE_ROLE_KEY', service.token)
  writeFileSync(envFile, content)
  console.log('已写入 .env：ANON_KEY / SERVICE_ROLE_KEY')
} else {
  console.log(`ANON_KEY=${anon.token}`)
  console.log(`SERVICE_ROLE_KEY=${service.token}`)
}

process.exit(failed > 0 ? 1 : 0)
