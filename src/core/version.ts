/* ==========================================================================
 * 版本体系 —— 三段式 semver major.minor.patch，全工程唯一版本源
 *
 * 所有载体（package.json / tauri.conf / Cargo.toml / Android / iOS /
 * HarmonyOS / worker / git tag）统一使用这同一个三段版本号，不再做四段投影。
 * git tag 形如 V0.0.0（大写 V + 三段）。
 * ======================================================================== */

export const APP_VERSION = '0.0.0'

/** 三段版本（统一后即唯一值，保留函数位以便调用方过渡） */
export function derivedVersion(v: string = APP_VERSION): string {
  return v
}

/** 比较版本号：next 严格大于 current 返回 true */
export function isNewer(current: string, next: string): boolean {
  const a = current.split('.').map((x) => Number(x) || 0)
  const b = next.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (y > x) return true
    if (y < x) return false
  }
  return false
}
