/* ============================================================================
 * V1~V8 真实压测脚本（本机连库实测，非推断）
 *
 * 用途：对 server/src/rpc.js 的秒杀/出行/钱包/同步链路做真实 HTTP + SQL 断言。
 * 运行方式（先确保 server 已启动、DATABASE_URL 指向测试库）：
 *   $env:DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/mim'
 *   node scripts/loadtest-v1-v8.mjs
 * 退出码：全部断言通过=0；任一失败=1。结果同时打印为 JSON 行。
 * 注意：本脚本会写入测试数据（测试用户/场次/订单/动态），仅用于本机测试库。
 * ========================================================================== */

import pg from 'pg'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const results = []
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${detail}`)
}

async function rpc(token, fn, params) {
  const res = await fetch(`${BASE}/api/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params ?? {}),
  })
  let body = null
  try { body = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, body }
}

async function register(username, password = 'test123456') {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json()
  return { status: res.status, token: body?.data?.token, user: body?.data?.user }
}

const now = Date.now()

/* ---------------- V1 秒杀并发不超卖 ---------------- */
async function V1() {
  // 造库存 20 的活跃场次
  await pool.query(
    `insert into seckill_sessions (id, goods_id, title, price_cents, start_at, end_at, remaining, total, limit_per_user, status)
     values ('s_v1','g_v1','V1压测场',100,$1,$2,20,20,2,'active')`,
    [now - 5000, now + 3_600_000],
  )
  // 40 个并发用户，各抢 1 件
  const users = await Promise.all(Array.from({ length: 40 }, (_, i) => register(`v1u_${Date.now()}_${i}`)))
  const t0 = Date.now()
  const grabs = await Promise.all(
    users.map((u) => rpc(u.token, 'seckill_grab', { p_session_id: 's_v1', p_qty: 1, p_order_id: `v1ord_${users.indexOf(u)}` })),
  )
  const ms = Date.now() - t0
  const ok = grabs.filter((g) => g.status === 200).length
  const conflict = grabs.filter((g) => g.status === 409).length
  const sess = (await pool.query('select remaining, total from seckill_sessions where id=$1', ['s_v1'])).rows[0]
  const locks = (await pool.query('select count(*)::int n, coalesce(sum(qty),0)::int q from seckill_lock_items where session_id=$1', ['s_v1'])).rows[0]
  const noNeg = Number(sess.remaining) >= 0
  const soldEq = Number(sess.total) - Number(sess.remaining) === ok
  const pass = noNeg && ok === 20 && conflict === 20 && soldEq && locks.q === 20
  record('V1', '秒杀并发不超卖', pass,
    `并发40/库存20 → 成功${ok} 冲突${conflict} remaining=${sess.remaining}/${sess.total} 锁qty合计=${locks.q} 耗时${ms}ms`)
}

/* ---------------- V2 限购 + 锁过期回补 ---------------- */
async function V2() {
  await pool.query(
    `insert into seckill_sessions (id, goods_id, title, price_cents, start_at, end_at, remaining, total, limit_per_user, status)
     values ('s_v2','g_v2','V2压测场',100,$1,$2,100,100,2,'active')`,
    [now - 5000, now + 3_600_000],
  )
  const alice = await register(`alice_${Date.now()}`)
  const g1 = await rpc(alice.token, 'seckill_grab', { p_session_id: 's_v2', p_qty: 2, p_order_id: 'v2_A' })
  const g2 = await rpc(alice.token, 'seckill_grab', { p_session_id: 's_v2', p_qty: 1, p_order_id: 'v2_B' })
  // 把 alice 的锁行过期
  await pool.query(`update seckill_lock_items set expire_at=$1 where session_id='s_v2' and user_id=$2`, [now - 1000, alice.user.id])
  const before = Number((await pool.query('select remaining from seckill_sessions where id=$1', ['s_v2'])).rows[0].remaining)
  const g3 = await rpc(alice.token, 'seckill_grab', { p_session_id: 's_v2', p_qty: 1, p_order_id: 'v2_C' })
  const after = Number((await pool.query('select remaining from seckill_sessions where id=$1', ['s_v2'])).rows[0].remaining)
  // g1=成功(98)，g2=限购冲突(409)；过期后 g3 应成功，且 remaining 被回补 2 后再扣 1：100-2(过期回补? 见下)
  // 初始100 → g1扣2=98 → 过期2 → g3: 懒清理回补2=100 再扣1=99
  const pass = g1.status === 200 && g2.status === 409 && g3.status === 200 && after === 99 && before === 98
  record('V2', '限购+锁过期回补', pass,
    `grab2件=${g1.status} 再抢1件=${g2.status}(应409) 过期后再抢=${g3.status} remaining ${before}→${after}(应98→99)`)
}

/* ---------------- V3 BE-002 订单粒度释放 ---------------- */
async function V3() {
  await pool.query(
    `insert into seckill_sessions (id, goods_id, title, price_cents, start_at, end_at, remaining, total, limit_per_user, status)
     values ('s_v3','g_v3','V3压测场',100,$1,$2,10,10,10,'active')`,
    [now - 5000, now + 3_600_000],
  )
  const alice = await register(`alice3_${Date.now()}`)
  await rpc(alice.token, 'seckill_grab', { p_session_id: 's_v3', p_qty: 3, p_order_id: 'MO-A' })
  await rpc(alice.token, 'seckill_grab', { p_session_id: 's_v3', p_qty: 2, p_order_id: 'MO-B' })
  const r1 = Number((await pool.query('select remaining from seckill_sessions where id=$1', ['s_v3'])).rows[0].remaining) // 10-5=5
  const rel = await rpc(alice.token, 'seckill_release', { p_session_id: 's_v3', p_order_id: 'MO-A' })
  const r2 = Number((await pool.query('select remaining from seckill_sessions where id=$1', ['s_v3'])).rows[0].remaining) // 5+3=8
  const bRow = (await pool.query(`select qty from seckill_lock_items where session_id='s_v3' and user_id=$1 and order_id='MO-B'`, [alice.user.id])).rows[0]
  const aGone = (await pool.query(`select count(*)::int n from seckill_lock_items where session_id='s_v3' and order_id='MO-A'`, [])).rows[0].n
  const pass = r1 === 5 && rel.body?.data?.released === 3 && r2 === 8 && Number(bRow.qty) === 2 && aGone === 0
  record('V3', 'BE-002订单粒度释放', pass,
    `两单3+2后remaining=${r1}(应5) 释放MO-A released=${rel.body?.data?.released}(应3) remaining=${r2}(应8) MO-B仍锁qty=${bRow?.qty}(应2)`)
}

/* ---------------- V4/V5 出票闭环 + 退票幂等 ---------------- */
async function V4V5() {
  await pool.query(
    `insert into travel_tickets (id, kind, title, emoji, from_city, to_city, price_cents) values ('tk1','train','V5测试票','🚄','A','B',10000)`)
  await pool.query(
    `insert into travel_date_stock (ticket_id, date, remaining, price_cents) values ('tk1','2099-01-01',50,10000)`)
  await pool.query(
    `insert into travel_rules (ticket_id, refundable, fee_rate, cutoff_hours) values ('tk1',true,0.1,0)`)
  const alice = await register(`alice4_${Date.now()}`)
  // SQL 造 pending_ticket 出行单（V5：验证从 pending_ticket 出发）
  const order = {
    id: 'MO-T1', goods_id: 'tk1', title: 'V5测试票', emoji: '🚄', amount_fen: 10000, qty: 1,
    channel: 'laal', status: 'paid', biz_kind: 'travel', biz_status: 'pending_ticket',
    ext: { kind: 'travel', ticketId: 'tk1', date: '2099-01-01', passengers: ['张三'], seatClass: '二等', passengerCount: 1, rule: { ticketId: 'tk1', refundable: true, changeable: true, feeRate: 0.1, cutoffHours: 0, note: '' } },
  }
  await pool.query(
    `insert into mall_orders (id,user_id,goods_id,title,emoji,amount_fen,qty,channel,status,biz_kind,ext,biz_status,at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
    [order.id, alice.user.id, order.goods_id, order.title, order.emoji, order.amount_fen, order.qty, order.channel, order.status, order.biz_kind, JSON.stringify(order.ext), order.biz_status, now],
  )
  // V5: 出票
  const issue = await rpc(alice.token, 'travel_issue', { p_order_id: 'MO-T1' })
  const st1 = (await pool.query(`select biz_status from mall_orders where id='MO-T1'`)).rows[0].biz_status
  // V4: 退票两次
  const rf1 = await rpc(alice.token, 'travel_refund', { p_order_id: 'MO-T1' })
  const rf2 = await rpc(alice.token, 'travel_refund', { p_order_id: 'MO-T1' })
  const incomeCnt = (await pool.query(
    `select count(*)::int n from wallet_txs where user_id=$1 and kind='income' and snapshot->>'refund_order_id'='MO-T1'`, [alice.user.id])).rows[0].n
  const pass = issue.status === 200 && st1 === 'ticketed'
    && rf1.status === 200 && rf1.body?.data?.refund_fen === 9000 && rf2.status === 409 && incomeCnt === 1
  record('V4/V5', '出票闭环+退票幂等', pass,
    `issue=${issue.status}(应200) biz_status=${st1}(应ticketed) 首退=${rf1.status} refund=${rf1.body?.data?.refund_fen}(应9000) 二退=${rf2.status}(应409) income流水=${incomeCnt}(应1)`)
}

/* ---------------- V6 travel_release 归属五档 ---------------- */
async function V6() {
  const alice = await register(`alice6_${Date.now()}`)
  const bob = await register(`bob6_${Date.now()}`)
  // alice 的未支付单
  await pool.query(
    `insert into mall_orders (id,user_id,amount_fen,qty,status,biz_kind,ext,biz_status,at) values
      ('MO-R1',$1,1000,1,'unpaid','travel','{"kind":"travel","ticketId":"tk1","date":"2099-01-01"}'::jsonb,'pending_ticket',$2),
      ('MO-R2',$3,1000,1,'paid','travel','{"kind":"travel","ticketId":"tk1","date":"2099-01-01"}'::jsonb,'ticketed',$2)`,
    [alice.user.id, now, bob.user.id],
  )
  const ownUnpaid = await rpc(alice.token, 'travel_release', { p_ticket_id: 'tk1', p_date: '2099-01-01', p_qty: 1, p_order_id: 'MO-R1' })
  const other = await rpc(alice.token, 'travel_release', { p_ticket_id: 'tk1', p_date: '2099-01-01', p_qty: 1, p_order_id: 'MO-R2' })
  const missing = await rpc(alice.token, 'travel_release', { p_ticket_id: 'tk1', p_date: '2099-01-01', p_qty: 1 })
  const noOrder = await rpc(alice.token, 'travel_release', { p_ticket_id: 'tk1', p_date: '2099-01-01', p_qty: 1, p_order_id: 'NO-SUCH' })
  const paidOwn = await rpc(bob.token, 'travel_release', { p_ticket_id: 'tk1', p_date: '2099-01-01', p_qty: 1, p_order_id: 'MO-R2' })
  const pass = ownUnpaid.status === 200 && ownUnpaid.body?.data?.released === 1
    && other.status === 403 && missing.status === 400 && noOrder.status === 404
    && paidOwn.status === 200 && paidOwn.body?.data?.released === 0
  record('V6', 'travel_release归属五档', pass,
    `本人未付=${ownUnpaid.status}/rel${ownUnpaid.body?.data?.released} 他人=${other.status}(应403) 缺参=${missing.status}(应400) 不存在=${noOrder.status}(应404) 本人已付=${paidOwn.status}/rel${paidOwn.body?.data?.released}(应0)`)
}

/* ---------------- V7 同步游标增量/断点 ---------------- */
async function V7() {
  const alice = await register(`alice7_${Date.now()}`)
  // 造 12 条公开动态：每条间隔 5ms——0006 触发器会把 updated_at 覆写为 clock_timestamp()，
  // 挤在同一毫秒的行会因游标 updated_at > since 被整批跳过（BE-005），故需真实错开水位。
  for (let i = 0; i < 12; i++) {
    await pool.query(
      `insert into posts (author_id, content, visibility, created_at, updated_at) values ($1,$2,'public',$3,$3)`,
      [alice.user.id, `sync-${i}`, now + i * 10],
    )
    await new Promise((r) => setTimeout(r, 5))
  }
  const wrong = await fetch(`${BASE}/api/sync/posts?since=0&limit=5`, { headers: { 'x-sync-token': 'wrong' } })
  // 分页拉全
  let since = 0, all = []
  for (let page = 0; page < 5; page++) {
    const r = await fetch(`${BASE}/api/sync/posts?since=${since}&limit=5`, { headers: { 'x-sync-token': 'sync-test-token-abc123' } })
    const j = await r.json()
    all = all.concat(j.data.rows)
    if (!j.data.has_more) break
    since = j.data.next
  }
  const ids = all.map((x) => x.id)
  const noDup = new Set(ids).size === ids.length
  const got12 = all.length >= 12
  const pass = wrong.status === 403 && noDup && got12
  record('V7', '同步游标增量断点', pass,
    `错token=${wrong.status}(应403) 拉取${all.length}行(应≥12) 去重后=${new Set(ids).size} 无重=${noDup}`)
}

/* ---------------- V8 并发取码不重复 ---------------- */
async function V8() {
  await pool.query(
    `insert into local_merchants (id, name) values ('m1','测试门店')`)
  await pool.query(
    `insert into local_vouchers (id, merchant_id, title, price_cents, value_cents, valid_until, remaining, status)
     values ('v1','m1','测试套餐',1000,2000,$1,100,'active')`, [now + 86_400_000])
  const alice = await register(`alice8_${Date.now()}`)
  await pool.query(
    `insert into mall_orders (id,user_id,goods_id,title,amount_fen,qty,status,biz_kind,ext,biz_status,at)
     values ('MO-V1',$1,'v1','测试套餐',1000,1,'paid','local','{"kind":"local","voucherId":"v1"}'::jsonb,'pending_verify',$2)`,
    [alice.user.id, now],
  )
  const t0 = Date.now()
  const calls = await Promise.all(
    Array.from({ length: 20 }, () => rpc(alice.token, 'issue_voucher_code', { p_order_id: 'MO-V1', p_voucher_id: 'v1' })),
  )
  const ms = Date.now() - t0
  const codes = (await pool.query(`select count(*)::int n, max(code) as code from local_voucher_codes where order_id='MO-V1'`)).rows[0]
  const oks = calls.filter((c) => c.status === 200).length
  const single = Number(codes?.n ?? 0) === 1
  const allSame = new Set(calls.filter((c) => c.body?.data?.code).map((c) => c.body.data.code)).size <= 1
  record('V8', '并发取码唯一', single,
    `并发20 成功200=${oks} DB码行数=${codes?.n}(应1) 返回码去重后=${new Set(calls.filter(c=>c.body?.data?.code).map(c=>c.body.data.code)).size}(≤1) 耗时${ms}ms`)
}

/* ---------------- 主流程 ---------------- */
async function cleanup() {
  await pool.query(`delete from seckill_sessions where id like 's_v%'`)
  await pool.query(`delete from seckill_lock_items where session_id like 's_v%'`)
  await pool.query(`delete from mall_orders where id like 'MO-%'`)
  await pool.query(`delete from local_voucher_codes where order_id like 'MO-%'`)
  await pool.query(`delete from travel_tickets where id='tk1'`)
  await pool.query(`delete from local_merchants where id='m1'`)
  await pool.query(`delete from posts where content like 'sync-%'`)
}

try {
  await cleanup()
  await V1(); await V2(); await V3(); await V4V5(); await V6(); await V7(); await V8()
} catch (e) {
  console.error('脚本异常', e)
  process.exitCode = 1
} finally {
  await pool.end()
}
const failed = results.filter((r) => !r.pass)
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((f) => f.id) }, null, 2))
process.exitCode = failed.length ? 1 : 0
