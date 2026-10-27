/* ============================================================================
 * 通用 REST —— GET / POST / PATCH / DELETE /api/rest/:table
 *
 * 安全模型（三层，缺一层就会「绕过 UI 直接改别人的数据」）：
 *   1. 表白名单：不在 TABLES 里的表一律拒绝。users 永不在白名单，
 *      因此 password_hash 不可能被 select=* 带出去；公开资料一律走 profiles。
 *   2. 列白名单：列名由 information_schema 实时核定，未知列返回 code='schema'，
 *      且提示文案与 PostgREST 一致，前端据此自动降级（见 data/sync.ts）。
 *   3. 归属：写操作强制注入/过滤 owner 列，客户端提交的 owner 值一律忽略。
 *
 * 查询串（与前端 client.ts buildQuery 一一对应）：
 *   select=a,b,c     投影（缺省 *）
 *   eq=col.val       可重复，AND 等值过滤
 *   order=col.asc|col.desc
 *   limit / offset
 * ========================================================================== */

import { query } from './db.js'
import { badRequest, conflict, forbidden, missingColumn, noAuth, notFound, schemaError } from './errors.js'

/* read:  public 匿名可读 / owner 仅本人 / admin 仅管理员
 * write: owner 仅本人（自动注入 owner）/ self owner 列即主键 / admin 仅管理员 / none 禁写
 * visibility: 保密列名（当前仅 posts），非本人在读时剔除 'self' 行
 * pk: 复合主键表的主键列（单列时省略，默认 id） */
const t = (name, cfg) => [name, cfg]

const TABLES = new Map([
  /* ---- 身份 / 资料 ---- */
  t('profiles', { owner: 'id', read: 'public', write: 'self', upsert: true, readonly: ['username'] }),
  t('app_users', { owner: 'user_id', read: 'owner', write: 'none' }),

  /* ---- 内容 ---- */
  t('posts', { owner: 'author_id', read: 'public', write: 'owner', visibility: 'visibility' }),
  t('post_comments', { owner: 'author_id', read: 'public', write: 'owner' }),
  t('articles', { owner: 'author_id', read: 'public', write: 'owner' }),
  t('article_comments', { owner: 'author_id', read: 'public', write: 'owner' }),
  t('snippets', { owner: 'author_id', read: 'public', write: 'owner' }),
  t('follows', { owner: 'follower_id', read: 'public', write: 'owner' }),
  t('favorites', { owner: 'user_id', read: 'owner', write: 'owner' }),
  t('messages', { owner: 'user_id', read: 'owner', write: 'owner' }),
  t('notifications', { owner: 'user_id', read: 'owner', write: 'owner' }),
  t('post_drafts', { owner: 'user_id', read: 'owner', write: 'owner' }),
  t('article_drafts', { owner: 'user_id', read: 'owner', write: 'owner' }),

  /* ---- 商城 ---- */
  t('products', { owner: 'created_by', read: 'public', write: 'owner', adminOverride: true }),
  t('mall_orders', { owner: 'user_id', read: 'owner', write: 'owner' }),
  t('wallet_txs', { owner: 'user_id', read: 'owner', write: 'none' }),

  /* ---- RBAC / 审计 ---- */
  t('roles', { read: 'public', write: 'admin' }),
  t('permissions', { read: 'public', write: 'admin' }),
  t('user_roles', { read: 'admin', write: 'admin' }),
  t('role_permissions', { read: 'admin', write: 'admin' }),
  t('audit_logs', { read: 'admin', write: 'none' }),

  /* ---- 四业务（读公开，写走 RPC 或管理员维护） ---- */
  t('seckill_sessions', { read: 'public', write: 'admin' }),
  t('seckill_locks', { owner: 'user_id', read: 'owner', write: 'none' }),
  t('local_merchants', { read: 'public', write: 'admin' }),
  t('local_vouchers', { read: 'public', write: 'admin' }),
  t('local_voucher_codes', { owner: 'user_id', read: 'owner', write: 'none' }),
  t('live_rooms', { read: 'public', write: 'admin' }),
  t('live_shelf', { read: 'public', write: 'admin', pk: ['room_id', 'goods_id'] }),
  t('travel_tickets', { read: 'public', write: 'admin' }),
  t('travel_date_stock', { read: 'public', write: 'admin', pk: ['ticket_id', 'date'] }),
  t('travel_rules', { read: 'public', write: 'admin', pk: ['ticket_id'] }),

  /* ---- 成长 ---- */
  t('growth_events', { owner: 'user_id', read: 'owner', write: 'none' }),
  t('growth_checkins', { owner: 'user_id', read: 'owner', write: 'none' }),
  t('growth_badges', { owner: 'user_id', read: 'owner', write: 'none' }),
  t('growth_rules', { read: 'public', write: 'admin' }),
])

const IDENT_RE = /^[a-z_][a-z0-9_]*$/

function ident(col) {
  if (!IDENT_RE.test(col)) throw badRequest(`非法标识符：${col}`)
  return `"${col}"`
}

/* ---------- 表结构缓存（列名核定靠它，同时杜绝注入） ---------- */

const cache = new Map()

async function describe(table) {
  if (!TABLES.has(table)) throw schemaError(`表 ${table} 未开放访问`)
  const cached = cache.get(table)
  if (cached) return cached
  const r = await query(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  )
  if (!r.rows.length) {
    throw schemaError(`表 ${table} 不存在，请先在 server 目录执行 npm run migrate`)
  }
  const cfg = TABLES.get(table)
  if ((cfg.read === 'owner' || cfg.write === 'owner') && !cfg.owner) {
    throw schemaError(`表 ${table} 缺少归属列配置`)
  }
  const info = { table, cfg, cols: new Map(r.rows.map((x) => [x.column_name, x.data_type])) }
  cache.set(table, info)
  return info
}

function assertColumns(info, cols) {
  for (const c of cols) {
    if (!info.cols.has(c)) throw missingColumn(info.table, c)
  }
}

/* ---------- 权限 ---------- */

function checkRead(ctx, cfg) {
  if (cfg.read === 'public') return
  if (!ctx) throw noAuth()
  if (cfg.read === 'admin') ctx.requireAdmin()
}

function checkWrite(ctx, cfg) {
  if (!ctx) throw noAuth()
  if (cfg.write === 'none') throw forbidden('该表不允许直接写入，请改用服务端过程')
  if (cfg.write === 'admin') ctx.requireAdmin()
}

/** 归属列；管理员在 adminOverride 表上豁免 */
function ownerGuard(ctx, cfg) {
  if (!cfg.owner) return null
  if (cfg.adminOverride && ctx?.isAdmin?.()) return null
  return cfg.owner
}

/* ---------- 读 ---------- */

export async function list(ctx, table, q) {
  const { cfg, cols } = await describe(table)
  checkRead(ctx, cfg)

  let projection = '*'
  if (q.select) {
    const picked = String(q.select).split(',').map((s) => s.trim()).filter(Boolean)
    if (!picked.length) throw badRequest('select 不能为空')
    assertColumns({ cols, table }, picked)
    projection = picked.map(ident).join(', ')
  }

  const where = []
  const params = []
  const push = (v) => {
    params.push(v)
    return `$${params.length}`
  }

  for (const raw of q.eq ?? []) {
    const str = String(raw ?? '')
    const dot = str.indexOf('.')
    if (dot <= 0) throw badRequest(`eq 参数格式应为 列名.值：${str}`)
    const col = str.slice(0, dot)
    const val = str.slice(dot + 1)
    if (!cols.has(col)) throw missingColumn(table, col)
    const type = cols.get(col)
    if (type === 'boolean') {
      where.push(`${ident(col)} = ${push(val === 'true')}`)
    } else if (type === 'integer' || type === 'bigint' || type === 'numeric' || type === 'double precision') {
      const n = Number(val)
      if (!Number.isFinite(n)) throw badRequest(`列 ${col} 需要数值，收到 ${val}`)
      where.push(`${ident(col)} = ${push(n)}`)
    } else {
      where.push(`${ident(col)} = ${push(val)}`)
    }
  }

  const guard = ownerGuard(ctx, cfg)
  if (cfg.read === 'owner' && guard) where.push(`${ident(guard)} = ${push(ctx.uid)}`)

  if (cfg.visibility) {
    const vis = cfg.visibility
    where.push(
      guard
        ? `(${ident(vis)} is null or ${ident(vis)} <> 'self' or ${ident(guard)} = ${push(ctx?.uid ?? null)})`
        : `(${ident(vis)} is null or ${ident(vis)} <> 'self')`,
    )
  }

  let orderBy = ''
  if (q.order) {
    const [col, dir] = String(q.order).split('.')
    if (!cols.has(col)) throw missingColumn(table, col)
    const d = String(dir ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
    orderBy = ` order by ${ident(col)} ${d} nulls last`
  }

  const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500)
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0)

  const sql = [
    `select ${projection} from ${ident(table)}`,
    where.length ? `where ${where.join(' and ')}` : '',
    orderBy,
    `limit ${limit} offset ${offset}`,
  ]
    .filter(Boolean)
    .join(' ')

  const r = await query(sql, params)
  return r.rows
}

export async function one(ctx, table, id) {
  const { table: name, cfg, cols } = await describe(table)
  checkRead(ctx, cfg)
  const pk = cfg.pk?.[0] ?? 'id'
  if (!cols.has(pk)) throw missingColumn(name, pk)

  const where = [`${ident(pk)} = $1`]
  const params = [id]
  const guard = ownerGuard(ctx, cfg)
  if (cfg.read === 'owner' && guard) {
    params.push(ctx.uid)
    where.push(`${ident(guard)} = $${params.length}`)
  }
  const r = await query(`select * from ${ident(name)} where ${where.join(' and ')} limit 1`, params)
  if (!r.rows.length) throw await missingTarget(name, pk, id, cfg.read === 'owner')
  // 公开表也要挡掉保密行：否则「知道 id 就能看」绕过列表的整体剔除
  if (cfg.visibility && r.rows[0][cfg.visibility] === 'self' && (!guard || r.rows[0][guard] !== ctx?.uid)) {
    throw notFound()
  }
  return r.rows[0]
}

/* ---------- 写 ---------- */

/** jsonb 列需显式序列化；其余交给 pg 自行转换 */
function encode(info, col, val) {
  const type = info.cols.get(col)
  return type === 'jsonb' || type === 'json' ? JSON.stringify(val) : val
}

/* write='self' 的表一个用户只有一行（owner 列即主键），且该行在注册时已创建，
 * 因此 REST POST 表现为 upsert：新行补上不可由客户端编辑的 username（取自令牌身份），
 * 保证 profiles.username 永远与账号一致，不会被 REST 篡改。 */
function pickSelfDefaults(picked, info, cfg, ctx) {
  if (cfg.write !== 'self') return picked
  if (!cfg.readonly?.includes('username') || !info.cols.has('username')) return picked
  if (picked.cols.includes('username')) return picked
  picked.cols.push('username')
  picked.vals.push(ctx.user?.username ?? '')
  return picked
}

function selected(info, body, cfg, ctx) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('请求体需为 JSON 对象')
  const cols = []
  const vals = []
  for (const [k, v] of Object.entries(body)) {
    if (!info.cols.has(k)) throw missingColumn(info.table, k)
    if (cfg.owner && k === cfg.owner) continue // 归属列由服务端注入，客户端说了不算
    if (cfg.readonly?.includes(k)) continue // 身份类字段不可经 REST 改写
    cols.push(k)
    vals.push(v)
  }
  return { cols, vals }
}

export async function insert(ctx, table, body) {
  const info = await describe(table)
  const { cfg } = info
  checkWrite(ctx, cfg)
  const picked = pickSelfDefaults(selected(info, body, cfg, ctx), info, cfg, ctx)

  if (cfg.owner && (cfg.write === 'owner' || cfg.write === 'self')) {
    picked.cols.push(cfg.owner)
    picked.vals.push(ctx.uid)
  }
  if (!picked.cols.length) throw badRequest('没有可写入的字段')

  const params = picked.vals.map((v, i) => encode(info, picked.cols[i], v))
  const marks = params.map((_, i) => `$${i + 1}`)
  const colList = picked.cols.map(ident).join(', ')

  let sql
  if (cfg.upsert && cfg.owner) {
    const sets = picked.cols
      .filter((c) => c !== cfg.owner)
      .map((c) => `${ident(c)} = excluded.${ident(c)}`)
    if (info.cols.has('updated_at')) sets.push('updated_at = now()')
    if (!sets.length) throw badRequest('没有可更新的字段')
    sql = `insert into ${ident(info.table)} (${colList}) values (${marks.join(', ')})
           on conflict (${ident(cfg.owner)}) do update set ${sets.join(', ')} returning *`
  } else {
    sql = `insert into ${ident(info.table)} (${colList}) values (${marks.join(', ')}) returning *`
  }

  try {
    const r = await query(sql, params)
    return r.rows[0]
  } catch (e) {
    throw mapWriteError(e, table)
  }
}

export async function update(ctx, table, id, patch) {
  const info = await describe(table)
  const { cfg } = info
  checkWrite(ctx, cfg)
  const picked = selected(info, patch, cfg, ctx)
  if (!picked.cols.length) throw badRequest('没有可更新的字段')

  // write='self' 的表：目标行恒为调用者本人。路径 id 与自身不符时直接拒绝，
  // 而不是静默改写到自己身上——静默改写会让前端误以为别人的资料被改了。
  const self = cfg.write === 'self' && cfg.owner
  if (self && String(id) !== ctx.uid) throw forbidden('只能操作自己的资料')
  const target = self ? ctx.uid : id
  const pk = self ? cfg.owner : cfg.pk?.[0] ?? 'id'
  const params = []
  const sets = []
  picked.cols.forEach((c, i) => {
    params.push(encode(info, c, picked.vals[i]))
    sets.push(`${ident(c)} = $${params.length}`)
  })
  params.push(target)
  const where = [`${ident(pk)} = $${params.length}`]

  const guard = ownerGuard(ctx, cfg)
  if (cfg.write === 'owner' && guard) {
    params.push(ctx.uid)
    where.push(`${ident(guard)} = $${params.length}`)
  }
  if (info.cols.has('updated_at') && picked.cols.length) sets.push('updated_at = now()')

  try {
    const r = await query(
      `update ${ident(info.table)} set ${sets.join(', ')} where ${where.join(' and ')} returning *`,
      params,
    )
    if (!r.rows.length) throw await missingTarget(info.table, pk, target, cfg.write === 'owner')
    return r.rows[0]
  } catch (e) {
    throw mapWriteError(e, table)
  }
}

export async function remove(ctx, table, id) {
  const info = await describe(table)
  const { cfg } = info
  checkWrite(ctx, cfg)
  const self = cfg.write === 'self' && cfg.owner
  if (self && String(id) !== ctx.uid) throw forbidden('只能操作自己的资料')
  const pk = self ? cfg.owner : cfg.pk?.[0] ?? 'id'
  const target = self ? ctx.uid : id
  const params = [target]
  const where = [`${ident(pk)} = $1`]
  const guard = ownerGuard(ctx, cfg)
  if (cfg.write === 'owner' && guard) {
    params.push(ctx.uid)
    where.push(`${ident(guard)} = $${params.length}`)
  }
  try {
    const r = await query(`delete from ${ident(info.table)} where ${where.join(' and ')}`, params)
    if (!r.rowCount) throw await missingTarget(info.table, pk, target, cfg.write === 'owner')
    return true
  } catch (e) {
    throw mapWriteError(e, table)
  }
}

/** 区分「本来就没有」(404) 与「有但不是你的」(403) */
async function missingTarget(table, pk, id, ownedOnly) {
  const r = await query(`select 1 as hit from ${ident(table)} where ${ident(pk)} = $1 limit 1`, [id])
  if (!r.rows.length) return notFound()
  return ownedOnly ? forbidden('只能操作自己的数据') : notFound()
}

function mapWriteError(e, table) {
  if (e?.code === '23505') return conflict('唯一约束冲突，记录可能已存在')
  if (e?.code === '23503') return badRequest(`引用了不存在的记录（${table}）`)
  if (e?.code === '23502') return badRequest(`缺少必填字段：${e.column ?? ''}`.trimEnd())
  if (e?.code === '23514') return badRequest(e.detail || '字段取值超出允许范围')
  if (e?.code === '42703') return missingColumn(table, e.column ?? '?')
  return e
}

export function knownTables() {
  return [...TABLES.keys()]
}
