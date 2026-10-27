/**
 * Mim · 管理后台授权脚本（把指定账号提升为 admin）
 *
 * 为什么需要它：注册触发器只分配默认角色 user，而 user_roles 写策略要求
 *   调用者已是 admin —— 没有显式授权这一步，/#/admin 对所有人恒为无权限。
 *   本脚本走云端通道（Management API），只需 Access Token，不接触数据库密码。
 *
 * 用法：
 *   # 授权（用户名或邮箱均可；用户名会按 <username>@mim.app 合成匹配）
 *   SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=sepfobukokrrivwyvhnd \
 *     node scripts/grant-admin.mjs -- alice
 *
 *   # 只列出最近注册的 20 个账号（用于确认用户名）
 *   … node scripts/grant-admin.mjs --list
 *
 *   # 查看当前已有的管理员
 *   … node scripts/grant-admin.mjs --who
 *
 * 依赖：需先应用 0010_admin_bootstrap.sql（提供 public.grant_admin_by_name）。
 *   未应用时脚本会给出提示，可先跑 npm run db:apply:remote。
 *
 * 另：本脚本不具备「绕过前端引导」之外的权限，授予动作在数据库侧完成，
 *   授权后目标账号刷新页面即可看到「🛡️ 管理后台」入口（无需重新登录）。
 */
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim()

const args = process.argv.slice(2)
const flag = args.find((a) => a.startsWith('--'))
const name = args.find((a) => !a.startsWith('--'))

const ENDPOINT = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

async function runSql(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 400)}`)
  }
  return res.json()
}

/** Management API 无法参数化，对用户名做白名单校验（允许中文用户名，禁引号与空白） */
const NAME_RE = /^[^\s'"\\;,()]+$/

function show(label, rows) {
  console.log(`\n${label}`)
  if (!rows || rows.length === 0) {
    console.log('   （无）')
    return
  }
  for (const r of rows) console.log('   ' + Object.values(r).join('  ·  '))
}

if (!token || !projectRef) {
  console.log('ℹ️ 未配置 SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF。')
  console.log('   生成入口：supabase.com/dashboard/account/tokens')
  console.log('   项目 Ref：Dashboard → Project Settings → General → Reference ID')
  console.log('   也可以改用零凭证通道：Supabase Dashboard → SQL Editor 粘贴 supabase/grant-admin.sql')
  process.exit(0)
}

try {
  console.log(`🔌 连接项目 ${projectRef} …`)

  if (flag === '--list') {
    const rows = await runSql(
      `select email, created_at from auth.users order by created_at desc limit 20`,
    )
    show('最近注册的账号：', rows)
    console.log('\n   用 node scripts/grant-admin.mjs -- <用户名> 授予 admin。')
    process.exit(0)
  }

  if (flag === '--who') {
    const rows = await runSql(
      `select u.email, r.name as role, ur.user_id
         from public.user_roles ur
         join auth.users u on u.id = ur.user_id
         join public.roles r on r.id = ur.role_id
        where r.name = 'admin'`,
    )
    show('当前管理员：', rows)
    process.exit(0)
  }

  if (!name) {
    console.log('用法：node scripts/grant-admin.mjs -- <用户名或邮箱>')
    console.log('      node scripts/grant-admin.mjs --list   （列出最近注册的账号）')
    console.log('      node scripts/grant-admin.mjs --who    （列出当前管理员）')
    process.exit(0)
  }

  if (!NAME_RE.test(name)) {
    console.error(`❌ 用户名含非法字符（禁止空白与引号等）：${name}`)
    process.exit(1)
  }

  console.log(`👑 为 ${name} 授予 admin 角色…`)
  const rows = await runSql(`select public.grant_admin_by_name('${name}') as result`)
  console.log('   ' + (rows?.[0]?.result ?? '(无返回)'))

  const admins = await runSql(
    `select u.email from public.user_roles ur
       join auth.users u on u.id = ur.user_id
       join public.roles r on r.id = ur.role_id
      where r.name = 'admin'`,
  )
  show('当前管理员：', admins)
} catch (err) {
  const msg = String(err.message ?? err)
  if (msg.includes('does not exist') && msg.includes('grant_admin_by_name')) {
    console.error('❌ 数据库缺少 public.grant_admin_by_name：请先应用迁移 0010_admin_bootstrap.sql')
    console.error('   npm run db:apply:remote   （或本地 npm run db:apply）')
  } else {
    console.error('❌ 授权失败：', msg)
  }
  process.exit(1)
}
