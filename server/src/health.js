/* ============================================================================
 * 深度健康检查 —— GET /api/health 与 GET /api/health?full=1
 *
 * 契约（向后兼容原 { ok, db, rpcs, service, uptime_ms }）：
 *   浅探活（默认）：进程存活 + 各依赖状态摘要，HTTP 恒 200（探活不靠状态码判活，
 *                  靠 body.db / body.disk.ok 等布尔字段，monitor.sh 据此退出非零）。
 *   深度（?full=1）：在浅探活基础上追加 migrations 已应用/待应用清单。
 *
 * 设计：任何依赖检查失败都被 try/catch 收敛成该依赖的 false，绝不让健康检查
 *      自身 500——否则数据库一坏连排障日志都打不出来。
 * ========================================================================== */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, ping } from './db.js'
import { knownRpcs } from './rpc.js'
import { uploadDir } from './storage.js'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

/** 磁盘余量阈值：used_pct 超过即判磁盘紧张（满了会写不上上传文件/日志） */
const DISK_FULL_PCT = 95

/** uploads 目录是否存在且可写（不存在就尝试建一次，建不起来=不可写） */
async function checkUploads() {
  try {
    await fsp.mkdir(uploadDir, { recursive: true })
    await fs.promises.access(uploadDir, fs.constants.W_OK)
    return { dir: uploadDir, writable: true }
  } catch (e) {
    return { dir: uploadDir, writable: false, error: e.message }
  }
}

/** uploads 所在分区的容量与余量（node 18.15+ 提供 fs.promises.statfs） */
async function checkDisk() {
  try {
    const s = await fsp.statfs(uploadDir)
    const total = Number(s.blocks) * Number(s.bsize)
    const free = Number(s.bavail) * Number(s.bsize)
    const usedPct = total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : 0
    return {
      total_bytes: total,
      free_bytes: free,
      used_pct: usedPct,
      ok: usedPct < DISK_FULL_PCT,
    }
  } catch (e) {
    // statfs 不可用（极少）时不报 ok=false 误伤，只给 null 让上层知道没查到
    return { ok: null, error: e.message }
  }
}

/** 连接池摘要（pg Pool 自带计数属性） */
function poolStats() {
  return {
    total_count: pool.totalCount ?? 0,
    idle_count: pool.idleCount ?? 0,
    waiting_count: pool.waitingCount ?? 0,
  }
}

/** ?full=1：已应用迁移 vs 磁盘上待应用迁移（与 scripts/migrate.js 同一目录口径） */
async function checkMigrations() {
  let onDisk = []
  try {
    onDisk = (await fsp.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  } catch (e) {
    return { total: 0, applied_count: 0, applied: [], pending: [], error: e.message }
  }
  let applied = []
  try {
    const r = await pool.query('select filename from schema_migrations order by filename')
    applied = r.rows.map((row) => row.filename)
  } catch (e) {
    // 库都没连上时 ping 已经是 false；这里把错误带出来，便于区分「表没建」与「库没连」
    return { total: onDisk.length, applied_count: 0, applied: [], pending: onDisk, error: e.message }
  }
  const appliedSet = new Set(applied)
  const pending = onDisk.filter((f) => !appliedSet.has(f))
  return { total: onDisk.length, applied_count: applied.length, applied, pending }
}

/**
 * 健康报告。
 * @param {boolean} full  ?full=1 时追加 migrations 明细
 */
export async function healthReport(full = false) {
  let db = false
  try {
    db = await ping()
  } catch {
    db = false
  }

  // 先确保 uploads 目录存在（checkUploads 内部 mkdir），再查它所在分区磁盘——
  // 并发 Promise.all 时 statfs 可能先于 mkdir 跑、撞上不存在的目录。
  const uploads = await checkUploads()
  const disk = await checkDisk()

  const report = {
    ok: true, // 进程存活即浅探活通过；依赖健康看下方各布尔字段
    db,
    service: 'mim-server',
    uptime_ms: Math.round(process.uptime() * 1000),
    rpcs: knownRpcs().length, // 动态从 RPCS 注册表计数（后端新增 RPC 自动计入）
    pool: poolStats(),
    uploads,
    disk,
  }

  if (full) {
    report.migrations = await checkMigrations()
  }

  return report
}
