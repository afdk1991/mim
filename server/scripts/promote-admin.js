/* ============================================================================
 * 管理员授予 —— node scripts/promote-admin.js <username|userId> [--revoke]
 *
 * 用途：全新库没有任何管理员时的官方出口之一（另一个是 BOOTSTRAP_ADMIN_USERNAME
 * 环境变量）。为避免误用，脚本只在本库尚无管理员时才允许操作；已有管理员时请走
 * 后台「角色管理」界面。
 * ========================================================================== */

import { one, pool, query } from '../src/db.js'

async function adminRow() {
  return one(`select id from roles where name = 'admin'`)
}

async function hasAdmin() {
  const r = await one(
    `select 1 as hit from user_roles ur join roles r on r.id = ur.role_id where r.name = 'admin' limit 1`,
  )
  return !!r
}

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => !a.startsWith('--'))
  const revoke = args.includes('--revoke')
  if (!target) {
    console.error('用法：node scripts/promote-admin.js <username|userId> [--revoke]')
    process.exitCode = 1
    return
  }

  await adminRow()
  const existing = await hasAdmin()

  const user = await one(
    `select id, username from users where username = $1 or id::text = $1 limit 1`,
    [target],
  )
  if (!user) {
    console.error(`未找到用户：${target}`)
    process.exitCode = 1
    return
  }

  if (revoke) {
    await query(
      `delete from user_roles ur using roles r
        where ur.role_id = r.id and r.name = 'admin' and ur.user_id = $1`,
      [user.id],
    )
    console.log(`已撤销 ${user.username} 的管理员角色`)
    return
  }

  if (existing) {
    console.error('库中已存在管理员，拒绝再次授予（请走后台角色管理，或先 --revoke）')
    process.exitCode = 1
    return
  }

  await query(
    `insert into user_roles (user_id, role_id)
     select $1, r.id from roles r where r.name = 'admin'
     on conflict do nothing`,
    [user.id],
  )
  await query(
    `insert into audit_logs (actor_id, action, target_type, target_id, detail)
     values ($1, 'bootstrap_admin', 'user', $2, jsonb_build_object('source', 'cli'))`,
    [user.id, String(user.id)],
  )
  console.log(`已授予 ${user.username}（${user.id}）管理员角色`)
}

main()
  .catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
