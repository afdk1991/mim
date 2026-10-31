/* ==========================================================================
 * 版本体系 —— 四段式 major.minor.patch.build，全工程唯一版本源
 *
 * 派生规则（供 package.json / 原生壳使用）：取第 1、2、4 段 → 三段式。
 * 例：0.1.0.3 → 0.1.3
 * ======================================================================== */

export const APP_VERSION = '0.0.0.0'

/** 三段式派生版本（原生壳 / 发版标签用） */
export function derivedVersion(v: string = APP_VERSION): string {
  const p = v.split('.')
  return `${p[0] ?? '0'}.${p[1] ?? '0'}.${p[3] ?? p[2] ?? '0'}`
}

/** 比较版本号：next 严格大于 current 返回 true */
export function isNewer(current: string, next: string): boolean {
  const a = current.split('.').map((x) => Number(x) || 0)
  const b = next.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < 4; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (y > x) return true
    if (y < x) return false
  }
  return false
}
