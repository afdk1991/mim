/* ==========================================================================
 * 本地优先同步层 —— 「先落本地、再补云端」的统一实现
 *
 * 原实现把这套逻辑散落在 store.tsx / cloud-write.ts / tool-cloud.ts 三处，
 * 行为不一致（有的失败回滚、有的静默、有的重复写）。这里收敛为三个函数：
 *   loadLocal / saveLocal / pushCloud
 *
 * 缺列降级：线上库尚未应用最新迁移时，PostgREST 会整行拒绝含未知列的写入。
 * 这里捕获 schema 错误 → 解析缺失列名 → 剔除后重试（上限 12 轮），
 * 保证「数据结构没跟上」时功能仍可用，迁移补齐后自动恢复全字段写入。
 * ======================================================================== */

import { currentUid, isSignedIn } from './session'
import { db } from './client'
import type { Result } from '../core/result'
import type { WriteBack } from '../core/result'
import { readJson, userKey, writeJson } from '../core/storage'
import { isBackendConfigured } from '../core/config'

const MAX_DROP_ROUNDS = 12

/** 从后端错误消息里抽取缺失列名（形如 Could not find the 'expires_at' column） */
export function parseMissingColumn(message: string): string | null {
  const m = /Could not find the '([^']+)' column/.exec(message)
  return m?.[1] ?? null
}

/** 按身份隔离的本地读取 */
export function loadLocal<T>(scope: string, field: string, parse: (raw: unknown) => T | null, fallback: T): T {
  return readJson(userKey(scope, currentUid(), field), parse, fallback)
}

/** 按身份隔离的本地写入 */
export function saveLocal(scope: string, field: string, value: unknown): void {
  writeJson(userKey(scope, currentUid(), field), value)
}

/** 整包快照：工具台类模块用（一个 key 存整个状态） */
export function loadSnapshot<T>(scope: string, parse: (raw: unknown) => T | null, fallback: T): T {
  return readJson(userKey(scope, currentUid(), 'state'), parse, fallback)
}

export function saveSnapshot(scope: string, value: unknown): void {
  writeJson(userKey(scope, currentUid(), 'state'), value)
}

/**
 * 云端写入的三态收敛：未登录 / 未配置后端 → skip（不算错）
 *
 * 这里必须同时判 isBackendConfigured()：纯本地模式下 http 层会直接返回 offline，
 * 若只判 isSignedIn()，登录用户每写一次都被记成 fail，与「skip 不算错误」的契约矛盾。
 */
export async function pushCloud(run: () => Promise<Result<unknown>>): Promise<WriteBack> {
  if (!isSignedIn() || !isBackendConfigured()) return 'skip'
  const r = await run()
  return r.ok ? 'ok' : 'fail'
}

/** 带缺列降级的写入：返回最终结果与「被剔除的列名」 */
export async function writeWithFallback<T>(
  table: string,
  row: Record<string, unknown>,
  missing: Set<string>,
  send: (r: Record<string, unknown>) => Promise<Result<T>>,
): Promise<{ result: Result<T>; dropped: string[] }> {
  const dropped: string[] = []
  let body = strip(row, missing)
  for (let i = 0; i < MAX_DROP_ROUNDS; i += 1) {
    const r = await send(body)
    if (r.ok) return { result: r, dropped }
    if (r.error.code !== 'schema' && r.error.code !== 'bad_request') return { result: r, dropped }
    const col = parseMissingColumn(r.error.message)
    if (!col || !(col in body)) return { result: r, dropped }
    missing.add(col)
    dropped.push(col)
    body = strip(row, missing)
  }
  return {
    result: {
      ok: false,
      error: { code: 'schema', message: `表 ${table} 字段结构与后端不匹配，已放弃写入` },
    },
    dropped,
  }
}

function strip(row: Record<string, unknown>, missing: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!missing.has(k)) out[k] = v
  }
  return out
}

/** 云端列表读取：失败一律返回 null（页面显示空态），绝不兜底演示数据 */
export async function listCloud<T>(table: string, q: Parameters<typeof db.list>[1]): Promise<T[] | null> {
  const r = await db.list<T>(table, q)
  return r.ok ? r.data : null
}

/** 服务端过程调用：失败返回 null，错误文案由调用方从 Result 取（rpc 需要区分原因） */
export async function rpcCloud<T>(fn: string, params: Record<string, unknown>): Promise<Result<T>> {
  return db.rpc<T>(fn, params, { write: true })
}
