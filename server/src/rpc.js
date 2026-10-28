/* ============================================================================
 * 服务端过程 —— /api/rpc/:fn
 *
 * 为什么必须有这一层（不能靠前端「先读后写」）：
 *   · 库存：read-modify-write 在并发下必然超卖。扣减必须是同一事务内的
 *     SELECT … FOR UPDATE + UPDATE … WHERE remaining >= qty 条件更新。
 *   · 券码：发码必须是服务端构造（前端造码 = 可伪造核销凭证）；
 *     核销必须是 UPDATE … WHERE status='unused' 的一次性状态转移。
 *   · 钱包：余额必须服务端计算并原子扣/加，客户端传余额 = 任意改余额。
 *
 * 失败一律抛 ApiError（→ HTTP 状态码 + {error:{code,message}}），
 * 成功返回值直接作为 {data:…} 下发。
 * ========================================================================== */

import { createHash, randomUUID } from 'node:crypto'
import { one, query, tx } from './db.js'
import { badRequest, conflict, forbidden, notFound, schemaError } from './errors.js'

const DAY_MS = 86_400_000
const SEC_LOCK_MS = Number(process.env.SECKILL_LOCK_MS ?? 15 * 60 * 1000)
const VOUCHER_MAX_MS = Number(process.env.VOUCHER_MAX_DAYS ?? 90) * DAY_MS

/* ---------- 参数解析 ---------- */

function str(p, name, { min = 1, max = 2000, trim = true } = {}) {
  const v = p?.[name]
  if (typeof v !== 'string' && typeof v !== 'number') throw badRequest(`缺少参数：${name}`)
  const s = trim ? String(v).trim() : String(v)
  if (s.length < min) throw badRequest(`参数 ${name} 不能为空`)
  if (s.length > max) throw badRequest(`参数 ${name} 过长（上限 ${max}）`)
  return s
}

function int(p, name, { min = 1, max = 1_000_000_000, def = undefined } = {}) {
  const v = p?.[name]
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def
    throw badRequest(`缺少参数：${name}`)
  }
  const n = Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`参数 ${name} 需为整数`)
  if (n < min || n > max) throw badRequest(`参数 ${name} 需在 ${min}~${max} 之间`)
  return n
}

function bool(p, name, def = false) {
  const v = p?.[name]
  if (v === undefined || v === null) return def
  return v === true || v === 'true' || v === 1 || v === '1'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidParam(p, name) {
  const v = typeof p?.[name] === 'string' ? p[name].trim() : ''
  if (!UUID_RE.test(v)) throw notFound('用户不存在或不支持私信')
  return v
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function dateParam(p, name) {
  const v = String(p?.[name] ?? '').trim().slice(0, 10)
  if (!DATE_RE.test(v)) throw badRequest(`参数 ${name} 需为 YYYY-MM-DD，收到 ${String(p?.[name])}`)
  return v
}

const ORDER_STATUS = ['unpaid', 'awaiting_confirm', 'paid', 'done']
const BIZ_KINDS = ['seckill', 'local', 'live', 'travel']

/* ==========================================================================
 * 四业务：库存 / 券码 / 退票
 * ========================================================================== */

/** 秒杀抢购：行锁 + 条件更新 + 限购锁三位一体，返回 {remaining, qty} */
async function seckill_grab(ctx, p) {
  const sessionId = str(p, 'p_session_id', { max: 200 })
  const qty = int(p, 'p_qty', { min: 1, max: 999 })
  const orderId = p.p_order_id === undefined || p.p_order_id === null ? null : str(p, 'p_order_id', { max: 200 })

  return tx(async (c) => {
    const s = (await c.query('select * from seckill_sessions where id = $1 for update', [sessionId])).rows[0]
    if (!s) throw notFound('秒杀场次不存在')
    if (s.status !== 'active') throw conflict('该秒杀场次已关闭')

    const now = Date.now()
    if (now < s.start_at) throw conflict('秒杀尚未开始')
    if (now >= s.end_at) throw conflict('秒杀已结束')

    // AN-004 懒清理（主路径）：本会话里已过期未付的锁，在这里 DELETE 即「认领」回补库存。
    // 已持本会话行锁（上面的 for update），同会话所有 grab 串行，清理与扣减无并发窗口；
    // 与 main.js 的定时器兜底靠「DELETE 即认领」互斥——谁删到过期行谁回补，不会双倍。
    // 过期行先被删，下面的 had 自然只数未过期锁，限购额度同步释放（BE-002 的多单累计
    // 问题不在本次范围，这里只清理真正过期的锁行，不改变仍有效锁的累计语义）。
    const swept = (
      await c.query(
        'delete from seckill_locks where session_id = $1 and expire_at < $2 returning qty',
        [sessionId, now],
      )
    ).rows
    if (swept.length) {
      const freed = swept.reduce((n, r) => n + Number(r.qty), 0)
      if (freed > 0) {
        await c.query(
          'update seckill_sessions set remaining = least(total, remaining + $1) where id = $2',
          [freed, sessionId],
        )
      }
    }

    const had = (await c.query('select qty from seckill_locks where session_id = $1 and user_id = $2', [sessionId, ctx.uid])).rows[0]?.qty ?? 0
    if (had + qty > s.limit_per_user) throw conflict(`每人限购 ${s.limit_per_user} 件，你已抢 ${had} 件`)

    // 条件更新：库存不够时 affected=0，不在应用层做「读库存再判断」
    const up = await c.query(
      'update seckill_sessions set remaining = remaining - $1 where id = $2 and remaining >= $1 returning remaining',
      [qty, sessionId],
    )
    if (!up.rows.length) throw conflict('库存不足，已被抢完')

    await c.query(
      `insert into seckill_locks (session_id, user_id, qty, order_id, expire_at, created_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (session_id, user_id) do update
         set qty = seckill_locks.qty + excluded.qty,
             order_id = coalesce(excluded.order_id, seckill_locks.order_id),
             expire_at = excluded.expire_at`,
      [sessionId, ctx.uid, qty, orderId, now + SEC_LOCK_MS, now],
    )

    return { session_id: sessionId, remaining: up.rows[0].remaining, qty: had + qty, expire_at: now + SEC_LOCK_MS }
  })
}

/** 秒杀释放（取消订单 / 超时未付）：幂等，无锁返回 released=0 */
async function seckill_release(ctx, p) {
  const sessionId = str(p, 'p_session_id', { max: 200 })
  const orderId = p.p_order_id === undefined || p.p_order_id === null ? null : str(p, 'p_order_id', { max: 200 })

  return tx(async (c) => {
    const lock = (
      await c.query(
        `select qty from seckill_locks
          where session_id = $1 and user_id = $2 and order_id is not distinct from $3`,
        [sessionId, ctx.uid, orderId],
      )
    ).rows[0]
    if (!lock) return { released: 0 }
    await c.query('delete from seckill_locks where session_id = $1 and user_id = $2', [sessionId, ctx.uid])
    await c.query(
      'update seckill_sessions set remaining = least(total, remaining + $1) where id = $2',
      [lock.qty, sessionId],
    )
    return { released: lock.qty }
  })
}

/**
 * AN-004 过期锁兜底清理：删除全站 expire_at < now 的秒杀锁并回补对应场次库存。
 *
 * 调用方：main.js 启动时一次 + 进程内 setInterval（周期见 main.js）。
 * 为什么还需要它（懒清理之外的兜底）：懒清理只在「有人再抢同一会场」时才发生，
 * 一个被幽灵单占着库存、再无人问津的老场次永远不会被清理。
 *
 * 并发安全：CTE 里 delete ... returning 即认领——与 seckill_grab 事务内的懒清理互斥，
 * 同一条过期锁行只会被一个事务删掉并回补一次；按 session 聚合后再回补，
 * 避免一次 delete 多行同 session 触发 UPDATE 的「target row updated multiple times」。
 * 重启后定时器丢失可接受：grab 懒清理不依赖本函数，进程重启前已过期的锁
 * 会在下一次该场次被访问时由懒清理补上。
 */
export async function sweepSeckillLocks() {
  const now = Date.now()
  const r = await tx(async (c) =>
    c.query(
      `with expired as (
         delete from seckill_locks where expire_at < $1 returning session_id, qty
       ), agg as (
         select session_id, sum(qty)::int as freed from expired group by session_id
       )
       update seckill_sessions s set remaining = least(s.total, s.remaining + agg.freed)
         from agg where agg.session_id = s.id
       returning agg.session_id as session_id, agg.freed`,
      [now],
    ),
  )
  return r.rows
}

/** 出行占座：按 (票种, 日期) 行锁 + 条件更新 */
async function travel_book(ctx, p) {
  const ticketId = str(p, 'p_ticket_id', { max: 200 })
  const date = dateParam(p, 'p_date')
  const qty = int(p, 'p_qty', { min: 1, max: 999 })
  const orderId = p.p_order_id === undefined || p.p_order_id === null ? null : str(p, 'p_order_id', { max: 200 })

  return tx(async (c) => {
    const stock = (
      await c.query('select * from travel_date_stock where ticket_id = $1 and date = $2 for update', [ticketId, date])
    ).rows[0]
    if (!stock) throw notFound('该日期未开放售卖')
    if (stock.remaining < qty) throw conflict(`余票不足，仅剩 ${stock.remaining} 张`)

    const up = await c.query(
      'update travel_date_stock set remaining = remaining - $1 where ticket_id = $2 and date = $3 and remaining >= $1 returning remaining',
      [qty, ticketId, date],
    )
    if (!up.rows.length) throw conflict('余票不足，请刷新后重试')

    if (orderId) {
      await c.query(
        `update mall_orders set biz_status = 'pending_ticket', updated_at = now()
          where id = $1 and user_id = $2 and coalesce(biz_status, '') = ''`,
        [orderId, ctx.uid],
      )
    }
    return { ticket_id: ticketId, date, qty, remaining: up.rows[0].remaining }
  })
}

/** 出行释放：回滚某票种某日库存（取消未支付订单）。
 *  p_order_id 必填：必须凭「本人且未支付」的订单才能加库存，否则任意登录用户
 *  可对任意 (票种, 日期) 无凭据地放大 remaining，击穿防超卖的库存水位。 */
async function travel_release(ctx, p) {
  const ticketId = str(p, 'p_ticket_id', { max: 200 })
  const date = dateParam(p, 'p_date')
  const qty = int(p, 'p_qty', { min: 1, max: 999 })
  const orderId = str(p, 'p_order_id', { max: 200 })

  const o = await one('select id, user_id, status from mall_orders where id = $1', [orderId])
  if (!o) throw notFound('订单不存在')
  if (o.user_id !== ctx.uid) throw forbidden('只能操作自己的订单')
  if (o.status !== 'unpaid') return { released: 0, reason: 'order_not_unpaid' }
  const up = await query(
    'update travel_date_stock set remaining = remaining + $1 where ticket_id = $2 and date = $3 returning remaining',
    [qty, ticketId, date],
  )
  if (!up.rows.length) throw notFound('该日期库存不存在')
  return { released: qty, remaining: up.rows[0].remaining }
}

/**
 * 出行退票 —— 防重复退四道闸：
 *   ① 非出行单  ② 已在退款中/已退款  ③ 非 ticketed 态  ④ 不可退（或已过截止窗口）
 * 手续费取整用 ceil（与前端 travelRefundFee 完全一致），实退 greatest(0, amount-fee)。
 */
async function travel_refund(ctx, p) {
  const orderId = str(p, 'p_order_id', { max: 200 })

  return tx(async (c) => {
    const o = (await c.query('select * from mall_orders where id = $1', [orderId])).rows[0]
    if (!o) throw notFound('订单不存在')
    if (o.user_id !== ctx.uid) throw forbidden('只能操作自己的订单') // ①
    if (o.biz_kind !== 'travel') throw badRequest('该订单不是出行订单')
    if (o.biz_status === 'refunding' || o.biz_status === 'refunded') throw conflict('该订单已在退款流程中') // ②
    if (o.biz_status !== 'ticketed') throw conflict('仅已出票订单可退票') // ③

    const ext = o.ext ?? {}
    const ticketId = typeof ext.ticketId === 'string' ? ext.ticketId : ''
    const date = typeof ext.date === 'string' ? ext.date.slice(0, 10) : ''
    const qty = Number(ext.passengerCount ?? o.qty ?? 1)

    // 退改规则取「下单时快照」优先 —— 运营事后改规则不影响已成交订单
    const snap = ext.rule ?? null
    const ruleRow = ticketId
      ? (await c.query('select * from travel_rules where ticket_id = $1', [ticketId])).rows[0]
      : null
    const rule = {
      refundable: snap ? snap.refundable !== false : ruleRow?.refundable !== false,
      changeable: snap ? snap.changeable !== false : ruleRow?.changeable !== false,
      feeRate: Math.min(1, Math.max(0, Number(snap ? snap.feeRate : ruleRow?.fee_rate ?? 0) || 0)),
      cutoffHours: Math.max(0, Number(snap ? snap.cutoffHours : ruleRow?.cutoff_hours ?? 0) || 0),
    }
    if (!rule.refundable) throw conflict('该票种不支持退票') // ④

    const amount = Number(o.amount_fen ?? 0)
    const fee = Math.ceil(amount * rule.feeRate)
    const refund = Math.max(0, amount - fee)

    await c.query(`update mall_orders set biz_status = 'refunding', updated_at = now() where id = $1`, [orderId])

    let restored = 0
    if (ticketId && date) {
      const roll = await c.query(
        'update travel_date_stock set remaining = remaining + $1 where ticket_id = $2 and date = $3 returning remaining',
        [qty, ticketId, date],
      )
      restored = roll.rows.length ? qty : 0
    }

    // 退款闭环：实退金额入钱包（income 流水）。与状态转移同事务 + 快照去重，
    // 重复退同一单时既进不到这里（前面的状态闸），也插不进第二条流水。
    let credited = 0
    if (refund > 0) {
      const dupe = (
        await c.query(
          `select 1 as hit from wallet_txs
            where user_id = $1 and kind = 'income' and snapshot ->> 'refund_order_id' = $2 limit 1`,
          [ctx.uid, orderId],
        )
      ).rows[0]
      if (!dupe) {
        await ensureBalance(c, ctx.uid)
        await c.query(
          `update wallet_balances set balance_fen = balance_fen + $1, updated_at = now() where user_id = $2`,
          [refund, ctx.uid],
        )
        await c.query(
          `insert into wallet_txs (user_id, kind, fen, note, snapshot, at)
           values ($1, 'income', $2, $3, $4::jsonb, $5)`,
          [
            ctx.uid,
            refund,
            `退票退款 ${orderId}`,
            JSON.stringify({ refund_order_id: orderId, fee_fen: fee, amount_fen: amount }),
            Date.now(),
          ],
        )
        credited = refund
      }
    }

    await c.query(
      `update mall_orders set biz_status = 'refunded',
              status = case when status = 'awaiting_confirm' then 'paid' else status end,
              updated_at = now()
        where id = $1`,
      [orderId],
    )

    await c.query(
      `insert into audit_logs (actor_id, action, target_type, target_id, detail)
       values ($1, 'travel_refund', 'mall_order', $2, $3::jsonb)`,
      [ctx.uid, orderId, JSON.stringify({ amount_fen: amount, fee_fen: fee, refund_fen: refund })],
    )

    return {
      order_id: orderId,
      amount_fen: amount,
      fee_fen: fee,
      refund_fen: refund,
      credited_fen: credited,
      restored,
    }
  })
}

/* ==========================================================================
 * 本地生活：服务端发码 / 一次性核销
 * ========================================================================== */

/**
 * AN-001 出行出票 —— 打通 pending_ticket → ticketed，使退票链路可达。
 *
 * 状态机（与前端 BIZ_STATUS_META 一致）：
 *   下单占座后 pending_ticket → （本 RPC）ticketed → travel_refund 闸口放行。
 * 闸口：
 *   ① 订单存在且归属本人；② 必须是出行单；③ 必须已支付（paid/done）——
 *   未支付订单不占资金，出票无意义；④ 仅 pending_ticket 可出票。
 * 幂等：已是 ticketed 视为重复点击，原样返回 reused=true，不重复写 ext。
 * 出票时间戳（bigint 毫秒）记进 ext.issued_at，便于对账。
 */
async function travel_issue(ctx, p) {
  const orderId = str(p, 'p_order_id', { max: 200 })

  return tx(async (c) => {
    const o = (await c.query('select * from mall_orders where id = $1 for update', [orderId])).rows[0]
    if (!o) throw notFound('订单不存在')
    if (o.user_id !== ctx.uid) throw forbidden('只能操作自己的订单') // ①
    if (o.biz_kind !== 'travel') throw badRequest('该订单不是出行订单') // ②
    if (o.biz_status === 'ticketed') return { order_id: orderId, biz_status: 'ticketed', reused: true }
    if (o.biz_status !== 'pending_ticket') throw conflict('当前状态不可出票')
    if (o.status !== 'paid' && o.status !== 'done') throw conflict('订单未支付，不能出票') // ③

    const issuedAt = Date.now()
    await c.query(
      `update mall_orders set biz_status = 'ticketed',
              ext = coalesce(ext, '{}'::jsonb) || jsonb_build_object('issued_at', $2::bigint),
              updated_at = now()
        where id = $1`,
      [orderId, issuedAt],
    )
    return { order_id: orderId, biz_status: 'ticketed', issued_at: issuedAt, reused: false }
  })
}

/** 支付后发码：幂等（同订单返回原码）、未支付拒绝、有效期 least(voucher.valid_until, now+90d) */
async function issue_voucher_code(ctx, p) {
  const orderId = str(p, 'p_order_id', { max: 200 })
  const voucherId = str(p, 'p_voucher_id', { max: 200 })

  return tx(async (c) => {
    const v = (await c.query('select * from local_vouchers where id = $1', [voucherId])).rows[0]
    if (!v) throw notFound('套餐券不存在')

    const o = (await c.query('select * from mall_orders where id = $1', [orderId])).rows[0]
    if (!o) throw notFound('订单不存在')
    if (o.user_id !== ctx.uid) throw forbidden('只能操作自己的订单')
    if (o.status !== 'paid' && o.status !== 'done') throw conflict('订单未支付，不能取券码')

    const exist = (await c.query('select code, expire_at from local_voucher_codes where order_id = $1', [orderId])).rows[0]
    if (exist) return { code: exist.code, expire_at: exist.expire_at, reused: true }

    const now = Date.now()
    const code = createHash('md5')
      .update(`${orderId}|${voucherId}|${randomUUID()}`)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase()
    const expireAt = Math.min(Number(v.valid_until), now + VOUCHER_MAX_MS)

    await c.query(
      `insert into local_voucher_codes (code, order_id, voucher_id, merchant_id, user_id, status, expire_at)
       values ($1, $2, $3, $4, $5, 'unused', $6)`,
      [code, orderId, voucherId, v.merchant_id, ctx.uid, expireAt],
    )
    await c.query(
      `update mall_orders
          set biz_status = coalesce(biz_status, 'pending_verify'),
              ext = coalesce(ext, '{}'::jsonb) || jsonb_build_object('voucherCode', $2::text),
              updated_at = now()
        where id = $1`,
      [orderId, code],
    )
    return { code, expire_at: expireAt, reused: false }
  })
}

/** 到店核销：一次性状态转移（where status='unused'），重复核销必然失败 */
async function verify_voucher(ctx, p) {
  ctx.requireAdmin()
  const code = str(p, 'p_code', { max: 64 })
  const now = Date.now()

  return tx(async (c) => {
    const row = (await c.query('select * from local_voucher_codes where code = $1', [code])).rows[0]
    if (!row) throw notFound('券码不存在')
    if (row.status === 'used') throw conflict('该券码已被核销')
    if (row.status !== 'unused') throw conflict(`券码状态不可核销：${row.status}`)
    if (row.expire_at <= now) {
      await c.query(`update local_voucher_codes set status = 'expired' where code = $1 and status = 'unused'`, [code])
      throw conflict('券码已过期')
    }

    const up = await c.query(
      `update local_voucher_codes set status = 'used', used_at = $2
        where code = $1 and status = 'unused' returning order_id`,
      [code, now],
    )
    if (!up.rows.length) throw conflict('该券码已被核销')

    const orderId = up.rows[0].order_id
    await c.query(
      `update mall_orders set biz_status = 'verified', updated_at = now()
        where id = $1 and coalesce(biz_status, '') <> 'verified'`,
      [orderId],
    )
    await c.query(
      `insert into audit_logs (actor_id, action, target_type, target_id, detail)
       values ($1, 'verify_voucher', 'voucher_code', $2, '{}'::jsonb)`,
      [ctx.uid, code],
    )
    return { code, order_id: orderId, used_at: now }
  })
}

/* ==========================================================================
 * 钱包：余额一律服务端计算
 * ========================================================================== */

async function ensureBalance(c, uid) {
  await c.query('insert into wallet_balances (user_id) values ($1) on conflict (user_id) do nothing', [uid])
}

async function wallet_state(ctx) {
  await query('insert into wallet_balances (user_id) values ($1) on conflict (user_id) do nothing', [ctx.uid])
  const b = await one('select balance_fen, plan from wallet_balances where user_id = $1', [ctx.uid])
  const txs = await query(
    'select id, kind, fen, note, at from wallet_txs where user_id = $1 order by at desc limit 50',
    [ctx.uid],
  )
  return { balance_fen: Number(b?.balance_fen ?? 0), plan: b?.plan ?? 'BASIC', txns: txs.rows }
}

async function wallet_debit(ctx, p) {
  const fen = int(p, 'p_fen', { min: 1, max: 100_000_000_000 })
  const note = p.p_note === undefined || p.p_note === null ? '' : str(p, 'p_note', { min: 0, max: 200 })
  return tx(async (c) => {
    const up = await c.query(
      `update wallet_balances set balance_fen = balance_fen - $1, updated_at = now()
        where user_id = $2 and balance_fen >= $1 returning balance_fen`,
      [fen, ctx.uid],
    )
    if (!up.rows.length) throw conflict('余额不足')
    await c.query(
      `insert into wallet_txs (user_id, kind, fen, note, at) values ($1, 'consume', $2, $3, $4)`,
      [ctx.uid, fen, note, Date.now()],
    )
    return { balance_fen: Number(up.rows[0].balance_fen), fen }
  })
}

async function wallet_credit(ctx, p) {
  const fen = int(p, 'p_fen', { min: 1, max: 100_000_000_000 })
  const kind = p.p_kind === undefined || p.p_kind === null ? 'recharge' : str(p, 'p_kind', { max: 20 })
  if (kind !== 'recharge' && kind !== 'income') throw badRequest('入账类型只能为 recharge 或 income')
  const note = p.p_note === undefined || p.p_note === null ? '' : str(p, 'p_note', { min: 0, max: 200 })

  return tx(async (c) => {
    await ensureBalance(c, ctx.uid)
    const up = await c.query(
      `update wallet_balances set balance_fen = balance_fen + $1, updated_at = now()
        where user_id = $2 returning balance_fen`,
      [fen, ctx.uid],
    )
    await c.query(
      `insert into wallet_txs (user_id, kind, fen, note, at) values ($1, $2, $3, $4, $5)`,
      [ctx.uid, kind, fen, note, Date.now()],
    )
    return { balance_fen: Number(up.rows[0].balance_fen), fen, kind }
  })
}

/* ==========================================================================
 * 商城订单 / 私信 / 成长
 * ========================================================================== */

/** 订单 upsert：owner 强制为调用者，禁止抢夺他人订单；金额列 amount_fen（分） */
async function mall_upsert_order(ctx, p) {
  const o = p.p_order
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw badRequest('缺少参数：p_order')
  const id = str(o, 'id', { max: 200 })
  const amountFen = int(o, 'amount_fen', { min: 0, max: 100_000_000_000 })
  const qty = o.qty === undefined || o.qty === null ? 1 : int(o, 'qty', { min: 1, max: 9999 })
  const status = o.status === undefined || o.status === null ? 'unpaid' : String(o.status)
  if (!ORDER_STATUS.includes(status)) throw badRequest(`非法订单状态：${status}`)
  let bizKind = o.biz_kind === undefined || o.biz_kind === null ? null : String(o.biz_kind)
  if (bizKind !== null && !BIZ_KINDS.includes(bizKind)) throw badRequest(`非法业务类型：${bizKind}`)
  if (bizKind === '') bizKind = null

  const opt = (k, max = 500) => (o[k] === undefined || o[k] === null ? null : str(o, k, { max }))
  const jsonb = (k) => (o[k] === undefined || o[k] === null ? null : JSON.stringify(o[k]))

  return tx(async (c) => {
    const cur = (await c.query('select user_id, at from mall_orders where id = $1 for update', [id])).rows[0]
    if (cur && cur.user_id !== ctx.uid) throw forbidden('订单号已被占用')

    const fields = {
      goods_id: opt('goods_id', 200),
      title: opt('title'),
      emoji: opt('emoji', 32),
      amount_fen: amountFen,
      qty,
      channel: opt('channel', 32),
      status,
      pay_channel: opt('pay_channel', 64),
      proof: jsonb('proof'),
      biz_kind: bizKind,
      ext: jsonb('ext'),
      biz_status: opt('biz_status', 64),
    }

    if (cur) {
      const sets = []
      const vals = []
      for (const [k, v] of Object.entries(fields)) {
        vals.push(v)
        sets.push(`"${k}" = $${vals.length}`)
      }
      vals.push(Date.now())
      sets.push(`updated_at = to_timestamp($${vals.length} / 1000.0)`)
      vals.push(id)
      const r = await c.query(
        `update mall_orders set ${sets.join(', ')} where id = $${vals.length} returning *`,
        vals,
      )
      return r.rows[0]
    }

    const cols = Object.keys(fields)
    const vals = cols.map((k) => fields[k])
    vals.push(ctx.uid)
    cols.push('user_id')
    vals.push(Date.now())
    cols.push('at')
    const r = await c.query(
      `insert into mall_orders (id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
      [id, ...vals],
    )
    return r.rows[0]
  })
}

/** 私信：收发双方各持一份副本（owner 列即收件人），因此读天然隔离 */
async function send_message(ctx, p) {
  const peer = uuidParam(p, 'p_peer')
  const content = str(p, 'p_content', { max: 2000 })
  if (peer === ctx.uid) throw badRequest('不能给自己发私信')
  const peerUser = await one('select id from users where id = $1', [peer])
  if (!peerUser) throw notFound('用户不存在')

  const at = Date.now()
  const id = randomUUID()
  await tx(async (c) => {
    await c.query(
      `insert into messages (id, user_id, peer_id, from_me, content, created_at, read)
       values ($1, $2, $3, true, $4, $5, true), ($6, $3, $2, false, $4, $5, false)`,
      [id, ctx.uid, peer, content, at, `${id}r`],
    )
  })
  return { id, peer_id: peer, created_at: at }
}

/** 首个管理员：库里已有管理员即冲突（这是一次性动作） */
async function bootstrap_admin(ctx) {
  return tx(async (c) => {
    const has = (
      await c.query(
        `select 1 as hit from user_roles ur join roles r on r.id = ur.role_id where r.name = 'admin' limit 1`,
      )
    ).rows[0]
    if (has) throw conflict('已有管理员，请让对方在角色管理中授予')
    await c.query(
      `insert into user_roles (user_id, role_id)
       select $1, r.id from roles r where r.name = 'admin'
       on conflict do nothing`,
      [ctx.uid],
    )
    await c.query(
      // actor_id 是 uuid、target_id 是 text：必须用两个占位符。
      // 同一个 $1 承担两种类型时 PG 会报 42P08（inconsistent types deduced）。
      `insert into audit_logs (actor_id, action, target_type, target_id, detail)
       values ($1, 'bootstrap_admin', 'user', $2, '{}'::jsonb)`,
      [ctx.uid, String(ctx.uid)],
    )
    const { roles, permissions } = await loadRolesVia(c, ctx.uid)
    return { roles, permissions }
  })
}

async function loadRolesVia(c, uid) {
  const [roles, perms] = await Promise.all([
    c.query('select r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1', [uid]),
    c.query(
      `select distinct p.key from user_roles ur
         join role_permissions rp on rp.role_id = ur.role_id
         join permissions p on p.id = rp.permission_id
        where ur.user_id = $1`,
      [uid],
    ),
  ])
  return { roles: roles.rows.map((x) => x.name), permissions: perms.rows.map((x) => x.key) }
}

/* ---------- 成长引擎 ---------- */

const dayStart = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

async function growth_record(ctx, p) {
  const action = str(p, 'p_action', { max: 100 })
  const quality = bool(p, 'p_quality', true)

  return tx(async (c) => {
    const rule = (await c.query('select * from growth_rules where action = $1', [action])).rows[0]
    if (!rule) throw notFound('未配置该行为的成长规则')
    if (rule.quality_gate && !quality) throw badRequest('内容质量未达标，本次不计分')
    if (rule.daily_cap !== null && rule.value > 0) {
      const used = (
        await c.query(
          'select count(*)::int as n from growth_events where user_id = $1 and action = $2 and at >= $3',
          [ctx.uid, action, dayStart()],
        )
      ).rows[0].n
      if (used >= rule.daily_cap) throw conflict(`今日该行为已达上限（${rule.daily_cap} 次）`)
    }
    const r = await c.query(
      'insert into growth_events (user_id, action, at) values ($1, $2, $3) returning id',
      [ctx.uid, action, Date.now()],
    )
    return { id: Number(r.rows[0].id), action, value: rule.value }
  })
}

async function growth_checkin(ctx) {
  // 校时在服务端：客户端改系统时钟伪造连击无效
  const key = (v) => {
    if (typeof v === 'string') return v.slice(0, 10) // date 列已被解析为 YYYY-MM-DD 字符串
    const d = v instanceof Date ? v : new Date(v)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const today = new Date()
  const yest = new Date(today.getTime() - DAY_MS)
  return tx(async (c) => {
    const cur = (await c.query('select * from growth_checkins where user_id = $1 for update', [ctx.uid])).rows[0]
    if (!cur) {
      await c.query('insert into growth_checkins (user_id, last, streak) values ($1, $2, 1)', [ctx.uid, key(today)])
      return { streak: 1 }
    }
    if (key(cur.last) === key(today)) throw conflict('今天已经签到过了')
    const streak = key(cur.last) === key(yest) ? Number(cur.streak) + 1 : 1
    await c.query('update growth_checkins set last = $2, streak = $3, updated_at = now() where user_id = $1', [
      ctx.uid,
      key(today),
      streak,
    ])
    return { streak }
  })
}

async function growth_state(ctx) {
  const [ev, bd, ck] = await Promise.all([
    query('select id, action, at from growth_events where user_id = $1 order by at desc', [ctx.uid]),
    query('select code, at from growth_badges where user_id = $1', [ctx.uid]),
    one('select last, streak from growth_checkins where user_id = $1', [ctx.uid]),
  ])
  return {
    events: ev.rows,
    badges: bd.rows,
    checkin: ck ? { last: String(ck.last), streak: Number(ck.streak) } : { last: '', streak: 0 },
  }
}

/* ==========================================================================
 * 后台：充值核销（仅管理员）
 *
 * 为什么必须走服务端：wallet_balances 不在 REST 白名单、wallet_txs 是 write:none，
 * 前端无法也不应直接改他人余额；wallet_credit 只能给「调用者自己」入账。
 * 管理员给他人入账必须由服务端校验角色并原子完成「加余额 + 记流水 + 写审计」。
 * ========================================================================== */

/** 按 UUID 或用户名查用户与余额，供核销前核对 */
async function admin_user_lookup(ctx, p) {
  ctx.requireAdmin()
  const q = str(p, 'p_query', { max: 64 })
  const byId = UUID_RE.test(q)
  const r = await one(
    `select u.id, u.username, u.name, coalesce(b.balance_fen, 0) as balance_fen
       from users u left join wallet_balances b on b.user_id = u.id
      where ${byId ? 'u.id = $1' : 'u.username = $1'}`,
    [q],
  )
  if (!r) throw notFound('用户不存在')
  return { id: r.id, username: r.username, name: r.name, balance_fen: Number(r.balance_fen) }
}

/** 管理员核销入账：一次性完成加余额、记充值流水、写审计留痕 */
async function admin_wallet_credit(ctx, p) {
  ctx.requireAdmin()
  const uid = uuidParam(p, 'p_user_id')
  const fen = int(p, 'p_fen', { min: 1, max: 100_000_000_000 })
  const note = p.p_note === undefined || p.p_note === null ? '' : str(p, 'p_note', { min: 0, max: 200 })

  return tx(async (c) => {
    const user = (await c.query('select username from users where id = $1', [uid])).rows[0]
    if (!user) throw notFound('用户不存在')
    await ensureBalance(c, uid)
    const up = await c.query(
      `update wallet_balances set balance_fen = balance_fen + $1, updated_at = now()
        where user_id = $2 returning balance_fen`,
      [fen, uid],
    )
    await c.query(
      `insert into wallet_txs (user_id, kind, fen, note, at) values ($1, 'recharge', $2, $3, $4)`,
      [uid, fen, note, Date.now()],
    )
    await c.query(
      `insert into audit_logs (actor_id, action, target_type, target_id, detail)
       values ($1, 'wallet.credit', 'user', $2, $3)`,
      [ctx.uid, uid, JSON.stringify({ fen, note, username: user.username })],
    )
    return { balance_fen: Number(up.rows[0].balance_fen), fen }
  })
}

/** 充值流水：p_user_id 缺省时返回全站最近充值记录，便于对账 */
async function admin_wallet_ledger(ctx, p) {
  ctx.requireAdmin()
  const limit = int(p, 'p_limit', { min: 1, max: 200, def: 50 })
  const raw = p.p_user_id === undefined || p.p_user_id === null || p.p_user_id === '' ? '' : String(p.p_user_id)
  const uid = raw ? uuidParam(p, 'p_user_id') : ''
  const sql = uid
    ? `select t.id, t.user_id, u.username, t.fen, t.note, t.at
         from wallet_txs t join users u on u.id = t.user_id
        where t.user_id = $1 and t.kind = 'recharge' order by t.at desc limit $2`
    : `select t.id, t.user_id, u.username, t.fen, t.note, t.at
         from wallet_txs t join users u on u.id = t.user_id
        where t.kind = 'recharge' order by t.at desc limit $2`
  const r = await query(sql, uid ? [uid, limit] : [limit])
  return { rows: r.rows }
}

/* ---------- 注册表 ---------- */

export const RPCS = new Map(
  Object.entries({
    /* 秒杀 / 出行库存 */
    seckill_grab,
    seckill_release,
    travel_book,
    travel_release,
    travel_issue,
    travel_refund,
    /* 本地生活券码 */
    issue_voucher_code,
    verify_voucher,
    /* 钱包 */
    wallet_state,
    wallet_debit,
    wallet_credit,
    /* 订单 / 私信 / 管理员 */
    mall_upsert_order,
    send_message,
    bootstrap_admin,
    /* 后台充值核销 */
    admin_user_lookup,
    admin_wallet_credit,
    admin_wallet_ledger,
    /* 成长 */
    growth_record,
    growth_checkin,
    growth_state,
  }),
)

export async function callRpc(ctx, fn, params) {
  const handler = RPCS.get(fn)
  if (!handler) throw schemaError(`未开放的服务端过程：${fn}`)
  return handler(ctx, params ?? {})
}

export function knownRpcs() {
  return [...RPCS.keys()]
}
