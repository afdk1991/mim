/**
 * Supabase 后端全链路回归（真实 HTTP 调用，非静态推断）
 *
 * 用法：
 *   node scripts/smoke-supabase.mjs                # 只读检查（默认，零副作用）
 *   node scripts/smoke-supabase.mjs --with-auth    # 追加注册/登录/会话链路（留下一个冒烟账号）
 *
 * 覆盖（默认）：
 *   1) GoTrue /auth/v1/settings：github provider 已启用
 *   2) PostgREST 匿名读公开表（posts / profiles / articles / topics / hot_searches / resources）
 *   3) RLS 私有表隔离：匿名读 favorites 不泄漏任何行
 *   4) RPC bump_article_views 可匿名调用（不存在的 id ⇒ 零副作用）
 *   5) Storage 桶 mim-media 存在性（404 = 迁移 0002 未执行，记 WARN 不计失败）
 *   6) GitHub OAuth authorize URL 生成（skipBrowserRedirect，不真实跳转）
 * 覆盖（--with-auth，追加）：
 *   7) 注册（合成邮箱）→ 登录 → /auth/v1/user 会话 → profiles 触发器建档
 *      → 带 JWT 访问 PostgREST 私有表
 *
 * 退出码：无失败 0，有失败 1（WARN 不影响退出码）。
 */
import { createClient } from '@supabase/supabase-js'

const URL_ = (process.env.VITE_SUPABASE_URL || 'https://sepfobukokrrivwyvhnd.supabase.co').replace(/\/+$/, '')
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_TV4e4DtFiufiJiY05WSFsQ_2FmlMCUg'
const WITH_AUTH = process.argv.includes('--with-auth')

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

function note(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    warn++
    console.log(`  ⚠️ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function api(path, { method = 'GET', body, jwt } = {}) {
  const headers = { apikey: ANON }
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json, text }
}

async function main() {
  console.log(`\n=== Supabase 回归 · ${URL_}${WITH_AUTH ? ' · --with-auth' : ''} ===\n`)

  // 1) GoTrue settings：github 已启用
  const settings = await api('/auth/v1/settings')
  const githubOn = settings.status === 200 && settings.json?.external?.github === true
  check('GET /auth/v1/settings → 200 且 github provider 启用', githubOn, `HTTP ${settings.status}`)

  // 2) 匿名读公开表
  for (const t of ['posts', 'profiles', 'articles', 'topics', 'hot_searches', 'resources']) {
    const r = await api(`/rest/v1/${t}?select=*&limit=1`)
    check(`匿名读 ${t} → 200 数组`, r.status === 200 && Array.isArray(r.json), `HTTP ${r.status}`)
  }

  // 3) RLS 私有表隔离：匿名读 favorites 不得泄漏任何行
  const fav = await api('/rest/v1/favorites?select=*&limit=1')
  check(
    'RLS：匿名读 favorites 不泄漏（200 且空数组）',
    fav.status === 200 && Array.isArray(fav.json) && fav.json.length === 0,
    `HTTP ${fav.status} rows=${Array.isArray(fav.json) ? fav.json.length : 'n/a'}`,
  )

  // 4) RPC 匿名可调（不存在的 id ⇒ 无数据被改动）
  const rpc = await api('/rest/v1/rpc/bump_article_views', {
    method: 'POST',
    body: { p_id: '__smoke_nonexistent__' },
  })
  check('RPC bump_article_views 匿名可调（返回 null，零副作用）', rpc.status === 200, `HTTP ${rpc.status}`)

  // 5) Storage 桶存在性（迁移 0002 未执行时桶不存在 → WARN）
  //    注：node fetch 对不存在桶返回 400 而 curl 返回 404（外层网关差异），
  //    以响应体中的 Bucket not found / NoSuchBucket 为准判定。
  const bucket = await api('/storage/v1/bucket/mim-media')
  const bucketMissing = /bucket not found|nosuchbucket/i.test(bucket.text)
  if (bucket.status === 200) {
    note('Storage 桶 mim-media 存在', true)
  } else if (bucketMissing) {
    note(
      'Storage 桶 mim-media 存在',
      false,
      '桶不存在 — 迁移 0002_storage_media.sql 未执行（Dashboard → SQL Editor 粘贴执行）',
    )
  } else {
    note('Storage 桶 mim-media 存在', false, `HTTP ${bucket.status} ${bucket.text.slice(0, 120)}`)
  }

  // 6) OAuth authorize URL（免跳转）
  const sb = createClient(URL_, ANON)
  const { data: oauth, error: oauthErr } = await sb.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: 'https://afdk1991.github.io/mim/', skipBrowserRedirect: true },
  })
  const url = oauth?.url ?? ''
  check(
    'GitHub OAuth authorize URL 生成（provider=github + redirect_to）',
    !oauthErr && url.includes('/auth/v1/authorize') && url.includes('provider=github') && url.includes('redirect_to='),
    oauthErr?.message ?? '',
  )

  // 7) --with-auth：注册 → 登录 → 会话 → 建档 → JWT 访问私有表
  //    注：新版 GoTrue 的 signup/token 响应为扁平会话字段
  //    （{access_token, refresh_token, user}，无 session 包装；supabase-js
  //    SDK 会归一化为 {user, session}，故前端适配层不受影响）。
  if (WITH_AUTH) {
    const email = `smoke_${Date.now()}@mim.app`
    const password = 'Smoke@2026'
    const up = await api('/auth/v1/signup', { method: 'POST', body: { email, password } })
    const uid = up.json?.user?.id
    const access = up.json?.access_token
    check('注册冒烟账号（合成邮箱）→ 200 且返回会话', up.status === 200 && !!uid && !!access, `HTTP ${up.status}`)

    if (uid && access) {
      const inR = await api('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email, password },
      })
      const jwt = inR.json?.access_token
      check('登录（password grant）→ 200 且拿到 access_token', inR.status === 200 && !!jwt, `HTTP ${inR.status}`)

      const me = await api('/auth/v1/user', { jwt })
      check('GET /auth/v1/user（Bearer JWT）→ 200 且 id 一致', me.status === 200 && me.json?.id === uid, `HTTP ${me.status}`)

      const prof = await api(`/rest/v1/profiles?select=id,name&id=eq.${uid}`)
      check(
        'profiles 触发器自动建档（注册即 1 行）',
        prof.status === 200 && Array.isArray(prof.json) && prof.json.length === 1,
        `HTTP ${prof.status} rows=${Array.isArray(prof.json) ? prof.json.length : 'n/a'}`,
      )

      const own = await api('/rest/v1/favorites?select=*&limit=1', { jwt })
      check('带 JWT 读私有表 favorites → 200（RLS 放行本人空集）', own.status === 200, `HTTP ${own.status}`)
    }
  }

  console.log(`\n=== 结果：✅ ${pass} 通过 · ❌ ${fail} 失败 · ⚠️ ${warn} 警告 ===\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
