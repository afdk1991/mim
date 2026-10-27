/* ============================================================================
 * 数据库访问 —— pg 连接池与事务包装（唯一外部依赖：pg）
 *
 * 类型解析三处定制（不做前端就要写二次转换，且容易错）：
 *   int8(20)    → number ： epoch 毫秒 / 分为单位的金额均在 2^53 内，转 JSON 才有数字
 *   numeric(1700)→ number： 退改手续费率 0.05 这类小数直接可用
 *   date(1082)  → string ： 保留 'YYYY-MM-DD' 原样，避免 Date 对象被时区偏移成前一天
 * ========================================================================== */

import pg from 'pg'

const { Pool, types } = pg

types.setTypeParser(20, (v) => Number(v))
types.setTypeParser(1700, (v) => Number(v))
types.setTypeParser(1082, (v) => v)

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/mim'

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (e) => {
  console.error('[db] 连接池异常', e.message)
})

export function query(sql, params) {
  return pool.query(sql, params)
}

export function one(sql, params) {
  return pool.query(sql, params).then((r) => r.rows[0] ?? null)
}

/** 事务包装：回调里任何抛错都回滚，调用方不必写 try/finally */
export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    try {
      await client.query('rollback')
    } catch {
      /* 回滚失败无需掩盖原始错误 */
    }
    throw e
  } finally {
    client.release()
  }
}

/** 连通性探测（/api/health 用） */
export async function ping() {
  const r = await query('select 1 as ok')
  return r.rows[0]?.ok === 1
}

export async function close() {
  await pool.end()
}
