/* ==========================================================================
 * 本地存储层 —— 统一键名 + 元素级校验 + 旧键迁移
 *
 * 1. 键名规范（重建统一为点分结构，取代历史 `mim-<域>-<uid>:<field>` 混写）：
 *      mim.<scope>.<field>            全局（不随身份变化）
 *      mim.<scope>.<uid>.<field>      按身份隔离
 * 2. 所有读取必须传 `parse`：逐元素类型校验，脏数据剔除而非强转，
 *    否则一条损坏记录会让整个页面白屏（原实现踩过）。
 * 3. 旧键名通过 `legacy` 声明，首次读取时自动迁移一次，老用户数据不丢。
 * 4. 隐私模式下 setItem 抛异常：静默降级，绝不阻断渲染。
 * 5. 底层读写一律走 `getPlatform().storage`（见 src/platform），本文件是全工程
 *    唯一允许出现存储键名规范的地方，禁止再直接写 localStorage。
 * ======================================================================== */

import { getPlatform } from '../platform'

const NS = 'mim'

/** 未登录时的本机身份锚点（沿用原实现常量，不是「演示模式」标记） */
export const LOCAL_UID = 'local'

export function globalKey(scope: string, field: string): string {
  return `${NS}.${scope}.${field}`
}

export function userKey(scope: string, uid: string, field: string): string {
  return `${NS}.${scope}.${uid}.${field}`
}

/* ---------- 底层读写 ---------- */

export function readRaw(key: string): string | null {
  try {
    return getPlatform().storage.get(key)
  } catch {
    return null
  }
}

export function writeRaw(key: string, value: string): void {
  try {
    getPlatform().storage.set(key, value)
  } catch {
    /* 隐私模式 / 配额超限：静默忽略，内存态仍可用 */
  }
}

export function removeKey(key: string): void {
  try {
    getPlatform().storage.remove(key)
  } catch {
    /* 同上 */
  }
}

export function listKeys(prefix = `${NS}.`): string[] {
  try {
    return getPlatform().storage.keys(prefix)
  } catch {
    return []
  }
}

/* ---------- 带校验的 JSON 读写 ---------- */

/** 读取并校验；parse 返回 null 表示数据不合法 → 回退 fallback */
export function readJson<T>(key: string, parse: (raw: unknown) => T | null, fallback: T): T {
  const raw = readRaw(key)
  if (raw === null) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    const val = parse(parsed)
    return val === null ? fallback : val
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value))
  } catch {
    /* 循环引用 / 超大对象：忽略 */
  }
}

/** 元素级数组校验器：只要有一项不合法就整体回退，避免半损坏状态 */
export function arrayOf<T>(item: (v: unknown) => T | null): (raw: unknown) => T[] | null {
  return (raw) => {
    if (!Array.isArray(raw)) return null
    const out: T[] = []
    for (const v of raw) {
      const one = item(v)
      if (one === null) return null
      out.push(one)
    }
    return out
  }
}

export const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)
export const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const asBoolean = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

export function asRecord(v: unknown): Record<string, unknown> | null {
  return !!v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 字符串数组（元素级） */
export const asStringArray = arrayOf<string>(asString)

/* ---------- 旧键迁移 ---------- */

/** 声明式迁移：新键 ← 旧键。首次读取时若新键不存在而旧键存在，则搬运一次。 */
export function migrateOnce(newKey: string, legacyKeys: string[]): void {
  if (readRaw(newKey) !== null) return
  for (const oldKey of legacyKeys) {
    const v = readRaw(oldKey)
    if (v !== null) {
      writeRaw(newKey, v)
      removeKey(oldKey)
      return
    }
  }
}

/** 清除某身份下的全部隔离键（注销 / 切换账号用） */
export function purgeUid(uid: string): number {
  let n = 0
  for (const k of listKeys()) {
    // 用户隔离键形如 `mim.<scope>.<uid>.<field>`，uid 是独立段，必须按点切分后逐个比对，
    // 不能用 `.${uid}.` 子串匹配（否则会误删 `mim.<scope=uid>.<field>` 这类全局键，
    // 或 `mim.x.uidseg.y` 之类含 uid 前缀的段）。
    const seg = k.split('.')
    if (seg.length >= 4 && seg[0] === NS && seg[2] === uid) {
      removeKey(k)
      n += 1
    }
  }
  return n
}
