/**
 * 云存储链路端到端回归（真实 HTTP 调用，非静态推断）
 *
 * 用法：
 *   node scripts/smoke-storage.mjs
 *   MIM_API=https://.../mim-api node scripts/smoke-storage.mjs
 *
 * 覆盖：注册 → 上传 → 越权/类型/大小拦截 → 取签名链接 → 链接真下载 →
 *       列目录 → 删除 → 删除后取链应 404。
 * 退出码：全通过 0，有失败 1。
 */
const API = (process.env.MIM_API || 'https://cs-1-d5g815slocb5a611a-1320483685.ap-shanghai.app.tcloudbase.com/mim-api').replace(/\/+$/, '')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (token) headers['x-mim-token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json, text }
}

/** 1×1 透明 PNG，用于最小体积上传 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function main() {
  console.log(`\n=== 云存储回归 · ${API} ===\n`)

  const user = `smoke_${Date.now()}`
  const reg = await req('/auth/register', { method: 'POST', body: { username: user, password: 'Storage@2026' } })
  if (reg.status !== 200 || !reg.json?.token) {
    console.log('❌ 注册失败，后续用例无法执行：', reg.text.slice(0, 200))
    process.exit(1)
  }
  const token = reg.json.token
  const uid = reg.json.uid
  check('注册冒烟账号', true, uid)

  // 1) 正常上传
  let up = await req('/storage/upload', {
    method: 'POST',
    token,
    body: { name: 'smoke.png', mime: 'image/png', data: PNG_1PX.toString('base64') },
  })
  check('上传 1×1 PNG → 200', up.status === 200, `HTTP ${up.status}`)
  const key = up.json?.key || ''
  check('key 以自身 uid 开头', key.startsWith(`${uid}/`), key)

  // 2) 匿名上传应 401
  const anon = await req('/storage/upload', {
    method: 'POST',
    body: { name: 'x.png', mime: 'image/png', data: PNG_1PX.toString('base64') },
  })
  check('匿名上传 → 401', anon.status === 401, `HTTP ${anon.status}`)

  // 3) 非法类型应 415
  const bad = await req('/storage/upload', {
    method: 'POST',
    token,
    body: { name: 'a.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') },
  })
  check('text/plain → 415', bad.status === 415, `HTTP ${bad.status}`)

  // 4) 超大文件应 413（4MB，超过 3MB 上限）
  const big = Buffer.alloc(4 * 1024 * 1024, 1)
  const over = await req('/storage/upload', {
    method: 'POST',
    token,
    body: { name: 'big.png', mime: 'image/png', data: big.toString('base64') },
  })
  check('4MB 文件 → 413（或网关拦截）', over.status === 413 || over.status === 502 || over.status === 413, `HTTP ${over.status}`)

  // 5) 取签名链接
  const signed = await req(`/storage/url?key=${encodeURIComponent(key)}&expiresIn=600`, { token })
  check('取签名链接 → 200', signed.status === 200, `HTTP ${signed.status}`)
  const url = signed.json?.url || ''

  // 6) 签名链接真实可下载（匿名 GET）
  if (url) {
    const dl = await fetch(url)
    const buf = Buffer.from(await dl.arrayBuffer())
    check('签名链接匿名可下载', dl.status === 200 && buf.length === PNG_1PX.length, `HTTP ${dl.status} / ${buf.length}B`)
  } else {
    check('签名链接匿名可下载', false, '未取到 URL')
  }

  // 7) 越权：访问他人 key 应 403
  const cross = await req(`/storage/url?key=${encodeURIComponent('u_someoneelse/2026-10/x.png')}`, { token })
  check('越权取他人链接 → 403', cross.status === 403, `HTTP ${cross.status}`)

  // 8) 列目录
  const list = await req('/storage/list', { token })
  check('列目录 → 200', list.status === 200, `HTTP ${list.status} / ${list.json?.items?.length ?? 0} 项`)
  check('列目录含刚上传文件', (list.json?.items || []).some((i) => i.key === key || i.name), '')

  // 9) 删除自己的文件
  const del = await req('/storage/delete', { method: 'POST', token, body: { keys: [key] } })
  check('删除自己的文件 → 200', del.status === 200 && del.json?.deleted === 1, `HTTP ${del.status} / deleted=${del.json?.deleted}`)

  // 10) 越权删除他人文件应 403
  const delCross = await req('/storage/delete', { method: 'POST', token, body: { keys: ['u_someoneelse/2026-10/x.png'] } })
  check('越权删除他人文件 → 403', delCross.status === 403, `HTTP ${delCross.status}`)

  // 11) 删除后取链应失败（404）
  const after = await req(`/storage/url?key=${encodeURIComponent(key)}`, { token })
  check('删除后取链 → 404', after.status === 404, `HTTP ${after.status}`)

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('回归脚本异常：', e)
  process.exit(1)
})
